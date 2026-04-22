// rice:// file manager — components
import React, { useState, useEffect, useRef, useMemo } from "react";
import {
  SIDEBAR,
  MENUS,
  PALETTE,
  type FileRow,
  type FileKind,
  type MenuItemDef,
} from "./data";
import { drives as apiDrives, hashSha256, homeDir as apiHomeDir, listDir, readImageB64, readText, spawnTerminal, systemInfo as apiSystemInfo, winClose, winMinimize, winToggleMaximize, type BlameLine, type Drive, type FileEntry, type GitInfo, type SystemInfo } from "./api";
import { fuzzyFilter } from "./fuzzy";

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
          <button className="tab-btn" title="Tab menu">⌄</button>
        </div>
      </div>
    </div>
  );
}

// ============= Menu bar + dropdown =============
interface MenuItemProps {
  item: MenuItemDef;
  onAction?: (label: string) => void;
  onSubHover?: (sub: MenuItemDef | null) => void;
  subOpen?: boolean;
}

function MenuItem({ item, onAction, onSubHover, subOpen }: MenuItemProps) {
  if (item.kind === "sep") return <div className="sep" />;
  if (item.kind === "grouplabel") return <div className="group-label">{item.label}</div>;
  const isSub = item.kind === "sub";
  const danger = item.kind === "item" && item.danger;
  const check = item.kind === "item" && item.check;
  const ic = item.kind === "item" || item.kind === "sub" ? item.ic : undefined;
  const kb = item.kind === "item" ? item.kb : undefined;
  return (
    <div
      className={"mi" + (danger ? " danger" : "") + (subOpen ? " hover" : "")}
      onMouseEnter={() => onSubHover && onSubHover(isSub ? item : null)}
      onClick={() => !isSub && onAction && onAction(item.label)}
    >
      <span className="ic">{check ? "✓" : ic || ""}</span>
      <span>{item.label}</span>
      <span className="kb">{kb || ""}</span>
      <span className="chev">{isSub ? "›" : ""}</span>
      {isSub && subOpen && (
        <div className="dropdown" style={{left: "calc(100% + 2px)", top: "-4px", minWidth: 240}}>
          {item.children.map((c, i) => (
            <MenuItem key={i} item={c} onAction={onAction} />
          ))}
        </div>
      )}
    </div>
  );
}

export interface MenubarProps {
  onOpenPalette: () => void;
  onCommand: (label: string) => void;
}

export function Menubar({ onOpenPalette, onCommand }: MenubarProps) {
  const [open, setOpen] = useState<string | null>(null);
  const [subHover, setSubHover] = useState<MenuItemDef | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) { setOpen(null); setSubHover(null); }
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const keys = Object.keys(MENUS);
  return (
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
            <div className="dropdown" onClick={(e) => e.stopPropagation()}>
              {MENUS[k].map((it, i) => (
                <MenuItem
                  key={i}
                  item={it}
                  subOpen={subHover !== null && "label" in subHover && "label" in it && subHover.label === (it as { label: string }).label}
                  onSubHover={(s) => setSubHover(s)}
                  onAction={(label) => { setOpen(null); onCommand(label); }}
                />
              ))}
            </div>
          )}
        </div>
      ))}
      <div className="menubar-right">
        <span onClick={onOpenPalette} style={{cursor:"pointer"}}>
          <span className="kbd">Ctrl</span>&nbsp;<span className="kbd">P</span>&nbsp;palette
        </span>
        <span>· NORMAL mode</span>
        <span>· rice://v0.4.2-dev</span>
      </div>
    </div>
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
        <span className="scheme">rice://</span>
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
          <span className="git-branch">⎇ {gitInfo.branch} ↑{gitInfo.ahead} ↓{gitInfo.behind}</span>
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

export interface SidebarProps {
  activePath: string;
  onGoTo: (path: string) => void;
  onRowContext?: (e: React.MouseEvent, path: string) => void;
  pins: string[];
  onAddPin: () => void;
  tags: Record<string, string[]>;
  onTagFilter?: (tag: string) => void;
  activeTagFilter?: string | null;
}

