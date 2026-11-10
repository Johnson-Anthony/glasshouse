// glasshouse file manager — components
import React, { useState, useEffect, useRef, useMemo } from "react";
import { createPortal } from "react-dom";
import { MENUS, PALETTE, TAURI_VERSION, THEMES, type FileRow, type FileKind, type MenuItemDef } from "./data";
import { drives as apiDrives, hashSha256, homeDir as apiHomeDir, listDir, netRate, pathFsType, readTags, systemInfo as apiSystemInfo, winClose, winMinimize, winToggleMaximize, writeTags, type BlameLine, type Drive, type FileEntry, type GitInfo, type NetRate, type SystemInfo } from "./api";
import { getVersion } from "@tauri-apps/api/app";
import { fuzzyFilter } from "./fuzzy";
import { basename, joinPath, parentPath, splitBreadcrumb } from "./paths";
import type { SkipReason, TransferItem, TransferOp, TransferStep } from "./transfer";
import { checkRenames, orderRenames } from "./names";
import { IS_WINDOWS } from "./platform";
import { openNotices } from "./Notices";
import { SEED_TAGS, TAG_COLOR_MAP, type SavedRemote } from "./Sidebar";

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

// ============= Main file pane =============
export function kindIcon(kind: FileKind): { ic: string; cls: string } {
  switch (kind) {
    case "folder": return { ic: "▸", cls: "folder" };
    case "code":   return { ic: "<>", cls: "code" };
    case "img":    return { ic: "▢", cls: "img" };
    case "archive":return { ic: "◫", cls: "archive" };
    case "exec":   return { ic: "$", cls: "exec" };
    default:       return { ic: "≡", cls: "text" };
  }
}

export function tagColor(tag: string | null): string {
  const m: Record<string, string> = { project: "var(--magenta)", school: "var(--green)", secret: "var(--red)", review: "var(--yellow)", archive: "var(--cyan)" };
  return (tag && m[tag]) || "var(--fg-3)";
}

