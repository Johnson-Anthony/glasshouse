// `pnpm vitest bench --run src/viewRows.bench.ts`: the pane's filter and sort
// over a 100k-entry folder, the size the survey measured.
import { bench, describe } from "vitest";
import type { FileKind, FileRow } from "./data";
import { viewRows, type ViewOptions } from "./viewRows";

const EXTS = ["txt", "ts", "md", "png", "rs", "json", ""];
const files = Array.from({ length: 100_000 }, (_, i): FileRow & { entry: { path: string; size: number; modified_ms: number } } => {
  const name = `${(Math.imul(i + 1, 2654435761) >>> 0).toString(36)}-${i}`;
  const ext = EXTS[i % EXTS.length];
  const kind: FileKind = ext ? "text" : "folder";
  return {
    name, ext, kind, size: "", date: "", tag: null, git: i % 9 === 0 ? "M" : null, hidden: false, link: false,
    entry: { path: `/big/${name}${ext ? "." + ext : ""}`, size: i * 37 % 100_003, modified_ms: i * 7919 % 1_000_003 },
  };
});

const run = (opts: Partial<ViewOptions>) => () => {
  viewRows(files, { sortKey: "name", sortDir: "asc", foldersFirst: true, ...opts });
};

const opts = { time: 2000 };

describe("viewRows, 100k rows", () => {
  bench("sort by name", run({}), opts);
  bench("sort by name, descending", run({ sortDir: "desc" }), opts);
  bench("sort by type", run({ sortKey: "type" }), opts);
  bench("sort by size", run({ sortKey: "size" }), opts);
  bench("sort by modified", run({ sortKey: "modified" }), opts);
  bench("filter \"a1\", then sort by name", run({ searchQuery: "a1" }), opts);
});
