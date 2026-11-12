import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FileEntry } from "../api";
import * as api from "../api";
import { cmdState } from "../commandState";
import { pushUndo, redoLast, redoStack, undoLast, undoStack, type UseTabResult } from "../state";
import { COMMAND_CHAIN, type AppCommands, type HandlerCtx } from "./index";

// Each change a command makes either pushes an undo entry or marks itself
// irreversible (survey-2 task 11). The backend is mocked by a small in-memory
// disk; the dialogs answer like a user who cancels unless a test says otherwise.
vi.mock("../api");
type PromptOpts = { submit?: (v: string) => Promise<string | null> | string | null };
const dialogs = vi.hoisted(() => ({
  showPrompt: vi.fn(async (_o?: PromptOpts): Promise<string | null> => null),
  showAlert: vi.fn(async (_o?: unknown) => {}),
  showConfirm: vi.fn(async (_o?: unknown) => false),
  showChoice: vi.fn(async (_o?: unknown): Promise<string | null> => null),
  showToast: vi.fn(),
}));
vi.mock("../dialogs/DialogHost", () => ({ dialogs }));

function entry(name: string, extra: Partial<FileEntry> = {}): FileEntry {
  return { name, path: `/w/${name}`, kind: "text", size: 1, modified_ms: 0, hidden: false, ext: "", is_symlink: false, lossy: false, git: null, ...extra } as FileEntry;
}

function makeCtx(entries: FileEntry[], selected: number[], extra: Partial<HandlerCtx> = {}): HandlerCtx {
  const handle = {
    state: { path: "/w", entries, selected, private: false },
    actions: new Proxy({}, { get: () => vi.fn() }),
  } as unknown as UseTabResult;
  const fns = new Map<string, ReturnType<typeof vi.fn>>();
  const values: Record<string, unknown> = { pins: [], tagStore: {} };
  const app = new Proxy({}, {
    get: (_t, k: string) => k in values ? values[k] : (fns.get(k) ?? fns.set(k, vi.fn()).get(k)),
  }) as AppCommands;
  const selectedPaths = selected.map(i => entries[i].path);
  return {
    activeHandle: handle, cwd: "/w", selectedPaths, firstPath: selectedPaths[0],
    firstEntry: selected.length ? entries[selected[0]] : undefined,
    dispatch: vi.fn(), toggleSidebar: vi.fn(), pinPath: vi.fn(), tabs: [{}], activeTab: 0,
    setActiveTab: vi.fn(), setBlame: vi.fn(), setGitOutput: vi.fn(), refresh: vi.fn(),
    app, ...extra,
  };
}

/** App's router, but a handler's exception reaches the test. */
async function run(label: string, ctx: HandlerCtx): Promise<void> {
  for (const h of COMMAND_CHAIN) {
    const r = h(label, ctx);
    if (typeof r === "boolean" ? r : await r) return;
  }
  throw new Error(`nobody took ${label}`);
}

const top = () => undoStack[undoStack.length - 1]?.label;
const errorOf = (r: Awaited<ReturnType<typeof undoLast>>) => String((r as { error?: unknown }).error);

/** The mocked backend as a map of paths, enough for listings, creates,
 *  moves and deletes. Like the real one, nothing lands on a taken name. */