// Map single-char git status codes to CSS-safe class suffixes. "?" isn't
// valid in a class name, so we translate.
function gitDotClass(code: string): string {
  switch (code) {
    case "M": return "gm";
    case "A": return "ga";
    case "D": return "gd";
    case "U": return "gu";
    case "?": return "gq";
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
  /** Why the folder couldn't be listed; shown in place of the rows. */
  error?: string | null;
  /** A listing is in flight. Only shown while there are no rows yet. */
  loading?: boolean;
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

/** Marks a symlink row; its kind, size and date describe the target. */
export function LinkMark() {
  return <span className="link" title="symbolic link" aria-label="symbolic link">↪</span>;
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
         onPointerDown={(e) => h.pointerDown(i, isSel, e)}
         onClick={(e) => h.click(i, e)}
         onDoubleClick={() => h.dblClick(i)}
         onContextMenu={(e) => h.ctxMenu(i, isSel, e)}>
      <span className={"ic " + ki.cls}>{ki.ic}</span>
      <span className="name">
        {showGitGutters && f.git && <span className={"git-dot " + gitDotClass(f.git)}></span>}
        <span style={{color: f.hidden ? "var(--fg-3)" : "inherit"}}>{f.name}</span>
        {showExtensions && f.ext && !f.hidden && f.kind !== "folder" && <span className="ext">.{f.ext}</span>}
        {f.link && <LinkMark />}
      </span>
      <span className="tag c-tag">
        {f.tag ? <><span className="dot" style={{background: tagColor(f.tag)}}></span>{f.tag}</> : <span style={{color:"var(--fg-3)"}}>—</span>}
      </span>
      <span className="size c-size">{f.size}</span>
      <span className="date c-date">{f.date}</span>
      <span className="tag c-git" style={{textAlign:"right"}}>
        {!showGitGutters ? <span style={{color:"var(--fg-3)"}}>—</span>
         : f.git === "M" ? <span style={{color:"var(--yellow)"}}>M</span>
         : f.git === "A" ? <span style={{color:"var(--green)"}}>A</span>
         : f.git === "D" ? <span style={{color:"var(--red)"}}>D</span>
         : f.git === "U" ? <span style={{color:"var(--red)"}}>U</span>
         : f.git === "?" ? <span style={{color:"var(--fg-2)"}}>?</span>
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
  error,
  loading,
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
        <div className="col c-tag" onClick={() => onSortChange("tag")}>tag <span className="sort">{sortArrow("tag")}</span></div>
        <div className="col c-size" style={{justifyContent:"flex-end"}} onClick={() => onSortChange("size")}>size <span className="sort">{sortArrow("size")}</span></div>
        <div className="col c-date" onClick={() => onSortChange("modified")}>modified <span className="sort">{sortArrow("modified")}</span></div>
        <div className="col c-git" style={{justifyContent:"flex-end"}} onClick={() => onSortChange("git")}>git <span className="sort">{sortArrow("git")}</span></div>
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
        {files.length === 0 && (
          error
            ? <div className="pane-notice error" role="alert"><b>can't read this folder</b><span>{error}</span></div>
            : <div className="pane-notice">{loading ? "loading…" : "empty folder"}</div>
        )}
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
      {/* Portaled: .pane is a size container (layout containment), which would
        * otherwise make it the containing block for this fixed-position ghost
        * and its viewport clientX/Y coords would land in the wrong place. */}
      {ghost && createPortal(
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
        </div>,
        document.body,
      )}
    </section>
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
  foldersFirst: boolean;
}

export interface TweaksProps {
  state: TweakState;
  setState: (s: TweakState) => void;
  onClose: () => void;
}

export function Tweaks({ state, setState, onClose }: TweaksProps) {
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
        <span>tweaks</span>
        <span className="close" onClick={onClose}>×</span>
      </div>
      <div className="tweaks-body">
        <div className="tweak">
          <label>theme</label>
          <select value={state.theme} onChange={(e) => setState({...state, theme: e.target.value})}>
            {THEMES.map(t => <option key={t} value={t}>{t}</option>)}
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
  /** Every name in a folder, hidden ones included; rejects if unreadable. */
  listNames: (dir: string) => Promise<string[]>;
  /** Called after all renames complete (or threw) so parent can refresh. */
  onDone: () => void;
}

export type CaseMode = "none" | "lower" | "upper" | "title";

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

/** Substitute {n} / {n:W} tokens with the row's sequence index, zero-padded
 *  to `defaultDigits`, or to W when the token gives one. */
function expandNumbering(s: string, seq: number, defaultDigits: number): string {
  return s.replace(/\{n(?::(\d+))?\}/g, (_m, d: string | undefined) => {
    const digits = d ? Math.max(1, parseInt(d, 10)) : defaultDigits;
    return formatNumber(seq, digits);
  });
}

export interface BulkRenameOptions {
  find: string;
  replace: string;
  prefix: string;
  suffix: string;
  numberEnabled: boolean;
  numberStart: number;
  /** Width `{n}` is padded to; `{n:W}` overrides it. */
  numberDigits: number;
  caseMode: CaseMode;
}

/** The dialog's preview: each item's new name under `opts`. */
export function bulkRenamePreview(items: BulkRenameItem[], opts: BulkRenameOptions): BulkRenamePlan[] {
  const { find, replace, prefix, suffix, numberEnabled, numberStart, numberDigits, caseMode } = opts;
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
    if (numberEnabled) next = expandNumbering(next, seq, numberDigits);
    const pfx = numberEnabled ? expandNumbering(prefix, seq, numberDigits) : prefix;
    const sfx = numberEnabled ? expandNumbering(suffix, seq, numberDigits) : suffix;
    // 3. prefix / suffix
    next = pfx + next + sfx;
    // 4. case transform (ext preserved verbatim)
    next = applyCase(next, caseMode);
    const finalName = next + ext;
    return { path: it.path, from: it.name, to: finalName };
  });
}

export function BulkRenameDialog({ items, onClose, renameOne, listNames, onDone }: BulkRenameDialogProps) {
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
  // What's already in each affected folder, so the preview can flag names
  // that would replace something outside the batch.
  const dirs = useMemo(() => [...new Set(items.map(it => parentPath(it.path)))], [items]);
  const [listings, setListings] = useState<Map<string, string[]> | null>(null);

  useEffect(() => { firstInputRef.current?.focus(); }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.all(dirs.map(async d => [d, await listNames(d)] as const))
      .then(entries => { if (!cancelled) setListings(new Map(entries)); })
      .catch(e => { if (!cancelled) setErr(`can't read the folder: ${e instanceof Error ? e.message : String(e)}`); });
    return () => { cancelled = true; };
  }, [dirs, listNames]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !running) { e.preventDefault(); onClose(); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose, running]);

  const preview = useMemo(
    () => bulkRenamePreview(items, { find, replace, prefix, suffix, numberEnabled, numberStart, numberDigits, caseMode }),
    [items, find, replace, prefix, suffix, numberEnabled, numberStart, numberDigits, caseMode],
  );

  // Problems by row: an invalid or duplicate name, or one already used by
  // something outside the batch.
  const { problems, changedCount } = useMemo(() => {
    const found = new Map<number, string>();
    for (const dir of dirs) {
      const rows = preview.map((_, i) => i).filter(i => parentPath(preview[i].path) === dir);
      const names = listings?.get(dir) ?? [];
      checkRenames(rows.map(i => preview[i]), names, IS_WINDOWS)
        .forEach((p, j) => { if (p) found.set(rows[j], p); });
    }
    let changed = 0;
    for (const p of preview) if (p.to !== p.from) changed++;
    return { problems: found, changedCount: changed };
  }, [preview, dirs, listings]);

  const hasCollision = problems.size > 0;
  const canRun = !running && listings !== null && !hasCollision && changedCount > 0;

  const run = async () => {
    if (!canRun) return;
    setRunning(true);
    setErr(null);
    // Re-read each folder (the dialog may have been open a while) and order
    // the renames so none lands on a name that's still in use.
    const steps: Array<{ dir: string; from: string; to: string }> = [];
    try {
      for (const dir of dirs) {
        const moves = preview.filter(p => p.to !== p.from && parentPath(p.path) === dir);
        if (moves.length === 0) continue;
        const names = await listNames(dir);
        const problem = checkRenames(moves, names, IS_WINDOWS).find(p => p !== null);
        if (problem) throw new Error(problem);
        for (const s of orderRenames(moves, names, IS_WINDOWS)) steps.push({ dir, ...s });
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setRunning(false);
      return;
    }
    setProgress({ done: 0, total: steps.length });
    const done: typeof steps = [];
    try {
      for (const s of steps) {
        await renameOne(joinPath(s.dir, s.from), joinPath(s.dir, s.to));
        done.push(s);
        setProgress({ done: done.length, total: steps.length });
      }
      onDone();
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // Put back what already ran, newest first, so nothing is left half
      // renamed or under a temporary name.
      let undone = true;
      for (const s of [...done].reverse()) {
        try { await renameOne(joinPath(s.dir, s.to), joinPath(s.dir, s.from)); }
        catch { undone = false; }
      }
      setErr(done.length === 0 ? msg
        : undone ? `${msg} (the renames before it were put back)`
          : `${msg} (some earlier renames couldn't be put back; check the folder)`);
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
                ? `${problems.size} problem${problems.size === 1 ? "" : "s"}`
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
              placeholder="prepend… ({n} = number)"
              style={inputStyle}
              disabled={running}
            />
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <span style={labelStyle}>suffix</span>
            <input
              value={suffix}
              onChange={(e) => setSuffix(e.target.value)}
              placeholder="append… ({n} = number)"
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
              onChange={(e) => setNumberDigits(Math.min(9, Math.max(1, parseInt(e.target.value, 10) || 1)))}
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
            const problem = problems.get(i);
            const dup = problem !== undefined;
            const unchanged = p.to === p.from;
            return (
              <div key={i} title={problem} style={{
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
              {problems.values().next().value}{problems.size > 1 ? ` (+${problems.size - 1} more)` : ""} — resolve before renaming
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
  trashEntry: (path: string) => Promise<void>;
  /** Picks each item's destination (and asks about conflicts); one step per
   *  item, null if the user cancelled. Rejects if dstDir can't be listed. */
  planTransfer: (items: TransferItem[], dstDir: string, op: TransferOp) => Promise<TransferStep[] | null>;
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

const SKIP_TEXT: Record<SkipReason, string> = {
  "same-place": "already here",
  "conflict": "skipped (exists)",
  "into-itself": "can't go inside itself",
};


export function PasteSpecialDialog({
  items,
  dstDir,
  clipboardMode,
  copyEntry,
  moveEntry,
  trashEntry,
  planTransfer,
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
      name: basename(it.path),
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

  const preview = items.slice(0, 5).map(it => basename(it.path));
  const extra = items.length > 5 ? items.length - 5 : 0;

  const run = async () => {
    if (running || items.length === 0) return;
    setRunning(true);
    let steps: TransferStep[] | null;
    try {
      steps = await planTransfer(
        items.map(it => ({ path: it.path, isDir: it.kind === "folder" })),
        dstDir,
        mode === "move" ? "move" : "copy",
      );
    } catch (e) {
      const msg = `can't read ${dstDir}: ${e instanceof Error ? e.message : String(e)}`;
      setRows(rows.map(r => ({ ...r, state: "fail", message: msg })));
      setRunning(false);
      return;
    }
    if (!steps) { setRunning(false); return; }
    let anyFail = false;
    // Local mutable copy so we can update rows incrementally.
    const working: RowStatus[] = rows.map(r => ({ ...r, state: "pending", message: undefined }));
    setRows(working.slice());
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const step = steps[i];
      if (step.action === "skip") {
        const fail = step.reason === "into-itself";
        anyFail ||= fail;
        working[i] = { ...working[i], state: fail ? "fail" : "ok", message: SKIP_TEXT[step.reason] };
        setRows(working.slice());
        continue;
      }
      const dst = step.dst;
      // Say so when the item landed under another name or replaced one.
      const note = (basename(dst) !== basename(it.path) ? ` as ${basename(dst)}` : "") +
        (step.replace ? " (old one trashed)" : "");
      working[i] = { ...working[i], state: "running" };
      setRows(working.slice());
      try {
        if (step.replace) await trashEntry(step.replace);
        if (mode === "move") {
          await moveEntry(it.path, dst);
          working[i] = { ...working[i], state: "ok", message: "moved" + note };
        } else if (mode === "copy") {
          await copyEntry(it.path, dst);
          working[i] = { ...working[i], state: "ok", message: "copied" + note };
        } else {
          // copy + verify
          await copyEntry(it.path, dst);
          if (it.kind === "folder") {
            working[i] = { ...working[i], state: "ok", message: `copied${note} (dir — not hashed)` };
          } else {
            const [h1, h2] = await Promise.all([hashSha256(it.path), hashSha256(dst)]);
            if (h1 === h2) {
              working[i] = { ...working[i], state: "ok", message: `ok${note} ${h1.slice(0, 12)}…` };
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

  const shortName = basename(blame.path);

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
          <span style={{ color: "var(--accent)" }}>⎘ diff — {basename(a)} ↔ {basename(b)}</span>
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
  const [version, setVersion] = useState("…");

  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onClose(); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      try {
        const v = await getVersion();
        if (!cancelled) setVersion(v);
      } catch {
        // tauri unavailable (e.g. vite dev without tauri host)
        if (!cancelled) setVersion("unknown");
      }
    })();
    return () => { cancelled = true; };
  }, [open]);

  if (!open) return null;

  const rows: Array<[string, string]> = [
    ["app", "Glasshouse"],
    ["version", version],
    ["tauri", TAURI_VERSION],
    // Stamped by vite.config.ts `define` at build (or dev-server start) time.
    ["built on", __BUILD_DATE__],
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
          display: "flex", justifyContent: "flex-end", gap: 8,
          background: "var(--bg-2, #16161e)",
        }}>
          <button onClick={() => { onClose(); openNotices(); }} style={{
            background: "transparent", border: "1px solid var(--fg-3)", color: "var(--fg-1)",
            padding: "4px 12px", cursor: "pointer", borderRadius: 2, fontFamily: "inherit",
          }}>third-party notices</button>
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
  /** Runs on OK once `validate` passes, with the prompt still open: the
   *  write itself, so a refusal shows inline instead of after the prompt
   *  closes. Resolve null to close (showPrompt resolves with the value), or
   *  an error string to stay open with it; a rejection's message shows the
   *  same way. The prompt can't be cancelled while it runs. */
  submit?: (value: string) => Promise<string | null>;
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

interface ChoiceOptions {
  title?: string;
  message: string;
  /** Buttons after "cancel", left to right. Enter picks the primary one;
   *  cancel, Esc and × resolve null. */
  choices: Array<{ id: string; label: string; primary?: boolean }>;
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
  showChoice: (opts: ChoiceOptions) => Promise<string | null>;
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
  showChoice: (opts) => {
    if (!dialogApiRef) return Promise.resolve<string | null>(null);
    return dialogApiRef.showChoice(opts);
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
  | { kind: "choice"; opts: ChoiceOptions; resolve: (v: string | null) => void }
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
  const promptBusy = useRef(false);
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
      showChoice: (opts) =>
        new Promise<string | null>((resolve) => {
          setState({ kind: "choice", opts, resolve });
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
    if (!state || promptBusy.current) return;
    if (state.kind === "prompt") state.resolve(null);
    else if (state.kind === "alert") state.resolve();
    else if (state.kind === "choice") state.resolve(null);
    else state.resolve(false);
    setState(null);
  };

  const submitPrompt = () => {
    if (state?.kind !== "prompt" || promptBusy.current) return;
    const v = promptValue;
    if (state.opts.validate) {
      const err = state.opts.validate(v);
      if (err) {
        setPromptError(err);
        return;
      }
    }
    const { submit } = state.opts;
    if (!submit) {
      state.resolve(v);
      setState(null);
      return;
    }
    const current = state;
    promptBusy.current = true;
    submit(v)
      .catch((err: unknown) => (err instanceof Error ? err.message : String(err)) || "failed")
      .then((err) => {
        promptBusy.current = false;
        if (err) {
          setPromptError(err);
          return;
        }
        current.resolve(v);
        setState((s) => (s === current ? null : s));
      });
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

  const choose = (id: string | undefined) => {
    if (state?.kind !== "choice" || id === undefined) return;
    state.resolve(id);
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
        else if (state.kind === "choice") choose(state.opts.choices.find(c => c.primary)?.id);
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

      {state?.kind === "choice" && (
        <div onClick={close} style={overlay}>
          <div onClick={(e) => e.stopPropagation()} style={panel}>
            <div style={header}>
              <span style={{ color: "var(--accent)" }}>{state.opts.title ?? "choose"}</span>
              <button onClick={close} style={closeBtn}>×</button>
            </div>
            <div style={{ ...body, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
              {state.opts.message}
            </div>
            <div style={footer}>
              <button onClick={close} style={btn(false)}>{state.opts.cancelLabel ?? "cancel"}</button>
              {state.opts.choices.map(c => (
                <button key={c.id} onClick={() => choose(c.id)} style={btn(!!c.primary)}>{c.label}</button>
              ))}
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
    const parent = parentPath(cwd);
    if (parent && parent !== cwd) setCwd(parent);
  };

  const crumbs = useMemo(() => splitBreadcrumb(cwd), [cwd]);

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
