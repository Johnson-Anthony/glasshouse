// glasshouse file manager — components
import React, { useState, useEffect, useRef, useMemo } from "react";
import {
  MENUS,
  PALETTE,
  APP_VERSION,
  TAURI_VERSION,
  type FileRow,
  type FileKind,
  type MenuItemDef,
  type DynamicPayload,
} from "./data";
import { drives as apiDrives, fileStatExtended, gitBranchList, gitFileInfo, hashCrc32, hashMd5, hashSha256, homeDir as apiHomeDir, listDir, listShellProfiles, listWslDistros, netRate, pathFsType, pickDirectory, readImageB64, readPins, readRecent, readTags, readText, setPermissions, systemInfo as apiSystemInfo, winClose, winMinimize, winToggleMaximize, writeTags, writeText, type BlameLine, type Drive, type FileEntry, type FileStatExt, type GitFileInfo, type GitInfo, type NetRate, type ShellProfile, type SystemInfo, type WslDistro } from "./api";
import { getVersion } from "@tauri-apps/api/app";
import { fuzzyFilter } from "./fuzzy";

// ─── dynamic menu expansion ────────────────────────────────────────────────
// Menu trees include `{ kind: "dynamic", source: … }` sentinel nodes. When a
// dropdown renders, we swap each sentinel for a fresh set of real `item`
// nodes with a `payload` field so the click handler knows whether to open a
// path or run a terminal profile. Results are cached per-mount in component
// state, so the menu only fetches once per open.

type DynamicSource = "recent" | "bookmarks-pinned" | "terminal-profiles" | "ssh-hosts" | "git-branches";

// Git branch resolver needs cwd; loadDynamic is cwd-agnostic, so App sets
// this module-level ref on tab change. Hacky but avoids threading cwd
// through every menu prop.
let currentCwdForBranches = "";
export function setDynamicGitCwd(cwd: string): void {
  currentCwdForBranches = cwd;
}

async function loadDynamic(source: DynamicSource): Promise<MenuItemDef[]> {
  switch (source) {
    case "recent": {
      const paths = await readRecent();
      return paths.map<MenuItemDef>((p) => ({
        kind: "item",
        label: p,
        payload: { type: "open-path", path: p },
      }));
    }
    case "bookmarks-pinned": {
      const pins = await readPins();
      return pins.map<MenuItemDef>((p) => ({
        kind: "item",
        label: p,
        payload: { type: "open-path", path: p },
      }));
    }
    case "terminal-profiles": {
      const profs = await listShellProfiles();
      return profs.map<MenuItemDef>((profile) => ({
        kind: "item",
        label: profile.label,
        payload: { type: "run-profile", profile },
      }));
    }
    case "ssh-hosts": {
      const profs = await listShellProfiles();
      return profs
        .filter((p) => p.kind === "ssh")
        .map<MenuItemDef>((profile) => ({
          kind: "item",
          label: profile.label,
          payload: { type: "run-profile", profile },
        }));
    }
    case "git-branches": {
      if (!currentCwdForBranches) return [];
      try {
        const branches = await gitBranchList(currentCwdForBranches);
        return branches.map<MenuItemDef>((b) => ({
          kind: "item",
          // show * prefix on current; dispatch via action so handler can
          // identify the target without parsing cosmetic prefixes.
          label: `${b.current ? "* " : "  "}${b.name}`,
          action: `git-branch:${b.name}`,
        }));
      } catch {
        return [];
      }
    }
  }
}

function useExpandedItems(items: MenuItemDef[], trigger: unknown): MenuItemDef[] {
  const [expanded, setExpanded] = useState<MenuItemDef[]>(items);

  useEffect(() => {
    let cancelled = false;
    const sources: DynamicSource[] = [];
    const collect = (list: MenuItemDef[]) => {
      for (const it of list) {
        if (it.kind === "dynamic") sources.push(it.source);
        else if (it.kind === "sub") collect(it.children);
      }
    };
    collect(items);
    if (sources.length === 0) {
      setExpanded(items);
      return;
    }
    void (async () => {
      const unique = Array.from(new Set(sources));
      const resolved = new Map<DynamicSource, MenuItemDef[]>();
      await Promise.all(
        unique.map(async (s) => {
          try { resolved.set(s, await loadDynamic(s)); }
          catch { resolved.set(s, []); }
        }),
      );
      if (cancelled) return;
      const expand = (list: MenuItemDef[]): MenuItemDef[] => {
        const out: MenuItemDef[] = [];
        for (const it of list) {
          if (it.kind === "dynamic") {
            const got = resolved.get(it.source) ?? [];
            out.push(...got);
          } else if (it.kind === "sub") {
            out.push({ ...it, children: expand(it.children) });
          } else {
            out.push(it);
          }
        }
        return out;
      };
      setExpanded(expand(items));
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trigger, items]);

  return expanded;
}

// ============= Titlebar =============
export interface TabDef {
  ic: string;
  color: string;
  label: string;
}

export interface TitlebarProps {
  tabs: TabDef[];
  activeTab: number;
  onSelectTab: (i: number) => void;
  onCloseTab: (i: number) => void;
  onNewTab: () => void;
  onTabContext?: (e: React.MouseEvent, tabIndex: number) => void;
}

export function Titlebar({ tabs, activeTab, onSelectTab, onCloseTab, onNewTab, onTabContext }: TitlebarProps) {
  return (
    <div className="titlebar" data-tauri-drag-region>
      <div className="traffic">
        <span className="dot close" title="close" onClick={() => { void winClose(); }}></span>
        <span className="dot minimize" title="minimize" onClick={() => { void winMinimize(); }}></span>
        <span className="dot maximize" title="maximize" onClick={() => { void winToggleMaximize(); }}></span>
      </div>
      <div className="tabs" data-tauri-drag-region>
        {tabs.map((t, i) => (
          <div
            key={i}
            className={"tab" + (i === activeTab ? " active" : "")}
            onClick={() => onSelectTab(i)}
            onContextMenu={(e) => {
              if (!onTabContext) return;
              e.preventDefault();
              e.stopPropagation();
              onTabContext(e, i);
            }}
          >
            <span className="ico" style={{color: t.color}}>{t.ic}</span>
            <span className="label">{t.label}</span>
            <span className="close" onClick={(e) => { e.stopPropagation(); onCloseTab(i); }}></span>
          </div>
        ))}
        <div className="tab-actions">
          <button className="tab-btn" title="New tab" onClick={onNewTab}>+</button>
        </div>
      </div>
    </div>
  );
}

// ============= Menu bar + dropdown =============

interface MenuItemProps {
  item: MenuItemDef;
  onAction?: (label: string) => void;
  onPayload?: (payload: DynamicPayload) => void;
  onSubHover?: (sub: MenuItemDef | null) => void;
  subOpen?: boolean;
  parentLabel?: string;
}

/** Toggle-state fed into the menubar so resolveChecked can reflect live UI
 *  state (tweaks + sidebar/status-bar visibility) rather than stale static
 *  `check: true` hints. `undefined` means "use the static hint on the item". */
export interface MenuToggleState {
  tweaks?: TweakState;
  sidebarVisible?: boolean;
  statusBarVisible?: boolean;
  inspectorVisible?: boolean;
}

const MenuToggleContext = React.createContext<MenuToggleState>({});

/** Resolve whether this menu item should render a ✓ mark. Checks live toggle
 *  state first (tweaks/sidebar/status-bar), then falls back to the submenu
 *  selection stored in localStorage for Display Mode / Layout, then the
 *  static `check: true` flag on the data.ts entry. */
function resolveChecked(item: MenuItemDef, toggles: MenuToggleState, parentLabel?: string): boolean {
  if (item.kind !== "item") return false;
  if (parentLabel === "Display Mode") {
    const stored = localStorage.getItem("glasshouse.displayMode") ?? "Details (rows)";
    return item.label === stored;
  }
  if (parentLabel === "Layout") {
    const stored = localStorage.getItem("glasshouse.layout") ?? "Tree + Pane + Inspector";
    return item.label === stored;
  }
  const tw = toggles.tweaks;
  switch (item.label) {
    case "Show Hidden Files":
    case "Show Hidden":
      return !!tw?.hidden;
    case "Show File Extensions":
      return !!tw?.showExtensions;
    case "Show Git Gutters":
      return !!tw?.showGitGutters;
    case "Show Ignored (.gitignore)":
      return !!tw?.showIgnored;
    case "Folders First":
      return !!tw?.foldersFirst;
    case "Show Checksums":
      return !!tw?.showChecksums;
    case "Sidebar":
      return toggles.sidebarVisible !== undefined ? toggles.sidebarVisible : !!item.check;
    case "Status Bar":
      return toggles.statusBarVisible !== undefined ? toggles.statusBarVisible : !!item.check;
    case "Inspector":
      return toggles.inspectorVisible !== undefined ? toggles.inspectorVisible : !!item.check;
  }
  return !!item.check;
}

function MenuItem({ item, onAction, onPayload, onSubHover, subOpen, parentLabel }: MenuItemProps) {
  const toggles = React.useContext(MenuToggleContext);
  if (item.kind === "sep") return <div className="sep" />;
  if (item.kind === "grouplabel") return <div className="group-label">{item.label}</div>;
  if (item.kind === "dynamic") {
    // Should have been expanded upstream; render an empty sentinel if not.
    return null;
  }
  const isSub = item.kind === "sub";
  const danger = item.kind === "item" && item.danger;
  const check = resolveChecked(item, toggles, parentLabel);
  const ic = item.kind === "item" || item.kind === "sub" ? item.ic : undefined;
  const kb = item.kind === "item" ? item.kb : undefined;
  const payload = item.kind === "item" ? item.payload : undefined;
  return (
    <div
      className={"mi" + (danger ? " danger" : "") + (subOpen ? " hover" : "")}
      onMouseEnter={() => onSubHover && onSubHover(isSub ? item : null)}
      onClick={() => {
        if (isSub) return;
        if (payload && onPayload) onPayload(payload);
        else if (onAction) {
          // `action` field lets a dynamic entry display one label ("main")
          // while dispatching another ("git-branch:main") so branch click
          // handlers can identify the target without parsing cosmetics.
          const dispatch = item.kind === "item" && item.action ? item.action : item.label;
          onAction(dispatch);
        }
      }}
    >
      <span className="ic">{check ? "✓" : ic || ""}</span>
      <span>{item.label}</span>
      <span className="kb">{kb || ""}</span>
      <span className="chev">{isSub ? "›" : ""}</span>
      {isSub && subOpen && (
        <SubDropdown item={item} onAction={onAction} onPayload={onPayload} />
      )}
    </div>
  );
}

/** Dropdown for a submenu — expands any `dynamic` children at open time. */
function SubDropdown({
  item,
  onAction,
  onPayload,
}: {
  item: Extract<MenuItemDef, { kind: "sub" }>;
  onAction?: (label: string) => void;
  onPayload?: (payload: DynamicPayload) => void;
}) {
  const children = useExpandedItems(item.children, item);
  return (
    <div className="dropdown" style={{left: "calc(100% + 2px)", top: "-4px", minWidth: 240}}>
      {children.map((c, i) => (
        <MenuItem key={i} item={c} onAction={onAction} onPayload={onPayload} parentLabel={item.label} />
      ))}
    </div>
  );
}

export interface MenubarProps {
  onOpenPalette: () => void;
  onCommand: (label: string) => void;
  onPayload?: (payload: DynamicPayload) => void;
  toggles?: MenuToggleState;
}

function MenubarDropdown({
  items,
  subHover,
  setSubHover,
  onAction,
  onPayload,
}: {
  items: MenuItemDef[];
  subHover: MenuItemDef | null;
  setSubHover: (s: MenuItemDef | null) => void;
  onAction: (label: string) => void;
  onPayload?: (payload: DynamicPayload) => void;
}) {
  const expanded = useExpandedItems(items, items);
  return (
    <div className="dropdown" onClick={(e) => e.stopPropagation()}>
      {expanded.map((it, i) => (
        <MenuItem
          key={i}
          item={it}
          subOpen={subHover !== null && "label" in subHover && "label" in it && subHover.label === (it as { label: string }).label}
          onSubHover={(s) => setSubHover(s)}
          onAction={onAction}
          onPayload={onPayload}
        />
      ))}
    </div>
  );
}

export function Menubar({ onOpenPalette, onCommand, onPayload, toggles }: MenubarProps) {
  const [open, setOpen] = useState<string | null>(null);
  const [subHover, setSubHover] = useState<MenuItemDef | null>(null);
  const [version, setVersion] = useState<string>("");
  const ref = useRef<HTMLDivElement>(null);
  const ctxValue = toggles ?? {};

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) { setOpen(null); setSubHover(null); }
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const v = await getVersion();
        if (!cancelled) setVersion(v);
      } catch {
        // tauri unavailable (e.g. vite dev without tauri host)
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const keys = Object.keys(MENUS);
  return (
    <MenuToggleContext.Provider value={ctxValue}>
      <div className="menubar" ref={ref}>
        {keys.map(k => (
          <div
            key={k}
            className={"menubar-item" + (open === k ? " open" : "")}
            onClick={() => setOpen(open === k ? null : k)}
            onMouseEnter={() => open && setOpen(k)}
          >
            <span><span className="u">{k[0]}</span>{k.slice(1)}</span>
            {open === k && (
              <MenubarDropdown
                items={MENUS[k]}
                subHover={subHover}
                setSubHover={setSubHover}
                onAction={(label) => { setOpen(null); onCommand(label); }}
                onPayload={(p) => { setOpen(null); onPayload?.(p); }}
              />
            )}
          </div>
        ))}
        <div className="menubar-right">
          <span onClick={onOpenPalette} style={{cursor:"pointer"}}>
            <span className="kbd">Ctrl</span>&nbsp;<span className="kbd">P</span>&nbsp;palette
          </span>
          {version && <span>· glasshouse v{version}</span>}
        </div>
      </div>
    </MenuToggleContext.Provider>
  );
}

// ============= Toolbar / breadcrumb =============
export interface ToolbarProps {
  path: string;
  gitInfo: GitInfo | null;
  canBack: boolean;
  canForward: boolean;
  onBack: () => void;
  onForward: () => void;
  onUp: () => void;
  onRefresh: () => void;
  onGoTo: (path: string) => void;
  onSearchFocus?: () => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  searchInputRef?: React.RefObject<HTMLInputElement>;
  showHidden: boolean;
  onToggleHidden: () => void;
  showInspector: boolean;
  onToggleInspector: () => void;
  onCrumbContext?: (e: React.MouseEvent, path: string) => void;
  tagFilter?: string | null;
  onClearTagFilter?: () => void;
}

interface Crumb {
  label: string;
  path: string;
}

function splitBreadcrumb(path: string): Crumb[] {
  if (!path) return [];
  const isWin = /^[A-Za-z]:/.test(path) || path.includes("\\");
  const sep = isWin ? "\\" : "/";
  if (isWin) {
    const normalized = path.replace(/\//g, "\\");
    const parts = normalized.split("\\").filter(Boolean);
    const out: Crumb[] = [];
    let acc = "";
    parts.forEach((p, i) => {
      if (i === 0 && /^[A-Za-z]:$/.test(p)) {
        acc = p + "\\";
        out.push({ label: p, path: acc });
      } else {
        acc = acc.endsWith(sep) ? acc + p : acc + sep + p;
        out.push({ label: p, path: acc });
      }
    });
    return out;
  }
  const parts = path.split("/").filter(Boolean);
  const out: Crumb[] = [];
  let acc = "";
  parts.forEach(p => {
    acc = acc + "/" + p;
    out.push({ label: p, path: acc });
  });
  return out;
}

export function Toolbar({ path, gitInfo, canBack, canForward, onBack, onForward, onUp, onRefresh, onGoTo, onSearchFocus, searchQuery, onSearchChange, searchInputRef, showHidden, onToggleHidden, showInspector, onToggleInspector, onCrumbContext, tagFilter, onClearTagFilter }: ToolbarProps) {
  const parts = splitBreadcrumb(path);
  return (
    <div className="toolbar">
      <div className="nav-btns">
        <button className="nav-btn" title="Back (Alt+←)" onClick={onBack} disabled={!canBack}>←</button>
        <button className="nav-btn" title="Forward (Alt+→)" onClick={onForward} disabled={!canForward}>→</button>
        <button className="nav-btn" title="Up (Alt+↑)" onClick={onUp}>↑</button>
        <button className="nav-btn" title="Refresh (F5)" onClick={onRefresh}>↻</button>
      </div>
      <div className="breadcrumb">
        {parts.map((p, i) => (
          <React.Fragment key={i}>
            <span
              className={"crumb" + (i === parts.length - 1 ? " last" : "")}
              onClick={() => onGoTo(p.path)}
              onContextMenu={(e) => {
                if (!onCrumbContext) return;
                e.preventDefault();
                e.stopPropagation();
                onCrumbContext(e, p.path);
              }}
              style={{cursor:"pointer"}}
            >{p.label}</span>
            {i < parts.length - 1 && <span className="sep">/</span>}
          </React.Fragment>
        ))}
        {gitInfo && (
          <span className="git-branch">
            ⎇ {gitInfo.branch}
            {gitInfo.ahead > 0 && <> ↑{gitInfo.ahead}</>}
            {gitInfo.behind > 0 && <> ↓{gitInfo.behind}</>}
            {gitInfo.dirty > 0 && <> ●{gitInfo.dirty}</>}
          </span>
        )}
        {tagFilter && (
          <span
            className="tag-chip"
            onClick={onClearTagFilter}
            title="clear tag filter"
            style={{
              marginLeft: 8,
              padding: "2px 8px",
              borderRadius: 10,
              background: "var(--bg-2)",
              color: "var(--fg-1)",
              border: "1px solid var(--fg-3)",
              cursor: "pointer",
              fontSize: 11,
              whiteSpace: "nowrap",
            }}
          >Tag: {tagFilter} <span style={{color:"var(--fg-3)", marginLeft:4}}>✕</span></span>
        )}
      </div>
      <div className="search" onClick={onSearchFocus}>
        <span style={{color: "var(--fg-3)"}}>⌕</span>
        <input
          ref={searchInputRef}
          placeholder="find in current dir…  (fuzzy)"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              onSearchChange("");
              (e.currentTarget as HTMLInputElement).blur();
            }
          }}
        />
        <span className="kb">/</span>
      </div>
      <div className="tool-group">
        <button
          className={"nav-btn" + (showHidden ? " active" : "")}
          title="Toggle hidden (Ctrl+H)"
          onClick={onToggleHidden}
          aria-pressed={showHidden}
        >·h</button>
        <button
          className={"nav-btn" + (showInspector ? " active" : "")}
          title="Toggle inspector"
          onClick={onToggleInspector}
          aria-pressed={showInspector}
        >◨</button>
      </div>
    </div>
  );
}

// ============= Sidebar =============
interface TreeNodeState {
  path: string;
  name: string;
  depth: number;
  open: boolean;
  hasChildren: boolean;
  // children are stored in a sibling map keyed by path
}

function pathBasename(p: string): string {
  const trimmed = p.replace(/[\\/]+$/, "");
  const idx = Math.max(trimmed.lastIndexOf("\\"), trimmed.lastIndexOf("/"));
  if (idx < 0) return trimmed || p;
  return trimmed.slice(idx + 1) || trimmed;
}

function formatSidebarBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0B";
  const units = ["B", "K", "M", "G", "T", "P"];
  let v = n;
  let ui = 0;
  while (v >= 1024 && ui < units.length - 1) { v /= 1024; ui++; }
  if (v >= 100) return `${v.toFixed(0)}${units[ui]}`;
  if (v >= 10) return `${v.toFixed(1)}${units[ui]}`;
  return `${v.toFixed(1)}${units[ui]}`;
}

const SEED_TAGS: { color: string; label: string }[] = [
  { color: "var(--magenta)", label: "project" },
  { color: "var(--green)",   label: "school"  },
  { color: "var(--red)",     label: "secret"  },
  { color: "var(--yellow)",  label: "review"  },
  { color: "var(--cyan)",    label: "archive" },
];

const TAG_COLOR_MAP: Record<string, string> = Object.fromEntries(
  SEED_TAGS.map(t => [t.label, t.color]),
);

export interface SavedRemote {
  label: string;
  host: string;
  path: string;
}

export type SidebarRowKind = "pinned" | "tree-folder" | "tree-file" | "drive" | "remote" | "wsl";

export interface SidebarProps {
  activePath: string;
  onGoTo: (path: string) => void;
  onRowContext?: (e: React.MouseEvent, path: string, kind: SidebarRowKind) => void;
  pins: string[];
  onAddPin: () => void;
  tags: Record<string, string[]>;
  onTagFilter?: (tag: string) => void;
  activeTagFilter?: string | null;
  savedRemotes: SavedRemote[];
  onOpenConnectDialog: () => void;
  onRemoteClick: (r: SavedRemote) => void;
  sidebarRootRef?: React.Ref<HTMLElement>;
  onActivate?: () => void;
  /** Requests the host to show the themed FolderPickerDialog. The current
   *  tree root is forwarded as `initialPath` and the picked path is handed
   *  back so Sidebar can swap its own rootPath state. Keeps the native Tauri
   *  dialog off-screen. */
  onPickTreeRoot?: (initialPath: string | undefined, onPicked: (p: string) => void) => void;
}

interface TreePrefs {
  showHidden: boolean;
  showFiles: boolean;
  followActive: boolean;
}

const TREE_PREFS_KEY = "glasshouse.tree.prefs";
const TREE_PREFS_DEFAULT: TreePrefs = { showHidden: false, showFiles: false, followActive: false };

function loadTreePrefs(): TreePrefs {
  try {
    const raw = localStorage.getItem(TREE_PREFS_KEY);
    if (!raw) return TREE_PREFS_DEFAULT;
    const parsed = JSON.parse(raw) as Partial<TreePrefs>;
    return { ...TREE_PREFS_DEFAULT, ...parsed };
  } catch { return TREE_PREFS_DEFAULT; }
}

type SbGroupKey = "PINNED" | "TREE" | "TAGS" | "DEVICES" | "REMOTE";
const SB_GROUP_DEFAULTS: SbGroupKey[] = ["PINNED", "TREE", "TAGS", "DEVICES", "REMOTE"];
const SB_COLLAPSED_KEY = "glasshouse.sb.collapsed";
const SB_ORDER_KEY = "glasshouse.sb.order";

function loadSbCollapsed(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(SB_COLLAPSED_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    return (parsed && typeof parsed === "object") ? (parsed as Record<string, boolean>) : {};
  } catch { return {}; }
}

function loadSbOrder(): SbGroupKey[] {
  try {
    const raw = localStorage.getItem(SB_ORDER_KEY);
    if (!raw) return SB_GROUP_DEFAULTS;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return SB_GROUP_DEFAULTS;
    const seen = new Set<SbGroupKey>();
    const out: SbGroupKey[] = [];
    for (const entry of parsed) {
      if (typeof entry !== "string") continue;
      const key = entry as SbGroupKey;
      if (!SB_GROUP_DEFAULTS.includes(key)) continue;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(key);
    }
    // Append any groups missing from storage so the user always sees every
    // section; protects against older saved orders missing a newer group.
    for (const key of SB_GROUP_DEFAULTS) if (!seen.has(key)) out.push(key);
    return out;
  } catch { return SB_GROUP_DEFAULTS; }
}

