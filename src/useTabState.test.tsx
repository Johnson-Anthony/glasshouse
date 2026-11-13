// @vitest-environment happy-dom
// useTabState against a fake backend: re-reads that find nothing new render
// nothing, re-lists keep the selection on its files, navigating drops the
// old folder's rows at once, bursts of reports are spaced out, and a tab in
// the background waits until it's shown.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FileEntry, GitInfo } from "./api";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Every read returns fresh objects, as the backend does.
const fake = vi.hoisted(() => ({
  dirs: {} as Record<string, FileEntry[]>,
  git: null as GitInfo | null,
  onFsChanged: [] as Array<(e: { payload: string }) => void>,
  copy: <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T,
}));
vi.mock("./api", () => ({
  readDir: vi.fn(async (p: string) => fake.copy(fake.dirs[p] ?? [])),
  gitStatus: vi.fn(async () => fake.copy(fake.git)),
  watchDir: vi.fn(async () => {}),
  unwatchDir: vi.fn(async () => {}),
  appendRecent: vi.fn(async () => {}),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (_name: string, cb: (e: { payload: string }) => void) => {
    fake.onFsChanged.push(cb);
    return () => { fake.onFsChanged = fake.onFsChanged.filter(f => f !== cb); };
  }),
}));

import { gitStatus, readDir } from "./api";
import { REFRESH_GAP_MS } from "./refreshGate";
import { useTabState, type UseTabResult } from "./state";

const entry = (dir: string, name: string): FileEntry => ({
  name, path: `${dir}/${name}`, kind: "text", size: 1, modified_ms: 0,
  hidden: false, ext: "", is_symlink: false, lossy: false, git: null,
});

let tab: UseTabResult;
let renders = 0;
let shown = true;
function Host() {
  tab = useTabState("/w", true, shown);
  renders++;
  return null;
}

let host: HTMLDivElement;
let root: Root;
// Past the hook's 60 ms fetch debounce, and the fetch's own promises.
const settle = () => act(async () => { await new Promise(r => setTimeout(r, 90)); });
const wait = (ms: number) => act(async () => { await new Promise(r => setTimeout(r, ms)); });
const report = (path: string) => { for (const cb of fake.onFsChanged) cb({ payload: path }); };
// A watcher report, then long enough for its listing and the gap after it,
// so the next report lists at once (see refreshGate.ts).
const fsChanged = async (path: string) => {
  act(() => report(path));
  await wait(REFRESH_GAP_MS + 60);
};
const reads = () => vi.mocked(readDir).mock.calls.length;

beforeEach(async () => {
  fake.dirs = { "/w": ["a", "b", "c"].map(n => entry("/w", n)), "/x": [entry("/x", "z")] };
  fake.git = { repo_root: "/w", branch: "main", ahead: 0, behind: 0, dirty: 1 };
  fake.onFsChanged = [];
  renders = 0;
  shown = true;
  host = document.createElement("div");
  root = createRoot(host);
  act(() => root.render(<Host />));
  await settle();
});
afterEach(() => {
  act(() => root.unmount());
  vi.mocked(readDir).mockClear();
  vi.mocked(gitStatus).mockClear();
});

