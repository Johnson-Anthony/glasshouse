import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "./api";
import { afterPaste, allMoved, clipboardPaths, copyFiles, copyText, filesToPaste, pastePlan, pastedText, writeText } from "./clipboard";
import type { TransferResult } from "./transfer";

// The backend is mocked, with a Tauri window there (TAURI_AVAILABLE), so
// text goes to the OS clipboard as it does in the app.
vi.mock("./api", () => ({
  TAURI_AVAILABLE: true,
  clipboardWriteText: vi.fn(async () => {}),
  clipboardReadText: vi.fn(async (): Promise<string | null> => null),
  clipboardWriteFiles: vi.fn(async () => {}),
  clipboardReadFiles: vi.fn(async (): Promise<unknown> => null),
  clipboardCutPaths: vi.fn(async () => []),
  clipboardCutPasted: vi.fn(async () => {}),
}));
const dialogs = vi.hoisted(() => ({ showAlert: vi.fn(async (_o?: unknown) => {}), showToast: vi.fn() }));
vi.mock("./dialogs/DialogHost", () => ({ dialogs }));
vi.mock("./log", () => ({ logWarn: vi.fn(), logError: vi.fn(), describeForLog: (e: unknown) => String(e) }));

const clip = (cut: boolean, paths: string[], extra: Partial<api.ClipboardFiles> = {}): api.ClipboardFiles =>
  ({ cut, items: paths.map(path => ({ path, folder: path.endsWith("/d") })), gone: 0, other: 0, stamp: 3, ...extra });
const result = (extra: Partial<TransferResult> = {}): TransferResult => ({ done: [], replaced: [], skipped: [], failed: [], ...extra });

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.unstubAllGlobals());

describe("text", () => {
  it("copyText puts text on the OS clipboard through the backend", async () => {
    const browser = vi.fn();
    vi.stubGlobal("navigator", { clipboard: { writeText: browser } });
    expect(await copyText("/home/u/a b.txt")).toBe(true);
    expect(api.clipboardWriteText).toHaveBeenCalledWith("/home/u/a b.txt");
    expect(browser).not.toHaveBeenCalled();
    expect(dialogs.showAlert).not.toHaveBeenCalled();
  });

  it("a failed copy is shown, and the caller hears", async () => {
    vi.mocked(api.clipboardWriteText).mockRejectedValueOnce(new Error("another app is using the clipboard"));
    expect(await copyText("x")).toBe(false);
    expect(dialogs.showAlert).toHaveBeenCalledWith(expect.objectContaining({
      title: "copy failed", variant: "error", message: "another app is using the clipboard",
    }));
    // The plain writer throws instead, for a caller with its own report.
    vi.mocked(api.clipboardWriteText).mockRejectedValueOnce(new Error("no"));
    await expect(writeText("x")).rejects.toThrow("no");
  });

  it("pastedText is the clipboard's text, empty for none, undefined for a failed read", async () => {
    vi.mocked(api.clipboardReadText).mockResolvedValueOnce("name.txt");
    expect(await pastedText()).toBe("name.txt");
    expect(await pastedText()).toBe("");
    vi.mocked(api.clipboardReadText).mockRejectedValueOnce(new Error("the clipboard didn't answer"));
    expect(await pastedText()).toBeUndefined();
    expect(dialogs.showAlert).toHaveBeenCalledWith(expect.objectContaining({ title: "clipboard read failed" }));
  });
});

describe("pastePlan", () => {
  it("gives Paste the files that are there, folders marked", () => {
    expect(pastePlan(clip(true, ["/s/a.txt", "/s/d"]))).toEqual({
      pasting: { cut: true, items: [{ path: "/s/a.txt", isDir: false }, { path: "/s/d", isDir: true }], stamp: 3 },
      note: null,
    });
    expect(pastePlan(clip(false, ["/s/a.txt"])).pasting?.cut).toBe(false);
  });

  it("says why there's nothing to paste", () => {
    const none = "nothing to paste: the clipboard holds no files";
    expect(pastePlan(null)).toEqual({ pasting: null, note: none });
    expect(pastePlan(clip(false, []))).toEqual({ pasting: null, note: none });
    expect(pastePlan(clip(true, [], { gone: 1 })).note).toBe("nothing to paste: 1 item no longer there");
    expect(pastePlan(clip(false, [], { other: 2 })).note).toBe("nothing to paste: 2 items not on this computer");
    expect(pastePlan(clip(false, [], { gone: 1, other: 1 })).note).toBe("nothing to paste: 1 item no longer there, 1 item not on this computer");
  });

  it("pastes what's there and says what was left out", () => {
    const plan = pastePlan(clip(true, ["/s/a.txt"], { gone: 2, other: 1 }));
    expect(plan.pasting?.items).toEqual([{ path: "/s/a.txt", isDir: false }]);
    expect(plan.note).toBe("left out of the paste: 2 items no longer there, 1 item not on this computer");
  });
});

