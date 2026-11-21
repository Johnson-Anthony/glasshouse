// @vitest-environment happy-dom
// useTabLayout with a stand-in for each tab's live state: which window saves
// the session and what it saves for a split, and a tab keeping its state
// (the same TabShell) when it moves between panes.
import { act, useMemo, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadSession, SESSION_KEY } from "./session";
import { closeSplit, findTab, moveTabTo, single, splitWithTab } from "./tabLayout";
import type { TabSeed } from "./state";
import { makeTab } from "./tabs";
import { useTabLayout, type TabLayoutApi } from "./useTabLayout";

/** How many tab states have mounted: a tab that moves keeps its own. */
let mounts = 0;

vi.mock("./state", async (orig) => ({
  ...(await orig<typeof import("./state")>()),
  useTabState: (initialPath: string, isPrivate = false, _active = true, initialSort?: { key: string; dir: string }, seed?: TabSeed) => {
    const [path, setPath] = useState(initialPath);
    const [back, setBack] = useState<string[]>(seed?.back ?? []);
    const [showHidden, setShowHidden] = useState(false);
    const [searchQuery, setSearchQuery] = useState(seed?.search ?? "");
    useState(() => ++mounts);
    return useMemo(() => ({
      state: {
        path, private: isPrivate, showHidden, sortKey: initialSort?.key ?? "name", sortDir: initialSort?.dir ?? "asc", entries: [],
        historyBack: back, historyForward: seed?.forward ?? [], searchQuery, tagFilter: seed?.tagFilter ?? null,
      },
      actions: {
        goTo: (p: string) => { setBack(b => [...b, path]); setPath(p); },
        setShowHidden,
        setSearchQuery,
      },
    }), [path, back, showHidden, searchQuery]);
  },
}));

