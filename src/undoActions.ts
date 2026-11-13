// Undo entries for file operations. Each builder returns both directions:
// `inverse` reverses the operation and `redo` performs it again.
//
// The backend's rename, mkdir and write refuse an existing destination, and
// every step that creates a path also checks first that the path is still
// free, so a multi-item step is refused before any of it runs. The steps that delete something they created first check that
// it hasn't been filled or edited since (by fingerprint, see madeUndo). Builders take the file system as a
// parameter so tests can run round trips against an in-memory one.
//
// An action with no entry here calls markIrreversible (state.ts) instead.
// What each action does: docs/decisions/2026-11-12-undo-coverage-policy.md

import {
  copyEntry, createTextFile, fileStatExtended, makeDir, readDir, readText,
  rewriteText, setPermissions, writeText, type FileEntry, type Trashed, type TrashKey, type TrashResult,
} from "./api";
import { renameFailure, renameStepsProblem, reverseRenameSteps, runRenameSteps, type RenameStep } from "./names";
import { basename, normalizePath, parentPath } from "./paths";
import { IS_WINDOWS } from "./platform";
import type { UndoEntry } from "./state";
import { errText } from "./errors";
import { deletePath, movePath, renamePath, restoreTrashed, trashPath } from "./tags";

export interface UndoFs {
  rename(from: string, to: string): Promise<void>;
  move(from: string, to: string): Promise<void>;
  copy(from: string, to: string): Promise<void>;
  remove(path: string, recursive: boolean): Promise<void>;
  mkdir(path: string): Promise<void>;
  write(path: string, content: string): Promise<void>;
  /** Entries of `dir`, hidden ones included. Rejects if it can't be read. */
  list(dir: string): Promise<FileEntry[]>;
  /** A text file's content, up to CONTENT_LIMIT bytes. */
  read(path: string): Promise<string>;
  /** Replace an existing file's content (`write` refuses an existing path). */
  overwrite(path: string, content: string): Promise<void>;
}

/** contentUndo reads at most this much: a file grown past it no longer
 *  matches what was written, so its undo refuses. */
const CONTENT_LIMIT = 16 * 1024 * 1024;

// Renames, moves and deletes carry the tags along (tags.ts), so undo and
// redo move them back and forth too.
const realFs: UndoFs = {
  rename: renamePath,
  move: movePath,
  copy: copyEntry,
  remove: deletePath,
  mkdir: makeDir,
  write: createTextFile,
  list: dir => readDir(dir, true),
  read: path => readText(path, CONTENT_LIMIT),
  overwrite: writeText,
};

export interface PathPair {
  src: string;
  dst: string;
}

export type Created = { kind: "folder" } | { kind: "file"; content: string };

const samePath = (a: string, b: string) => normalizePath(a) === normalizePath(b);

async function findEntry(fs: Pick<UndoFs, "list">, path: string): Promise<FileEntry | null> {
  const name = normalizePath(basename(path));
  const entries = await fs.list(parentPath(path));
  return entries.find(e => normalizePath(e.name) === name) ?? null;
}

/** Throws if any of `pairs`' destinations exists. A destination that is its
 *  own source (a case-only rename on Windows) doesn't count. Each parent
 *  folder is listed once. If a parent can't be listed, the operation itself
 *  will fail, so that isn't treated as taken. */
async function ensureFree(fs: UndoFs, pairs: Array<{ src?: string; dst: string }>): Promise<void> {
  const byParent = new Map<string, Array<{ src?: string; dst: string }>>();
  for (const pair of pairs) {
    const parent = parentPath(pair.dst);
    byParent.set(parent, [...(byParent.get(parent) ?? []), pair]);
  }
  for (const [parent, group] of byParent) {
    let names: Set<string>;
    try {
      names = new Set((await fs.list(parent)).map(e => normalizePath(e.name)));
    } catch {
      continue;
    }
    for (const { src, dst } of group) {
      if (src !== undefined && samePath(src, dst)) continue;
      if (names.has(normalizePath(basename(dst)))) {
        throw new Error(`"${basename(dst)}" already exists in ${parent}`);
      }
    }
  }
}