export function Sidebar({ activePath, onGoTo, onRowContext, pins, onAddPin, tags, onTagFilter, activeTagFilter, savedRemotes, onOpenConnectDialog, onRemoteClick, sidebarRootRef, onActivate, onPickTreeRoot }: SidebarProps) {
  const sidebarRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!sidebarRootRef) return;
    if (typeof sidebarRootRef === "function") sidebarRootRef(sidebarRef.current);
    else (sidebarRootRef as React.MutableRefObject<HTMLElement | null>).current = sidebarRef.current;
  });
  // Keyboard-navigation cursor: which visible row is selected. Mouse hover and
  // this cursor coexist — mouse never overwrites `selectedIdx`, and keyboard
  // changes don't touch hover state. -1 means "no key-selected row".
  const [selectedIdx, setSelectedIdx] = useState<number>(-1);
  const [home, setHome] = useState<string | null>(null);
  const [driveList, setDriveList] = useState<Drive[]>([]);
  const [wslDistros, setWslDistros] = useState<WslDistro[]>([]);

  // Tree: visible flattened list + map of children by path
  const [rootPath, setRootPath] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [children, setChildren] = useState<Record<string, FileEntry[]>>({});
  const [treePrefs, setTreePrefs] = useState<TreePrefs>(() => loadTreePrefs());
  const [treeMenuOpen, setTreeMenuOpen] = useState(false);
  const treeTitleRef = useRef<HTMLDivElement>(null);

  // Sidebar group collapse + reorder state. Keys are SbGroupKey ("PINNED", …)
  // so the render loop can iterate `sbOrder` and look up the matching render
  // function. Both pieces persist to localStorage on change.
  const [sbCollapsed, setSbCollapsed] = useState<Record<string, boolean>>(() => loadSbCollapsed());
  const [sbOrder, setSbOrder] = useState<SbGroupKey[]>(() => loadSbOrder());
  const [sbDragging, setSbDragging] = useState<SbGroupKey | null>(null);
  const [sbDropIdx, setSbDropIdx] = useState<number | null>(null);

  useEffect(() => {
    try { localStorage.setItem(SB_COLLAPSED_KEY, JSON.stringify(sbCollapsed)); } catch { /* quota */ }
  }, [sbCollapsed]);
  useEffect(() => {
    try { localStorage.setItem(SB_ORDER_KEY, JSON.stringify(sbOrder)); } catch { /* quota */ }
  }, [sbOrder]);

  const toggleGroupCollapse = (key: SbGroupKey) => {
    setSbCollapsed(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const moveGroup = (key: SbGroupKey, delta: number) => {
    setSbOrder(prev => {
      const idx = prev.indexOf(key);
      if (idx < 0) return prev;
      const next = idx + delta;
      if (next < 0 || next >= prev.length) return prev;
      const copy = prev.slice();
      copy.splice(idx, 1);
      copy.splice(next, 0, key);
      return copy;
    });
  };

  useEffect(() => {
    try { localStorage.setItem(TREE_PREFS_KEY, JSON.stringify(treePrefs)); } catch { /* quota */ }
  }, [treePrefs]);

  const filterKids = (kids: FileEntry[]): FileEntry[] => {
    return kids.filter(k => {
      if (!treePrefs.showHidden && k.hidden) return false;
      if (!treePrefs.showFiles && k.kind !== "folder") return false;
      return true;
    });
  };

  useEffect(() => {
    void (async () => {
      const h = await apiHomeDir();
      setHome(h);
      setDriveList(await apiDrives());
      try { setWslDistros(await listWslDistros()); } catch { /* not on Windows */ }
      if (h) {
        setRootPath(h);
        try {
          const kids = await listDir(h, treePrefs.showHidden);
          setChildren(prev => ({ ...prev, [h]: filterKids(kids) }));
          setExpanded(prev => ({ ...prev, [h]: true }));
        } catch { /* unreadable */ }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-fetch / re-filter every already-loaded path when prefs change so the
  // tree reflects Show Hidden / Show Files immediately.
  useEffect(() => {
    const paths = Object.keys(children);
    if (paths.length === 0) return;
    void (async () => {
      const updates: Record<string, FileEntry[]> = {};
      for (const p of paths) {
        try {
          const kids = await listDir(p, treePrefs.showHidden);
          updates[p] = filterKids(kids);
        } catch { /* unreadable */ }
      }
      setChildren(prev => ({ ...prev, ...updates }));
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [treePrefs.showHidden, treePrefs.showFiles]);

  // Follow active tab: ensure every ancestor of activePath is expanded.
  useEffect(() => {
    if (!treePrefs.followActive || !rootPath || !activePath) return;
    if (!activePath.startsWith(rootPath)) return;
    void (async () => {
      const sep = rootPath.includes("\\") ? "\\" : "/";
      const rel = activePath.slice(rootPath.length).replace(/^[\\/]+/, "");
      const parts = rel.split(/[\\/]/).filter(Boolean);
      let cur = rootPath;
      for (let i = 0; i < parts.length - 1; i++) {
        cur = cur.endsWith(sep) ? cur + parts[i] : cur + sep + parts[i];
        if (!children[cur]) {
          try {
            const kids = await listDir(cur, treePrefs.showHidden);
            setChildren(prev => ({ ...prev, [cur]: filterKids(kids) }));
          } catch { break; }
        }
        setExpanded(prev => ({ ...prev, [cur]: true }));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [treePrefs.followActive, activePath, rootPath]);

  const toggleNode = async (path: string) => {
    const isOpen = expanded[path];
    if (isOpen) {
      setExpanded(prev => ({ ...prev, [path]: false }));
      return;
    }
    if (!children[path]) {
      try {
        const kids = await listDir(path, treePrefs.showHidden);
        setChildren(prev => ({ ...prev, [path]: filterKids(kids) }));
      } catch { return; }
    }
    setExpanded(prev => ({ ...prev, [path]: true }));
  };

  const collapseAll = async () => {
    if (!rootPath) return;
    // Rebuild the expanded map from scratch with only the root marked open so
    // no stale descendant entry can keep its own subtree visible. If the root
    // hasn't been listed yet (e.g. Collapse all is hit while still loading)
    // pull its children first so the tree doesn't flash empty.
    if (!children[rootPath]) {
      try {
        const kids = await listDir(rootPath, treePrefs.showHidden);
        setChildren(prev => ({ ...prev, [rootPath]: filterKids(kids) }));
      } catch { /* unreadable — tree will show just the root row */ }
    }
    setExpanded({ [rootPath]: true });
  };

  const refreshTree = async () => {
    const paths = Object.keys(children);
    const updates: Record<string, FileEntry[]> = {};
    for (const p of paths) {
      try {
        const kids = await listDir(p, treePrefs.showHidden);
        updates[p] = filterKids(kids);
      } catch { /* unreadable */ }
    }
    setChildren(updates);
  };

  const applyNewRoot = async (picked: string) => {
    setRootPath(picked);
    setExpanded({ [picked]: true });
    try {
      const kids = await listDir(picked, treePrefs.showHidden);
      setChildren({ [picked]: filterKids(kids) });
    } catch {
      setChildren({ [picked]: [] });
    }
  };

  const changeRoot = async () => {
    // Prefer the themed in-app folder picker when the host wires one up; it
    // matches the rest of the palette chrome. Without a handler we fall back
    // to the native Tauri dialog so the control still works in standalone
    // test harnesses.
    if (onPickTreeRoot) {
      onPickTreeRoot(rootPath ?? undefined, (picked) => { void applyNewRoot(picked); });
      return;
    }
    const picked = await pickDirectory(rootPath ?? undefined);
    if (!picked) return;
    void applyNewRoot(picked);
  };

  // Close the tree menu when clicking outside.
  useEffect(() => {
    if (!treeMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!treeTitleRef.current) return;
      if (!treeTitleRef.current.contains(e.target as Node)) setTreeMenuOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [treeMenuOpen]);

  const treeRows = useMemo(() => {
    const out: { path: string; name: string; depth: number; open: boolean; kind: "folder" | "file" }[] = [];
    if (!rootPath) return out;
    const walk = (p: string, depth: number, kind: "folder" | "file") => {
      const name = depth === 0 ? pathBasename(p) || p : pathBasename(p);
      const open = !!expanded[p];
      out.push({ path: p, name, depth, open, kind });
      if (open && kind === "folder") {
        const kids = children[p] ?? [];
        for (const k of kids) walk(k.path, depth + 1, k.kind === "folder" ? "folder" : "file");
      }
    };
    walk(rootPath, 0, "folder");
    return out;
  }, [rootPath, expanded, children]);

  const tagCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const labels of Object.values(tags)) {
      if (!Array.isArray(labels)) continue;
      for (const label of labels) {
        if (!label) continue;
        counts[label] = (counts[label] ?? 0) + 1;
      }
    }
    const seedLabels = new Set(SEED_TAGS.map(s => s.label));
    const rows: { label: string; color: string; count: number }[] = [];
    for (const s of SEED_TAGS) {
      rows.push({ label: s.label, color: s.color, count: counts[s.label] ?? 0 });
    }
    const userLabels = Object.keys(counts).filter(k => !seedLabels.has(k)).sort();
    for (const k of userLabels) {
      rows.push({ label: k, color: TAG_COLOR_MAP[k] ?? "var(--fg-2)", count: counts[k] });
    }
    return rows;
  }, [tags]);

  // Flat list of keyboard-navigable rows in render order. Respects the
  // user's group order and skips collapsed groups so keyboard nav stays in
  // sync with what is actually on-screen. Tree rows keep their path+depth
  // so ← / → can collapse/expand / hop parent.
  type SbNavRow =
    | { kind: "pin"; path: string }
    | { kind: "tree"; path: string; depth: number; open: boolean; isFolder: boolean; hasChildren: boolean }
    | { kind: "tag"; label: string }
    | { kind: "drive"; path: string }
    | { kind: "wsl"; path: string }
    | { kind: "remote"; idx: number };
  const navRows: SbNavRow[] = useMemo(() => {
    const out: SbNavRow[] = [];
    for (const key of sbOrder) {
      if (sbCollapsed[key]) continue;
      switch (key) {
        case "PINNED":
          for (const p of pins) out.push({ kind: "pin", path: p });
          break;
        case "TREE":
          for (const n of treeRows) {
            const has = (children[n.path]?.length ?? 0) > 0 || !(n.path in children);
            out.push({ kind: "tree", path: n.path, depth: n.depth, open: n.open, isFolder: n.kind === "folder", hasChildren: has });
          }
          break;
        case "TAGS":
          for (const t of tagCounts) out.push({ kind: "tag", label: t.label });
          break;
        case "DEVICES":
          for (const d of driveList) out.push({ kind: "drive", path: d.letter });
          for (const w of wslDistros) out.push({ kind: "wsl", path: w.path });
          break;
        case "REMOTE":
          for (let i = 0; i < savedRemotes.length; i++) out.push({ kind: "remote", idx: i });
          break;
      }
    }
    return out;
  }, [sbOrder, sbCollapsed, pins, treeRows, children, tagCounts, driveList, wslDistros, savedRemotes]);

  // Scroll the keyboard-selected row into view after each change.
  useEffect(() => {
    if (selectedIdx < 0) return;
    const root = sidebarRef.current;
    if (!root) return;
    const el = root.querySelector<HTMLElement>(`[data-sb-nav-idx="${selectedIdx}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedIdx]);

  const activateRow = (row: SbNavRow) => {
    if (row.kind === "pin" || row.kind === "drive" || row.kind === "wsl") onGoTo(row.path);
    else if (row.kind === "tree") onGoTo(row.path);
    else if (row.kind === "tag") onTagFilter?.(row.label);
    else if (row.kind === "remote") onRemoteClick(savedRemotes[row.idx]);
  };

  const onSidebarKeyDown = (e: React.KeyboardEvent) => {
    // Ignore events that bubbled up from inside the tree-options popup, the
    // section title (which owns Enter-to-toggle for collapsible groups from
    // a sibling task), or any focused form input inside the sidebar.
    const target = e.target as HTMLElement | null;
    if (target) {
      if (target.closest(".sb-title")) return;
      const tag = target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (target.isContentEditable) return;
    }
    if (navRows.length === 0) return;
    const key = e.key;
    if (key !== "ArrowUp" && key !== "ArrowDown" && key !== "ArrowLeft" && key !== "ArrowRight" && key !== "Enter" && key !== "Home" && key !== "End") {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    // React's synthetic stopPropagation doesn't block App.tsx's window-level
    // native keydown listener. Without this, Enter here would also fire Open
    // on the file pane.
    e.nativeEvent.stopImmediatePropagation();
    const curIdx = selectedIdx < 0 ? 0 : Math.max(0, Math.min(selectedIdx, navRows.length - 1));
    if (key === "ArrowDown") {
      setSelectedIdx(Math.min(navRows.length - 1, curIdx + 1));
      return;
    }
    if (key === "ArrowUp") {
      setSelectedIdx(Math.max(0, curIdx - 1));
      return;
    }
    if (key === "Home") { setSelectedIdx(0); return; }
    if (key === "End") { setSelectedIdx(navRows.length - 1); return; }
    const row = navRows[curIdx];
    if (!row) return;
    if (key === "Enter") {
      activateRow(row);
      return;
    }
    if (row.kind !== "tree") return;
    if (key === "ArrowRight") {
      if (row.isFolder && !row.open && row.hasChildren) {
        void toggleNode(row.path);
      } else if (row.open) {
        // Hop to first child (depth+1) below this row.
        for (let i = curIdx + 1; i < navRows.length; i++) {
          const r = navRows[i];
          if (r.kind !== "tree") break;
          if (r.depth <= row.depth) break;
          if (r.depth === row.depth + 1) { setSelectedIdx(i); return; }
        }
      }
      return;
    }
    if (key === "ArrowLeft") {
      if (row.isFolder && row.open) {
        void toggleNode(row.path);
      } else if (row.depth > 0) {
        // Hop to parent: nearest preceding tree row with depth - 1.
        for (let i = curIdx - 1; i >= 0; i--) {
          const r = navRows[i];
          if (r.kind !== "tree") break;
          if (r.depth === row.depth - 1) { setSelectedIdx(i); return; }
        }
      }
      return;
    }
  };

  // Per-group nav-row starting indices. Collapsed groups contribute zero
  // rows, so the offsets depend on both `sbOrder` and `sbCollapsed`. The
  // render loop consults `navStart[key]` to stamp `data-sb-nav-idx` values
  // that line up with `navRows` for keyboard nav.
  const navStart = useMemo(() => {
    const sizeOf = (key: SbGroupKey): number => {
      if (sbCollapsed[key]) return 0;
      switch (key) {
        case "PINNED":  return pins.length;
        case "TREE":    return treeRows.length;
        case "TAGS":    return tagCounts.length;
        case "DEVICES": return driveList.length + wslDistros.length;
        case "REMOTE":  return savedRemotes.length;
      }
    };
    const out: Record<SbGroupKey, number> = { PINNED: 0, TREE: 0, TAGS: 0, DEVICES: 0, REMOTE: 0 };
    let cursor = 0;
    for (const key of sbOrder) {
      out[key] = cursor;
      cursor += sizeOf(key);
    }
    return out;
  }, [sbOrder, sbCollapsed, pins, treeRows, tagCounts, driveList, wslDistros, savedRemotes]);

  // Pointer-based drag: pressing an `.sb-title` starts tracking; while
  // dragging we compute the drop index from the mouse's y-position relative
  // to each title bar's rect. Release commits the reorder.
  const onTitlePointerDown = (key: SbGroupKey) => (e: React.PointerEvent) => {
    // Only left button, and ignore clicks on buttons (+/⋯) inside the title.
    if (e.button !== 0) return;
    const tgt = e.target as HTMLElement;
    if (tgt.closest("[data-sb-title-button]")) return;
    const startY = e.clientY;
    const startX = e.clientX;
    let dragging = false;

    const computeDropIdx = (clientY: number): number => {
      const titles = sidebarRef.current?.querySelectorAll<HTMLElement>("[data-sb-group-title]");
      if (!titles || titles.length === 0) return 0;
      for (let i = 0; i < titles.length; i++) {
        const rect = titles[i].getBoundingClientRect();
        if (clientY < rect.top + rect.height / 2) return i;
      }
      return titles.length;
    };

    const onMove = (me: PointerEvent) => {
      if (!dragging) {
        if (Math.abs(me.clientY - startY) < 4 && Math.abs(me.clientX - startX) < 4) return;
        dragging = true;
        setSbDragging(key);
      }
      setSbDropIdx(computeDropIdx(me.clientY));
    };
    const onUp = (me: PointerEvent) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      if (dragging) {
        const dropIdx = computeDropIdx(me.clientY);
        setSbOrder(prev => {
          const idx = prev.indexOf(key);
          if (idx < 0) return prev;
          // Dropping onto own slot is a no-op; splice at the adjusted index
          // so "drop above self" and "drop below self" behave consistently.
          const target = dropIdx > idx ? dropIdx - 1 : dropIdx;
          if (target === idx) return prev;
          const copy = prev.slice();
          copy.splice(idx, 1);
          copy.splice(target, 0, key);
          return copy;
        });
      }
      setSbDragging(null);
      setSbDropIdx(null);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const onTitleKeyDown = (key: SbGroupKey) => (e: React.KeyboardEvent) => {
    // Enter toggles collapse; Alt+Up/Down moves the group.
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      toggleGroupCollapse(key);
      return;
    }
    if (e.altKey && e.key === "ArrowUp") {
      e.preventDefault();
      e.stopPropagation();
      moveGroup(key, -1);
      return;
    }
    if (e.altKey && e.key === "ArrowDown") {
      e.preventDefault();
      e.stopPropagation();
      moveGroup(key, 1);
      return;
    }
  };

  const renderChevron = (key: SbGroupKey) => (
    <span style={{ display: "inline-block", width: 10, textAlign: "center", color: "var(--fg-3)" }}>
      {sbCollapsed[key] ? "▸" : "▾"}
    </span>
  );

  const renderTitle = (key: SbGroupKey, label: string, trailing?: React.ReactNode, titleRef?: React.RefObject<HTMLDivElement>) => (
    <div
      className="sb-title"
      data-sb-group-title={key}
      ref={titleRef}
      tabIndex={0}
      role="button"
      aria-expanded={!sbCollapsed[key]}
      style={{ position: "relative", cursor: "pointer", userSelect: "none" }}
      onClick={() => toggleGroupCollapse(key)}
      onPointerDown={onTitlePointerDown(key)}
      onKeyDown={onTitleKeyDown(key)}
    >
      <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
        {renderChevron(key)}
        <span>{label}</span>
      </span>
      {trailing}
    </div>
  );

  const renderPinned = () => (
    <div
      key="PINNED"
      className={"sb-group" + (sbDragging === "PINNED" ? " sb-group-dragging" : "")}
    >
      {renderTitle("PINNED", "PINNED", (
        <span
          data-sb-title-button
          style={{color:"var(--fg-3)", cursor:"pointer"}}
          title="Pin current folder"
          onClick={(e) => { e.stopPropagation(); onAddPin(); }}
        >+</span>
      ))}
      {!sbCollapsed["PINNED"] && (<>
        {pins.length === 0 && (
          <div className="sb-item" style={{color:"var(--fg-3)", cursor:"default"}}>
            <span className="ic">·</span>
            <span style={{fontStyle:"italic"}}>no pins yet</span>
            <span className="badge"></span>
          </div>
        )}
        {pins.map((p, i) => {
          const navIdx = navStart.PINNED + i;
          const isKb = selectedIdx === navIdx;
          return (
            <div key={i}
                 data-sidebar-drop-path={p}
                 data-sb-nav-idx={navIdx}
                 className={"sb-item" + (p === activePath ? " active" : "") + (isKb ? " sb-item-focused" : "")}
                 onClick={() => onGoTo(p)}
                 onContextMenu={(e) => {
                   if (!onRowContext) return;
                   e.preventDefault();
                   e.stopPropagation();
                   onRowContext(e, p, "pinned");
                 }}
                 title={p}
                 style={{cursor:"pointer"}}>
              <span className="ic">{home && p === home ? "󰋜" : ""}</span>
              <span style={{overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap"}}>{pathBasename(p) || p}</span>
              <span className="badge"></span>
            </div>
          );
        })}
      </>)}
    </div>
  );

  const renderTree = () => (
    <div
      key="TREE"
      className={"sb-group" + (sbDragging === "TREE" ? " sb-group-dragging" : "")}
    >
      {renderTitle("TREE", "TREE", (
        <>
          <span
            data-sb-title-button
            style={{ color: "var(--fg-3)", cursor: "pointer", userSelect: "none" }}
            title="Tree options"
            onClick={(e) => { e.stopPropagation(); setTreeMenuOpen(v => !v); }}
          >⋯</span>
          {treeMenuOpen && (
            <div
              data-sb-title-button
              onClick={(e) => e.stopPropagation()}
              style={{
                position: "absolute", top: "100%", right: 4, zIndex: 60,
                minWidth: 200, background: "var(--bg-1, #1a1b26)",
                border: "1px solid var(--fg-3)", borderRadius: 3,
                boxShadow: "0 4px 14px rgba(0,0,0,0.45)",
                padding: "4px 0", fontFamily: "var(--font-mono)",
                color: "var(--fg-1)", fontSize: 12,
              }}
            >
              {([
                { k: "showHidden" as const, label: "Show hidden" },
                { k: "showFiles" as const,  label: "Show files" },
                { k: "followActive" as const, label: "Follow active tab" },
              ]).map(row => (
                <div
                  key={row.k}
                  onClick={() => setTreePrefs(p => ({ ...p, [row.k]: !p[row.k] }))}
                  style={{ padding: "4px 10px", cursor: "pointer", display: "flex", alignItems: "center", gap: 8 }}
                >
                  <span style={{ width: 12, textAlign: "center" }}>{treePrefs[row.k] ? "✓" : ""}</span>
                  <span>{row.label}</span>
                </div>
              ))}
              <div style={{ borderTop: "1px solid var(--fg-3)", margin: "4px 0" }} />
              <div onClick={() => { void collapseAll(); setTreeMenuOpen(false); }}
                   style={{ padding: "4px 10px", cursor: "pointer", paddingLeft: 30 }}>Collapse all</div>
              <div onClick={() => { void refreshTree(); setTreeMenuOpen(false); }}
                   style={{ padding: "4px 10px", cursor: "pointer", paddingLeft: 30 }}>Refresh</div>
              <div onClick={() => { void changeRoot(); setTreeMenuOpen(false); }}
                   style={{ padding: "4px 10px", cursor: "pointer", paddingLeft: 30 }}>Change root…</div>
            </div>
          )}
        </>
      ), treeTitleRef)}
      {!sbCollapsed["TREE"] && treeRows.map((n, ti) => {
        const hasChildren = (children[n.path]?.length ?? 0) > 0 || !(n.path in children);
        const navIdx = navStart.TREE + ti;
        const isKb = selectedIdx === navIdx;
        return (
          <div key={n.path}
               data-sidebar-drop-path={n.kind === "folder" ? n.path : undefined}
               data-sb-nav-idx={navIdx}
               className={"tree-row" + (n.path === activePath ? " active" : "") + (isKb ? " sb-item-focused" : "")}
               style={{paddingLeft: 12 + n.depth * 10, cursor:"pointer"}}
               onClick={() => onGoTo(n.path)}
               onContextMenu={(e) => {
                 if (!onRowContext) return;
                 e.preventDefault();
                 e.stopPropagation();
                 onRowContext(e, n.path, n.kind === "folder" ? "tree-folder" : "tree-file");
               }}
               title={n.path}>
            <span
              className="chev"
              onClick={(e) => { e.stopPropagation(); void toggleNode(n.path); }}
              style={{cursor:"pointer"}}
            >{hasChildren ? (n.open ? "" : "") : ""}</span>
            <span className="ic">{n.open ? "" : ""}</span>
            <span style={{overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap"}}>{n.name}</span>
            <span className="git"></span>
          </div>
        );
      })}
    </div>
  );

  const renderTags = () => (
    <div
      key="TAGS"
      className={"sb-group" + (sbDragging === "TAGS" ? " sb-group-dragging" : "")}
    >
      {renderTitle("TAGS", "TAGS")}
      {!sbCollapsed["TAGS"] && tagCounts.map((t, i) => {
        const navIdx = navStart.TAGS + i;
        const isKb = selectedIdx === navIdx;
        return (
          <div key={i}
               data-sb-nav-idx={navIdx}
               className={"sb-item" + (activeTagFilter === t.label ? " active" : "") + (isKb ? " sb-item-focused" : "")}
               title={`filter by tag: ${t.label}`}
               style={{cursor:"pointer"}}
               onClick={() => onTagFilter && onTagFilter(t.label)}>
            <span className="ic" style={{color: t.color}}></span>
            <span>{t.label}</span>
            <span className="badge">{t.count}</span>
          </div>
        );
      })}
    </div>
  );

  const renderDevices = () => (
    <div
      key="DEVICES"
      className={"sb-group" + (sbDragging === "DEVICES" ? " sb-group-dragging" : "")}
    >
      {renderTitle("DEVICES", "DEVICES")}
      {!sbCollapsed["DEVICES"] && (<>
        {driveList.length === 0 && (
          <div className="sb-item" style={{color:"var(--fg-3)", cursor:"default", gridTemplateColumns:"16px 1fr"}}>
            <span className="ic">·</span>
            <div style={{fontStyle:"italic"}}>no drives</div>
          </div>
        )}
        {driveList.map((d, i) => {
          const used = d.total > d.free ? d.total - d.free : 0;
          const letter = d.letter.replace(/\\$/, "");
          const label = d.label && d.label.length > 0 ? d.label : letter;
          const navIdx = navStart.DEVICES + i;
          const isKb = selectedIdx === navIdx;
          return (
            <div key={"d" + i}
                 data-sb-nav-idx={navIdx}
                 className={"sb-item" + (d.letter === activePath ? " active" : "") + (isKb ? " sb-item-focused" : "")}
                 onClick={() => onGoTo(d.letter)}
                 onContextMenu={(e) => {
                   if (!onRowContext) return;
                   e.preventDefault();
                   e.stopPropagation();
                   onRowContext(e, d.letter, "drive");
                 }}
                 style={{cursor:"pointer", gridTemplateColumns:"16px 1fr"}}
                 title={d.letter}>
              <span className="ic"></span>
              <div>
                <div>{letter} {label}</div>
                <div style={{color:"var(--fg-3)", fontSize:10}}>{formatSidebarBytes(used)} / {formatSidebarBytes(d.total)}{d.fs ? " · " + d.fs : ""}</div>
              </div>
            </div>
          );
        })}
        {wslDistros.map((w, i) => {
          const navIdx = navStart.DEVICES + driveList.length + i;
          const isKb = selectedIdx === navIdx;
          return (
            <div key={"w" + i}
                 data-sb-nav-idx={navIdx}
                 className={"sb-item" + (w.path === activePath ? " active" : "") + (isKb ? " sb-item-focused" : "")}
                 onClick={() => onGoTo(w.path)}
                 onContextMenu={(e) => {
                   if (!onRowContext) return;
                   e.preventDefault();
                   e.stopPropagation();
                   onRowContext(e, w.path, "wsl");
                 }}
                 style={{cursor:"pointer", gridTemplateColumns:"16px 1fr"}}
                 title={w.path}>
              <span className="ic"></span>
              <div>
                <div>{w.name}</div>
                <div style={{color:"var(--fg-3)", fontSize:10}}>wsl · {w.path}</div>
              </div>
            </div>
          );
        })}
      </>)}
    </div>
  );

  const renderRemote = () => (
    <div
      key="REMOTE"
      className={"sb-group" + (sbDragging === "REMOTE" ? " sb-group-dragging" : "")}
    >
      {renderTitle("REMOTE", "REMOTE", (
        <span
          data-sb-title-button
          style={{color:"var(--fg-3)", cursor:"pointer"}}
          title="Add remote server"
          onClick={(e) => { e.stopPropagation(); onOpenConnectDialog(); }}
        >+</span>
      ))}
      {!sbCollapsed["REMOTE"] && (<>
        {savedRemotes.length === 0 && (
          <div className="sb-item" style={{color:"var(--fg-3)", cursor:"default"}}>
            <span className="ic">·</span>
            <span style={{fontStyle:"italic"}}>no saved remotes</span>
            <span className="badge"></span>
          </div>
        )}
        {savedRemotes.map((r, i) => {
          const navIdx = navStart.REMOTE + i;
          const isKb = selectedIdx === navIdx;
          return (
            <div key={"r" + i}
                 data-sb-nav-idx={navIdx}
                 className={"sb-item" + (isKb ? " sb-item-focused" : "")}
                 style={{gridTemplateColumns: "16px 1fr", cursor:"pointer"}}
                 title={`ssh ${r.host}${r.path ? " — " + r.path : ""}`}
                 onClick={() => onRemoteClick(r)}
                 onContextMenu={(e) => {
                   if (!onRowContext) return;
                   e.preventDefault();
                   onRowContext(e, r.host, "remote");
                 }}>
              <span className="ic"></span>
              <div>
                <div>{r.label}</div>
                <div style={{color:"var(--fg-3)", fontSize:10}}>{r.host}{r.path ? " · " + r.path : ""}</div>
              </div>
            </div>
          );
        })}
      </>)}
    </div>
  );

  const groupRenderers: Record<SbGroupKey, () => React.ReactNode> = {
    PINNED: renderPinned,
    TREE: renderTree,
    TAGS: renderTags,
    DEVICES: renderDevices,
    REMOTE: renderRemote,
  };

  return (
    <aside
      ref={sidebarRef}
      className="sidebar"
      tabIndex={-1}
      onMouseDown={() => { if (onActivate) onActivate(); }}
      onFocus={() => { if (onActivate) onActivate(); }}
      onKeyDown={onSidebarKeyDown}
    >
      {sbOrder.map((key, idx) => (
        <React.Fragment key={key}>
          {sbDragging && sbDropIdx === idx && <div className="sb-drop-indicator" />}
          {groupRenderers[key]()}
        </React.Fragment>
      ))}
      {sbDragging && sbDropIdx === sbOrder.length && <div className="sb-drop-indicator" />}
    </aside>
  );
}

// ============= Main file pane =============
function kindIcon(kind: FileKind): { ic: string; cls: string } {
  switch (kind) {
    case "folder": return { ic: "▸", cls: "folder" };
    case "code":   return { ic: "<>", cls: "code" };
    case "img":    return { ic: "▢", cls: "img" };
    case "archive":return { ic: "◫", cls: "archive" };
    case "exec":   return { ic: "$", cls: "exec" };
    default:       return { ic: "≡", cls: "text" };
  }
}

function tagColor(tag: string | null): string {
  const m: Record<string, string> = { project: "var(--magenta)", school: "var(--green)", secret: "var(--red)", review: "var(--yellow)", archive: "var(--cyan)" };
  return (tag && m[tag]) || "var(--fg-3)";
}

// Map single-char git status codes to CSS-safe class suffixes. "?" and "!"
// aren't valid in class names, so we translate.
function gitDotClass(code: string): string {
  switch (code) {
    case "M": return "gm";
    case "A": return "ga";
    case "D": return "gd";
    case "U": return "gu";
    case "?": return "gq";
    case "!": return "gb";
    default: return "gb";
  }
}

export type ContextKind = "file" | "empty" | "sidebar" | "tab" | "breadcrumb";

export type SortColumn = "name" | "size" | "modified" | "tag" | "git" | "type";
export type SortDirection = "asc" | "desc";

export interface FilePaneProps {
  files: FileRow[];
  selected: number[];
  setSelected: (sel: number[]) => void;
  focusIndex: number;
  setFocusIndex: (i: number) => void;
  anchorIndex: number;
  setAnchorIndex: (i: number) => void;
  paneFocused: boolean;
  setPaneFocused: (v: boolean) => void;
  sortKey: SortColumn;
  sortDir: SortDirection;
  onSortChange: (k: SortColumn) => void;
  foldersFirst?: boolean;
  showExtensions?: boolean;
  showGitGutters?: boolean;
  onContext: (e: React.MouseEvent, kind: ContextKind, rowIndex?: number) => void;
  onOpen?: (index: number) => void;
  onUp?: () => void;
  onCopy?: () => void;
  onCut?: () => void;
  onDelete?: (permanent: boolean) => void;
  searchQuery?: string;
  tagFilter?: string | null;
  tagStore?: Record<string, string[]>;
  onRowDrop?: (targetOrigIndex: number, sourceOrigIndices: number[], copy: boolean) => void;
  /** External drop: drag from this pane to elsewhere (sidebar tree, another pane).
   *  App handles the drop site via a global window "glasshouse-extern-drop" event. */
  onExternalDrag?: (sourceOrigIndices: number[], clientX: number, clientY: number, copy: boolean) => void;
  paneRootRef?: React.Ref<HTMLElement>;
  onActivate?: () => void;
  /** Paths currently in "cut" mode in the app clipboard — rendered dimmed. */
  cutPaths?: string[];
}

const PAGE_STEP = 10;

// Pointer-based drag implementation. We don't use HTML5 drag because it
// doesn't initiate from synthesized mouse events, which makes
// test-harness automation impossible and breaks on some webviews.
const DRAG_THRESHOLD_PX = 5;

/** Stable callback bundle passed to every PaneRow. Kept referentially
 *  constant (useMemo []) so PaneRow's React.memo actually holds; callbacks
 *  read live state through FilePane's `latest` ref. */
interface RowHandlers {
  pointerDown: (i: number, isSel: boolean, e: React.PointerEvent) => void;
  click: (i: number, e: React.MouseEvent) => void;
  dblClick: (i: number) => void;
  ctxMenu: (i: number, isSel: boolean, e: React.MouseEvent) => void;
}

/** One file row. Memoized: with thousands of entries, re-rendering every row
 *  on each selection/focus change is what made large directories crawl —
 *  only rows whose flags flip re-render now. */
const PaneRow = React.memo(function PaneRow({
  f, i, isSel, isFocus, isDragOver, isCut, showGitGutters, showExtensions, h,
}: {
  f: FileRow;
  i: number;
  isSel: boolean;
  isFocus: boolean;
  isDragOver: boolean;
  isCut: boolean;
  showGitGutters: boolean;
  showExtensions: boolean;
  h: RowHandlers;
}) {
  const ki = kindIcon(f.kind);
  return (
    <div data-orig={i}
         className={"row" + (isSel ? " selected" : "") + (isFocus ? " focused" : "") + (isDragOver ? " drop-target" : "") + (isCut ? " clip-cut" : "")}
         style={{opacity: f.dimmed ? 0.55 : 1}}
         onPointerDown={(e) => h.pointerDown(i, isSel, e)}
         onClick={(e) => h.click(i, e)}
         onDoubleClick={() => h.dblClick(i)}
         onContextMenu={(e) => h.ctxMenu(i, isSel, e)}>
      <span className={"ic " + ki.cls}>{ki.ic}</span>
      <span className="name">
        {showGitGutters && f.git && <span className={"git-dot " + gitDotClass(f.git)}></span>}
        <span style={{color: f.hidden ? "var(--fg-3)" : "inherit"}}>{f.name}</span>
        {showExtensions && f.ext && !f.hidden && f.kind !== "folder" && <span className="ext">.{f.ext}</span>}
      </span>
      <span className="tag">
        {f.tag ? <><span className="dot" style={{background: tagColor(f.tag)}}></span>{f.tag}</> : <span style={{color:"var(--fg-3)"}}>—</span>}
      </span>
      <span className="size">{f.size}</span>
      <span className="date">{f.date}</span>
      <span className="tag" style={{textAlign:"right"}}>
        {!showGitGutters ? <span style={{color:"var(--fg-3)"}}>—</span>
         : f.git === "M" ? <span style={{color:"var(--yellow)"}}>M</span>
         : f.git === "A" ? <span style={{color:"var(--green)"}}>A</span>
         : f.git === "D" ? <span style={{color:"var(--red)"}}>D</span>
         : f.git === "U" ? <span style={{color:"var(--red)"}}>U</span>
         : f.git === "?" ? <span style={{color:"var(--fg-2)"}}>?</span>
         : f.git === "!" ? <span style={{color:"var(--fg-3)"}}>!</span>
         : <span style={{color:"var(--fg-3)"}}>—</span>}
      </span>
    </div>
  );
});

export function FilePane({
  files,
  selected,
  setSelected,
  focusIndex,
  setFocusIndex,
  anchorIndex,
  setAnchorIndex,
  paneFocused,
  setPaneFocused,
  sortKey,
  sortDir,
  onSortChange,
  foldersFirst = true,
  showExtensions = true,
  showGitGutters = true,
  onContext,
  onOpen,
  onUp,
  onCopy,
  onCut,
  onDelete,
  searchQuery,
  tagFilter,
  tagStore,
  onRowDrop,
  onExternalDrag,
  paneRootRef,
  onActivate,
  cutPaths,
}: FilePaneProps) {
  const paneRef = useRef<HTMLElement>(null);
  // Wire external ref (App keeps a handle to focus programmatically for Tab nav).
  useEffect(() => {
    if (!paneRootRef) return;
    if (typeof paneRootRef === "function") paneRootRef(paneRef.current);
    else (paneRootRef as React.MutableRefObject<HTMLElement | null>).current = paneRef.current;
  });
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  // Marquee (box-select) state. Rectangle is in pane-relative coords.
  const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  // Ghost preview during an external drag — small floating label with count.
  const [ghost, setGhost] = useState<{ x: number; y: number; count: number; copy: boolean } | null>(null);

  // Filtered + sorted, preserving origIndex so selection still refers to the
  // underlying `files` array (which is what App's clipboard/selection logic
  // indexes into).
  const displayFiles = useMemo(() => {
    const indexed = files.map((f, i) => ({ file: f, origIndex: i }));
    const q = (searchQuery || "").trim();
    const afterSearch = q
      ? fuzzyFilter(
          q,
          indexed,
          x => (x.file.ext && x.file.kind !== "folder") ? `${x.file.name}.${x.file.ext}` : x.file.name,
        ).map(r => r.item)
      : indexed;

    // Tag filter — keep only rows whose path is tagged with tagFilter in the
    // shared tag store. Applied after search, before sort.
    const filtered = tagFilter
      ? afterSearch.filter(x => {
          const entry = (x.file as unknown as { entry?: { path?: string } }).entry;
          const path = entry?.path;
          if (!path) return false;
          const rowTags = tagStore?.[path];
          return !!rowTags && rowTags.includes(tagFilter);
        })
      : afterSearch;

    const tagKey = (x: { file: FileRow }): string => {
      const entry = (x.file as unknown as { entry?: { path?: string } }).entry;
      const path = entry?.path;
      if (!path) return "";
      return (tagStore?.[path] ?? []).join(",");
    };

    const dir = sortDir === "asc" ? 1 : -1;
    const sorted = [...filtered].sort((a, b) => {
      if (foldersFirst) {
        const af = a.file.kind === "folder" ? 0 : 1;
        const bf = b.file.kind === "folder" ? 0 : 1;
        if (af !== bf) return af - bf;
      }
      if (sortKey === "type") {
        const ae = (a.file.ext ?? "").toLowerCase();
        const be = (b.file.ext ?? "").toLowerCase();
        if (ae !== be) return ae < be ? -1 * dir : 1 * dir;
        const an = a.file.name.toLowerCase();
        const bn = b.file.name.toLowerCase();
        return an < bn ? -1 * dir : an > bn ? 1 * dir : 0;
      }
      if (sortKey === "name") {
        const an = (a.file.name + (a.file.ext ? "." + a.file.ext : "")).toLowerCase();
        const bn = (b.file.name + (b.file.ext ? "." + b.file.ext : "")).toLowerCase();
        return an < bn ? -1 * dir : an > bn ? 1 * dir : 0;
      }
      if (sortKey === "size") {
        const as = (a.file as unknown as { entry?: { size?: number } }).entry?.size ?? 0;
        const bs = (b.file as unknown as { entry?: { size?: number } }).entry?.size ?? 0;
        return (as - bs) * dir;
      }
      if (sortKey === "tag") {
        const at = tagKey(a);
        const bt = tagKey(b);
        // Untagged rows ("") sort to the end on asc, start on desc — matches
        // convention for "group the boring stuff last".
        if (at === "" && bt !== "") return 1;
        if (bt === "" && at !== "") return -1;
        return at < bt ? -1 * dir : at > bt ? 1 * dir : 0;
      }
      if (sortKey === "git") {
        // Tilde sorts after letters in ASCII, so null/clean rows group at the
        // end in asc order — keeps the noisy stuff up top.
        const ag = a.file.git ?? "~";
        const bg = b.file.git ?? "~";
        return ag < bg ? -1 * dir : ag > bg ? 1 * dir : 0;
      }
      // modified
      const am = (a.file as unknown as { entry?: { modified_ms?: number } }).entry?.modified_ms ?? 0;
      const bm = (b.file as unknown as { entry?: { modified_ms?: number } }).entry?.modified_ms ?? 0;
      return (am - bm) * dir;
    });
    return sorted;
  }, [files, searchQuery, sortKey, sortDir, tagFilter, tagStore, foldersFirst]);

  // Map origIndex -> visible row position, for keyboard nav (which operates
  // on the currently-displayed ordering, not the raw entries array).
  const visibleOrig = useMemo(() => displayFiles.map(d => d.origIndex), [displayFiles]);
  const visiblePos = useMemo(() => {
    const m = new Map<number, number>();
    visibleOrig.forEach((o, i) => m.set(o, i));
    return m;
  }, [visibleOrig]);

  const rangeSelect = (fromOrig: number, toOrig: number) => {
    const a = visiblePos.get(fromOrig);
    const b = visiblePos.get(toOrig);
    if (a === undefined || b === undefined) {
      setSelected([toOrig]);
      return;
    }
    const lo = Math.min(a, b), hi = Math.max(a, b);
    const origs: number[] = [];
    for (let i = lo; i <= hi; i++) origs.push(visibleOrig[i]);
    setSelected(origs);
  };

  const handleRowClick = (origIndex: number, e: React.MouseEvent) => {
    setFocusIndex(origIndex);
    if (e.shiftKey && selected.length) {
      rangeSelect(anchorIndex, origIndex);
    } else if (e.ctrlKey || e.metaKey) {
      setSelected(selected.includes(origIndex) ? selected.filter(x => x !== origIndex) : [...selected, origIndex]);
      setAnchorIndex(origIndex);
    } else {
      setSelected([origIndex]);
      setAnchorIndex(origIndex);
    }
  };

  // Pane-local keyboard handling. Fires only when focus is inside the pane
  // (the global App-level listener covers app-wide shortcuts; we do NOT want
  // arrow-key selection to fire while focus is in the search box or sidebar).
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (displayFiles.length === 0) return;

    const currentPos = visiblePos.get(focusIndex);
    const safePos = currentPos ?? 0;

    const move = (nextPos: number, extend: boolean) => {
      const clamped = Math.max(0, Math.min(displayFiles.length - 1, nextPos));
      const nextOrig = visibleOrig[clamped];
      setFocusIndex(nextOrig);
      if (extend) {
        rangeSelect(anchorIndex, nextOrig);
      } else {
        setSelected([nextOrig]);
        setAnchorIndex(nextOrig);
      }
    };

    // Ctrl+A — select all visible
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "a") {
      e.preventDefault();
      setSelected(visibleOrig.slice());
      return;
    }

    // Ctrl+C / Ctrl+X — let these through to pane handlers (App-level also
    // catches, but when pane is focused we want to be explicit).
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
      const k = e.key.toLowerCase();
      if (k === "c" && onCopy) { e.preventDefault(); onCopy(); return; }
      if (k === "x" && onCut) { e.preventDefault(); onCut(); return; }
    }

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        move(safePos + 1, e.shiftKey);
        return;
      case "ArrowUp":
        e.preventDefault();
        move(safePos - 1, e.shiftKey);
        return;
      case "Home":
        e.preventDefault();
        move(0, e.shiftKey);
        return;
      case "End":
        e.preventDefault();
        move(displayFiles.length - 1, e.shiftKey);
        return;
      case "PageDown":
        e.preventDefault();
        move(safePos + PAGE_STEP, e.shiftKey);
        return;
      case "PageUp":
        e.preventDefault();
        move(safePos - PAGE_STEP, e.shiftKey);
        return;
      case "Escape":
        e.preventDefault();
        setSelected([]);
        return;
      case "Enter":
        e.preventDefault();
        e.nativeEvent.stopImmediatePropagation();
        if (onOpen) onOpen(focusIndex);
        return;
      case "Backspace":
        e.preventDefault();
        e.nativeEvent.stopImmediatePropagation();
        if (onUp) onUp();
        return;
      case "Delete":
        e.preventDefault();
        e.nativeEvent.stopImmediatePropagation();
        if (onDelete) onDelete(e.shiftKey);
        return;
    }
  };

  // Scroll focused row into view when it changes via keyboard.
  useEffect(() => {
    if (!paneFocused) return;
    const pos = visiblePos.get(focusIndex);
    if (pos === undefined) return;
    const root = paneRef.current;
    if (!root) return;
    const el = root.querySelector<HTMLDivElement>(`.row[data-orig="${focusIndex}"]`);
    if (el) el.scrollIntoView({ block: "nearest" });
  }, [focusIndex, paneFocused, visiblePos]);

  const sortArrow = (col: SortColumn) => (sortKey === col ? (sortDir === "asc" ? "↑" : "↓") : "");

  // Cancel marquee on Esc while one is active.
  useEffect(() => {
    if (!marquee) return;
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMarquee(null);
    };
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [marquee]);

  const onPaneMouseDown = (e: React.MouseEvent) => {
    // Take focus on click so arrow keys work without an explicit tab.
    if (paneRef.current && document.activeElement !== paneRef.current) {
      paneRef.current.focus();
    }
    if (onActivate) onActivate();
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    // Don't start a marquee if the mousedown hit a row, pane-head, or sort header.
    if (target.closest("[data-orig]") || target.closest(".pane-head")) return;
    const root = paneRef.current;
    if (!root) return;
    // Prevent default so text selection doesn't interfere with marquee drag.
    e.preventDefault();
    const rootRect = root.getBoundingClientRect();
    const startX = e.clientX - rootRect.left;
    const startY = e.clientY - rootRect.top;
    const baseSelection = selected.slice();
    const shift = e.shiftKey;
    const ctrl = e.ctrlKey || e.metaKey;
    // Clear selection on plain drag so the marquee sets it from scratch.
    if (!shift && !ctrl) setSelected([]);

    const updateSelection = (curMarquee: { x: number; y: number; w: number; h: number }) => {
      const rows = root.querySelectorAll<HTMLElement>("[data-orig]");
      const hit: number[] = [];
      const mx1 = curMarquee.x;
      const my1 = curMarquee.y;
      const mx2 = curMarquee.x + curMarquee.w;
      const my2 = curMarquee.y + curMarquee.h;
      rows.forEach((row) => {
        const r = row.getBoundingClientRect();
        const rx1 = r.left - rootRect.left;
        const ry1 = r.top - rootRect.top;
        const rx2 = rx1 + r.width;
        const ry2 = ry1 + r.height;
        const overlap = rx1 < mx2 && rx2 > mx1 && ry1 < my2 && ry2 > my1;
        if (overlap) {
          const n = parseInt(row.getAttribute("data-orig") || "-1", 10);
          if (n >= 0) hit.push(n);
        }
      });
      if (shift) {
        // Additive
        const s = new Set(baseSelection);
        for (const n of hit) s.add(n);
        setSelected(Array.from(s));
      } else if (ctrl) {
        // XOR toggle
        const s = new Set(baseSelection);
        for (const n of hit) {
          if (s.has(n)) s.delete(n);
          else s.add(n);
        }
        setSelected(Array.from(s));
      } else {
        setSelected(hit);
      }
    };

    const onMove = (ev: MouseEvent) => {
      const curX = ev.clientX - rootRect.left;
      const curY = ev.clientY - rootRect.top;
      const rect = {
        x: Math.min(startX, curX),
        y: Math.min(startY, curY),
        w: Math.abs(curX - startX),
        h: Math.abs(curY - startY),
      };
      setMarquee(rect);
      updateSelection(rect);
      // Auto-scroll the .rows container when dragging near its edges.
      const rowsEl = root.querySelector<HTMLElement>(".rows");
      if (rowsEl) {
        const rr = rowsEl.getBoundingClientRect();
        const EDGE = 24;
        if (ev.clientY > rr.bottom - EDGE) rowsEl.scrollTop += 16;
        else if (ev.clientY < rr.top + EDGE) rowsEl.scrollTop -= 16;
      }
    };
    const onMarqueeUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onMarqueeUp);
      setMarquee(null);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onMarqueeUp);
  };

  // O(1) membership lookups — `selected.includes(i)` per row made every
  // selection change O(rows × selection).
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const cutSet = useMemo(() => new Set(cutPaths ?? []), [cutPaths]);

  // Live-state escape hatch for the stable row handlers below.
  const latest = useRef({ files, selected, handleRowClick, onOpen, onContext, onRowDrop, onExternalDrag, setSelected, setAnchorIndex, setFocusIndex });
  latest.current = { files, selected, handleRowClick, onOpen, onContext, onRowDrop, onExternalDrag, setSelected, setAnchorIndex, setFocusIndex };

  const rowHandlers = useMemo<RowHandlers>(() => ({
    pointerDown: (i, isSel, e) => {
      if (e.button !== 0) return;
      const startX = e.clientX;
      const startY = e.clientY;
      const sources = isSel ? [...latest.current.selected] : [i];
      let dragging = false;
      let moved = false;
      const onMove = (ev: PointerEvent) => {
        moved = true;
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        if (!dragging && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
        dragging = true;
        setGhost({
          x: ev.clientX,
          y: ev.clientY,
          count: sources.length,
          copy: ev.shiftKey,
        });
        // Locate the row under the cursor and decide whether it's a valid drop target.
        const hit = document.elementFromPoint(ev.clientX, ev.clientY);
        const row = hit?.closest("[data-orig]") as HTMLElement | null;
        const origAttr = row?.getAttribute("data-orig");
        const origIdx = origAttr !== null && origAttr !== undefined ? parseInt(origAttr, 10) : -1;
        const hoverFile = origIdx >= 0 ? latest.current.files[origIdx] : undefined;
        const validTarget = hoverFile && hoverFile.kind === "folder" && !sources.includes(origIdx);
        setDragOverIndex(validTarget ? origIdx : null);
      };
      const onPointerUp = (ev: PointerEvent) => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onPointerUp);
        window.removeEventListener("pointercancel", onPointerUp);
        setDragOverIndex(null);
        setGhost(null);
        if (!dragging) return;
        const copy = ev.shiftKey;
        const hit = document.elementFromPoint(ev.clientX, ev.clientY);
        const row = hit?.closest("[data-orig]") as HTMLElement | null;
        const origAttr = row?.getAttribute("data-orig");
        if (origAttr) {
          const targetIdx = parseInt(origAttr, 10);
          const targetFile = latest.current.files[targetIdx];
          if (targetFile && targetFile.kind === "folder") {
            const filtered = sources.filter(s => s !== targetIdx);
            if (filtered.length > 0) {
              latest.current.onRowDrop?.(targetIdx, filtered, copy);
              return;
            }
          }
        }
        // Not over a folder row — delegate to external drop handler
        // (e.g. sidebar tree-row). App resolves the drop target.
        latest.current.onExternalDrag?.(sources, ev.clientX, ev.clientY, copy);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onPointerUp);
      window.addEventListener("pointercancel", onPointerUp);
      // Let click/dblclick still work when no drag happened.
      void moved;
    },
    click: (i, e) => latest.current.handleRowClick(i, e),
    dblClick: (i) => latest.current.onOpen?.(i),
    ctxMenu: (i, isSel, e) => {
      e.preventDefault();
      e.stopPropagation();
      const L = latest.current;
      if (!isSel) { L.setSelected([i]); L.setAnchorIndex(i); }
      L.setFocusIndex(i);
      L.onContext(e, "file", i);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), []);

  return (
    <section
      ref={paneRef}
      className={"pane" + (paneFocused ? " pane-focused" : "")}
      tabIndex={0}
      onFocus={() => { setPaneFocused(true); if (onActivate) onActivate(); }}
      onBlur={(e) => {
        // Only drop focus if the new focus target is outside the pane.
        if (!paneRef.current?.contains(e.relatedTarget as Node)) setPaneFocused(false);
      }}
      onKeyDown={onKeyDown}
      onMouseDown={onPaneMouseDown}
      onContextMenu={(e) => { e.preventDefault(); onContext(e, selected.length ? "file" : "empty"); }}
    >
      <div className="pane-head">
        <div className="col"></div>
        <div className="col" onClick={() => onSortChange("name")}>name <span className="sort">{sortArrow("name")}</span></div>
        <div className="col" onClick={() => onSortChange("tag")}>tag <span className="sort">{sortArrow("tag")}</span></div>
        <div className="col" style={{justifyContent:"flex-end"}} onClick={() => onSortChange("size")}>size <span className="sort">{sortArrow("size")}</span></div>
        <div className="col" onClick={() => onSortChange("modified")}>modified <span className="sort">{sortArrow("modified")}</span></div>
        <div className="col" style={{justifyContent:"flex-end"}} onClick={() => onSortChange("git")}>git <span className="sort">{sortArrow("git")}</span></div>
      </div>
      <div className="rows">
        {displayFiles.map(({ file: f, origIndex: i }) => {
          // FileRow is a display-only type without a filesystem path, but the
          // host (App.tsx) always passes LiveFileRow which carries entry.path.
          // Peek defensively so we don't over-constrain the public prop type.
          const fPath = (f as { entry?: { path?: string } }).entry?.path;
          return (
            <PaneRow key={i}
                     f={f}
                     i={i}
                     isSel={selectedSet.has(i)}
                     isFocus={paneFocused && focusIndex === i}
                     isDragOver={dragOverIndex === i && f.kind === "folder"}
                     isCut={fPath ? cutSet.has(fPath) : false}
                     showGitGutters={showGitGutters}
                     showExtensions={showExtensions}
                     h={rowHandlers}
            />
          );
        })}
      </div>
      {marquee && (
        <div
          className="marquee"
          style={{
            position: "absolute",
            pointerEvents: "none",
            left: marquee.x,
            top: marquee.y,
            width: marquee.w,
            height: marquee.h,
            border: "1px solid var(--accent)",
            background: "color-mix(in oklch, var(--accent) 12%, transparent)",
            zIndex: 10,
          }}
        />
      )}
      {ghost && (
        <div
          className="drag-ghost"
          style={{
            position: "fixed",
            left: ghost.x + 10,
            top: ghost.y + 10,
            pointerEvents: "none",
            background: "var(--bg-1)",
            color: "var(--accent)",
            border: "1px solid var(--accent)",
            padding: "3px 8px",
            borderRadius: 3,
            fontSize: 11,
            fontFamily: "var(--font-mono)",
            zIndex: 2000,
            whiteSpace: "nowrap",
          }}
        >
          {ghost.copy ? "copy " : "move "}
          {ghost.count} item{ghost.count === 1 ? "" : "s"}
        </div>
      )}
    </section>
  );
}

// ============= Inspector =============
export interface InspectableFile extends FileRow {
  entry: FileEntry;
}

export interface InspectorProps {
  file: InspectableFile | null;
  onQuickAction?: (action: "run" | "copy-path" | "open-in-code" | "git-blame" | "compress") => void;
}

function mimeGuess(kind: FileKind, ext: string): string {
  if (kind === "img") {
    if (ext === "svg") return "image/svg+xml";
    if (ext === "png") return "image/png";
    if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
    return "image/*";
  }
  if (kind === "code") {
    if (ext === "rs") return "text/x-rust";
    if (ext === "py") return "text/x-python";
    if (ext === "ts" || ext === "tsx") return "text/typescript";
    if (ext === "js" || ext === "jsx") return "text/javascript";
    return "text/plain";
  }
  if (kind === "archive") return "application/octet-stream";
  if (kind === "exec") return "application/x-executable";
  if (kind === "folder") return "inode/directory";
  return "text/plain";
}

function PermissionsGrid({ path }: { path?: string }) {
  // 3 rows (read/write/exec) × 3 cols (owner/group/world). Clicks persist via
  // set_permissions backend when `path` is present; on Windows only the
  // owner-write bit is meaningful (toggles read-only), so other cells still
  // flip visually but won't round-trip.
  const [perms, setPerms] = useState<boolean[][]>([
    [true, true, false],
    [true, false, false],
    [true, false, false],
  ]);
  const rows: Array<{ label: string; glyph: string }> = [
    { label: "read",  glyph: "r" },
    { label: "write", glyph: "w" },
    { label: "exec",  glyph: "x" },
  ];
  const cols = ["owner", "group", "world"];
  const toggle = (r: number, c: number) => {
    setPerms(prev => {
      const next = prev.map((row, ri) =>
        ri === r ? row.map((v, ci) => (ci === c ? !v : v)) : row
      );
      if (path) {
        const mode = [0, 1, 2].reduce((acc, col) =>
          acc + ((next[0][col] ? 4 : 0) + (next[1][col] ? 2 : 0) + (next[2][col] ? 1 : 0)) * (col === 0 ? 64 : col === 1 ? 8 : 1),
        0);
        void setPermissions(path, mode).catch((e: unknown) => {
          console.log(`[inspector] chmod failed for ${path}:`, e);
        });
      } else {
        console.log(`[inspector] perm toggle ${rows[r].label}-${cols[c]} — no active path`);
      }
      return next;
    });
  };
  const octalFixed = cols
    .map((_, c) => (perms[0][c] ? 4 : 0) + (perms[1][c] ? 2 : 0) + (perms[2][c] ? 1 : 0))
    .join("");
  const rwxStr = cols
    .map((_, c) => (perms[0][c] ? "r" : "-") + (perms[1][c] ? "w" : "-") + (perms[2][c] ? "x" : "-"))
    .join("");
  return (
    <div className="insp-section">
      <h4>PERMISSIONS <span style={{color:"var(--accent)", cursor:"pointer"}}>edit</span></h4>
      <div style={{fontFamily:"var(--font-mono)", color:"var(--fg-0)", marginBottom:6}}>
        <span>{rwxStr}</span> <span style={{color:"var(--fg-3)"}}>0{octalFixed}</span>
      </div>
      <div className="perm-grid">
        <div></div><div className="h">owner</div><div className="h">group</div><div className="h">world</div>
        {rows.map((row, ri) => (
          <React.Fragment key={row.label}>
            <div className="h" style={{textAlign:"right"}}>{row.label}</div>
            {cols.map((col, ci) => {
              const on = perms[ri][ci];
              return (
                <div
                  key={col}
                  className={"perm-cell" + (on ? "" : " off")}
                  style={{cursor:"pointer", userSelect:"none"}}
                  onClick={() => toggle(ri, ci)}
                  title={`${row.label} ${col} — click to toggle`}
                >{on ? row.glyph : "—"}</div>
              );
            })}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

// Heuristic: text-like if kind is text/code OR extension matches a plain-text
// family. Used so the preview can attempt to render small config files that
// the backend classifier missed (e.g. .env, .toml, unknown extensions).
const TEXT_EXT_FALLBACK = new Set([
  "txt","md","markdown","rst","log","json","yaml","yml","toml","ini","cfg",
  "conf","env","xml","svg","csv","tsv","html","htm","css","scss","less",
  "ts","tsx","js","jsx","mjs","cjs","py","rs","go","c","h","hpp","cpp","cc",
  "java","kt","swift","rb","php","sh","bash","zsh","fish","ps1","bat","cmd",
  "sql","graphql","gql","lua","r","jl","ex","exs","dart","scala","clj","hs",
  "ml","vim","gitignore","gitattributes","editorconfig","dockerfile",
]);

function looksBinary(s: string): boolean {
  if (!s) return false;
  // Rough heuristic: any NUL byte, or > 2% non-printable characters, is
  // almost certainly binary.
  if (s.indexOf("\0") >= 0) return true;
  let nonPrint = 0;
  const sample = s.slice(0, 2048);
  for (let i = 0; i < sample.length; i++) {
    const c = sample.charCodeAt(i);
    // Allow TAB, LF, CR and printable range.
    if (c === 9 || c === 10 || c === 13) continue;
    if (c < 32 || c === 127) nonPrint++;
  }
  return nonPrint / Math.max(1, sample.length) > 0.02;
}

// Persist the text preview's scroll offset per-path so switching back to a
// file the user already skimmed restores their last position. Module-level
// state survives Inspector unmount; cleared only when the app reloads.
const previewScrollOffsets = new Map<string, number>();

export function Inspector({ file, onQuickAction }: InspectorProps) {
  const [preview, setPreview] = useState<string>("");
  const [previewLoading, setPreviewLoading] = useState<boolean>(false);
  const [previewBinary, setPreviewBinary] = useState<boolean>(false);
  const [previewErr, setPreviewErr] = useState<string>("");
  const [imgSrc, setImgSrc] = useState<string>("");
  const [imgErr, setImgErr] = useState<string>("");
  const [imgLoading, setImgLoading] = useState<boolean>(false);
  const [imgDims, setImgDims] = useState<{ w: number; h: number } | null>(null);
  const [sha256, setSha256] = useState<string | null>(null);
  const [md5, setMd5] = useState<string | null>(null);
  const [crc32, setCrc32] = useState<string | null>(null);
  const [hashing, setHashing] = useState<boolean>(false);
  const [statExt, setStatExt] = useState<FileStatExt | null>(null);
  const [gitFile, setGitFile] = useState<GitFileInfo | null>(null);
  const previewScrollRef = useRef<HTMLDivElement>(null);
  const isKindTextLike = !!file && (file.kind === "text" || file.kind === "code");
  const extLower = file?.ext?.toLowerCase() ?? "";
  const isExtTextLike = !!file && file.kind !== "folder" && file.kind !== "img" && TEXT_EXT_FALLBACK.has(extLower);
  const isTextLike = isKindTextLike || isExtTextLike;
  const isImg = !!file && file.kind === "img";
  const imgSizeWarn = !!file && isImg && file.entry.size > 10 * 1024 * 1024;

  useEffect(() => {
    setPreview("");
    setPreviewBinary(false);
    setPreviewErr("");
    if (!file || !isTextLike) {
      setPreviewLoading(false);
      return;
    }
    let cancelled = false;
    setPreviewLoading(true);
    void (async () => {
      try {
        const t = await readText(file.entry.path, 4096);
        if (cancelled) return;
        if (looksBinary(t)) {
          setPreviewBinary(true);
          setPreview("");
        } else {
          setPreview(t);
        }
      } catch (err) {
        if (!cancelled) {
          const msg = err instanceof Error ? err.message : String(err);
          setPreviewErr(msg);
        }
      } finally {
        if (!cancelled) setPreviewLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [file?.entry.path, isTextLike]);

  useEffect(() => {
    setImgSrc("");
    setImgErr("");
    setImgDims(null);
    if (!file || !isImg) {
      setImgLoading(false);
      return;
    }
    // Respect the 10 MB guard — don't autoload huge images. The preview pane
    // surfaces a click-to-load button instead.
    if (imgSizeWarn) {
      setImgLoading(false);
      return;
    }
    let cancelled = false;
    setImgLoading(true);
    void (async () => {
      try {
        const dataUrl = await readImageB64(file.entry.path, 8 * 1024 * 1024);
        if (!cancelled) setImgSrc(dataUrl);
      } catch (err) {
        if (!cancelled) {
          const msg = err instanceof Error ? err.message : String(err);
          setImgErr(msg);
        }
      } finally {
        if (!cancelled) setImgLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [file?.entry.path, isImg, imgSizeWarn]);

  const loadLargeImage = () => {
    if (!file || !isImg) return;
    let cancelled = false;
    setImgLoading(true);
    setImgErr("");
    void (async () => {
      try {
        const dataUrl = await readImageB64(file.entry.path, 64 * 1024 * 1024);
        if (!cancelled) setImgSrc(dataUrl);
      } catch (err) {
        if (!cancelled) {
          const msg = err instanceof Error ? err.message : String(err);
          setImgErr(msg);
        }
      } finally {
        if (!cancelled) setImgLoading(false);
      }
    })();
    void cancelled;
  };

  // Persist + restore scroll position of the text preview across file changes.
  useEffect(() => {
    if (!file) return;
    const el = previewScrollRef.current;
    if (!el) return;
    const saved = previewScrollOffsets.get(file.entry.path) ?? 0;
    el.scrollTop = saved;
  }, [file?.entry.path, preview]);

  const onPreviewScroll = () => {
    if (!file) return;
    const el = previewScrollRef.current;
    if (!el) return;
    previewScrollOffsets.set(file.entry.path, el.scrollTop);
  };

  // Reset cached hash whenever the inspected path changes — stale digests for
  // a different file would be worse than showing "—".
  useEffect(() => {
    setSha256(null);
    setMd5(null);
    setCrc32(null);
    setHashing(false);
  }, [file?.entry.path]);

  // Debounce both backend fetches so rapid arrow/click navigation doesn't
  // queue up one IPC + subprocess per row. 150ms is imperceptible when you
  // land on a file but discards intermediate selections during a flurry.
  useEffect(() => {
    setStatExt(null);
    if (!file) return;
    let cancelled = false;
    const id = window.setTimeout(() => {
      void (async () => {
        const s = await fileStatExtended(file.entry.path);
        if (!cancelled) setStatExt(s);
      })();
    }, 150);
    return () => { cancelled = true; window.clearTimeout(id); };
  }, [file?.entry.path]);

  useEffect(() => {
    setGitFile(null);
    if (!file) return;
    const parent = file.entry.path.replace(/[\\/][^\\/]*$/, "") || file.entry.path;
    let cancelled = false;
    const id = window.setTimeout(() => {
      void (async () => {
        const g = await gitFileInfo(parent, file.entry.path);
        if (!cancelled) setGitFile(g);
      })();
    }, 150);
    return () => { cancelled = true; window.clearTimeout(id); };
  }, [file?.entry.path]);

  const computeHash = () => {
    if (!file) return;
    if (file.kind === "folder") return;
    setHashing(true);
    void (async () => {
      try {
        const [shaHex, md5Hex, crcHex] = await Promise.all([
          hashSha256(file.entry.path),
          hashMd5(file.entry.path),
          hashCrc32(file.entry.path),
        ]);
        setSha256(shaHex);
        setMd5(md5Hex);
        setCrc32(crcHex);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("hash compute:", msg);
        void dialogs.showAlert({ title: "hash failed", variant: "error", message: msg });
      } finally {
        setHashing(false);
      }
    })();
  };

  if (!file) {
    return (
      <aside className="inspector">
        <div className="insp-hero">
          <div className="insp-preview"><div className="ghost">no selection</div></div>
          <div className="insp-title">—</div>
          <div className="insp-path">—</div>
        </div>
      </aside>
    );
  }

  const f = file;
  const displayName = f.ext && f.kind !== "folder" ? `${f.name}.${f.ext}` : f.name;
  const previewLines = preview.split(/\r?\n/).slice(0, 20);
  const mime = mimeGuess(f.kind, f.ext);
  const fmtMs = (ms: number | null | undefined): string => {
    if (!ms) return "—";
    const d = new Date(ms);
    const pad = (n: number) => n.toString().padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  const createdStr = fmtMs(statExt?.created_ms ?? null);
  const ownerStr = statExt?.owner ?? "—";
  const inodeStr = statExt?.file_index != null ? String(statExt.file_index) : "—";
  const diffStr =
    gitFile && (gitFile.added > 0 || gitFile.removed > 0)
      ? `+${gitFile.added} −${gitFile.removed}`
      : gitFile && gitFile.sha
        ? "clean"
        : "—";

  return (
    <aside className="inspector">
      <div className="insp-hero">
        <div className="insp-preview">
          {isImg && imgSizeWarn && !imgSrc && !imgLoading && !imgErr ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, fontSize: 10 }}>
              <div className="ghost" style={{ fontSize: 10 }}>large image ({f.size})</div>
              <button
                onClick={loadLargeImage}
                style={{
                  background: "transparent", border: "1px solid var(--accent)", color: "var(--accent)",
                  padding: "3px 10px", cursor: "pointer", borderRadius: 3, fontSize: 10,
                  fontFamily: "inherit",
                }}
              >render anyway</button>
            </div>
          ) : isImg && imgLoading ? (
            <div className="ghost">loading image…</div>
          ) : isImg && imgSrc ? (
            <img
              src={imgSrc}
              alt={displayName}
              onLoad={(e) => {
                const img = e.currentTarget;
                setImgDims({ w: img.naturalWidth, h: img.naturalHeight });
              }}
              onError={() => setImgErr("failed to decode image data")}
              style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", display: "block" }}
            />
          ) : isImg && imgErr ? (
            <div className="ghost" style={{ fontSize: 10 }}>image: {imgErr}</div>
          ) : previewLoading ? (
            <div className="ghost">reading…</div>
          ) : previewErr ? (
            <div className="ghost" style={{ fontSize: 10, color: "var(--red, #f7768e)" }}>
              can't preview: {previewErr}
            </div>
          ) : previewBinary ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, fontSize: 10 }}>
              <div className="big-ic" style={{ fontSize: 36 }}>{kindIcon(f.kind).ic}</div>
              <div className="ghost" style={{ fontSize: 10 }}>binary — no preview</div>
            </div>
          ) : isTextLike && preview ? (
            <div
              ref={previewScrollRef}
              onScroll={onPreviewScroll}
              style={{fontSize: 10, color:"var(--fg-2)", textAlign:"left", padding:10, alignSelf:"stretch", whiteSpace:"pre", overflow:"auto", maxHeight:"100%", width:"100%", fontFamily:"var(--font-mono)"}}
            >
              {previewLines.map((ln, i) => (<div key={i}>{ln || " "}</div>))}
              {preview.length >= 4096 && <div style={{color:"var(--fg-3)", marginTop:6}}>…truncated (showing 4KB)</div>}
            </div>
          ) : isTextLike && !preview && !previewLoading ? (
            <div className="ghost" style={{ fontSize: 10 }}>empty file</div>
          ) : (
            <div className="big-ic">{kindIcon(f.kind).ic}</div>
          )}
        </div>
        <div className="insp-title">{displayName}</div>
        <div className="insp-path">{f.entry.path}</div>
        <div>
          {f.tag && <span className="chip"><span className="dot" style={{background: tagColor(f.tag)}}></span>{f.tag}</span>}
          <span className="chip">{f.kind}</span>
          {imgDims && <span className="chip" style={{color:"var(--fg-2)"}}>{imgDims.w}×{imgDims.h}</span>}
          {f.git && <span className="chip" style={{color: f.git === "M" ? "var(--yellow)" : f.git === "A" ? "var(--green)" : f.git === "D" || f.git === "U" ? "var(--red)" : "var(--fg-2)"}}>
            git: {f.git}
          </span>}
        </div>
      </div>

      <div className="insp-section">
        <h4>METADATA</h4>
        <dl className="kv">
          <dt>size</dt><dd>{f.size}</dd>
          <dt>modified</dt><dd>{f.date}</dd>
          <dt>created</dt><dd>{createdStr}</dd>
          <dt>owner</dt><dd title={ownerStr}>{ownerStr}</dd>
          <dt>inode</dt><dd className="mono">{inodeStr}</dd>
          <dt>mime</dt><dd className="mono">{mime}</dd>
          {statExt?.is_symlink && statExt.symlink_target && (
            <>
              <dt>→ target</dt>
              <dd className="mono" style={{fontSize:10, wordBreak:"break-all"}} title={statExt.symlink_target}>
                {statExt.symlink_target}
              </dd>
            </>
          )}
        </dl>
      </div>

      <PermissionsGrid path={file?.entry.path} />

      <div className="insp-section">
        <h4>CHECKSUMS {sha256 && (
          <span
            style={{color:"var(--accent)", cursor:"pointer"}}
            onClick={() => { try { void navigator.clipboard.writeText(sha256); } catch { /* clipboard unavailable */ } }}
          >copy</span>
        )}</h4>
        <dl className="kv">
          <dt>sha256</dt>
          <dd
            className="mono"
            style={{fontSize:10, wordBreak:"break-all"}}
            title={sha256 ?? undefined}
          >
            {hashing ? "…" : (sha256 ?? "—")}
          </dd>
          <dt>md5</dt>
          <dd className="mono" style={{fontSize:10, wordBreak:"break-all"}} title={md5 ?? undefined}>
            {hashing ? "…" : (md5 ?? "—")}
          </dd>
          <dt>crc32</dt>
          <dd className="mono" title={crc32 ?? undefined}>
            {hashing ? "…" : (crc32 ?? "—")}
          </dd>
        </dl>
      </div>

      <div className="insp-section">
        <h4>GIT {f.git ? <span style={{color:"var(--orange)"}}>{f.git}</span> : <span style={{color:"var(--fg-3)"}}>—</span>}</h4>
        <dl className="kv">
          <dt>last commit</dt><dd>{gitFile?.last_commit_ago ?? "—"}</dd>
          <dt>author</dt><dd>{gitFile?.author ?? "—"}</dd>
          <dt>sha</dt><dd className="mono">{gitFile?.sha ?? "—"}</dd>
          <dt>diff</dt><dd>{diffStr}</dd>
        </dl>
      </div>

      <div className="insp-section">
        <h4>QUICK ACTIONS</h4>
        <div style={{display:"flex", flexWrap:"wrap", gap:4}}>
          <span className="chip" style={{cursor:"pointer"}} onClick={() => onQuickAction?.("run")}>▶ run</span>
          <span className="chip" style={{cursor:"pointer"}} onClick={() => onQuickAction?.("open-in-code")}>⌨ open in code</span>
          <span className="chip" style={{cursor:"pointer"}} onClick={() => onQuickAction?.("git-blame")}>⎇ git blame</span>
          <span className="chip" style={{cursor:"pointer"}} onClick={() => onQuickAction?.("copy-path")}>⌘ copy path</span>
          <span className="chip" style={{cursor:"pointer"}} onClick={() => onQuickAction?.("compress")}>◫ compress</span>
          <span
            className="chip"
            style={{cursor: hashing ? "progress" : "pointer", opacity: hashing ? 0.6 : 1}}
            onClick={computeHash}
          ># hash</span>
        </div>
      </div>
    </aside>
  );
}

// ============= Status bar =============
export interface StatusBarProps {
  selectedCount: number;
  totalCount: number;
  totalSize: string;
  path: string;
  gitInfo: GitInfo | null;
  onToggleTerm: () => void;
}

function formatUptime(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(sec)}`;
}

function formatMemGB(bytes: number): string {
  if (!bytes) return "—";
  const g = bytes / (1024 ** 3);
  if (g >= 10) return `${g.toFixed(0)}G`;
  return `${g.toFixed(1)}G`;
}

function formatBytesRate(bps: number): string {
  if (!bps || bps < 1) return "0";
  if (bps >= 1024 * 1024) return `${(bps / (1024 * 1024)).toFixed(1)}M`;
  if (bps >= 1024) return `${Math.round(bps / 1024)}K`;
  return `${bps}`;
}

export function StatusBar({ selectedCount, totalCount, totalSize, path, gitInfo, onToggleTerm }: StatusBarProps) {
  const [sys, setSys] = useState<SystemInfo | null>(null);
  const [now, setNow] = useState<Date>(() => new Date());
  const [fs, setFs] = useState<string>("");
  const [net, setNet] = useState<NetRate | null>(null);

  useEffect(() => {
    void (async () => { setSys(await apiSystemInfo()); })();
    const id = window.setInterval(async () => {
      setSys(await apiSystemInfo());
      setNow(new Date());
      setNet(await netRate());
    }, 2000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!path) { if (!cancelled) setFs(""); return; }
      const f = await pathFsType(path);
      if (!cancelled) setFs(f);
    })();
    return () => { cancelled = true; };
  }, [path]);

  const pad = (n: number) => n.toString().padStart(2, "0");
  const clock = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  const cpu = sys ? `${sys.cpu_pct.toFixed(0).padStart(2, "0")}%` : "—";
  const memPct = sys ? `${sys.mem_pct.toFixed(0)}%` : "—";
  const memUsed = sys ? formatMemGB(sys.mem_used) : "—";
  const uptime = sys ? formatUptime(sys.uptime_s) : "—";
  const branch = gitInfo?.branch ?? "—";
  const aheadParts: string[] = [];
  if (gitInfo) {
    if (gitInfo.ahead > 0) aheadParts.push(`↑${gitInfo.ahead}`);
    if (gitInfo.behind > 0) aheadParts.push(`↓${gitInfo.behind}`);
    if (gitInfo.dirty > 0) aheadParts.push(`●${gitInfo.dirty}`);
  }
  const aheadStr = aheadParts.join(" ");
  const fsStr = fs || "—";
  const netStr = net ? `↓${formatBytesRate(net.down_bps)} ↑${formatBytesRate(net.up_bps)}` : "—";

  const numStyle = (ch: number): React.CSSProperties => ({
    display: "inline-block",
    minWidth: `${ch}ch`,
    textAlign: "right",
  });

  return (
    <div className="statusbar">
      <div className="sb-seg mode">READY</div>
      <div className="sb-seg"><span className="lbl">▸</span><span className="val">{path}</span></div>
      <div className="sb-seg accent"><span className="lbl">⎇</span><span className="val">{branch}</span>{aheadStr && <span style={{color:"var(--fg-3)"}}>{aheadStr}</span>}</div>
      <div className="sb-seg"><span className="lbl">sel</span><span className="val" style={numStyle(4)}>{selectedCount}</span><span style={{color:"var(--fg-3)"}}>/ <span style={numStyle(4)}>{totalCount}</span></span></div>
      <div className="sb-seg"><span className="lbl">Σ</span><span className="val" style={numStyle(8)}>{totalSize}</span></div>
      <div className="spacer"></div>
      <div className="sb-seg"><span className="lbl">fs</span><span className="val" style={numStyle(5)}>{fsStr}</span></div>
      <div className="sb-seg warn"><span className="lbl">mem</span><span className="val" style={numStyle(4)}>{memPct}</span></div>
      <div className="sb-seg ok"><span className="lbl">cpu</span><span className="val" style={numStyle(4)}>{cpu}</span></div>
      <div className="sb-seg"><span className="lbl">mem</span><span className="val" style={numStyle(4)}>{memUsed}</span></div>
      <div className="sb-seg"><span className="lbl">i/o</span><span className="val">▁▂▃▅▂▁</span></div>
      <div className="sb-seg"><span className="lbl">net</span><span className="val" style={numStyle(13)}>{netStr}</span></div>
      <div className="sb-seg" style={{cursor:"pointer"}} onClick={onToggleTerm}><span className="val" style={{color:"var(--accent)"}}>⌨ term</span></div>
      <div className="sb-seg"><span className="lbl">up</span><span className="val" style={numStyle(8)}>{uptime}</span></div>
      <div className="sb-seg"><span className="val" style={numStyle(8)}>{clock}</span></div>
    </div>
  );
}

// The real embedded terminal drawer now lives in src/Terminal.tsx and is
// mounted by App.tsx. It talks to the Rust PTY layer via pty_spawn / pty_write
// / pty_resize / pty_kill and the `pty-data` event.

// ============= Command palette =============
export interface PaletteProps {
  onClose: () => void;
  onCommand: (label: string) => void;
}

export function Palette({ onClose, onCommand }: PaletteProps) {
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const items = useMemo(() => {
    if (!q) return PALETTE;
    return fuzzyFilter(q, PALETTE, p => p.label).map(r => r.item);
  }, [q]);

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => { setIdx(0); }, [q]);

  const run = (label: string) => { onCommand(label); onClose(); };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") onClose();
    if (e.key === "ArrowDown") { e.preventDefault(); setIdx((idx + 1) % items.length); }
    if (e.key === "ArrowUp") { e.preventDefault(); setIdx((idx - 1 + items.length) % items.length); }
    if (e.key === "Enter") {
      e.preventDefault();
      const sel = items[idx];
      if (sel) run(sel.label);
      else onClose();
    }
  };

  const groups: Record<string, Array<(typeof PALETTE)[number] & { _i: number }>> = {};
  items.forEach((p, i) => { (groups[p.g] = groups[p.g] || []).push({ ...p, _i: i }); });

  return (
    <div className="palette-overlay" onClick={onClose}>
      <div className="palette" onClick={(e) => e.stopPropagation()} onKeyDown={onKey}>
        <div className="palette-head">
          <span className="prefix">❯</span>
          <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="type a command, path, or :mode" />
          <span className="hint">{items.length} results · <span className="kbd">↑↓</span> navigate</span>
        </div>
        <div className="palette-body">
          {Object.entries(groups).map(([g, arr]) => (
            <div key={g}>
              <div className="pal-group">{g}</div>
              {arr.map((p) => (
                <div key={p._i} className={"pal-row" + (p._i === idx ? " active" : "")} onMouseEnter={() => setIdx(p._i)} onClick={() => run(p.label)}>
                  <span className="ic">{p.ic}</span>
                  <span>{p.label}</span>
                  <span className="kb">{(p.kb || []).map((k, i) => <span key={i}>{k}</span>)}</span>
                </div>
              ))}
            </div>
          ))}
          {items.length === 0 && (
            <div style={{padding: 20, textAlign: "center", color:"var(--fg-3)"}}>no matches. try <code>:help</code></div>
          )}
        </div>
        <div className="palette-foot">
          <span><span className="kb">↵</span>run</span>
          <span><span className="kb">Tab</span>autocomplete</span>
          <span><span className="kb">Ctrl</span><span className="kb">`</span>run in terminal</span>
          <span><span className="kb">Esc</span>close</span>
          <span style={{marginLeft:"auto"}}>:<i>go</i> · /<i>find</i> · ?<i>help</i> · !<i>shell</i></span>
        </div>
      </div>
    </div>
  );
}

// ============= Context menu =============
export interface ContextMenuProps {
  items: MenuItemDef[];
  x: number;
  y: number;
  onClose: () => void;
  onCommand?: (label: string) => void;
  onPayload?: (payload: DynamicPayload) => void;
}

export function ContextMenu({ items, x, y, onClose, onCommand, onPayload }: ContextMenuProps) {
  const [subHover, setSubHover] = useState<MenuItemDef | null>(null);
  const expanded = useExpandedItems(items, items);
  useEffect(() => {
    const h = () => onClose();
    setTimeout(() => document.addEventListener("mousedown", h, { once: true }), 0);
    return () => document.removeEventListener("mousedown", h);
  }, [onClose]);
  return (
    <div
      className="ctx-menu"
      style={{left: x, top: y}}
      onClick={(e) => e.stopPropagation()}
      // Stop mousedown so the document-level close listener below doesn't
      // fire → state update → re-render before the click reaches MenuItem.
      // Without this, every ctx-menu item appears to do nothing: the menu
      // closes on mousedown and the click lands on nothing.
      onMouseDown={(e) => e.stopPropagation()}
    >
      {expanded.map((it, i) => (
        <MenuItem key={i} item={it}
          subOpen={subHover !== null && "label" in subHover && "label" in it && subHover.label === (it as { label: string }).label}
          onSubHover={(s) => setSubHover(s)}
          onAction={(label) => { if (onCommand) onCommand(label); onClose(); }}
          onPayload={(p) => { onPayload?.(p); onClose(); }}
        />
      ))}
    </div>
  );
}

// ============= Tweaks panel =============
export type TweakDensity = "compact" | "default" | "comfy";

export interface TweakState {
  theme: string;
  font: string;
  density: TweakDensity;
  scanlines: boolean;
  hidden: boolean;
  showExtensions: boolean;
  showGitGutters: boolean;
  showIgnored: boolean;
  foldersFirst: boolean;
  showChecksums?: boolean;
}

export interface TweaksProps {
  state: TweakState;
  setState: (s: TweakState) => void;
  onClose: () => void;
}

export function Tweaks({ state, setState, onClose }: TweaksProps) {
  const themes = [
    "tokyo-night", "catppuccin-mocha", "gruvbox-dark", "rose-pine",
    "everforest", "solarized-dark", "green-crt", "synthwave",
  ];
  const fonts = [
    '"JetBrainsMono Nerd Font", "JetBrains Mono", ui-monospace, monospace',
    '"JetBrains Mono", ui-monospace, monospace',
    '"Iosevka", ui-monospace, monospace',
    '"IBM Plex Mono", ui-monospace, monospace',
    '"Fira Code", ui-monospace, monospace',
    '"Berkeley Mono", ui-monospace, monospace',
  ];
  const fontLabels = ["JetBrainsMono Nerd Font", "JetBrains Mono", "Iosevka", "IBM Plex Mono", "Fira Code", "Berkeley Mono"];

  return (
    <div className="tweaks">
      <div className="tweaks-head">
        <span>◉</span>
        <span>tweaks · ~/.ricerc</span>
        <span className="close" onClick={onClose}>×</span>
      </div>
      <div className="tweaks-body">
        <div className="tweak">
          <label>theme</label>
          <select value={state.theme} onChange={(e) => setState({...state, theme: e.target.value})}>
            {themes.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div className="tweak">
          <label>font family</label>
          <select value={state.font} onChange={(e) => setState({...state, font: e.target.value})}>
            {fonts.map((f, i) => <option key={f} value={f}>{fontLabels[i]}</option>)}
          </select>
        </div>
        <div className="tweak">
          <label>density</label>
          <div className="segmented">
            {(["compact","default","comfy"] as TweakDensity[]).map(d => (
              <button key={d} className={state.density === d ? "active" : ""} onClick={() => setState({...state, density: d})}>{d}</button>
            ))}
          </div>
        </div>
        <div className="tweak">
          <label>scanlines (CRT)</label>
          <div className="segmented">
            <button className={state.scanlines ? "" : "active"} onClick={() => setState({...state, scanlines: false})}>off</button>
            <button className={state.scanlines ? "active" : ""} onClick={() => setState({...state, scanlines: true})}>on</button>
          </div>
        </div>
        <div className="tweak">
          <label>hidden files</label>
          <div className="segmented">
            <button className={state.hidden ? "" : "active"} onClick={() => setState({...state, hidden: false})}>hide</button>
            <button className={state.hidden ? "active" : ""} onClick={() => setState({...state, hidden: true})}>show</button>
          </div>
        </div>
        <div className="tweak">
          <label>file extensions</label>
          <div className="segmented">
            <button className={state.showExtensions ? "" : "active"} onClick={() => setState({...state, showExtensions: false})}>hide</button>
            <button className={state.showExtensions ? "active" : ""} onClick={() => setState({...state, showExtensions: true})}>show</button>
          </div>
        </div>
        <div className="tweak">
          <label>git gutters</label>
          <div className="segmented">
            <button className={state.showGitGutters ? "" : "active"} onClick={() => setState({...state, showGitGutters: false})}>hide</button>
            <button className={state.showGitGutters ? "active" : ""} onClick={() => setState({...state, showGitGutters: true})}>show</button>
          </div>
        </div>
        <div className="tweak">
          <label>ignored (.gitignore)</label>
          <div className="segmented">
            <button className={state.showIgnored ? "" : "active"} onClick={() => setState({...state, showIgnored: false})}>hide</button>
            <button className={state.showIgnored ? "active" : ""} onClick={() => setState({...state, showIgnored: true})}>show</button>
          </div>
        </div>
        <div className="tweak">
          <label>folders first</label>
          <div className="segmented">
            <button className={state.foldersFirst ? "" : "active"} onClick={() => setState({...state, foldersFirst: false})}>off</button>
            <button className={state.foldersFirst ? "active" : ""} onClick={() => setState({...state, foldersFirst: true})}>on</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============= Bulk rename dialog =============

export interface BulkRenameItem {
  /** Absolute source path. */
  path: string;
  /** Filename (with extension) — what gets transformed. */
  name: string;
}

export interface BulkRenamePlan {
  path: string;
  from: string;
  to: string;
}

export interface BulkRenameDialogProps {
  items: BulkRenameItem[];
  onClose: () => void;
  /** Called once per file, sequentially, to perform the rename server-side. */
  renameOne: (from: string, to: string) => Promise<void>;
  /** Called after all renames complete (or threw) so parent can refresh. */
  onDone: () => void;
}

type CaseMode = "none" | "lower" | "upper" | "title";

function titleCase(s: string): string {
  return s.replace(/\w\S*/g, w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}

/** Split filename into (base, ext). Dotfiles (e.g. ".gitignore") have no ext. */
function splitName(name: string): { base: string; ext: string } {
  if (name.startsWith(".")) {
    // Keep leading-dot files whole. If they have a second dot, take that.
    const idx = name.indexOf(".", 1);
    if (idx < 0) return { base: name, ext: "" };
    return { base: name.slice(0, idx), ext: name.slice(idx) };
  }
  const i = name.lastIndexOf(".");
  if (i <= 0) return { base: name, ext: "" };
  return { base: name.slice(0, i), ext: name.slice(i) };
}

function parseFind(raw: string): { re: RegExp | null; literal: string } {
  const m = /^\/(.*)\/([gimsuy]*)$/.exec(raw);
  if (m) {
    try {
      // Always global so replace hits every occurrence.
      const flags = m[2].includes("g") ? m[2] : m[2] + "g";
      return { re: new RegExp(m[1], flags), literal: "" };
    } catch {
      return { re: null, literal: raw };
    }
  }
  return { re: null, literal: raw };
}

function applyCase(s: string, mode: CaseMode): string {
  switch (mode) {
    case "lower": return s.toLowerCase();
    case "upper": return s.toUpperCase();
    case "title": return titleCase(s);
    default: return s;
  }
}

function formatNumber(n: number, digits: number): string {
  const s = String(n);
  if (s.length >= digits) return s;
  return "0".repeat(digits - s.length) + s;
}

/** Substitute {n} / {n:NNN} style tokens using the row's sequence index. */
function expandNumbering(s: string, seq: number): string {
  return s.replace(/\{n(?::(\d+))?\}/g, (_m, d: string | undefined) => {
    const digits = d ? Math.max(1, parseInt(d, 10)) : 1;
    return formatNumber(seq, digits);
  });
}

export function BulkRenameDialog({ items, onClose, renameOne, onDone }: BulkRenameDialogProps) {
  const [find, setFind] = useState("");
  const [replace, setReplace] = useState("");
  const [prefix, setPrefix] = useState("");
  const [suffix, setSuffix] = useState("");
  const [numberEnabled, setNumberEnabled] = useState(false);
  const [numberStart, setNumberStart] = useState(1);
  const [numberDigits, setNumberDigits] = useState(3);
  const [caseMode, setCaseMode] = useState<CaseMode>("none");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const firstInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { firstInputRef.current?.focus(); }, []);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !running) { e.preventDefault(); onClose(); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose, running]);

  const preview = useMemo(() => {
    const { re, literal } = parseFind(find);
    return items.map((it, idx) => {
      const { base, ext } = splitName(it.name);
      let next = base;
      // 1. find / replace
      if (re) {
        try { next = next.replace(re, replace); } catch { /* bad regex */ }
      } else if (literal) {
        // Global literal replace — split/join.
        next = next.split(literal).join(replace);
      }
      // 2. numbering token substitution in prefix/suffix/replace
      const seq = numberEnabled ? numberStart + idx : 0;
      next = expandNumbering(next, seq);
      const pfx = numberEnabled ? expandNumbering(prefix, seq) : prefix;
      const sfx = numberEnabled ? expandNumbering(suffix, seq) : suffix;
      // 3. prefix / suffix
      next = pfx + next + sfx;
      // 4. case transform (ext preserved verbatim)
      next = applyCase(next, caseMode);
      const finalName = next + ext;
      return { path: it.path, from: it.name, to: finalName };
    });
  }, [items, find, replace, prefix, suffix, numberEnabled, numberStart, numberDigits, caseMode]);

  // Collisions: any duplicate target name in the batch, or no-op identity.
  const { collisions, changedCount } = useMemo(() => {
    const seen = new Map<string, number>();
    for (const p of preview) {
      seen.set(p.to, (seen.get(p.to) ?? 0) + 1);
    }
    const collisionSet = new Set<string>();
    for (const [name, count] of seen) {
      if (count > 1) collisionSet.add(name);
      if (!name) collisionSet.add(name);
    }
    let changed = 0;
    for (const p of preview) if (p.to !== p.from) changed++;
    return { collisions: collisionSet, changedCount: changed };
  }, [preview]);
  void numberDigits;

  const hasCollision = collisions.size > 0;
  const canRun = !running && !hasCollision && changedCount > 0;

  const run = async () => {
    if (!canRun) return;
    const plan = preview.filter(p => p.to !== p.from);
    setRunning(true);
    setErr(null);
    setProgress({ done: 0, total: plan.length });
    // Resolve sep from the first source path — all selections live in the same
    // directory, so this is consistent for the whole batch.
    const sep = (() => {
      const p = plan[0]?.path ?? "";
      return p.includes("\\") ? "\\" : "/";
    })();
    const dirOf = (p: string): string => {
      const trimmed = p.replace(/[\\/]+$/, "");
      const idx = Math.max(trimmed.lastIndexOf("\\"), trimmed.lastIndexOf("/"));
      if (idx < 0) return trimmed;
      if (/^[A-Za-z]:$/.test(trimmed.slice(0, idx))) return trimmed.slice(0, idx + 1);
      return trimmed.slice(0, idx);
    };
    try {
      for (let i = 0; i < plan.length; i++) {
        const item = plan[i];
        const parent = dirOf(item.path);
        const joiner = /^[A-Za-z]:$/.test(parent) ? "" : sep;
        const dst = parent + (parent.endsWith(sep) ? "" : joiner) + item.to;
        await renameOne(item.path, dst);
        setProgress({ done: i + 1, total: plan.length });
      }
      onDone();
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErr(msg);
      onDone();
    } finally {
      setRunning(false);
    }
  };

  const inputStyle: React.CSSProperties = {
    background: "var(--bg-0, #0f0f14)", color: "var(--fg-1)",
    border: "1px solid var(--fg-3)", borderRadius: 2,
    padding: "4px 8px", fontFamily: "var(--font-mono)", fontSize: 13,
    outline: "none",
  };
  const labelStyle: React.CSSProperties = {
    fontSize: 11, color: "var(--fg-3)", marginBottom: 2,
  };

  return (
    <div
      onClick={() => { if (!running) onClose(); }}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)",
        zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "90ch", maxWidth: "95vw", maxHeight: "90vh",
          background: "var(--bg-1, #1a1b26)", border: "1px solid var(--fg-3)",
          borderRadius: 4, display: "flex", flexDirection: "column",
          fontFamily: "var(--font-mono)", color: "var(--fg-1)",
        }}
      >
        <div
          style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "8px 12px", borderBottom: "1px solid var(--fg-3)",
            background: "var(--bg-2, #16161e)",
          }}
        >
          <span style={{ color: "var(--accent)" }}>✎ bulk rename · {items.length} file{items.length === 1 ? "" : "s"}</span>
          <span style={{ color: "var(--fg-3)", fontSize: 12 }}>
            {running
              ? `renaming ${progress?.done ?? 0}/${progress?.total ?? 0}…`
              : hasCollision
                ? `${collisions.size} collision${collisions.size === 1 ? "" : "s"}`
                : `${changedCount} change${changedCount === 1 ? "" : "s"}`}
          </span>
          <button
            onClick={onClose}
            disabled={running}
            style={{
              background: "transparent", border: "1px solid var(--fg-3)", color: "var(--fg-1)",
              padding: "2px 8px", cursor: running ? "not-allowed" : "pointer", borderRadius: 2,
            }}
          >×</button>
        </div>

        <div style={{
          padding: "10px 12px", borderBottom: "1px solid var(--fg-3)",
          display: "grid", gridTemplateColumns: "1fr 1fr", columnGap: 12, rowGap: 8,
        }}>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <span style={labelStyle}>find (use /regex/ for regex)</span>
            <input
              ref={firstInputRef}
              value={find}
              onChange={(e) => setFind(e.target.value)}
              placeholder="text or /pattern/i"
              style={inputStyle}
              disabled={running}
            />
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <span style={labelStyle}>replace ($1 for regex groups)</span>
            <input
              value={replace}
              onChange={(e) => setReplace(e.target.value)}
              placeholder="replacement"
              style={inputStyle}
              disabled={running}
            />
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <span style={labelStyle}>prefix</span>
            <input
              value={prefix}
              onChange={(e) => setPrefix(e.target.value)}
              placeholder="prepend… ({n:03} ok)"
              style={inputStyle}
              disabled={running}
            />
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <span style={labelStyle}>suffix</span>
            <input
              value={suffix}
              onChange={(e) => setSuffix(e.target.value)}
              placeholder="append… ({n:03} ok)"
              style={inputStyle}
              disabled={running}
            />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
              <input
                type="checkbox"
                checked={numberEnabled}
                onChange={(e) => setNumberEnabled(e.target.checked)}
                disabled={running}
              />
              numbering
            </label>
            <span style={{ fontSize: 11, color: "var(--fg-3)" }}>start</span>
            <input
              type="number"
              value={numberStart}
              onChange={(e) => setNumberStart(parseInt(e.target.value, 10) || 0)}
              style={{ ...inputStyle, width: "7ch" }}
              disabled={running || !numberEnabled}
            />
            <span style={{ fontSize: 11, color: "var(--fg-3)" }}>digits</span>
            <input
              type="number"
              min={1}
              max={9}
              value={numberDigits}
              onChange={(e) => setNumberDigits(Math.max(1, parseInt(e.target.value, 10) || 1))}
              style={{ ...inputStyle, width: "5ch" }}
              disabled={running || !numberEnabled}
            />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 11, color: "var(--fg-3)" }}>case</span>
            <div className="segmented" style={{ display: "flex" }}>
              {(["none", "lower", "upper", "title"] as CaseMode[]).map(m => (
                <button
                  key={m}
                  onClick={() => setCaseMode(m)}
                  disabled={running}
                  style={{
                    background: caseMode === m ? "var(--accent)" : "transparent",
                    color: caseMode === m ? "var(--bg-0, #0f0f14)" : "var(--fg-1)",
                    border: "1px solid var(--fg-3)", padding: "2px 8px",
                    fontSize: 12, cursor: running ? "not-allowed" : "pointer",
                    fontFamily: "var(--font-mono)",
                  }}
                >{m}</button>
              ))}
            </div>
          </div>
        </div>

        <div style={{ overflow: "auto", flex: 1, fontSize: 12, lineHeight: 1.5 }}>
          <div style={{
            display: "grid", gridTemplateColumns: "1fr 1fr",
            padding: "4px 12px", color: "var(--fg-3)",
            borderBottom: "1px solid var(--fg-3)", position: "sticky", top: 0,
            background: "var(--bg-2, #16161e)",
          }}>
            <span>before</span>
            <span>after</span>
          </div>
          {preview.map((p, i) => {
            const dup = collisions.has(p.to);
            const unchanged = p.to === p.from;
            return (
              <div key={i} style={{
                display: "grid", gridTemplateColumns: "1fr 1fr",
                padding: "2px 12px",
                background: dup ? "rgba(255,80,80,0.12)" : "transparent",
              }}>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {p.from}
                </span>
                <span style={{
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  color: dup ? "var(--red, #f7768e)" : unchanged ? "var(--fg-3)" : "var(--green, #9ece6a)",
                }}>
                  {p.to || "(empty)"}
                </span>
              </div>
            );
          })}
        </div>

        {err && (
          <div style={{
            padding: "6px 12px", borderTop: "1px solid var(--fg-3)",
            color: "var(--red, #f7768e)", fontSize: 12,
          }}>
            {err}
          </div>
        )}

        <div style={{
          display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8,
          padding: "8px 12px", borderTop: "1px solid var(--fg-3)",
          background: "var(--bg-2, #16161e)",
        }}>
          {hasCollision && (
            <span style={{ color: "var(--red, #f7768e)", fontSize: 12, marginRight: "auto" }}>
              duplicate target names — resolve before renaming
            </span>
          )}
          <button
            onClick={onClose}
            disabled={running}
            style={{
              background: "transparent", border: "1px solid var(--fg-3)", color: "var(--fg-1)",
              padding: "4px 12px", cursor: running ? "not-allowed" : "pointer",
              borderRadius: 2, fontFamily: "var(--font-mono)", fontSize: 12,
            }}
          >cancel</button>
          <button
            onClick={run}
            disabled={!canRun}
            style={{
              background: canRun ? "var(--accent)" : "var(--bg-0, #0f0f14)",
              color: canRun ? "var(--bg-0, #0f0f14)" : "var(--fg-3)",
              border: "1px solid var(--accent)",
              padding: "4px 12px", cursor: canRun ? "pointer" : "not-allowed",
              borderRadius: 2, fontFamily: "var(--font-mono)", fontSize: 12,
              fontWeight: 600,
            }}
          >
            {running
              ? `renaming ${progress?.done ?? 0}/${progress?.total ?? 0}…`
              : `rename ${changedCount} file${changedCount === 1 ? "" : "s"}`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ============= Paste Special dialog =============

export interface PasteSpecialItem {
  /** Absolute source path. */
  path: string;
  /** FileEntry.kind — "folder" means skip hash verify. */
  kind: string;
}

export type PasteSpecialMode = "move" | "copy" | "copy-verify";

export interface PasteSpecialDialogProps {
  items: PasteSpecialItem[];
  /** Destination directory (active pane cwd). */
  dstDir: string;
  /** Clipboard mode at time of open — "cut" clears clipboard on success. */
  clipboardMode: "copy" | "cut";
  copyEntry: (from: string, to: string) => Promise<void>;
  moveEntry: (from: string, to: string) => Promise<void>;
  onClose: () => void;
  /** Called after completion with whether clipboard should be cleared and refresh requested. */
  onDone: (clearClipboard: boolean) => void;
}

interface RowStatus {
  path: string;
  name: string;
  kind: string;
  /** pending | running | ok | fail */
  state: "pending" | "running" | "ok" | "fail";
  message?: string;
}

function baseOf(p: string): string {
  const trimmed = p.replace(/[\\/]+$/, "");
  const idx = Math.max(trimmed.lastIndexOf("\\"), trimmed.lastIndexOf("/"));
  return idx < 0 ? trimmed : trimmed.slice(idx + 1);
}

function joinPath(dir: string, name: string): string {
  const sep = dir.includes("\\") ? "\\" : "/";
  if (!dir) return name;
  // Drive root like "C:\" — already ends in sep.
  if (dir.endsWith("\\") || dir.endsWith("/")) return dir + name;
  // Bare drive like "C:" — attach separator.
  if (/^[A-Za-z]:$/.test(dir)) return dir + "\\" + name;
  return dir + sep + name;
}

export function PasteSpecialDialog({
  items,
  dstDir,
  clipboardMode,
  copyEntry,
  moveEntry,
  onClose,
  onDone,
}: PasteSpecialDialogProps) {
  const [mode, setMode] = useState<PasteSpecialMode>(
    clipboardMode === "cut" ? "move" : "copy",
  );
  const [running, setRunning] = useState(false);
  const [rows, setRows] = useState<RowStatus[]>(() =>
    items.map(it => ({
      path: it.path,
      name: baseOf(it.path),
      kind: it.kind,
      state: "pending" as const,
    })),
  );

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !running) { e.preventDefault(); onClose(); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose, running]);

  const preview = items.slice(0, 5).map(it => baseOf(it.path));
  const extra = items.length > 5 ? items.length - 5 : 0;

  const run = async () => {
    if (running || items.length === 0) return;
    setRunning(true);
    let anyFail = false;
    // Local mutable copy so we can update rows incrementally.
    const working: RowStatus[] = rows.map(r => ({ ...r, state: "pending", message: undefined }));
    setRows(working.slice());
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const name = baseOf(it.path);
      const dst = joinPath(dstDir, name);
      working[i] = { ...working[i], state: "running" };
      setRows(working.slice());
      try {
        if (mode === "move") {
          await moveEntry(it.path, dst);
          working[i] = { ...working[i], state: "ok", message: "moved" };
        } else if (mode === "copy") {
          await copyEntry(it.path, dst);
          working[i] = { ...working[i], state: "ok", message: "copied" };
        } else {
          // copy + verify
          await copyEntry(it.path, dst);
          if (it.kind === "folder") {
            working[i] = { ...working[i], state: "ok", message: "copied (dir — not hashed)" };
          } else {
            const [h1, h2] = await Promise.all([hashSha256(it.path), hashSha256(dst)]);
            if (h1 === h2) {
              working[i] = { ...working[i], state: "ok", message: `ok ${h1.slice(0, 12)}…` };
            } else {
              anyFail = true;
              working[i] = { ...working[i], state: "fail", message: `FAIL hash mismatch` };
            }
          }
        }
      } catch (e) {
        anyFail = true;
        const msg = e instanceof Error ? e.message : String(e);
        working[i] = { ...working[i], state: "fail", message: msg };
      }
      setRows(working.slice());
    }
    setRunning(false);
    // Only clear clipboard for cut+move when nothing failed; mirrors vanilla Paste.
    const clear = clipboardMode === "cut" && mode === "move" && !anyFail;
    onDone(clear);
  };

  const doneCount = rows.filter(r => r.state === "ok" || r.state === "fail").length;
  const failCount = rows.filter(r => r.state === "fail").length;
  const allDone = !running && doneCount === rows.length && rows.length > 0;

  const radioRow = (value: PasteSpecialMode, label: string, hint: string) => (
    <label
      key={value}
      style={{
        display: "flex", alignItems: "flex-start", gap: 8, padding: "4px 0",
        cursor: running ? "not-allowed" : "pointer", opacity: running ? 0.6 : 1,
      }}
    >
      <input
        type="radio"
        name="paste-special-mode"
        checked={mode === value}
        onChange={() => setMode(value)}
        disabled={running}
        style={{ marginTop: 3 }}
      />
      <span style={{ display: "flex", flexDirection: "column" }}>
        <span style={{ fontSize: 13 }}>{label}</span>
        <span style={{ fontSize: 11, color: "var(--fg-3)" }}>{hint}</span>
      </span>
    </label>
  );

  const statusColor = (s: RowStatus["state"]): string => {
    switch (s) {
      case "ok": return "var(--green, #9ece6a)";
      case "fail": return "var(--red, #f7768e)";
      case "running": return "var(--accent)";
      default: return "var(--fg-3)";
    }
  };
  const statusGlyph = (s: RowStatus["state"]): string => {
    switch (s) {
      case "ok": return "✓";
      case "fail": return "✗";
      case "running": return "…";
      default: return "·";
    }
  };

  return (
    <div
      onClick={() => { if (!running) onClose(); }}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)",
        zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "80ch", maxWidth: "95vw", maxHeight: "90vh",
          background: "var(--bg-1, #1a1b26)", border: "1px solid var(--fg-3)",
          borderRadius: 4, display: "flex", flexDirection: "column",
          fontFamily: "var(--font-mono)", color: "var(--fg-1)",
        }}
      >
        <div
          style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "8px 12px", borderBottom: "1px solid var(--fg-3)",
            background: "var(--bg-2, #16161e)",
          }}
        >
          <span style={{ color: "var(--accent)" }}>
            ⎘ paste special · {items.length} item{items.length === 1 ? "" : "s"}
          </span>
          <span style={{ color: "var(--fg-3)", fontSize: 12 }}>
            {running
              ? `working ${doneCount}/${rows.length}…`
              : allDone
                ? failCount > 0
                  ? `${failCount} failed / ${rows.length}`
                  : `done · ${rows.length}`
                : `clipboard: ${clipboardMode}`}
          </span>
          <button
            onClick={onClose}
            disabled={running}
            style={{
              background: "transparent", border: "1px solid var(--fg-3)", color: "var(--fg-1)",
              padding: "2px 8px", cursor: running ? "not-allowed" : "pointer", borderRadius: 2,
            }}
          >×</button>
        </div>

        <div style={{
          padding: "10px 12px", borderBottom: "1px solid var(--fg-3)",
          display: "flex", flexDirection: "column", gap: 6, fontSize: 12,
        }}>
          <div>
            <span style={{ color: "var(--fg-3)" }}>source{items.length === 1 ? "" : "s"}: </span>
            <span>
              {preview.join(", ")}
              {extra > 0 ? ` +${extra} more` : ""}
            </span>
          </div>
          <div>
            <span style={{ color: "var(--fg-3)" }}>destination: </span>
            <span>{dstDir || "(unknown)"}</span>
          </div>
        </div>

        <div style={{
          padding: "10px 12px", borderBottom: "1px solid var(--fg-3)",
          display: "flex", flexDirection: "column", gap: 2,
        }}>
          {radioRow("move", "Move", "rename/relocate — backend moveEntry")}
          {radioRow("copy", "Copy", "duplicate — backend copyEntry")}
          {radioRow("copy-verify", "Copy + verify SHA256",
            "copy then hash both sides and compare (files only; dirs skipped)")}
        </div>

        <div style={{ overflow: "auto", flex: 1, fontSize: 12, lineHeight: 1.5 }}>
          <div style={{
            display: "grid", gridTemplateColumns: "2ch 1fr 24ch",
            padding: "4px 12px", color: "var(--fg-3)",
            borderBottom: "1px solid var(--fg-3)", position: "sticky", top: 0,
            background: "var(--bg-2, #16161e)", gap: 8,
          }}>
            <span></span>
            <span>source</span>
            <span>status</span>
          </div>
          {rows.map((r, i) => (
            <div key={i} style={{
              display: "grid", gridTemplateColumns: "2ch 1fr 24ch",
              padding: "2px 12px", gap: 8,
              background: r.state === "fail" ? "rgba(255,80,80,0.12)" : "transparent",
            }}>
              <span style={{ color: statusColor(r.state) }}>{statusGlyph(r.state)}</span>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {r.name}{r.kind === "folder" ? "/" : ""}
              </span>
              <span style={{
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                color: statusColor(r.state),
              }}>
                {r.message ?? (r.state === "pending" ? "pending" : r.state)}
              </span>
            </div>
          ))}
        </div>

        <div style={{
          display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8,
          padding: "8px 12px", borderTop: "1px solid var(--fg-3)",
          background: "var(--bg-2, #16161e)",
        }}>
          {failCount > 0 && !running && (
            <span style={{ color: "var(--red, #f7768e)", fontSize: 12, marginRight: "auto" }}>
              {failCount} failure{failCount === 1 ? "" : "s"} — see rows above
            </span>
          )}
          <button
            onClick={onClose}
            disabled={running}
            style={{
              background: "transparent", border: "1px solid var(--fg-3)", color: "var(--fg-1)",
              padding: "4px 12px", cursor: running ? "not-allowed" : "pointer",
              borderRadius: 2, fontFamily: "var(--font-mono)", fontSize: 12,
            }}
          >{allDone ? "close" : "cancel"}</button>
          <button
            onClick={run}
            disabled={running || items.length === 0 || allDone}
            style={{
              background: (running || allDone) ? "var(--bg-0, #0f0f14)" : "var(--accent)",
              color: (running || allDone) ? "var(--fg-3)" : "var(--bg-0, #0f0f14)",
              border: "1px solid var(--accent)",
              padding: "4px 12px",
              cursor: (running || allDone) ? "not-allowed" : "pointer",
              borderRadius: 2, fontFamily: "var(--font-mono)", fontSize: 12,
              fontWeight: 600,
            }}
          >
            {running
              ? `working ${doneCount}/${rows.length}…`
              : mode === "move"
                ? `move ${items.length} item${items.length === 1 ? "" : "s"}`
                : mode === "copy"
                  ? `copy ${items.length} item${items.length === 1 ? "" : "s"}`
                  : `copy + verify ${items.length}`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ============= BlameDialog =============
export interface BlameDialogProps {
  blame: { path: string; lines: BlameLine[] };
  onClose: () => void;
}

export function BlameDialog({ blame, onClose }: BlameDialogProps) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const shortName = (() => {
    const t = blame.path.replace(/[\\/]+$/, "");
    const i = Math.max(t.lastIndexOf("\\"), t.lastIndexOf("/"));
    return i < 0 ? t : t.slice(i + 1);
  })();

  const fmtDate = (ms: number): string => {
    if (!ms) return "—";
    const d = new Date(ms);
    const pad = (n: number) => n.toString().padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  };

  const truncAuthor = (a: string): string => (a.length > 16 ? a.slice(0, 16) : a);
  const shortSha = (s: string): string => s.slice(0, 7);

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)",
        zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "120ch", maxWidth: "95vw", maxHeight: "90vh",
          background: "var(--bg-1, #1a1b26)", border: "1px solid var(--fg-3)",
          borderRadius: 4, display: "flex", flexDirection: "column",
          fontFamily: "var(--font-mono)", color: "var(--fg-1)",
        }}
      >
        <div
          style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "8px 12px", borderBottom: "1px solid var(--fg-3)",
            background: "var(--bg-2, #16161e)",
          }}
        >
          <span style={{ color: "var(--accent)" }}>
            ⎇ git blame — {shortName}
          </span>
          <span style={{ color: "var(--fg-3)", fontSize: 12 }}>
            {blame.lines.length} line{blame.lines.length === 1 ? "" : "s"} · esc/click to close
          </span>
          <button
            onClick={onClose}
            style={{
              background: "transparent", border: "1px solid var(--fg-3)", color: "var(--fg-1)",
              padding: "2px 8px", cursor: "pointer", borderRadius: 2,
            }}
            aria-label="close"
          >×</button>
        </div>

        <style>{`
          .gh-blame-row:hover { background: var(--bg-3, rgba(255,255,255,0.08)) !important; }
          .gh-blame-row.odd { background: var(--bg-2, rgba(255,255,255,0.025)); }
          .gh-blame-row.even { background: transparent; }
        `}</style>

        <div style={{ overflow: "auto", flex: 1, fontSize: 12, lineHeight: 1.5 }}>
          {blame.lines.length === 0 ? (
            <div style={{ color: "var(--fg-3)", padding: "8px 12px" }}>(no blame data)</div>
          ) : blame.lines.map((ln, i) => (
            <div
              key={i}
              className={`gh-blame-row ${i % 2 === 1 ? "odd" : "even"}`}
              style={{
                display: "grid",
                gridTemplateColumns: "8ch 17ch 11ch 6ch 1fr",
                gap: 8,
                padding: "2px 12px",
                whiteSpace: "pre",
              }}
            >
              <span style={{ color: "var(--yellow, #e0af68)", overflow: "hidden", textOverflow: "ellipsis" }}>
                {shortSha(ln.sha)}
              </span>
              <span style={{ color: "var(--accent-2, var(--blue, #7aa2f7))", overflow: "hidden", textOverflow: "ellipsis" }}>
                {truncAuthor(ln.author)}
              </span>
              <span style={{ color: "var(--fg-3)" }}>{fmtDate(ln.timestamp_ms)}</span>
              <span style={{ color: "var(--fg-3)", textAlign: "right" }}>{ln.line_no}</span>
              <span style={{ color: "var(--fg-1)", overflow: "hidden", textOverflow: "ellipsis" }}>
                {ln.content}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ============= GitOutputDialog =============
export interface GitOutputState {
  title: string;
  output: string;
  ok: boolean;
  exit?: number;
  stderr?: string;
}

export interface GitOutputDialogProps {
  state: GitOutputState;
  onClose: () => void;
}

export function GitOutputDialog({ state, onClose }: GitOutputDialogProps) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const statusColor = state.ok ? "var(--green, #9ece6a)" : "var(--red, #f7768e)";
  const statusLabel = state.ok ? "ok" : `exit ${state.exit ?? "?"}`;

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)",
        zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100ch", maxWidth: "95vw", maxHeight: "85vh",
          background: "var(--bg-1, #1a1b26)", border: "1px solid var(--fg-3)",
          borderRadius: 4, display: "flex", flexDirection: "column",
          fontFamily: "var(--font-mono)", color: "var(--fg-1)",
        }}
      >
        <div
          style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "8px 12px", borderBottom: "1px solid var(--fg-3)",
            background: "var(--bg-2, #16161e)",
          }}
        >
          <span style={{ color: "var(--accent)" }}>⎇ {state.title}</span>
          <span style={{ color: statusColor, fontSize: 12 }}>{statusLabel}</span>
          <button
            onClick={onClose}
            style={{
              background: "transparent", border: "1px solid var(--fg-3)", color: "var(--fg-1)",
              padding: "2px 8px", cursor: "pointer", borderRadius: 2,
            }}
            aria-label="close"
          >×</button>
        </div>
        <pre
          style={{
            margin: 0, padding: "10px 12px", overflow: "auto", flex: 1,
            fontSize: 12, lineHeight: 1.45, whiteSpace: "pre-wrap", wordBreak: "break-word",
            color: "var(--fg-1)",
          }}
        >{state.output || "(no output)"}</pre>
        {!state.ok && state.stderr && state.stderr !== state.output && (
          <pre
            style={{
              margin: 0, padding: "8px 12px", borderTop: "1px solid var(--fg-3)",
              background: "var(--bg-2, #16161e)", color: "var(--red, #f7768e)",
              fontSize: 12, lineHeight: 1.45, whiteSpace: "pre-wrap",
              maxHeight: "30vh", overflow: "auto",
            }}
          >{state.stderr}</pre>
        )}
      </div>
    </div>
  );
}

// ============= HexDialog =============
export interface HexDialogProps {
  path: string;
  hex: string;
  onClose: () => void;
}

export function HexDialog({ path, hex, onClose }: HexDialogProps) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onClose(); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const shortName = (() => {
    const t = path.replace(/[\\/]+$/, "");
    const i = Math.max(t.lastIndexOf("\\"), t.lastIndexOf("/"));
    return i < 0 ? t : t.slice(i + 1);
  })();

  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)",
      zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        width: "90ch", maxWidth: "95vw", maxHeight: "90vh",
        background: "var(--bg-1, #1a1b26)", border: "1px solid var(--fg-3)",
        borderRadius: 4, display: "flex", flexDirection: "column",
        fontFamily: "var(--font-mono)", color: "var(--fg-1)",
      }}>
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "8px 12px", borderBottom: "1px solid var(--fg-3)",
          background: "var(--bg-2, #16161e)",
        }}>
          <span style={{ color: "var(--accent)" }}>⎙ hex — {shortName}</span>
          <span style={{ color: "var(--fg-3)", fontSize: 12 }}>esc/click to close</span>
          <button onClick={onClose} style={{
            background: "transparent", border: "1px solid var(--fg-3)", color: "var(--fg-1)",
            padding: "2px 8px", cursor: "pointer", borderRadius: 2,
          }} aria-label="close">×</button>
        </div>
        <pre style={{
          overflow: "auto", flex: 1, margin: 0, padding: "8px 12px",
          fontSize: 12, lineHeight: 1.45, whiteSpace: "pre", color: "var(--fg-1)",
        }}>{hex || "(empty)"}</pre>
      </div>
    </div>
  );
}

// ============= DiffDialog =============
export interface DiffDialogProps {
  a: string;
  b: string;
  diff: string;
  onClose: () => void;
}

export function DiffDialog({ a, b, diff, onClose }: DiffDialogProps) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onClose(); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const base = (p: string): string => {
    const t = p.replace(/[\\/]+$/, "");
    const i = Math.max(t.lastIndexOf("\\"), t.lastIndexOf("/"));
    return i < 0 ? t : t.slice(i + 1);
  };

  const lines = diff.split("\n");

  const colorFor = (line: string): string => {
    if (line.startsWith("+++") || line.startsWith("---")) return "var(--fg-3)";
    if (line.startsWith("@@")) return "var(--accent, var(--cyan))";
    if (line.startsWith("+")) return "var(--green, #9ece6a)";
    if (line.startsWith("-")) return "var(--red, #f7768e)";
    return "var(--fg-1)";
  };

  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)",
      zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        width: "120ch", maxWidth: "95vw", maxHeight: "90vh",
        background: "var(--bg-1, #1a1b26)", border: "1px solid var(--fg-3)",
        borderRadius: 4, display: "flex", flexDirection: "column",
        fontFamily: "var(--font-mono)", color: "var(--fg-1)",
      }}>
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "8px 12px", borderBottom: "1px solid var(--fg-3)",
          background: "var(--bg-2, #16161e)",
        }}>
          <span style={{ color: "var(--accent)" }}>⎘ diff — {base(a)} ↔ {base(b)}</span>
          <span style={{ color: "var(--fg-3)", fontSize: 12 }}>esc/click to close</span>
          <button onClick={onClose} style={{
            background: "transparent", border: "1px solid var(--fg-3)", color: "var(--fg-1)",
            padding: "2px 8px", cursor: "pointer", borderRadius: 2,
          }} aria-label="close">×</button>
        </div>
        <div style={{ overflow: "auto", flex: 1, fontSize: 12, lineHeight: 1.5, padding: "4px 0" }}>
          {diff.trim() === "" ? (
            <div style={{ color: "var(--fg-3)", padding: "8px 12px" }}>(files are identical)</div>
          ) : lines.map((line, i) => (
            <div key={i} style={{
              color: colorFor(line), padding: "0 12px", whiteSpace: "pre",
            }}>{line || " "}</div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ============= PropertiesDialog =============
export interface PropertiesDialogProps {
  entry: FileEntry | null;
  onClose: () => void;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const kb = n / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(2)} GB`;
}

export function PropertiesDialog({ entry, onClose }: PropertiesDialogProps) {
  const [sha, setSha] = useState<string | null>(null);
  const [hashing, setHashing] = useState(false);
  const [hashErr, setHashErr] = useState<string | null>(null);

  useEffect(() => {
    setSha(null);
    setHashing(false);
    setHashErr(null);
  }, [entry?.path]);

  useEffect(() => {
    if (!entry) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onClose(); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [entry, onClose]);

  if (!entry) return null;

  const isFolder = entry.kind === "folder";
  const computeHash = async () => {
    if (isFolder || hashing) return;
    setHashing(true);
    setHashErr(null);
    try {
      const hex = await hashSha256(entry.path);
      setSha(hex);
    } catch (err) {
      setHashErr(err instanceof Error ? err.message : String(err));
    } finally {
      setHashing(false);
    }
  };

  const rows: Array<[string, React.ReactNode]> = [
    ["name", entry.name],
    ["path", entry.path],
    ["kind", entry.kind],
    ["size", isFolder ? "—" : formatBytes(entry.size)],
    ["modified", entry.modified_ms ? new Date(entry.modified_ms).toLocaleString() : "—"],
    ["extension", entry.ext && entry.ext.length > 0 ? entry.ext : "—"],
    ["hidden", entry.hidden ? "yes" : "no"],
    ["symlink", entry.is_symlink ? "yes" : "no"],
    ["git", entry.git ?? "—"],
    [
      "sha256",
      isFolder ? (
        <span style={{ color: "var(--fg-3)" }}>— (folder)</span>
      ) : sha ? (
        <span style={{ wordBreak: "break-all" }}>{sha}</span>
      ) : hashErr ? (
        <span style={{ color: "var(--red, #f7768e)" }}>error: {hashErr}</span>
      ) : (
        <button
          onClick={() => { void computeHash(); }}
          disabled={hashing}
          style={{
            background: "transparent", border: "1px solid var(--fg-3)", color: "var(--fg-1)",
            padding: "2px 10px", cursor: hashing ? "wait" : "pointer",
            borderRadius: 2, fontFamily: "inherit", fontSize: 12,
          }}
        >{hashing ? "computing…" : "Compute…"}</button>
      ),
    ],
  ];

  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)",
      zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        width: "64ch", maxWidth: "95vw", maxHeight: "85vh",
        background: "var(--bg-1, #1a1b26)", border: "1px solid var(--fg-3)",
        borderRadius: 4, display: "flex", flexDirection: "column",
        fontFamily: "var(--font-mono)", color: "var(--fg-1)",
      }}>
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "8px 12px", borderBottom: "1px solid var(--fg-3)",
          background: "var(--bg-2, #16161e)",
        }}>
          <span style={{ color: "var(--accent)" }}>ℹ properties</span>
          <button onClick={onClose} style={{
            background: "transparent", border: "1px solid var(--fg-3)", color: "var(--fg-1)",
            padding: "2px 8px", cursor: "pointer", borderRadius: 2,
          }}>×</button>
        </div>
        <div style={{ padding: "10px 12px", overflow: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <tbody>
              {rows.map(([k, v]) => (
                <tr key={k}>
                  <td style={{
                    color: "var(--fg-3)", padding: "4px 12px 4px 0", verticalAlign: "top",
                    width: "12ch", whiteSpace: "nowrap",
                  }}>{k}</td>
                  <td style={{ padding: "4px 0", verticalAlign: "top", wordBreak: "break-all" }}>{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{
          padding: "8px 12px", borderTop: "1px solid var(--fg-3)",
          display: "flex", justifyContent: "flex-end", gap: 6,
          background: "var(--bg-2, #16161e)",
        }}>
          <button onClick={onClose} style={{
            background: "transparent", border: "1px solid var(--fg-3)", color: "var(--fg-1)",
            padding: "4px 12px", cursor: "pointer", borderRadius: 2, fontFamily: "inherit",
          }}>close</button>
        </div>
      </div>
    </div>
  );
}

// ============= ConnectServerDialog =============
export interface ConnectServerDialogProps {
  onClose: () => void;
  onSave: (r: SavedRemote) => void;
}

export function ConnectServerDialog({ onClose, onSave }: ConnectServerDialogProps) {
  const [label, setLabel] = useState("");
  const [host, setHost] = useState("");
  const [path, setPath] = useState("");
  const labelRef = useRef<HTMLInputElement>(null);

  useEffect(() => { labelRef.current?.focus(); }, []);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onClose(); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  const canSave = label.trim().length > 0 && host.trim().length > 0;
  const submit = () => {
    if (!canSave) return;
    onSave({ label: label.trim(), host: host.trim(), path: path.trim() });
  };

  const inputStyle: React.CSSProperties = {
    background: "var(--bg-0, #0f0f14)", color: "var(--fg-1)",
    border: "1px solid var(--fg-3)", borderRadius: 2,
    padding: "4px 8px", fontFamily: "var(--font-mono)", fontSize: 13,
    outline: "none",
  };

  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)",
      zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        width: "52ch", maxWidth: "95vw",
        background: "var(--bg-1, #1a1b26)", border: "1px solid var(--fg-3)",
        borderRadius: 4, display: "flex", flexDirection: "column",
        fontFamily: "var(--font-mono)", color: "var(--fg-1)",
      }}>
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "8px 12px", borderBottom: "1px solid var(--fg-3)",
          background: "var(--bg-2, #16161e)",
        }}>
          <span style={{ color: "var(--accent)" }}>⌁ connect to server</span>
          <button onClick={onClose} style={{
            background: "transparent", border: "1px solid var(--fg-3)", color: "var(--fg-1)",
            padding: "2px 8px", cursor: "pointer", borderRadius: 2,
          }}>×</button>
        </div>
        <div style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11, color: "var(--fg-3)" }}>
            label
            <input ref={labelRef} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="home-nas" style={inputStyle} />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11, color: "var(--fg-3)" }}>
            user@host
            <input
              value={host}
              onChange={(e) => setHost(e.target.value)}
              placeholder="user@192.168.1.10"
              style={inputStyle}
              onKeyDown={(e) => { if (e.key === "Enter" && canSave) { e.preventDefault(); submit(); } }}
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11, color: "var(--fg-3)" }}>
            remote path (optional)
            <input
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder="/home/user"
              style={inputStyle}
              onKeyDown={(e) => { if (e.key === "Enter" && canSave) { e.preventDefault(); submit(); } }}
            />
          </label>
        </div>
        <div style={{
          padding: "8px 12px", borderTop: "1px solid var(--fg-3)",
          display: "flex", justifyContent: "flex-end", gap: 6,
          background: "var(--bg-2, #16161e)",
        }}>
          <button onClick={onClose} style={{
            background: "transparent", border: "1px solid var(--fg-3)", color: "var(--fg-1)",
            padding: "4px 12px", cursor: "pointer", borderRadius: 2, fontFamily: "inherit",
          }}>cancel</button>
          <button
            onClick={submit}
            disabled={!canSave}
            style={{
              background: canSave ? "var(--accent)" : "var(--bg-0)",
              border: "1px solid " + (canSave ? "var(--accent)" : "var(--fg-3)"),
              color: canSave ? "var(--bg-0)" : "var(--fg-3)",
              padding: "4px 12px", cursor: canSave ? "pointer" : "not-allowed",
              borderRadius: 2, fontFamily: "inherit",
            }}
          >save</button>
        </div>
      </div>
    </div>
  );
}

