// The tag map, `{ path: labels }`, as pure functions: following a rename or
// move, dropping what was deleted or trashed, putting it back, and finding
// what a folder listing says may be gone. Path rules follow the `windows`
// flag (the store passes IS_WINDOWS), so both flavors can be tested here.
// Policy: docs/decisions/2026-11-13-tags-follow-design.md
import { pathOps } from "./paths";

export type TagMap = Record<string, string[]>;

/** Tests keys against `path`: "self" for `path` itself, "below" for a key
 *  under it, null otherwise. Also gives the key's part after `path`. */
function matcher(path: string, windows: boolean) {
  const { normalizePath } = pathOps(windows);
  const base = normalizePath(path);
  const prefix = base + (windows ? "\\" : "/");
  return (key: string): { tail: string } | null => {
    const k = normalizePath(key);
    if (k === base) return { tail: "" };
    // At POSIX `/` the base is "" and the prefix "/", which every absolute
    // key starts with; nothing is ever moved from there anyway.
    if (!k.startsWith(prefix)) return null;
    // normalizePath keeps the length (it lowercases, folds `/` and trims
    // the end), so the tail can be cut from the key's own spelling.
    return { tail: key.slice(base.length, k.length) };
  };
}

/** The tags after `src` was renamed or moved to `dst`: `src`'s entry and
 *  every entry under it now sit under `dst`. Entries at or under `dst` are
 *  dropped first: the backend refuses a taken destination, so whatever they
 *  were for is gone. Returns `map` itself when nothing changes. */
export function moveTagKeys(map: TagMap, src: string, dst: string, windows: boolean): TagMap {
  const fromSrc = matcher(src, windows);
  const atDst = matcher(dst, windows);
  const { normalizePath } = pathOps(windows);
  const dstBase = dst.slice(0, normalizePath(dst).length);
  const moved: Array<[string, string[]]> = [];
  const next: TagMap = {};
  let changed = false;
  for (const [key, labels] of Object.entries(map)) {
    const m = fromSrc(key);
    if (m) {
      moved.push([dstBase + m.tail, labels]);
      changed = true;
    } else if (atDst(key)) {
      changed = true;
    } else {
      next[key] = labels;
    }
  }
  if (!changed) return map;
  for (const [key, labels] of moved) next[key] = labels;
  return next;
}

/** The tags without `paths` and everything under them, and what was taken. */
export function dropTagKeys(map: TagMap, paths: string[], windows: boolean): { map: TagMap; dropped: TagMap } {
  const tests = paths.map(p => matcher(p, windows));
  const kept: TagMap = {};
  const dropped: TagMap = {};
  for (const [key, labels] of Object.entries(map)) {
    if (tests.some(t => t(key))) dropped[key] = labels;
    else kept[key] = labels;
  }
  return Object.keys(dropped).length === 0 ? { map, dropped } : { map: kept, dropped };
}

/** The tags with `add` merged in, each key's labels joined without
 *  repeats. Returns `map` itself when nothing changes. */
export function putTagKeys(map: TagMap, add: TagMap): TagMap {
  let next: TagMap | null = null;
  for (const [key, labels] of Object.entries(add)) {
    const cur = (next ?? map)[key] ?? [];
    const extra = labels.filter(l => !cur.includes(l));
    if (extra.length === 0) continue;
    next ??= { ...map };
    next[key] = [...cur, ...extra];
  }
  return next ?? map;
}

/** The children of `dir` that some tag key is at or under but the folder's
 *  listing (`names`) doesn't have: each is either gone or left out of the
 *  listing (a hidden item), which one stat tells apart. */
export function goneCandidates(map: TagMap, dir: string, names: string[], windows: boolean): string[] {
  const { normalizePath, joinPath } = pathOps(windows);
  const sep = windows ? "\\" : "/";
  const prefix = normalizePath(dir) + sep;
  const listed = new Set(names.map(n => normalizePath(n)));
  const out = new Map<string, string>();
  for (const key of Object.keys(map)) {
    const k = normalizePath(key);
    if (!k.startsWith(prefix) || k.length === prefix.length) continue;
    const end = k.indexOf(sep, prefix.length);
    const child = k.slice(prefix.length, end < 0 ? undefined : end);
    if (listed.has(child) || out.has(child)) continue;
    out.set(child, joinPath(dir, key.slice(prefix.length, prefix.length + child.length)));
  }
  return [...out.values()];
}
