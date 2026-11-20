// What a tab carries when it's made again somewhere else: its folder, sort,
// Back and Forward history, filter text, tag filter and private flag.
// Duplicate Tab uses it. Moving a tab to another window of the same process
// (task 50's tear-off) will hand it over in memory: nothing is serialized.

import type { TabSort } from "./session";
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

/** A new tab record that mounts as `t`. */
export function recordFromTransfer(t: TabTransfer): TabRecord {
  return makeTab(t.path, {
    private: t.private,
    sort: t.sort,
    seed: { back: t.back, forward: t.forward, search: t.search, tagFilter: t.tagFilter },
  });
}