function useDisk(init: Record<string, string | null>) {
  const disk = new Map(Object.entries(init)); // null = folder
  disk.set("/w", null);
  const parent = (p: string) => p.slice(0, p.lastIndexOf("/")) || "/";
  const under = (p: string) => [...disk.keys()].filter(k => k === p || k.startsWith(p + "/"));
  const add = (p: string, content: string | null) => {
    if (disk.has(p)) throw new Error(`exists: ${p}`);
    if (disk.get(parent(p)) !== null) throw new Error(`no folder for ${p}`);
    disk.set(p, content);
  };
  const move = async (from: string, to: string) => {
    if (!disk.has(from)) throw new Error(`no such file: ${from}`);
    if (disk.has(to)) throw new Error(`exists: ${to}`);
    for (const k of under(from)) {
      const v = disk.get(k)!;
      disk.delete(k);
      disk.set(to + k.slice(from.length), v);
    }
  };
  let stagings = 0;
  vi.mocked(api.readDir).mockImplementation(async dir => {
    if (disk.get(dir) !== null) throw new Error(`no such folder: ${dir}`);
    return [...disk].filter(([k]) => k !== dir && parent(k) === dir).map(([k, v]) => entry(k.slice(dir.length + 1), {
      path: k, kind: v === null ? "folder" : "text", size: v === null ? 0 : new TextEncoder().encode(v).length,
    }));
  });
  vi.mocked(api.moveEntry).mockImplementation(move);
  vi.mocked(api.renameEntry).mockImplementation(move);
  vi.mocked(api.deleteEntry).mockImplementation(async (p, recursive) => {
    if (!disk.has(p)) throw new Error(`no such file: ${p}`);
    if (under(p).length > 1 && !recursive) throw new Error("Directory not empty");
    for (const k of under(p)) disk.delete(k);
  });
  vi.mocked(api.ensureDir).mockImplementation(async p => { if (!disk.has(p)) add(p, null); });
  vi.mocked(api.makeDir).mockImplementation(async p => add(p, null));
  vi.mocked(api.createTextFile).mockImplementation(async (p, content) => add(p, content));
  vi.mocked(api.writeText).mockImplementation(async (p, content) => { disk.set(p, content); });
  vi.mocked(api.readText).mockImplementation(async p => {
    const v = disk.get(p);
    if (typeof v !== "string") throw new Error(`no such file: ${p}`);
    return v;
  });
  for (const make of [api.createSymlink, api.createHardLink]) {
    vi.mocked(make).mockImplementation(async (target, link) => add(link, `-> ${target}`));
  }
  vi.mocked(api.archiveCreate).mockImplementation(async (_paths, dest) => { add(dest, "zip"); return { skipped: [] }; });
  // Extracts top.txt and payload/x into a fresh staging folder in `dest`.
  vi.mocked(api.archiveExtract).mockImplementation(async (_archive, dest) => {
    if (!disk.has(dest)) add(dest, null);
    const staging = `${dest}/.glasshouse-extract-${++stagings}`;
    add(staging, null);
    add(`${staging}/top.txt`, "top");
    add(`${staging}/payload`, null);
    add(`${staging}/payload/x`, "x");
    return { staging, skipped: [] };
  });
  vi.mocked(api.archiveDiscardStaging).mockImplementation(async staging => {
    for (const k of under(staging)) disk.delete(k);
  });
  return {
    paths: () => [...disk.keys()].sort(),
    content: (p: string) => disk.get(p),
    set: (p: string, content: string | null) => disk.set(p, content),
    remove: (p: string) => { for (const k of under(p)) disk.delete(k); },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  undoStack.length = 0;
  redoStack.length = 0;
  cmdState.contextTarget = null;
  cmdState.clipboard = null;
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** A prompt answered with `value`, running its submit as the dialog does. */
function answerPrompt(value: string) {
  dialogs.showPrompt.mockImplementationOnce(async o => {
    expect(await o?.submit?.(value) ?? null).toBeNull();
    return value;
  });
}

/** An older, unrelated entry, to show whether Ctrl+Z can still reach it. */
function olderEntry() {
  const inverse = vi.fn();
  pushUndo({ label: "older", inverse, redo: vi.fn() });
  return inverse;
}

describe("commands that now push an undo entry", () => {
  it("Paste Text into Filename: undo renames it back", async () => {
    const disk = useDisk({ "/w/a.txt": "A" });
    vi.stubGlobal("navigator", { clipboard: { readText: async () => "b.txt" } });
    await run("Paste Text into Filename", makeCtx([entry("a.txt")], [0]));
    expect(disk.paths()).toEqual(["/w", "/w/b.txt"]);
    expect(await undoLast()).toEqual({ status: "done", label: "rename a.txt → b.txt" });
    expect(disk.paths()).toEqual(["/w", "/w/a.txt"]);
  });

  it("From Template: undo deletes the new file", async () => {
    const disk = useDisk({});
    dialogs.showPrompt.mockResolvedValueOnce("1"); // README
    answerPrompt("README.md");
    await run("From Template…", makeCtx([], []));
    expect(disk.content("/w/README.md")).toContain("# project");
    expect(await undoLast()).toEqual({ status: "done", label: "new file README.md" });
    expect(disk.paths()).toEqual(["/w"]);
    expect((await redoLast()).status).toBe("done");
    expect(disk.content("/w/README.md")).toContain("# project");
  });

  it("Python Module: one entry takes the folder and its __init__.py", async () => {
    const disk = useDisk({});
    answerPrompt("pkg");
    await run("Python Module", makeCtx([], []));
    expect(disk.paths()).toEqual(["/w", "/w/pkg", "/w/pkg/__init__.py"]);
    expect(await undoLast()).toEqual({ status: "done", label: "new python module pkg" });
    expect(disk.paths()).toEqual(["/w"]);
  });

  it("Create Symlink: undo deletes the link", async () => {
    const disk = useDisk({});
    dialogs.showPrompt.mockResolvedValueOnce("/t/real").mockResolvedValueOnce("/w/real");
    await run("Create Symlink…", makeCtx([], []));
    expect(api.createSymlink).toHaveBeenCalledWith("/t/real", "/w/real");
    expect(await undoLast()).toEqual({ status: "done", label: "symlink real" });
    expect(disk.paths()).toEqual(["/w"]);
  });

  it("Paste as Symlink: undo deletes the links it made, and redo makes them again", async () => {
    const disk = useDisk({});
    const ctx = makeCtx([], [], { clipboardPaths: () => ["/t/a", "/t/b"] });
    await run("Paste as Symlink", ctx);
    expect(disk.paths()).toEqual(["/w", "/w/a", "/w/b"]);
    expect(await undoLast()).toEqual({ status: "done", label: "paste 2 symlink(s)" });
    expect(disk.paths()).toEqual(["/w"]);
    expect((await redoLast()).status).toBe("done");
    expect(disk.paths()).toEqual(["/w", "/w/a", "/w/b"]);
  });

  it("Paste as Hard Link: undo keeps a link whose original is gone", async () => {
    const disk = useDisk({ "/src": null, "/src/f.txt": "F" });
    await run("Paste as Hard Link", makeCtx([], [], { clipboardPaths: () => ["/src/f.txt"] }));
    disk.remove("/src/f.txt");
    const r = await undoLast();
    expect(r.status).toBe("failed");
    expect(errorOf(r)).toContain("f.txt is no longer there");
    expect(disk.paths()).toContain("/w/f.txt");
  });

  it("Zip (.zip): undo deletes the archive", async () => {
    const disk = useDisk({ "/w/a.txt": "A" });
    await run("Zip (.zip)", makeCtx([entry("a.txt")], [0]));
    expect(disk.paths()).toContain("/w/a.txt.zip");
    expect(await undoLast()).toEqual({ status: "done", label: "compress to a.txt.zip" });
    expect(disk.paths()).toEqual(["/w", "/w/a.txt"]);
  });

  it("ZIP (each individually): one entry for all the archives", async () => {
    const disk = useDisk({ "/w/a.txt": "A", "/w/b.txt": "B" });
    await run("ZIP (each individually)", makeCtx([entry("a.txt"), entry("b.txt")], [0, 1]));
    expect(await undoLast()).toEqual({ status: "done", label: "compress 2 item(s) each to .zip" });
    expect(disk.paths()).toEqual(["/w", "/w/a.txt", "/w/b.txt"]);
  });
});

describe("Extract", () => {
  it("Extract Here: undo deletes what landed, redo extracts it again", async () => {
    const disk = useDisk({ "/w/a.zip": "zip" });
    await run("Extract Here", makeCtx([entry("a.zip")], [0]));
    const extracted = ["/w", "/w/a.zip", "/w/payload", "/w/payload/x", "/w/top.txt"];
    expect(disk.paths()).toEqual(extracted);
    expect(await undoLast()).toEqual({ status: "done", label: "extract a.zip" });
    expect(disk.paths()).toEqual(["/w", "/w/a.zip"]);
    expect(await redoLast()).toEqual({ status: "done", label: "extract a.zip" });
    expect(disk.paths()).toEqual(extracted);
    expect(api.archiveExtract).toHaveBeenCalledTimes(2);
  });

  it("Extract to Folder: undo removes the folder it made", async () => {
    const disk = useDisk({ "/w/a.zip": "zip" });
    dialogs.showPrompt.mockResolvedValueOnce("pics");
    await run("Extract to Folder…", makeCtx([entry("a.zip")], [0]));
    expect(disk.paths()).toContain("/w/pics/top.txt");
    expect(await undoLast()).toEqual({ status: "done", label: "extract a.zip" });
    expect(disk.paths()).toEqual(["/w", "/w/a.zip"]);
  });

  it("Extract to Folder into a folder already there: undo leaves what was in it", async () => {
    const disk = useDisk({ "/w/a.zip": "zip", "/w/pics": null, "/w/pics/old.jpg": "old" });
    dialogs.showPrompt.mockResolvedValueOnce("pics");
    await run("Extract to Folder…", makeCtx([entry("a.zip")], [0]));
    expect((await undoLast()).status).toBe("done");
    expect(disk.paths()).toEqual(["/w", "/w/a.zip", "/w/pics", "/w/pics/old.jpg"]);
  });

  it("Extract to Folder leaves no new empty folder when nothing lands", async () => {
    const disk = useDisk({ "/w/a.zip": "zip" });
    dialogs.showPrompt.mockResolvedValueOnce("pics");
    vi.mocked(api.moveEntry).mockRejectedValue(new Error("disk full"));
    await run("Extract to Folder…", makeCtx([entry("a.zip")], [0]));
    expect(disk.paths()).toEqual(["/w", "/w/a.zip"]);
    expect(undoStack).toEqual([]);
  });
});

describe("Export Layout", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", { length: 1, key: () => "glasshouse.zoom", getItem: () => "1.2" });
  });

  it("creates .glasshouserc, and undo deletes it", async () => {
    const disk = useDisk({});
    await run("Export Layout (.glasshouserc)", makeCtx([], []));
    expect(disk.content("/w/.glasshouserc")).toContain("glasshouse.zoom");
    expect(await undoLast()).toEqual({ status: "done", label: "export layout" });
    expect(disk.paths()).toEqual(["/w"]);
  });

  it("asks before replacing one, and leaves it when told no", async () => {
    const disk = useDisk({ "/w/.glasshouserc": "mine" });
    await run("Export Layout (.glasshouserc)", makeCtx([], []));
    expect(dialogs.showConfirm).toHaveBeenCalledWith(expect.objectContaining({ okLabel: "replace" }));
    expect(disk.content("/w/.glasshouserc")).toBe("mine");
    expect(undoStack).toEqual([]);
  });

  it("replacing one can be undone", async () => {
    const disk = useDisk({ "/w/.glasshouserc": "mine" });
    dialogs.showConfirm.mockResolvedValueOnce(true);
    await run("Export Layout (.glasshouserc)", makeCtx([], []));
    expect(disk.content("/w/.glasshouserc")).toContain("glasshouse.zoom");
    expect(await undoLast()).toEqual({ status: "done", label: "export layout" });
    expect(disk.content("/w/.glasshouserc")).toBe("mine");
  });

  it("replacing one that didn't read back whole is marked irreversible", async () => {
    const disk = useDisk({ "/w/.glasshouserc": "mine" });
    vi.mocked(api.readText).mockResolvedValueOnce("mi"); // cut off
    dialogs.showConfirm.mockResolvedValueOnce(true);
    await run("Export Layout (.glasshouserc)", makeCtx([], []));
    expect(disk.content("/w/.glasshouserc")).toContain("glasshouse.zoom");
    expect((await undoLast()).status).toBe("irreversible");
  });
});

