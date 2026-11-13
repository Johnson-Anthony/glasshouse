import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FileEntry } from "../api";
import * as api from "../api";
import type { UseTabResult } from "../state";
import { HANDLERS, type Handler, type HandlerCtx } from "./index";
import { archiveHandler } from "./archive";
import { gitHandler } from "./git";
import { miscHandler } from "./misc";
import { navHandler } from "./nav";
import { selectionHandler } from "./selection";
import { toolsHandler } from "./tools";
import { viewHandler } from "./view";

// Every backend call is a no-op mock, and the dialogs answer like a user who
// cancels, unless a test says otherwise.
vi.mock("../api");
const dialogs = vi.hoisted(() => ({
  showPrompt: vi.fn(async (): Promise<string | null> => null),
  showAlert: vi.fn(async () => {}),
  showConfirm: vi.fn(async () => false),
  showChoice: vi.fn(async (): Promise<string | null> => null),
  showPick: vi.fn(async (): Promise<number | null> => null),
  showToast: vi.fn(),
}));
vi.mock("../dialogs/DialogHost", () => ({ dialogs }));

const BY_FILE: Array<[string, Handler]> = [
  ["selection", selectionHandler],
  ["view", viewHandler],
  ["git", gitHandler],
  ["archive", archiveHandler],
  ["tools", toolsHandler],
  ["nav", navHandler],
  ["misc", miscHandler],
];

function entry(name: string, kind = "text"): FileEntry {
  return {
    name,
    path: `/w/${name}`,
    kind,
    size: 1,
    modified_ms: 0,
    hidden: false,
    ext: name.includes(".") ? name.slice(name.lastIndexOf(".") + 1) : "",
    is_symlink: false,
    lossy: false,
    git: null,
  } as FileEntry;
}

function makeCtx(names: string[], selected: number[]): HandlerCtx {
  const entries = names.map(n => entry(n));
  const handle = {
    state: { path: "/w", entries, selected, private: false },
    actions: {
      goTo: vi.fn(), reveal: vi.fn(async () => "dropped"), back: vi.fn(), forward: vi.fn(), up: vi.fn(), refresh: vi.fn(),
      setSelected: vi.fn(), setFocusIndex: vi.fn(), setAnchorIndex: vi.fn(),
      setShowHidden: vi.fn(), setSortKey: vi.fn(),
      setSortDir: vi.fn(), setTagFilter: vi.fn(), clearHistory: vi.fn(),
    },
  } as unknown as UseTabResult;
  const selectedPaths = selected.map(i => entries[i].path);
  return {
    activeHandle: handle,
    cwd: "/w",
    selectedPaths,
    firstPath: selectedPaths[0],
    firstEntry: selected.length ? entries[selected[0]] : undefined,
    visibleRows: () => entries.map((_, i) => i),
    dispatch: vi.fn(),
    openAbout: vi.fn(),
    toggleSidebar: vi.fn(),
    toggleStatusBar: vi.fn(),
    pinPath: vi.fn(),
    tabs: [{}],
    activeTab: 0,
    setActiveTab: vi.fn(),
    setBlame: vi.fn(),
    setDiffView: vi.fn(),
    setGitOutput: vi.fn(),
    clipboardPaths: vi.fn(() => []),
    refresh: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    newTab: vi.fn(),
  };
}

/** App.tsx's loop: the first handler to return true takes the label. A
 *  handler that throws took it too (App reports the error and stops). */
async function owner(label: string, ctx: HandlerCtx): Promise<Handler | null> {
  for (const h of HANDLERS) {
    try {
      if (await h(label, ctx)) return h;
    } catch {
      return h;
    }
  }
  return null;
}

function nameOf(h: Handler | null): string {
  return BY_FILE.find(([, x]) => x === h)?.[0] ?? String(h);
}

function caseLabels(file: string): string[] {
  const src = readFileSync(new URL(`./${file}.ts`, import.meta.url), "utf8");
  return [...src.matchAll(/^\s*case "([^"]+)":/gm)].map(m => m[1]);
}

function mockCallCount(): number {
  let n = 0;
  for (const v of Object.values(api)) if (vi.isMockFunction(v)) n += v.mock.calls.length;
  for (const v of Object.values(dialogs)) n += v.mock.calls.length;
  return n;
}