// ============= ManageRemotesDialog =============
export interface ManageRemotesDialogProps {
  remotes: SavedRemote[];
  onClose: () => void;
  onRemove: (idx: number) => void;
  onEdit?: (idx: number, next: SavedRemote) => void;
  onAdd: () => void;
}

export function ManageRemotesDialog({ remotes, onClose, onRemove, onEdit, onAdd }: ManageRemotesDialogProps) {
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [draft, setDraft] = useState<SavedRemote>({ label: "", host: "", path: "" });

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onClose(); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  const beginEdit = (i: number) => {
    const r = remotes[i];
    if (!r) return;
    setDraft({ label: r.label, host: r.host, path: r.path });
    setEditingIdx(i);
  };

  const commitEdit = () => {
    if (editingIdx == null) return;
    const label = draft.label.trim();
    const host = draft.host.trim();
    const path = draft.path.trim();
    if (!label || !host) return;
    onEdit?.(editingIdx, { label, host, path });
    setEditingIdx(null);
  };

  const cancelEdit = () => {
    setEditingIdx(null);
  };

  const requestRemove = async (i: number) => {
    const r = remotes[i];
    if (!r) return;
    const ok = await dialogs.showConfirm({
      title: "remove remote",
      message: `Remove "${r.label}"?`,
      danger: true,
      okLabel: "remove",
    });
    if (!ok) return;
    if (editingIdx === i) setEditingIdx(null);
    onRemove(i);
  };

  const inputStyle: React.CSSProperties = {
    background: "var(--bg-0, #0f0f14)", color: "var(--fg-1)",
    border: "1px solid var(--fg-3)", borderRadius: 2,
    padding: "3px 6px", fontFamily: "var(--font-mono)", fontSize: 12,
    outline: "none", minWidth: 0, width: "100%",
  };

  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)",
      zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        width: "68ch", maxWidth: "95vw", maxHeight: "80vh",
        background: "var(--bg-1, #1a1b26)", border: "1px solid var(--fg-3)",
        borderRadius: 4, display: "flex", flexDirection: "column",
        fontFamily: "var(--font-mono)", color: "var(--fg-1)",
      }}>
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "8px 12px", borderBottom: "1px solid var(--fg-3)",
          background: "var(--bg-2, #16161e)",
        }}>
          <span style={{ color: "var(--accent)" }}>⌁ manage remotes</span>
          <button onClick={onClose} style={{
            background: "transparent", border: "1px solid var(--fg-3)", color: "var(--fg-1)",
            padding: "2px 8px", cursor: "pointer", borderRadius: 2,
          }}>×</button>
        </div>
        <div style={{ padding: "6px 12px", borderBottom: "1px solid var(--fg-3)", fontSize: 11, color: "var(--fg-3)" }}>
          {remotes.length} remote{remotes.length === 1 ? "" : "s"}
        </div>
        <div style={{ overflow: "auto", flex: 1, padding: "6px 6px", display: "flex", flexDirection: "column", gap: 2 }}>
          {remotes.length === 0 && (
            <div style={{ color: "var(--fg-3)", padding: "12px", fontStyle: "italic", textAlign: "center" }}>
              no saved remotes — add one via the + button
            </div>
          )}
          {remotes.map((r, i) => {
            const isEditing = editingIdx === i;
            if (isEditing) {
              const canSave = draft.label.trim().length > 0 && draft.host.trim().length > 0;
              return (
                <div key={"edit-" + i} style={{
                  display: "grid", gridTemplateColumns: "14ch 1fr 1fr auto auto",
                  alignItems: "center", gap: 6,
                  padding: "4px 8px", borderRadius: 2,
                  background: "var(--bg-0, #0f0f14)",
                  border: "1px solid var(--accent)",
                }}>
                  <input
                    value={draft.label}
                    onChange={(e) => setDraft(d => ({ ...d, label: e.target.value }))}
                    placeholder="label"
                    style={inputStyle}
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && canSave) { e.preventDefault(); commitEdit(); }
                      else if (e.key === "Escape") { e.preventDefault(); cancelEdit(); }
                    }}
                  />
                  <input
                    value={draft.host}
                    onChange={(e) => setDraft(d => ({ ...d, host: e.target.value }))}
                    placeholder="user@host"
                    style={inputStyle}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && canSave) { e.preventDefault(); commitEdit(); }
                      else if (e.key === "Escape") { e.preventDefault(); cancelEdit(); }
                    }}
                  />
                  <input
                    value={draft.path}
                    onChange={(e) => setDraft(d => ({ ...d, path: e.target.value }))}
                    placeholder="/path (optional)"
                    style={inputStyle}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && canSave) { e.preventDefault(); commitEdit(); }
                      else if (e.key === "Escape") { e.preventDefault(); cancelEdit(); }
                    }}
                  />
                  <button
                    onClick={commitEdit}
                    disabled={!canSave}
                    title="save"
                    style={{
                      background: canSave ? "var(--accent)" : "transparent",
                      border: "1px solid " + (canSave ? "var(--accent)" : "var(--fg-3)"),
                      color: canSave ? "var(--bg-0)" : "var(--fg-3)",
                      padding: "1px 8px", cursor: canSave ? "pointer" : "not-allowed",
                      borderRadius: 2, fontFamily: "inherit", fontSize: 11,
                    }}
                  >save</button>
                  <button
                    onClick={cancelEdit}
                    title="cancel"
                    style={{
                      background: "transparent", border: "1px solid var(--fg-3)", color: "var(--fg-1)",
                      padding: "1px 8px", cursor: "pointer",
                      borderRadius: 2, fontFamily: "inherit", fontSize: 11,
                    }}
                  >×</button>
                </div>
              );
            }
            return (
              <div key={`${i}-${r.label}`} style={{
                display: "flex", alignItems: "center", gap: 6,
                padding: "4px 8px", borderRadius: 2,
                background: "var(--bg-0, #0f0f14)",
                border: "1px solid transparent",
              }}>
                <span style={{
                  color: "var(--fg-3)", fontSize: 11, minWidth: "2ch", textAlign: "right",
                }}>{i + 1}</span>
                <div style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
                  <div style={{
                    color: "var(--fg-1)", fontSize: 12,
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>{r.label}</div>
                  <div style={{
                    color: "var(--fg-3)", fontSize: 10,
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>{r.host}{r.path ? " · " + r.path : ""}</div>
                </div>
                {onEdit && (
                  <button
                    onClick={() => beginEdit(i)}
                    title="edit"
                    style={{
                      background: "transparent", border: "1px solid var(--fg-3)", color: "var(--fg-1)",
                      padding: "1px 8px", cursor: "pointer",
                      borderRadius: 2, fontFamily: "inherit", fontSize: 11,
                    }}
                  >edit</button>
                )}
                <button
                  onClick={() => { void requestRemove(i); }}
                  title="remove remote"
                  style={{
                    background: "transparent", border: "1px solid var(--fg-3)", color: "var(--red, #f7768e)",
                    padding: "1px 8px", cursor: "pointer",
                    borderRadius: 2, fontFamily: "inherit", fontSize: 11,
                  }}
                >×</button>
              </div>
            );
          })}
        </div>
        <div style={{
          padding: "8px 12px", borderTop: "1px solid var(--fg-3)",
          display: "flex", justifyContent: "space-between", gap: 6,
          background: "var(--bg-2, #16161e)",
        }}>
          <button
            onClick={onAdd}
            title="add remote"
            style={{
              background: "transparent", border: "1px solid var(--accent)", color: "var(--accent)",
              padding: "4px 12px", cursor: "pointer", borderRadius: 2, fontFamily: "inherit",
            }}
          >+ add remote</button>
          <button onClick={onClose} style={{
            background: "transparent", border: "1px solid var(--fg-3)", color: "var(--fg-1)",
            padding: "4px 12px", cursor: "pointer", borderRadius: 2, fontFamily: "inherit",
          }}>close</button>
        </div>
      </div>
    </div>
  );
}

