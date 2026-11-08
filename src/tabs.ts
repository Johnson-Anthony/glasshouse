// The tab list as pure functions. Each tab has an id that is never reused, so
// App can key its headless <TabShell>s and their handles by id instead of by
// position: closing or moving a tab then moves its state along with it.
// `active` is still an index, because the titlebar and the next/previous-tab
// handlers work with positions.

import type { TabDef } from "./components";

export interface TabRecord extends TabDef {
  id: number;
  /** Where the tab's useTabState starts; it's only read on mount. */
  initialPath: string;
  private: boolean;
}

export interface TabList {
  tabs: TabRecord[];
  active: number;
}

let nextTabId = 1;

export function makeTab(path: string, opts: { private?: boolean; color?: string } = {}): TabRecord {
  const isPrivate = !!opts.private;
  return {
    id: nextTabId++,
    ic: "",
    color: opts.color ?? (isPrivate ? "var(--magenta, #bb9af7)" : "var(--cyan)"),
    label: isPrivate ? `(private) ${path}` : path,
    initialPath: path,
    private: isPrivate,
  };
}

/** Close the tab at `i`. The active tab stays active; if it's the one being
 *  closed, its left neighbour takes over (the right one for the first tab). */
export function closeTab({ tabs, active }: TabList, i: number): TabList {
  if (i < 0 || i >= tabs.length) return { tabs, active };
  const next = tabs.filter((_, k) => k !== i);
  const shifted = active > i || (active === i && active > 0) ? active - 1 : active;
  return { tabs: next, active: Math.min(shifted, Math.max(next.length - 1, 0)) };
}

export function closeOtherTabs({ tabs, active }: TabList, keep: number): TabList {
  if (keep < 0 || keep >= tabs.length) return { tabs, active };
  return { tabs: [tabs[keep]], active: 0 };
}

/** Move the tab at `from` to position `to`. The active tab stays active
 *  wherever it ends up. */
export function moveTab({ tabs, active }: TabList, from: number, to: number): TabList {
  if (from === to || from < 0 || from >= tabs.length || to < 0 || to >= tabs.length) {
    return { tabs, active };
  }
  const activeId = tabs[active]?.id;
  const next = [...tabs];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  const idx = next.findIndex(t => t.id === activeId);
  return { tabs: next, active: idx < 0 ? active : idx };
}
