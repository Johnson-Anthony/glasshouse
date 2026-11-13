// glasshouse file manager — components
import React, { useState, useEffect, useLayoutEffect, useRef, useMemo } from "react";
import { createPortal } from "react-dom";
import type { FileRow, FileKind } from "./data";
import { netRate, pathFsType, systemInfo as apiSystemInfo, winClose, winMinimize, winToggleMaximize, type GitInfo, type NetRate, type SystemInfo } from "./api";
import { viewRows } from "./viewRows";
import { remapIndexes } from "./listing";
import { rowWindow, rowsInSpan, scrollToRow } from "./paneWindow";
import { DropHighlight, dragCopies, dropPaths, dropTargetOf, leftWindow, type DropTarget } from "./dragDrop";
import { splitBreadcrumb } from "./paths";
import { kbKeys, searchPalette } from "./palette";
import { IS_WINDOWS } from "./platform";
import type { SortDir, SortKey } from "./state";
import { TAG_COLOR_MAP } from "./Sidebar";
import { isModalOpen } from "./dialogs/modal";
import { BOUND_CHARS, chordPending } from "./keymap";
import { isContextMenuKey, TypeAhead, typeAheadMatch, type MenuAnchor } from "./menuNav";

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
  /** Each tab's folder, where a drop on the tab goes. */
  tabPaths?: (string | undefined)[];
}

