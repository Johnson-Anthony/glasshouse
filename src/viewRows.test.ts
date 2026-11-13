import { describe, expect, it } from "vitest";
import type { FileKind, FileRow } from "./data";
import { entryName, viewRows, type ViewOptions } from "./viewRows";

type Row = FileRow & { entry: { path: string; size: number; modified_ms: number } };

function row(name: string, ext: string, kind: FileKind = "text", size = 0, modified = 0): Row {
  return {
    name, ext, kind, size: "", date: "", tag: null, git: null, hidden: false, link: false,
    entry: { path: "/w/" + (ext ? `${name}.${ext}` : name), size, modified_ms: modified },
  };
}

const files: Row[] = [
  row("zeta", "ts", "code", 30, 1),
  row("src", "", "folder"),
  row("alpha", "md", "text", 10, 3),
  row("beta", "ts", "code", 20, 2),
];
const base: ViewOptions = { sortKey: "name", sortDir: "asc", foldersFirst: true };
const shown = (opts: Partial<ViewOptions>) =>
  viewRows(files, { ...base, ...opts }).map(r => files[r.origIndex].name);

describe("viewRows", () => {
  it("sorts folders first, then by name, keeping each row's origIndex", () => {
    const v = viewRows(files, base);
    expect(v.map(r => r.origIndex)).toEqual([1, 2, 3, 0]);
    expect(v.every(r => r.file === files[r.origIndex])).toBe(true);
  });

  it("follows the sort key and direction", () => {
    expect(shown({ sortKey: "size", foldersFirst: false })).toEqual(["src", "alpha", "beta", "zeta"]);
    expect(shown({ sortKey: "modified", sortDir: "desc" })).toEqual(["src", "alpha", "beta", "zeta"]);
    expect(shown({ sortKey: "type" })).toEqual(["src", "alpha", "beta", "zeta"]);
    expect(shown({ sortDir: "desc" })).toEqual(["src", "zeta", "beta", "alpha"]);
  });

  it("keeps only rows the search matches, extension included", () => {
    expect(shown({ searchQuery: ".ts" })).toEqual(["beta", "zeta"]);
    expect(shown({ searchQuery: "  " })).toEqual(["src", "alpha", "beta", "zeta"]);
    expect(shown({ searchQuery: "qqq" })).toEqual([]);
  });

  it("keeps only rows with the filter tag", () => {
    const tagStore = { "/w/beta.ts": ["work"], "/w/alpha.md": ["home", "work"], "/w/zeta.ts": ["home"] };
    expect(shown({ tagFilter: "work", tagStore })).toEqual(["alpha", "beta"]);
    expect(shown({ tagFilter: "work", tagStore, searchQuery: "be" })).toEqual(["beta"]);
  });
});

describe("viewRows keeps the old comparator's order", () => {
  // The comparator before sort keys were computed once, kept as the reference.
  function reference(rows: Row[], key: ViewOptions["sortKey"], sortDir: "asc" | "desc", tagStore: Record<string, string[]>): Row[] {
    const dir = sortDir === "asc" ? 1 : -1;
    const tagKey = (r: Row) => (tagStore[r.entry.path] ?? []).join(",");
    return [...rows].sort((a, b) => {
      const af = a.kind === "folder" ? 0 : 1, bf = b.kind === "folder" ? 0 : 1;
      if (af !== bf) return af - bf;
      if (key === "type") {
        const ae = a.ext.toLowerCase(), be = b.ext.toLowerCase();
        if (ae !== be) return ae < be ? -dir : dir;
        const an = a.name.toLowerCase(), bn = b.name.toLowerCase();
        return an < bn ? -dir : an > bn ? dir : 0;
      }
      if (key === "name") {
        const an = (a.name + (a.ext ? "." + a.ext : "")).toLowerCase();
        const bn = (b.name + (b.ext ? "." + b.ext : "")).toLowerCase();
        return an < bn ? -dir : an > bn ? dir : 0;
      }
      if (key === "size") return (a.entry.size - b.entry.size) * dir;
      if (key === "tag") {
        const at = tagKey(a), bt = tagKey(b);
        if (at === "" && bt !== "") return 1;
        if (bt === "" && at !== "") return -1;
        return at < bt ? -dir : at > bt ? dir : 0;
      }
      if (key === "git") {
        const ag = a.git ?? "~", bg = b.git ?? "~";
        return ag < bg ? -dir : ag > bg ? dir : 0;
      }
      return (a.entry.modified_ms - b.entry.modified_ms) * dir;
    });
  }

  // Few distinct values per field, so ties (where stability matters) are common.
  let seed = 7;
  const rand = (n: number) => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return seed % n; };
  const NAMES = ["a", "B", "b", "readme", "Readme", "z", "src", "lib"];
  const EXT = ["", "ts", "TS", "md", "rs"];
  const GIT = [null, "M", "A", "?"] as const;
  const rows: Row[] = Array.from({ length: 400 }, (_, i) => {
    const r = row(NAMES[rand(NAMES.length)], EXT[rand(EXT.length)], rand(5) === 0 ? "folder" : "text", rand(4), rand(4));
    return { ...r, git: GIT[rand(GIT.length)], entry: { ...r.entry, path: `${r.entry.path}#${i}` } };
  });
  const tagStore: Record<string, string[]> = {};
  rows.forEach((r, i) => { if (i % 3 === 0) tagStore[r.entry.path] = [["red", "blue", "green"][rand(3)]]; });

  for (const key of ["name", "type", "size", "modified", "tag", "git"] as const) {
    for (const dir of ["asc", "desc"] as const) {
      it(`${key} ${dir}`, () => {
        const got = viewRows(rows, { sortKey: key, sortDir: dir, foldersFirst: true, tagStore }).map(r => r.file);
        expect(got).toEqual(reference(rows, key, dir, tagStore));
      });
    }
  }
});

describe("entryName", () => {
  it("splits a file's extension off, case-insensitively", () => {
    expect(entryName({ name: "notes.txt", ext: "txt", kind: "text" })).toEqual({ name: "notes", ext: "txt" });
    expect(entryName({ name: "PHOTO.JPG", ext: "jpg", kind: "img" })).toEqual({ name: "PHOTO", ext: "jpg" });
    expect(entryName({ name: "Makefile", ext: "", kind: "text" })).toEqual({ name: "Makefile", ext: "" });
  });

  it("keeps a folder's name whole, dots and all", () => {
    expect(entryName({ name: "foo.d", ext: "d", kind: "folder" })).toEqual({ name: "foo.d", ext: "" });
  });
});
