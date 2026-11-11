import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FileEntry } from "../api";
import * as api from "../api";
import { cmdState, type ContextTarget } from "../commandState";
import {
  CONTEXT_BREADCRUMB, CONTEXT_SIDEBAR, CONTEXT_SIDEBAR_DRIVE, CONTEXT_SIDEBAR_FILE, CONTEXT_SIDEBAR_FOLDER,
  CONTEXT_SIDEBAR_REMOTE, CONTEXT_TAB, type MenuItemDef,
} from "../data";
import type { UseTabResult } from "../state";
import { COMMAND_CHAIN, HANDLERS, type AppCommands, type Handler, type HandlerCtx } from "./index";
import { appHandler } from "./app";
import { fileOpsHandler } from "./fileOps";
import { targetHandler } from "./target";

// The handlers moved out of App.tsx, routed the way App's router does. Every
// backend call is a no-op mock and dialogs answer like a user who cancels.
vi.mock("../api");
const dialogs = vi.hoisted(() => ({
  showPrompt: vi.fn(async (): Promise<string | null> => null),
  showAlert: vi.fn(async () => {}),
  showConfirm: vi.fn(async () => false),
  showChoice: vi.fn(async (): Promise<string | null> => null),
  showToast: vi.fn(),
}));
vi.mock("../dialogs/DialogHost", () => ({ dialogs }));

function entry(name: string, extra: Partial<FileEntry> = {}): FileEntry {
  return { name, path: `/w/${name}`, kind: "text", size: 1, modified_ms: 0, hidden: false, ext: "", is_symlink: false, lossy: false, git: null, ...extra } as FileEntry;
}

/** ctx.app with plain values for its state and a vi.fn for every function. */
function appCommands(over: Record<string, unknown> = {}): AppCommands {
  const values: Record<string, unknown> = {
    activeTab: 0, pins: ["/w"], savedRemotes: [{ host: "example.com", label: "ex" }], tagStore: {},
    state: { theme: "tokyo-night", hidden: false }, ...over,
  };
  const fns = new Map<string, ReturnType<typeof vi.fn>>();
  return new Proxy({}, {
    get: (_t, k: string) => k in values ? values[k] : (fns.get(k) ?? fns.set(k, vi.fn()).get(k)),
  }) as AppCommands;
}

function makeCtx(entries: FileEntry[] | null, selected: number[] = [], app: Record<string, unknown> = {}): HandlerCtx {
  const handle = entries && ({
    state: { path: "/w", entries, selected, private: false },
    actions: new Proxy({}, { get: () => vi.fn() }),
  } as unknown as UseTabResult);
  const selectedPaths = entries ? selected.map(i => entries[i].path) : [];
  return {
    activeHandle: handle ?? undefined,
    cwd: "/w",
    selectedPaths,
    firstPath: selectedPaths[0],
    firstEntry: entries && selected.length ? entries[selected[0]] : undefined,
    dispatch: vi.fn(), toggleSidebar: vi.fn(), pinPath: vi.fn(), tabs: [{}], activeTab: 0,
    setActiveTab: vi.fn(), setBlame: vi.fn(), refresh: vi.fn(),
    app: appCommands(app),
  };
}

/** App's router: plain booleans synchronously, promises awaited; a throw
 *  means the handler took the label (App reports the error and stops). */
async function owner(label: string, ctx: HandlerCtx): Promise<Handler | null> {
  for (const h of COMMAND_CHAIN) {
    try {
      const r = h(label, ctx);
      if (typeof r === "boolean" ? r : await r) return h;
    } catch {
      return h;
    }
  }
  return null;
}

const caseLabels = (file: string) =>
  [...readFileSync(new URL(`./${file}.ts`, import.meta.url), "utf8").matchAll(/^\s*case "([^"]+)":/gm)].map(m => m[1]);