export function Titlebar({ tabs, activeTab, onSelectTab, onCloseTab, onNewTab, onTabContext, tabPaths }: TitlebarProps) {
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
            data-drop-path={tabPaths?.[i]}
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

export function Toolbar({ path, gitInfo, canBack, canForward, onBack, onForward, onUp, onRefresh, onGoTo, searchQuery, onSearchChange, searchInputRef, showHidden, onToggleHidden, showInspector, onToggleInspector, onCrumbContext, tagFilter, onClearTagFilter }: ToolbarProps) {
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
              data-drop-path={p.path}
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
      <div className="search">
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
  return (tag && TAG_COLOR_MAP[tag]) || "var(--fg-3)";
}

export { fullName } from "./viewRows";

/** A modified/created time as "YYYY-MM-DD HH:MM" local time, "—" when unset. */
export function formatDate(ms: number | null | undefined): string {
  if (!ms) return "—";
  const d = new Date(ms);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
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
  sortKey: SortKey;
  sortDir: SortDir;
  onSortChange: (k: SortKey) => void;
  foldersFirst?: boolean;
  showExtensions?: boolean;
  showGitGutters?: boolean;
  onContext: (e: MenuAnchor, kind: ContextKind, rowIndex?: number) => void;
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
  /** The drag left the window: hand these rows to the OS as a drag, for
   *  dropping into another app. `copy`: Ctrl was held as it left. */
  onDragOut?: (sourceOrigIndices: number[], copy: boolean) => void;
  paneRootRef?: React.Ref<HTMLElement>;
  /** The pane's folder: a drop on the pane outside a folder row goes here. */
  dropPath?: string;
  onActivate?: () => void;
  /** Paths currently in "cut" mode in the app clipboard — rendered dimmed. */
  cutPaths?: string[];
  /** Why the folder couldn't be listed; shown in place of the rows. */
  error?: string | null;
  /** A listing is in flight. Only shown while there are no rows yet. */
  loading?: boolean;
}

const PAGE_STEP = 10;

/** What the pane says when its filters hide every row. */
export function noMatchesText(searchQuery: string | undefined, tagFilter: string | null | undefined): string {
  const q = (searchQuery || "").trim();
  if (q && tagFilter) return `no matches for "${q}" tagged "${tagFilter}"`;
  if (q) return `no matches for "${q}"`;
  return `nothing tagged "${tagFilter}"`;
}

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

// FileRow is a display-only type without a filesystem path, but the host
// (App.tsx) always passes rows that carry their entry.
const rowPath = (f: FileRow): string | undefined => (f as { entry?: { path?: string } }).entry?.path;
/** The row's whole name, extension included, for type-ahead. */
const rowName = (f: FileRow): string =>
  (f as { entry?: { name?: string } }).entry?.name ?? (f.ext ? `${f.name}.${f.ext}` : f.name);

/** The pane's context menu for a right-click: the file menu on a row, the
 *  empty-space menu (New, Paste…) anywhere else, whatever is selected. */
export function paneContextKind(target: Pick<Element, "closest"> | null): "file" | "empty" {
  return target?.closest("[data-orig]") ? "file" : "empty";
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
         data-drop-path={f.kind === "folder" ? rowPath(f) : undefined}
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
  onDragOut,
  paneRootRef,
  dropPath,
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
  const displayFiles = useMemo(
    () => viewRows(files, { searchQuery, tagFilter, tagStore, sortKey, sortDir, foldersFirst }),
    [files, searchQuery, sortKey, sortDir, tagFilter, tagStore, foldersFirst],
  );

  // Map origIndex -> visible row position, for keyboard nav (which operates
  // on the currently-displayed ordering, not the raw entries array).
  const visibleOrig = useMemo(() => displayFiles.map(d => d.origIndex), [displayFiles]);
  const visiblePos = useMemo(() => {
    const m = new Map<number, number>();
    visibleOrig.forEach((o, i) => m.set(o, i));
    return m;
  }, [visibleOrig]);

  // Windowed list. In the list modes (Details, Compact List, Tree) rows are
  // one fixed height in one column, so only the rows in view plus an
  // overscan are rendered, between two spacers that keep the scrollbar
  // honest; see paneWindow.ts. The card modes (Grid, Icons, Tiles) lay rows
  // out in wrapping columns and render every row, as before. Which kind of
  // layout `.rows` has, the row height (it follows density and display
  // mode) and the viewport height are read from the DOM.
  const rowsRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ windowed: true, rowH: 26, viewH: 0, top: 0 });
  useLayoutEffect(() => {
    const el = rowsRef.current;
    if (!el) return;
    const windowed = getComputedStyle(el).display === "block";
    const rowH = el.querySelector<HTMLElement>(".row")?.offsetHeight || view.rowH;
    const viewH = el.clientHeight;
    if (windowed !== view.windowed || rowH !== view.rowH || viewH !== view.viewH) {
      setView(v => ({ ...v, windowed, rowH, viewH, top: el.scrollTop }));
    }
  });
  useEffect(() => {
    const el = rowsRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setView(v => (v.viewH === el.clientHeight ? v : { ...v, viewH: el.clientHeight })));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const win = view.windowed
    ? rowWindow(displayFiles.length, view.rowH, view.top, view.viewH)
    : { start: 0, end: displayFiles.length };
  // A scroll only re-renders when it moves the window.
  const onRowsScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const top = e.currentTarget.scrollTop;
    if (!view.windowed) return;
    setView(v => {
      const a = rowWindow(displayFiles.length, v.rowH, v.top, v.viewH);
      const b = rowWindow(displayFiles.length, v.rowH, top, v.viewH);
      return a.start === b.start && a.end === b.end ? v : { ...v, top };
    });
  };

  // The selection only holds rows on screen: when a filter or re-list hides a
  // selected row it drops out, so no command acts on a file you can't see.
  // A hidden focused row hands focus to the first visible one.
  useEffect(() => {
    if (selected.some(i => !visiblePos.has(i))) setSelected(selected.filter(i => visiblePos.has(i)));
    if (visibleOrig.length > 0 && !visiblePos.has(focusIndex)) setFocusIndex(visibleOrig[0]);
  }, [selected, focusIndex, visibleOrig, visiblePos, setSelected, setFocusIndex]);

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

  // The Menu key or Shift+F10: the selection's menu under the focused row
  // (scrolled into view first), or with nothing selected the empty-pane
  // menu (New, Paste…) at the top of the list.
  const openMenuFromKeys = () => {
    const el = rowsRef.current;
    const box = el?.getBoundingClientRect();
    const at: MenuAnchor = { clientX: (box?.left ?? 0) + 24, clientY: (box?.top ?? 0) + 8, keyboard: true };
    const pos = visiblePos.get(focusIndex);
    if (selected.length > 0 && el && box && pos !== undefined) {
      if (view.windowed) {
        const top = scrollToRow(pos, view.rowH, el.scrollTop, el.clientHeight);
        if (top !== null) {
          el.scrollTop = top;
          setView(v => ({ ...v, top: el.scrollTop }));
        }
        at.clientY = box.top + (pos + 1) * view.rowH - el.scrollTop;
      } else {
        const rowEl = el.querySelector<HTMLElement>(`.row[data-orig="${focusIndex}"]`);
        rowEl?.scrollIntoView?.({ block: "nearest" });
        const r = rowEl?.getBoundingClientRect();
        if (r) { at.clientX = r.left + 24; at.clientY = r.bottom; }
      }
    }
    onContext(at, selected.length > 0 ? "file" : "empty");
  };

  // Letters typed into the list, for type-ahead.
  const typeAhead = useRef<TypeAhead | null>(null);

  // Pane-local keyboard handling. Fires only when focus is inside the pane
  // (the global App-level listener covers app-wide shortcuts; we do NOT want
  // arrow-key selection to fire while focus is in the search box or sidebar).
  const onKeyDown = (e: React.KeyboardEvent) => {
    // The second key of a Ctrl+G chord is App's, whatever it is.
    if (isModalOpen() || chordPending()) return;
    if (isContextMenuKey(e)) {
      e.preventDefault();
      openMenuFromKeys();
      return;
    }
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
        if (onOpen && visiblePos.has(focusIndex)) onOpen(focusIndex);
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

    // Type-ahead: a printable key jumps to the next name starting with what
    // has been typed. Keys the keymap binds alone (/, *) stay its own, and
    // Space only continues a name (alone it's Quick Look). AltGr types
    // characters with Ctrl and Alt down on Windows.
    const altGr = e.ctrlKey && e.altKey && e.getModifierState("AltGraph");
    if ([...e.key].length !== 1 || e.metaKey || ((e.ctrlKey || e.altKey) && !altGr) || e.nativeEvent.isComposing) return;
    const now = Date.now();
    const ta = (typeAhead.current ??= new TypeAhead());
    if (e.key === " " ? !ta.active(now) : BOUND_CHARS.has(e.key.toLowerCase())) return;
    e.preventDefault();
    const hit = typeAheadMatch(displayFiles.map(d => rowName(d.file)), currentPos ?? -1, ta.push(e.key, now));
    if (hit >= 0) move(hit, false);
  };

  // Scroll focused row into view when it changes via keyboard. In the
  // windowed list the row may not be rendered yet, so the scroll position
  // comes from its index, and the window moves in the same commit, before
  // paint, so the jump never shows blank rows.
  useLayoutEffect(() => {
    if (!paneFocused) return;
    const pos = visiblePos.get(focusIndex);
    if (pos === undefined) return;
    const el = rowsRef.current;
    if (!el) return;
    if (!view.windowed) {
      el.querySelector<HTMLDivElement>(`.row[data-orig="${focusIndex}"]`)?.scrollIntoView({ block: "nearest" });
      return;
    }
    const top = scrollToRow(pos, view.rowH, el.scrollTop, el.clientHeight);
    if (top === null) return;
    el.scrollTop = top;
    setView(v => ({ ...v, top: el.scrollTop }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusIndex, paneFocused, visiblePos]);

  const sortArrow = (col: SortKey) => (sortKey === col ? (sortDir === "asc" ? "↑" : "↓") : "");

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
    // Held as indexes into the rows at mousedown; matched by path to the rows
    // on screen at each move, in case the folder re-lists mid-drag.
    const baseFiles = files;
    const baseSelection = selected.slice();
    const shift = e.shiftKey;
    const ctrl = e.ctrlKey || e.metaKey;
    // Clear selection on plain drag so the marquee sets it from scratch.
    if (!shift && !ctrl) setSelected([]);

    const updateSelection = (curMarquee: { x: number; y: number; w: number; h: number }) => {
      // The hits are rows on screen now, so they go through this render's
      // setter, which is bound to the same listing.
      const L = latest.current;
      const { setSelected } = L;
      const hit: number[] = [];
      const mx1 = curMarquee.x;
      const my1 = curMarquee.y;
      const mx2 = curMarquee.x + curMarquee.w;
      const my2 = curMarquee.y + curMarquee.h;
      const rowsEl = rowsRef.current;
      if (L.windowed && rowsEl) {
        // Rows span the container's width, one rowH each from its top.
        const rr = rowsEl.getBoundingClientRect();
        const rx1 = rr.left - rootRect.left;
        const rx2 = rx1 + rowsEl.clientWidth;
        const y0 = rr.top - rootRect.top - rowsEl.scrollTop;
        const span = rx1 < mx2 && rx2 > mx1 ? rowsInSpan(my1 - y0, my2 - y0, L.rowH, L.visibleOrig.length) : null;
        if (span) for (let p = span[0]; p <= span[1]; p++) hit.push(L.visibleOrig[p]);
      } else {
        root.querySelectorAll<HTMLElement>("[data-orig]").forEach((row) => {
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
      }
      const base = remapIndexes(baseFiles, L.files, baseSelection, rowPath);
      if (shift) {
        // Additive
        const s = new Set(base);
        for (const n of hit) s.add(n);
        setSelected(Array.from(s));
      } else if (ctrl) {
        // XOR toggle
        const s = new Set(base);
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
      const rowsEl = rowsRef.current;
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
  const live = { files, selected, visibleOrig, windowed: view.windowed, rowH: view.rowH, handleRowClick, onOpen, onContext, onRowDrop, onExternalDrag, onDragOut, setSelected, setAnchorIndex, setFocusIndex };
  const latest = useRef(live);
  latest.current = live;

  const rowHandlers = useMemo<RowHandlers>(() => ({
    pointerDown: (i, isSel, e) => {
      if (e.button !== 0) return;
      const startX = e.clientX;
      const startY = e.clientY;
      const startFiles = latest.current.files;
      const sources = isSel ? [...latest.current.selected] : [i];
      // The same files as indexes into the rows on screen at the drop, in
      // case the folder re-listed during the drag.
      const sourcesNow = () => remapIndexes(startFiles, latest.current.files, sources, rowPath);
      const sourcePaths = sources.map(s => rowPath(startFiles[s])).filter((p): p is string => !!p);
      // Tabs, breadcrumbs and sidebar rows light up as the drag passes over;
      // folder rows have their own highlight (dragOverIndex).
      const highlight = new DropHighlight();
      // What's under the pointer, when it isn't a folder row: lit only if a
      // drop there would do something, which Ctrl can change.
      let over: DropTarget | null = null;
      const light = (copy: boolean) =>
        highlight.set(over && dropPaths(sourcePaths, over.path, copy).length > 0 ? over.el : null);
      let dragging = false;
      let moved = false;
      const stop = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onPointerUp);
        window.removeEventListener("pointercancel", onPointerUp);
        window.removeEventListener("mouseout", onOut);
        window.removeEventListener("keydown", onKey);
        window.removeEventListener("keyup", onKey);
        highlight.set(null);
        setDragOverIndex(null);
        setGhost(null);
      };
      // Pressing or letting go of Ctrl mid-drag changes the operation, and
      // the ghost says so before the pointer moves again.
      const onKey = (ev: KeyboardEvent) => {
        if (!dragging) return;
        setGhost(g => g && { ...g, copy: dragCopies(ev) });
        light(dragCopies(ev));
      };
      // Out of the window with the button still down: the OS takes the drag
      // from here, so it can be dropped into another app.
      const handOff = (ev: MouseEvent) => {
        stop();
        const dropped = sourcesNow();
        if (dropped.length > 0) latest.current.onDragOut?.(dropped, dragCopies(ev));
      };
      const onOut = (ev: MouseEvent) => {
        if (dragging && ev.relatedTarget === null && latest.current.onDragOut) handOff(ev);
      };
      const onMove = (ev: PointerEvent) => {
        moved = true;
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        if (!dragging && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
        dragging = true;
        if (latest.current.onDragOut && leftWindow(ev.clientX, ev.clientY, window.innerWidth, window.innerHeight)) {
          handOff(ev);
          return;
        }
        setGhost({
          x: ev.clientX,
          y: ev.clientY,
          count: sources.length,
          copy: dragCopies(ev),
        });
        // Locate the row under the cursor and decide whether it's a valid drop target.
        const hit = document.elementFromPoint(ev.clientX, ev.clientY);
        const row = hit?.closest("[data-orig]") as HTMLElement | null;
        const origAttr = row?.getAttribute("data-orig");
        const origIdx = origAttr !== null && origAttr !== undefined ? parseInt(origAttr, 10) : -1;
        const hoverFile = origIdx >= 0 ? latest.current.files[origIdx] : undefined;
        const validTarget = hoverFile && hoverFile.kind === "folder" && !sources.includes(origIdx);
        setDragOverIndex(validTarget ? origIdx : null);
        over = validTarget ? null : dropTargetOf(hit);
        light(dragCopies(ev));
      };
      const onPointerUp = (ev: PointerEvent) => {
        stop();
        if (!dragging) return;
        // The click that follows a drop isn't one: with Ctrl, a drop on the
        // row it started from would flip that row's selection.
        const swallow = (c: MouseEvent) => { c.stopPropagation(); c.preventDefault(); };
        window.addEventListener("click", swallow, { capture: true, once: true });
        setTimeout(() => window.removeEventListener("click", swallow, true), 0);
        const copy = dragCopies(ev);
        const hit = document.elementFromPoint(ev.clientX, ev.clientY);
        const row = hit?.closest("[data-orig]") as HTMLElement | null;
        const origAttr = row?.getAttribute("data-orig");
        const dropped = sourcesNow();
        if (dropped.length === 0) return;
        if (origAttr) {
          const targetIdx = parseInt(origAttr, 10);
          const targetFile = latest.current.files[targetIdx];
          if (targetFile && targetFile.kind === "folder") {
            const filtered = dropped.filter(s => s !== targetIdx);
            if (filtered.length > 0) {
              latest.current.onRowDrop?.(targetIdx, filtered, copy);
              return;
            }
          }
        }
        // Not over a folder row — delegate to external drop handler
        // (e.g. sidebar tree-row). App resolves the drop target.
        latest.current.onExternalDrag?.(dropped, ev.clientX, ev.clientY, copy);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onPointerUp);
      window.addEventListener("pointercancel", onPointerUp);
      window.addEventListener("mouseout", onOut);
      window.addEventListener("keydown", onKey);
      window.addEventListener("keyup", onKey);
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
      data-drop-path={dropPath || undefined}
      tabIndex={0}
      onFocus={() => { setPaneFocused(true); if (onActivate) onActivate(); }}
      onBlur={(e) => {
        // Only drop focus if the new focus target is outside the pane.
        if (!paneRef.current?.contains(e.relatedTarget as Node)) setPaneFocused(false);
      }}
      onKeyDown={onKeyDown}
      onMouseDown={onPaneMouseDown}
      onContextMenu={(e) => { e.preventDefault(); onContext(e, paneContextKind(e.target as Element)); }}
    >
      <div className="pane-head">
        <div className="col"></div>
        <div className="col" onClick={() => onSortChange("name")}>name <span className="sort">{sortArrow("name")}</span></div>
        <div className="col c-tag" onClick={() => onSortChange("tag")}>tag <span className="sort">{sortArrow("tag")}</span></div>
        <div className="col c-size" style={{justifyContent:"flex-end"}} onClick={() => onSortChange("size")}>size <span className="sort">{sortArrow("size")}</span></div>
        <div className="col c-date" onClick={() => onSortChange("modified")}>modified <span className="sort">{sortArrow("modified")}</span></div>
        <div className="col c-git" style={{justifyContent:"flex-end"}} onClick={() => onSortChange("git")}>git <span className="sort">{sortArrow("git")}</span></div>
      </div>
      <div className="rows" ref={rowsRef} onScroll={onRowsScroll}>
        {win.start > 0 && <div className="rows-spacer" aria-hidden="true" style={{ height: win.start * view.rowH }} />}
        {displayFiles.slice(win.start, win.end).map(({ file: f, origIndex: i }) => {
          const fPath = rowPath(f);
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
        {win.end < displayFiles.length && <div className="rows-spacer" aria-hidden="true" style={{ height: (displayFiles.length - win.end) * view.rowH }} />}
        {files.length === 0 && (
          error
            ? <div className="pane-notice error" role="alert"><b>can't read this folder</b><span>{error}</span></div>
            : <div className="pane-notice">{loading ? "loading…" : "empty folder"}</div>
        )}
        {files.length > 0 && displayFiles.length === 0 && (
          <div className="pane-notice">{noMatchesText(searchQuery, tagFilter)}</div>
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
        <div className="drag-ghost" style={{ left: ghost.x + 10, top: ghost.y + 10 }}>
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

const PALETTE_PLACEHOLDER = IS_WINDOWS
  ? "type a command, or a path (C:\\…, ~\\…)"
  : "type a command, or a path (/…, ~/…)";

/** Every menu command (see palette.ts), plus "Go to" for a typed path. */
export function Palette({ onClose, onCommand }: PaletteProps) {
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const rows = useMemo(() => searchPalette(q), [q]);
  const browsing = !q.trim();

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => { setIdx(0); }, [q]);
  useEffect(() => {
    bodyRef.current?.querySelector(".pal-row.active")?.scrollIntoView?.({ block: "nearest" });
  }, [idx, rows]);

  const run = (label: string) => { onCommand(label); onClose(); };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") onClose();
    // Focus stays in the box: there's nothing to complete.
    if (e.key === "Tab") e.preventDefault();
    if (e.key === "ArrowDown" && rows.length) { e.preventDefault(); setIdx((idx + 1) % rows.length); }
    if (e.key === "ArrowUp" && rows.length) { e.preventDefault(); setIdx((idx - 1 + rows.length) % rows.length); }
    if (e.key === "Enter") {
      // The palette owns this Enter. A dialog the command opens adds its
      // window keydown listener while the event is still bubbling, and
      // would take it as its own Enter (New Folder made "new-folder").
      e.preventDefault();
      e.stopPropagation();
      const sel = rows[idx];
      if (sel) run(sel.send);
      else onClose();
    }
  };

  return (
    <div className="palette-overlay" onClick={onClose}>
      <div className="palette" onClick={(e) => e.stopPropagation()} onKeyDown={onKey}>
        <div className="palette-head">
          <span className="prefix">❯</span>
          <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder={PALETTE_PLACEHOLDER} />
          <span className="hint">{rows.length} results · <span className="kbd">↑↓</span> navigate</span>
        </div>
        <div className="palette-body" ref={bodyRef}>
          {rows.map((r, i) => {
            // Under a group header, the menu's name would only repeat it.
            const where = browsing && r.where[0] === r.group ? r.where.slice(1) : r.where;
            return (
              <React.Fragment key={i}>
                {browsing && r.group !== rows[i - 1]?.group && <div className="pal-group">{r.group}</div>}
                {/* Mouse move, not enter: rows scrolled under a still pointer
                    would otherwise take the highlight from the arrow keys. */}
                <div className={"pal-row" + (r.danger ? " danger" : "") + (i === idx ? " active" : "")}
                  onMouseMove={() => { if (i !== idx) setIdx(i); }} onClick={() => run(r.send)}>
                  <span className="ic">{r.ic}</span>
                  <span className="name">
                    <span>{r.label}</span>
                    {where.length > 0 && <span className="where">{where.join(" › ")}</span>}
                  </span>
                  <span className="kb">{r.kb && kbKeys(r.kb).map((k, j) => <span key={j}>{k}</span>)}</span>
                </div>
              </React.Fragment>
            );
          })}
          {rows.length === 0 && (
            <div style={{padding: 20, textAlign: "center", color:"var(--fg-3)"}}>no matching command</div>
          )}
        </div>
        <div className="palette-foot">
          <span><span className="kb">↵</span>run</span>
          <span><span className="kb">Esc</span>close</span>
          <span style={{marginLeft:"auto"}}>a typed path opens that folder</span>
        </div>
      </div>
    </div>
  );
}

// ============= Settings =============
// The display settings, saved in localStorage["glasshouse.tweaks"] and set
// from Preferences… (dialogs/Preferences.tsx) and the View menu.
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
  /** The terminal types a `cd` when the active tab's folder changes. */
  termFollow: boolean;
  /** The window's zoom, as a factor (1 = 100%; see zoom.ts). */
  zoom: number;
}
