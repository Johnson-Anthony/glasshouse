// @vitest-environment happy-dom
// Where a dragged tab lands (tabDrag.ts, tabMoves.ts): the hit tests, and
// the drag controller driven by pointer events. happy-dom has no layout, so
// each test gives its elements boxes and answers elementFromPoint itself.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { beginTabDrag, edgeAt, gapAt, tabDropAt, TAB_DRAG_THRESHOLD_PX, type TabDragHooks, type TabDropTarget } from "./tabDrag";
import { dropTab, tabAccepts, toOtherPane } from "./tabMoves";
import { DEFAULT_RATIO, type Layout } from "./tabLayout";
import { makeTab } from "./tabs";

const box = (left: number, top: number, width: number, height: number) =>
  ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) }) as DOMRect;

describe("gapAt", () => {
  const tabs = [box(0, 0, 100, 30), box(100, 0, 100, 30), box(200, 0, 100, 30)];
  it("is the gap before the first tab whose middle is right of x", () => {
    expect(gapAt(-10, tabs)).toBe(0);
    expect(gapAt(49, tabs)).toBe(0);
    expect(gapAt(51, tabs)).toBe(1);
    expect(gapAt(160, tabs)).toBe(2);
    expect(gapAt(260, tabs)).toBe(3);
    expect(gapAt(5, [])).toBe(0);
  });
});

describe("edgeAt", () => {
  const area = box(100, 100, 400, 200);
  it("is the nearest edge in the outer quarter, null in the middle or outside", () => {
    expect(edgeAt(110, 200, area)).toBe("left");
    expect(edgeAt(490, 200, area)).toBe("right");
    expect(edgeAt(300, 110, area)).toBe("top");
    expect(edgeAt(300, 290, area)).toBe("bottom");
    expect(edgeAt(300, 200, area)).toBeNull();
    expect(edgeAt(50, 200, area)).toBeNull();
    // Near a corner, the closer edge by share wins.
    expect(edgeAt(105, 140, area)).toBe("left");
  });
});

/** Two tab bars and two file areas, side by side, laid out by hand. */
function buildDom() {
  document.body.innerHTML = `
    <div data-tab-bar="0" id="bar0"><div data-tab-index="0" id="t00"></div><div data-tab-index="1" id="t01"></div></div>
    <div data-tab-bar="1" id="bar1"><div data-tab-index="0" id="t10"></div></div>
    <div data-tab-pane="0" id="pane0"><div class="row" id="row0"></div></div>
    <div data-tab-pane="1" id="pane1"></div>`;
  const el = (id: string) => document.getElementById(id)!;
  const boxes: Record<string, DOMRect> = {
    bar0: box(0, 0, 400, 30), t00: box(0, 0, 100, 30), t01: box(100, 0, 100, 30),
    bar1: box(400, 0, 400, 30), t10: box(400, 0, 100, 30),
    pane0: box(0, 30, 400, 400), row0: box(0, 30, 400, 20), pane1: box(400, 30, 400, 400),
  };
  for (const [id, r] of Object.entries(boxes)) el(id).getBoundingClientRect = () => r;
  // The innermost element whose box holds the point.
  const order = ["t00", "t01", "t10", "bar0", "bar1", "row0", "pane0", "pane1"];
  const at = (x: number, y: number) =>
    order.map(el).find(e => { const r = e.getBoundingClientRect(); return x >= r.left && x < r.right && y >= r.top && y < r.bottom; }) ?? null;
  document.elementFromPoint = at;
  return el;
}