export function Sidebar({ activePath, onGoTo, onRowContext, pins, onAddPin, tags, onTagFilter, activeTagFilter }: SidebarProps) {
  const [home, setHome] = useState<string | null>(null);
  const [driveList, setDriveList] = useState<Drive[]>([]);

  // Tree: visible flattened list + map of children by path
  const [rootPath, setRootPath] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [children, setChildren] = useState<Record<string, FileEntry[]>>({});

  useEffect(() => {
    void (async () => {
      const h = await apiHomeDir();
      setHome(h);
      setDriveList(await apiDrives());
      if (h) {
        setRootPath(h);
        const kids = await listDir(h, false);
        setChildren(prev => ({ ...prev, [h]: kids.filter(k => k.kind === "folder") }));
        setExpanded(prev => ({ ...prev, [h]: true }));
      }
    })();
  }, []);

  const toggleNode = async (path: string) => {
    const isOpen = expanded[path];
    if (isOpen) {
      setExpanded(prev => ({ ...prev, [path]: false }));
      return;
    }
    if (!children[path]) {
      const kids = await listDir(path, false);
      setChildren(prev => ({ ...prev, [path]: kids.filter(k => k.kind === "folder") }));
    }
    setExpanded(prev => ({ ...prev, [path]: true }));
  };

  const treeRows = useMemo(() => {
    const out: { path: string; name: string; depth: number; open: boolean }[] = [];
    if (!rootPath) return out;
    const walk = (p: string, depth: number) => {
      const name = depth === 0 ? pathBasename(p) || p : pathBasename(p);
      const open = !!expanded[p];
      out.push({ path: p, name, depth, open });
      if (open) {
        const kids = children[p] ?? [];
        for (const k of kids) walk(k.path, depth + 1);
      }
    };
    walk(rootPath, 0);
    return out;
  }, [rootPath, expanded, children]);

  const tagCounts = useMemo(() => {
    const keys = Object.keys(tags);
    if (keys.length === 0) {
      return SEED_TAGS.map(s => ({ label: s.label, color: s.color, count: 0 }));
    }
    return keys.sort().map(k => ({
      label: k,
      color: TAG_COLOR_MAP[k] ?? "var(--fg-2)",
      count: (tags[k] ?? []).length,
    }));
  }, [tags]);

  return (
    <aside className="sidebar">
      <div className="sb-group">
        <div className="sb-title">
          <span>PINNED</span>
          <span
            style={{color:"var(--fg-3)", cursor:"pointer"}}
            title="Pin current folder"
            onClick={onAddPin}
          >+</span>
        </div>
        {pins.length === 0 && (
          <div className="sb-item" style={{color:"var(--fg-3)", cursor:"default"}}>
            <span className="ic">·</span>
            <span style={{fontStyle:"italic"}}>no pins yet</span>
            <span className="badge"></span>
          </div>
        )}
        {pins.map((p, i) => (
          <div key={i}
               className={"sb-item" + (p === activePath ? " active" : "")}
               onClick={() => onGoTo(p)}
               onContextMenu={(e) => {
                 if (!onRowContext) return;
                 e.preventDefault();
                 e.stopPropagation();
                 onRowContext(e, p);
               }}
               title={p}
               style={{cursor:"pointer"}}>
            <span className="ic">{home && p === home ? "󰋜" : ""}</span>
            <span style={{overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap"}}>{pathBasename(p) || p}</span>
            <span className="badge"></span>
          </div>
        ))}
      </div>

      <div className="sb-group">
        <div className="sb-title"><span>TREE</span><span style={{color:"var(--fg-3)"}}>⋯</span></div>
        {treeRows.map((n) => {
          const hasChildren = (children[n.path]?.length ?? 0) > 0 || !(n.path in children);
          return (
            <div key={n.path}
                 className={"tree-row" + (n.path === activePath ? " active" : "")}
                 style={{paddingLeft: 12 + n.depth * 10, cursor:"pointer"}}
                 onClick={() => onGoTo(n.path)}
                 onContextMenu={(e) => {
                   if (!onRowContext) return;
                   e.preventDefault();
                   e.stopPropagation();
                   onRowContext(e, n.path);
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

      <div className="sb-group">
        <div className="sb-title">TAGS</div>
        {tagCounts.map((t, i) => (
          <div key={i}
               className={"sb-item" + (activeTagFilter === t.label ? " active" : "")}
               title={`filter by tag: ${t.label}`}
               style={{cursor:"pointer"}}
               onClick={() => onTagFilter && onTagFilter(t.label)}>
            <span className="ic" style={{color: t.color}}></span>
            <span>{t.label}</span>
            <span className="badge">{t.count}</span>
          </div>
        ))}
      </div>

      <div className="sb-group">
        <div className="sb-title">DEVICES</div>
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
          return (
            <div key={"d" + i}
                 className={"sb-item" + (d.letter === activePath ? " active" : "")}
                 onClick={() => onGoTo(d.letter)}
                 onContextMenu={(e) => {
                   if (!onRowContext) return;
                   e.preventDefault();
                   e.stopPropagation();
                   onRowContext(e, d.letter);
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
      </div>

      <div className="sb-group">
        <div className="sb-title">REMOTE</div>
        {SIDEBAR.remote.map((d, i) => {
          const isSsh = d.meta === "ssh" || /@/.test(d.label);
          const onRemoteClick = () => {
            if (isSsh) {
              const ok = window.confirm(`connect to ${d.label}?`);
              if (!ok) {
                console.log(`[remote] connect cancelled for ${d.label}`);
                return;
              }
              console.log(`[remote] spawning ssh terminal for ${d.label}`);
              try {
                void spawnTerminal(`ssh ${d.label}`);
              } catch {
                console.log(`[remote] clicking ${d.label} — not yet connected`);
              }
              return;
            }
            console.log(`[remote] clicking ${d.label} — not yet connected`);
          };
          return (
            <div key={i}
                 className="sb-item"
                 style={{gridTemplateColumns: "16px 1fr", cursor:"pointer", opacity:0.7}}
                 title={isSsh ? `connect to ${d.label}` : `${d.label} — log only`}
                 onClick={onRemoteClick}>
              <span className="ic">{d.ic || "·"}</span>
              <div>
                <div>{d.label}</div>
                <div style={{color:"var(--fg-3)", fontSize:10}}>{d.meta}</div>
              </div>
            </div>
          );
        })}
      </div>
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

export type SortColumn = "name" | "size" | "modified" | "tag" | "git";
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
  onContext: (e: React.MouseEvent, kind: ContextKind, rowIndex?: number) => void;
  onOpen?: (index: number) => void;
  onUp?: () => void;
  onCopy?: () => void;
  onCut?: () => void;
  onDelete?: (permanent: boolean) => void;
  searchQuery?: string;
  tagFilter?: string | null;
  tagStore?: Record<string, string[]>;
  onRowDrop?: (targetOrigIndex: number, sourceOrigIndices: number[]) => void;
}

const PAGE_STEP = 10;

// Pointer-based drag implementation. We don't use HTML5 drag because it
// doesn't initiate from synthesized mouse events, which makes
// test-harness automation impossible and breaks on some webviews.
const DRAG_THRESHOLD_PX = 5;

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
}: FilePaneProps) {
  const paneRef = useRef<HTMLElement>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

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
      // Folders before files, always — matches Explorer/Finder convention.
      const af = a.file.kind === "folder" ? 0 : 1;
      const bf = b.file.kind === "folder" ? 0 : 1;
      if (af !== bf) return af - bf;
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
  }, [files, searchQuery, sortKey, sortDir, tagFilter, tagStore]);

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

  return (
    <section
      ref={paneRef}
      className={"pane" + (paneFocused ? " pane-focused" : "")}
      tabIndex={0}
      onFocus={() => setPaneFocused(true)}
      onBlur={(e) => {
        // Only drop focus if the new focus target is outside the pane.
        if (!paneRef.current?.contains(e.relatedTarget as Node)) setPaneFocused(false);
      }}
      onKeyDown={onKeyDown}
      onMouseDown={() => {
        // Take focus on click so arrow keys work without an explicit tab.
        if (paneRef.current && document.activeElement !== paneRef.current) {
          paneRef.current.focus();
        }
      }}
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
          const ki = kindIcon(f.kind);
          const isSel = selected.includes(i);
          const isFocus = paneFocused && focusIndex === i;
          const isDragOver = dragOverIndex === i && f.kind === "folder";
          return (
            <div key={i}
                 data-orig={i}
                 className={"row" + (isSel ? " selected" : "") + (isFocus ? " focused" : "") + (isDragOver ? " drop-target" : "")}
                 style={{opacity: f.dimmed ? 0.55 : 1}}
                 onPointerDown={(e) => {
                   if (e.button !== 0) return;
                   const startX = e.clientX;
                   const startY = e.clientY;
                   const sources = isSel ? [...selected] : [i];
                   let dragging = false;
                   let moved = false;
                   const onMove = (ev: PointerEvent) => {
                     moved = true;
                     const dx = ev.clientX - startX;
                     const dy = ev.clientY - startY;
                     if (!dragging && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
                     dragging = true;
                     // Locate the row under the cursor and decide whether it's a valid drop target.
                     const hit = document.elementFromPoint(ev.clientX, ev.clientY);
                     const row = hit?.closest("[data-orig]") as HTMLElement | null;
                     const origAttr = row?.getAttribute("data-orig");
                     const origIdx = origAttr !== null && origAttr !== undefined ? parseInt(origAttr, 10) : -1;
                     const hoverFile = origIdx >= 0 ? files[origIdx] : undefined;
                     const validTarget = hoverFile && hoverFile.kind === "folder" && !sources.includes(origIdx);
                     setDragOverIndex(validTarget ? origIdx : null);
                   };
                   const onUp = (ev: PointerEvent) => {
                     window.removeEventListener("pointermove", onMove);
                     window.removeEventListener("pointerup", onUp);
                     window.removeEventListener("pointercancel", onUp);
                     setDragOverIndex(null);
                     if (!dragging) return;
                     const hit = document.elementFromPoint(ev.clientX, ev.clientY);
                     const row = hit?.closest("[data-orig]") as HTMLElement | null;
                     const origAttr = row?.getAttribute("data-orig");
                     if (!origAttr) return;
                     const targetIdx = parseInt(origAttr, 10);
                     const targetFile = files[targetIdx];
                     if (!targetFile || targetFile.kind !== "folder") return;
                     const filtered = sources.filter(s => s !== targetIdx);
                     if (filtered.length === 0) return;
                     onRowDrop && onRowDrop(targetIdx, filtered);
                   };
                   window.addEventListener("pointermove", onMove);
                   window.addEventListener("pointerup", onUp);
                   window.addEventListener("pointercancel", onUp);
                   // Let click/dblclick still work when no drag happened.
                   void moved;
                 }}
                 onClick={(e) => handleRowClick(i, e)}
                 onDoubleClick={() => onOpen && onOpen(i)}
                 onContextMenu={(e) => {
                   e.preventDefault();
                   e.stopPropagation();
                   if (!isSel) { setSelected([i]); setAnchorIndex(i); }
                   setFocusIndex(i);
                   onContext(e, "file", i);
                 }}>
              <span className={"ic " + ki.cls}>{ki.ic}</span>
              <span className="name">
                {f.git && <span className={"git-dot " + gitDotClass(f.git)}></span>}
                <span style={{color: f.hidden ? "var(--fg-3)" : "inherit"}}>{f.name}</span>
                {f.ext && !f.hidden && f.kind !== "folder" && <span className="ext">.{f.ext}</span>}
              </span>
              <span className="tag">
                {f.tag ? <><span className="dot" style={{background: tagColor(f.tag)}}></span>{f.tag}</> : <span style={{color:"var(--fg-3)"}}>—</span>}
              </span>
              <span className="size">{f.size}</span>
              <span className="date">{f.date}</span>
              <span className="tag" style={{textAlign:"right"}}>
                {f.git === "M" ? <span style={{color:"var(--yellow)"}}>M</span>
                 : f.git === "A" ? <span style={{color:"var(--green)"}}>A</span>
                 : f.git === "D" ? <span style={{color:"var(--red)"}}>D</span>
                 : f.git === "U" ? <span style={{color:"var(--red)"}}>U</span>
                 : f.git === "?" ? <span style={{color:"var(--fg-2)"}}>?</span>
                 : f.git === "!" ? <span style={{color:"var(--fg-3)"}}>!</span>
                 : <span style={{color:"var(--fg-3)"}}>—</span>}
              </span>
            </div>
          );
        })}
      </div>
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

function PermissionsGrid() {
  // 3 rows (read/write/exec) × 3 cols (owner/group/world). Each cell toggles
  // on click; backend chmod is future-work — this just flips the unicode char
  // and logs so the UI feels alive.
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
    console.log(`[inspector] perm toggle ${rows[r].label}-${cols[c]} — not persisted`);
    setPerms(prev => prev.map((row, ri) =>
      ri === r ? row.map((v, ci) => (ci === c ? !v : v)) : row
    ));
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

export function Inspector({ file, onQuickAction }: InspectorProps) {
  const [preview, setPreview] = useState<string>("");
  const [imgSrc, setImgSrc] = useState<string>("");
  const [imgErr, setImgErr] = useState<string>("");
  const [sha256, setSha256] = useState<string | null>(null);
  const [hashing, setHashing] = useState<boolean>(false);
  const isTextLike = !!file && (file.kind === "text" || file.kind === "code");
  const isImg = !!file && file.kind === "img";

  useEffect(() => {
    setPreview("");
    if (!file || !isTextLike) return;
    let cancelled = false;
    void (async () => {
      const t = await readText(file.entry.path, 4096);
      if (!cancelled) setPreview(t);
    })();
    return () => { cancelled = true; };
  }, [file?.entry.path, isTextLike]);

  useEffect(() => {
    setImgSrc("");
    setImgErr("");
    if (!file || !isImg) return;
    let cancelled = false;
    void (async () => {
      try {
        const dataUrl = await readImageB64(file.entry.path, 8 * 1024 * 1024);
        if (!cancelled) setImgSrc(dataUrl);
      } catch (err) {
        if (!cancelled) {
          const msg = err instanceof Error ? err.message : String(err);
          setImgErr(msg);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [file?.entry.path, isImg]);

  // Reset cached hash whenever the inspected path changes — stale digests for
  // a different file would be worse than showing "—".
  useEffect(() => {
    setSha256(null);
    setHashing(false);
  }, [file?.entry.path]);

  const computeHash = () => {
    if (!file) return;
    if (file.kind === "folder") return;
    setHashing(true);
    void (async () => {
      try {
        const hex = await hashSha256(file.entry.path);
        setSha256(hex);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("hash_sha256:", msg);
        try { alert(`hash failed: ${msg}`); } catch { /* no window */ }
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

  return (
    <aside className="inspector">
      <div className="insp-hero">
        <div className="insp-preview">
          {isImg && imgSrc ? (
            <img
              src={imgSrc}
              alt={displayName}
              style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", display: "block" }}
            />
          ) : isImg && imgErr ? (
            <div className="ghost" style={{ fontSize: 10 }}>image: {imgErr}</div>
          ) : isImg ? (
            <div className="ghost">loading…</div>
          ) : isTextLike && preview ? (
            <div style={{fontSize: 10, color:"var(--fg-2)", textAlign:"left", padding:10, alignSelf:"stretch", whiteSpace:"pre", overflow:"hidden"}}>
              {previewLines.map((ln, i) => (<div key={i}>{ln || " "}</div>))}
              {preview.length >= 4096 && <div style={{color:"var(--fg-3)", marginTop:6}}>…truncated</div>}
            </div>
          ) : (
            <div className="big-ic">{kindIcon(f.kind).ic}</div>
          )}
        </div>
        <div className="insp-title">{displayName}</div>
        <div className="insp-path">{f.entry.path}</div>
        <div>
          {f.tag && <span className="chip"><span className="dot" style={{background: tagColor(f.tag)}}></span>{f.tag}</span>}
          <span className="chip">{f.kind}</span>
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
          <dt>created</dt><dd>—</dd>
          <dt>owner</dt><dd>—</dd>
          <dt>inode</dt><dd>—</dd>
          <dt>mime</dt><dd className="mono">{mime}</dd>
        </dl>
      </div>

      <PermissionsGrid />

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
          <dt>md5</dt><dd className="mono" style={{fontSize:10}}>—</dd>
          <dt>crc32</dt><dd className="mono">—</dd>
        </dl>
      </div>

      <div className="insp-section">
        <h4>GIT {f.git ? <span style={{color:"var(--orange)"}}>{f.git}</span> : <span style={{color:"var(--fg-3)"}}>—</span>}</h4>
        <dl className="kv">
          <dt>last commit</dt><dd>—</dd>
          <dt>author</dt><dd>—</dd>
          <dt>sha</dt><dd className="mono">—</dd>
          <dt>diff</dt><dd>—</dd>
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

export function StatusBar({ selectedCount, totalCount, totalSize, path, gitInfo, onToggleTerm }: StatusBarProps) {
  const [sys, setSys] = useState<SystemInfo | null>(null);
  const [now, setNow] = useState<Date>(() => new Date());

  useEffect(() => {
    void (async () => { setSys(await apiSystemInfo()); })();
    const id = window.setInterval(async () => {
      setSys(await apiSystemInfo());
      setNow(new Date());
    }, 2000);
    return () => window.clearInterval(id);
  }, []);

  const pad = (n: number) => n.toString().padStart(2, "0");
  const clock = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  const cpu = sys ? `${sys.cpu_pct.toFixed(0).padStart(2, "0")}%` : "—";
  const memPct = sys ? `${sys.mem_pct.toFixed(0)}%` : "—";
  const memUsed = sys ? formatMemGB(sys.mem_used) : "—";
  const uptime = sys ? formatUptime(sys.uptime_s) : "—";
  const branch = gitInfo?.branch ?? "—";
  const ahead = gitInfo ? `↑${gitInfo.ahead}` : "";

  return (
    <div className="statusbar">
      <div className="sb-seg mode">NORMAL</div>
      <div className="sb-seg"><span className="lbl">▸</span><span className="val">rice://{path}</span></div>
      <div className="sb-seg accent"><span className="lbl">⎇</span><span className="val">{branch}</span><span style={{color:"var(--fg-3)"}}>{ahead}</span></div>
      <div className="sb-seg"><span className="lbl">sel</span><span className="val">{selectedCount}</span><span style={{color:"var(--fg-3)"}}>/ {totalCount}</span></div>
      <div className="sb-seg"><span className="lbl">Σ</span><span className="val">{totalSize}</span></div>
      <div className="spacer"></div>
      <div className="sb-seg"><span className="lbl">fs</span><span className="val">—</span></div>
      <div className="sb-seg warn"><span className="lbl">mem</span><span className="val">{memPct}</span></div>
      <div className="sb-seg ok"><span className="lbl">cpu</span><span className="val">{cpu}</span></div>
      <div className="sb-seg"><span className="lbl">mem</span><span className="val">{memUsed}</span></div>
      <div className="sb-seg"><span className="lbl">i/o</span><span className="val">▁▂▃▅▂▁</span></div>
      <div className="sb-seg"><span className="lbl">net</span><span className="val">—</span></div>
      <div className="sb-seg" style={{cursor:"pointer"}} onClick={onToggleTerm}><span className="val" style={{color:"var(--accent)"}}>⌨ term</span></div>
      <div className="sb-seg"><span className="lbl">up</span><span className="val">{uptime}</span></div>
      <div className="sb-seg"><span className="val">{clock}</span></div>
    </div>
  );
}

// ============= Terminal drawer =============
export interface TerminalDrawerProps {
  open: boolean;
  onClose: () => void;
}

export function TerminalDrawer({ open, onClose }: TerminalDrawerProps) {
  const TERM_TABS: Array<{ shell: string; label: string; accent?: boolean }> = [
    { shell: "zsh", label: "zsh · glasshouse", accent: true },
    { shell: "ssh", label: "ssh · void@server" },
    { shell: "wsl", label: "wsl · Ubuntu" },
  ];
  const [activeTerminalTab, setActiveTerminalTab] = useState<string>("zsh");
  return (
    <div className={"term-drawer" + (open ? " open" : "")}>
      <div className="term-head">
        {TERM_TABS.map(t => {
          const isActive = activeTerminalTab === t.shell;
          return (
            <div
              key={t.shell}
              className={"ttab" + (isActive ? " active" : "")}
              style={{cursor:"pointer"}}
              onClick={() => {
                console.log(`[terminal] switching to ${t.shell} tab`);
                setActiveTerminalTab(t.shell);
              }}
            >
              {isActive && t.accent && <span style={{color:"var(--green)"}}>✓ </span>}
              {t.label}
              {isActive && <span className="close" onClick={(e) => { e.stopPropagation(); console.log(`[terminal] close ${t.shell} tab (mock)`); }}>×</span>}
            </div>
          );
        })}
        <div
          className="ttab"
          style={{color:"var(--fg-3)", cursor:"pointer"}}
          onClick={() => { console.log("[terminal] new tab (mock)"); }}
        >+</div>
        <div className="right">
          <span title="split H" style={{cursor:"pointer"}} onClick={() => { console.log("[terminal] split H (mock)"); }}>⊟</span>
          <span title="split V" style={{cursor:"pointer"}} onClick={() => { console.log("[terminal] split V (mock)"); }}>⊟</span>
          <span title="zoom" style={{cursor:"pointer"}} onClick={() => { console.log("[terminal] zoom (mock)"); }}>⤢</span>
          <span title="close" style={{cursor:"pointer"}} onClick={onClose}>×</span>
        </div>
      </div>
      <div className="term-body">
        <div className="line"><span className="prompt">void@arch</span> <span className="dim">in</span> <span className="path">~/projects/glasshouse</span> <span className="dim">on</span> <span className="branch">⎇ main</span> <span className="dim">[●5]</span></div>
        <div className="line"><span className="prompt">❯</span> <span className="cmd">cargo build --release</span></div>
        <div className="line dim">   Compiling glasshouse v0.4.2 (/home/void/projects/glasshouse)</div>
        <div className="line dim">   Compiling tokio v1.37.0</div>
        <div className="line ok">    Finished `release` profile [optimized] target(s) in 12.4s</div>
        <div className="line"><span className="prompt">void@arch</span> <span className="dim">in</span> <span className="path">~/projects/glasshouse</span></div>
        <div className="line"><span className="prompt">❯</span> <span className="cmd">git status --short</span></div>
        <div className="line"><span style={{color:"var(--yellow)"}}> M</span> src/main.rs</div>
        <div className="line"><span style={{color:"var(--yellow)"}}> M</span> README.md</div>
        <div className="line"><span style={{color:"var(--green)"}}>A </span> src/palette.rs</div>
        <div className="line"><span className="dim">??</span> Screenshot_2026-04-22_10-14-03.png</div>
        <div className="line"><span className="prompt">❯</span> <span className="cursor"></span></div>
      </div>
    </div>
  );
}

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
}

export function ContextMenu({ items, x, y, onClose, onCommand }: ContextMenuProps) {
  const [subHover, setSubHover] = useState<MenuItemDef | null>(null);
  useEffect(() => {
    const h = () => onClose();
    setTimeout(() => document.addEventListener("mousedown", h, { once: true }), 0);
    return () => document.removeEventListener("mousedown", h);
  }, [onClose]);
  return (
    <div className="ctx-menu" style={{left: x, top: y}} onClick={(e) => e.stopPropagation()}>
      {items.map((it, i) => (
        <MenuItem key={i} item={it}
          subOpen={subHover !== null && "label" in subHover && "label" in it && subHover.label === (it as { label: string }).label}
          onSubHover={(s) => setSubHover(s)}
          onAction={(label) => { if (onCommand) onCommand(label); onClose(); }}
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
