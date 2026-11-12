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

  const tagKey = (x: { file: FileRow }): string => {
    const path = entryOf(x.file)?.path;
    if (!path) return "";
    return (tagStore?.[path] ?? []).join(",");
  };

  const dir = sortDir === "asc" ? 1 : -1;
  return [...filtered].sort((a, b) => {
    if (foldersFirst) {
      const af = a.file.kind === "folder" ? 0 : 1;
      const bf = b.file.kind === "folder" ? 0 : 1;
      if (af !== bf) return af - bf;
    }
    if (sortKey === "type") {
      const ae = (a.file.ext ?? "").toLowerCase();
      const be = (b.file.ext ?? "").toLowerCase();
      if (ae !== be) return ae < be ? -1 * dir : 1 * dir;
      const an = a.file.name.toLowerCase();
      const bn = b.file.name.toLowerCase();
      return an < bn ? -1 * dir : an > bn ? 1 * dir : 0;
    }
    if (sortKey === "name") {
      const an = (a.file.name + (a.file.ext ? "." + a.file.ext : "")).toLowerCase();
      const bn = (b.file.name + (b.file.ext ? "." + b.file.ext : "")).toLowerCase();
      return an < bn ? -1 * dir : an > bn ? 1 * dir : 0;
    }
    if (sortKey === "size") {
      const as = entryOf(a.file)?.size ?? 0;
      const bs = entryOf(b.file)?.size ?? 0;
      return (as - bs) * dir;
    }
    if (sortKey === "tag") {
      const at = tagKey(a);
      const bt = tagKey(b);
      // Untagged rows ("") sort to the end on asc, start on desc — matches
      // convention for "group the boring stuff last".
      if (at === "" && bt !== "") return 1;
      if (bt === "" && at !== "") return -1;
      return at < bt ? -1 * dir : at > bt ? 1 * dir : 0;
    }
    if (sortKey === "git") {
      // Tilde sorts after letters in ASCII, so null/clean rows group at the
      // end in asc order — keeps the noisy stuff up top.
      const ag = a.file.git ?? "~";
      const bg = b.file.git ?? "~";
      return ag < bg ? -1 * dir : ag > bg ? 1 * dir : 0;
    }
    // modified
    const am = entryOf(a.file)?.modified_ms ?? 0;
    const bm = entryOf(b.file)?.modified_ms ?? 0;
    return (am - bm) * dir;
  });
}