describe("files", () => {
  it("copyFiles offers the paths, as a cut or a copy, and reports a refusal", async () => {
    expect(await copyFiles(["/s/a"], true)).toBe(true);
    expect(api.clipboardWriteFiles).toHaveBeenCalledWith(["/s/a"], true);
    vi.mocked(api.clipboardWriteFiles).mockRejectedValueOnce(new Error("refused"));
    expect(await copyFiles(["/s/a"], true)).toBe(false);
    expect(dialogs.showAlert).toHaveBeenCalledWith(expect.objectContaining({ title: "cut failed", message: "refused" }));
  });

  it("filesToPaste reads the clipboard every time and toasts what it can't paste", async () => {
    vi.mocked(api.clipboardReadFiles).mockResolvedValueOnce(clip(false, ["/s/a.txt"], { other: 1 }));
    expect(await filesToPaste()).toEqual({ cut: false, items: [{ path: "/s/a.txt", isDir: false }], stamp: 3 });
    expect(dialogs.showToast).toHaveBeenCalledWith({ message: "left out of the paste: 1 item not on this computer", variant: "warning" });
    expect(await filesToPaste()).toBeNull();
    expect(dialogs.showToast).toHaveBeenLastCalledWith({ message: "nothing to paste: the clipboard holds no files", variant: "info" });
    expect(api.clipboardCutPasted).not.toHaveBeenCalled();
  });

  it("a cut with nothing left to paste is reported to the backend, which ends it", async () => {
    vi.mocked(api.clipboardReadFiles).mockResolvedValueOnce(clip(true, [], { gone: 3 }));
    expect(await filesToPaste()).toBeNull();
    expect(api.clipboardCutPasted).toHaveBeenCalledWith(3, false);
    // A copy whose files are gone is just nothing to paste.
    vi.mocked(api.clipboardCutPasted).mockClear();
    vi.mocked(api.clipboardReadFiles).mockResolvedValueOnce(clip(false, [], { gone: 3 }));
    expect(await filesToPaste()).toBeNull();
    expect(api.clipboardCutPasted).not.toHaveBeenCalled();
  });

  it("a clipboard that can't be read is an error, not an empty clipboard", async () => {
    vi.mocked(api.clipboardReadFiles).mockRejectedValue(new Error("the clipboard didn't answer"));
    expect(await filesToPaste()).toBeNull();
    expect(dialogs.showAlert).toHaveBeenCalledWith(expect.objectContaining({ title: "paste failed", message: "the clipboard didn't answer" }));
    expect(dialogs.showToast).not.toHaveBeenCalled();
    expect(await clipboardPaths()).toEqual([]);
    expect(dialogs.showAlert).toHaveBeenLastCalledWith(expect.objectContaining({ title: "clipboard read failed" }));
    vi.mocked(api.clipboardReadFiles).mockResolvedValue(clip(true, ["/s/a", "/s/b"], { gone: 1 }));
    expect(await clipboardPaths()).toEqual(["/s/a", "/s/b"]);
    vi.mocked(api.clipboardReadFiles).mockResolvedValue(null);
    expect(await clipboardPaths()).toEqual([]);
  });
});

describe("after a paste", () => {
  const items = [{ path: "/s/a" }, { path: "/s/b" }];
  const moved = (src: string) => ({ src, dst: `/w${src.slice(2)}` });

  it("allMoved: every item, with nothing failed, skipped or cancelled", () => {
    expect(allMoved(items, result({ done: [moved("/s/a"), moved("/s/b")] }))).toBe(true);
    expect(allMoved(items, result({ done: [moved("/s/a")], skipped: [{ src: "/s/b", reason: "conflict" }] }))).toBe(false);
    expect(allMoved(items, result({ done: [moved("/s/a")], failed: [{ src: "/s/b", error: "busy" }] }))).toBe(false);
    expect(allMoved(items, result({ done: [moved("/s/a")], cancelled: 1 }))).toBe(false);
  });

  it("a copy stays on the clipboard: the backend isn't told", async () => {
    await afterPaste({ cut: false, items, stamp: 3 }, result({ done: [moved("/s/a"), moved("/s/b")] }));
    expect(api.clipboardCutPasted).not.toHaveBeenCalled();
  });

  it("a cut that moved is reported, with whether everything moved", async () => {
    await afterPaste({ cut: true, items, stamp: 3 }, result({ done: [moved("/s/a"), moved("/s/b")] }));
    expect(api.clipboardCutPasted).toHaveBeenLastCalledWith(3, true);
    await afterPaste({ cut: true, items, stamp: 4 }, result({ done: [moved("/s/a")], failed: [{ src: "/s/b", error: "busy" }] }));
    expect(api.clipboardCutPasted).toHaveBeenLastCalledWith(4, false);
  });

  it("a cut that moved nothing is still cut", async () => {
    await afterPaste({ cut: true, items, stamp: 3 }, result({ skipped: [{ src: "/s/a", reason: "same-place" }, { src: "/s/b", reason: "same-place" }] }));
    expect(api.clipboardCutPasted).not.toHaveBeenCalled();
  });
});
