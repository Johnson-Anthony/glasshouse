import { describe, expect, it } from "vitest";
import type { LaunchRequest } from "./api";
import { planLaunch, type Kind } from "./launch";
import { pathOps } from "./paths";

const posix = pathOps(false);
const win = pathOps(true);

function plan(req: Partial<LaunchRequest>, kinds: Record<string, Kind>, ops = posix) {
  const full: LaunchRequest = { mode: "open", paths: Object.keys(kinds), skipped: [], ...req };
  return planLaunch(full, new Map(Object.entries(kinds)), ops);
}

describe("planLaunch", () => {
  it("opens a folder as itself and a file in its folder, selected", () => {
    expect(plan({}, { "/home/u/Downloads": "folder", "/home/u/Music/a.mp3": "file" })).toEqual({
      tabs: [
        { path: "/home/u/Downloads", select: [] },
        { path: "/home/u/Music", select: ["/home/u/Music/a.mp3"] },
      ],
      properties: null,
      problems: [],
    });
  });

  it("selects folders too when asked to select (ShowItems)", () => {
    const p = plan({ mode: "select" }, { "/srv/data": "folder", "/srv/x.zip": "file" });
    expect(p.tabs).toEqual([{ path: "/srv", select: ["/srv/data", "/srv/x.zip"] }]);
  });

  it("puts items of one folder in one tab, and a folder given with them in the same one", () => {
    const p = plan({}, { "/a": "folder", "/a/f1": "file", "/b/f2": "file", "/a/f1/": "file" });
    expect(p.tabs).toEqual([
      { path: "/a", select: ["/a/f1"] },
      { path: "/b", select: ["/b/f2"] },
    ]);
  });

  it("shows Properties for the first item", () => {
    const p = plan({ mode: "properties" }, { "/a/one": "file", "/a/two": "file" });
    expect(p.properties).toBe("/a/one");
    expect(p.tabs).toEqual([{ path: "/a", select: ["/a/one", "/a/two"] }]);
  });

  it("opens a root, which has no folder to be selected in", () => {
    expect(plan({ mode: "select" }, { "/": "folder" }).tabs).toEqual([{ path: "/", select: [] }]);
    expect(plan({ mode: "select" }, { "C:\\": "folder" }, win).tabs).toEqual([{ path: "C:\\", select: [] }]);
  });

  it("says what's missing or was skipped, and opens the rest", () => {
    const p = plan({ skipped: ["sftp://h/x: not a local file"] }, { "/gone": null, "/ok": "folder" });
    expect(p.tabs).toEqual([{ path: "/ok", select: [] }]);
    expect(p.problems).toEqual(["sftp://h/x: not a local file", "/gone: no such file or folder"]);
  });

  it("lets a listing explain a path the stat couldn't", () => {
    expect(plan({}, { "/mnt/share": "unknown" }).tabs).toEqual([{ path: "/mnt/share", select: [] }]);
  });

  it("matches Windows folders case-insensitively", () => {
    const p = plan({}, { "C:\\Users\\Me\\a.txt": "file", "c:\\users\\me": "folder" }, win);
    expect(p.tabs).toEqual([{ path: "C:\\Users\\Me", select: ["C:\\Users\\Me\\a.txt"] }]);
  });
});
