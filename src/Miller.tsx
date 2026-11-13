// Miller columns (ranger-style): parent | current | preview. The middle
// column is the file pane itself (App passes it as `children`, with
// `millerKeys`), so it has the pane's selection, menus, drag, sort and
// filter. Miller adds the outer columns: they list with the pane's sort and
// hidden-files setting, their rows navigate, and each column and folder row
// takes drops and has the per-path menu of the folder or file it shows.
// See docs/decisions/2026-11-13-miller-parity-design.md.
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { listen } from "@tauri-apps/api/event";
import { listDir, unwatchDir, watchDir, type FileEntry } from "./api";
import { normalizePath, parentPath } from "./paths";
import { RefreshGate } from "./refreshGate";
import { LinkMark } from "./components";
import { entryName, viewRows } from "./viewRows";
import type { FileKind, FileRow, GitStatus } from "./data";
import type { SortDir, SortKey } from "./state";

export interface MillerViewProps {
  cwd: string;
  /** The pane's focused entry, which the preview column shows. */
  focused: FileEntry | undefined;
  showHidden: boolean;
  sortKey: SortKey;
  sortDir: SortDir;
  foldersFirst: boolean;
  tagStore?: Record<string, string[]>;
  onNavigate: (path: string) => void;
  /** A right-click in an outer column: on a row, its path; elsewhere, the
   *  folder the column lists. */
  onPathContext?: (e: React.MouseEvent, path: string, isFolder: boolean) => void;
  /** The middle column: the file pane. */
  children: ReactNode;
}

/** A listing entry as `viewRows` sorts it. */
function sortRow(e: FileEntry): FileRow & { entry: FileEntry } {
  return {
    ...entryName(e), kind: e.kind as FileKind, size: "", date: "", tag: null,
    git: e.git as GitStatus | null, hidden: e.hidden, link: e.is_symlink, entry: e,
  };
}

/** An outer column's order: the pane's sort, without its filters, which are
 *  about the current folder. */
export function columnOrder(
  entries: FileEntry[],
  opts: { sortKey: SortKey; sortDir: SortDir; foldersFirst: boolean; tagStore?: Record<string, string[]> },
): FileEntry[] {
  return viewRows(entries.map(sortRow), opts).map(r => r.file.entry);
}

function rowIcon(e: FileEntry): string {
  return e.kind === "folder" ? "▸" : "·";
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} K`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} M`;
  return `${(n / 1024 / 1024 / 1024).toFixed(1)} G`;
}

/** A folder's entries, tagged with the folder, so a column never shows one
 *  folder's rows under another's path while the new listing is on its way. */
type Column = { path: string; entries: FileEntry[] };

/** `path`'s entries; null while they haven't arrived, or with no path. The
 *  folder is watched while it's shown, and re-listed when the watcher reports
 *  it (through a RefreshGate, as the tab and the sidebar tree do), so a drop
 *  into a column, or a rename from its menu, shows there. */
function useColumn(path: string | null, showHidden: boolean): FileEntry[] | null {
  const [col, setCol] = useState<Column | null>(null);
  useEffect(() => {
    if (path === null) return;
    let live = true;
    let unlisten: (() => void) | null = null;
    const gate = new RefreshGate<void>(async () => {
      const entries = await listDir(path, showHidden);
      if (live) setCol({ path, entries });
    });
    gate.start();
    void watchDir(path);
    const target = normalizePath(path);
    void listen<string>("fs-changed", evt => {
      if (normalizePath(typeof evt.payload === "string" ? evt.payload : "") === target) gate.refresh();
    }).then(fn => {
      if (live) unlisten = fn;
      else fn();
    }).catch(() => { /* no Tauri: nothing reports */ });
    return () => {
      live = false;
      gate.cancel();
      unlisten?.();
      void unwatchDir(path);
    };
  }, [path, showHidden]);
  return path !== null && col?.path === path ? col.entries : null;
}

export function MillerView({
  cwd,
  focused,
  showHidden,
  sortKey,
  sortDir,
  foldersFirst,
  tagStore,
  onNavigate,
  onPathContext,
  children,
}: MillerViewProps) {
  const parent = parentPath(cwd);
  const atRoot = normalizePath(parent) === normalizePath(cwd);
  const folder = focused?.kind === "folder" ? focused : undefined;

  const parentEntries = useColumn(atRoot ? null : parent, showHidden);
  const childEntries = useColumn(folder?.path ?? null, showHidden);

  const parentView = useMemo(
    () => (parentEntries ? columnOrder(parentEntries, { sortKey, sortDir, foldersFirst, tagStore }) : []),
    [parentEntries, sortKey, sortDir, foldersFirst, tagStore],
  );
  const childView = useMemo(
    () => (childEntries ? columnOrder(childEntries, { sortKey, sortDir, foldersFirst, tagStore }) : null),
    [childEntries, sortKey, sortDir, foldersFirst, tagStore],
  );

  const menu = (e: React.MouseEvent, path: string, isFolder: boolean) => {
    e.preventDefault();
    e.stopPropagation();
    onPathContext?.(e, path, isFolder);
  };

  const cwdNorm = normalizePath(cwd);
  const row = (e: FileEntry, onClick: () => void, extra = "") => (
    <div key={e.path}
         className={"mrow" + extra + (e.hidden ? " dim" : "")}
         data-drop-path={e.kind === "folder" ? e.path : undefined}
         onClick={onClick}
         onContextMenu={ev => menu(ev, e.path, e.kind === "folder")}>
      <span className="mic">{rowIcon(e)}</span>
      <span className="mname">{e.name}</span>
      {e.is_symlink && <LinkMark />}
    </div>
  );

  return (
    <section className="miller">
      <div className="mcol"
           data-drop-path={atRoot ? undefined : parent}
           onContextMenu={e => { if (!atRoot) menu(e, parent, true); }}>
        {atRoot
          ? <div className="mrow dim">{cwd}</div>
          : parentView.map(e => row(
              e,
              () => { if (e.kind === "folder") onNavigate(e.path); },
              normalizePath(e.path) === cwdNorm ? " hilite" : "",
            ))}
      </div>
      {children}
      <div className="mcol"
           data-drop-path={folder?.path}
           onContextMenu={e => { if (folder) menu(e, folder.path, true); }}>
        {folder && childView && (
          childView.length > 0
            ? childView.map(e => row(e, () => onNavigate(folder.path)))
            : <div className="mrow dim">empty</div>
        )}
        {focused && focused.kind !== "folder" && (
          <div className="mpreview">
            <div className="mp-name">{focused.name}</div>
            <div className="mp-line">kind <span>{focused.kind}</span></div>
            <div className="mp-line">size <span>{fmtBytes(focused.size)}</span></div>
            <div className="mp-line">modified <span>{new Date(focused.modified_ms).toLocaleString()}</span></div>
            {focused.git && <div className="mp-line">git <span>{focused.git}</span></div>}
          </div>
        )}
      </div>
    </section>
  );
}
