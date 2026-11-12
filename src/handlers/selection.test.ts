import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FileEntry } from "../api";
import * as api from "../api";
import type { UseTabResult } from "../state";
import type { HandlerCtx } from "./types";
import { selectionHandler } from "./selection";

vi.mock("../api");
const dialogs = vi.hoisted(() => ({
  showPrompt: vi.fn(async (_opts: { message?: string }): Promise<string | null> => null),
  showToast: vi.fn(),
}));
vi.mock("../dialogs/DialogHost", () => ({ dialogs }));

function entry(name: string, git: string | null = null): FileEntry {
  const dot = name.lastIndexOf(".");
  return {
    name, path: `/w/${name}`, kind: "text", size: 1, modified_ms: 0, hidden: false,
    ext: dot > 0 ? name.slice(dot + 1) : "", is_symlink: false, lossy: false, git,
  };
}

// The folder holds six files; the pane shows four of them (a filter hides
// b.ts and hidden.ts), in display order d, a, c, e.
const entries = [
  entry("a.ts", "M"), entry("b.ts", "M"), entry("c.md", "?"),
  entry("d.ts"), entry("hidden.ts", "?"), entry("e.md"),
];
const VISIBLE = [3, 0, 2, 5];

function makeCtx(selected: number[], anchorIndex = 0, focusIndex = anchorIndex) {
  const setSelected = vi.fn();
  const setFocusIndex = vi.fn();
  const handle = {
    state: { path: "/w", entries, selected, anchorIndex, focusIndex },
    actions: { setSelected, setFocusIndex },
  } as unknown as UseTabResult;
  const ctx = { activeHandle: handle, visibleRows: () => VISIBLE.slice() } as unknown as HandlerCtx;
  const picked = () => (setSelected.mock.lastCall?.[0] as number[]).map(i => entries[i].name);
  return { ctx, setSelected, setFocusIndex, picked };
}

beforeEach(() => vi.clearAllMocks());

describe("selection commands use only the visible rows", () => {
  it("Select All", async () => {
    const t = makeCtx([]);
    await selectionHandler("Select All", t.ctx);
    expect(t.picked()).toEqual(["d.ts", "a.ts", "c.md", "e.md"]);
  });

  it("Invert Selection", async () => {
    // A filtered Ctrl+I then Delete used to trash the hidden files too.
    const t = makeCtx([0]);
    await selectionHandler("Invert Selection", t.ctx);
    expect(t.picked()).toEqual(["d.ts", "c.md", "e.md"]);
  });

  it("Select by Pattern…, Regex… and Extension →", async () => {
    let t = makeCtx([]);
    dialogs.showPrompt.mockResolvedValueOnce("*.ts");
    await selectionHandler("Select by Pattern…", t.ctx);
    expect(t.picked()).toEqual(["d.ts", "a.ts"]);

    t = makeCtx([]);
    dialogs.showPrompt.mockResolvedValueOnce("^[bh]");
    await selectionHandler("Select by Regex…", t.ctx);
    expect(t.picked()).toEqual([]);

    t = makeCtx([]);
    dialogs.showPrompt.mockResolvedValueOnce("md");
    await selectionHandler("Select by Extension →", t.ctx);
    expect(t.picked()).toEqual(["c.md", "e.md"]);
  });

  it("Select by Tag → offers and picks only visible tagged rows", async () => {
    vi.mocked(api.readTags).mockResolvedValue({ "/w/b.ts": ["red"], "/w/hidden.ts": ["red"], "/w/e.md": ["blue"] });
    const t = makeCtx([]);
    dialogs.showPrompt.mockResolvedValueOnce("blue");
    await selectionHandler("Select by Tag →", t.ctx);
    expect(dialogs.showPrompt.mock.lastCall?.[0]).toMatchObject({ message: "present: blue" });
    expect(t.picked()).toEqual(["e.md"]);
  });

  it("Select Modified (Git) and Select Untracked", async () => {
    let t = makeCtx([]);
    await selectionHandler("Select Modified (Git)", t.ctx);
    expect(t.picked()).toEqual(["a.ts"]);
    t = makeCtx([]);
    await selectionHandler("Select Untracked", t.ctx);
    expect(t.picked()).toEqual(["c.md"]);
  });

  it("Extend to Line End runs from the anchor to the last row on screen", async () => {
    const t = makeCtx([0], 0);
    await selectionHandler("Extend to Line End (Visual)", t.ctx);
    expect(t.picked()).toEqual(["a.ts", "c.md", "e.md"]);
    expect(t.setFocusIndex).toHaveBeenCalledWith(5);
  });

  it("Extend to Line End starts at the focus when the anchor is hidden", async () => {
    const t = makeCtx([], 4, 2);
    await selectionHandler("Extend to Line End (Visual)", t.ctx);
    expect(t.picked()).toEqual(["c.md", "e.md"]);
  });

  it("Add Next Match takes the next visible match in display order, wrapping", async () => {
    // d.ts is selected; the next .ts on screen after it is a.ts (b.ts and
    // hidden.ts are filtered out).
    let t = makeCtx([3]);
    await selectionHandler("Add Next Match", t.ctx);
    expect(t.picked()).toEqual(["d.ts", "a.ts"]);
    // From e.md (last row) it wraps to the top: c.md.
    t = makeCtx([5]);
    await selectionHandler("Add Next Match", t.ctx);
    expect(t.picked()).toEqual(["e.md", "c.md"]);
  });
});
