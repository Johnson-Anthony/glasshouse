import { describe, expect, it } from "vitest";
import {
  addTab, allTabs, clampRatio, closeOthersIn, closeSplit, closeTabIn, DEFAULT_RATIO, findTab, isSplit, landTab, layoutFromSession,
  moveTabTo, relabel, removeTab, setActive, setDir, setFocus, setRatio, shownIds, single, splitWithNew, splitWithTab,
  swapPanes, tabCount, type Layout,
} from "./tabLayout";
import { makeTab } from "./tabs";

/** A layout from tab paths: one list per pane. */
const of = (panes: string[][], focus = 0, active: number[] = panes.map(() => 0)): Layout => ({
  panes: panes.map((p, i) => ({ tabs: p.map(path => makeTab(path)), active: active[i] })),
  focus,
  dir: "row",
  ratio: DEFAULT_RATIO,
});
const paths = (l: Layout) => l.panes.map(p => p.tabs.map(t => t.initialPath));
const shown = (l: Layout) => l.panes.map(p => p.tabs[p.active]?.initialPath);

describe("single", () => {
  it("is one pane, focused, unsplit", () => {
    const l = single([makeTab("/a"), makeTab("/b")], 1);
    expect(isSplit(l)).toBe(false);
    expect(l.focus).toBe(0);
    expect(shown(l)).toEqual(["/b"]);
    expect(tabCount(l)).toBe(2);
  });
});

describe("setActive and setFocus", () => {
  it("shows a tab and focuses its pane", () => {
    const l = setActive(of([["/a"], ["/b", "/c"]]), 1, 1);
    expect(l.focus).toBe(1);
    expect(shown(l)).toEqual(["/a", "/c"]);
  });

  it("ignores a pane or tab that isn't there", () => {
    const l = of([["/a"], ["/b"]]);
    expect(setActive(l, 2, 0)).toBe(l);
    expect(setFocus(l, -1)).toBe(l);
    expect(setActive(l, 1, 5).focus).toBe(1);
  });
});

describe("addTab", () => {
  it("adds at the end, shown and focused", () => {
    const l = addTab(of([["/a"], ["/b"]]), 1, makeTab("/n"));
    expect(paths(l)).toEqual([["/a"], ["/b", "/n"]]);
    expect(shown(l)).toEqual(["/a", "/n"]);
    expect(l.focus).toBe(1);
  });

  it("adds at a spot without showing it, and the shown tab stays", () => {
    const l = addTab(of([["/a", "/b"]], 0, [1]), 0, makeTab("/n"), 0, false);
    expect(paths(l)).toEqual([["/n", "/a", "/b"]]);
    expect(shown(l)).toEqual(["/b"]);
  });

  it("takes a pane that isn't there as the focused one", () => {
    const l = addTab(of([["/a"], ["/b"]], 1), 7, makeTab("/n"));
    expect(paths(l)).toEqual([["/a"], ["/b", "/n"]]);
  });
});

describe("closeTabIn", () => {
  it("in a split, a pane whose last tab closes goes, and the focus moves to the other", () => {
    const l = closeTabIn(of([["/a"], ["/b"]], 1), 1, 0, "/home");
    expect(isSplit(l)).toBe(false);
    expect(paths(l)).toEqual([["/a"]]);
    expect(l.focus).toBe(0);
  });

  it("unsplit, the last tab is replaced at the fallback", () => {
    const l = closeTabIn(of([["/a"]]), 0, 0, "/home");
    expect(paths(l)).toEqual([["/home"]]);
  });

  it("keeps the focus on its pane when the other one goes", () => {
    const l = closeTabIn(of([["/a"], ["/b", "/c"]], 1), 0, 0, "/home");
    expect(paths(l)).toEqual([["/b", "/c"]]);
    expect(l.focus).toBe(0);
  });

  it("closeOthersIn keeps one tab of that pane only", () => {
    const l = closeOthersIn(of([["/a", "/b", "/c"], ["/d"]]), 0, 1);
    expect(paths(l)).toEqual([["/b"], ["/d"]]);
  });
});

