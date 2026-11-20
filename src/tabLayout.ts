// The window's tabs as one or two panes (split view), as pure functions.
// Each pane is a TabList (tabs.ts) with its own shown tab; `focus` is the
// pane the menus, keys, toolbar, status bar, Inspector and terminal follow.
// A tab keeps its id when it moves between panes, so App's keyed TabShell
// (and the tab's folder, history and selection) moves with it. A pane left
// with no tabs goes, and the window is unsplit again.

import { closeOtherTabs, closeTab, moveTab, type TabList, type TabRecord } from "./tabs";

/** Side by side ("row") or one above the other ("column"). */
export type SplitDir = "row" | "column";

export interface Layout {
  /** One pane, or two when split. Never empty, and no pane is empty. */
  panes: TabList[];
  /** Index into `panes`. */
  focus: number;
  dir: SplitDir;
  /** The first pane's share of the space. */
  ratio: number;
}

/** A tab by place. */
export interface TabAt {
  pane: number;
  index: number;
}

/** Where a split's new pane goes. */
export type Side = "left" | "right" | "top" | "bottom";

export const DEFAULT_RATIO = 0.5;
const MIN_RATIO = 0.15;

export function clampRatio(r: unknown): number {
  return typeof r === "number" && Number.isFinite(r) ? Math.min(1 - MIN_RATIO, Math.max(MIN_RATIO, r)) : DEFAULT_RATIO;
}

export function single(tabs: TabRecord[], active = 0, dir: SplitDir = "row"): Layout {
  return { panes: [{ tabs, active }], focus: 0, dir, ratio: DEFAULT_RATIO };
}

export const EMPTY_LAYOUT: Layout = single([]);

export function isSplit(l: Layout): boolean {
  return l.panes.length > 1;
}

export function focusedPane(l: Layout): TabList {
  return l.panes[l.focus] ?? l.panes[0];
}

/** The tab shown in each pane, by pane. */
export function shownIds(l: Layout): number[] {
  return l.panes.map(p => p.tabs[p.active]?.id).filter((id): id is number => id !== undefined);
}

export function allTabs(l: Layout): TabRecord[] {
  return l.panes.flatMap(p => p.tabs);
}

export function tabCount(l: Layout): number {
  return l.panes.reduce((n, p) => n + p.tabs.length, 0);
}

export function findTab(l: Layout, id: number): TabAt | null {
  for (let pane = 0; pane < l.panes.length; pane++) {
    const index = l.panes[pane].tabs.findIndex(t => t.id === id);
    if (index >= 0) return { pane, index };
  }
  return null;
}

function validPane(l: Layout, pane: number): boolean {
  return Number.isInteger(pane) && pane >= 0 && pane < l.panes.length;
}

/** `l` with pane `pane` replaced; panes left empty go. */
function withPane(l: Layout, pane: number, next: TabList): Layout {
  const panes = l.panes.map((p, i) => (i === pane ? next : p));
  return pruned({ ...l, panes });
}

/** Drops empty panes. The focus stays on its pane, or moves to the one left. */
function pruned(l: Layout): Layout {
  if (l.panes.every(p => p.tabs.length > 0)) return l;
  const keep = l.panes.map((p, i) => ({ p, i })).filter(x => x.p.tabs.length > 0);
  if (keep.length === 0) return { ...l, panes: [{ tabs: [], active: 0 }], focus: 0 };
  const focus = Math.max(0, keep.findIndex(x => x.i === l.focus));
  return { ...l, panes: keep.map(x => x.p), focus };
}

export function setFocus(l: Layout, pane: number): Layout {
  return validPane(l, pane) && pane !== l.focus ? { ...l, focus: pane } : l;
}

/** Shows tab `index` of `pane` and gives that pane the focus. */
export function setActive(l: Layout, pane: number, index: number): Layout {
  if (!validPane(l, pane)) return l;
  const p = l.panes[pane];
  if (index < 0 || index >= p.tabs.length) return setFocus(l, pane);
  if (p.active === index && l.focus === pane) return l;
  return { ...withPane(l, pane, { ...p, active: index }), focus: pane };
}

/** Adds `tab` to `pane` at `at` (the end when unset), shown and focused
 *  unless `show` is false. */
export function addTab(l: Layout, pane: number, tab: TabRecord, at?: number, show = true): Layout {
  if (!validPane(l, pane)) pane = l.focus;
  const p = l.panes[pane];
  const i = at === undefined ? p.tabs.length : Math.max(0, Math.min(at, p.tabs.length));
  const tabs = [...p.tabs.slice(0, i), tab, ...p.tabs.slice(i)];
  const active = show ? i : p.active >= i && p.tabs.length > 0 ? p.active + 1 : p.active;
  return { ...withPane(l, pane, { tabs, active }), focus: show ? pane : l.focus };
}

/** Closes a tab. In a split, a pane whose last tab closes goes; unsplit,
 *  the last tab is replaced with one at `fallbackPath` (tabs.ts). */
export function closeTabIn(l: Layout, pane: number, i: number, fallbackPath: string): Layout {
  if (!validPane(l, pane)) return l;
  const p = l.panes[pane];
  if (i < 0 || i >= p.tabs.length) return l;
  if (isSplit(l) && p.tabs.length === 1) return withPane(l, pane, { tabs: [], active: 0 });
  return withPane(l, pane, closeTab(p, i, fallbackPath));
}

export function closeOthersIn(l: Layout, pane: number, keep: number): Layout {
  if (!validPane(l, pane)) return l;
  return withPane(l, pane, closeOtherTabs(l.panes[pane], keep));
}

/** Takes a tab out of the window (it moved to another one). Null when it's
 *  the window's only tab, which can't leave. */
