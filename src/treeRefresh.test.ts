import { describe, expect, it } from "vitest";
import type { FileEntry } from "./api";
import { pathOps } from "./paths";
import { dropTree, pruneUnder } from "./treeRefresh";

const posix = pathOps(false);
const win = pathOps(true);

const entry = (path: string, kind = "folder"): FileEntry => ({
  name: path.split(/[\\/]/).pop()!, path, kind, size: 0, modified_ms: 0,
  hidden: false, ext: "", is_symlink: false, lossy: false, git: null,
});
const keys = (rec: Record<string, unknown>) => Object.keys(rec).sort();
const rec = (...paths: string[]) => Object.fromEntries(paths.map(p => [p, true]));

describe("pruneUnder", () => {
  it("drops what was kept for a child folder that's gone, with everything under it", () => {
    const kept = rec("/h", "/h/a", "/h/a/x", "/h/a/x/y", "/h/b", "/h/b/z", "/h2/a", "/other");
    expect(keys(pruneUnder(kept, "/h", [entry("/h/b")], posix)))
      .toEqual(["/h", "/h/b", "/h/b/z", "/h2/a", "/other"]);
  });

  it("drops a child folder that's now a file", () => {
    expect(keys(pruneUnder(rec("/h", "/h/a"), "/h", [entry("/h/a", "text")], posix))).toEqual(["/h"]);
  });

  it("gives back the same object when nothing goes", () => {
    const kept = rec("/h", "/h/a", "/h/a/x", "/elsewhere");
    expect(pruneUnder(kept, "/h", [entry("/h/a"), entry("/h/new")], posix)).toBe(kept);
  });

  it("works at a root", () => {
    expect(keys(pruneUnder(rec("/a", "/b", "/b/c"), "/", [entry("/a")], posix))).toEqual(["/a"]);
    const kept = rec("C:\\a", "C:\\b\\c");
    expect(keys(pruneUnder(kept, "C:\\", [entry("C:\\a")], win))).toEqual(["C:\\a"]);
  });

  it("compares Windows paths ignoring case and slash style", () => {
    const kept = rec("C:\\Users\\me\\Docs", "C:\\Users\\me\\Docs\\x", "C:\\Users\\me\\Old");
    expect(keys(pruneUnder(kept, "c:/users/ME", [entry("C:\\Users\\me\\docs")], win)))
      .toEqual(["C:\\Users\\me\\Docs", "C:\\Users\\me\\Docs\\x"]);
  });

  it("treats a backslash as part of a name on Linux", () => {
    const kept = rec("/h/a\\b", "/h/a");
    expect(keys(pruneUnder(kept, "/h", [entry("/h/a\\b")], posix))).toEqual(["/h/a\\b"]);
  });
});

describe("dropTree", () => {
  it("drops a folder and everything under it, and nothing else", () => {
    const kept = rec("/h", "/h/a", "/h/a/x", "/h/ab", "/h/b");
    expect(keys(dropTree(kept, "/h/a", posix))).toEqual(["/h", "/h/ab", "/h/b"]);
    expect(keys(dropTree(rec("C:\\A", "C:\\A\\b", "C:\\Ab"), "c:/a/", win))).toEqual(["C:\\Ab"]);
  });

  it("gives back the same object when nothing goes", () => {
    const kept = rec("/h", "/h/b");
    expect(dropTree(kept, "/h/a", posix)).toBe(kept);
  });
});
