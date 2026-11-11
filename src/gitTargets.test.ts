import { describe, expect, it } from "vitest";
import type { FileEntry } from "./api";
import type { GitStatus } from "./data";
import { discardReport, gitTargets } from "./gitTargets";

function entry(name: string, git: GitStatus | null, kind = "text"): FileEntry {
  return { name, path: `/r/${name}`, kind, git } as FileEntry;
}

const entries = [
  entry("modified.ts", "M"),
  entry("clean.ts", null),
  entry("new.ts", "?"),
  entry("added.ts", "A"),
  entry("src", null, "folder"),
  entry("untracked-dir", "?", "folder"),
];
const all = entries.map(e => e.path);

describe("gitTargets", () => {
  it("stages and discards everything with a label, and every folder", () => {
    const want = ["/r/modified.ts", "/r/new.ts", "/r/added.ts", "/r/src", "/r/untracked-dir"];
    expect(gitTargets("stage", all, entries)).toEqual(want);
    expect(gitTargets("discard", all, entries)).toEqual(want);
  });

  it("unstages nothing untracked", () => {
    expect(gitTargets("unstage", all, entries)).toEqual(["/r/modified.ts", "/r/added.ts", "/r/src"]);
  });

  it("keeps the selection's order and drops paths it can't see", () => {
    expect(gitTargets("stage", ["/r/src", "/r/gone.ts", "/r/modified.ts"], entries))
      .toEqual(["/r/src", "/r/modified.ts"]);
  });
});

describe("discardReport", () => {
  it("is a toast when nothing was left alone", () => {
    expect(discardReport({ restored: 2, trashed: 1, skipped: [] })).toEqual({
      message: "restored 2 file(s) from the last commit, moved 1 untracked item(s) to the trash",
      leftAlone: false,
    });
  });

  it("lists what was left alone, and how many more past five", () => {
    const skipped = Array.from({ length: 7 }, (_, i) => ({ path: `f${i}`, reason: "ignored" }));
    const r = discardReport({ restored: 0, trashed: 0, skipped });
    expect(r.leftAlone).toBe(true);
    expect(r.message).toBe(
      "nothing discarded.\n\nLeft alone:\nf0: ignored\nf1: ignored\nf2: ignored\nf3: ignored\nf4: ignored\nand 2 more",
    );
  });
});