describe("removeTab", () => {
  it("takes a tab out, and an emptied pane with it", () => {
    const l = of([["/a", "/b"], ["/c"]]);
    const id = l.panes[1].tabs[0].id;
    expect(paths(removeTab(l, id)!)).toEqual([["/a", "/b"]]);
  });

  it("is null for the window's only tab, or a tab that isn't there", () => {
    const l = of([["/a"]]);
    expect(removeTab(l, l.panes[0].tabs[0].id)).toBeNull();
    expect(removeTab(of([["/a", "/b"]]), -1)).toBeNull();
  });
});

describe("moveTabTo", () => {
  it("reorders within a pane: the gap is counted before the move", () => {
    const l = of([["/a", "/b", "/c"]]);
    expect(paths(moveTabTo(l, { pane: 0, index: 0 }, { pane: 0, gap: 2 }))).toEqual([["/b", "/a", "/c"]]);
    expect(paths(moveTabTo(l, { pane: 0, index: 0 }, { pane: 0, gap: 3 }))).toEqual([["/b", "/c", "/a"]]);
    expect(paths(moveTabTo(l, { pane: 0, index: 2 }, { pane: 0, gap: 0 }))).toEqual([["/c", "/a", "/b"]]);
    // Dropped next to itself: nothing moves.
    expect(paths(moveTabTo(l, { pane: 0, index: 1 }, { pane: 0, gap: 1 }))).toEqual([["/a", "/b", "/c"]]);
    expect(paths(moveTabTo(l, { pane: 0, index: 1 }, { pane: 0, gap: 2 }))).toEqual([["/a", "/b", "/c"]]);
  });

  it("the moved tab is shown, and its pane focused", () => {
    const l = moveTabTo(of([["/a", "/b"], ["/c"]]), { pane: 0, index: 1 }, { pane: 1, gap: 0 });
    expect(paths(l)).toEqual([["/a"], ["/b", "/c"]]);
    expect(shown(l)).toEqual(["/a", "/b"]);
    expect(l.focus).toBe(1);
  });

  it("goes to the end without a gap", () => {
    const l = moveTabTo(of([["/a", "/b"], ["/c"]]), { pane: 0, index: 0 }, { pane: 1 });
    expect(paths(l)).toEqual([["/b"], ["/c", "/a"]]);
  });

  it("a pane's last tab moving out unsplits the window", () => {
    const l = moveTabTo(of([["/a"], ["/b", "/c"]], 0), { pane: 0, index: 0 }, { pane: 1, gap: 1 });
    expect(isSplit(l)).toBe(false);
    expect(paths(l)).toEqual([["/b", "/a", "/c"]]);
    expect(shown(l)).toEqual(["/a"]);
    expect(l.focus).toBe(0);
  });

  it("keeps the tab's id, so its state moves with it", () => {
    const l = of([["/a", "/b"], ["/c"]]);
    const id = l.panes[0].tabs[1].id;
    expect(findTab(moveTabTo(l, { pane: 0, index: 1 }, { pane: 1 }), id)).toEqual({ pane: 1, index: 1 });
  });

  it("ignores places that aren't there", () => {
    const l = of([["/a"]]);
    expect(moveTabTo(l, { pane: 0, index: 3 }, { pane: 0 })).toBe(l);
    expect(moveTabTo(l, { pane: 0, index: 0 }, { pane: 1 })).toBe(l);
  });
});

