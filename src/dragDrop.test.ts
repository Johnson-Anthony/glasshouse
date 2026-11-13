// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DropHighlight, HANDOFF_GRACE_MS, clearHandOff, dragCopies, dropTargetOf, handOffCopies, leftWindow, notAlreadyIn,
  recordHandOff,
} from "./dragDrop";
import { osDropPlan } from "./OsDrop";
import { pathOps } from "./paths";

describe("leftWindow", () => {
  it("is true at or past any edge, false inside", () => {
    expect(leftWindow(400, 300, 800, 600)).toBe(false);
    expect(leftWindow(1, 1, 800, 600)).toBe(false);
    for (const [x, y] of [[0, 300], [-5, 300], [400, 0], [400, -1], [799, 300], [900, 300], [400, 599], [400, 700]]) {
      expect(leftWindow(x, y, 800, 600)).toBe(true);
    }
  });
});

describe("dragCopies", () => {
  it("copies with Ctrl or Cmd and moves otherwise, Shift included", () => {
    expect(dragCopies({ ctrlKey: true, metaKey: false })).toBe(true);
    expect(dragCopies({ ctrlKey: false, metaKey: true })).toBe(true);
    expect(dragCopies({ ctrlKey: false, metaKey: false })).toBe(false);
    expect(dragCopies({ ctrlKey: false, metaKey: false, shiftKey: true } as KeyboardEvent)).toBe(false);
  });
});

describe("notAlreadyIn", () => {
  const posix = pathOps(false), win = pathOps(true);
  it("drops what's already in the folder, and the folder itself", () => {
    const paths = ["/w/a.txt", "/w/sub", "/x/b.txt", "/w"];
    expect(notAlreadyIn(paths, "/w", posix)).toEqual(["/x/b.txt"]);
    expect(notAlreadyIn(paths, "/w/", posix)).toEqual(["/x/b.txt"]);
    expect(notAlreadyIn(paths, "/w/sub", posix)).toEqual(["/w/a.txt", "/x/b.txt", "/w"]);
  });
  it("compares Windows paths without case and either separator", () => {
    expect(notAlreadyIn(["C:\\Users\\a.txt", "D:\\b.txt"], "c:/users", win)).toEqual(["D:\\b.txt"]);
  });
});

describe("drop targets", () => {
  document.body.innerHTML = `
    <section class="pane" data-drop-path="/w">
      <div class="row" data-orig="0" data-drop-path="/w/sub"><span class="name">sub</span></div>
      <div class="row" data-orig="1"><span class="name">a.txt</span></div>
    </section>
    <div class="tab" data-drop-path="/x"><span class="label">x</span></div>
    <span class="crumb">no path</span>`;
  const q = (s: string) => document.querySelector(s);

  it("finds the nearest element that takes a drop", () => {
    expect(dropTargetOf(q('[data-orig="0"] .name'))?.path).toBe("/w/sub");
    expect(dropTargetOf(q('[data-orig="1"] .name'))?.path).toBe("/w");
    expect(dropTargetOf(q(".tab .label"))?.path).toBe("/x");
    expect(dropTargetOf(q(".crumb"))).toBeNull();
    expect(dropTargetOf(null)).toBeNull();
  });

  it("plans a copy from another app, or nothing when it would change nothing", () => {
    const tab = dropTargetOf(q(".tab"));
    expect(osDropPlan(["/home/u/Downloads/r.pdf"], tab)).toEqual({ paths: ["/home/u/Downloads/r.pdf"], dir: "/x", copy: true, label: "copy r.pdf to x" });
    expect(osDropPlan(["/d/a", "/d/b", "/x/c"], tab)?.label).toBe("copy 2 items to x");
    expect(osDropPlan(["/x/c"], tab)).toBeNull();
    expect(osDropPlan(["/d/a"], null)).toBeNull();
  });

  it("plans a move for the pane's own drag coming back", () => {
    expect(osDropPlan(["/d/a"], dropTargetOf(q(".tab")), false)).toMatchObject({ copy: false, label: "move a to x" });
  });

  it("highlights one element at a time", () => {
    const h = new DropHighlight();
    const a = q(".tab") as HTMLElement, b = q(".pane") as HTMLElement;
    h.set(a);
    h.set(b);
    expect(a.classList.contains("drop-target")).toBe(false);
    expect(b.classList.contains("drop-target")).toBe(true);
    h.set(null);
    expect(document.querySelectorAll(".drop-target").length).toBe(0);
  });
});

describe("a drag handed to the OS", () => {
  afterEach(() => { clearHandOff(); vi.useRealTimers(); });
  const move = (buttons: number) => window.dispatchEvent(new PointerEvent("pointermove", { buttons }));

  it("is recognised by exactly its paths, in any order, with the Ctrl state at the handoff", () => {
    recordHandOff(["/w/a.txt", "/w/b.txt"], false);
    expect(handOffCopies(["/w/b.txt", "/w/a.txt"])).toBe(false);
    expect(handOffCopies(["/w/a.txt"])).toBeNull();
    expect(handOffCopies(["/w/a.txt", "/w/b.txt", "/w/c.txt"])).toBeNull();
    expect(handOffCopies(["/w/a.txt", "/x/b.txt"])).toBeNull();
    recordHandOff(["/w/a.txt"], true);
    expect(handOffCopies(["/w/a.txt"])).toBe(true);
    clearHandOff();
    expect(handOffCopies(["/w/a.txt"])).toBeNull();
  });

  it("is forgotten at a press in the window or when the window loses focus", () => {
    recordHandOff(["/w/a.txt"], false);
    window.dispatchEvent(new PointerEvent("pointerdown"));
    expect(handOffCopies(["/w/a.txt"])).toBeNull();
    recordHandOff(["/w/a.txt"], false);
    window.dispatchEvent(new Event("blur"));
    expect(handOffCopies(["/w/a.txt"])).toBeNull();
  });

  it("outlasts the pointer's return on release by a moment, then is forgotten", () => {
    vi.useFakeTimers();
    recordHandOff(["/w/a.txt"], false);
    move(1);
    vi.advanceTimersByTime(HANDOFF_GRACE_MS * 2);
    expect(handOffCopies(["/w/a.txt"])).toBe(false);
    move(0);
    vi.advanceTimersByTime(HANDOFF_GRACE_MS - 1);
    move(0);
    expect(handOffCopies(["/w/a.txt"])).toBe(false);
    vi.advanceTimersByTime(1);
    expect(handOffCopies(["/w/a.txt"])).toBeNull();
  });

  it("isn't forgotten by the grace period of a handoff it replaced", () => {
    vi.useFakeTimers();
    recordHandOff(["/w/a.txt"], false);
    move(0);
    recordHandOff(["/w/b.txt"], true);
    vi.advanceTimersByTime(HANDOFF_GRACE_MS);
    expect(handOffCopies(["/w/b.txt"])).toBe(true);
  });
});
