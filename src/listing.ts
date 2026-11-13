// A tab's listing: the folder's entries plus the selection, focus and anchor,
// which are indexes into those entries. They live in one value so they always
// change together: a render never pairs new entries with old indexes.
//
// Indexes only mean something against the entries they were taken from. When
// the folder is re-listed (watcher, poll, refresh), `relist` moves them to the
// same files, by path, in the new entries. The `with*` setters do the same for
// an update whose indexes came from an older listing than the current one.
// See docs/decisions/2026-11-11-selection-integrity-listing.md.

import type { FileEntry, GitInfo } from "./api";
import { normalizePath } from "./paths";

export interface Listing {
  entries: FileEntry[];
  selected: number[];
  focusIndex: number;
  anchorIndex: number;
}

export const EMPTY_LISTING: Listing = { entries: [], selected: [], focusIndex: 0, anchorIndex: 0 };

type PathOf<T> = (item: T) => string | undefined;
const entryPath: PathOf<FileEntry> = e => e.path;

/** Maps an index into `from` to the index of the same file in `to`. */
function indexMapper<T>(from: T[], to: T[], pathOf: PathOf<T>): (i: number) => number | undefined {
  if (from === to) return i => (i >= 0 && i < to.length ? i : undefined);
  const byPath = new Map<string, number>();
  to.forEach((item, i) => {
    const p = pathOf(item);
    if (p !== undefined) byPath.set(normalizePath(p), i);
  });
  return i => {
    const item = from[i];
    const p = item === undefined ? undefined : pathOf(item);
    return p === undefined ? undefined : byPath.get(normalizePath(p));
  };
}

function mapAll(map: (i: number) => number | undefined, idx: number[]): number[] {
  const out: number[] = [];
  for (const i of idx) {
    const j = map(i);
    if (j !== undefined) out.push(j);
  }
  return out;
}

/** Indexes into `from` as the indexes of the same files in `to`, matched by
 *  `pathOf`; files that are gone drop out. */
export function remapIndexes<T>(from: T[], to: T[], idx: number[], pathOf: PathOf<T>): number[] {
  return mapAll(indexMapper(from, to, pathOf), idx);
}

function sameEntry(a: FileEntry, b: FileEntry): boolean {
  return a.path === b.path && a.name === b.name && a.kind === b.kind && a.size === b.size
    && a.modified_ms === b.modified_ms && a.hidden === b.hidden && a.ext === b.ext
    && a.is_symlink === b.is_symlink && a.lossy === b.lossy && a.git === b.git;
}

/** Two listings with the same entries, field for field, in the same order. */
export function sameEntries(a: FileEntry[], b: FileEntry[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (!sameEntry(a[i], b[i])) return false;
  return true;
}

/** The listing after the folder is re-read. Selected files that are gone drop
 *  out. A focused file that's gone leaves focus at the same position, clamped,
 *  which is the next row after a delete; a lost anchor follows the focus.
 *  A re-read that changed nothing returns `prev` itself, so the poll and the
 *  watcher don't re-render the pane. */
export function relist(prev: Listing, entries: FileEntry[]): Listing {
  if (sameEntries(prev.entries, entries)) return prev;
  const map = indexMapper(prev.entries, entries, entryPath);
  const selected = mapAll(map, prev.selected);
  const focusIndex = map(prev.focusIndex) ?? Math.max(0, Math.min(prev.focusIndex, entries.length - 1));
  const anchorIndex = map(prev.anchorIndex) ?? focusIndex;
  return { entries, selected, focusIndex, anchorIndex };
}

/** Sets the selection to `sel`, indexes into `basis`. */
export function withSelected(l: Listing, basis: FileEntry[], sel: number[]): Listing {
  if (basis === l.entries) return sel === l.selected ? l : { ...l, selected: sel };
  return { ...l, selected: remapIndexes(basis, l.entries, sel, entryPath) };
}

/** Sets the focus to `i`, an index into `basis`; a file that's gone since
 *  leaves the focus where it is. */
export function withFocus(l: Listing, basis: FileEntry[], i: number): Listing {
  const j = basis === l.entries ? i : indexMapper(basis, l.entries, entryPath)(i);
  return j === undefined || j === l.focusIndex ? l : { ...l, focusIndex: j };
}

/** Sets the anchor to `i`, an index into `basis`, as `withFocus` does. */
export function withAnchor(l: Listing, basis: FileEntry[], i: number): Listing {
  const j = basis === l.entries ? i : indexMapper(basis, l.entries, entryPath)(i);
  return j === undefined || j === l.anchorIndex ? l : { ...l, anchorIndex: j };
}

/** `next`, or `prev` itself when the repo's status hasn't changed, so a
 *  re-read doesn't re-render the toolbar and status bar for nothing. */
export function keepGitInfo(prev: GitInfo | null, next: GitInfo | null): GitInfo | null {
  if (!prev || !next) return next;
  if (prev.repo_root !== next.repo_root || prev.branch !== next.branch || prev.ahead !== next.ahead
    || prev.behind !== next.behind || prev.dirty !== next.dirty) return next;
  return prev;
}
