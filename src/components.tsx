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
import { drives as apiDrives, homeDir as apiHomeDir, listDir, readText, systemInfo as apiSystemInfo, winClose, winMinimize, winToggleMaximize, type Drive, type FileEntry, type GitInfo, type SystemInfo } from "./api";
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

export function Toolbar({ path, gitInfo, canBack, canForward, onBack, onForward, onUp, onRefresh, onGoTo, onSearchFocus, searchQuery, onSearchChange, searchInputRef, showHidden, onToggleHidden, showInspector, onToggleInspector, onCrumbContext }: ToolbarProps) {
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
}

export function Sidebar({ activePath, onGoTo, onRowContext, pins, onAddPin, tags }: SidebarProps) {
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
               className="sb-item"
               title="tag filter coming soon"
               style={{cursor:"pointer"}}
               onClick={() => { console.warn("tag filter not yet wired:", t.label); }}>
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
        {SIDEBAR.remote.map((d, i) => (
          <div key={i}
               className="sb-item"
               style={{gridTemplateColumns: "16px 1fr", cursor:"pointer", opacity:0.7}}
               title="remote mounts coming soon"
               onClick={() => { console.warn("remote mount not yet wired:", d.label); }}>
            <span className="ic">{d.ic || "·"}</span>
            <div>
              <div>{d.label}</div>
              <div style={{color:"var(--fg-3)", fontSize:10}}>{d.meta}</div>
            </div>
          </div>
        ))}
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

export type ContextKind = "file" | "empty" | "sidebar" | "tab" | "breadcrumb";

export type SortColumn = "name" | "size" | "modified";
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
  onContext: (e: React.MouseEvent, kind: ContextKind) => void;
  onOpen?: (index: number) => void;
  onUp?: () => void;
  onCopy?: () => void;
  onCut?: () => void;
  onDelete?: (permanent: boolean) => void;
  searchQuery?: string;
}