/** Rename or move: undo moves each item back (in reverse order), redo moves
 *  it again. `via` picks the backend command the operation used. */
export function moveUndo(label: string, items: PathPair[], via: "rename" | "move", fs: UndoFs = realFs): UndoEntry {
  const run = async (pairs: PathPair[]) => {
    await ensureFree(fs, pairs);
    for (const { src, dst } of pairs) {
      await (via === "rename" ? fs.rename(src, dst) : fs.move(src, dst));
    }
  };
  const back = items.map(({ src, dst }) => ({ src: dst, dst: src })).reverse();
  return { label, inverse: () => run(back), redo: () => run(items) };
}

/** Bulk rename: undo renames each step back, last first; redo runs the steps
 *  again. Steps may chain or swap through temporary names, which ensureFree
 *  can't judge, so each direction first lists the folders and walks the
 *  steps over the listings (renameStepsProblem); a name taken since refuses
 *  the whole step. A rename that fails anyway puts back the ones before it. */
export function renameStepsUndo(
  label: string,
  steps: RenameStep[],
  fs: Pick<UndoFs, "rename" | "list"> = realFs,
  windows: boolean = IS_WINDOWS,
): UndoEntry {
  const run = async (seq: RenameStep[]) => {
    const listings = new Map<string, string[]>();
    for (const dir of new Set(seq.map(s => s.dir))) {
      listings.set(dir, (await fs.list(dir)).map(e => e.name));
    }
    const problem = renameStepsProblem(seq, listings, windows);
    if (problem) throw new Error(problem);
    const res = await runRenameSteps(seq, (from, to) => fs.rename(from, to));
    if (!res.ok) throw new Error(renameFailure(res));
  };
  return { label, inverse: () => run(reverseRenameSteps(steps)), redo: () => run(steps) };
}

/** Up to five problems as a bulleted list, for a refusal. */
function bullets(problems: string[]): string {
  const shown = problems.slice(0, 5).map(p => `• ${p}`);
  if (problems.length > 5) shown.push(`• …and ${problems.length - 5} more`);
  return shown.join("\n");
}

/** Trees with more entries than this aren't fingerprinted, and their undo
 *  refuses: walking them means one synchronous list_dir per folder. */
const FINGERPRINT_LIMIT = 20_000;

/** An entry's contents by path relative to it ("" is the entry itself), each as
 *  kind + size + mtime. Folders are just "dir": their listing already shows
 *  adds and removes, and their mtime moves on editor swap files. A string
 *  instead says why it can't be compared. */
type Fingerprint = Map<string, string> | string;

const signature = (e: FileEntry) =>
  e.kind === "folder" && !e.is_symlink ? "dir" : `${e.is_symlink ? "link" : "file"}:${e.size}:${e.modified_ms}`;

async function fingerprint(fs: UndoFs, path: string, limit: number): Promise<Fingerprint> {
  try {
    const self = await findEntry(fs, path);
    if (!self) return "is no longer there";
    const print = new Map([["", signature(self)]]);
    if (self.kind !== "folder" || self.is_symlink) return print;
    const pending: Array<[rel: string, abs: string]> = [["", path]];
    while (pending.length > 0) {
      const [rel, abs] = pending.pop()!;
      for (const e of await fs.list(abs)) {
        const childRel = rel ? `${rel}/${e.name}` : e.name;
        print.set(childRel, signature(e));
        if (print.size > limit) return `is too large to check (over ${limit} entries)`;
        if (e.kind === "folder" && !e.is_symlink) pending.push([childRel, e.path]);
      }
    }
    return print;
  } catch (err) {
    return `couldn't be read (${errText(err)})`;
  }
}

function samePrint(a: Map<string, string>, b: Map<string, string>): boolean {
  if (a.size !== b.size) return false;
  for (const [k, v] of a) if (b.get(k) !== v) return false;
  return true;
}

export interface MadeOptions {
  /** For the refusal: "has changed since it was <verb>". */
  verb?: string;
  /** Paths that must still be there for undo to delete anything, such as a
   *  hard link's original: without it, the link may be the only name left. */
  needs?: string[];
  fs?: UndoFs;
  limit?: number;
}