// ============= TagPickerDialog =============
export interface TagPickerDialogProps {
  path: string;
  onClose: () => void;
  onSaved: (tagStore: Record<string, string[]>) => void;
}

export function TagPickerDialog({ path, onClose, onSaved }: TagPickerDialogProps) {
  const [store, setStore] = useState<Record<string, string[]>>({});
  const [newTag, setNewTag] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const newTagRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void (async () => {
      const s = await readTags();
      setStore(s);
      setLoaded(true);
    })();
  }, []);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onClose(); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const s of SEED_TAGS) set.add(s.label);
    for (const tags of Object.values(store)) for (const t of tags) set.add(t);
    return Array.from(set);
  }, [store]);

  const current = store[path] ?? [];
  const hasTag = (t: string) => current.includes(t);

  const toggleTag = (t: string) => {
    setStore(prev => {
      const cur = prev[path] ?? [];
      const next = { ...prev };
      if (cur.includes(t)) {
        const filtered = cur.filter(x => x !== t);
        if (filtered.length === 0) delete next[path];
        else next[path] = filtered;
      } else {
        next[path] = [...cur, t];
      }
      return next;
    });
  };

  const addNewTag = () => {
    const t = newTag.trim();
    if (!t) return;
    setStore(prev => {
      const cur = prev[path] ?? [];
      if (cur.includes(t)) return prev;
      return { ...prev, [path]: [...cur, t] };
    });
    setNewTag("");
    newTagRef.current?.focus();
  };

  const save = async () => {
    setSaving(true);
    try {
      await writeTags(store);
      onSaved(store);
    } finally {
      setSaving(false);
    }
  };

  const shownTags = useMemo(() => {
    const seedLabels = SEED_TAGS.map(s => s.label);
    const seedSet = new Set(seedLabels);
    const rest = new Set<string>();
    for (const t of allTags) if (!seedSet.has(t)) rest.add(t);
    for (const t of current) if (!seedSet.has(t)) rest.add(t);
    return [...seedLabels, ...Array.from(rest).sort()];
  }, [allTags, current]);

  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)",
      zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        width: "48ch", maxWidth: "95vw", maxHeight: "80vh",
        background: "var(--bg-1, #1a1b26)", border: "1px solid var(--fg-3)",
        borderRadius: 4, display: "flex", flexDirection: "column",
        fontFamily: "var(--font-mono)", color: "var(--fg-1)",
      }}>
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "8px 12px", borderBottom: "1px solid var(--fg-3)",
          background: "var(--bg-2, #16161e)",
        }}>
          <span style={{ color: "var(--accent)" }}># tag picker</span>
          <button onClick={onClose} style={{
            background: "transparent", border: "1px solid var(--fg-3)", color: "var(--fg-1)",
            padding: "2px 8px", cursor: "pointer", borderRadius: 2,
          }}>×</button>
        </div>
        <div style={{ padding: "6px 12px", borderBottom: "1px solid var(--fg-3)", fontSize: 11, color: "var(--fg-3)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {path}
        </div>
        <div style={{ overflow: "auto", flex: 1, padding: "8px 12px", display: "flex", flexDirection: "column", gap: 4 }}>
          {!loaded && <div style={{ color: "var(--fg-3)" }}>loading…</div>}
          {loaded && shownTags.length === 0 && (
            <div style={{ color: "var(--fg-3)" }}>no tags yet — add one below</div>
          )}
          {shownTags.map(t => {
            const color = TAG_COLOR_MAP[t] ?? "var(--fg-2)";
            return (
              <label key={t} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", padding: "2px 0" }}>
                <input type="checkbox" checked={hasTag(t)} onChange={() => toggleTag(t)} />
                <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 2, background: color }} />
                <span style={{ color: hasTag(t) ? "var(--fg-1)" : "var(--fg-2, var(--fg-1))" }}>{t}</span>
              </label>
            );
          })}
        </div>
        <div style={{ padding: "8px 12px", borderTop: "1px solid var(--fg-3)", display: "flex", gap: 6 }}>
          <input
            ref={newTagRef}
            value={newTag}
            onChange={(e) => setNewTag(e.target.value)}
            placeholder="add new tag…"
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addNewTag(); } }}
            style={{
              flex: 1,
              background: "var(--bg-0, #0f0f14)", color: "var(--fg-1)",
              border: "1px solid var(--fg-3)", borderRadius: 2,
              padding: "4px 8px", fontFamily: "var(--font-mono)", fontSize: 13,
              outline: "none",
            }}
          />
          <button
            onClick={addNewTag}
            disabled={!newTag.trim()}
            style={{
              background: "transparent", border: "1px solid var(--fg-3)", color: "var(--fg-1)",
              padding: "4px 10px", cursor: newTag.trim() ? "pointer" : "not-allowed",
              borderRadius: 2, fontFamily: "inherit",
            }}
          >+</button>
        </div>
        <div style={{
          padding: "8px 12px", borderTop: "1px solid var(--fg-3)",
          display: "flex", justifyContent: "flex-end", gap: 6,
          background: "var(--bg-2, #16161e)",
        }}>
          <button onClick={onClose} style={{
            background: "transparent", border: "1px solid var(--fg-3)", color: "var(--fg-1)",
            padding: "4px 12px", cursor: "pointer", borderRadius: 2, fontFamily: "inherit",
          }}>cancel</button>
          <button
            onClick={() => { void save(); }}
            disabled={saving}
            style={{
              background: "var(--accent)", border: "1px solid var(--accent)", color: "var(--bg-0)",
              padding: "4px 12px", cursor: saving ? "wait" : "pointer",
              borderRadius: 2, fontFamily: "inherit",
            }}
          >{saving ? "saving…" : "save"}</button>
        </div>
      </div>
    </div>
  );
}

