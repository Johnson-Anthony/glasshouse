import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "./api";
import type { ChangedFile, ReplaceOutcome, ReplacePlan } from "./api";
import { LISTED, nothingMessage, outcomeReport, previewMessage, replaceUndo, shownPath } from "./findReplace";
import { redoLast, redoStack, undoLast, undoStack } from "./state";
import { toolsHandler } from "./handlers/tools";
import type { HandlerCtx } from "./handlers/types";

vi.mock("./api");
const dialogs = vi.hoisted(() => ({
  showPrompt: vi.fn(async (_o?: unknown): Promise<string | null> => null),
  showAlert: vi.fn(async (_o?: { message: string; title?: string; variant?: string }) => {}),
  showConfirm: vi.fn(async (_o?: { message: string }) => false),
  showChoice: vi.fn(async (_o?: unknown): Promise<string | null> => null),
  showToast: vi.fn((_o?: { message: string; variant?: string }) => {}),
}));
vi.mock("./dialogs/DialogHost", () => ({ dialogs }));

const req = { root: "/w", query: "foo", replacement: "bar", caseInsensitive: false };

function plan(extra: Partial<ReplacePlan> = {}): ReplacePlan {
  return {
    files: [
      { path: "/w/a.txt", matches: 2, bytes: 10, new_bytes: 10 },
      { path: "/w/sub/b.md", matches: 1, bytes: 5, new_bytes: 5 },
    ],
    skipped: [],
    capped: false,
    cap: 500,
    undoable: true,
    ...extra,
  };
}

const changed = (path: string, before: string | null, after: string | null, matches = 1): ChangedFile =>
  ({ path, matches, before, after });

describe("shownPath", () => {
  it("is relative to the root only under it", () => {
    expect(shownPath("/w", "/w/sub/b.md")).toBe("sub/b.md");
    expect(shownPath("/w/", "/w/a.txt")).toBe("a.txt");
    expect(shownPath("/w", "/wx/a.txt")).toBe("/wx/a.txt");
    expect(shownPath("C:\\w", "C:\\w\\a.txt")).toBe("a.txt");
    expect(shownPath("/w", "/w")).toBe("/w");
  });
});

describe("previewMessage", () => {
  it("lists each file with its matches", () => {
    expect(previewMessage(plan(), req)).toBe(
      `Replace "foo" with "bar" in 2 files (3 matches):\n• a.txt (2)\n• sub/b.md (1)`,
    );
  });

  it("lists what it leaves alone, the cap and that it can't be undone", () => {
    const msg = previewMessage(plan({
      skipped: [{ path: "/w/latin1.txt", reason: "not UTF-8 text" }],
      capped: true,
      undoable: false,
    }), req);
    expect(msg).toContain(`Left alone (1):\n• latin1.txt: not UTF-8 text`);
    expect(msg).toContain("stopped at 500 files with matches");
    expect(msg).toContain("can't be undone");
  });

  it("names the first files and counts the rest", () => {
    const files = Array.from({ length: LISTED + 3 }, (_, i) => ({ path: `/w/f${i}.txt`, matches: 1, bytes: 1, new_bytes: 1 }));
    const lines = previewMessage(plan({ files }), req).split("\n");
    expect(lines).toHaveLength(1 + LISTED + 1);
    expect(lines[lines.length - 1]).toBe("• …and 3 more");
  });
});

describe("nothingMessage", () => {
  it("says no matches, or lists the files it won't change", () => {
    expect(nothingMessage(plan({ files: [] }), req)).toBe(`no matches for "foo"`);
    expect(nothingMessage(plan({ files: [], skipped: [{ path: "/w/big.log", reason: "too large (over 16 MiB)" }] }), req))
      .toBe(`"foo" is only in files that won't be changed:\n• big.log: too large (over 16 MiB)`);
  });
});