describe("tabDropAt", () => {
  let el: (id: string) => HTMLElement;
  beforeEach(() => { el = buildDom(); });
  afterEach(() => { document.body.innerHTML = ""; });

  it("over a tab bar: that bar's pane and gap", () => {
    const t = tabDropAt(160, 10, true, 0);
    expect(t).toMatchObject({ kind: "bar", pane: 0, gap: 2 });
    expect(t?.el).toBe(el("bar0"));
    expect(tabDropAt(420, 10, true, 0)).toMatchObject({ kind: "bar", pane: 1, gap: 0 });
    expect(tabDropAt(700, 10, true, 0)).toMatchObject({ kind: "bar", pane: 1, gap: 1 });
  });

  it("split: the other pane's file area takes it; its own doesn't", () => {
    expect(tabDropAt(600, 200, true, 0)).toMatchObject({ kind: "pane", pane: 1 });
    expect(tabDropAt(200, 200, true, 0)).toBeNull();
  });

  it("unsplit: only the outer part of the file area, through a row too", () => {
    expect(tabDropAt(20, 200, false, 0)).toMatchObject({ kind: "edge", side: "left" });
    expect(tabDropAt(200, 35, false, 0)).toMatchObject({ kind: "edge", side: "top" });
    expect(tabDropAt(200, 230, false, 0)).toBeNull();
    expect(tabDropAt(900, 900, false, 0)).toBeNull();
  });
});

describe("beginTabDrag", () => {
  const hooks = (over: Partial<TabDragHooks> = {}): TabDragHooks => ({
    label: "/a", single: false, split: true, pane: 0,
    accepts: () => true, onDrop: vi.fn(), onWindowMove: vi.fn(), ...over,
  });
  const fire = (type: string, x: number, y: number) =>
    window.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, bubbles: true }) as PointerEvent);

  beforeEach(() => { buildDom(); });
  afterEach(() => { document.body.innerHTML = ""; document.documentElement.classList.remove("tab-dragging"); });

  it("a press that doesn't move past the threshold is a click", () => {
    const h = hooks();
    beginTabDrag({ clientX: 150, clientY: 10, button: 0 }, h);
    fire("pointermove", 150 + TAB_DRAG_THRESHOLD_PX - 1, 10);
    fire("pointerup", 150 + TAB_DRAG_THRESHOLD_PX - 1, 10);
    expect(h.onDrop).not.toHaveBeenCalled();
  });

  it("drops where it's let go, marking the spot on the way", () => {
    const h = hooks();
    beginTabDrag({ clientX: 150, clientY: 10, button: 0 }, h);
    fire("pointermove", 300, 10);
    fire("pointermove", 420, 10);
    expect(document.querySelector(".tab-insert")).not.toBeNull();
    expect(document.querySelector(".tab-ghost")?.textContent).toBe("/a");
    expect(document.documentElement.classList.contains("tab-dragging")).toBe(true);
    fire("pointerup", 420, 10);
    expect(h.onDrop).toHaveBeenCalledWith(expect.objectContaining({ kind: "bar", pane: 1, gap: 0 }));
    expect(document.querySelector(".tab-insert, .tab-ghost")).toBeNull();
    expect(document.documentElement.classList.contains("tab-dragging")).toBe(false);
  });

  it("previews and takes the other pane's file area", () => {
    const h = hooks();
    beginTabDrag({ clientX: 150, clientY: 10, button: 0 }, h);
    fire("pointermove", 600, 200);
    expect(document.querySelector(".split-preview")).not.toBeNull();
    fire("pointerup", 600, 200);
    expect(h.onDrop).toHaveBeenCalledWith(expect.objectContaining({ kind: "pane", pane: 1 }));
  });

  it("a spot that doesn't take the tab gets no mark, and no drop", () => {
    const h = hooks({ accepts: (t: TabDropTarget) => t.kind === "bar" });
    beginTabDrag({ clientX: 150, clientY: 10, button: 0 }, h);
    fire("pointermove", 600, 200);
    expect(document.querySelector(".split-preview")).toBeNull();
    fire("pointerup", 600, 200);
    expect(h.onDrop).not.toHaveBeenCalled();
  });

  it("Escape cancels, and the release after it does nothing", () => {
    const h = hooks();
    beginTabDrag({ clientX: 150, clientY: 10, button: 0 }, h);
    fire("pointermove", 420, 10);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    fire("pointerup", 420, 10);
    expect(h.onDrop).not.toHaveBeenCalled();
    expect(document.querySelector(".tab-ghost")).toBeNull();
  });

  it("let go outside the window: nothing happens", () => {
    const h = hooks();
    beginTabDrag({ clientX: 150, clientY: 10, button: 0 }, h);
    fire("pointermove", 420, 10);
    fire("pointerup", -20, 10);
    expect(h.onDrop).not.toHaveBeenCalled();
  });

  it("the window's only tab moves the window instead", () => {
    const h = hooks({ single: true });
    beginTabDrag({ clientX: 150, clientY: 10, button: 0 }, h);
    fire("pointermove", 300, 10);
    fire("pointerup", 420, 10);
    expect(h.onWindowMove).toHaveBeenCalledTimes(1);
    expect(h.onDrop).not.toHaveBeenCalled();
  });

  it("the click that ends a drag doesn't reach the tab under it", () => {
    const h = hooks();
    const clicked = vi.fn();
    document.getElementById("t10")!.addEventListener("click", clicked);
    beginTabDrag({ clientX: 150, clientY: 10, button: 0 }, h);
    fire("pointermove", 420, 10);
    fire("pointerup", 420, 10);
    document.getElementById("t10")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(clicked).not.toHaveBeenCalled();
  });

  it("only the main button drags", () => {
    const h = hooks();
    beginTabDrag({ clientX: 150, clientY: 10, button: 2 }, h);
    fire("pointermove", 420, 10);
    fire("pointerup", 420, 10);
    expect(h.onDrop).not.toHaveBeenCalled();
  });
});