const PAGE_STEP = 10;

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
}: FilePaneProps) {
  const paneRef = useRef<HTMLElement>(null);

  // Filtered + sorted, preserving origIndex so selection still refers to the
  // underlying `files` array (which is what App's clipboard/selection logic
  // indexes into).
  const displayFiles = useMemo(() => {
    const indexed = files.map((f, i) => ({ file: f, origIndex: i }));
    const q = (searchQuery || "").trim();
    const filtered = q
      ? fuzzyFilter(
          q,
          indexed,
          x => (x.file.ext && x.file.kind !== "folder") ? `${x.file.name}.${x.file.ext}` : x.file.name,
        ).map(r => r.item)
      : indexed;

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
      // modified
      const am = (a.file as unknown as { entry?: { modified_ms?: number } }).entry?.modified_ms ?? 0;
      const bm = (b.file as unknown as { entry?: { modified_ms?: number } }).entry?.modified_ms ?? 0;
      return (am - bm) * dir;
    });
    return sorted;
  }, [files, searchQuery, sortKey, sortDir]);

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
        <div className="col">tag</div>
        <div className="col" style={{justifyContent:"flex-end"}} onClick={() => onSortChange("size")}>size <span className="sort">{sortArrow("size")}</span></div>
        <div className="col" onClick={() => onSortChange("modified")}>modified <span className="sort">{sortArrow("modified")}</span></div>
        <div className="col" style={{justifyContent:"flex-end"}}>git</div>
      </div>
      <div className="rows">
        {displayFiles.map(({ file: f, origIndex: i }) => {
          const ki = kindIcon(f.kind);
          const isSel = selected.includes(i);
          const isFocus = paneFocused && focusIndex === i;
          return (
            <div key={i}
                 data-orig={i}
                 className={"row" + (isSel ? " selected" : "") + (isFocus ? " focused" : "")}
                 style={{opacity: f.dimmed ? 0.55 : 1}}
                 onClick={(e) => handleRowClick(i, e)}
                 onDoubleClick={() => onOpen && onOpen(i)}
                 onContextMenu={(e) => {
                   e.preventDefault();
                   e.stopPropagation();
                   if (!isSel) { setSelected([i]); setAnchorIndex(i); }
                   setFocusIndex(i);
                   onContext(e, "file");
                 }}>
              <span className={"ic " + ki.cls}>{ki.ic}</span>
              <span className="name">
                {f.git && <span className={"git-dot " + f.git}></span>}
                <span style={{color: f.hidden ? "var(--fg-3)" : "inherit"}}>{f.name}</span>
                {f.ext && !f.hidden && f.kind !== "folder" && <span className="ext">.{f.ext}</span>}
              </span>
              <span className="tag">
                {f.tag ? <><span className="dot" style={{background: tagColor(f.tag)}}></span>{f.tag}</> : <span style={{color:"var(--fg-3)"}}>—</span>}
              </span>
              <span className="size">{f.size}</span>
              <span className="date">{f.date}</span>
              <span className="tag" style={{textAlign:"right"}}>
                {f.git === "mod" ? <span style={{color:"var(--yellow)"}}>M</span>
                 : f.git === "add" ? <span style={{color:"var(--green)"}}>A</span>
                 : f.git === "del" ? <span style={{color:"var(--red)"}}>D</span>
                 : f.git === "untracked" ? <span style={{color:"var(--fg-3)"}}>??</span>
                 : <span style={{color:"var(--fg-3)"}}>·</span>}
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
  onQuickAction?: (action: "run" | "copy-path" | "open-in-code" | "git-blame") => void;
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

export function Inspector({ file, onQuickAction }: InspectorProps) {
  const [preview, setPreview] = useState<string>("");
  const isTextLike = !!file && (file.kind === "text" || file.kind === "code");

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
  const isImg = f.kind === "img";
  const displayName = f.ext && f.kind !== "folder" ? `${f.name}.${f.ext}` : f.name;
  const previewLines = preview.split(/\r?\n/).slice(0, 20);
  const mime = mimeGuess(f.kind, f.ext);

  return (
    <aside className="inspector">
      <div className="insp-hero">
        <div className="insp-preview">
          {isImg ? (
            <div className="ghost">[image preview — {f.ext.toUpperCase()}]</div>
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
          {f.git && <span className="chip" style={{color: f.git === "mod" ? "var(--yellow)" : f.git === "add" ? "var(--green)" : "var(--fg-2)"}}>
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

      <div className="insp-section">
        <h4>PERMISSIONS <span style={{color:"var(--accent)", cursor:"pointer"}}>edit</span></h4>
        <div style={{fontFamily:"var(--font-mono)", color:"var(--fg-0)", marginBottom:6}}>
          <span style={{color:"var(--fg-3)"}}>…</span>
        </div>
        <div className="perm-grid">
          <div></div><div className="h">owner</div><div className="h">group</div><div className="h">world</div>
          <div className="h" style={{textAlign:"right"}}>read</div>
          <div className="perm-cell off">—</div><div className="perm-cell off">—</div><div className="perm-cell off">—</div>
          <div className="h" style={{textAlign:"right"}}>write</div>
          <div className="perm-cell off">—</div><div className="perm-cell off">—</div><div className="perm-cell off">—</div>
          <div className="h" style={{textAlign:"right"}}>exec</div>
          <div className="perm-cell off">—</div><div className="perm-cell off">—</div><div className="perm-cell off">—</div>
        </div>
      </div>

      <div className="insp-section">
        <h4>CHECKSUMS <span style={{color:"var(--accent)", cursor:"pointer"}}>copy</span></h4>
        <dl className="kv">
          <dt>sha256</dt><dd className="mono" style={{fontSize:10}}>—</dd>
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
          <span className="chip" style={{cursor:"not-allowed", opacity: 0.5}} title="UNWIRED">◫ compress</span>
          <span className="chip" style={{cursor:"not-allowed", opacity: 0.5}} title="UNWIRED"># hash</span>
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
  return (
    <div className={"term-drawer" + (open ? " open" : "")}>
      <div className="term-head">
        <div className="ttab active"><span style={{color:"var(--green)"}}>✓</span> zsh · glasshouse <span className="close">×</span></div>
        <div className="ttab">ssh · void@server</div>
        <div className="ttab">wsl · Ubuntu</div>
        <div className="ttab" style={{color:"var(--fg-3)"}}>+</div>
        <div className="right">
          <span title="split H">⊟</span>
          <span title="split V">⊟</span>
          <span title="zoom">⤢</span>
          <span title="close" onClick={onClose}>×</span>
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
