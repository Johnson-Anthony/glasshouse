// Undo entries for file operations. Each builder returns both directions:
// `inverse` reverses the operation and `redo` performs it again.
//
// The backend's rename and write replace an existing destination without
// asking, so every step that creates a path first checks that the path is
// still free. The steps that delete something they created first check that
// it hasn't been filled or edited since. Builders take the file system as a
// parameter so tests can run round trips against an in-memory one.

import { copyEntry, deleteEntry, makeDir, moveEntry, readDir, renameEntry, writeText, type FileEntry } from "./api";
import { basename, normalizePath, parentPath } from "./paths";
import type { UndoEntry } from "./state";

export interface UndoFs {
  rename(from: string, to: string): Promise<void>;
  move(from: string, to: string): Promise<void>;
  copy(from: string, to: string): Promise<void>;
  remove(path: string, recursive: boolean): Promise<void>;
  mkdir(path: string): Promise<void>;
  write(path: string, content: string): Promise<void>;
  /** Entries of `dir`, hidden ones included. Rejects if it can't be read. */
  list(dir: string): Promise<FileEntry[]>;
}

export const realFs: UndoFs = {
  rename: renameEntry,
  move: moveEntry,
  copy: copyEntry,
  remove: deleteEntry,
  mkdir: makeDir,
  write: writeText,
  list: dir => readDir(dir, true),
};

export interface PathPair {
  src: string;
  dst: string;
}

export type Created = { kind: "folder" } | { kind: "file"; content: string };

const samePath = (a: string, b: string) => normalizePath(a) === normalizePath(b);

async function findEntry(fs: UndoFs, path: string): Promise<FileEntry | null> {
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

/** Copy (paste, duplicate, drag-copy): undo deletes the copies, redo copies
 *  again. */
export function copyUndo(label: string, items: PathPair[], fs: UndoFs = realFs): UndoEntry {
  return {
    label,
    inverse: async () => {
      // recursive: copies can be non-empty folders
      for (const { dst } of [...items].reverse()) await fs.remove(dst, true);
    },
    redo: async () => {
      await ensureFree(fs, items);
      for (const { src, dst } of items) await fs.copy(src, dst);
    },
  };
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