describe("splitting", () => {
  it("splitWithNew opens the new tab beside, or below, and focuses it", () => {
    const base = of([["/a", "/b"]], 0, [1]);
    const row = splitWithNew(base, makeTab("/b"), "row");
    expect(paths(row)).toEqual([["/a", "/b"], ["/b"]]);
    expect(row.dir).toBe("row");
    expect(row.focus).toBe(1);
    expect(shown(row)).toEqual(["/b", "/b"]);
    expect(splitWithNew(base, makeTab("/b"), "column").dir).toBe("column");
  });

  it("a split window splits no further", () => {
    const l = of([["/a"], ["/b"]]);
    expect(splitWithNew(l, makeTab("/x"), "row")).toBe(l);
    expect(splitWithTab(l, { pane: 0, index: 0 }, "right")).toBe(l);
  });

  it("splitWithTab moves the tab into a new pane on that side", () => {
    const l = of([["/a", "/b", "/c"]], 0, [2]);
    const right = splitWithTab(l, { pane: 0, index: 1 }, "right");
    expect(paths(right)).toEqual([["/a", "/c"], ["/b"]]);
    expect([right.dir, right.focus]).toEqual(["row", 1]);
    const left = splitWithTab(l, { pane: 0, index: 1 }, "left");
    expect(paths(left)).toEqual([["/b"], ["/a", "/c"]]);
    expect([left.dir, left.focus]).toEqual(["row", 0]);
    expect(splitWithTab(l, { pane: 0, index: 0 }, "top").dir).toBe("column");
    expect(paths(splitWithTab(l, { pane: 0, index: 0 }, "bottom"))).toEqual([["/b", "/c"], ["/a"]]);
  });

  it("the pane's only tab can't split off", () => {
    const l = of([["/a"]]);
    expect(splitWithTab(l, { pane: 0, index: 0 }, "right")).toBe(l);
  });
});

describe("landTab", () => {
  it("a tab from another window goes into a tab bar at the gap, shown and focused", () => {
    const l = of([["/a", "/b"], ["/c"]], 0, [1, 0]);
    const t = makeTab("/x");
    const got = landTab(l, t, { kind: "bar", pane: 1, gap: 0 });
    expect(paths(got)).toEqual([["/a", "/b"], ["/x", "/c"]]);
    expect(got.focus).toBe(1);
    expect(shown(got)).toEqual(["/b", "/x"]);
    expect(findTab(got, t.id)).toEqual({ pane: 1, index: 0 });
  });

  it("the outer quarter of an unsplit window splits with it on that side", () => {
    const l = of([["/a"]]);
    const right = landTab(l, makeTab("/x"), { kind: "split", side: "right" });
    expect(paths(right)).toEqual([["/a"], ["/x"]]);
    expect([right.dir, right.focus]).toEqual(["row", 1]);
    const top = landTab(l, makeTab("/x"), { kind: "split", side: "top" });
    expect(paths(top)).toEqual([["/x"], ["/a"]]);
    expect([top.dir, top.focus]).toEqual(["column", 0]);
  });

  it("the middle of a pane, or nowhere, puts it after that pane's tabs", () => {
    const l = of([["/a"], ["/b"]], 0);
    expect(paths(landTab(l, makeTab("/x"), { kind: "pane", pane: 1 }))).toEqual([["/a"], ["/b", "/x"]]);
    expect(paths(landTab(l, makeTab("/x"), null))).toEqual([["/a", "/x"], ["/b"]]);
  });

  it("where the window changed meanwhile, after the focused pane's tabs", () => {
    // Split since the backend answered: it splits no further.
    const l = of([["/a"], ["/b"]], 1);
    expect(paths(landTab(l, makeTab("/x"), { kind: "split", side: "left" }))).toEqual([["/a"], ["/b", "/x"]]);
    // Unsplit since: the second pane is gone.
    expect(paths(landTab(of([["/a"]]), makeTab("/x"), { kind: "bar", pane: 1, gap: 0 }))).toEqual([["/a", "/x"]]);
  });
});