/** Things an action made where nothing was before (copies, links, archives,
 *  extracted entries): undo deletes them, redo checks the paths are free and
 *  calls `remake`. Each is fingerprinted (size and mtime of everything in
 *  it) right after it's made, and undo deletes nothing unless every one
 *  still matches, so edits made since are never thrown away. */
export function madeUndo(label: string, paths: string[], remake: () => Promise<void>, opts: MadeOptions = {}): UndoEntry {
  const { verb = "made", needs = [], fs = realFs, limit = FINGERPRINT_LIMIT } = opts;
  const takePrints = () => Promise.all(paths.map(p => fingerprint(fs, p, limit)));
  // Started now, awaited by undo, so pushUndo stays synchronous and a Ctrl+Z
  // straight after the action still finds this entry.
  let prints = takePrints();
  return {
    label,
    inverse: async () => {
      const [before, now] = await Promise.all([prints, takePrints()]);
      const problems: string[] = [];
      paths.forEach((p, i) => {
        const b = before[i];
        const n = now[i];
        const name = basename(p);
        if (typeof n === "string") problems.push(`${name} ${n}`);
        else if (typeof b === "string") problems.push(`${name} ${b}`);
        else if (!samePrint(b, n)) problems.push(`${name} has changed since it was ${verb}`);
      });
      for (const n of needs) {
        const there = await findEntry(fs, n).catch(() => null);
        if (!there) problems.push(`${basename(n)} is no longer there, so the link may be all that's left of it`);
      }
      if (problems.length > 0) throw new Error(`Nothing was deleted:\n${bullets(problems)}`);
      // recursive: what was made can be a non-empty folder. A link is
      // removed itself, never what it points to (delete_entry uses lstat).
      for (const p of [...paths].reverse()) await fs.remove(p, true);
    },
    redo: async () => {
      await ensureFree(fs, paths.map(dst => ({ dst })));
      await remake();
      prints = takePrints();
    },
  };
}

/** Copy (paste, duplicate, drag-copy): undo deletes the copies, redo copies
 *  again, with madeUndo's fingerprint check. */
export function copyUndo(label: string, items: PathPair[], fs: UndoFs = realFs, limit = FINGERPRINT_LIMIT): UndoEntry {
  const copyAll = async () => {
    for (const { src, dst } of items) await fs.copy(src, dst);
  };
  return madeUndo(label, items.map(({ dst }) => dst), copyAll, { verb: "copied", fs, limit });
}

/** A new folder or file: undo deletes it, redo creates it again. Undo
 *  refuses once the folder has something in it or the file has changed size,
 *  so it never takes work done since with it. */
export function createUndo(label: string, path: string, what: Created, fs: UndoFs = realFs): UndoEntry {
  const byteLength = (s: string) => new TextEncoder().encode(s).length;
  return {
    label,
    inverse: async () => {
      if (what.kind === "folder") {
        // Non-recursive: the backend refuses to remove a non-empty folder.
        await fs.remove(path, false);
        return;
      }
      const entry = await findEntry(fs, path);
      if (entry && entry.size !== byteLength(what.content)) {
        throw new Error(`"${basename(path)}" has changed since it was created; not deleting it`);
      }
      await fs.remove(path, false);
    },
    redo: async () => {
      await ensureFree(fs, [{ dst: path }]);
      if (what.kind === "folder") await fs.mkdir(path);
      else await fs.write(path, what.content);
    },
  };
}

/** A folder made to put things in (Screenshot Auto-sort's month folders),
 *  as part of a groupUndo: undo removes it if it's empty and leaves it
 *  otherwise, redo makes it if it's missing. */
export function emptyFolderUndo(label: string, path: string, fs: UndoFs = realFs): UndoEntry {
  return {
    label,
    inverse: async () => {
      let inside: FileEntry[];
      try {
        inside = await fs.list(path);
      } catch {
        return; // already gone
      }
      if (inside.length === 0) await fs.remove(path, false);
    },
    redo: async () => {
      const there = await findEntry(fs, path);
      if (!there) await fs.mkdir(path);
      else if (there.kind !== "folder" || there.is_symlink) {
        throw new Error(`"${basename(path)}" already exists in ${parentPath(path)}`);
      }
    },
  };
}