describe("outcomeReport", () => {
  const all: ReplaceOutcome = {
    changed: [changed("/w/a.txt", "x", "y", 2), changed("/w/sub/b.md", "x", "y", 1)],
    skipped: [],
    cancelled: false,
  };

  it("is a toast when everything confirmed was replaced", () => {
    expect(outcomeReport(plan(), all, req, true)).toEqual({ message: "replaced 3 matches in 2 files", clean: true });
    // The confirm already said this one can't be undone.
    expect(outcomeReport(plan({ undoable: false }), all, req, false))
      .toEqual({ message: "replaced 3 matches in 2 files (can't be undone)", clean: true });
  });

  it("lists files left alone, a cancel, the cap and a surprise irreversible", () => {
    const r = outcomeReport(plan({ capped: true }), {
      changed: [changed("/w/a.txt", null, null, 2)],
      skipped: [],
      cancelled: true,
    }, req, false);
    expect(r.clean).toBe(false);
    expect(r.message).toContain("Replaced 2 matches in 1 file.");
    expect(r.message).toContain("Cancelled with 1 file not reached.");
    expect(r.message).toContain("stopped at 500 files");
    expect(r.message).toContain("can't be undone");

    const s = outcomeReport(plan(), {
      changed: [],
      skipped: [{ path: "/w/a.txt", reason: "read-only" }, { path: "/w/sub/b.md", reason: "it changed while it was being replaced" }],
      cancelled: false,
    }, req, false);
    expect(s).toEqual({
      message: "Nothing was replaced.\n\nNot changed (2):\n• a.txt: read-only\n• sub/b.md: it changed while it was being replaced",
      clean: false,
    });
  });
});

describe("replaceUndo", () => {
  it("is null when any file's text wasn't kept", () => {
    expect(replaceUndo("r", [changed("/w/a", "x", "y"), changed("/w/b", null, null)])).toBeNull();
    expect(replaceUndo("r", [changed("/w/a", "x", "y")])?.label).toBe("r");
  });
});