describe("Screenshot Auto-sort", () => {
  const shot = (name: string, month: number) =>
    entry(name, { kind: "image", modified_ms: new Date(2026, month - 1, 15, 12).getTime() });
  const shots = [shot("Screenshot_2026-11-01.png", 11), shot("Screenshot_2026-11-02.png", 11), shot("Screenshot_2026-10-01.png", 10)];
  const before = { "/w/Screenshot_2026-11-01.png": "1", "/w/Screenshot_2026-11-02.png": "2", "/w/Screenshot_2026-10-01.png": "3" };

  it("moves each month's screenshots, and one undo puts them all back and removes the folders", async () => {
    const disk = useDisk(before);
    const start = disk.paths();
    await run("Screenshot → Auto-sort", makeCtx(shots, []));
    expect(dialogs.showAlert).toHaveBeenCalledWith({ title: "screenshot stack", message: "moved 3 screenshots into 2 month folders", variant: "info" });
    expect(disk.paths()).toEqual(["/w", "/w/2026-10", "/w/2026-10/Screenshot_2026-10-01.png", "/w/2026-11",
      "/w/2026-11/Screenshot_2026-11-01.png", "/w/2026-11/Screenshot_2026-11-02.png"]);
    expect(await undoLast()).toEqual({ status: "done", label: "auto-sort 3 screenshot(s)" });
    expect(disk.paths()).toEqual(start);
    expect((await redoLast()).status).toBe("done");
    expect(disk.paths()).toContain("/w/2026-10/Screenshot_2026-10-01.png");
  });

  it("stops at a cancelled conflict question and says so, instead of reporting it as moved", async () => {
    // October's folder already has a screenshot of that name; the question
    // is cancelled after November was sorted.
    const disk = useDisk({ ...before, "/w/2026-10": null, "/w/2026-10/Screenshot_2026-10-01.png": "old" });
    await run("Screenshot → Auto-sort", makeCtx(shots, []));
    expect(dialogs.showChoice).toHaveBeenCalledTimes(1);
    expect(dialogs.showAlert).toHaveBeenCalledWith({
      title: "screenshot stack",
      message: "moved 2 screenshots into 1 month folder, cancelled with 1 not sorted",
      variant: "warning",
    });
    expect(disk.content("/w/Screenshot_2026-10-01.png")).toBe("3");
    expect(await undoLast()).toEqual({ status: "done", label: "auto-sort 2 screenshot(s)" });
    expect(disk.paths()).toEqual(["/w", "/w/2026-10", "/w/2026-10/Screenshot_2026-10-01.png",
      "/w/Screenshot_2026-10-01.png", "/w/Screenshot_2026-11-01.png", "/w/Screenshot_2026-11-02.png"]);
  });

  it("counts skipped screenshots, and pushes nothing when nothing moved", async () => {
    useDisk({ ...before, "/w/2026-11": null, "/w/2026-11/Screenshot_2026-11-01.png": "a", "/w/2026-11/Screenshot_2026-11-02.png": "b" });
    dialogs.showChoice.mockResolvedValueOnce("skip");
    await run("Screenshot → Auto-sort", makeCtx(shots.slice(0, 2), []));
    expect(dialogs.showAlert).toHaveBeenCalledWith({
      title: "screenshot stack", message: "moved 0 screenshots into 0 month folders, 2 skipped", variant: "info",
    });
    expect(undoStack).toEqual([]);
  });
});

