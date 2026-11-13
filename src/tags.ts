// The tag store: the one copy of the tag map, in a module so that code
// outside React (undo entries, transferDeps) can change it. App reads it with
// useTags(); every change goes through setTags, which writes the file.
//
// Tags are keyed by path, so the app's own renames, moves, deletes and trash
// go through the wrappers below, which move or drop the keys once the
// backend call succeeds. What changes outside the app is pruned when a
// folder is listed and when the sidebar's TAGS group is shown.
// Policy: docs/decisions/2026-11-13-tags-follow-design.md
import { useSyncExternalStore } from "react";
import {
  deleteEntry, moveEntry, moveToTrash, pathKind, readTags, renameEntry, trashRestore, writeTags,
  type Trashed, type TrashKey, type TrashResult,
} from "./api";
import { normalizePath, parentPath } from "./paths";
import { IS_WINDOWS } from "./platform";
import { dropTagKeys, goneCandidates, moveTagKeys, putTagKeys, type TagMap } from "./tagMap";

export type { TagMap } from "./tagMap";

type Update = TagMap | ((prev: TagMap) => TagMap);

let current: TagMap = {};
let loaded = false;
let loading: Promise<void> | null = null;
/** Changes made before the file was read, applied to what it held. */
let early: Update[] = [];
const listeners = new Set<() => void>();

const emit = () => { for (const fn of listeners) fn(); };
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
};

/** Reads the tags file, once. */
export function loadTags(): Promise<void> {
  loading ??= (async () => {
    const map = await readTags();
    current = map && typeof map === "object" ? map : {};
    loaded = true;
    const queued = early;
    early = [];
    emit();
    for (const u of queued) setTags(u);
  })();
  return loading;
}

/** The tags now. Replaced, never changed in place, on every change. */
export function getTags(): TagMap {
  return current;
}

/** Changes the tags and writes the file, as React's setState takes it. */
export function setTags(next: Update): void {
  if (!loaded) {
    early.push(next);
    return;
  }
  const value = typeof next === "function" ? next(current) : next;
  if (value === current) return;
  current = value;
  emit();
  persist();
}

export function useTags(): TagMap {
  return useSyncExternalStore(subscribe, getTags);
}

export function useTagsLoaded(): boolean {
  return useSyncExternalStore(subscribe, () => loaded);
}

// One write at a time, in order; changes made while one is in flight go
// out together in the next.
let writing = false;
let dirty = false;
function persist(): void {
  dirty = true;
  if (writing) return;
  writing = true;
  void (async () => {
    try {
      while (dirty) {
        dirty = false;
        await writeTags(current);
      }
    } finally {
      writing = false;
    }
  })();
}

/** Back to nothing loaded (null) or to `map` as if loaded, for tests. */
export function resetTagStoreForTests(map: TagMap | null): void {
  current = map ?? {};
  loaded = map !== null;
  loading = map === null ? null : Promise.resolve();
  early = [];
  trashed.length = 0;
  pruning = null;
  emit();
}

// ---------- following the app's own file operations ----------

/** Operations in flight, and a count of those finished: a prune that
 *  overlaps one throws its result away, since its stat may have seen an
 *  item gone before its tags moved. */
let inFlight = 0;
let finished = 0;

async function tracked<T>(work: () => Promise<T>): Promise<T> {
  inFlight++;
  try {
    return await work();
  } finally {
    inFlight--;
    finished++;
  }
}

/** Drops the tags of `paths` and everything under them; returns them. */
function dropTags(paths: string[]): TagMap {
  let dropped: TagMap = {};
  setTags(prev => {
    const r = dropTagKeys(prev, paths, IS_WINDOWS);
    dropped = r.dropped;
    return r.map;
  });
  return dropped;
}

type Move = (from: string, to: string) => Promise<void>;

/** `op`, a rename or move, with the tags following: once it succeeds, the
 *  tags of `from` and everything under it move to `to`. */
export function followingTags(op: Move): Move {
  return (from, to) => tracked(async () => {
    await op(from, to);
    setTags(prev => moveTagKeys(prev, from, to, IS_WINDOWS));
  });
}

/** `op`, a delete, then the tags of `path` and everything under it go. */
export function droppingTags<A extends unknown[]>(
  op: (path: string, ...rest: A) => Promise<void>,
): (path: string, ...rest: A) => Promise<void> {
  return (path, ...rest) => tracked(async () => {
    await op(path, ...rest);
    dropTags([path]);
  });
}

/** What Move to Trash took from the tags in this run, by trash record, so
 *  a restore (Undo or the Trash view) can put it back. Not saved: after a
 *  restart a restored item comes back untagged. */
