// The tabs a window reopens with: each tab's folder and sort, and which tab
// was shown. Checked field by field on load: a tab that doesn't check out
// is dropped, and a record that doesn't is ignored, so a bad or old value
// never breaks startup.
//
// Every window reports its record to the backend (`session_report`), which
// keeps each window's and writes them all to `session.json`; a plain start
// reopens every window in it (src-tauri/src/session.rs, app_windows.rs).
// The focused window of the process that owns the session also writes its
// record to localStorage under the v1 key, which 0.2 and the builds before
// one process read, and which the first window reads when there's no
// session file yet. Private tabs aren't saved. A split (tabLayout.ts) is
// saved in the same record, readable by builds without split view: `tabs`
// is every tab, the first pane's then the second's, and those builds open
// them all unsplit. See docs/decisions/2026-11-21-split-and-tear-off-session.md.

import { pathKind } from "./api";
import { parentPath, plainPath } from "./paths";
import type { SortDir, SortKey } from "./state";
import { clampRatio, type SplitDir } from "./tabLayout";

export const SESSION_KEY = "glasshouse.session.v1";

/** Any version of the record. Settings export and import leave it out: a
 *  `.glasshouserc` is meant to be shared, and shouldn't carry open folders. */
export function isSessionKey(key: string): boolean {
  return key.startsWith("glasshouse.session.");
}

export interface TabSort {
  key: SortKey;
  dir: SortDir;
}

export const DEFAULT_SORT: TabSort = { key: "name", dir: "asc" };

const SORT_KEYS: readonly SortKey[] = ["name", "size", "modified", "tag", "git", "type"];

export interface SavedTab {
  path: string;
  sort: TabSort;
  /** 1 for a tab in a split's second pane; unset in the first. */
  pane?: 1;
}

export interface SessionSplit {
  /** Index into `tabs`: the tab shown in the pane without the focus. */
  other: number;
  dir: SplitDir;
  /** The first pane's share. */
  ratio: number;
}

export interface Session {
  tabs: SavedTab[];
  /** Index into `tabs`: the tab shown in the pane with the focus (the only
   *  one when unsplit). */
  active: number;
  /** Set when the window is split, and both panes have a saved tab. */
  split?: SessionSplit;
}

/** More than this is a broken record, not a session: each tab lists and
 *  watches its folder on start. */
const MAX_TABS = 100;

/** How long a saved tab's folder gets to answer before it opens as saved
 *  (an offline share can take far longer to fail). */
export const RESTORE_CHECK_MS = 1500;

export function isAbsolute(p: string): boolean {
  return p.startsWith("/") || p.startsWith("\\\\") || /^[A-Za-z]:[\\/]/.test(p);
}

export function parseSort(v: unknown): TabSort {
  if (!v || typeof v !== "object") return DEFAULT_SORT;
  const { key, dir } = v as { key?: unknown; dir?: unknown };
  return SORT_KEYS.includes(key as SortKey) && (dir === "asc" || dir === "desc")
    ? { key: key as SortKey, dir }
    : DEFAULT_SORT;
}

function parseTab(v: unknown): SavedTab | null {
  if (!v || typeof v !== "object") return null;
  const { path, sort, pane } = v as { path?: unknown; sort?: unknown; pane?: unknown };
  if (typeof path !== "string" || !isAbsolute(path)) return null;
  // A tab saved at a Windows verbatim path (older builds listed canonical
  // paths) reopens at the plain one.
  const at = plainPath(path);
  return pane === 1 ? { path: at, sort: parseSort(sort), pane: 1 } : { path: at, sort: parseSort(sort) };
}

function index(v: unknown): number {
  return typeof v === "number" && Number.isInteger(v) ? v : 0;
}

/** Keeps the items `keep` accepts, and says where each item in `wanted`
 *  ended up: if it was dropped, its left neighbour (the right one when
 *  nothing is left of it), as closing a tab does. */
function keepWith<T, U>(items: readonly T[], wanted: readonly number[], keep: (t: T) => U | null, max = Infinity): { kept: U[]; at: number[] } {
  const kept: U[] = [];
  const at = wanted.map(() => 0);
  for (let i = 0; i < items.length && kept.length < max; i++) {
    const k = keep(items[i]);
    if (k === null) continue;
    wanted.forEach((w, j) => { if (i <= w) at[j] = kept.length; });
    kept.push(k);
  }
  return { kept, at };
}

/** `tabs` in pane order (the first pane's, then the second's), with the
 *  split kept only when both panes have a tab and `active` and `other` are
 *  in different panes. Without a split, no tab is marked as the second
 *  pane's. */
