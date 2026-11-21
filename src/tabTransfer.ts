// What a tab carries when it's made again somewhere else: its folder, sort,
// Back and Forward history, filter text, tag filter and private flag.
// Duplicate Tab uses it, and so does a tab moved to another window or a new
// one (tabMoves.ts, src-tauri/src/tab_drag.rs). Every window is in one
// process, so the record goes through the backend's memory, never a file or
// a command line. The window that takes it checks it field by field
// (parseTransfer), as a saved session is checked.

import { DEFAULT_SORT, isAbsolute, parseSort, type TabSort } from "./session";
import type { TabSeed, TabState } from "./state";
import { makeTab, type TabRecord } from "./tabs";

export interface TabTransfer extends TabSeed {
  path: string;
  sort: TabSort;
  /** Stays private where it lands: not saved, not in Recent. */
  private: boolean;
}

type Carried = "path" | "sortKey" | "sortDir" | "historyBack" | "historyForward" | "searchQuery" | "tagFilter" | "private";

export function transferOf(state: Pick<TabState, Carried>): TabTransfer {
  return {
    path: state.path,
    sort: { key: state.sortKey, dir: state.sortDir },
    back: [...state.historyBack],
    forward: [...state.historyForward],
    search: state.searchQuery,
    tagFilter: state.tagFilter,
    private: state.private,
  };
}

/** The record of a tab with no live state yet: what it opened with. */
export function transferOfRecord(r: TabRecord): TabTransfer {
  return {
    path: r.initialPath,
    sort: r.initialSort ?? DEFAULT_SORT,
    back: [...(r.seed?.back ?? [])],
    forward: [...(r.seed?.forward ?? [])],
    search: r.seed?.search ?? "",
    tagFilter: r.seed?.tagFilter ?? null,
    private: r.private,
  };
}

/** A new tab record that mounts as `t`. */
export function recordFromTransfer(t: TabTransfer): TabRecord {
  return makeTab(t.path, {
    private: t.private,
    sort: t.sort,
    seed: { back: t.back, forward: t.forward, search: t.search, tagFilter: t.tagFilter },
  });
}

/** More history than this is a broken record; the nearest is kept. */
const MAX_HISTORY = 500;
const MAX_TEXT = 4096;

function text(v: unknown): string | null {
  return typeof v === "string" && v.length <= MAX_TEXT ? v : null;
}

/** A history list's folders, the MAX_HISTORY nearest the tab (Back's
 *  last ones, Forward's first). */
function history(v: unknown, nearest: "end" | "start"): string[] {
  if (!Array.isArray(v)) return [];
  const paths = v.filter((p): p is string => text(p) !== null && isAbsolute(p as string));
  return nearest === "end" ? paths.slice(-MAX_HISTORY) : paths.slice(0, MAX_HISTORY);
}

/** A record another window handed over, or null when it isn't one. One
 *  without the private flag counts as private, so nothing is saved or put
 *  in Recent by mistake. */
export function parseTransfer(v: unknown): TabTransfer | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const r = v as Record<string, unknown>;
  const path = text(r.path);
  if (!path || !isAbsolute(path)) return null;
  return {
    path,
    sort: parseSort(r.sort),
    back: history(r.back, "end"),
    forward: history(r.forward, "start"),
    search: text(r.search) ?? "",
    tagFilter: text(r.tagFilter),
    private: r.private !== false,
  };
}