// ============= AboutDialog =============
export interface AboutDialogProps {
  open: boolean;
  onClose: () => void;
}

export function AboutDialog({ open, onClose }: AboutDialogProps) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onClose(); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);

  if (!open) return null;

  const builtOn = new Date().toISOString().slice(0, 10);
  const rows: Array<[string, string]> = [
    ["app", "Glasshouse"],
    ["version", APP_VERSION],
    ["tauri", TAURI_VERSION],
    ["built on", builtOn],
  ];

  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)",
      zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        width: "48ch", maxWidth: "95vw",
        background: "var(--bg-1, #1a1b26)", border: "1px solid var(--fg-3)",
        borderRadius: 4, display: "flex", flexDirection: "column",
        fontFamily: "var(--font-mono)", color: "var(--fg-1)",
      }}>
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "8px 12px", borderBottom: "1px solid var(--fg-3)",
          background: "var(--bg-2, #16161e)",
        }}>
          <span style={{ color: "var(--accent)" }}>about</span>
          <button onClick={onClose} style={{
            background: "transparent", border: "1px solid var(--fg-3)", color: "var(--fg-1)",
            padding: "2px 8px", cursor: "pointer", borderRadius: 2,
          }}>×</button>
        </div>
        <div style={{ padding: "14px 16px" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <tbody>
              {rows.map(([k, v]) => (
                <tr key={k}>
                  <td style={{
                    color: "var(--fg-3)", padding: "4px 12px 4px 0",
                    width: "12ch", whiteSpace: "nowrap",
                  }}>{k}</td>
                  <td style={{ padding: "4px 0", wordBreak: "break-all" }}>{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{
          padding: "8px 12px", borderTop: "1px solid var(--fg-3)",
          display: "flex", justifyContent: "flex-end",
          background: "var(--bg-2, #16161e)",
        }}>
          <button onClick={onClose} style={{
            background: "transparent", border: "1px solid var(--fg-3)", color: "var(--fg-1)",
            padding: "4px 12px", cursor: "pointer", borderRadius: 2, fontFamily: "inherit",
          }}>close</button>
        </div>
      </div>
    </div>
  );
}

// ============= KeybindingsDialog =============
// Read-only reference for every keybind the app exposes. Grouped by category,
// scrollable, Esc / click-outside closes. Sourced from MENUS + hardcoded
// global shortcuts the App.tsx keydown listener owns (F2 rename, Alt+Arrow
// history, Ctrl+Tab etc.) that live outside the declarative menu tree.
export interface KeybindingsDialogProps {
  open: boolean;
  onClose: () => void;
}

interface KbEntry {
  label: string;
  keys: string;
  group: string;
}

function collectMenuBinds(): KbEntry[] {
  const out: KbEntry[] = [];
  const walk = (items: MenuItemDef[], group: string): void => {
    for (const it of items) {
      if (it.kind === "item" && it.kb) {
        out.push({ label: it.label, keys: it.kb, group });
      } else if (it.kind === "sub") {
        walk(it.children, group);
      }
    }
  };
  for (const [group, items] of Object.entries(MENUS)) {
    walk(items, group);
  }
  return out;
}

const GLOBAL_BINDS: KbEntry[] = [
  { label: "Focus search",          keys: "/",            group: "Navigate" },
  { label: "Toggle terminal",       keys: "Ctrl+`",       group: "View" },
  { label: "Open parent",           keys: "Backspace",    group: "Navigate" },
  { label: "Open selected",         keys: "Enter",        group: "File" },
  { label: "Delete permanently",    keys: "Shift+Del",    group: "Edit" },
  { label: "Close modal / palette", keys: "Esc",          group: "View" },
  { label: "Next Tab",              keys: "Ctrl+Tab",     group: "Navigate" },
  { label: "Previous Tab",          keys: "Ctrl+Shift+Tab", group: "Navigate" },
];

export function KeybindingsDialog({ open, onClose }: KeybindingsDialogProps) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onClose(); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);

  const binds = useMemo(() => {
    const all = [...collectMenuBinds(), ...GLOBAL_BINDS];
    const byGroup = new Map<string, KbEntry[]>();
    for (const b of all) {
      const arr = byGroup.get(b.group) ?? [];
      arr.push(b);
      byGroup.set(b.group, arr);
    }
    for (const arr of byGroup.values()) {
      arr.sort((a, b) => a.label.localeCompare(b.label));
    }
    return Array.from(byGroup.entries());
  }, []);

  if (!open) return null;

  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)",
      zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        width: "72ch", maxWidth: "95vw", maxHeight: "85vh",
        background: "var(--bg-1, #1a1b26)", border: "1px solid var(--fg-3)",
        borderRadius: 4, display: "flex", flexDirection: "column",
        fontFamily: "var(--font-mono)", color: "var(--fg-1)",
      }}>
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "8px 12px", borderBottom: "1px solid var(--fg-3)",
          background: "var(--bg-2, #16161e)",
        }}>
          <span style={{ color: "var(--accent)" }}>⌨ keybindings</span>
          <span style={{ color: "var(--fg-3)", fontSize: 12 }}>esc / click to close</span>
          <button onClick={onClose} style={{
            background: "transparent", border: "1px solid var(--fg-3)", color: "var(--fg-1)",
            padding: "2px 8px", cursor: "pointer", borderRadius: 2,
          }} aria-label="close">×</button>
        </div>
        <div style={{ overflow: "auto", flex: 1, padding: "4px 0", fontSize: 13 }}>
          {binds.map(([group, entries]) => (
            <div key={group} style={{ marginBottom: 10 }}>
              <div style={{
                padding: "6px 16px 4px", color: "var(--fg-3)", fontSize: 11,
                textTransform: "uppercase", letterSpacing: "0.06em",
              }}>{group}</div>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <tbody>
                  {entries.map((b, i) => (
                    <tr key={i}>
                      <td style={{
                        padding: "2px 16px", color: "var(--fg-1)",
                        whiteSpace: "nowrap", width: "50%",
                      }}>{b.label}</td>
                      <td style={{
                        padding: "2px 16px", color: "var(--accent, var(--cyan))",
                        whiteSpace: "nowrap", textAlign: "right",
                      }}>{b.keys}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ============= DialogHost (themed prompt / alert / confirm + toast) =============
// Replaces window.prompt / window.alert / window.confirm at key callsites.
// DialogHost is mounted once in App.tsx; callers use the singleton imperative
// API exposed via `dialogs`.

export type DialogVariant = "info" | "success" | "warning" | "error";

interface PromptOptions {
  title?: string;
  message?: string;
  placeholder?: string;
  initialValue?: string;
  okLabel?: string;
  cancelLabel?: string;
  validate?: (value: string) => string | null;
}

interface AlertOptions {
  title?: string;
  message: string;
  variant?: DialogVariant;
  okLabel?: string;
}

interface ConfirmOptions {
  title?: string;
  message: string;
  danger?: boolean;
  okLabel?: string;
  cancelLabel?: string;
}

interface ToastOptions {
  message: string;
  variant?: DialogVariant;
  timeout?: number;
}

interface DialogApi {
  showPrompt: (opts: PromptOptions) => Promise<string | null>;
  showAlert: (opts: AlertOptions) => Promise<void>;
  showConfirm: (opts: ConfirmOptions) => Promise<boolean>;
  showToast: (opts: ToastOptions) => void;
}

// Singleton ref. DialogHost registers itself on mount; the `dialogs` helper
// returns a no-op / default if called before mount.
let dialogApiRef: DialogApi | null = null;

export const dialogs: DialogApi = {
  showPrompt: (opts) => {
    if (!dialogApiRef) return Promise.resolve<string | null>(null);
    return dialogApiRef.showPrompt(opts);
  },
  showAlert: (opts) => {
    if (!dialogApiRef) return Promise.resolve();
    return dialogApiRef.showAlert(opts);
  },
  showConfirm: (opts) => {
    if (!dialogApiRef) return Promise.resolve(false);
    return dialogApiRef.showConfirm(opts);
  },
  showToast: (opts) => {
    if (!dialogApiRef) return;
    dialogApiRef.showToast(opts);
  },
};

type DialogState =
  | { kind: "prompt"; opts: PromptOptions; resolve: (v: string | null) => void }
  | { kind: "alert"; opts: AlertOptions; resolve: () => void }
  | { kind: "confirm"; opts: ConfirmOptions; resolve: (v: boolean) => void }
  | null;

interface ToastState {
  id: number;
  message: string;
  variant: DialogVariant;
}

function variantColor(v: DialogVariant | undefined): string {
  switch (v) {
    case "success": return "var(--green, #9ece6a)";
    case "warning": return "var(--yellow, #e0af68)";
    case "error": return "var(--red, #f7768e)";
    default: return "var(--accent)";
  }
}

export function DialogHost() {
  const [state, setState] = useState<DialogState>(null);
  const [promptValue, setPromptValue] = useState("");
  const [promptError, setPromptError] = useState<string | null>(null);
  const [toasts, setToasts] = useState<ToastState[]>([]);
  const toastIdRef = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const api: DialogApi = {
      showPrompt: (opts) =>
        new Promise<string | null>((resolve) => {
          setPromptValue(opts.initialValue ?? "");
          setPromptError(null);
          setState({ kind: "prompt", opts, resolve });
        }),
      showAlert: (opts) =>
        new Promise<void>((resolve) => {
          setState({ kind: "alert", opts, resolve });
        }),
      showConfirm: (opts) =>
        new Promise<boolean>((resolve) => {
          setState({ kind: "confirm", opts, resolve });
        }),
      showToast: (opts) => {
        const id = ++toastIdRef.current;
        const t: ToastState = {
          id,
          message: opts.message,
          variant: opts.variant ?? "info",
        };
        setToasts((prev) => [...prev, t]);
        const ms = opts.timeout ?? 2600;
        window.setTimeout(() => {
          setToasts((prev) => prev.filter((x) => x.id !== id));
        }, ms);
      },
    };
    dialogApiRef = api;
    return () => {
      if (dialogApiRef === api) dialogApiRef = null;
    };
  }, []);

  useEffect(() => {
    if (state?.kind === "prompt") {
      const id = window.setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 0);
      return () => window.clearTimeout(id);
    }
  }, [state?.kind]);

  const close = () => {
    if (!state) return;
    if (state.kind === "prompt") state.resolve(null);
    else if (state.kind === "alert") state.resolve();
    else state.resolve(false);
    setState(null);
  };

  const submitPrompt = () => {
    if (state?.kind !== "prompt") return;
    const v = promptValue;
    if (state.opts.validate) {
      const err = state.opts.validate(v);
      if (err) {
        setPromptError(err);
        return;
      }
    }
    state.resolve(v);
    setState(null);
  };

  const confirmOk = () => {
    if (state?.kind !== "confirm") return;
    state.resolve(true);
    setState(null);
  };

  const alertOk = () => {
    if (state?.kind !== "alert") return;
    state.resolve();
    setState(null);
  };

  useEffect(() => {
    if (!state) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); close(); return; }
      if (e.key === "Enter") {
        if (e.shiftKey) return;
        e.preventDefault();
        if (state.kind === "prompt") submitPrompt();
        else if (state.kind === "confirm") confirmOk();
        else alertOk();
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, promptValue]);

  const overlay: React.CSSProperties = {
    position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)",
    zIndex: 300, display: "flex", alignItems: "flex-start", justifyContent: "center",
    paddingTop: "15vh",
  };
  const panel: React.CSSProperties = {
    width: "56ch", maxWidth: "95vw",
    background: "var(--bg-2, #16161e)",
    border: "1px solid var(--accent)",
    borderRadius: 6,
    fontFamily: "var(--font-mono)",
    color: "var(--fg-1)",
    boxShadow: "0 20px 60px rgba(0,0,0,0.6)",
    overflow: "hidden",
  };
  const header: React.CSSProperties = {
    display: "flex", alignItems: "center", justifyContent: "space-between",
    padding: "8px 12px", borderBottom: "1px solid var(--border, var(--fg-3))",
    background: "var(--bg-1, #1a1b26)",
  };
  const body: React.CSSProperties = {
    padding: "14px 16px",
    fontSize: 13,
  };
  const footer: React.CSSProperties = {
    padding: "8px 12px", borderTop: "1px solid var(--border, var(--fg-3))",
    display: "flex", justifyContent: "flex-end", gap: 6,
    background: "var(--bg-1, #1a1b26)",
  };
  const btn = (primary = false, danger = false): React.CSSProperties => ({
    background: primary
      ? (danger ? "var(--red, #f7768e)" : "var(--accent)")
      : "transparent",
    border: `1px solid ${primary ? (danger ? "var(--red, #f7768e)" : "var(--accent)") : "var(--fg-3)"}`,
    color: primary ? "var(--bg-0, #0f0f14)" : "var(--fg-1)",
    padding: "4px 14px",
    cursor: "pointer",
    borderRadius: 3,
    fontFamily: "inherit",
    fontSize: 12,
  });
  const closeBtn: React.CSSProperties = {
    background: "transparent", border: "1px solid var(--fg-3)", color: "var(--fg-1)",
    padding: "2px 8px", cursor: "pointer", borderRadius: 2,
  };

  return (
    <>
      {state?.kind === "prompt" && (
        <div onClick={close} style={overlay}>
          <div onClick={(e) => e.stopPropagation()} style={panel}>
            <div style={header}>
              <span style={{ color: "var(--accent)" }}>{state.opts.title ?? "input"}</span>
              <button onClick={close} style={closeBtn}>×</button>
            </div>
            <div style={body}>
              {state.opts.message && (
                <div style={{ marginBottom: 8, color: "var(--fg-2, var(--fg-1))" }}>{state.opts.message}</div>
              )}
              <input
                ref={inputRef}
                value={promptValue}
                onChange={(e) => { setPromptValue(e.target.value); if (promptError) setPromptError(null); }}
                placeholder={state.opts.placeholder}
                style={{
                  width: "100%",
                  background: "var(--bg-0, #0f0f14)", color: "var(--fg-0, var(--fg-1))",
                  border: `1px solid ${promptError ? "var(--red, #f7768e)" : "var(--fg-3)"}`,
                  borderRadius: 3, padding: "6px 9px",
                  fontFamily: "var(--font-mono)", fontSize: 13,
                  outline: "none", boxSizing: "border-box",
                }}
              />
              {promptError && (
                <div style={{ marginTop: 6, color: "var(--red, #f7768e)", fontSize: 11 }}>{promptError}</div>
              )}
            </div>
            <div style={footer}>
              <button onClick={close} style={btn(false)}>{state.opts.cancelLabel ?? "cancel"}</button>
              <button onClick={submitPrompt} style={btn(true)}>{state.opts.okLabel ?? "ok"}</button>
            </div>
          </div>
        </div>
      )}

      {state?.kind === "alert" && (
        <div onClick={alertOk} style={overlay}>
          <div onClick={(e) => e.stopPropagation()} style={{ ...panel, borderColor: variantColor(state.opts.variant) }}>
            <div style={header}>
              <span style={{ color: variantColor(state.opts.variant) }}>
                {state.opts.title ?? (state.opts.variant === "error" ? "error" : state.opts.variant === "warning" ? "warning" : "info")}
              </span>
              <button onClick={alertOk} style={closeBtn}>×</button>
            </div>
            <div style={{ ...body, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
              {state.opts.message}
            </div>
            <div style={footer}>
              <button onClick={alertOk} style={btn(true)}>{state.opts.okLabel ?? "ok"}</button>
            </div>
          </div>
        </div>
      )}

      {state?.kind === "confirm" && (
        <div onClick={close} style={overlay}>
          <div onClick={(e) => e.stopPropagation()} style={{ ...panel, borderColor: state.opts.danger ? "var(--red, #f7768e)" : "var(--accent)" }}>
            <div style={header}>
              <span style={{ color: state.opts.danger ? "var(--red, #f7768e)" : "var(--accent)" }}>
                {state.opts.title ?? "confirm"}
              </span>
              <button onClick={close} style={closeBtn}>×</button>
            </div>
            <div style={{ ...body, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
              {state.opts.message}
            </div>
            <div style={footer}>
              <button onClick={close} style={btn(false)}>{state.opts.cancelLabel ?? "cancel"}</button>
              <button onClick={confirmOk} style={btn(true, !!state.opts.danger)}>
                {state.opts.okLabel ?? (state.opts.danger ? "delete" : "ok")}
              </button>
            </div>
          </div>
        </div>
      )}

      {toasts.length > 0 && (
        <div style={{
          position: "fixed",
          right: 16, bottom: 44,
          zIndex: 350,
          display: "flex", flexDirection: "column", gap: 6,
          pointerEvents: "none",
        }}>
          {toasts.map(t => (
            <div key={t.id} style={{
              background: "var(--bg-2, #16161e)",
              border: `1px solid ${variantColor(t.variant)}`,
              borderRadius: 4,
              padding: "6px 12px",
              color: "var(--fg-1)",
              fontFamily: "var(--font-mono)",
              fontSize: 12,
              maxWidth: "60ch",
              boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
            }}>
              <span style={{ color: variantColor(t.variant), marginRight: 6 }}>●</span>
              {t.message}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

// ============= FolderPickerDialog =============
// In-app folder picker modal. Replaces the Tauri native open-directory dialog
// for the "Move to…" flow (task #12). Left column = drives; right column =
// directory tree of the current path; header = breadcrumb + "Up" button.

export interface FolderPickerDialogProps {
  initialPath?: string;
  title?: string;
  onClose: () => void;
  onPick: (path: string) => void;
}

function fpSepOf(p: string): string {
  return p.includes("\\") ? "\\" : "/";
}

function fpDirname(p: string): string {
  const trimmed = p.replace(/[\\/]+$/, "");
  const idx = Math.max(trimmed.lastIndexOf("\\"), trimmed.lastIndexOf("/"));
  if (idx < 0) return trimmed;
  if (/^[A-Za-z]:$/.test(trimmed.slice(0, idx))) return trimmed.slice(0, idx + 1);
  return trimmed.slice(0, idx);
}

export function FolderPickerDialog({ initialPath, title, onClose, onPick }: FolderPickerDialogProps) {
  const [cwd, setCwd] = useState<string>(initialPath ?? "");
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [driveList, setDriveList] = useState<Drive[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      setDriveList(await apiDrives());
      if (!initialPath) {
        const h = await apiHomeDir();
        if (h) setCwd(h);
      }
    })();
  }, [initialPath]);

  useEffect(() => {
    if (!cwd) return;
    let cancelled = false;
    setBusy(true);
    setErr(null);
    void (async () => {
      try {
        const list = await listDir(cwd, false);
        if (cancelled) return;
        setEntries(list.filter(e => e.kind === "folder"));
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => { cancelled = true; };
  }, [cwd]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onClose(); }
      if (e.key === "Enter" && cwd) { e.preventDefault(); onPick(cwd); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose, onPick, cwd]);

  const up = () => {
    if (!cwd) return;
    const parent = fpDirname(cwd);
    if (parent && parent !== cwd) setCwd(parent);
  };

  const crumbs = useMemo(() => {
    if (!cwd) return [];
    const sep = fpSepOf(cwd);
    const parts = cwd.split(/[\\/]+/).filter(Boolean);
    const out: Array<{ label: string; path: string }> = [];
    if (/^[A-Za-z]:$/.test(parts[0] ?? "")) {
      out.push({ label: parts[0], path: parts[0] + sep });
      let acc = parts[0] + sep;
      for (let i = 1; i < parts.length; i++) {
        acc = acc.replace(/[\\/]+$/, "") + sep + parts[i];
        out.push({ label: parts[i], path: acc });
      }
    } else {
      let acc = "";
      for (const p of parts) {
        acc = acc ? acc + sep + p : sep + p;
        out.push({ label: p, path: acc });
      }
    }
    return out;
  }, [cwd]);

  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)",
      zIndex: 280, display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        width: "80ch", maxWidth: "95vw", height: "60vh", maxHeight: "80vh",
        background: "var(--bg-2, #16161e)", border: "1px solid var(--accent)",
        borderRadius: 6, display: "flex", flexDirection: "column",
        fontFamily: "var(--font-mono)", color: "var(--fg-1)",
        boxShadow: "0 20px 60px rgba(0,0,0,0.6)",
      }}>
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "8px 12px", borderBottom: "1px solid var(--border, var(--fg-3))",
          background: "var(--bg-1, #1a1b26)",
        }}>
          <span style={{ color: "var(--accent)" }}>▸ {title ?? "pick folder"}</span>
          <button onClick={onClose} style={{
            background: "transparent", border: "1px solid var(--fg-3)", color: "var(--fg-1)",
            padding: "2px 8px", cursor: "pointer", borderRadius: 2,
          }}>×</button>
        </div>

        <div style={{
          padding: "6px 12px", borderBottom: "1px solid var(--border, var(--fg-3))",
          display: "flex", alignItems: "center", gap: 6, fontSize: 11, minHeight: 26,
        }}>
          <button
            onClick={up}
            disabled={!cwd}
            style={{
              background: "transparent", border: "1px solid var(--fg-3)",
              color: cwd ? "var(--fg-1)" : "var(--fg-3)",
              padding: "2px 8px", cursor: cwd ? "pointer" : "not-allowed",
              borderRadius: 2, fontFamily: "inherit",
            }}
          >↑ up</button>
          <div style={{
            flex: 1, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis",
            color: "var(--fg-2, var(--fg-1))",
          }}>
            {crumbs.length === 0 ? <span style={{ color: "var(--fg-3)" }}>(select a drive)</span> : crumbs.map((c, i) => (
              <span key={i}>
                <span
                  onClick={() => setCwd(c.path)}
                  style={{ cursor: "pointer", color: i === crumbs.length - 1 ? "var(--fg-0, var(--fg-1))" : "var(--fg-2, var(--fg-1))" }}
                >{c.label}</span>
                {i < crumbs.length - 1 && <span style={{ color: "var(--fg-3)", margin: "0 3px" }}>›</span>}
              </span>
            ))}
          </div>
        </div>

        <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
          <div style={{
            width: "18ch", borderRight: "1px solid var(--border, var(--fg-3))",
            overflow: "auto", padding: "4px 0", fontSize: 12,
          }}>
            <div style={{ padding: "4px 10px", color: "var(--fg-3)", fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase" }}>drives</div>
            {driveList.length === 0 && <div style={{ padding: "4px 10px", color: "var(--fg-3)", fontSize: 11 }}>(none)</div>}
            {driveList.map((d) => {
              // d.letter is already a navigable root ("C:\" on Windows, a
              // mount point like "/" or "/home" on Linux) — use it verbatim.
              // Longest-prefix match keeps "/" from claiming every path.
              const root = d.letter;
              const matches = (r: string) => {
                const base = r.replace(/[\\/]+$/, "");
                if (base === "") return cwd.startsWith("/");
                return cwd === base || cwd.startsWith(base + (r.includes("\\") ? "\\" : "/"));
              };
              const best = driveList
                .map(x => x.letter)
                .filter(matches)
                .sort((a, b) => b.length - a.length)[0];
              const active = matches(root) && root === best;
              return (
                <div
                  key={d.letter}
                  onClick={() => setCwd(root)}
                  style={{
                    padding: "3px 10px",
                    cursor: "pointer",
                    background: active ? "var(--bg-sel, var(--bg-3))" : "transparent",
                    color: active ? "var(--fg-0, var(--fg-1))" : "var(--fg-1)",
                  }}
                  onMouseEnter={(e) => { if (!active) (e.currentTarget.style.background = "var(--bg-1, #1a1b26)"); }}
                  onMouseLeave={(e) => { if (!active) (e.currentTarget.style.background = "transparent"); }}
                >
                  <span style={{ color: "var(--accent)", marginRight: 4 }}>▪</span>
                  {d.letter} {d.label && <span style={{ color: "var(--fg-3)", fontSize: 10 }}>({d.label})</span>}
                </div>
              );
            })}
          </div>
          <div style={{ flex: 1, overflow: "auto", padding: "4px 0", fontSize: 12 }}>
            {busy && <div style={{ padding: "4px 12px", color: "var(--fg-3)" }}>loading…</div>}
            {err && <div style={{ padding: "4px 12px", color: "var(--red, #f7768e)" }}>{err}</div>}
            {!busy && !err && entries.length === 0 && (
              <div style={{ padding: "4px 12px", color: "var(--fg-3)" }}>(no subfolders)</div>
            )}
            {entries.map((e) => (
              <div
                key={e.path}
                onDoubleClick={() => setCwd(e.path)}
                onClick={() => setCwd(e.path)}
                style={{
                  padding: "3px 12px",
                  cursor: "pointer",
                  color: "var(--fg-1)",
                }}
                onMouseEnter={(ev) => (ev.currentTarget.style.background = "var(--bg-1, #1a1b26)")}
                onMouseLeave={(ev) => (ev.currentTarget.style.background = "transparent")}
                title={e.path}
              >
                <span style={{ color: "var(--blue, var(--accent))", marginRight: 6 }}>▸</span>
                {e.name}
              </div>
            ))}
          </div>
        </div>

        <div style={{
          padding: "8px 12px", borderTop: "1px solid var(--border, var(--fg-3))",
          display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6,
          background: "var(--bg-1, #1a1b26)",
        }}>
          <div style={{ color: "var(--fg-3)", fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {cwd || "(no path)"}
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button onClick={onClose} style={{
              background: "transparent", border: "1px solid var(--fg-3)", color: "var(--fg-1)",
              padding: "4px 14px", cursor: "pointer", borderRadius: 3, fontFamily: "inherit", fontSize: 12,
            }}>cancel</button>
            <button
              onClick={() => cwd && onPick(cwd)}
              disabled={!cwd}
              style={{
                background: "var(--accent)", border: "1px solid var(--accent)", color: "var(--bg-0, #0f0f14)",
                padding: "4px 14px", cursor: cwd ? "pointer" : "not-allowed",
                borderRadius: 3, fontFamily: "inherit", fontSize: 12, opacity: cwd ? 1 : 0.5,
              }}
            >move here</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============= BookmarkManagerDialog =============
export interface BookmarkManagerDialogProps {
  pins: string[];
  onClose: () => void;
  onSave: (pins: string[]) => void;
  onGoTo?: (path: string) => void;
}

export function BookmarkManagerDialog({ pins, onClose, onSave, onGoTo }: BookmarkManagerDialogProps) {
  const [working, setWorking] = useState<string[]>(() => [...pins]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onClose(); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  const move = (idx: number, delta: number) => {
    setWorking(prev => {
      const j = idx + delta;
      if (j < 0 || j >= prev.length) return prev;
      const next = prev.slice();
      const t = next[idx];
      next[idx] = next[j];
      next[j] = t;
      return next;
    });
  };

  const remove = (idx: number) => {
    setWorking(prev => prev.filter((_, i) => i !== idx));
  };

  const save = () => {
    onSave(working);
  };

  const dirty = working.length !== pins.length || working.some((p, i) => p !== pins[i]);

  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)",
      zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        width: "64ch", maxWidth: "95vw", maxHeight: "80vh",
        background: "var(--bg-1, #1a1b26)", border: "1px solid var(--fg-3)",
        borderRadius: 4, display: "flex", flexDirection: "column",
        fontFamily: "var(--font-mono)", color: "var(--fg-1)",
      }}>
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "8px 12px", borderBottom: "1px solid var(--fg-3)",
          background: "var(--bg-2, #16161e)",
        }}>
          <span style={{ color: "var(--accent)" }}># manage bookmarks</span>
          <button onClick={onClose} style={{
            background: "transparent", border: "1px solid var(--fg-3)", color: "var(--fg-1)",
            padding: "2px 8px", cursor: "pointer", borderRadius: 2,
          }}>×</button>
        </div>
        <div style={{ padding: "6px 12px", borderBottom: "1px solid var(--fg-3)", fontSize: 11, color: "var(--fg-3)" }}>
          {working.length} pin{working.length === 1 ? "" : "s"}
        </div>
        <div style={{ overflow: "auto", flex: 1, padding: "6px 6px", display: "flex", flexDirection: "column", gap: 2 }}>
          {working.length === 0 && (
            <div style={{ color: "var(--fg-3)", padding: "12px", fontStyle: "italic", textAlign: "center" }}>
              no bookmarks — pin a folder from the sidebar + button
            </div>
          )}
          {working.map((p, i) => (
            <div key={`${i}-${p}`} style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "4px 8px", borderRadius: 2,
              background: "var(--bg-0, #0f0f14)",
              border: "1px solid transparent",
            }}>
              <span style={{
                color: "var(--fg-3)", fontSize: 11, minWidth: "2ch", textAlign: "right",
              }}>{i + 1}</span>
              <span
                style={{
                  flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  color: "var(--fg-1)", fontSize: 12,
                  cursor: onGoTo ? "pointer" : "default",
                }}
                title={onGoTo ? `go to ${p}` : p}
                onClick={() => {
                  if (!onGoTo) return;
                  onSave(working);
                  onGoTo(p);
                }}
              >{p}</span>
              <button
                onClick={() => move(i, -1)}
                disabled={i === 0}
                title="move up"
                style={{
                  background: "transparent", border: "1px solid var(--fg-3)", color: "var(--fg-1)",
                  padding: "1px 6px", cursor: i === 0 ? "not-allowed" : "pointer",
                  borderRadius: 2, fontFamily: "inherit", fontSize: 11, opacity: i === 0 ? 0.4 : 1,
                }}
              >↑</button>
              <button
                onClick={() => move(i, 1)}
                disabled={i === working.length - 1}
                title="move down"
                style={{
                  background: "transparent", border: "1px solid var(--fg-3)", color: "var(--fg-1)",
                  padding: "1px 6px", cursor: i === working.length - 1 ? "not-allowed" : "pointer",
                  borderRadius: 2, fontFamily: "inherit", fontSize: 11, opacity: i === working.length - 1 ? 0.4 : 1,
                }}
              >↓</button>
              <button
                onClick={() => remove(i)}
                title="remove bookmark"
                style={{
                  background: "transparent", border: "1px solid var(--fg-3)", color: "var(--red, #f7768e)",
                  padding: "1px 8px", cursor: "pointer",
                  borderRadius: 2, fontFamily: "inherit", fontSize: 11,
                }}
              >×</button>
            </div>
          ))}
        </div>
        <div style={{
          padding: "8px 12px", borderTop: "1px solid var(--fg-3)",
          display: "flex", justifyContent: "flex-end", gap: 6,
          background: "var(--bg-2, #16161e)",
        }}>
          <button onClick={onClose} style={{
            background: "transparent", border: "1px solid var(--fg-3)", color: "var(--fg-1)",
            padding: "4px 12px", cursor: "pointer", borderRadius: 2, fontFamily: "inherit",
          }}>cancel</button>
          <button
            onClick={save}
            disabled={!dirty}
            style={{
              background: dirty ? "var(--accent)" : "transparent",
              border: "1px solid var(--accent)",
              color: dirty ? "var(--bg-0)" : "var(--fg-3)",
              padding: "4px 12px", cursor: dirty ? "pointer" : "not-allowed",
              borderRadius: 2, fontFamily: "inherit", opacity: dirty ? 1 : 0.7,
            }}
          >save</button>
        </div>
      </div>
    </div>
  );
}