const trashed: Array<{ item: Trashed; tags: TagMap }> = [];

/** The same trashed item: same original path, deletion times overlapping
 *  (the Trash view's key has the one time the trash recorded). */
const sameItem = (t: Trashed, k: TrashKey) =>
  normalizePath(t.original) === normalizePath(k.original) && t.from <= k.to && k.from <= t.to;

/** `op`, a move to the trash, then the item's tags go, kept for a restore. */
export function trashingTags(op: (path: string) => Promise<Trashed>): (path: string) => Promise<Trashed> {
  return path => tracked(async () => {
    const item = await op(path);
    const tags = dropTags([path]);
    if (Object.keys(tags).length > 0) trashed.push({ item, tags });
    return item;
  });
}

/** `op`, a restore from the trash, then the tags the items had when this
 *  run trashed them come back. */
export function restoringTags<A extends unknown[]>(
  op: (keys: TrashKey[], ...rest: A) => Promise<TrashResult>,
): (keys: TrashKey[], ...rest: A) => Promise<TrashResult> {
  return (keys, ...rest) => tracked(async () => {
    const res = await op(keys, ...rest);
    const done = new Set(res.done.map(p => normalizePath(p)));
    let back: TagMap = {};
    for (const k of keys) {
      if (!done.has(normalizePath(k.original))) continue;
      const i = trashed.findIndex(r => sameItem(r.item, k));
      if (i < 0) continue;
      back = putTagKeys(back, trashed[i].tags);
      trashed.splice(i, 1);
    }
    if (Object.keys(back).length > 0) setTags(prev => putTagKeys(prev, back));
    return res;
  });
}

export const renamePath = followingTags((from, to) => renameEntry(from, to));
export const movePath = followingTags((from, to) => moveEntry(from, to));
export const deletePath = droppingTags((path: string, recursive: boolean) => deleteEntry(path, recursive));
export const trashPath = trashingTags(path => moveToTrash(path));
export const restoreTrashed = restoringTags((keys: TrashKey[], allOrNothing: boolean) => trashRestore(keys, allOrNothing));

// ---------- pruning what's gone ----------

type Kind = Awaited<ReturnType<typeof pathKind>>;

/** One stat per path, a few at a time. Null means nothing is there; a stat
 *  that fails is "unknown", which never counts as gone. */
async function kinds(paths: string[]): Promise<Map<string, Kind>> {
  const out = new Map<string, Kind>();
  let next = 0;
  const worker = async () => {
    while (next < paths.length) {
      const p = paths[next++];
      let kind: Kind = "unknown";
      try {
        kind = await pathKind(p);
      } catch {
        // stays "unknown"
      }
      out.set(p, kind);
    }
  };
  await Promise.all(Array.from({ length: Math.min(8, paths.length) }, worker));
  return out;
}

/** Drops `gone`, unless one of the app's own operations ran meanwhile. */
function dropUnlessMoved(gone: string[], since: number): void {
  if (gone.length === 0 || inFlight > 0 || finished !== since) return;
  dropTags(gone);
}

/** After a listing of `dir`: the tagged items under it that the listing
 *  doesn't show are checked with one stat each, and dropped if nothing is
 *  there. A listing without hidden items leaves them out, which the stat
 *  tells apart; a listing missing nothing tagged costs nothing. */
export async function pruneListed(dir: string, names: string[]): Promise<void> {
  if (!loaded || inFlight > 0) return;
  const since = finished;
  const candidates = goneCandidates(current, dir, names, IS_WINDOWS);
  if (candidates.length === 0) return;
  const found = await kinds(candidates);
  dropUnlessMoved(candidates.filter(c => found.get(c) === null), since);
}

let pruning: Promise<void> | null = null;

/** When the sidebar's TAGS group is shown: every tagged path gets one stat.
 *  A missing one is dropped only if its folder is still there, so a drive
 *  that isn't plugged in, or a share that can't be reached, keeps its tags. */
export function pruneGoneTags(): Promise<void> {
  pruning ??= (async () => {
    try {
      await loadTags();
      if (inFlight > 0) return;
      const since = finished;
      const keys = Object.keys(current);
      const found = await kinds(keys);
      const missing = keys.filter(k => found.get(k) === null);
      if (missing.length === 0) return;
      const parents = [...new Set(missing.map(k => parentPath(k)))];
      const parentKinds = await kinds(parents);
      dropUnlessMoved(missing.filter(k => parentKinds.get(parentPath(k)) === "folder"), since);
    } finally {
      pruning = null;
    }
  })();
  return pruning;
}