describe("closeSplit", () => {
  it("puts the second pane's tabs after the first's; the focused shown tab stays", () => {
    const l = of([["/a", "/b"], ["/c", "/d"]], 1, [0, 1]);
    const c = closeSplit(l);
    expect(isSplit(c)).toBe(false);
    expect(paths(c)).toEqual([["/a", "/b", "/c", "/d"]]);
    expect(shown(c)).toEqual(["/d"]);
    expect(shown(closeSplit({ ...l, focus: 0 }))).toEqual(["/a"]);
    expect(allTabs(c).map(t => t.id)).toEqual(allTabs(l).map(t => t.id));
  });

  it("does nothing unsplit", () => {
    const l = of([["/a"]]);
    expect(closeSplit(l)).toBe(l);
  });
});

describe("swapPanes, setDir, setRatio", () => {
  it("swap keeps the focus on the same tabs, and mirrors the ratio", () => {
    const l = { ...of([["/a"], ["/b"]], 1), ratio: 0.3 };
    const s = swapPanes(l);
    expect(paths(s)).toEqual([["/b"], ["/a"]]);
    expect(s.focus).toBe(0);
    expect(s.ratio).toBeCloseTo(0.7);
  });

  it("setDir and setRatio return the same layout when nothing changes", () => {
    const l = of([["/a"], ["/b"]]);
    expect(setDir(l, "row")).toBe(l);
    expect(setDir(l, "column").dir).toBe("column");
    expect(setRatio(l, DEFAULT_RATIO)).toBe(l);
  });

  it("the ratio stays where both panes can be seen", () => {
    expect(clampRatio(0)).toBe(0.15);
    expect(clampRatio(1)).toBe(0.85);
    expect(clampRatio(0.4)).toBe(0.4);
    expect(clampRatio(NaN)).toBe(DEFAULT_RATIO);
    expect(clampRatio("0.4")).toBe(DEFAULT_RATIO);
  });
});

describe("relabel", () => {
  it("sets one tab's label, and is a no-op when it's the same", () => {
    const l = of([["/a"], ["/b"]]);
    const id = l.panes[1].tabs[0].id;
    const r = relabel(l, id, "/b/c");
    expect(r.panes[1].tabs[0].label).toBe("/b/c");
    expect(relabel(r, id, "/b/c")).toBe(r);
    expect(relabel(l, -1, "x")).toBe(l);
  });
});

describe("shownIds", () => {
  it("lists each pane's shown tab", () => {
    const l = of([["/a", "/b"], ["/c"]], 0, [1, 0]);
    expect(shownIds(l)).toEqual([l.panes[0].tabs[1].id, l.panes[1].tabs[0].id]);
  });
});

describe("layoutFromSession", () => {
  type Saved = { path: string; pane?: 1 };
  const make = (t: Saved) => makeTab(t.path);

  it("unsplit: one pane with the saved shown tab", () => {
    const l = layoutFromSession<Saved>({ tabs: [{ path: "/a" }, { path: "/b" }], active: 1 }, make);
    expect(paths(l)).toEqual([["/a", "/b"]]);
    expect(shown(l)).toEqual(["/b"]);
  });

  it("split: panes from the pane flags, the focus from `active`, the other's shown tab from `other`", () => {
    const l = layoutFromSession<Saved>({
      tabs: [{ path: "/a" }, { path: "/b" }, { path: "/c", pane: 1 as const }, { path: "/d", pane: 1 as const }],
      active: 3,
      split: { other: 1, dir: "column", ratio: 0.4 },
    }, make);
    expect(paths(l)).toEqual([["/a", "/b"], ["/c", "/d"]]);
    expect(l.focus).toBe(1);
    expect(shown(l)).toEqual(["/b", "/d"]);
    expect([l.dir, l.ratio]).toEqual(["column", 0.4]);
  });

  it("makes the records in saved order", () => {
    const seen: number[] = [];
    layoutFromSession<Saved>({ tabs: [{ path: "/a", pane: 1 as const }, { path: "/b" }], active: 1, split: { other: 0, dir: "row", ratio: 0.5 } }, (t, i) => {
      seen.push(i);
      return make(t);
    });
    expect(seen).toEqual([0, 1]);
  });
});