beforeEach(() => {
  vi.clearAllMocks();
  // Handlers log as they go; keep the test output readable.
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("handler chain", () => {
  it("runs the specific handlers first and misc last", () => {
    expect(HANDLERS.map(nameOf)).toEqual(BY_FILE.map(([n]) => n));
  });

  it("lets an unknown label fall through every handler untouched", async () => {
    const ctx = makeCtx(["a.txt", "b.ts"], [0]);
    for (const [name, h] of BY_FILE) {
      expect(await h("No Such Command", ctx), name).toBe(false);
    }
    expect(await owner("No Such Command", ctx)).toBeNull();
    // Nothing ran on the way: no backend call, dialog or ctx callback.
    expect(mockCallCount()).toBe(0);
    for (const [key, v] of Object.entries(ctx)) {
      if (vi.isMockFunction(v)) expect(v, key).not.toHaveBeenCalled();
    }
  });

  // check:wiring proves statically that no earlier handler shadows a case;
  // this runs each one, which also catches a case that returns false.
  it.each(BY_FILE)("routes every case in %s.ts to that handler", async (file, h) => {
    const labels = caseLabels(file);
    expect(labels.length).toBeGreaterThan(0);
    for (const label of labels) {
      const ctx = makeCtx(["a.txt", "b.ts", "c.tar.gz"], [0, 1]);
      expect(nameOf(await owner(label, ctx)), label).toBe(file);
    }
  });

  it("passes selection labels on when there is no active tab", async () => {
    const ctx = { ...makeCtx([], []), activeHandle: undefined };
    expect(await selectionHandler("Select All", ctx)).toBe(false);
  });
});

describe("routed commands", () => {
  const files = ["notes.md", "app.ts", "lib.ts", "README"];

  it("Select All and Invert Selection set the tab's selection", async () => {
    const ctx = makeCtx(files, [1]);
    expect(await owner("Select All", ctx)).toBe(selectionHandler);
    expect(ctx.activeHandle!.actions.setSelected).toHaveBeenLastCalledWith([0, 1, 2, 3]);
    await owner("Invert Selection", ctx);
    expect(ctx.activeHandle!.actions.setSelected).toHaveBeenLastCalledWith([0, 2, 3]);
  });

  it("Select by Pattern… selects the names the glob matches", async () => {
    const ctx = makeCtx(files, []);
    dialogs.showPrompt.mockResolvedValueOnce("*.ts");
    expect(await owner("Select by Pattern…", ctx)).toBe(selectionHandler);
    expect(ctx.activeHandle!.actions.setSelected).toHaveBeenCalledWith([1, 2]);
  });

  it("a cancelled prompt changes nothing", async () => {
    const ctx = makeCtx(files, [0]);
    expect(await owner("Select by Pattern…", ctx)).toBe(selectionHandler);
    expect(ctx.activeHandle!.actions.setSelected).not.toHaveBeenCalled();
  });

  it("Zip (.zip) archives the selection next to it, then refreshes", async () => {
    const ctx = makeCtx(files, [1, 2]);
    vi.mocked(api.archiveCreate).mockResolvedValueOnce({ skipped: [] });
    expect(await owner("Zip (.zip)", ctx)).toBe(archiveHandler);
    expect(api.archiveCreate).toHaveBeenCalledWith(["/w/app.ts", "/w/lib.ts"], "/w/app.ts.zip", "zip");
    expect(ctx.refresh).toHaveBeenCalled();
    expect(dialogs.showAlert).not.toHaveBeenCalled();
  });

  it("Zip (.zip) lists what it left out", async () => {
    const ctx = makeCtx(files, [1]);
    vi.mocked(api.archiveCreate).mockResolvedValueOnce({
      skipped: [{ path: "/w/app.ts", reason: "symbolic link" }],
    });
    await owner("Zip (.zip)", ctx);
    expect(dialogs.showAlert).toHaveBeenCalledWith(expect.objectContaining({
      variant: "warning",
      message: "/w/app.ts: symbolic link",
    }));
  });

  describe("extracting", () => {
    const staging = "/w/.glasshouse-extract-1-0";
    const staged = (skipped: api.ArchiveSkip[] = []) => ({ staging, skipped });
    const inStaging = (name: string, kind = "text") => ({ ...entry(name, kind), path: `${staging}/${name}` });
    /** readDir lists `staged` for the staging folder and `existing` for /w. */
    function listing(staged: FileEntry[], existing: FileEntry[]) {
      vi.mocked(api.readDir).mockImplementation(async dir => (dir === staging ? staged : existing));
    }
    afterEach(() => vi.mocked(api.readDir).mockReset());

    it("Extract to Folder… offers the name without its archive extension", async () => {
      const ctx = makeCtx(["photos.TAR.GZ"], [0]);
      dialogs.showPrompt.mockResolvedValueOnce("pics");
      expect(await owner("Extract to Folder…", ctx)).toBe(archiveHandler);
      expect(dialogs.showPrompt).toHaveBeenCalledWith(expect.objectContaining({ initialValue: "photos" }));
      expect(api.archiveExtract).toHaveBeenCalledWith("/w/photos.TAR.GZ", "/w/pics");
    });

    it("Extract Here moves the staged entries in, then discards the staging folder", async () => {
      const ctx = makeCtx(["a.zip"], [0]);
      vi.mocked(api.archiveExtract).mockResolvedValueOnce(staged());
      listing([inStaging("payload", "folder"), inStaging("top.txt")], [entry("a.zip", "archive")]);
      await owner("Extract Here", ctx);
      expect(api.moveEntry).toHaveBeenCalledWith(`${staging}/payload`, "/w/payload");
      expect(api.moveEntry).toHaveBeenCalledWith(`${staging}/top.txt`, "/w/top.txt");
      expect(dialogs.showChoice).not.toHaveBeenCalled();
      expect(api.archiveDiscardStaging).toHaveBeenCalledWith(staging);
      expect(dialogs.showToast).toHaveBeenCalledWith({ message: "extracted 2 item(s)", variant: "success" });
      expect(ctx.refresh).toHaveBeenCalled();
    });

    it("asks before using a taken name, and cancelling moves nothing", async () => {
      const ctx = makeCtx(["a.zip"], [0]);
      vi.mocked(api.archiveExtract).mockResolvedValueOnce(staged());
      listing([inStaging("payload", "folder")], [entry("a.zip", "archive"), entry("payload", "folder")]);
      await owner("Extract Here", ctx); // showChoice answers null: cancel
      expect(dialogs.showChoice).toHaveBeenCalledTimes(1);
      expect(api.moveEntry).not.toHaveBeenCalled();
      expect(api.moveToTrash).not.toHaveBeenCalled();
      expect(api.archiveDiscardStaging).toHaveBeenCalledWith(staging);
      expect(dialogs.showToast).toHaveBeenCalledWith(expect.objectContaining({ message: "extract cancelled: nothing changed" }));
    });

    it("keep both gives the extracted entry a copy name", async () => {
      const ctx = makeCtx(["a.zip"], [0]);
      vi.mocked(api.archiveExtract).mockResolvedValueOnce(staged());
      listing([inStaging("payload", "folder")], [entry("payload", "folder")]);
      dialogs.showChoice.mockResolvedValueOnce("keep-both");
      await owner("Extract Here", ctx);
      expect(api.moveEntry).toHaveBeenCalledWith(`${staging}/payload`, "/w/payload (copy)");
      expect(api.archiveDiscardStaging).toHaveBeenCalledWith(staging);
    });

    it("discards the staging folder even when listing it fails", async () => {
      const ctx = makeCtx(["a.zip"], [0]);
      vi.mocked(api.archiveExtract).mockResolvedValueOnce(staged());
      vi.mocked(api.readDir).mockRejectedValueOnce(new Error("gone"));
      await owner("Extract Here", ctx);
      expect(dialogs.showAlert).toHaveBeenCalledWith(expect.objectContaining({ title: "extract failed", message: "gone" }));
      expect(api.archiveDiscardStaging).toHaveBeenCalledWith(staging);
    });

    it("a failed extraction alerts and has nothing to discard", async () => {
      const ctx = makeCtx(["a.zip"], [0]);
      vi.mocked(api.archiveExtract).mockRejectedValueOnce("extract a.zip: invalid checksum");
      await owner("Extract Here", ctx);
      expect(dialogs.showAlert).toHaveBeenCalledWith(expect.objectContaining({
        title: "extract failed",
        message: "extract a.zip: invalid checksum",
      }));
      expect(api.archiveDiscardStaging).not.toHaveBeenCalled();
      expect(api.moveEntry).not.toHaveBeenCalled();
    });

    it("lists archive entries the backend left out", async () => {
      const ctx = makeCtx(["a.zip"], [0]);
      vi.mocked(api.archiveExtract).mockResolvedValueOnce(staged([{ path: "up", reason: "its target .. is outside the archive" }]));
      listing([inStaging("top.txt")], []);
      await owner("Extract Here", ctx);
      expect(dialogs.showToast).toHaveBeenCalledWith({
        message: "extracted 1 item(s), left out 1 archive entry",
        variant: "warning",
      });
      expect(dialogs.showAlert).toHaveBeenCalledWith(expect.objectContaining({
        variant: "warning",
        message: "up: its target .. is outside the archive",
      }));
    });
  });

  /** A tab of a changed file, a clean one, an untracked one and a folder
   *  (whose label never says what's inside). */
  function gitCtx(selected: number[]): HandlerCtx {
    const ctx = makeCtx(["changed.ts", "clean.ts", "new.ts", "docs"], selected);
    const entries = ctx.activeHandle!.state.entries;
    entries[0].git = "M";
    entries[2].git = "?";
    entries[3].kind = "folder";
    return ctx;
  }

  it("Stage Selected stages changed items and folders, and skips clean files", async () => {
    const ctx = gitCtx([0, 1, 2, 3]);
    expect(await owner("Stage Selected", ctx)).toBe(gitHandler);
    expect(api.gitStage).toHaveBeenCalledWith(["/w/changed.ts", "/w/new.ts", "/w/docs"]);
    expect(ctx.refresh).toHaveBeenCalled();
    vi.mocked(api.gitStage).mockClear();
    expect(await owner("Stage Selected", gitCtx([1]))).toBe(gitHandler);
    expect(dialogs.showToast).toHaveBeenCalledWith(expect.objectContaining({ message: "nothing to stage in the selection" }));
    expect(await owner("Stage Selected", gitCtx([]))).toBe(gitHandler);
    expect(api.gitStage).not.toHaveBeenCalled();
  });

  it("Follow Folder flips the terminal's follow setting", async () => {
    const setTweaks = vi.fn();
    const tweaks = { termFollow: true } as NonNullable<HandlerCtx["tweaks"]>;
    expect(await owner("Follow Folder", { ...makeCtx([], []), tweaks, setTweaks })).toBe(viewHandler);
    expect(setTweaks).toHaveBeenCalledWith(expect.objectContaining({ termFollow: false }));
  });

  it("Unstage Selected leaves out untracked items", async () => {
    expect(await owner("Unstage Selected", gitCtx([0, 2, 3]))).toBe(gitHandler);
    expect(api.gitUnstage).toHaveBeenCalledWith(["/w/changed.ts", "/w/docs"]);
  });

  it("Discard Changes confirms, sends only what has changes, and reports what was left alone", async () => {
    const ctx = gitCtx([0, 1, 2, 3]);
    expect(await owner("Discard Changes", ctx)).toBe(gitHandler);
    expect(api.gitDiscard).not.toHaveBeenCalled();

    dialogs.showConfirm.mockResolvedValueOnce(true);
    vi.mocked(api.gitDiscard).mockResolvedValueOnce({
      restored: 1,
      trashed: 1,
      skipped: [{ path: "docs/draft.md", reason: "staged but never committed; unstage it first" }],
    });
    expect(await owner("Discard Changes", ctx)).toBe(gitHandler);
    expect(api.gitDiscard).toHaveBeenCalledWith(["/w/changed.ts", "/w/new.ts", "/w/docs"]);
    expect(ctx.refresh).toHaveBeenCalled();
    expect(dialogs.showAlert).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining("docs/draft.md: staged but never committed"),
    }));
  });

  it("every branch switch ends with `--`, so a folder name restores nothing", async () => {
    const result = { ok: true, stdout: "", stderr: "", exit: 0 };
    vi.mocked(api.gitRun).mockResolvedValue(result);
    dialogs.showPrompt.mockResolvedValueOnce(" docs ");
    expect(await owner("Checkout…", makeCtx([], []))).toBe(gitHandler);
    expect(api.gitRun).toHaveBeenLastCalledWith("/w", ["checkout", "docs", "--"]);
    expect(await owner("git-branch:feature/x", makeCtx([], []))).toBe(gitHandler);
    expect(api.gitRun).toHaveBeenLastCalledWith("/w", ["checkout", "feature/x", "--"]);
    vi.mocked(api.gitBranchList).mockResolvedValueOnce([
      { name: "main", current: true, upstream: null, ahead: 0, behind: 0, upstream_gone: false },
    ]);
    dialogs.showPrompt.mockResolvedValueOnce("1");
    expect(await owner("Git: Checkout Branch →", makeCtx([], []))).toBe(gitHandler);
    expect(api.gitRun).toHaveBeenLastCalledWith("/w", ["checkout", "main", "--"]);
  });

  it("Copy as UNC puts the admin-share path on the clipboard", async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const ctx = { ...makeCtx([], []), firstPath: "C:\\Users\\me\\a.txt" };
    expect(await owner("Copy as UNC", ctx)).toBe(toolsHandler);
    expect(writeText).toHaveBeenCalledWith("\\\\localhost\\C$\\Users\\me\\a.txt");
  });
});

