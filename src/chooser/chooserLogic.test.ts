// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import type { ChooserRequest, FileEntry } from "../api";
import { pathOps } from "../paths";
import * as L from "./chooserLogic";

const ops = pathOps(false);

function req(over: Partial<ChooserRequest> = {}): ChooserRequest {
  return {
    kind: "open", appId: "", title: "", acceptLabel: null, multiple: false, directory: false, modal: true,
    filters: [], currentFilter: null, choices: [], currentName: null, currentFolder: null, currentFile: null,
    files: [], parentWindow: "", requestedMs: 0, ...over,
  };
}

function entry(name: string, kind = "file", dir = "/home/u"): FileEntry {
  return { name, path: `${dir}/${name}`, kind, size: 0, modified_ms: 0, hidden: false, ext: "", is_symlink: false, lossy: false, git: null };
}

describe("filters", () => {
  it("matches globs over the whole name", () => {
    const m = L.filterMatcher([{ pattern: "*.png", caseSensitive: true }, { pattern: "photo-[0-9]?.jp*g", caseSensitive: false }]);
    expect(m("a.png")).toBe(true);
    expect(m("a.PNG")).toBe(false);
    expect(m("PHOTO-12.JPEG")).toBe(true);
    expect(m("a.png.txt")).toBe(false);
    expect(L.filterMatcher([{ pattern: "[!a]*", caseSensitive: true }])("abc")).toBe(false);
    expect(L.filterMatcher(undefined)("anything")).toBe(true);
  });

  it("keeps every folder, and no files when picking folders", () => {
    const rows = [entry("pics", "folder"), entry("a.png"), entry("b.txt")];
    const m = L.filterMatcher([{ pattern: "*.png", caseSensitive: true }]);
    expect(L.shownEntries(rows, false, m).map(e => e.name)).toEqual(["pics", "a.png"]);
    expect(L.shownEntries(rows, true, m).map(e => e.name)).toEqual(["pics"]);
  });

  it("swaps the extension when the filter changes", () => {
    const png = L.filterMatcher([{ pattern: "*.png", caseSensitive: true }]);
    const jpg = [{ pattern: "*.jpg", caseSensitive: true }];
    expect(L.swapExtension("cat.png", png, jpg)).toBe("cat.jpg");
    // A name the old filter didn't type stays.
    expect(L.swapExtension("cat.webp", png, jpg)).toBe("cat.webp");
    expect(L.swapExtension("cat.png", png, [{ pattern: "*", caseSensitive: true }])).toBe("cat.png");
    expect(L.swapExtension("cat", () => true, jpg)).toBe("cat.jpg");
  });
});

describe("labels and starting state", () => {
  it("reads GTK mnemonics as plain text", () => {
    expect(L.plainLabel("_Open")).toBe("Open");
    expect(L.plainLabel("Save __as")).toBe("Save _as");
    expect(L.acceptLabel(req({ acceptLabel: "_Upload" }))).toBe("Upload");
    expect(L.acceptLabel(req({ directory: true }))).toBe("Select");
    expect(L.acceptLabel(req({ kind: "save", acceptLabel: "_" }))).toBe("Save");
  });

  it("starts where the app asked, else where it last picked, else home", () => {
    expect(L.startFolder(req({ currentFile: "/d/x.txt", currentFolder: "/e" }), "/last", "/home/u", ops)).toBe("/d");
    expect(L.startFolder(req({ currentFolder: "/e" }), "/last", "/home/u", ops)).toBe("/e");
    expect(L.startFolder(req(), "/last", "/home/u", ops)).toBe("/last");
    expect(L.startFolder(req(), null, null, ops)).toBe("/");
    expect(L.startName(req({ kind: "save", currentFile: "/d/x.txt" }), ops)).toBe("x.txt");
    expect(L.startName(req({ kind: "save", currentName: "new.txt", currentFile: "/d/x.txt" }), ops)).toBe("new.txt");
    expect(L.startName(req({ currentName: "ignored" }), ops)).toBe("");
  });

  it("starts each choice at the app's value when it's one of its own", () => {
    const choices = [
      { id: "enc", label: "Encoding", options: [["utf8", "UTF-8"], ["latin1", "Latin-1"]] as [string, string][], initial: "latin1" },
      { id: "bad", label: "B", options: [["a", "A"]] as [string, string][], initial: "zzz" },
      { id: "ro", label: "Read only", options: [], initial: "true" },
      { id: "box", label: "Box", options: [], initial: "" },
    ];
    expect(L.startChoices(req({ choices }))).toEqual({ enc: "latin1", bad: "a", ro: "true", box: "false" });
  });
});