export function removeTab(l: Layout, id: number): Layout | null {
  const at = findTab(l, id);
  if (!at || tabCount(l) <= 1) return null;
  const p = l.panes[at.pane];
  if (p.tabs.length === 1) return withPane(l, at.pane, { tabs: [], active: 0 });
  return withPane(l, at.pane, closeTab(p, at.index, "/"));
}

/** Moves the tab at `from` to gap `gap` of pane `to` (0 is before the first
 *  tab; the tab count is after the last), as it's shown before the move. The
 *  moved tab is shown, and its pane focused. */
export function moveTabTo(l: Layout, from: TabAt, to: { pane: number; gap?: number }): Layout {
  if (!validPane(l, from.pane) || !validPane(l, to.pane)) return l;
  const src = l.panes[from.pane];
  const tab = src.tabs[from.index];
  if (!tab) return l;
  const dst = l.panes[to.pane];
  const gap = to.gap === undefined ? dst.tabs.length : Math.max(0, Math.min(to.gap, dst.tabs.length));
  if (from.pane === to.pane) {
    const target = gap > from.index ? gap - 1 : gap;
    const moved = moveTab(src, from.index, target);
    return setActive(withPane(l, from.pane, moved), from.pane, target);
  }
  const left = closeTab(src, from.index, "/");
  const out = src.tabs.length === 1 ? { tabs: [], active: 0 } : left;
  const into: TabList = { tabs: [...dst.tabs.slice(0, gap), tab, ...dst.tabs.slice(gap)], active: gap };
  const panes = l.panes.map((p, i) => (i === from.pane ? out : i === to.pane ? into : p));
  return pruned({ ...l, panes, focus: to.pane });
}

/** Splits with `tab` (a new tab, or one moved out of the pane) in a new pane
 *  on `side`, which gets the focus. A split window splits no further. */
function splitInto(l: Layout, rest: TabList, tab: TabRecord, side: Side): Layout {
  const pane: TabList = { tabs: [tab], active: 0 };
  const first = side === "left" || side === "top";
  const dir: SplitDir = side === "left" || side === "right" ? "row" : "column";
  return { panes: first ? [pane, rest] : [rest, pane], focus: first ? 0 : 1, dir, ratio: DEFAULT_RATIO };
}

/** View → Split: a second pane with `tab` (a copy of the shown one). */
export function splitWithNew(l: Layout, tab: TabRecord, dir: SplitDir): Layout {
  if (isSplit(l) || l.panes[0].tabs.length === 0) return l;
  return splitInto(l, l.panes[0], tab, dir === "row" ? "right" : "bottom");
}

/** A tab dragged to the edge of the file area, or Move to Other Pane: it
 *  moves into a new pane on `side`. Not for the pane's only tab, which would
 *  leave nothing behind. */
export function splitWithTab(l: Layout, from: TabAt, side: Side): Layout {
  if (isSplit(l) || from.pane !== 0) return l;
  const p = l.panes[0];
  const tab = p.tabs[from.index];
  if (!tab || p.tabs.length < 2) return l;
  return splitInto(l, closeTab(p, from.index, "/"), tab, side);
}

/** Close Split: the second pane's tabs go after the first's, and the
 *  focused pane's shown tab stays shown. */
export function closeSplit(l: Layout): Layout {
  if (!isSplit(l)) return l;
  const [a, b] = l.panes;
  const active = l.focus === 0 ? a.active : a.tabs.length + b.active;
  return { ...l, panes: [{ tabs: [...a.tabs, ...b.tabs], active }], focus: 0 };
}

export function swapPanes(l: Layout): Layout {
  if (!isSplit(l)) return l;
  return { ...l, panes: [l.panes[1], l.panes[0]], focus: 1 - l.focus, ratio: 1 - l.ratio };
}

export function setDir(l: Layout, dir: SplitDir): Layout {
  return l.dir === dir ? l : { ...l, dir };
}

export function setRatio(l: Layout, ratio: number): Layout {
  const r = clampRatio(ratio);
  return r === l.ratio ? l : { ...l, ratio: r };
}

/** Sets tab `id`'s label, or returns `l` when it already has it. */
export function relabel(l: Layout, id: number, label: string): Layout {
  const at = findTab(l, id);
  if (!at) return l;
  const p = l.panes[at.pane];
  if (p.tabs[at.index].label === label) return l;
  const tabs = p.tabs.map((t, i) => (i === at.index ? { ...t, label } : t));
  return { ...l, panes: l.panes.map((x, i) => (i === at.pane ? { ...x, tabs } : x)) };
}

/** The layout a saved session (session.ts) opens as; `make` makes each
 *  saved tab's record, in `tabs` order. */
export function layoutFromSession<T extends { pane?: 1 }>(s: { tabs: readonly T[]; active: number; split?: { other: number; dir: SplitDir; ratio: number } }, make: (t: T, i: number) => TabRecord): Layout {
  const records = s.tabs.map(make);
  if (!s.split) return single(records, Math.min(Math.max(s.active, 0), Math.max(records.length - 1, 0)));
  const inSecond = s.tabs.map(t => t.pane === 1);
  const panes = [0, 1].map(pane => records.filter((_, i) => inSecond[i] === (pane === 1)));
  const within = (i: number) => inSecond.slice(0, i).filter(b => b === inSecond[i]).length;
  const focus = inSecond[s.active] ? 1 : 0;
  const other = s.split.other;
  const shown = [0, 1].map(pane => (pane === focus ? within(s.active) : inSecond[other] === (pane === 1) ? within(other) : 0));
  return { panes: panes.map((tabs, pane) => ({ tabs, active: shown[pane] })), focus, dir: s.split.dir, ratio: clampRatio(s.split.ratio) };
}
