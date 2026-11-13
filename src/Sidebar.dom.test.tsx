// @vitest-environment happy-dom
// The sidebar tree against a fake disk: it watches the open folders on show,
// lists a folder again when the watcher reports it, drops what it kept for a
// folder that's gone, and a row whose folder is gone goes away when clicked
// instead of opening.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FileEntry } from "./api";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The disk is a set of folder paths under /h.
const fake = vi.hoisted(() => ({
  folders: new Set<string>(),
  onFsChanged: [] as Array<(e: { payload: string }) => void>,
}));
vi.mock("./api", () => {
  const parentOf = (p: string) => p.slice(0, p.lastIndexOf("/")) || "/";
  const readDir = vi.fn(async (p: string): Promise<FileEntry[]> => {
    if (!fake.folders.has(p)) throw new Error(`read_dir(${p}): No such file or directory (os error 2)`);
    return [...fake.folders].filter(f => f !== p && parentOf(f) === p).sort().map(path => ({
      name: path.slice(path.lastIndexOf("/") + 1), path, kind: "folder", size: 0, modified_ms: 0,
      hidden: false, ext: "", is_symlink: false, lossy: false, git: null,
    }));
  });
  return {
    readDir,
    listDir: vi.fn(async (p: string) => readDir(p).catch(() => [])),
    pathKind: vi.fn(async (p: string) => (fake.folders.has(p) ? "folder" : null)),
    homeDir: vi.fn(async () => "/h"),
    drives: vi.fn(async () => []),
    listWslDistros: vi.fn(async () => []),
    pickDirectory: vi.fn(async () => null),
    watchDir: vi.fn(async () => {}),
    unwatchDir: vi.fn(async () => {}),
    // The TAGS group prunes the tag store when shown (tags.ts).
    readTags: vi.fn(async () => ({})),
    writeTags: vi.fn(async () => {}),
  };
});
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (_name: string, cb: (e: { payload: string }) => void) => {
    fake.onFsChanged.push(cb);
    return () => { fake.onFsChanged = fake.onFsChanged.filter(f => f !== cb); };
  }),
}));

import { readDir, unwatchDir, watchDir } from "./api";
import { REFRESH_GAP_MS } from "./refreshGate";
import { Sidebar } from "./Sidebar";

let host: HTMLDivElement;
let root: Root;
const goTo = vi.fn();
const noop = () => {};

const settle = () => act(async () => { await new Promise(r => setTimeout(r, 20)); });
const wait = (ms: number) => act(async () => { await new Promise(r => setTimeout(r, ms)); });
// The tree's rows, by path.
const rows = () => [...host.querySelectorAll<HTMLElement>(".tree-row")].map(r => r.title);
const rowOf = (path: string) => host.querySelector<HTMLElement>(`.tree-row[title="${path}"]`)!;
const click = async (el: Element) => {
  act(() => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
  await settle();
};
const toggle = (path: string) => click(rowOf(path).querySelector(".chev")!);
const report = async (path: string) => {
  act(() => { for (const cb of fake.onFsChanged) cb({ payload: path }); });
  await settle();
};
const listings = (path: string) => vi.mocked(readDir).mock.calls.filter(([p]) => p === path).length;
const watchCalls = (fn: typeof watchDir) => vi.mocked(fn).mock.calls.map(([p]) => p);

beforeEach(async () => {
  localStorage.clear();
  fake.folders = new Set(["/h", "/h/a", "/h/a/x", "/h/b"]);
  fake.onFsChanged = [];
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root.render(
    <Sidebar activePath="/elsewhere" onGoTo={goTo} pins={[]} onAddPin={noop} tags={{}}
             savedRemotes={[]} onOpenConnectDialog={noop} onRemoteClick={noop} />,
  ));
  await settle();
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.clearAllMocks();
});

