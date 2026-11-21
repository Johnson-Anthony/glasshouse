// @vitest-environment happy-dom
// A tab moving between windows (tabMoves.ts), with the backend's events
// faked: the window that takes a tab from another window, the window it
// left, Move to New Window, and a drag handed to the OS at the window's
// edge. Each tab's live state is a stand-in, as in useTabLayout.dom.test.
import type React from "react";
import { act, useMemo, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { findTab, single, tabCount } from "./tabLayout";
import type { TabSeed } from "./state";
import { makeTab } from "./tabs";
import { afterMove, homeDrop, receiveTab, useTabMoves, type TabMoves } from "./tabMoves";
import { useTabLayout, type TabLayoutApi } from "./useTabLayout";

vi.mock("./state", async (orig) => ({
  ...(await orig<typeof import("./state")>()),
  useTabState: (initialPath: string, isPrivate = false, _active = true, initialSort?: { key: string; dir: string }, seed?: TabSeed) => {
    const [path] = useState(initialPath);
    return useMemo(() => ({
      state: {
        path, private: isPrivate, showHidden: false, sortKey: initialSort?.key ?? "name", sortDir: initialSort?.dir ?? "asc", entries: [],
        historyBack: seed?.back ?? [], historyForward: seed?.forward ?? [], searchQuery: seed?.search ?? "", tagFilter: seed?.tagFilter ?? null,
      },
      actions: { setShowHidden: () => {} },
    }), [path]);
  },
}));

/** The backend's events, by name: what the page listens to. */
const handlers = vi.hoisted(() => new Map<string, (e: { payload: unknown }) => void>());
const listenMock = vi.hoisted(() => (name: string, cb: (e: { payload: unknown }) => void) => {
  handlers.set(name, cb);
  return Promise.resolve(() => { handlers.delete(name); });
});
vi.mock("./events", () => ({ listenHere: listenMock, windowLabel: () => "main" }));
vi.mock("@tauri-apps/api/event", () => ({ listen: listenMock }));

const backend = vi.hoisted(() => ({
  zones: [] as unknown[],
  started: [] as unknown[][],
  newWindow: [] as unknown[],
  newWindowFails: false,
  closed: 0,
  reports: [] as unknown[],
}));
vi.mock("./api", async (orig) => ({
  ...(await orig<typeof import("./api")>()),
  sessionReport: (s: unknown) => { backend.reports.push(s); return Promise.resolve(); },
  tabDropZones: (z: unknown) => { backend.zones.push(z); return Promise.resolve(); },
  tabDragStart: (...args: unknown[]) => { backend.started.push(args); return Promise.resolve(); },
  tabToNewWindow: (record: unknown) => {
    backend.newWindow.push(record);
    return backend.newWindowFails ? Promise.reject(new Error("no window")) : Promise.resolve();
  },
  winClose: () => { backend.closed++; return Promise.resolve(); },
}));
const toasts = vi.hoisted(() => [] as string[]);
vi.mock("./dialogs/DialogHost", () => ({ dialogs: { showToast: (t: { message: string }) => { toasts.push(t.message); } } }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
let api: TabLayoutApi;
let moves: TabMoves;

function Harness() {
  api = useTabLayout(() => "/home", false);
  moves = useTabMoves(api);
  return api.shells;
}

const record = (path: string, extra: Record<string, unknown> = {}) => ({
  path, sort: { key: "size", dir: "desc" }, back: ["/home", "/srv"], forward: ["/srv/www/x"], search: "log", tagFilter: "work", private: false, ...extra,
});
/** The backend sends `name` to this window. */
const send = (name: string, payload: unknown) => act(() => handlers.get(name)!({ payload }));
const paths = () => api.layout.panes.map(p => p.tabs.map(t => t.initialPath));
const flush = () => act(async () => { await new Promise(r => setTimeout(r, 0)); });

beforeEach(async () => {
  handlers.clear();
  toasts.length = 0;
  Object.assign(backend, { zones: [], started: [], newWindow: [], newWindowFails: false, closed: 0, reports: [] });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(() => root.render(<Harness />));
  act(() => api.start(single([makeTab("/a"), makeTab("/b")]), true));
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = "";
});

describe("the window a tab is dropped on", () => {
  it("makes the tab where the backend says, with its history, sort and filters", () => {
    send("tab-drop", { tab: record("/srv/www"), zone: { kind: "bar", pane: 0, gap: 1 }, home: false, x: 0, y: 0 });
    expect(paths()).toEqual([["/a", "/srv/www", "/b"]]);
    const moved = api.layout.panes[0].tabs[1];
    expect(api.layout.panes[0].active).toBe(1);
    const h = api.handles[moved.id];
    expect(h.state.historyBack).toEqual(["/home", "/srv"]);
    expect(h.state.historyForward).toEqual(["/srv/www/x"]);
    expect([h.state.sortKey, h.state.sortDir, h.state.searchQuery, h.state.tagFilter]).toEqual(["size", "desc", "log", "work"]);
    // And reports it for the session.
    expect(JSON.stringify(backend.reports.at(-1))).toContain("/srv/www");
  });

  it("splits with it at the file area's edge", () => {
    send("tab-drop", { tab: record("/srv"), zone: { kind: "split", side: "right" }, home: false, x: 0, y: 0 });
    expect(paths()).toEqual([["/a", "/b"], ["/srv"]]);
    expect(api.layout.focus).toBe(1);
  });

  it("keeps a private tab private, and out of the session", () => {
    send("tab-drop", { tab: record("/secret", { private: true }), zone: { kind: "pane", pane: 0 }, home: false, x: 0, y: 0 });
    const moved = api.layout.panes[0].tabs[2];
    expect(moved.private).toBe(true);
    expect(JSON.stringify(backend.reports.at(-1))).not.toContain("/secret");
  });

  it("ignores a drop that isn't a tab", () => {
    send("tab-drop", { tab: { path: "relative" }, zone: null, home: false, x: 0, y: 0 });
    send("tab-drop", { tab: null, zone: null, home: false, x: 0, y: 0 });
    expect(paths()).toEqual([["/a", "/b"]]);
  });

  it("marks where it will land, and clears the mark when the drag leaves", () => {
    document.body.insertAdjacentHTML("beforeend", '<div data-tab-bar="0"><div data-tab-index="0"></div></div><div data-tab-pane="0"></div>');
    send("tab-drag-over", { zone: { kind: "bar", pane: 0, gap: 0 }, home: false, x: 10, y: 10, label: null });
    expect(document.querySelector(".tab-insert")).not.toBeNull();
    send("tab-drag-over", { zone: { kind: "pane", pane: 0 }, home: false, x: 10, y: 10, label: "srv" });
    expect(document.querySelector(".split-preview")).not.toBeNull();
    expect(document.querySelector(".tab-ghost")?.textContent).toBe("srv");
    send("tab-drag-leave", null);
    expect(document.querySelector(".split-preview, .tab-insert, .tab-ghost")).toBeNull();
  });

  it("says where it takes a tab when a drag begins anywhere", () => {
    document.body.insertAdjacentHTML("beforeend", '<div data-tab-bar="0"><div data-tab-index="0"></div><div data-tab-index="1"></div></div><div data-tab-pane="0"></div>');
    send("tab-drag-began", null);
    expect(backend.zones).toEqual([{ zoom: 1, split: false, bars: [{ pane: 0, rect: [0, 0, 0, 0], tabs: [[0, 0], [0, 0]] }], panes: [{ pane: 0, rect: [0, 0, 0, 0] }] }]);
  });
});

describe("the window a tab leaves", () => {
  it("takes it out once it moved, and keeps it when the drag was cancelled", () => {
    const [a, b] = api.layout.panes[0].tabs;
    send("tab-drag-end", { tab: a.id, outcome: "cancelled", message: null });
    send("tab-drag-end", { tab: a.id, outcome: "home", message: null });
    expect(tabCount(api.layout)).toBe(2);
    send("tab-drag-end", { tab: a.id, outcome: "failed", message: "no display" });
    expect(tabCount(api.layout)).toBe(2);
    expect(toasts).toEqual(["couldn't open the tab in a new window: no display"]);
    send("tab-drag-end", { tab: a.id, outcome: "moved", message: null });
    expect(paths()).toEqual([["/b"]]);
    expect(backend.closed).toBe(0);
    // Its last tab gone (the others closed during the drag): the window closes.
    send("tab-drag-end", { tab: b.id, outcome: "moved", message: null });
    expect(backend.closed).toBe(1);
  });

  it("Move to New Window hands the tab over and takes it out once the window is made", async () => {
    const [a] = api.layout.panes[0].tabs;
    act(() => moves.moveToNewWindow(0, 0));
    expect(backend.newWindow).toEqual([{ path: "/a", sort: { key: "name", dir: "asc" }, back: [], forward: [], search: "", tagFilter: null, private: false }]);
    await flush();
    expect(findTab(api.layout, a.id)).toBeNull();
    expect(paths()).toEqual([["/b"]]);
    // Not for the window's only tab.
    act(() => moves.moveToNewWindow(0, 0));
    expect(backend.newWindow).toHaveLength(1);
  });

  it("Move to New Window that fails leaves the tab", async () => {
    backend.newWindowFails = true;
    act(() => moves.moveToNewWindow(0, 1));
    await flush();
    expect(paths()).toEqual([["/a", "/b"]]);
    expect(toasts).toEqual(["couldn't open the tab in a new window: no window"]);
  });

  it("hands a drag to the OS at the window's edge, and a drop back on it moves the tab there", async () => {
    // Its own tab bar, laid out by hand (happy-dom has no layout).
    document.body.insertAdjacentHTML("beforeend", '<div data-tab-bar="0" id="bar"><div data-tab-index="0" id="t0"></div><div data-tab-index="1" id="t1"></div></div>');
    const box = (left: number, width: number) => ({ left, top: 0, width, height: 30, right: left + width, bottom: 30, x: left, y: 0, toJSON: () => ({}) }) as DOMRect;
    const el = (id: string) => document.getElementById(id)!;
    el("bar").getBoundingClientRect = () => box(0, 400);
    el("t0").getBoundingClientRect = () => box(0, 100);
    el("t1").getBoundingClientRect = () => box(100, 100);
    document.elementFromPoint = (x: number, y: number) => (y < 30 && x < 400 ? (x < 100 ? el("t0") : x < 200 ? el("t1") : el("bar")) : null);
    const [a] = api.layout.panes[0].tabs;
    const fire = (type: string, x: number, y: number) => window.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, bubbles: true }));
    act(() => moves.onTabPointerDown(0)({ clientX: 50, clientY: 10, button: 0, target: el("t0") } as unknown as React.PointerEvent, 0));
    fire("pointermove", 150, 10);
    fire("pointermove", 150, 0);
    await flush();
    expect(backend.started).toHaveLength(1);
    expect(backend.started[0].slice(0, 3)).toEqual([a.id, { path: "/a", sort: { key: "name", dir: "asc" }, back: [], forward: [], search: "", tagFilter: null, private: false }, a.label]);
    // Back over its own window: phase 1's rules mark and place it.
    send("tab-drag-over", { zone: null, home: true, x: 300, y: 10, label: null });
    expect(document.querySelector(".tab-insert")).not.toBeNull();
    send("tab-drop", { tab: null, zone: null, home: true, x: 300, y: 10 });
    expect(paths()).toEqual([["/b", "/a"]]);
    send("tab-drag-end", { tab: a.id, outcome: "home", message: null });
    expect(paths()).toEqual([["/b", "/a"]]);
  });

  it("swallows the click the webview's handed release makes, until the drag ends or the next press", async () => {
    document.body.insertAdjacentHTML("beforeend", '<button id="target">x</button>');
    document.elementFromPoint = () => null;
    const target = document.getElementById("target")!;
    const clicks: string[] = [];
    target.addEventListener("click", () => clicks.push("click"));
    const fire = (type: string, x: number, y: number) => window.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, bubbles: true }));
    const handOff = async () => {
      act(() => moves.onTabPointerDown(0)({ clientX: 50, clientY: 10, button: 0, target } as unknown as React.PointerEvent, 0));
      fire("pointermove", 150, 10);
      fire("pointermove", 150, 0);
      await flush();
    };
    const [a] = api.layout.panes[0].tabs;
    await handOff();
    target.click();
    expect(clicks).toEqual([]);
    send("tab-drag-end", { tab: a.id, outcome: "cancelled", message: null });
    await flush();
    target.click();
    expect(clicks).toEqual(["click"]);
    // A press of its own: its click is one.
    await handOff();
    target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    target.click();
    expect(clicks).toEqual(["click", "click"]);
  });
});

describe("the pure parts", () => {
  it("receiveTab, homeDrop and afterMove", () => {
    const l = single([makeTab("/a"), makeTab("/b")]);
    expect(receiveTab(l, { tab: "x", zone: null })).toBeNull();
    expect(receiveTab(l, { tab: record("/c"), zone: null })!.panes[0].tabs.map(t => t.initialPath)).toEqual(["/a", "/b", "/c"]);
    // A drop on nothing that takes it, or a tab that's gone: unchanged.
    expect(homeDrop(l, l.panes[0].tabs[0].id, -5, -5)).toBe(l);
    expect(homeDrop(l, 999_999, 0, 0)).toBe(l);
    expect(afterMove(l, 999_999)).toBeNull();
    const one = single([makeTab("/z")]);
    expect(afterMove(one, one.panes[0].tabs[0].id)).toBe("close");
  });
});