describe("commands that can't be undone drop the history before them", () => {
  /** Runs `label` after an older entry, then checks Ctrl+Z stops at it. */
  async function expectStop(label: string, ctx: HandlerCtx, stop: string) {
    const older = olderEntry();
    await run(label, ctx).catch(() => {});
    expect(await undoLast()).toEqual({ status: "irreversible", label: stop });
    expect(await undoLast()).toEqual({ status: "empty" });
    expect(older).not.toHaveBeenCalled();
  }

  it("Shred, even when it fails partway", async () => {
    dialogs.showConfirm.mockResolvedValue(true);
    vi.mocked(api.shred).mockRejectedValueOnce(new Error("I/O error"));
    await expectStop("Shred (srm)", makeCtx([entry("a.txt")], [0]), "shred a.txt");
  });

  it("Delete Permanently", async () => {
    useDisk({ "/w/a.txt": "A", "/w/b.txt": "B" });
    dialogs.showConfirm.mockResolvedValue(true);
    await expectStop("Delete Permanently", makeCtx([entry("a.txt"), entry("b.txt")], [0, 1]), "delete 2 item(s) permanently");
  });

  it("git commands that change something, but not read-only ones", async () => {
    vi.mocked(api.gitRun).mockResolvedValue({ ok: true, exit: 0, stdout: "", stderr: "" });
    const older = olderEntry();
    await run("Status", makeCtx([], []));
    expect(top()).toBe("older");
    await run("Pull", makeCtx([], []));
    expect(await undoLast()).toEqual({ status: "irreversible", label: "git pull --ff-only" });
    expect(older).not.toHaveBeenCalled();
  });

  it("a git command that failed partway, such as a merge with conflicts", async () => {
    vi.mocked(api.gitRun).mockResolvedValue({ ok: false, exit: 1, stdout: "", stderr: "CONFLICT" });
    dialogs.showPrompt.mockResolvedValueOnce("feature");
    await expectStop("Merge…", makeCtx([], []), "git merge feature --no-edit");
  });

  it("Stage, Unstage and Discard", async () => {
    const files = [entry("a.txt", { git: "M" })];
    await expectStop("Stage Selected", makeCtx(files, [0]), "git stage 1 item(s)");
    await expectStop("Unstage Selected", makeCtx(files, [0]), "git unstage 1 item(s)");
    dialogs.showConfirm.mockResolvedValueOnce(true);
    vi.mocked(api.gitDiscard).mockResolvedValueOnce({ restored: 1, trashed: 0, skipped: [] });
    await expectStop("Discard Changes", makeCtx(files, [0]), "git discard 1 item(s)");
  });

  it("Batch Permissions, unless every chmod failed", async () => {
    dialogs.showPrompt.mockResolvedValueOnce("755");
    await expectStop("Batch Permissions…", makeCtx([entry("a.sh"), entry("b.sh")], [0, 1]), "chmod 755 on 2 item(s)");
    olderEntry();
    dialogs.showPrompt.mockResolvedValueOnce("755");
    vi.mocked(api.setPermissions).mockRejectedValue(new Error("EPERM"));
    await run("Batch Permissions…", makeCtx([entry("a.sh")], [0]));
    expect(top()).toBe("older");
  });

  it("Change Owner", async () => {
    dialogs.showPrompt.mockResolvedValueOnce("1000:1000");
    await expectStop("Change Owner (chown)…", makeCtx([entry("a.sh")], [0]), "chown 1000:1000");
  });

  it("Run Script and Custom Command, whatever their outcome", async () => {
    dialogs.showPrompt.mockResolvedValueOnce("/s/tidy.sh");
    vi.mocked(api.runScript).mockRejectedValueOnce(new Error("exit 1"));
    await expectStop("Run Script on Selection…", makeCtx([entry("a.txt")], [0]), "script /s/tidy.sh");
    dialogs.showPrompt.mockResolvedValueOnce("touch");
    vi.mocked(api.runScript).mockResolvedValueOnce("");
    await expectStop("Custom Command…", makeCtx([entry("a.txt")], [0]), `command "touch"`);
  });
});
