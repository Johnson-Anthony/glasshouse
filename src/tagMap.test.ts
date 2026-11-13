import { describe, expect, it } from "vitest";
import { dropTagKeys, goneCandidates, moveTagKeys, putTagKeys, type TagMap } from "./tagMap";

describe("moveTagKeys", () => {
  it("moves a file's tags to its new name", () => {
    const map = { "/w/a.txt": ["red"], "/w/b.txt": ["blue"] };
    expect(moveTagKeys(map, "/w/a.txt", "/w/c.txt", false)).toEqual({ "/w/b.txt": ["blue"], "/w/c.txt": ["red"] });
  });

  it("moves a folder's tags and everything under it, and nothing beside it", () => {
    const map = {
      "/w/d": ["blue"], "/w/d/x.txt": ["red"], "/w/d/sub/y.txt": ["green"],
      "/w/dd/z.txt": ["red"], "/w/d.txt": ["red"],
    };
    expect(moveTagKeys(map, "/w/d", "/v/e", false)).toEqual({
      "/v/e": ["blue"], "/v/e/x.txt": ["red"], "/v/e/sub/y.txt": ["green"],
      "/w/dd/z.txt": ["red"], "/w/d.txt": ["red"],
    });
  });

  it("drops stale tags at and under the destination", () => {
    // Whatever was at /w/b is gone (the backend refuses a taken name), so a
    // file renamed there doesn't inherit its tags.
    const map = { "/w/b": ["secret"], "/w/b/old.txt": ["secret"], "/w/a": ["review"] };
    expect(moveTagKeys(map, "/w/a", "/w/b", false)).toEqual({ "/w/b": ["review"] });
    expect(moveTagKeys({ "/w/b": ["secret"] }, "/w/a", "/w/b", false)).toEqual({});
  });

  it("returns the same map when nothing is tagged there", () => {
    const map = { "/w/x": ["red"] };
    expect(moveTagKeys(map, "/w/a", "/w/b", false)).toBe(map);
  });

  it("follows a swap through a temporary name, as Bulk Rename runs it", () => {
    let map: TagMap = { "/w/a": ["red"], "/w/b": ["blue"] };
    for (const [from, to] of [["/w/a", "/w/tmp"], ["/w/b", "/w/a"], ["/w/tmp", "/w/b"]]) {
      map = moveTagKeys(map, from, to, false);
    }
    expect(map).toEqual({ "/w/a": ["blue"], "/w/b": ["red"] });
  });

  it("on Windows, matches keys in any case and either separator", () => {
    const map = { "C:\\Work\\Report.txt": ["red"], "C:/Work/Sub/x.txt": ["blue"], "C:\\Workshop\\y": ["green"] };
    expect(moveTagKeys(map, "c:\\work", "D:\\Archive\\work", true)).toEqual({
      "D:\\Archive\\work\\Report.txt": ["red"], "D:\\Archive\\work/Sub/x.txt": ["blue"], "C:\\Workshop\\y": ["green"],
    });
  });

  it("keeps the tags through a case-only rename on Windows", () => {
    const map = { "C:\\w\\readme.md": ["review"], "C:\\w\\docs\\a.md": ["red"] };
    expect(moveTagKeys(map, "C:\\w\\readme.md", "C:\\w\\README.md", true)).toEqual({
      "C:\\w\\README.md": ["review"], "C:\\w\\docs\\a.md": ["red"],
    });
    expect(moveTagKeys(map, "C:\\w\\docs", "C:\\w\\Docs", true)).toEqual({
      "C:\\w\\readme.md": ["review"], "C:\\w\\Docs\\a.md": ["red"],
    });
  });

  it("on Linux, case matters", () => {
    const map = { "/w/Readme": ["red"] };
    expect(moveTagKeys(map, "/w/readme", "/w/x", false)).toBe(map);
  });
});

describe("dropTagKeys", () => {
  it("drops paths and everything under them, and returns what it dropped", () => {
    const map = { "/w/d": ["blue"], "/w/d/x": ["red"], "/w/dx": ["green"], "/w/f": ["red"] };
    const r = dropTagKeys(map, ["/w/d", "/w/f"], false);
    expect(r.map).toEqual({ "/w/dx": ["green"] });
    expect(r.dropped).toEqual({ "/w/d": ["blue"], "/w/d/x": ["red"], "/w/f": ["red"] });
  });

  it("returns the same map when nothing matches", () => {
    const map = { "/w/a": ["red"] };
    const r = dropTagKeys(map, ["/w/b"], false);
    expect(r.map).toBe(map);
    expect(r.dropped).toEqual({});
  });
});

describe("putTagKeys", () => {
  it("merges labels without repeating them", () => {
    const map = { "/w/a": ["red"] };
    expect(putTagKeys(map, { "/w/a": ["red", "blue"], "/w/b": ["green"] })).toEqual({
      "/w/a": ["red", "blue"], "/w/b": ["green"],
    });
    expect(map).toEqual({ "/w/a": ["red"] });
  });

  it("returns the same map when nothing is new", () => {
    const map = { "/w/a": ["red"] };
    expect(putTagKeys(map, { "/w/a": ["red"] })).toBe(map);
  });
});

describe("goneCandidates", () => {
  const map = {
    "/w/a.txt": ["red"], "/w/.hidden": ["red"], "/w/gone.txt": ["red"],
    "/w/olddir/x": ["red"], "/w/olddir/y/z": ["blue"], "/w/kept/x": ["red"],
    "/w": ["blue"], "/other/q": ["red"],
  };

  it("names each child the listing lacks once, folders included", () => {
    expect(goneCandidates(map, "/w", ["a.txt", "kept"], false).sort()).toEqual(["/w/.hidden", "/w/gone.txt", "/w/olddir"]);
  });

  it("finds nothing when every tagged child is listed", () => {
    expect(goneCandidates(map, "/w", ["a.txt", ".hidden", "gone.txt", "olddir", "kept"], false)).toEqual([]);
  });

  it("works at the POSIX root", () => {
    expect(goneCandidates({ "/etc/x": ["red"], "/w/a": ["red"] }, "/", ["w"], false)).toEqual(["/etc"]);
  });

  it("on Windows, compares names without case and works at a drive root", () => {
    const win = { "C:\\Users\\Me\\Notes.txt": ["red"], "C:\\Temp\\x": ["blue"] };
    expect(goneCandidates(win, "c:\\users\\me", ["notes.TXT"], true)).toEqual([]);
    expect(goneCandidates(win, "C:\\", ["Users"], true)).toEqual(["C:\\Temp"]);
  });
});