function ordered(tabs: SavedTab[], active: number, other: number, split: Omit<SessionSplit, "other"> | null): Session {
  const second = (t: SavedTab) => t.pane === 1;
  const flat = (): Session => ({ tabs: tabs.map(t => ({ path: t.path, sort: t.sort })), active });
  if (!split || tabs.every(second) || !tabs.some(second)) return flat();
  const byPane = [...tabs.map((t, i) => ({ t, i })).filter(x => !second(x.t)), ...tabs.map((t, i) => ({ t, i })).filter(x => second(x.t))];
  const where = (i: number) => byPane.findIndex(x => x.i === i);
  const a = where(active);
  let o = where(other);
  // The other pane's tab has to be in the other pane: else its first tab.
  if (second(tabs[active]) === second(tabs[other])) o = byPane.findIndex(x => second(x.t) !== second(tabs[active]));
  return { tabs: byPane.map(x => x.t), active: a, split: { other: o, ...split } };
}

/** The record as saved, or null when there's nothing usable in it. */
export function parseSession(raw: string | null): Session | null {
  if (!raw) return null;
  let v: unknown;
  try { v = JSON.parse(raw); } catch { return null; }
  return sessionFrom(v);
}

/** A record the backend handed back (`window_start`), checked the same way. */
export function sessionFrom(v: unknown): Session | null {
  if (!v || typeof v !== "object") return null;
  const { tabs, active, split } = v as { tabs?: unknown; active?: unknown; split?: unknown };
  if (!Array.isArray(tabs)) return null;
  const s = split && typeof split === "object" ? split as { other?: unknown; dir?: unknown; ratio?: unknown } : null;
  const r = keepWith(tabs, [index(active), index(s?.other)], parseTab, MAX_TABS);
  if (r.kept.length === 0) return null;
  const dir = s && (s.dir === "row" || s.dir === "column") ? s.dir : null;
  return ordered(r.kept, r.at[0], r.at[1], s && dir ? { dir, ratio: clampRatio(s.ratio) } : null);
}

export interface LiveTab {
  path: string;
  sort: TabSort;
  private: boolean;
}

export interface LivePane {
  tabs: readonly LiveTab[];
  active: number;
}

/** What to save for the window's tabs: one pane, or a split's two in the
 *  order they're shown; `focus` is the pane with the focus. With only
 *  private tabs open it has no tabs, and the next start opens home. A pane
 *  with only private tabs saves as no split. */
export function sessionOf(panes: readonly LivePane[], focus = 0, dir: SplitDir = "row", ratio = 0.5): Session {
  const flat = panes.flatMap((p, pane) => p.tabs.map(t => ({ ...t, pane })));
  const start = (pane: number) => panes.slice(0, pane).reduce((n, p) => n + p.tabs.length, 0);
  const shown = panes.map((p, pane) => start(pane) + p.active);
  const f = Math.min(Math.max(focus, 0), panes.length - 1);
  const other = panes.length > 1 ? shown[1 - f] : shown[f];
  const r = keepWith(flat, [shown[f], other], t => (t.private ? null : (t.pane === 1 ? { path: t.path, sort: t.sort, pane: 1 as const } : { path: t.path, sort: t.sort })));
  if (r.kept.length === 0) return { tabs: [], active: 0 };
  return ordered(r.kept, r.at[0], r.at[1], panes.length > 1 ? { dir, ratio: clampRatio(ratio) } : null);
}

export function loadSession(): Session | null {
  try {
    return parseSession(localStorage.getItem(SESSION_KEY));
  } catch {
    return null;
  }
}

/** Writes the record, unless it's `last` (what the previous call wrote).
 *  Returns what's saved now. */
export function saveSession(s: Session, last: string | null): string | null {
  const json = JSON.stringify(s);
  if (json === last) return last;
  try {
    localStorage.setItem(SESSION_KEY, json);
    return json;
  } catch {
    return last; // quota, or storage turned off
  }
}

type KindOf = (path: string) => Promise<"folder" | "file" | "unknown" | null>;

/** Where a saved tab opens: its folder, or the nearest parent that's still
 *  a folder, or `home` when none is. A folder that can't be checked (no
 *  backend, or no answer within `ms`) opens as saved, and its listing says
 *  what's wrong. */
export async function restorePath(path: string, home: string, kindOf: KindOf = pathKind, ms = RESTORE_CHECK_MS): Promise<string> {
  const walk = async (): Promise<string> => {
    let p = path;
    for (;;) {
      const kind = await kindOf(p);
      if (kind === "folder") return p;
      if (kind === "unknown") return path;
      const up = parentPath(p);
      if (!up || up === p) return home;
      p = up;
    }
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<string>(resolve => { timer = setTimeout(() => resolve(path), ms); });
  try {
    return await Promise.race([walk().catch(() => path), late]);
  } finally {
    clearTimeout(timer);
  }
}

/** The saved tabs with each folder checked (all at once). */
export async function restoreSession(s: Session, home: string, kindOf: KindOf = pathKind, ms = RESTORE_CHECK_MS): Promise<Session> {
  const tabs = await Promise.all(s.tabs.map(async t => ({ ...t, path: await restorePath(t.path, home, kindOf, ms) })));
  const clamp = (i: number) => Math.min(Math.max(i, 0), tabs.length - 1);
  return s.split
    ? { tabs, active: clamp(s.active), split: { ...s.split, other: clamp(s.split.other) } }
    : { tabs, active: clamp(s.active) };
}