const reports = vi.hoisted(() => [] as unknown[]);
vi.mock("./api", async (orig) => ({
  ...(await orig<typeof import("./api")>()),
  sessionReport: (s: unknown) => { reports.push(s); return Promise.resolve(); },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
let api: TabLayoutApi;

function Harness({ hidden = false }: { hidden?: boolean }) {
  api = useTabLayout(() => "/home", hidden);
  return api.shells;
}

const render = (hidden = false) => act(() => root.render(<Harness hidden={hidden} />));
const start = (paths: string[], owner = true, opts: { private?: boolean }[] = []) =>
  act(() => api.start(single(paths.map((p, i) => makeTab(p, opts[i]))), owner));
const update = (fn: Parameters<TabLayoutApi["update"]>[0]) => act(() => api.update(fn));
const saved = () => JSON.parse(localStorage.getItem(SESSION_KEY) ?? "null");

beforeEach(() => {
  localStorage.clear();
  reports.length = 0;
  mounts = 0;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("useTabLayout", () => {
  it("the owner saves a split with the second pane's tabs flagged", async () => {
    await render();
    start(["/a", "/b", "/c"]);
    update(l => splitWithTab(l, { pane: 0, index: 2 }, "right"));
    expect(saved()).toEqual({
      tabs: [
        { path: "/a", sort: { key: "name", dir: "asc" } },
        { path: "/b", sort: { key: "name", dir: "asc" } },
        { path: "/c", sort: { key: "name", dir: "asc" }, pane: 1 },
      ],
      active: 2,
      split: { other: 0, dir: "row", ratio: 0.5 },
    });
    // And reads back as the same split.
    expect(loadSession()?.split).toEqual({ other: 0, dir: "row", ratio: 0.5 });

    update(closeSplit);
    expect(saved().split).toBeUndefined();
    expect(saved().tabs).toHaveLength(3);
  });

  it("a window that doesn't own the session leaves the v1 key alone, and reports its tabs", async () => {
    await render();
    start(["/a", "/b"], false);
    update(l => splitWithTab(l, { pane: 0, index: 1 }, "bottom"));
    expect(localStorage.getItem(SESSION_KEY)).toBeNull();
    expect(reports).toEqual([
      { tabs: [{ path: "/a", sort: { key: "name", dir: "asc" } }, { path: "/b", sort: { key: "name", dir: "asc" } }], active: 0 },
      {
        tabs: [{ path: "/a", sort: { key: "name", dir: "asc" } }, { path: "/b", sort: { key: "name", dir: "asc" }, pane: 1 }],
        active: 1,
        split: { other: 0, dir: "column", ratio: 0.5 },
      },
    ]);
  });

  it("reports each change once, and nothing before the tabs are known", async () => {
    await render();
    expect(reports).toEqual([]);
    start(["/a"]);
    await render();
    await render(true);
    expect(reports).toHaveLength(1);
    const id = api.layout.panes[0].tabs[0].id;
    act(() => api.handles[id].actions.goTo("/a/b"));
    expect(reports).toHaveLength(2);
    expect((reports[1] as { tabs: { path: string }[] }).tabs[0].path).toBe("/a/b");
  });

  it("a window with only private tabs reports none", async () => {
    await render();
    start(["/secret"], true, [{ private: true }]);
    expect(reports).toEqual([{ tabs: [], active: 0 }]);
  });

  it("only the owner's focused window writes the v1 key, and one that takes the focus writes its own", async () => {
    const focus = vi.spyOn(document, "hasFocus").mockReturnValue(false);
    try {
      await render();
      start(["/a"]);
      expect(reports).toHaveLength(1);
      expect(localStorage.getItem(SESSION_KEY)).toBeNull();
      // Another window wrote its tabs there meanwhile.
      localStorage.setItem(SESSION_KEY, JSON.stringify({ tabs: [{ path: "/other", sort: { key: "name", dir: "asc" } }], active: 0 }));
      focus.mockReturnValue(true);
      act(() => { window.dispatchEvent(new Event("focus")); });
      expect(saved().tabs.map((t: { path: string }) => t.path)).toEqual(["/a"]);
    } finally {
      focus.mockRestore();
    }
  });

  it("saves where a tab has gone since, not where it opened", async () => {
    await render();
    start(["/a", "/b"]);
    const id = api.layout.panes[0].tabs[1].id;
    act(() => api.handles[id].actions.goTo("/b/deeper"));
    expect(saved().tabs[1].path).toBe("/b/deeper");
  });

  it("a private tab alone in a pane saves as no split", async () => {
    await render();
    start(["/a", "/secret"], true, [{}, { private: true }]);
    update(l => splitWithTab(l, { pane: 0, index: 1 }, "right"));
    expect(saved()).toEqual({ tabs: [{ path: "/a", sort: { key: "name", dir: "asc" } }], active: 0 });
  });

  it("a tab moved to the other pane keeps its live state", async () => {
    await render();
    start(["/a", "/b", "/c"]);
    const id = api.layout.panes[0].tabs[1].id;
    act(() => api.handles[id].actions.goTo("/b/inner"));
    const before = mounts;
    update(l => splitWithTab(l, findTab(l, id)!, "right"));
    update(l => moveTabTo(l, findTab(l, id)!, { pane: 0, gap: 0 }));
    expect(api.layout.panes.map(p => p.tabs.map(t => t.id))[0][0]).toBe(id);
    expect(api.handles[id].state.path).toBe("/b/inner");
    expect(mounts).toBe(before);
  });

  it("focus picks the tabs and the handle the menus act on", async () => {
    await render();
    start(["/a", "/b"]);
    update(l => splitWithTab(l, { pane: 0, index: 1 }, "right"));
    expect(api.activeHandle?.state.path).toBe("/b");
    act(() => api.focusPane(0));
    expect(api.activeHandle?.state.path).toBe("/a");
    expect(api.tabs.map(t => t.initialPath)).toEqual(["/a"]);
    expect(api.shownHandle(1)?.state.path).toBe("/b");
  });

  it("a pane's + opens a tab on that pane's folder, in that pane", async () => {
    await render();
    start(["/a", "/b"]);
    update(l => splitWithTab(l, { pane: 0, index: 1 }, "right"));
    act(() => api.focusPane(0));
    act(() => api.openNewTab(1));
    expect(api.layout.panes[1].tabs.map(t => t.initialPath)).toEqual(["/b", "/b"]);
    expect(api.layout.focus).toBe(0);
  });

  it("Duplicate Tab copies the tab's folder, sort, history and filter text, in its pane", async () => {
    await render();
    act(() => api.start(single([makeTab("/a", { sort: { key: "size", dir: "desc" } }), makeTab("/b")]), true));
    const id = api.layout.panes[0].tabs[0].id;
    act(() => api.handles[id].actions.goTo("/a/x"));
    act(() => (api.handles[id].actions as unknown as { setSearchQuery: (q: string) => void }).setSearchQuery("notes"));
    act(() => api.duplicateTabAt(0, 0));
    const copy = api.layout.panes[0].tabs[2];
    const h = api.handles[copy.id];
    expect(h.state.path).toBe("/a/x");
    expect(h.state.historyBack).toEqual(["/a"]);
    expect(h.state.searchQuery).toBe("notes");
    expect([h.state.sortKey, h.state.sortDir]).toEqual(["size", "desc"]);
    // Its own history from here: the original's doesn't change with it.
    act(() => h.actions.goTo("/a/x/y"));
    expect(api.handles[id].state.historyBack).toEqual(["/a"]);
  });

  it("closing a split pane's last tab unsplits; every shown tab follows Show Hidden", async () => {
    await render();
    start(["/a", "/b"]);
    update(l => splitWithTab(l, { pane: 0, index: 1 }, "right"));
    await render(true);
    expect([0, 1].map(p => api.shownHandle(p)?.state.showHidden)).toEqual([true, true]);
    act(() => api.closeTabAt(0, 1));
    expect(api.layout.panes).toHaveLength(1);
    expect(Object.keys(api.handles)).toHaveLength(1);
  });
});