/** A text file whose content went from `before` to `after` (Export Layout
 *  over an old one): undo writes `before` back and redo writes `after`, each
 *  only while the file still holds what the other left, so an edit made
 *  since is never overwritten. It restores exactly the strings it's given,
 *  so `before` must be the whole file, read as text. */
export function contentUndo(label: string, path: string, before: string, after: string, fs: UndoFs = realFs): UndoEntry {
  const swap = async (expect: string, next: string) => {
    const problem = await contentProblem(fs, path, expect);
    if (problem) throw new Error(`${problem}; not overwriting it`);
    await fs.overwrite(path, next);
  };
  return { label, inverse: () => swap(after, before), redo: () => swap(before, after) };
}

/** Why `path` doesn't hold `expect`, or null if it does. */
async function contentProblem(fs: UndoFs, path: string, expect: string): Promise<string | null> {
  let now: string;
  try {
    now = await fs.read(path);
  } catch (err) {
    return `"${basename(path)}" couldn't be read (${errText(err)})`;
  }
  return now === expect ? null : `"${basename(path)}" has changed since`;
}

/** One file's text before and after, for contentsUndo. */
export interface ContentChange {
  path: string;
  before: string;
  after: string;
}

/** Writes through rewrite_text, as Find & Replace's own: a temp file and a
 *  rename, permissions kept, links and read-only files refused. */
const rewriteFs: UndoFs = { ...realFs, overwrite: rewriteText };

/** Several files' text replaced at once (Find & Replace in Files): undo
 *  writes each `before` back and redo each `after`, but nothing at all
 *  unless every file still holds what the other direction left, so the
 *  step is never half done because one file was edited since. If a write
 *  fails part way, the files already written are put back. */
export function contentsUndo(label: string, changes: ContentChange[], fs: UndoFs = rewriteFs): UndoEntry {
  const swap = async (expect: "before" | "after", next: "before" | "after") => {
    const problems: string[] = [];
    for (const c of changes) {
      const problem = await contentProblem(fs, c.path, c[expect]);
      if (problem) problems.push(problem);
    }
    if (problems.length > 0) throw new Error(`Nothing was changed:\n${bullets(problems)}`);
    const done: ContentChange[] = [];
    for (const c of changes) {
      try {
        await fs.overwrite(c.path, c[next]);
      } catch (err) {
        const stuck: string[] = [];
        for (const d of done.reverse()) {
          await fs.overwrite(d.path, d[expect]).catch(() => stuck.push(`"${basename(d.path)}"`));
        }
        const after = stuck.length > 0 ? `, and ${stuck.join(", ")} couldn't be put back` : "; nothing was changed";
        throw new Error(`"${basename(c.path)}" couldn't be written (${errText(err)})${after}`);
      }
      done.push(c);
    }
  };
  return { label, inverse: () => swap("after", "before"), redo: () => swap("before", "after") };
}

/** Several entries as one step: undo runs their inverses last first, redo
 *  runs them in order. A part that fails stops the step there, with the
 *  parts before it done, so each part checks before it changes anything. */
export function groupUndo(label: string, parts: UndoEntry[]): UndoEntry {
  return {
    label,
    inverse: async () => {
      for (const p of [...parts].reverse()) await p.inverse();
    },
    redo: async () => {
      for (const p of parts) await p.redo();
    },
  };
}

/** A permission change, in set_permissions' terms: the mode bits on unix;
 *  on Windows only the owner-write bit counts (clear = read-only). */
export interface PermChange {
  path: string;
  before: number;
  after: number;
}

export interface PermFs {
  /** The path's permissions in the same terms, or null if they can't be read. */
  get(path: string): Promise<number | null>;
  set(path: string, value: number): Promise<void>;
}

/** The permissions of `path` as a PermChange's `before`, or null where they
 *  can't be read (a dangling link). */
export async function currentPermissions(path: string): Promise<number | null> {
  const st = await fileStatExtended(path);
  if (!st) return null;
  return IS_WINDOWS ? (st.readonly ? 0 : 0o200) : st.mode;
}