describe("typed paths", () => {
  // The palette's "Go to <path>" row sends the path as its label.
  it("opens a label that looks like a path, with ~ expanded", async () => {
    vi.mocked(api.homeDir).mockResolvedValue("/home/me");
    for (const [label, opened] of [["/usr/share", "/usr/share"], ["~/src", "/home/me/src"], ["~", "/home/me"], ["C:\\Users", "C:\\Users"]]) {
      const ctx = makeCtx([], []);
      expect(await owner(label, ctx), label).toBe(navHandler);
      await vi.waitFor(() => expect(ctx.activeHandle!.actions.goTo).toHaveBeenCalledWith(opened));
    }
  });

  it("leaves other unknown labels alone", async () => {
    expect(await owner("src/app", makeCtx([], []))).toBeNull();
  });

  /** A prompt the user types each of `typed` into in turn, pressing OK;
   *  what its `submit` said to each (null: it closed). */
  function typeIntoPrompt(typed: string[]): Array<string | null> {
    const said: Array<string | null> = [];
    const prompt = async (opts: { submit?: (v: string) => Promise<string | null> }) => {
      for (const t of typed) said.push(await opts.submit!(t));
      return null;
    };
    dialogs.showPrompt.mockImplementationOnce(prompt as unknown as () => Promise<string | null>);
    return said;
  }

  it("Go to Path… and Open… open a folder, a file in its folder, or a link, and stay open on a mistake", async () => {
    vi.mocked(api.homeDir).mockResolvedValue("/home/me");
    vi.mocked(api.pathKind).mockImplementation(async p => (p === "/w/docs" ? "folder" : p === "/home/me/a.txt" ? "file" : null));
    for (const [label, handler] of [["Go to Path…", toolsHandler], ["Open…", navHandler]] as const) {
      const ctx = makeCtx([], []);
      const said = typeIntoPrompt(["nope", "docs/", "~/x/../a.txt", "https://example.com/?a&b", "ftp://example.com"]);
      expect(await owner(label, ctx), label).toBe(handler);
      expect(said, label).toEqual([
        "no such file or folder: /w/nope", null, null, null, "can't open ftp:// links: only http, https and mailto",
      ]);
      const { goTo, reveal } = ctx.activeHandle!.actions;
      expect(vi.mocked(goTo).mock.calls, label).toEqual([["/w/docs"]]);
      expect(vi.mocked(reveal).mock.calls, label).toEqual([["/home/me/a.txt"]]);
      expect(api.openUrl).toHaveBeenLastCalledWith("https://example.com/?a&b");
    }
  });

  it("the palette's row opens a file's folder with the file selected, and says when nothing's there", async () => {
    vi.mocked(api.pathKind).mockImplementation(async p => (p === "/w/notes.txt" ? "file" : null));
    const ctx = makeCtx([], []);
    expect(await owner("/w/notes.txt", ctx)).toBe(navHandler);
    await vi.waitFor(() => expect(ctx.activeHandle!.actions.reveal).toHaveBeenCalledWith("/w/notes.txt"));
    expect(await owner("/w/nope", ctx)).toBe(navHandler);
    await vi.waitFor(() => expect(dialogs.showAlert).toHaveBeenCalledWith(
      expect.objectContaining({ message: "no such file or folder: /w/nope", variant: "error" })));
    expect(ctx.activeHandle!.actions.goTo).not.toHaveBeenCalled();
  });

  it("revealing a file that isn't listed says hidden files are off", async () => {
    vi.mocked(api.homeDir).mockResolvedValue("/home/me");
    vi.mocked(api.pathKind).mockResolvedValue("file");
    const ctx = makeCtx([], []);
    vi.mocked(ctx.activeHandle!.actions.reveal).mockResolvedValue("not-listed");
    await owner("~/.bashrc", ctx);
    await vi.waitFor(() => expect(dialogs.showToast).toHaveBeenCalledWith(
      expect.objectContaining({ message: ".bashrc isn't listed: hidden files are off (Ctrl+H)" })));
    expect(ctx.activeHandle!.actions.reveal).toHaveBeenCalledWith("/home/me/.bashrc");
  });
});