beforeEach(() => {
  vi.clearAllMocks();
  cmdState.contextTarget = null;
  cmdState.clipboard = null;
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("COMMAND_CHAIN", () => {
  it("puts the context-menu target, app and file-op handlers before the feature handlers", () => {
    expect(COMMAND_CHAIN).toEqual([targetHandler, appHandler, fileOpsHandler, ...HANDLERS]);
  });

  it("routes every app.ts case to appHandler", async () => {
    for (const label of caseLabels("app")) {
      expect(await owner(label, makeCtx([entry("a.txt")], [0])), label).toBe(appHandler);
    }
  });

  it("routes every fileOps.ts case not taken earlier to fileOpsHandler", async () => {
    const app = new Set(caseLabels("app"));
    for (const label of caseLabels("fileOps").filter(l => !app.has(l))) {
      expect(await owner(label, makeCtx([entry("a.txt")], [0])), label).toBe(fileOpsHandler);
    }
  });

  it("runs app commands within the call, without a promise", () => {
    const ctx = makeCtx(null);
    expect(appHandler("Inspector", ctx)).toBe(true);
    expect(ctx.app!.setShowInspector).toHaveBeenCalled();
    expect(targetHandler("Inspector", ctx)).toBe(false);
  });
});

describe("fileOpsHandler", () => {
  it("takes every label silently when no tab is open, so nothing later runs", async () => {
    const ctx = makeCtx(null);
    expect(await owner("Select All", ctx)).toBe(fileOpsHandler);
    expect(await owner("No Such Command", ctx)).toBe(fileOpsHandler);
    expect(dialogs.showToast).not.toHaveBeenCalled();
  });

  it("refuses a mutating command on a lossy name before any handler acts", async () => {
    const ctx = makeCtx([entry("bad�.txt", { lossy: true })], [0]);
    expect(await owner("Move to Trash", ctx)).toBe(fileOpsHandler);
    expect(dialogs.showAlert).toHaveBeenCalledWith(expect.objectContaining({ title: "invalid filename encoding" }));
    expect(api.moveToTrash).not.toHaveBeenCalled();
  });

  it("passes unknown labels on to the feature handlers", async () => {
    expect(await fileOpsHandler("Select All", makeCtx([entry("a.txt")], [0]))).toBe(false);
  });
});

describe("targetHandler", () => {
  it("acts on the right-clicked tab and consumes the target", async () => {
    const ctx = makeCtx([entry("a.txt")]);
    cmdState.contextTarget = { kind: "tab", tabIndex: 2 };
    expect(await owner("Close Tab", ctx)).toBe(targetHandler);
    expect(ctx.app!.closeTabAt).toHaveBeenCalledWith(2);
    expect(cmdState.contextTarget).toBeNull();
  });

  it("leaves labels without a target to the app handler", async () => {
    expect(await owner("Close Tab", makeCtx([entry("a.txt")]))).toBe(appHandler);
  });

  it("opens an ssh terminal for a right-clicked saved remote", async () => {
    const ctx = makeCtx(null);
    cmdState.contextTarget = { kind: "sidebar", rowKind: "remote", path: "example.com" };
    expect(await owner("Connect", ctx)).toBe(targetHandler);
    expect(ctx.app!.setTermProfile).toHaveBeenCalledWith(expect.objectContaining({ kind: "ssh", args: ["example.com"] }));
    expect(ctx.app!.setTermOpen).toHaveBeenCalledWith(true);
  });

  it("Copy as Command quotes the right-clicked folder so pasting it runs nothing else", async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    cmdState.contextTarget = { kind: "breadcrumb", path: "/w/$(touch PWNED)'`x`" };
    expect(await owner("Copy as Command", makeCtx([entry("a.txt")]))).toBe(targetHandler);
    expect(writeText).toHaveBeenCalledWith("cd '/w/$(touch PWNED)'\\''`x`'");
    expect(cmdState.contextTarget).toBeNull();
  });

  it("Copy as Command copies nothing for a path with control characters", async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    cmdState.contextTarget = { kind: "sidebar", path: "/w/a\nrm -rf ~" };
    expect(await owner("Copy as Command", makeCtx([entry("a.txt")]))).toBe(targetHandler);
    expect(writeText).not.toHaveBeenCalled();
    expect(dialogs.showToast).toHaveBeenCalled();
  });
});

