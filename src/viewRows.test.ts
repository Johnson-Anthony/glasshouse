import { describe, expect, it } from "vitest";
import type { FileKind, FileRow } from "./data";
import { viewRows, type ViewOptions } from "./viewRows";

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
