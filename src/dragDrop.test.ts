// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { DropHighlight, dragCopies, dropPaths, dropTargetOf, leftWindow, notAlreadyIn } from "./dragDrop";
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

describe("dropPaths", () => {
  const posix = pathOps(false), win = pathOps(true);
  it("leaves out what's already there for a move, keeps it for a copy, never the folder itself", () => {
    const paths = ["/w/a.txt", "/w/sub", "/x/b.txt", "/w"];
    expect(dropPaths(paths, "/w", false, posix)).toEqual(["/x/b.txt"]);
    expect(dropPaths(paths, "/w", true, posix)).toEqual(["/w/a.txt", "/w/sub", "/x/b.txt"]);
    expect(dropPaths(["C:\\W\\a.txt", "c:\\w"], "C:/w", true, win)).toEqual(["C:\\W\\a.txt"]);
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

  it("copies the pane's own drag back into its folder as duplicates only with Ctrl", () => {
    const pane = dropTargetOf(q('[data-orig="1"] .name'));
    expect(osDropPlan(["/w/a.txt"], pane, true)).toEqual({ paths: ["/w/a.txt"], dir: "/w", copy: true, label: "copy a.txt to w" });
    expect(osDropPlan(["/w/a.txt"], pane, false)).toBeNull();
    expect(osDropPlan(["/w/a.txt"], pane)).toBeNull();
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
