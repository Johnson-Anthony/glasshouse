// glasshouse file manager — components
import React, { useState, useEffect, useId, useLayoutEffect, useRef, useMemo } from "react";
import { createPortal } from "react-dom";
import type { FileRow, FileKind } from "./data";
import { winClose, winMinimize, winToggleMaximize, type GitInfo } from "./api";
import { viewRows } from "./viewRows";
import { fileType } from "./fileTypes";
import { remapIndexes } from "./listing";
import { rowWindow, rowsInSpan, scrollToRow } from "./paneWindow";
import { DropHighlight, dragCopies, dropPaths, dropTargetOf, keepSelection, leftWindow, type DropTarget } from "./dragDrop";
import { splitBreadcrumb } from "./paths";
import { kbKeys, searchPalette } from "./palette";
import { IS_WINDOWS } from "./platform";
import type { SortDir, SortKey } from "./state";
import { TAG_COLOR_MAP, type TagSet } from "./Sidebar";
import { isModalOpen } from "./dialogs/modal";
import { BOUND_CHARS, chordPending } from "./keymap";
import { isContextMenuKey, TypeAhead, typeAheadMatch, type MenuAnchor } from "./menuNav";
import { LOOK_APPLIED, type Density, type LookState } from "./look";
import type { StatusItem } from "./statusItems";
import { announce } from "./announce";

// ============= Titlebar =============
export interface TabDef {
  ic: string;
  color: string;
  label: string;
}

export interface TitlebarProps extends TabStripProps {
  /** Split: each pane has its own tab bar, and the title bar holds none. */
  split?: boolean;
}

export function Titlebar({ split, ...strip }: TitlebarProps) {
  return (
    <div className="titlebar" data-tauri-drag-region>
      <WindowControls />
      {split ? <div className="tabs" data-tauri-drag-region /> : <TabStrip {...strip} dragRegion />}
    </div>
  );
}

export interface TabStripProps {
  tabs: TabDef[];
  activeTab: number;
  onSelectTab: (i: number) => void;
  onCloseTab: (i: number) => void;
  onNewTab: () => void;
  onTabContext?: (e: React.MouseEvent, tabIndex: number) => void;
  /** Each tab's folder, where a drop on the tab goes. */
  tabPaths?: (string | undefined)[];
  /** The pane these tabs belong to (tabLayout.ts); 0 unsplit. */
  pane?: number;
  /** A press on a tab, which may become a drag (tabMoves.ts). */
  onTabPointerDown?: (e: React.PointerEvent, tabIndex: number) => void;
  /** Its empty part moves the window (the title bar's). */
  dragRegion?: boolean;
}

/** A row of tabs: the title bar's, or a split pane's. `data-tab-bar` and
 *  `data-tab-index` are where a dragged tab can go (tabDrag.ts).
 *
 *  To a screen reader it's a tablist. The tab is the label, and the close
 *  button sits beside it, not inside: a tab's contents aren't exposed
 *  (WebKit drops them). The shown tab is the one in the Tab order; Left,
 *  Right, Home and End move along the tabs and show the one reached. A
 *  mouse press leaves the focus where it was, usually on the file list. */
