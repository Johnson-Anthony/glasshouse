import { describe, expect, it } from "vitest";
import { closeOtherTabs, closeTab as closeTabIn, makeTab, moveTab, tabLabel, type TabList } from "./tabs";

const list = (paths: string[], active = 0): TabList => ({ tabs: paths.map(p => makeTab(p)), active });
const paths = (l: TabList) => l.tabs.map(t => t.initialPath);
const activePath = (l: TabList) => l.tabs[l.active]?.initialPath;
const closeTab = (l: TabList, i: number) => closeTabIn(l, i, "/home/me");

describe("makeTab", () => {
  it("gives every tab a fresh id", () => {
    const ids = [makeTab("/"), makeTab("/"), makeTab("/")].map(t => t.id);
    expect(new Set(ids).size).toBe(3);
  });

  it("tabLabel marks private tabs", () => {
    expect(tabLabel("/x", false)).toBe("/x");
    expect(tabLabel("/x", true)).toBe("(private) /x");
  });

  it("labels private tabs", () => {
    const t = makeTab("/x", { private: true });
    expect(t.private).toBe(true);
    expect(t.label).toBe("(private) /x");
    expect(t.initialPath).toBe("/x");
  });
});

describe("closeTab", () => {
  it("keeps the ids of the remaining tabs", () => {
    // The original bug: closing a middle tab must not leave the closed tab's
    // state in that slot. Ids, not positions, identify a tab's state.
    const l = list(["/a", "/b", "/c"]);
    const [a, , c] = l.tabs;
    const next = closeTab(l, 1);
    expect(next.tabs.map(t => t.id)).toEqual([a.id, c.id]);
  });

  it("keeps the active tab active when another tab closes", () => {
    expect(activePath(closeTab(list(["/a", "/b", "/c"], 2), 1))).toBe("/c");
    expect(activePath(closeTab(list(["/a", "/b", "/c"], 0), 1))).toBe("/a");
  });

  it("activates the left neighbour when the active tab closes", () => {
    expect(activePath(closeTab(list(["/a", "/b", "/c"], 1), 1))).toBe("/a");
    expect(activePath(closeTab(list(["/a", "/b", "/c"], 2), 2))).toBe("/b");
  });

  it("activates the right neighbour when the first tab closes", () => {
    expect(activePath(closeTab(list(["/a", "/b"], 0), 0))).toBe("/b");
  });

  it("ignores an out-of-range index", () => {
    const l = list(["/a"]);
    expect(closeTab(l, 3)).toEqual(l);
  });

  it("replaces the last tab with a fresh one at the fallback path", () => {
    const l = list(["/a"]);
    const next = closeTab(l, 0);
    expect(next.tabs).toHaveLength(1);
    expect(next.active).toBe(0);
    expect(next.tabs[0].initialPath).toBe("/home/me");
    expect(next.tabs[0].id).not.toBe(l.tabs[0].id);
  });

  it("replaces a closed private last tab with a normal one", () => {
    const next = closeTab({ tabs: [makeTab("/a", { private: true })], active: 0 }, 0);
    expect(next.tabs[0].private).toBe(false);
  });
});

describe("closeOtherTabs", () => {
  it("keeps only that tab and activates it", () => {
    const l = list(["/a", "/b", "/c"], 0);
    const kept = l.tabs[2];
    const next = closeOtherTabs(l, 2);
    expect(next.tabs).toEqual([kept]);
    expect(next.active).toBe(0);
  });
});

describe("moveTab", () => {
  it("reorders tabs and keeps their ids", () => {
    const l = list(["/a", "/b", "/c"]);
    const next = moveTab(l, 0, 2);
    expect(paths(next)).toEqual(["/b", "/c", "/a"]);
    expect(next.tabs.map(t => t.id).sort()).toEqual(l.tabs.map(t => t.id).sort());
  });

  it("follows the active tab when it moves", () => {
    expect(activePath(moveTab(list(["/a", "/b", "/c"], 0), 0, 2))).toBe("/a");
  });

  it("follows the active tab when another tab moves past it", () => {
    // Before: only `cur === from` was handled, so this drifted to "/c".
    const next = moveTab(list(["/a", "/b", "/c"], 1), 0, 2);
    expect(paths(next)).toEqual(["/b", "/c", "/a"]);
    expect(activePath(next)).toBe("/b");
  });

  it("ignores no-op and out-of-range moves", () => {
    const l = list(["/a", "/b"]);
    expect(moveTab(l, 1, 1)).toEqual(l);
    expect(moveTab(l, 0, 5)).toEqual(l);
    expect(moveTab(l, -1, 0)).toEqual(l);
  });
});
