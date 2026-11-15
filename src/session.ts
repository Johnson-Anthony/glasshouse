// The tabs a window reopens with: each tab's folder and sort, and which tab
// was shown. Saved in localStorage under a versioned key, and checked field
// by field on load: a tab that doesn't check out is dropped, and a record
// that doesn't is ignored, so a bad or old value never breaks startup.
//
// Only the glasshouse process that owns the session restores and saves it
// (`session_owner`, src-tauri/src/session.rs). File → New Window starts
// another process, which opens one tab at home and leaves the record alone.
// Private tabs aren't saved. See
// docs/decisions/2026-11-15-session-persistence-windows.md.

import { pathKind } from "./api";
import { parentPath } from "./paths";
import type { SortDir, SortKey } from "./state";

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
}

export interface Session {
  tabs: SavedTab[];
  /** Index into `tabs`. */
  active: number;
}

/** More than this is a broken record, not a session: each tab lists and
 *  watches its folder on start. */
const MAX_TABS = 100;

/** How long a saved tab's folder gets to answer before it opens as saved
 *  (an offline share can take far longer to fail). */
export const RESTORE_CHECK_MS = 1500;

function isAbsolute(p: string): boolean {
  return p.startsWith("/") || p.startsWith("\\\\") || /^[A-Za-z]:[\\/]/.test(p);
}

function parseSort(v: unknown): TabSort {
  if (!v || typeof v !== "object") return DEFAULT_SORT;
  const { key, dir } = v as { key?: unknown; dir?: unknown };
  return SORT_KEYS.includes(key as SortKey) && (dir === "asc" || dir === "desc")
    ? { key: key as SortKey, dir }
    : DEFAULT_SORT;
}

function parseTab(v: unknown): SavedTab | null {
  if (!v || typeof v !== "object") return null;
  const { path, sort } = v as { path?: unknown; sort?: unknown };
  if (typeof path !== "string" || !isAbsolute(path)) return null;
  return { path, sort: parseSort(sort) };
}

/** Keeps the items `keep` accepts, and says where the item at `active`
 *  ended up: if it was dropped, its left neighbour (the right one when
 *  nothing is left of it), as closing a tab does. */
function keepWithActive<T, U>(items: readonly T[], active: number, keep: (t: T) => U | null, max = Infinity): { kept: U[]; active: number } {
  const kept: U[] = [];
  let at = 0;
  for (let i = 0; i < items.length && kept.length < max; i++) {
    const k = keep(items[i]);
    if (k === null) continue;
    if (i <= active) at = kept.length;
    kept.push(k);
  }
  return { kept, active: at };
}

/** The record as saved, or null when there's nothing usable in it. */
export function parseSession(raw: string | null): Session | null {
  if (!raw) return null;
  let v: unknown;
  try { v = JSON.parse(raw); } catch { return null; }
  if (!v || typeof v !== "object") return null;
  const { tabs, active } = v as { tabs?: unknown; active?: unknown };
  if (!Array.isArray(tabs)) return null;
  const want = typeof active === "number" && Number.isInteger(active) ? active : 0;
  const r = keepWithActive(tabs, want, parseTab, MAX_TABS);
  return r.kept.length > 0 ? { tabs: r.kept, active: r.active } : null;
}

export interface LiveTab {
  path: string;
  sort: TabSort;
  private: boolean;
}

/** What to save for the window's tabs. With only private tabs open it has
 *  no tabs, and the next start opens home. */
export function sessionOf(tabs: readonly LiveTab[], active: number): Session {
  const r = keepWithActive(tabs, active, t => (t.private ? null : { path: t.path, sort: t.sort }));
  return { tabs: r.kept, active: r.active };
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
  const tabs = await Promise.all(s.tabs.map(async t => ({ path: await restorePath(t.path, home, kindOf, ms), sort: t.sort })));
  return { tabs, active: Math.min(Math.max(s.active, 0), tabs.length - 1) };
}