export function TabStrip({ tabs, activeTab, onSelectTab, onCloseTab, onNewTab, onTabContext, tabPaths, pane = 0, onTabPointerDown, dragRegion }: TabStripProps) {
  const onTabKey = (e: React.KeyboardEvent<HTMLElement>, i: number) => {
    if (e.ctrlKey || e.altKey || e.metaKey || e.shiftKey || tabs.length === 0) return;
    const n = tabs.length;
    const to = e.key === "ArrowRight" ? (i + 1) % n
      : e.key === "ArrowLeft" ? (i - 1 + n) % n
      : e.key === "Home" ? 0
      : e.key === "End" ? n - 1
      // Prevented, so the keymap's Open and Quick Look leave them alone.
      : e.key === "Enter" || e.key === " " ? i
      : -1;
    if (to < 0) return;
    e.preventDefault();
    if (to !== activeTab) onSelectTab(to);
    e.currentTarget.closest("[role=tablist]")?.querySelectorAll<HTMLElement>("[role=tab]")[to]?.focus();
  };
  return (
    <div className="tabs" data-tauri-drag-region={dragRegion || undefined} data-tab-bar={pane}>
      <div className="tab-list" role="tablist" aria-label={dragRegion ? "Tabs" : `Tabs, pane ${pane + 1}`}>
      {tabs.map((t, i) => (
        <div
          key={i}
          role="presentation"
          className={"tab" + (i === activeTab ? " active" : "")}
          data-drop-path={tabPaths?.[i]}
          data-tab-index={i}
          onPointerDown={onTabPointerDown && (e => onTabPointerDown(e, i))}
          onMouseDown={(e) => { if (e.button === 0) e.preventDefault(); }}
          onClick={() => onSelectTab(i)}
          onContextMenu={(e) => {
            if (!onTabContext) return;
            e.preventDefault();
            e.stopPropagation();
            onTabContext(e, i);
          }}
        >
          <span className="ico" aria-hidden="true" style={{color: t.color}}>{t.ic}</span>
          <span className="label" role="tab" aria-selected={i === activeTab} tabIndex={i === activeTab ? 0 : -1} onKeyDown={(e) => onTabKey(e, i)}>{t.label}</span>
          <button type="button" className="close" tabIndex={-1} title="Close tab" aria-label={`Close tab ${t.label}`} onClick={(e) => { e.stopPropagation(); onCloseTab(i); }}></button>
        </div>
      ))}
      </div>
      <div className="tab-actions">
        <button type="button" className="tab-btn" title="New tab" aria-label="New tab" onClick={onNewTab}>+</button>
      </div>
    </div>
  );
}

/** Minimize, maximize and close. One set of buttons that app.css draws in
 *  the style Preferences picks (html[data-controls]: Windows, GNOME, macOS
 *  dots, or hidden) and on its side; out of the Tab order, like a native
 *  title bar's. */
