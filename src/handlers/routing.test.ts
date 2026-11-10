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
      goTo: vi.fn(), back: vi.fn(), forward: vi.fn(), up: vi.fn(), refresh: vi.fn(),
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
    expect(await owner("Zip (.zip)", ctx)).toBe(archiveHandler);
    expect(api.archiveCreate).toHaveBeenCalledWith(["/w/app.ts", "/w/lib.ts"], "/w/app.ts.zip", "zip");
    expect(ctx.refresh).toHaveBeenCalled();
  });

  it("Extract to Folder… offers the name without its archive extension", async () => {
    const ctx = makeCtx(["photos.TAR.GZ"], [0]);
    dialogs.showPrompt.mockResolvedValueOnce("pics");
    expect(await owner("Extract to Folder…", ctx)).toBe(archiveHandler);
    expect(dialogs.showPrompt).toHaveBeenCalledWith(expect.objectContaining({ initialValue: "photos" }));
    expect(api.archiveExtract).toHaveBeenCalledWith("/w/photos.TAR.GZ", "/w/pics");
  });

  it("Stage Selected stages the selection, and does nothing without one", async () => {
    const ctx = makeCtx(files, [0]);
    expect(await owner("Stage Selected", ctx)).toBe(gitHandler);
    expect(api.gitStage).toHaveBeenCalledWith(["/w/notes.md"]);
    vi.mocked(api.gitStage).mockClear();
    expect(await owner("Stage Selected", makeCtx(files, []))).toBe(gitHandler);
    expect(api.gitStage).not.toHaveBeenCalled();
  });

  it("Copy as UNC puts the admin-share path on the clipboard", async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const ctx = { ...makeCtx([], []), firstPath: "C:\\Users\\me\\a.txt" };
    expect(await owner("Copy as UNC", ctx)).toBe(toolsHandler);
    expect(writeText).toHaveBeenCalledWith("\\\\localhost\\C$\\Users\\me\\a.txt");
  });
});
