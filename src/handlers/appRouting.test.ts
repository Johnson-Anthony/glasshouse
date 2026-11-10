import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FileEntry } from "../api";
import * as api from "../api";
import { cmdState } from "../commandState";
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
function appCommands(): AppCommands {
  const values: Record<string, unknown> = {
    activeTab: 0, pins: ["/w"], savedRemotes: [{ host: "example.com", label: "ex" }], tagStore: {},
    state: { theme: "tokyo-night", hidden: false },
  };
  const fns = new Map<string, ReturnType<typeof vi.fn>>();
  return new Proxy({}, {
    get: (_t, k: string) => k in values ? values[k] : (fns.get(k) ?? fns.set(k, vi.fn()).get(k)),
  }) as AppCommands;
}

function makeCtx(entries: FileEntry[] | null, selected: number[] = []): HandlerCtx {
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
    app: appCommands(),
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
});