function WindowControls() {
  // useLook keeps html[data-maximized] in step with the window; the middle
  // button says what it will do.
  const [maximized, setMaximized] = useState(false);
  useEffect(() => {
    const root = document.documentElement;
    const read = () => setMaximized(root.getAttribute("data-maximized") === "on");
    read();
    if (typeof MutationObserver === "undefined") return;
    const mo = new MutationObserver(read);
    mo.observe(root, { attributes: true, attributeFilter: ["data-maximized"] });
    return () => mo.disconnect();
  }, []);
  const maxLabel = maximized ? "Restore" : "Maximize";
  return (
    <div className="winctl">
      <button type="button" tabIndex={-1} className="wc min" title="Minimize" aria-label="Minimize" onClick={() => { void winMinimize(); }}>
        <svg viewBox="0 0 10 10" aria-hidden="true"><path d="M0 5.5h10" /></svg>
      </button>
      <button type="button" tabIndex={-1} className="wc max" title={maxLabel} aria-label={maxLabel} onClick={() => { void winToggleMaximize(); }}>
        <svg viewBox="0 0 10 10" aria-hidden="true">
          <rect className="i-max" x="0.5" y="0.5" width="9" height="9" />
          <path className="i-restore" d="M2.5 2.5V0.5h7v7h-2M0.5 2.5h7v7h-7z" />
        </svg>
      </button>
      <button type="button" tabIndex={-1} className="wc close" title="Close" aria-label="Close" onClick={() => { void winClose(); }}>
        <svg viewBox="0 0 10 10" aria-hidden="true"><path d="M0.5 0.5l9 9M9.5 0.5l-9 9" /></svg>
      </button>
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
  /** Left out where there's no inspector (the open/save dialog). */
  onToggleInspector?: () => void;
  onCrumbContext?: (e: React.MouseEvent, path: string) => void;
  tagFilter?: string | null;
  onClearTagFilter?: () => void;
}

/** The toolbar's git line in words: its arrows and dot are glyphs. */
function gitWords(g: GitInfo): string {
  return [
    `git branch ${g.branch}`,
    g.ahead > 0 ? `${g.ahead} ahead` : "",
    g.behind > 0 ? `${g.behind} behind` : "",
    g.dirty > 0 ? `${g.dirty} changed` : "",
  ].filter(Boolean).join(", ");
}

export function Toolbar({ path, gitInfo, canBack, canForward, onBack, onForward, onUp, onRefresh, onGoTo, searchQuery, onSearchChange, searchInputRef, showHidden, onToggleHidden, showInspector, onToggleInspector, onCrumbContext, tagFilter, onClearTagFilter }: ToolbarProps) {
  const parts = splitBreadcrumb(path);
  // A mouse press on a toolbar button leaves the focus where it was, usually
  // on the file list, so the arrow keys still move there after a click.
  const keepFocus = (e: React.MouseEvent) => {
    if (e.button === 0 && (e.target as HTMLElement).closest("button")) e.preventDefault();
  };
  return (
    <div className="toolbar" onMouseDown={keepFocus}>
      <div className="nav-btns">
        <button type="button" className="nav-btn" title="Back (Alt+←)" aria-label="Back" onClick={onBack} disabled={!canBack}>←</button>
        <button type="button" className="nav-btn" title="Forward (Alt+→)" aria-label="Forward" onClick={onForward} disabled={!canForward}>→</button>
        <button type="button" className="nav-btn" title="Up (Alt+↑)" aria-label="Up to the parent folder" onClick={onUp}>↑</button>
        <button type="button" className="nav-btn" title="Refresh (F5)" aria-label="Refresh" onClick={onRefresh}>↻</button>
      </div>
      <nav className="breadcrumb" aria-label="Folder path">
        {parts.map((p, i) => (
          <React.Fragment key={i}>
            <button
              type="button"
              className={"crumb" + (i === parts.length - 1 ? " last" : "")}
              aria-current={i === parts.length - 1 ? "location" : undefined}
              data-drop-path={p.path}
              onClick={() => onGoTo(p.path)}
              onContextMenu={(e) => {
                if (!onCrumbContext) return;
                e.preventDefault();
                e.stopPropagation();
                onCrumbContext(e, p.path);
              }}
              style={{cursor:"pointer"}}
            >{p.label}</button>
            {i < parts.length - 1 && <span className="sep" aria-hidden="true">/</span>}
          </React.Fragment>
        ))}
        {gitInfo && (
          <span className="git-branch" role="img" aria-label={gitWords(gitInfo)}>
            ⎇ {gitInfo.branch}
            {gitInfo.ahead > 0 && <> ↑{gitInfo.ahead}</>}
            {gitInfo.behind > 0 && <> ↓{gitInfo.behind}</>}
            {gitInfo.dirty > 0 && <> ●{gitInfo.dirty}</>}
          </span>
        )}
        {tagFilter && (
          <button
            type="button"
            className="tag-chip"
            onClick={onClearTagFilter}
            title="clear tag filter"
            aria-label={`Showing tag ${tagFilter}; clear the tag filter`}
            style={{
              font: "inherit",
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
          >Tag: {tagFilter} <span style={{color:"var(--fg-3)", marginLeft:4}}>✕</span></button>
        )}
      </nav>
      <div className="search">
        <span aria-hidden="true" style={{color: "var(--fg-3)"}}>⌕</span>
        <input
          ref={searchInputRef}
          aria-label="Find in this folder"
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
        <span className="kb" aria-hidden="true">/</span>
      </div>
      <div className="tool-group">
        <button
          type="button"
          className={"nav-btn" + (showHidden ? " active" : "")}
          title="Toggle hidden (Ctrl+H)"
          aria-label="Show hidden files"
          onClick={onToggleHidden}
          aria-pressed={showHidden}
        >·h</button>
        {onToggleInspector && <button
          type="button"
          className={"nav-btn" + (showInspector ? " active" : "")}
          title="Toggle inspector"
          aria-label="Inspector"
          onClick={onToggleInspector}
          aria-pressed={showInspector}
        >◨</button>}
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
  /** The pane is Miller's middle column, with ranger's keys: ← and h open
   *  the parent folder, → and l open the focused row, j and k move like ↓
   *  and ↑. */
  millerKeys?: boolean;
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
  return <span className="link" role="img" title="symbolic link" aria-label="symbolic link">↪</span>;
}

/** What a git status letter means, for a screen reader. */
const GIT_WORDS: Record<string, string> = { M: "modified", A: "added", D: "deleted", U: "conflicted", "?": "untracked" };

/** One file row. Memoized: with thousands of entries, re-rendering every row
 *  on each selection/focus change is what made large directories crawl —
 *  only rows whose flags flip re-render now.
 *
 *  To a screen reader it's a grid row of cells in the list modes, and one
 *  option of a listbox in the card modes (`card`), where the rows wrap into
 *  columns. Its id is what the pane's aria-activedescendant names. */
const PaneRow = React.memo(function PaneRow({
  f, i, idp, rowIndex, card, isSel, isFocus, isDragOver, isCut, showGitGutters, showExtensions, h,
}: {
  f: FileRow;
  i: number;
  /** The pane's prefix for row ids. */
  idp: string;
  /** The row's aria-rowindex in the windowed list; unset where every row
   *  is rendered and the browser can count. */
  rowIndex?: number;
  /** A card mode: the row is a listbox option, not a grid row. */
  card: boolean;
  isSel: boolean;
  isFocus: boolean;
  isDragOver: boolean;
  isCut: boolean;
  showGitGutters: boolean;
  showExtensions: boolean;
  h: RowHandlers;
}) {
  const ki = kindIcon(f.kind);
  const cell = card ? undefined : "gridcell";
  return (
    <div data-orig={i}
         id={idp + i}
         role={card ? "option" : "row"}
         aria-selected={isSel}
         aria-rowindex={rowIndex}
         data-ft={fileType(f.kind, f.ext, rowName(f))}
         data-drop-path={f.kind === "folder" ? rowPath(f) : undefined}
         data-git={showGitGutters && f.git ? f.git : undefined}
         style={f.tag ? { "--tag-c": tagColor(f.tag) } as React.CSSProperties : undefined}
         className={"row" + (isSel ? " selected" : "") + (isFocus ? " focused" : "") + (isDragOver ? " drop-target" : "") + (isCut ? " clip-cut" : "")}
         onPointerDown={(e) => h.pointerDown(i, isSel, e)}
         onClick={(e) => h.click(i, e)}
         onDoubleClick={() => h.dblClick(i)}
         onContextMenu={(e) => h.ctxMenu(i, isSel, e)}>
      {/* The icon is a picture of the kind; only "folder" is said. */}
      <span className={"ic " + ki.cls} role={cell} aria-label={!card && f.kind === "folder" ? "folder" : undefined} aria-hidden={card || undefined}><i aria-hidden="true">{ki.ic}</i></span>
      <span className="name" role={cell}>
        {showGitGutters && f.git && <span className={"git-dot " + gitDotClass(f.git)}></span>}
        <span className={f.hidden ? "hid" : undefined}>{f.name}</span>
        {showExtensions && f.ext && !f.hidden && f.kind !== "folder" && <span className="ext">.{f.ext}</span>}
        {f.link && <LinkMark />}
        {card && f.kind === "folder" && <span className="sr-only">, folder</span>}
      </span>
      <span className="tag c-tag" role={cell}>
        {f.tag ? <><span className="dot" style={{background: tagColor(f.tag)}}></span>{f.tag}</> : <span aria-hidden="true" style={{color:"var(--fg-4)"}}>—</span>}
      </span>
      <span className="size c-size" role={cell}>{f.size}</span>
      <span className="date c-date" role={cell}>{f.date}</span>
      <span className="tag c-git" role={cell} aria-label={showGitGutters && f.git ? GIT_WORDS[f.git] : undefined} style={{textAlign:"right"}}>
        {!showGitGutters ? <span aria-hidden="true" style={{color:"var(--fg-4)"}}>—</span>
         : f.git === "M" ? <span style={{color:"var(--yellow)"}}>M</span>
         : f.git === "A" ? <span style={{color:"var(--green)"}}>A</span>
         : f.git === "D" ? <span style={{color:"var(--red)"}}>D</span>
         : f.git === "U" ? <span style={{color:"var(--red)"}}>U</span>
         : f.git === "?" ? <span style={{color:"var(--fg-2)"}}>?</span>
         : <span aria-hidden="true" style={{color:"var(--fg-4)"}}>—</span>}
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
  millerKeys,
}: FilePaneProps) {
  const paneRef = useRef<HTMLElement>(null);
  // Wire external ref (App keeps a handle to focus programmatically for Tab nav).
  useEffect(() => {
    if (!paneRootRef) return;
    if (typeof paneRootRef === "function") paneRootRef(paneRef.current);
    else (paneRootRef as React.MutableRefObject<HTMLElement | null>).current = paneRef.current;
  });
  // Row ids, for aria-activedescendant: this pane's own, and new ones when
  // another folder's listing arrives, so a screen reader says the focused
  // row again though its index is the same. The path changes before the
  // rows do; a re-list of the same folder keeps the ids.
  const uid = useId();
  const listed = useRef({ files, path: dropPath, gen: 0, said: 0 });
  if (listed.current.files !== files) {
    const moved = listed.current.path !== dropPath;
    listed.current = { ...listed.current, files, path: dropPath, gen: listed.current.gen + (moved ? 1 : 0) };
  }
  const gen = listed.current.gen;
  const idp = `fp${uid.replace(/:/g, "")}g${gen}-`;
  const folder = useMemo(() => (dropPath ? splitBreadcrumb(dropPath).pop()?.label : undefined), [dropPath]);
  // Said once per folder, when its rows are in: the focus doesn't move on a
  // navigation, so nothing else would tell a screen reader. A folder that
  // can't be read says so itself (the notice is an alert).
  useEffect(() => {
    const l = listed.current;
    if (l.said === gen || loading || error) return;
    l.said = gen;
    announce(`${folder ?? "folder"}: ${files.length === 0 ? "empty" : files.length === 1 ? "1 item" : `${files.length} items`}`);
  }, [gen, loading, error, folder, files]);
  const sorted = useRef({ gen, sortKey, sortDir });
  useEffect(() => {
    const was = sorted.current;
    sorted.current = { gen, sortKey, sortDir };
    // Another folder (or tab) brings its own order; that isn't a re-sort.
    if (was.gen !== gen || (was.sortKey === sortKey && was.sortDir === sortDir)) return;
    announce(`sorted by ${sortKey}, ${sortDir === "asc" ? "ascending" : "descending"}`);
  }, [gen, sortKey, sortDir]);

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
  // mode) and the viewport height are read from the DOM. So is whether the
  // column header shows (not in Miller's column), which is a row of the
  // grid a screen reader counts.
  const rowsRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ windowed: true, rowH: 26, viewH: 0, top: 0, head: true });
  useLayoutEffect(() => {
    const el = rowsRef.current;
    if (!el) return;
    const windowed = getComputedStyle(el).display === "block";
    const rowH = el.querySelector<HTMLElement>(".row")?.offsetHeight || view.rowH;
    const viewH = el.clientHeight;
    const head = !!el.previousElementSibling && getComputedStyle(el.previousElementSibling).display !== "none";
    if (windowed !== view.windowed || rowH !== view.rowH || viewH !== view.viewH || head !== view.head) {
      setView(v => ({ ...v, windowed, rowH, viewH, head, top: el.scrollTop }));
    }
  });
  useEffect(() => {
    const el = rowsRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setView(v => (v.viewH === el.clientHeight ? v : { ...v, viewH: el.clientHeight })));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // The look (text size, density) changes the row height after this pane
  // has rendered: useLook applies it in an effect, then says so.
  useEffect(() => {
    const remeasure = () => {
      const rowH = rowsRef.current?.querySelector<HTMLElement>(".row")?.offsetHeight;
      if (rowH) setView(v => (v.rowH === rowH ? v : { ...v, rowH }));
    };
    window.addEventListener(LOOK_APPLIED, remeasure);
    return () => window.removeEventListener(LOOK_APPLIED, remeasure);
  }, []);
  const win = view.windowed
    ? rowWindow(displayFiles.length, view.rowH, view.top, view.viewH)
    : { start: 0, end: displayFiles.length };
  // To a screen reader the list modes are a grid (a header row, then a row
  // of cells per file) and the card modes, whose rows wrap into columns, a
  // listbox. The windowed grid says how many rows it has and which each one
  // is; the pane names its focused row only while that row is rendered.
  const card = !view.windowed;
  const headRows = view.head ? 1 : 0;
  const focusPos = visiblePos.get(focusIndex);
  const activeId = focusPos !== undefined && focusPos >= win.start && focusPos < win.end ? idp + focusIndex : undefined;
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

  // The column headers take the focus from the keys: Up from the first row
  // reaches them, Left and Right move along them, Enter or Space sorts, and
  // Down or Escape goes back to the rows.
  const headCols = () =>
    [...(paneRef.current?.querySelectorAll<HTMLElement>(".pane-head [data-sort]") ?? [])]
      .filter(c => getComputedStyle(c).display !== "none");
  /** False when no header shows (the card modes, Miller's column). */
  const focusHead = (): boolean => {
    const head = paneRef.current?.querySelector<HTMLElement>(".pane-head");
    if (!head || getComputedStyle(head).display === "none") return false;
    const cols = headCols();
    const to = cols.find(c => c.dataset.sort === sortKey) ?? cols[0];
    to?.focus();
    return !!to;
  };
  const onHeadKey = (e: React.KeyboardEvent, at: HTMLElement) => {
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    const cols = headCols();
    const i = cols.indexOf(at);
    const go = (to: HTMLElement | null | undefined) => { e.preventDefault(); to?.focus(); };
    switch (e.key) {
      case "ArrowLeft": go(cols[Math.max(0, i - 1)]); return;
      case "ArrowRight": go(cols[Math.min(cols.length - 1, i + 1)]); return;
      case "Home": go(cols[0]); return;
      case "End": go(cols[cols.length - 1]); return;
      case "ArrowUp": e.preventDefault(); return;
      case "ArrowDown":
      case "Escape": go(paneRef.current); return;
      case "Enter":
      case " ":
        // Prevented, so the keymap's Open and Quick Look leave it alone.
        e.preventDefault();
        onSortChange(at.dataset.sort as SortKey);
        return;
    }
  };

  // Letters typed into the list, for type-ahead.
  const typeAhead = useRef<TypeAhead | null>(null);

  // Pane-local keyboard handling. Fires only when focus is inside the pane
  // (the global App-level listener covers app-wide shortcuts; we do NOT want
  // arrow-key selection to fire while focus is in the search box or sidebar).
  const onKeyDown = (e: React.KeyboardEvent) => {
    // The second key of a Ctrl+G chord is App's, whatever it is.
    if (isModalOpen() || chordPending()) return;
    const headEl = (e.target as HTMLElement).closest<HTMLElement>(".pane-head [data-sort]");
    if (headEl) { onHeadKey(e, headEl); return; }
    if (isContextMenuKey(e)) {
      e.preventDefault();
      openMenuFromKeys();
      return;
    }
    // Miller's keys; a letter continues a type-ahead already under way.
    let key = e.key;
    if (millerKeys && !e.ctrlKey && !e.altKey && !e.metaKey) {
      const k = key.length === 1 ? key.toLowerCase() : key;
      if (!(k.length === 1 && typeAhead.current?.active(Date.now()))) {
        if (k === "ArrowLeft" || k === "h") {
          e.preventDefault();
          onUp?.();
          return;
        }
        if (k === "ArrowRight" || k === "l") {
          e.preventDefault();
          if (onOpen && visiblePos.has(focusIndex)) onOpen(focusIndex);
          return;
        }
        if (k === "j") key = "ArrowDown";
        else if (k === "k") key = "ArrowUp";
      }
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

    switch (key) {
      case "ArrowDown":
        e.preventDefault();
        move(safePos + 1, e.shiftKey);
        return;
      case "ArrowUp":
        e.preventDefault();
        // A new press on the first row goes up to the column headers; a
        // held key stops at the row.
        if (currentPos === 0 && !e.shiftKey && !e.repeat && focusHead()) return;
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
  /** A column header: says how its column is sorted, and can take focus. */
  const headCol = (col: SortKey) => ({
    role: "columnheader",
    tabIndex: -1,
    "data-sort": col,
    "aria-sort": sortKey === col ? (sortDir === "asc" ? "ascending" : "descending") : undefined,
  } as const);

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
    const target = e.target as HTMLElement;
    // A press on a column header sorts on its click; the focus stays on
    // the pane, where the arrow keys move through the rows.
    if (target.closest(".pane-head")) { e.preventDefault(); return; }
    if (e.button !== 0) return;
    // Don't start a marquee if the mousedown hit a row.
    if (target.closest("[data-orig]")) return;
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
      keepSelection();
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
      // Ctrl as the ghost last showed it. The handoff counts it: in WebKit
      // the event that crosses the window's edge comes from the pointer
      // leaving, and carries no keys.
      let copying = dragCopies(e);
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
        copying = dragCopies(ev);
        setGhost(g => g && { ...g, copy: copying });
        light(copying);
      };
      // Out of the window with the button still down: the OS takes the drag
      // from here, so it can be dropped into another app.
      const handOff = (ev: MouseEvent) => {
        stop();
        const dropped = sourcesNow();
        if (dropped.length > 0) latest.current.onDragOut?.(dropped, copying || dragCopies(ev));
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
        copying = dragCopies(ev);
        setGhost({
          x: ev.clientX,
          y: ev.clientY,
          count: sources.length,
          copy: copying,
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
        light(copying);
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
      role={card ? "listbox" : "grid"}
      aria-label={folder ? `Files in ${folder}` : "Files"}
      aria-multiselectable="true"
      aria-rowcount={card ? undefined : displayFiles.length + headRows}
      aria-activedescendant={activeId}
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
      <div className="pane-head" role="row" aria-rowindex={card ? undefined : 1}>
        <div className="col" role="columnheader" aria-label="kind"></div>
        <div className="col" {...headCol("name")} onClick={() => onSortChange("name")}>name <span className="sort" aria-hidden="true">{sortArrow("name")}</span></div>
        <div className="col c-tag" {...headCol("tag")} onClick={() => onSortChange("tag")}>tag <span className="sort" aria-hidden="true">{sortArrow("tag")}</span></div>
        <div className="col c-size" {...headCol("size")} style={{justifyContent:"flex-end"}} onClick={() => onSortChange("size")}>size <span className="sort" aria-hidden="true">{sortArrow("size")}</span></div>
        <div className="col c-date" {...headCol("modified")} onClick={() => onSortChange("modified")}>modified <span className="sort" aria-hidden="true">{sortArrow("modified")}</span></div>
        <div className="col c-git" {...headCol("git")} style={{justifyContent:"flex-end"}} onClick={() => onSortChange("git")}>git <span className="sort" aria-hidden="true">{sortArrow("git")}</span></div>
      </div>
      <div className="rows" ref={rowsRef} role={!card && displayFiles.length > 0 ? "rowgroup" : "presentation"} onScroll={onRowsScroll}>
        {win.start > 0 && <div className="rows-spacer" aria-hidden="true" style={{ height: win.start * view.rowH }} />}
        {displayFiles.slice(win.start, win.end).map(({ file: f, origIndex: i }, k) => {
          const fPath = rowPath(f);
          return (
            <PaneRow key={i}
                     f={f}
                     i={i}
                     idp={idp}
                     rowIndex={card ? undefined : win.start + k + 1 + headRows}
                     card={card}
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
          aria-hidden="true"
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
      <div className="palette" role="dialog" aria-modal="true" aria-label="Command palette" onClick={(e) => e.stopPropagation()} onKeyDown={onKey}>
        <div className="palette-head">
          <span className="prefix" aria-hidden="true">❯</span>
          <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder={PALETTE_PLACEHOLDER}
            role="combobox" aria-label="Command or path" aria-expanded="true" aria-autocomplete="list"
            aria-controls="palette-list" aria-activedescendant={rows[idx] ? `palette-opt-${idx}` : undefined} />
          <span className="hint"><span role="status">{rows.length} results</span> · <span className="kbd">↑↓</span> navigate</span>
        </div>
        <div className="palette-body" ref={bodyRef} id="palette-list" role="listbox" aria-label="Commands">
          {rows.map((r, i) => {
            // Under a group header, the menu's name would only repeat it.
            const where = browsing && r.where[0] === r.group ? r.where.slice(1) : r.where;
            return (
              <React.Fragment key={i}>
                {browsing && r.group !== rows[i - 1]?.group && <div className="pal-group" aria-hidden="true">{r.group}</div>}
                {/* Mouse move, not enter: rows scrolled under a still pointer
                    would otherwise take the highlight from the arrow keys. */}
                <div className={"pal-row" + (r.danger ? " danger" : "") + (i === idx ? " active" : "")}
                  id={`palette-opt-${i}`} role="option" aria-selected={i === idx}
                  onMouseMove={() => { if (i !== idx) setIdx(i); }} onClick={() => run(r.send)}>
                  <span className="ic" aria-hidden="true">{r.ic}</span>
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
// from Preferences… (dialogs/Preferences.tsx) and the View menu. The look
// (theme, fonts, chrome, file-list style) is look.ts's LookState.
export type TweakDensity = Density;

export interface TweakState extends LookState {
  hidden: boolean;
  showExtensions: boolean;
  showGitGutters: boolean;
  foldersFirst: boolean;
  /** The terminal types a `cd` when the active tab's folder changes. */
  termFollow: boolean;
  /** The window's zoom, as a factor (1 = 100%; see zoom.ts). */
  zoom: number;
  /** View → Sidebar, Inspector, Status Bar. */
  showSidebar: boolean;
  showInspector: boolean;
  showStatusBar: boolean;
  /** What the status bar shows (statusItems.ts). */
  statusItems: StatusItem[];
  /** The tags offered whether used or not (Sidebar.tsx). */
  tagSet: TagSet;
  /** Preferences → Updates: check once a day (updates.ts). Off unless the
   *  user turns it on. */
  autoUpdate: boolean;
}