describe("the name field", () => {
  it("tells a name from a path", () => {
    expect(L.readTypedName("", "/home/u", "/home/u", false)).toEqual({ kind: "empty" });
    expect(L.readTypedName("notes.txt", "/home/u", "/home/u", false)).toEqual({ kind: "name", name: "notes.txt" });
    expect(L.readTypedName("~/docs/a.txt", "/x", "/home/u", false)).toEqual({ kind: "path", path: "/home/u/docs/a.txt", folderOnly: false });
    expect(L.readTypedName("sub/", "/home/u", "/home/u", false)).toEqual({ kind: "path", path: "/home/u/sub", folderOnly: true });
    expect(L.readTypedName("..", "/home/u", "/home/u", false)).toEqual({ kind: "path", path: "/home", folderOnly: true });
    expect(L.readTypedName("https://x.org/a", "/home/u", null, false).kind).toBe("error");
  });

  it("refuses names a file can't have", () => {
    expect(L.badSaveName("a/b")).toMatch(/\//);
    expect(L.badSaveName("..")).toBeTruthy();
    expect(L.badSaveName("  ")).toBeTruthy();
    expect(L.badSaveName("ok.txt")).toBeNull();
  });
});

describe("what open answers", () => {
  const cwd = "/home/u";
  it("takes the picked files, one unless multiple", () => {
    const picked = [entry("a.txt"), entry("b.txt")];
    expect(L.openPick(picked, cwd, false, false)).toEqual({ kind: "accept", paths: ["/home/u/a.txt"] });
    expect(L.openPick(picked, cwd, false, true)).toEqual({ kind: "accept", paths: ["/home/u/a.txt", "/home/u/b.txt"] });
  });

  it("enters a picked folder, or takes it in folder mode", () => {
    const folder = [entry("pics", "folder")];
    expect(L.openPick(folder, cwd, false, false)).toEqual({ kind: "enter", path: "/home/u/pics" });
    expect(L.openPick(folder, cwd, true, false)).toEqual({ kind: "accept", paths: ["/home/u/pics"] });
    // Nothing picked in folder mode: the folder shown.
    expect(L.openPick([], cwd, true, false)).toEqual({ kind: "accept", paths: [cwd] });
    expect(L.openPick([], cwd, false, false)).toEqual({ kind: "none" });
  });

  it("puts SaveFiles' names in the folder", () => {
    expect(L.saveFilesTargets("/out", ["a.txt", "b.txt"], ops)).toEqual(["/out/a.txt", "/out/b.txt"]);
  });
});

describe("the last folder", () => {
  beforeEach(() => localStorage.clear());
  it("is kept per app, the 50 most recent", () => {
    L.rememberFolder("org.a", "/a");
    L.rememberFolder("", "/plain");
    expect(L.lastFolder("org.a")).toBe("/a");
    expect(L.lastFolder("")).toBe("/plain");
    expect(L.lastFolder("org.none")).toBeNull();
    for (let i = 0; i < 60; i++) L.rememberFolder(`app${i}`, `/f${i}`);
    expect(L.lastFolder("org.a")).toBeNull();
    expect(L.lastFolder("app59")).toBe("/f59");
    // Picking again makes it the newest.
    L.rememberFolder("app10", "/again");
    for (let i = 60; i < 98; i++) L.rememberFolder(`app${i}`, `/f${i}`);
    expect(L.lastFolder("app10")).toBe("/again");
  });
});