describe("the sidebar tree", () => {
  it("lists home at startup and watches it", () => {
    expect(rows()).toEqual(["/h", "/h/a", "/h/b"]);
    expect(watchCalls(watchDir)).toEqual(["/h"]);
  });

  it("watches a folder while it's open, and unwatches it when it's collapsed", async () => {
    await toggle("/h/a");
    expect(rows()).toEqual(["/h", "/h/a", "/h/a/x", "/h/b"]);
    expect(watchCalls(watchDir)).toEqual(["/h", "/h/a"]);
    await toggle("/h/a");
    expect(rows()).toEqual(["/h", "/h/a", "/h/b"]);
    expect(watchCalls(unwatchDir)).toEqual(["/h/a"]);
  });

  it("lists just the reported folder again, and a folder deleted from it goes with what was kept for it", async () => {
    await toggle("/h/a");
    fake.folders.delete("/h/a/x");
    fake.folders.delete("/h/a");
    const before = vi.mocked(readDir).mock.calls.length;
    await report("/h");
    expect(vi.mocked(readDir).mock.calls.slice(before).map(([p]) => p)).toEqual(["/h"]);
    expect(rows()).toEqual(["/h", "/h/b"]);
    expect(watchCalls(unwatchDir)).toEqual(["/h/a"]);

    // A new folder of that name starts out closed, and opens to what's in it now.
    fake.folders.add("/h/a");
    fake.folders.add("/h/a/y");
    await wait(REFRESH_GAP_MS);
    await report("/h");
    expect(rows()).toEqual(["/h", "/h/a", "/h/b"]);
    await toggle("/h/a");
    expect(rows()).toEqual(["/h", "/h/a", "/h/a/y", "/h/b"]);
  });

  it("drops an open folder that's gone when it's reported, and lists its parent again", async () => {
    await toggle("/h/a");
    fake.folders.delete("/h/a/x");
    fake.folders.delete("/h/a");
    const before = listings("/h");
    await report("/h/a");
    expect(listings("/h")).toBe(before + 1);
    expect(rows()).toEqual(["/h", "/h/b"]);
    expect(watchCalls(unwatchDir)).toEqual(["/h/a"]);
  });

  it("spaces out a burst of reports for one folder", async () => {
    const before = listings("/h");
    for (let i = 0; i < 5; i++) await report("/h");
    expect(listings("/h")).toBe(before + 1);
    await wait(REFRESH_GAP_MS + 60);
    expect(listings("/h")).toBe(before + 2);
  });

  it("ignores reports for folders it doesn't show open", async () => {
    const before = vi.mocked(readDir).mock.calls.length;
    await report("/h/a");
    await report("/somewhere/else");
    expect(vi.mocked(readDir).mock.calls.length).toBe(before);
  });

  it("lists a folder again when it's opened after a while closed", async () => {
    await toggle("/h/a");
    await toggle("/h/a");
    fake.folders.add("/h/a/y");
    await toggle("/h/a");
    expect(rows()).toEqual(["/h", "/h/a", "/h/a/x", "/h/a/y", "/h/b"]);
  });

  it("opens a folder row that's there", async () => {
    await click(rowOf("/h/b"));
    expect(goTo).toHaveBeenCalledWith("/h/b");
  });

  it("removes a clicked row whose folder is gone instead of opening it", async () => {
    fake.folders.delete("/h/b");
    await click(rowOf("/h/b"));
    expect(goTo).not.toHaveBeenCalled();
    expect(rows()).toEqual(["/h", "/h/a"]);
  });

  it("does the same for Enter on such a row", async () => {
    fake.folders.delete("/h/b");
    const aside = host.querySelector<HTMLElement>("[tabindex='-1']")!;
    const key = (k: string) => act(() => { aside.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true })); });
    // The cursor starts on the first row (/h); /h/b is two down.
    key("ArrowDown");
    key("ArrowDown");
    key("Enter");
    await settle();
    expect(goTo).not.toHaveBeenCalled();
    expect(rows()).toEqual(["/h", "/h/a"]);
  });

  it("drops a pruned folder from a Refresh pass instead of listing it", async () => {
    await toggle("/h/a");
    await toggle("/h/a");
    fake.folders.delete("/h/a/x");
    fake.folders.delete("/h/a");
    const before = vi.mocked(readDir).mock.calls.length;
    await click(host.querySelector("[title='Tree options']")!);
    const refresh = [...host.querySelectorAll<HTMLElement>("div")].find(d => d.textContent === "Refresh")!;
    await click(refresh);
    expect(vi.mocked(readDir).mock.calls.slice(before).map(([p]) => p)).toEqual(["/h"]);
    expect(rows()).toEqual(["/h", "/h/b"]);
  });

  it("unwatches everything when it goes", async () => {
    await toggle("/h/a");
    act(() => root.unmount());
    expect(watchCalls(unwatchDir).sort()).toEqual(["/h", "/h/a"]);
    root = createRoot(host);
  });
});
