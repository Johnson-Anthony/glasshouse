// @vitest-environment happy-dom
// useTabState against a fake backend: re-reads that find nothing new render
// nothing, re-lists keep the selection on its files, and navigating drops the
// old folder's rows at once.
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

import { readDir } from "./api";
import { useTabState, type UseTabResult } from "./state";

const entry = (dir: string, name: string): FileEntry => ({
  name, path: `${dir}/${name}`, kind: "text", size: 1, modified_ms: 0,
  hidden: false, ext: "", is_symlink: false, lossy: false, git: null,
});

let tab: UseTabResult;
let renders = 0;
function Host() {
  tab = useTabState("/w", true);
  renders++;
  return null;
}

let host: HTMLDivElement;
let root: Root;
// Past the hook's 60 ms fetch debounce, and the fetch's own promises.
const settle = () => act(async () => { await new Promise(r => setTimeout(r, 90)); });
const fsChanged = (path: string) => act(async () => {
  for (const cb of fake.onFsChanged) cb({ payload: path });
  await new Promise(r => setTimeout(r, 10));
});

beforeEach(async () => {
  fake.dirs = { "/w": ["a", "b", "c"].map(n => entry("/w", n)), "/x": [entry("/x", "z")] };
  fake.git = { repo_root: "/w", branch: "main", ahead: 0, behind: 0, dirty: 1, status: { a: "M" } };
  fake.onFsChanged = [];
  renders = 0;
  host = document.createElement("div");
  root = createRoot(host);
  act(() => root.render(<Host />));
  await settle();
});
afterEach(() => {
  act(() => root.unmount());
  vi.mocked(readDir).mockClear();
});

describe("useTabState re-reads", () => {
  it("render nothing when the folder hasn't changed", async () => {
    expect(tab.state.entries.map(e => e.name)).toEqual(["a", "b", "c"]);
    expect(tab.state.gitInfo?.status).toEqual({ a: "M" });
    // TabShell hands the hook's result to App whenever it's a new object, and
    // App then re-renders every pane.
    const result = tab;
    const reads = vi.mocked(readDir).mock.calls.length;
    await fsChanged("/w");
    expect(tab).toBe(result);
    // React may render once to find the state unchanged; after that, none.
    const before = renders;
    await fsChanged("/w");
    await fsChanged("/w");
    expect(vi.mocked(readDir).mock.calls.length).toBe(reads + 3);
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
    fake.git = { ...fake.git!, status: { a: "M", b: "?" }, dirty: 2 };
    await fsChanged("/w");
    expect(tab.state.gitInfo).not.toBe(gitInfo);
    expect(tab.state.gitInfo?.status).toEqual({ a: "M", b: "?" });
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
  });
});