describe("dropTab and toOtherPane", () => {
  const of = (panes: string[][], focus = 0): Layout => ({
    panes: panes.map(p => ({ tabs: p.map(path => makeTab(path)), active: 0 })), focus, dir: "row", ratio: DEFAULT_RATIO,
  });
  const paths = (l: Layout) => l.panes.map(p => p.tabs.map(t => t.initialPath));
  const el = document.createElement("div");

  it("an edge splits only an unsplit window, and not with its only tab", () => {
    const edge: TabDropTarget = { kind: "edge", side: "right", el };
    expect(tabAccepts(of([["/a", "/b"]]), { pane: 0, index: 0 }, edge)).toBe(true);
    expect(tabAccepts(of([["/a"]]), { pane: 0, index: 0 }, edge)).toBe(false);
    expect(tabAccepts(of([["/a", "/b"], ["/c"]]), { pane: 0, index: 0 }, edge)).toBe(false);
    expect(paths(dropTab(of([["/a", "/b"]]), { pane: 0, index: 0 }, edge))).toEqual([["/b"], ["/a"]]);
  });

  it("a pane's file area takes a tab from the other pane only", () => {
    const pane1: TabDropTarget = { kind: "pane", pane: 1, el };
    const l = of([["/a", "/b"], ["/c"]]);
    expect(tabAccepts(l, { pane: 1, index: 0 }, pane1)).toBe(false);
    expect(paths(dropTab(l, { pane: 0, index: 1 }, pane1))).toEqual([["/a"], ["/c", "/b"]]);
    expect(dropTab(l, { pane: 1, index: 0 }, pane1)).toBe(l);
  });

  it("a tab bar takes it at the gap", () => {
    const l = of([["/a", "/b"], ["/c"]]);
    expect(paths(dropTab(l, { pane: 1, index: 0 }, { kind: "bar", pane: 0, gap: 1, el }))).toEqual([["/a", "/c", "/b"]]);
  });

  it("Move to Other Pane: into the other pane, or unsplit, a new one on the right", () => {
    expect(paths(toOtherPane(of([["/a", "/b"], ["/c"]]), { pane: 1, index: 0 }))).toEqual([["/a", "/b", "/c"]]);
    expect(paths(toOtherPane(of([["/a", "/b"]]), { pane: 0, index: 0 }))).toEqual([["/b"], ["/a"]]);
    const one = of([["/a"]]);
    expect(toOtherPane(one, { pane: 0, index: 0 })).toBe(one);
    expect(toOtherPane(one, { pane: 0, index: 4 })).toBe(one);
  });
});
