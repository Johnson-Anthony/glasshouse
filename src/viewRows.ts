// The rows a file pane shows, in the order it shows them. FilePane renders
// this, and the selection commands use it (through App's ctx.visibleRows), so
// "visible" means the same thing to both.

import type { FileRow } from "./data";
import type { SortDir, SortKey } from "./state";
import { fuzzyFilter } from "./fuzzy";

export interface ViewOptions {
  searchQuery?: string;
  tagFilter?: string | null;
  tagStore?: Record<string, string[]>;
  sortKey: SortKey;
  sortDir: SortDir;
  foldersFirst?: boolean;
}

export interface ViewRow<T extends FileRow> {
  file: T;
  /** Index into the pane's `files`, which is what the selection holds. */
  origIndex: number;
}

/** A row's name with its extension put back, except on folders. */
export function fullName(row: Pick<FileRow, "name" | "ext" | "kind">): string {
  return row.ext && row.kind !== "folder" ? `${row.name}.${row.ext}` : row.name;
}

// FileRow is a display-only type without a filesystem path, but the host
// (App.tsx) always passes rows that carry their entry.
type WithEntry = { entry?: { path?: string; size?: number; modified_ms?: number } };
const entryOf = (f: FileRow) => (f as unknown as WithEntry).entry;

/** Filtered and sorted, keeping each row's `origIndex`. */
export function viewRows<T extends FileRow>(files: T[], opts: ViewOptions): ViewRow<T>[] {
  const { tagFilter, tagStore, sortKey, sortDir, foldersFirst = true } = opts;
  const indexed = files.map((f, i) => ({ file: f, origIndex: i }));
  const q = (opts.searchQuery || "").trim();
  const afterSearch = q
    ? fuzzyFilter(
        q,
        indexed,
        x => fullName(x.file),
      ).map(r => r.item)
    : indexed;

  // Tag filter — keep only rows whose path is tagged with tagFilter in the
  // shared tag store. Applied after search, before sort.
  const filtered = tagFilter
    ? afterSearch.filter(x => {
        const path = entryOf(x.file)?.path;
        if (!path) return false;
        const rowTags = tagStore?.[path];
        return !!rowTags && rowTags.includes(tagFilter);
      })
    : afterSearch;

  // Each row's sort key is computed once, not inside the comparator: at
  // 100k rows the comparator runs about 1.7M times, and lower-casing two
  // names per call was most of the sort's time.
  const primary = (f: T): string | number => {
    switch (sortKey) {
      case "type": return (f.ext ?? "").toLowerCase();
      case "name": return (f.name + (f.ext ? "." + f.ext : "")).toLowerCase();
      case "size": return entryOf(f)?.size ?? 0;
      case "tag": {
        const path = entryOf(f)?.path;
        return path ? (tagStore?.[path] ?? []).join(",") : "";
      }
      // Tilde sorts after letters in ASCII, so null/clean rows group at the
      // end in asc order — keeps the noisy stuff up top.
      case "git": return f.git ?? "~";
      case "modified": return entryOf(f)?.modified_ms ?? 0;
    }
  };
  const keyed = filtered.map(x => ({
    x,
    folder: foldersFirst && x.file.kind !== "folder" ? 1 : 0,
    key: primary(x.file),
    // Only "type" has a second key: the name, within one extension.
    name: sortKey === "type" ? x.file.name.toLowerCase() : "",
  }));
  const cmp = (a: string | number, b: string | number): number => (a < b ? -1 : a > b ? 1 : 0);

  const dir = sortDir === "asc" ? 1 : -1;
  keyed.sort((a, b) => {
    if (a.folder !== b.folder) return a.folder - b.folder;
    if (sortKey === "tag") {
      // Untagged rows ("") sort to the end, in either direction.
      if (a.key === "" && b.key !== "") return 1;
      if (b.key === "" && a.key !== "") return -1;
    }
    if (sortKey === "size" || sortKey === "modified") return ((a.key as number) - (b.key as number)) * dir;
    return (cmp(a.key, b.key) || cmp(a.name, b.name)) * dir;
  });
  return keyed.map(k => k.x);
}