describe("known folders", () => {
  // Localised XDG folders, as Tauri's documentDir() and the rest report them.
  const OS: Record<string, string> = {
    Desktop: "/home/me/Schreibtisch", Documents: "/home/me/Dokumente", Downloads: "/home/me/Downloads", Pictures: "/home/me/Bilder",
  };

  it("Go → Desktop, Documents, Downloads and Pictures open the folders the OS names", async () => {
    vi.mocked(api.knownFolder).mockImplementation(async name => OS[name]);
    for (const label of Object.keys(OS)) {
      const ctx = makeCtx([], []);
      expect(await owner(label, ctx), label).toBe(navHandler);
      await vi.waitFor(() => expect(ctx.activeHandle!.actions.goTo).toHaveBeenCalledWith(OS[label]));
      expect(api.knownFolder).toHaveBeenLastCalledWith(label);
    }
  });

  it("says so when there's no such folder", async () => {
    vi.mocked(api.knownFolder).mockResolvedValue(null);
    const ctx = makeCtx([], []);
    await owner("Pictures", ctx);
    await vi.waitFor(() => expect(dialogs.showAlert).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Pictures folder unavailable" })));
    expect(ctx.activeHandle!.actions.goTo).not.toHaveBeenCalled();
  });
});

describe("Find File by Name", () => {
  it("lists the matches under the folder searched and opens the one picked in its folder", async () => {
    dialogs.showPrompt.mockResolvedValueOnce("notes");
    vi.mocked(api.findFileByName).mockResolvedValue(["/w/a/notes.md", "/w/b/notes.txt"]);
    dialogs.showPick.mockResolvedValueOnce(1);
    const ctx = makeCtx([], []);
    expect(await owner("Find File by Name (fuzzy)", ctx)).toBe(toolsHandler);
    expect(dialogs.showPick).toHaveBeenCalledWith(expect.objectContaining({
      title: "2 matches", items: ["a/notes.md", "b/notes.txt"],
    }));
    expect(ctx.activeHandle!.actions.reveal).toHaveBeenCalledWith("/w/b/notes.txt");
    expect(dialogs.showAlert).not.toHaveBeenCalled();
  });

  it("does nothing when the list is cancelled", async () => {
    dialogs.showPrompt.mockResolvedValueOnce("notes");
    vi.mocked(api.findFileByName).mockResolvedValue(["/w/a/notes.md"]);
    const ctx = makeCtx([], []);
    await owner("Find File by Name (fuzzy)", ctx);
    expect(dialogs.showPick).toHaveBeenCalledOnce();
    expect(ctx.activeHandle!.actions.reveal).not.toHaveBeenCalled();
    expect(ctx.activeHandle!.actions.goTo).not.toHaveBeenCalled();
  });
});