const realPerms: PermFs = { get: currentPermissions, set: setPermissions };

/** chmod (Batch Permissions, the Inspector): undo sets the old permissions
 *  back and redo the new ones, each only while every path still has what
 *  the other direction left, so a change made since is never overwritten. */
export function permissionsUndo(label: string, changes: PermChange[], perms: PermFs = realPerms, windows: boolean = IS_WINDOWS): UndoEntry {
  const key = (v: number) => (windows ? v & 0o200 : v);
  const swap = async (expect: "before" | "after", next: "before" | "after") => {
    const problems: string[] = [];
    for (const c of changes) {
      const now = await perms.get(c.path).catch(() => null);
      if (now === null) problems.push(`${basename(c.path)}'s permissions couldn't be read`);
      else if (key(now) !== key(c[expect])) problems.push(`${basename(c.path)}'s permissions have changed since`);
    }
    if (problems.length > 0) throw new Error(`Nothing was changed:\n${bullets(problems)}`);
    for (const c of changes) await perms.set(c.path, c[next]);
  };
  return { label, inverse: () => swap("after", "before"), redo: () => swap("before", "after") };
}

/** The trash as trashUndo and restoreUndo use it. `restore` is all or
 *  nothing: any refusal restores none of the keys. */
export interface TrashFs {
  trash(path: string): Promise<Trashed>;
  restore(keys: TrashKey[]): Promise<TrashResult>;
  list: UndoFs["list"];
}

// Trashing drops the items' tags and a restore puts them back (tags.ts).
const realTrash: TrashFs = {
  trash: trashPath,
  restore: keys => restoreTrashed(keys, true),
  list: realFs.list,
};

/** Both directions between `paths` being in place and being in the trash.
 *  `inTrash` is how they were trashed, or null while they're in place. Each
 *  trashing replaces it, so a restore after a redo finds the new items, not
 *  the ones an earlier restore already took out. */
function trashSwitch(paths: string[], inTrash: Trashed[] | null, fs: TrashFs) {
  let records = inTrash;
  const restore = async () => {
    if (!records) throw new Error("Nothing was restored: the items aren't recorded as trashed");
    const res = await fs.restore(records.map(({ original, from, to }) => ({ original, from, to })));
    if (res.problems.length > 0) {
      throw new Error(`Nothing was restored:\n${bullets(res.problems.map(p => `${basename(p.path)}: ${p.reason}`))}`);
    }
    records = null;
  };
  const trash = async () => {
    const missing: string[] = [];
    for (const p of paths) {
      const there = await findEntry(fs, p).catch(() => null);
      if (!there) missing.push(`${basename(p)} isn't in ${parentPath(p)} any more`);
    }
    if (missing.length > 0) throw new Error(`Nothing was moved to the trash:\n${bullets(missing)}`);
    const done: Trashed[] = [];
    for (const p of paths) {
      try {
        done.push(await fs.trash(p));
      } catch (e) {
        const moved = done.length > 0 ? ` (${done.length} of ${paths.length} were moved before it)` : "";
        throw new Error(`${basename(p)} couldn't be moved to the trash${moved}: ${errText(e)}`);
      }
    }
    records = done;
  };
  return { restore, trash };
}

/** Move to Trash: undo restores exactly the items it trashed (by original
 *  path and deletion time), refusing if any is gone from the trash or its
 *  name is taken again; redo trashes them again. With the real trash, the
 *  items' tags go and come back with them (tags.ts). */
export function trashUndo(label: string, trashed: Trashed[], fs: TrashFs = realTrash): UndoEntry {
  const s = trashSwitch(trashed.map(t => t.original), trashed, fs);
  return { label, inverse: s.restore, redo: s.trash };
}

/** A restore from the Trash view: undo trashes the restored paths again,
 *  redo restores those same items. */
export function restoreUndo(label: string, restored: string[], fs: TrashFs = realTrash): UndoEntry {
  const s = trashSwitch(restored, null, fs);
  return { label, inverse: s.trash, redo: s.restore };
}