describe("context-menu targets", () => {
  // The real listDir answers [] when it can't list.
  beforeEach(() => { vi.mocked(api.listDir).mockResolvedValue([]); });
  const labels = (menu: MenuItemDef[]): string[] => menu.flatMap(it =>
    it.kind === "item" ? [it.action ?? it.label] : it.kind === "sub" ? labels(it.children) : []);
  const pinExtras = ["Unpin", "Move pin up", "Move pin down"];
  const MENUS: Array<[string, ContextTarget, string[]]> = [
    ["tree folder", { kind: "sidebar", rowKind: "tree-folder", path: "/w/sub" }, labels(CONTEXT_SIDEBAR_FOLDER)],
    ["tree file", { kind: "sidebar", rowKind: "tree-file", path: "/w/t.txt" }, labels(CONTEXT_SIDEBAR_FILE)],
    ["pinned folder", { kind: "sidebar", rowKind: "pinned", path: "/w" }, [...pinExtras, ...labels(CONTEXT_SIDEBAR_FOLDER)]],
    ["pinned file", { kind: "sidebar", rowKind: "pinned-file", path: "/w/t.txt" }, [...pinExtras, ...labels(CONTEXT_SIDEBAR_FILE)]],
    ["drive", { kind: "sidebar", rowKind: "drive", path: "/" }, labels(CONTEXT_SIDEBAR_DRIVE)],
    ["wsl", { kind: "sidebar", rowKind: "wsl", path: "/wsl" }, labels(CONTEXT_SIDEBAR)],
    ["remote", { kind: "sidebar", rowKind: "remote", path: "example.com" }, labels(CONTEXT_SIDEBAR_REMOTE)],
    ["breadcrumb", { kind: "breadcrumb", path: "/w" }, labels(CONTEXT_BREADCRUMB)],
    ["tab", { kind: "tab", tabIndex: 0 }, labels(CONTEXT_TAB)],
  ];

  it.each(MENUS)("runs every %s menu item on the right-clicked target", async (_name, target, items) => {
    expect(items.length).toBeGreaterThan(0);
    for (const label of items) {
      cmdState.contextTarget = { ...target };
      expect(await owner(label, makeCtx([entry("a.txt")], [0])), label).toBe(targetHandler);
      expect(dialogs.showToast, label).not.toHaveBeenCalledWith(expect.objectContaining({ variant: "warning" }));
    }
  });

  it("opens a sidebar file with the default app instead of navigating into it", async () => {
    const ctx = makeCtx([entry("a.txt")], [0]);
    const goTo = vi.fn();
    Object.assign(ctx.activeHandle!, { actions: { goTo, refresh: vi.fn() } });
    cmdState.contextTarget = { kind: "sidebar", rowKind: "tree-file", path: "/w/t.txt" };
    await owner("Open", ctx);
    expect(api.openWithDefault).toHaveBeenCalledWith("/w/t.txt");
    expect(goTo).not.toHaveBeenCalled();

    cmdState.contextTarget = { kind: "sidebar", rowKind: "pinned-file", path: "/w/t.txt" };
    await owner("Open", ctx);
    expect(api.openWithDefault).toHaveBeenCalledTimes(2);
    expect(goTo).not.toHaveBeenCalled();

    cmdState.contextTarget = { kind: "sidebar", rowKind: "pinned", path: "/w/sub" };
    await owner("Open", ctx);
    expect(goTo).toHaveBeenCalledWith("/w/sub");
  });

  it("refuses a command it has no case for, rather than running it on the pane's selection", async () => {
    // Git: Discard on a tree file used to discard the pane's selected files.
    const ctx = makeCtx([entry("a.txt", { git: "M" })], [0]);
    cmdState.contextTarget = { kind: "sidebar", rowKind: "tree-file", path: "/w/t.txt" };
    expect(await owner("Git: Discard changes", ctx)).toBe(targetHandler);
    expect(api.gitDiscard).not.toHaveBeenCalled();
    expect(dialogs.showToast).toHaveBeenCalledWith(expect.objectContaining({ variant: "warning" }));
    expect(cmdState.contextTarget).toBeNull();
  });

  it("removes tags from the right-clicked row, not the selection", async () => {
    const ctx = makeCtx([entry("a.txt")], [0], { tagStore: { "/w/t.txt": ["red", "blue"], "/w/a.txt": ["red"] } });
    dialogs.showPrompt.mockResolvedValueOnce("red");
    cmdState.contextTarget = { kind: "sidebar", rowKind: "tree-file", path: "/w/t.txt" };
    expect(await owner("Remove Tag…", ctx)).toBe(targetHandler);
    await vi.waitFor(() => expect(ctx.app!.setTagStore).toHaveBeenCalled());
    const update = vi.mocked(ctx.app!.setTagStore).mock.calls[0][0] as (p: Record<string, string[]>) => Record<string, string[]>;
    expect(update({ "/w/t.txt": ["red", "blue"], "/w/a.txt": ["red"] })).toEqual({ "/w/t.txt": ["blue"], "/w/a.txt": ["red"] });

    dialogs.showConfirm.mockResolvedValueOnce(true);
    cmdState.contextTarget = { kind: "sidebar", rowKind: "tree-folder", path: "/w/t.txt" };
    expect(await owner("Clear All Tags", ctx)).toBe(targetHandler);
    await vi.waitFor(() => expect(ctx.app!.setTagStore).toHaveBeenCalledTimes(2));
    const clear = vi.mocked(ctx.app!.setTagStore).mock.calls[1][0] as (p: Record<string, string[]>) => Record<string, string[]>;
    expect(clear({ "/w/t.txt": ["blue"], "/w/a.txt": ["red"] })).toEqual({ "/w/a.txt": ["red"] });
  });
});