describe("Find & Replace in Files", () => {
  const disk = new Map<string, string>();
  const ctx = { cwd: "/w", refresh: vi.fn() } as unknown as HandlerCtx;
  const run = () => toolsHandler("Find & Replace in Files", ctx);
  const answer = (needle: string | null, replacement: string | null) => {
    dialogs.showPrompt.mockResolvedValueOnce(needle).mockResolvedValueOnce(replacement);
  };

  beforeEach(() => {
    vi.clearAllMocks();
    undoStack.length = 0;
    redoStack.length = 0;
    disk.clear();
    disk.set("/w/a.txt", "foo foo").set("/w/sub/b.md", "a foo");
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.mocked(api.replacePreview).mockImplementation(async () => plan());
    // Like the backend: replaces in the asked paths, returns the text.
    vi.mocked(api.replaceApply).mockImplementation(async (r, paths, keep) => ({
      changed: paths.map(p => {
        const before = disk.get(p)!;
        const after = before.split(r.query).join(r.replacement);
        disk.set(p, after);
        return changed(p, keep ? before : null, keep ? after : null, before.split(r.query).length - 1);
      }),
      skipped: [],
      cancelled: false,
    }));
    vi.mocked(api.readText).mockImplementation(async p => disk.get(p) ?? "");
    vi.mocked(api.rewriteText).mockImplementation(async (p, content) => {
      if (!disk.has(p)) throw new Error("No such file or directory");
      disk.set(p, content);
    });
  });

  it("previews, asks, replaces with one case rule, and undoes as one step", async () => {
    answer("foo", "bar");
    dialogs.showConfirm.mockResolvedValueOnce(true);
    await run();

    expect(api.replacePreview).toHaveBeenCalledWith(req, expect.any(String));
    expect(dialogs.showConfirm.mock.calls[0][0]!.message).toContain("• sub/b.md (1)");
    expect(api.replaceApply).toHaveBeenCalledWith(req, ["/w/a.txt", "/w/sub/b.md"], true, expect.any(String));
    expect(dialogs.showToast).toHaveBeenCalledWith({ message: "replaced 3 matches in 2 files", variant: "success" });
    expect(ctx.refresh).toHaveBeenCalled();
    expect(disk.get("/w/a.txt")).toBe("bar bar");

    expect(undoStack.map(e => e.label)).toEqual([`replace "foo" in 2 files`]);
    expect((await undoLast()).status).toBe("done");
    expect([...disk.values()]).toEqual(["foo foo", "a foo"]);
    expect((await redoLast()).status).toBe("done");
    expect([...disk.values()]).toEqual(["bar bar", "a bar"]);
  });

  it("undo leaves every file alone when one was edited since", async () => {
    answer("foo", "bar");
    dialogs.showConfirm.mockResolvedValueOnce(true);
    await run();
    disk.set("/w/sub/b.md", "a bar, edited");
    const r = await undoLast();
    expect(r.status).toBe("failed");
    expect(disk.get("/w/a.txt")).toBe("bar bar");
    expect(api.rewriteText).not.toHaveBeenCalled();
  });

  it("writes nothing when the confirm is cancelled", async () => {
    answer("foo", "bar");
    await run();
    expect(api.replaceApply).not.toHaveBeenCalled();
    expect(undoStack).toHaveLength(0);
  });

  it("says so when there's nothing it can change", async () => {
    vi.mocked(api.replacePreview).mockResolvedValueOnce(plan({ files: [], skipped: [{ path: "/w/l.txt", reason: "not UTF-8 text" }] }));
    answer("foo", "bar");
    await run();
    expect(dialogs.showConfirm).not.toHaveBeenCalled();
    expect(dialogs.showAlert.mock.calls[0][0]!.message).toContain("• l.txt: not UTF-8 text");
  });

  it("marks a replace too large to keep irreversible", async () => {
    vi.mocked(api.replacePreview).mockResolvedValueOnce(plan({ undoable: false }));
    answer("foo", "bar");
    dialogs.showConfirm.mockResolvedValueOnce(true);
    await run();
    expect(dialogs.showConfirm.mock.calls[0][0]!.message).toContain("can't be undone");
    expect(api.replaceApply).toHaveBeenCalledWith(req, ["/w/a.txt", "/w/sub/b.md"], false, expect.any(String));
    expect(undoStack.map(e => [e.label, e.irreversible])).toEqual([[`replace "foo" in 2 files`, true]]);
    expect((await undoLast()).status).toBe("irreversible");
  });

  it("reports files left alone and a cancel, and undoes what was done", async () => {
    vi.mocked(api.replaceApply).mockImplementationOnce(async () => {
      disk.set("/w/a.txt", "bar bar");
      return { changed: [changed("/w/a.txt", "foo foo", "bar bar", 2)], skipped: [], cancelled: true };
    });
    answer("foo", "bar");
    dialogs.showConfirm.mockResolvedValueOnce(true);
    await run();
    expect(dialogs.showToast).not.toHaveBeenCalled();
    const alert = dialogs.showAlert.mock.calls[0][0]!;
    expect(alert.variant).toBe("warning");
    expect(alert.message).toBe("Replaced 2 matches in 1 file.\n\nCancelled with 1 file not reached.");
    expect(undoStack.map(e => e.label)).toEqual([`replace "foo" in 1 file`]);
    await undoLast();
    expect(disk.get("/w/a.txt")).toBe("foo foo");
  });

  it("pushes nothing when no file was changed", async () => {
    vi.mocked(api.replaceApply).mockResolvedValueOnce({
      changed: [], skipped: [{ path: "/w/a.txt", reason: "read-only" }], cancelled: false,
    });
    answer("foo", "bar");
    dialogs.showConfirm.mockResolvedValueOnce(true);
    await run();
    expect(undoStack).toHaveLength(0);
    expect(dialogs.showAlert.mock.calls[0][0]!.message).toContain("• a.txt: read-only");
  });

  it("stops quietly on a cancelled search, and alerts on a failed one", async () => {
    vi.mocked(api.replacePreview).mockRejectedValueOnce("cancelled");
    answer("foo", "bar");
    await run();
    expect(dialogs.showAlert).not.toHaveBeenCalled();

    vi.mocked(api.replacePreview).mockRejectedValueOnce("the search text can't span lines");
    answer("foo", "bar");
    await run();
    expect(dialogs.showAlert.mock.calls[0][0]).toMatchObject({ title: "find failed", variant: "error" });
    expect(api.replaceApply).not.toHaveBeenCalled();
  });
});