describe("useTabState re-reads", () => {
  it("render nothing when the folder hasn't changed", async () => {
    expect(tab.state.entries.map(e => e.name)).toEqual(["a", "b", "c"]);
    expect(tab.state.gitInfo?.dirty).toBe(1);
    // TabShell hands the hook's result to App whenever it's a new object, and
    // App then re-renders every pane.
    const result = tab;
    const before0 = reads();
    await fsChanged("/w");
    expect(tab).toBe(result);
    // React may render once to find the state unchanged; after that, none.
    const before = renders;
    await fsChanged("/w");
    await fsChanged("/w");
    expect(reads()).toBe(before0 + 3);
    expect(renders).toBe(before);
    expect(tab).toBe(result);
  });

  it("keep the selection and focus on the same files when one appears before them", async () => {
    act(() => { tab.actions.setSelected([1, 2]); tab.actions.setFocusIndex(1); });
    fake.dirs["/w"].unshift(entry("/w", "0-new"));
    await fsChanged("/w");
    const { entries, selected, focusIndex } = tab.state;
    expect(entries.map(e => e.name)).toEqual(["0-new", "a", "b", "c"]);
    expect(selected.map(i => entries[i].name)).toEqual(["b", "c"]);
    expect(entries[focusIndex].name).toBe("b");
  });

  it("show a changed git status", async () => {
    const { gitInfo } = tab.state;
    fake.git = { ...fake.git!, dirty: 2 };
    await fsChanged("/w");
    expect(tab.state.gitInfo).not.toBe(gitInfo);
    expect(tab.state.gitInfo?.dirty).toBe(2);
  });

  it("list once at once and once more after a burst of reports, showing the last change", async () => {
    await wait(REFRESH_GAP_MS);
    const before = reads();
    act(() => {
      for (const n of ["d", "e", "f", "g"]) {
        fake.dirs["/w"].push(entry("/w", n));
        report("/w");
      }
    });
    await wait(20);
    expect(reads()).toBe(before + 1);
    await wait(REFRESH_GAP_MS + 60);
    expect(reads()).toBe(before + 2);
    expect(tab.state.entries.map(e => e.name)).toEqual(["a", "b", "c", "d", "e", "f", "g"]);
  });

  it("list at once on an explicit refresh, even right after a report's listing", async () => {
    act(() => report("/w"));
    await wait(20);
    const before = reads();
    fake.dirs["/w"].push(entry("/w", "renamed"));
    act(() => tab.actions.refresh());
    await settle();
    expect(reads()).toBe(before + 1);
    expect(tab.state.entries.map(e => e.name)).toContain("renamed");
    // The rows stayed on screen meanwhile.
    expect(tab.state.loading).toBe(false);
  });

  it("ask git status for a count since the refresh began", async () => {
    await fsChanged("/w");
    const [path, maxAge] = vi.mocked(gitStatus).mock.calls.at(-1)!;
    expect(path).toBe("/w");
    expect(maxAge).toBeLessThan(REFRESH_GAP_MS);
  });
});

describe("useTabState in a background tab", () => {
  it("doesn't re-list on reports, and lists once when shown again", async () => {
    shown = false;
    act(() => root.render(<Host />));
    const before = reads();
    fake.dirs["/w"].push(entry("/w", "d"));
    await fsChanged("/w");
    await fsChanged("/w");
    expect(reads()).toBe(before);
    expect(tab.state.entries.map(e => e.name)).toEqual(["a", "b", "c"]);
    shown = true;
    act(() => root.render(<Host />));
    await wait(20);
    expect(reads()).toBe(before + 1);
    expect(tab.state.entries.map(e => e.name)).toEqual(["a", "b", "c", "d"]);
    // Nothing missed since: showing it again lists nothing.
    shown = false;
    act(() => root.render(<Host />));
    shown = true;
    act(() => root.render(<Host />));
    await wait(20);
    expect(reads()).toBe(before + 1);
  });
});

describe("useTabState navigation", () => {
  it("drops the old folder's rows and selection at once, then lists the new one", async () => {
    act(() => tab.actions.setSelected([0, 2]));
    act(() => tab.actions.goTo("/x"));
    expect(tab.state.entries).toEqual([]);
    expect(tab.state.selected).toEqual([]);
    expect(tab.state.loading).toBe(true);
    await settle();
    expect(tab.state.path).toBe("/x");
    expect(tab.state.entries.map(e => e.name)).toEqual(["z"]);
    expect(tab.state.loading).toBe(false);
    // A navigation takes a dirty count up to one poll old.
    expect(vi.mocked(gitStatus).mock.calls.at(-1)).toEqual(["/x", 30000]);
  });
});
