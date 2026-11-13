import { describe, expect, it } from "vitest";
import type { FileEntry, GitInfo } from "./api";
import { EMPTY_LISTING, keepGitInfo, relist, remapIndexes, sameEntries, withAnchor, withFocus, withSelected, type Listing } from "./listing";

function entry(name: string): FileEntry {
  return {
    name, path: "/w/" + name, kind: "text", size: 1, modified_ms: 0,
    hidden: false, ext: "", is_symlink: false, lossy: false, git: null,
  };
}
const list = (...names: string[]) => names.map(entry);
const names = (l: Listing, idx: number[]) => idx.map(i => l.entries[i].name);

function listing(entries: FileEntry[], selected: number[], focusIndex = 0, anchorIndex = focusIndex): Listing {
  return { entries, selected, focusIndex, anchorIndex };
}

describe("relist", () => {
  it("keeps the selection on the same files when a file appears before them", () => {
    const prev = listing(list("a", "c", "d"), [1, 2], 1, 2);
    const next = relist(prev, list("a", "b", "c", "d"));
    expect(names(next, next.selected)).toEqual(["c", "d"]);
    expect(next.entries[next.focusIndex].name).toBe("c");
    expect(next.entries[next.anchorIndex].name).toBe("d");
  });

  it("drops selected files that are gone and keeps the rest", () => {
    const prev = listing(list("a", "b", "c", "d"), [0, 2, 3]);
    const next = relist(prev, list("b", "c", "d"));
    // Without the remap, [0, 2, 3] would now be b, d and nothing: Delete
    // would trash b, which was never selected.
    expect(names(next, next.selected)).toEqual(["c", "d"]);
  });

  it("leaves focus at the same position when the focused file is gone", () => {
    const prev = listing(list("a", "b", "c"), [1], 1);
    const next = relist(prev, list("a", "c"));
    expect(next.selected).toEqual([]);
    expect(next.entries[next.focusIndex].name).toBe("c");
    // The anchor was on b too, so it follows the focus.
    expect(next.anchorIndex).toBe(next.focusIndex);
  });

  it("clamps a lost focus to the last row, and to 0 for an empty folder", () => {
    expect(relist(listing(list("a", "b", "c"), [], 2), list("a", "b")).focusIndex).toBe(1);
    const empty = relist(listing(list("a"), [0], 0), []);
    expect(empty).toEqual(EMPTY_LISTING);
  });

  it("starts a fresh listing with focus on the first row", () => {
    const next = relist(EMPTY_LISTING, list("a", "b"));
    expect(next).toEqual({ entries: list("a", "b"), selected: [], focusIndex: 0, anchorIndex: 0 });
  });
});

describe("bound setters", () => {
  const old = list("a", "c");
  const current = relist(listing(old, []), list("a", "b", "c"));

  it("apply as given when the listing hasn't changed", () => {
    const l = listing(old, [0]);
    expect(withSelected(l, old, [1]).selected).toEqual([1]);
    expect(withFocus(l, old, 1).focusIndex).toBe(1);
    expect(withAnchor(l, old, 1).anchorIndex).toBe(1);
  });

  it("move indexes from an older listing to the same files", () => {
    // c was index 1 when the click (or prompt) happened; the folder has been
    // re-listed since, and c is now index 2.
    expect(names(current, withSelected(current, old, [1]).selected)).toEqual(["c"]);
    expect(withFocus(current, old, 1).focusIndex).toBe(2);
    expect(withAnchor(current, old, 1).anchorIndex).toBe(2);
  });

  it("drop files that are gone, and leave focus and anchor alone", () => {
    const gone = relist(listing(old, []), list("a"));
    expect(withSelected(gone, old, [0, 1]).selected).toEqual([0]);
    expect(withFocus(gone, old, 1)).toBe(gone);
    expect(withAnchor(gone, old, 1)).toBe(gone);
  });

  it("return the same listing when nothing changes", () => {
    const l = listing(old, [0], 1, 1);
    expect(withSelected(l, old, l.selected)).toBe(l);
    expect(withFocus(l, old, 1)).toBe(l);
    expect(withAnchor(l, old, 1)).toBe(l);
  });
});

describe("remapIndexes", () => {
  // The pane's drag holds its sources as row indexes from when it began.
  type Row = { name: string; entry?: { path: string } };
  const row = (name: string): Row => ({ name, entry: { path: "/w/" + name } });
  const pathOf = (r: Row) => r.entry?.path;

  it("finds the dragged files in the rows on screen at the drop", () => {
    const start = [row("a"), row("c"), row("d")];
    const now = [row("a"), row("b"), row("c"), row("d")];
    expect(remapIndexes(start, now, [1, 2], pathOf)).toEqual([2, 3]);
    expect(remapIndexes(start, [row("a"), row("d")], [1, 2], pathOf)).toEqual([1]);
  });

  it("keeps the indexes when the rows are the same array", () => {
    const rows = [row("a"), { name: "no path" }];
    expect(remapIndexes(rows, rows, [1, 0, 5], pathOf)).toEqual([1, 0]);
  });
});

describe("unchanged re-reads", () => {
  it("compare entries by content, not identity", () => {
    expect(sameEntries(list("a", "b"), list("a", "b"))).toBe(true);
    expect(sameEntries(list("a", "b"), list("a"))).toBe(false);
    expect(sameEntries(list("a", "b"), list("b", "a"))).toBe(false);
    for (const change of [{ size: 2 }, { modified_ms: 5 }, { git: "M" }, { hidden: true }, { kind: "folder" }]) {
      expect(sameEntries(list("a"), [{ ...entry("a"), ...change }])).toBe(false);
    }
  });

  it("keep the previous listing, so a poll that finds nothing new renders nothing", () => {
    const prev = listing(list("a", "b", "c"), [1], 2, 1);
    expect(relist(prev, list("a", "b", "c"))).toBe(prev);
    expect(relist(prev, list("a", "b", "c", "d"))).not.toBe(prev);
  });

  it("keep the previous git info when nothing in it changed", () => {
    const info = (status: Record<string, string>, branch = "main"): GitInfo =>
      ({ repo_root: "/w", branch, ahead: 0, behind: 0, dirty: Object.keys(status).length, status });
    const prev = info({ "a.ts": "M" });
    expect(keepGitInfo(prev, info({ "a.ts": "M" }))).toBe(prev);
    const changed = [info({ "a.ts": "A" }), info({ "b.ts": "M" }), info({ "a.ts": "M", "b.ts": "?" }), info({ "a.ts": "M" }, "dev")];
    for (const next of changed) expect(keepGitInfo(prev, next)).toBe(next);
    expect(keepGitInfo(prev, null)).toBeNull();
    expect(keepGitInfo(null, prev)).toBe(prev);
  });
});
