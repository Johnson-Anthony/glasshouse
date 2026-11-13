// The sidebar tree's cached listings (Sidebar.tsx). The tree keeps each
// listed folder's rows in `children` and its open folders in `expanded`,
// both keyed by path. When a folder is listed again, anything kept for a
// child folder that's no longer there (deleted, renamed, now a file) goes
// too, with everything under it, so a later folder of that name starts out
// closed and is listed afresh.
import type { FileEntry } from "./api";
import { pathOps, type PathOps } from "./paths";
import { IS_WINDOWS } from "./platform";

const APP_OPS = pathOps(IS_WINDOWS);

/** The name of the child of `dir` that `key` lies inside, as compared on
 *  this platform; null when `key` isn't inside `dir` (or is `dir`). */
function childOf(key: string, dir: string, ops: PathOps): string | null {
  const k = ops.pathSegments(ops.normalizePath(key));
  const d = ops.pathSegments(ops.normalizePath(dir));
  if (k.length <= d.length || d.some((seg, i) => k[i] !== seg)) return null;
  return k[d.length];
}

/** `rec` without the entries for folders inside `parent` that aren't among
 *  its fresh listing `kids` as folders. The same object when nothing goes. */
export function pruneUnder<T>(rec: Record<string, T>, parent: string, kids: FileEntry[], ops: PathOps = APP_OPS): Record<string, T> {
  const folders = new Set(kids.filter(k => k.kind === "folder").map(k => ops.basename(ops.normalizePath(k.path))));
  let out: Record<string, T> | null = null;
  for (const key of Object.keys(rec)) {
    const child = childOf(key, parent, ops);
    if (child === null || folders.has(child)) continue;
    out ??= { ...rec };
    delete out[key];
  }
  return out ?? rec;
}

/** `rec` without `gone` and everything inside it. The same object when
 *  nothing goes. */
export function dropTree<T>(rec: Record<string, T>, gone: string, ops: PathOps = APP_OPS): Record<string, T> {
  const g = ops.normalizePath(gone);
  let out: Record<string, T> | null = null;
  for (const key of Object.keys(rec)) {
    if (ops.normalizePath(key) !== g && childOf(key, gone, ops) === null) continue;
    out ??= { ...rec };
    delete out[key];
  }
  return out ?? rec;
}

