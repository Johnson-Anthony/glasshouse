// @vitest-environment happy-dom
// Miller columns in a DOM. The middle column is the file pane, so it has the
// pane's selection rules, Esc, menus and drag; Miller's own keys (←/h, →/l,
// j/k) are the pane's `millerKeys`. The outer columns follow the sort and the
// hidden-files setting, take drops, have per-path menus, and re-list when the
// watcher reports their folder.
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FileEntry } from "./api";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const fake = vi.hoisted(() => ({
  dirs: {} as Record<string, FileEntry[]>,
  /** Folders whose listing waits until released. */
  held: new Map<string, () => void>(),
  onFsChanged: [] as Array<(e: { payload: string }) => void>,
}));
vi.mock("./api", async importOriginal => ({
  ...(await importOriginal<typeof import("./api")>()),
  listDir: vi.fn(async (p: string, showHidden: boolean) => {
    if (fake.held.has(p)) await new Promise<void>(r => fake.held.set(p, r));
    return (fake.dirs[p] ?? []).filter(e => showHidden || !e.hidden).map(e => ({ ...e }));
  }),
  watchDir: vi.fn(async () => {}),
  unwatchDir: vi.fn(async () => {}),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (_name: string, cb: (e: { payload: string }) => void) => {
    fake.onFsChanged.push(cb);
    return () => { fake.onFsChanged = fake.onFsChanged.filter(f => f !== cb); };
  }),
}));

import { listDir, unwatchDir, watchDir } from "./api";
import { FilePane, type ContextKind } from "./components";
import type { FileKind } from "./data";
import { columnOrder, MillerView } from "./Miller";
import type { MenuAnchor } from "./menuNav";
import type { SortDir, SortKey } from "./state";
import { entryName } from "./viewRows";

const entry = (dir: string, name: string, kind = "text", more: Partial<FileEntry> = {}): FileEntry => ({
  name, path: `${dir}/${name}`, kind, size: 1, modified_ms: 0, hidden: false,
  ext: kind === "folder" || !name.includes(".") ? "" : name.slice(name.lastIndexOf(".") + 1),
  is_symlink: false, lossy: false, git: null, ...more,
});
const toRow = (e: FileEntry) => ({
  ...entryName(e), kind: e.kind as FileKind, size: "", date: "", tag: null, git: null,
  hidden: e.hidden, link: e.is_symlink, entry: e,
});

// The current folder, /h/w, in listing order; sorted by name, folders first,
// it shows docs, sub, a.txt, b.txt, c.txt.
const CWD = [
  entry("/h/w", "b.txt"), entry("/h/w", "sub", "folder"), entry("/h/w", "a.txt"),
  entry("/h/w", "docs", "folder"), entry("/h/w", "c.txt"),
];

interface S {
  entries: FileEntry[]; selected: number[]; focus: number; anchor: number;
  sortKey: SortKey; sortDir: SortDir; foldersFirst: boolean; showHidden: boolean;
}
let set: (f: (s: S) => S) => void;
let current: () => S;
const onUp = vi.fn();
const onOpen = vi.fn();
const onNavigate = vi.fn();
const onExternalDrag = vi.fn();
const onPathContext = vi.fn();
const contexts: Array<{ at: MenuAnchor; kind: ContextKind; row?: number }> = [];

function Host({ entries }: { entries: FileEntry[] }) {
  const [s, setS] = useState<S>({
    entries, selected: [], focus: 0, anchor: 0, sortKey: "name", sortDir: "asc", foldersFirst: true, showHidden: false,
  });
  set = setS;
  current = () => s;
  return (
    <MillerView cwd="/h/w" focused={s.entries[s.focus]} showHidden={s.showHidden}
      sortKey={s.sortKey} sortDir={s.sortDir} foldersFirst={s.foldersFirst}
      onNavigate={onNavigate} onPathContext={(_e, p, isFolder) => onPathContext(p, isFolder)}>
      <FilePane files={s.entries.map(toRow)} millerKeys dropPath="/h/w"
        selected={s.selected} setSelected={sel => setS(p => ({ ...p, selected: sel }))}
        focusIndex={s.focus} setFocusIndex={i => setS(p => ({ ...p, focus: i }))}
        anchorIndex={s.anchor} setAnchorIndex={i => setS(p => ({ ...p, anchor: i }))}
        paneFocused={true} setPaneFocused={() => {}} sortKey={s.sortKey} sortDir={s.sortDir}
        foldersFirst={s.foldersFirst} onSortChange={() => {}}
        onContext={(at, kind, row) => contexts.push({ at, kind, row })}
        onOpen={onOpen} onUp={onUp} onExternalDrag={onExternalDrag} />
    </MillerView>
  );
}

let host: HTMLDivElement;
let root: Root;
const settle = () => act(async () => { await new Promise(r => setTimeout(r, 0)); });
const mount = async (entries: FileEntry[] = CWD) => {
  act(() => root.render(<Host entries={entries} />));
  await settle();
};
beforeEach(() => {
  fake.dirs = {
    "/h": [
      entry("/h", "w", "folder"), entry("/h", "Beta", "folder", { size: 9 }), entry("/h", "z.txt", "text", { size: 5 }),
      entry("/h", ".hidden", "text", { hidden: true }), entry("/h", "m.md", "text", { size: 50 }), entry("/h", "a", "folder", { size: 3 }),
    ],
    "/h/w": CWD,
    "/h/w/sub": [entry("/h/w/sub", "inner.txt"), entry("/h/w/sub", "deep", "folder")],
    "/h/w/docs": [entry("/h/w/docs", "README.md")],
  };
  fake.held.clear();
  contexts.length = 0;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

const paneEl = () => host.querySelector<HTMLElement>(".miller > .pane")!;
const name = (orig: number) => current().entries[orig].name;
const selectedNames = () => current().selected.map(name).sort();
const rowEl = (n: string) => {
  const i = current().entries.findIndex(e => e.name === n);
  return host.querySelector<HTMLElement>(`.pane .row[data-orig="${i}"]`)!;
};
const click = (n: string, mods: MouseEventInit = {}) => act(() => {
  rowEl(n).dispatchEvent(new MouseEvent("click", { bubbles: true, ...mods }));
});
const key = (k: string, mods: KeyboardEventInit = {}) => act(() => {
  paneEl().dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...mods }));
});
const cols = () => [...host.querySelectorAll<HTMLElement>(".miller > .mcol")];
const colNames = (i: number) => [...cols()[i].querySelectorAll(".mname")].map(e => e.textContent);
const outerRow = (col: number, n: string) => [...cols()[col].querySelectorAll<HTMLElement>(".mrow")].find(r => r.querySelector(".mname")?.textContent === n)!;
// Then the preview column's listing lands.
const focusOn = async (n: string) => {
  act(() => set(p => {
    const i = p.entries.findIndex(e => e.name === n);
    return { ...p, focus: i, selected: [i], anchor: i };
  }));
  await settle();
};

describe("the middle column is the file pane", () => {
  it("sits between the parent and preview columns, sorted as the pane sorts", async () => {
    await mount();
    expect(host.querySelector(".miller")!.children[1]).toBe(paneEl());
    expect([...paneEl().querySelectorAll(".row")].map(r => r.getAttribute("data-orig")).map(Number).map(name))
      .toEqual(["docs", "sub", "a.txt", "b.txt", "c.txt"]);
  });

  it("selects with the pane's Ctrl and Shift click rules", async () => {
    await mount();
    click("sub");
    click("b.txt", { shiftKey: true });
    expect(selectedNames()).toEqual(["a.txt", "b.txt", "sub"]);
    click("a.txt", { ctrlKey: true });
    expect(selectedNames()).toEqual(["b.txt", "sub"]);
    click("docs", { ctrlKey: true });
    expect(selectedNames()).toEqual(["b.txt", "docs", "sub"]);
    expect(rowEl("docs").classList).toContain("selected");
    expect(rowEl("a.txt").classList).not.toContain("selected");
    // Focusing a folder lists it in the preview column.
    await settle();
  });

  it("extends with Shift+arrows, selects all with Ctrl+A and deselects with Esc", async () => {
    await mount();
    click("sub");
    key("ArrowDown", { shiftKey: true });
    expect(selectedNames()).toEqual(["a.txt", "sub"]);
    key("a", { ctrlKey: true });
    expect(selectedNames()).toEqual(["a.txt", "b.txt", "c.txt", "docs", "sub"]);
    key("Escape");
    expect(current().selected).toEqual([]);
    // Focus stays, so the preview column still shows that row.
    expect(name(current().focus)).toBe("a.txt");
  });

  it("opens the file menu on a row, keeping a multi-selection, and the empty menu elsewhere", async () => {
    await mount();
    click("a.txt");
    click("c.txt", { ctrlKey: true });
    act(() => { rowEl("c.txt").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })); });
    expect(contexts.map(c => c.kind)).toEqual(["file"]);
    expect(selectedNames()).toEqual(["a.txt", "c.txt"]);
    // A right-click on an unselected row selects just that row.
    act(() => { rowEl("docs").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })); });
    expect(selectedNames()).toEqual(["docs"]);
    act(() => { paneEl().querySelector(".rows")!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })); });
    expect(contexts.map(c => c.kind)).toEqual(["file", "file", "empty"]);
    // Focusing a folder lists it in the preview column.
    await settle();
  });

  it("opens the selection's menu from the Menu key and Shift+F10", async () => {
    await mount();
    click("b.txt");
    key("ContextMenu");
    key("F10", { shiftKey: true });
    expect(contexts.map(c => [c.kind, c.at.keyboard])).toEqual([["file", true], ["file", true]]);
    key("Escape");
    key("ContextMenu");
    expect(contexts.at(-1)!.kind).toBe("empty");
  });
});

describe("Miller's keys", () => {
  it("← and h open the parent folder, also in an empty folder", async () => {
    await mount();
    key("ArrowLeft");
    key("h");
    expect(onUp).toHaveBeenCalledTimes(2);
    await mount([]);
    key("ArrowLeft");
    expect(onUp).toHaveBeenCalledTimes(3);
  });

  it("→ and l open the focused row", async () => {
    await mount();
    await focusOn("sub");
    key("ArrowRight");
    key("l");
    expect(onOpen.mock.calls).toEqual([[1], [1]]);
  });

  it("j and k move like ↓ and ↑, and Shift+J extends", async () => {
    await mount();
    await focusOn("sub");
    key("j");
    expect(selectedNames()).toEqual(["a.txt"]);
    key("k");
    key("k");
    expect(selectedNames()).toEqual(["docs"]);
    key("J", { shiftKey: true });
    expect(selectedNames()).toEqual(["docs", "sub"]);
    // Focusing a folder lists it in the preview column.
    await settle();
  });

  it("leave Ctrl, Alt and Meta combinations alone", async () => {
    await mount();
    await focusOn("sub");
    key("ArrowLeft", { altKey: true });
    key("l", { ctrlKey: true });
    key("j", { metaKey: true });
    expect(onUp).not.toHaveBeenCalled();
    expect(onOpen).not.toHaveBeenCalled();
    expect(name(current().focus)).toBe("sub");
  });

  it("let a type-ahead under way keep its letters", async () => {
    let now = 50_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    await mount([entry("/h/w", "ab"), entry("/h/w", "aj"), entry("/h/w", "b"), entry("/h/w", "c")]);
    key("a");
    now += 100;
    key("j");
    expect(name(current().focus)).toBe("aj");
    // After a pause, j moves down again.
    now += 5000;
    key("j");
    expect(name(current().focus)).toBe("b");
  });
});

describe("outer columns", () => {
  it("follow the sort key, direction and folders-first", async () => {
    await mount();
    expect(colNames(0)).toEqual(["a", "Beta", "w", "m.md", "z.txt"]);
    act(() => set(p => ({ ...p, sortDir: "desc" })));
    expect(colNames(0)).toEqual(["w", "Beta", "a", "z.txt", "m.md"]);
    act(() => set(p => ({ ...p, sortKey: "size", sortDir: "asc", foldersFirst: false })));
    expect(colNames(0)).toEqual(["w", "a", "z.txt", "Beta", "m.md"]);
    await focusOn("sub");
    act(() => set(p => ({ ...p, sortKey: "name", foldersFirst: true })));
    expect(colNames(1)).toEqual(["deep", "inner.txt"]);
  });

  it("list hidden files when the tab does", async () => {
    await mount();
    expect(colNames(0)).not.toContain(".hidden");
    act(() => set(p => ({ ...p, showHidden: true })));
    await settle();
    expect(vi.mocked(listDir)).toHaveBeenLastCalledWith("/h", true);
    expect(outerRow(0, ".hidden").classList).toContain("dim");
  });

  it("show each name once, the current folder highlighted, links marked", async () => {
    fake.dirs["/h"].push(entry("/h", "link.txt", "text", { is_symlink: true }));
    await mount();
    expect(colNames(0).filter(n => n === "m.md")).toHaveLength(1);
    expect(outerRow(0, "w").classList).toContain("hilite");
    expect(cols()[0].querySelectorAll(".link")).toHaveLength(1);
  });

  it("take drops: each column for the folder it lists, and each folder row for itself", async () => {
    await mount();
    expect(cols()[0].dataset.dropPath).toBe("/h");
    expect(outerRow(0, "a").dataset.dropPath).toBe("/h/a");
    expect(outerRow(0, "m.md").dataset.dropPath).toBeUndefined();
    await focusOn("sub");
    expect(cols()[1].dataset.dropPath).toBe("/h/w/sub");
    expect(outerRow(1, "deep").dataset.dropPath).toBe("/h/w/sub/deep");
    await focusOn("a.txt");
    expect(cols()[1].dataset.dropPath).toBeUndefined();
  });

  it("light up under the pane's drag, and the drop goes to App with the pointer's place", async () => {
    await mount();
    const target = outerRow(0, "a");
    vi.spyOn(document, "elementFromPoint").mockImplementation(() => target);
    act(() => { rowEl("b.txt").dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, clientX: 100, clientY: 100 })); });
    act(() => { window.dispatchEvent(new PointerEvent("pointermove", { clientX: 40, clientY: 60 })); });
    expect(target.classList).toContain("drop-target");
    act(() => { window.dispatchEvent(new PointerEvent("pointerup", { clientX: 40, clientY: 60, ctrlKey: true })); });
    expect(onExternalDrag).toHaveBeenCalledWith([0], 40, 60, true);
    expect(target.classList).not.toContain("drop-target");
  });

  it("open the per-path menu of a row, or of the column's folder", async () => {
    await mount();
    const ctx = (el: Element) => act(() => { el.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })); });
    ctx(outerRow(0, "a"));
    ctx(outerRow(0, "m.md"));
    ctx(cols()[0]);
    await focusOn("docs");
    ctx(outerRow(1, "README.md"));
    ctx(cols()[1]);
    expect(onPathContext.mock.calls).toEqual([
      ["/h/a", true], ["/h/m.md", false], ["/h", true], ["/h/w/docs/README.md", false], ["/h/w/docs", true],
    ]);
    // The pane's menus are its own.
    expect(contexts).toEqual([]);
  });

  it("navigate on a click: a parent folder row, or the preview into the focused folder", async () => {
    await mount();
    act(() => { outerRow(0, "Beta").click(); });
    act(() => { outerRow(0, "m.md").click(); });
    await focusOn("sub");
    act(() => { outerRow(1, "inner.txt").click(); });
    expect(onNavigate.mock.calls).toEqual([["/h/Beta"], ["/h/w/sub"]]);
  });

  it("are watched while shown and re-list on a report", async () => {
    await mount();
    expect(vi.mocked(watchDir).mock.calls.map(([p]) => p)).toEqual(["/h"]);
    await focusOn("sub");
    await focusOn("docs");
    expect(vi.mocked(watchDir).mock.calls.map(([p]) => p)).toEqual(["/h", "/h/w/sub", "/h/w/docs"]);
    expect(vi.mocked(unwatchDir).mock.calls.map(([p]) => p)).toEqual(["/h/w/sub"]);
    // Past the refresh gate's gap, so the report lists at once.
    const later = Date.now() + 10_000;
    vi.spyOn(Date, "now").mockImplementation(() => later);
    fake.dirs["/h"] = [...fake.dirs["/h"], entry("/h", "new", "folder")];
    for (const cb of fake.onFsChanged) cb({ payload: "/h" });
    await settle();
    expect(colNames(0)).toContain("new");
    act(() => root.unmount());
    expect(vi.mocked(unwatchDir).mock.calls.map(([p]) => p).sort()).toEqual(["/h", "/h/w/docs", "/h/w/sub"]);
    root = createRoot(host);
  });

  it("never show one folder's rows under another while its listing is on the way", async () => {
    await mount();
    await focusOn("sub");
    expect(colNames(1)).toEqual(["deep", "inner.txt"]);
    fake.held.set("/h/w/docs", () => {});
    await focusOn("docs");
    expect(colNames(1)).toEqual([]);
    expect(cols()[1].dataset.dropPath).toBe("/h/w/docs");
    await act(async () => { fake.held.get("/h/w/docs")!(); });
    await settle();
    expect(colNames(1)).toEqual(["README.md"]);
  });

  it("shows the focused file's details in the preview column", async () => {
    await mount();
    await focusOn("c.txt");
    expect(host.querySelector(".mpreview .mp-name")!.textContent).toBe("c.txt");
  });
});

describe("columnOrder", () => {
  const es = [
    entry("/d", "b.txt", "text", { size: 3, modified_ms: 2 }), entry("/d", "A", "folder", { size: 1, modified_ms: 3 }),
    entry("/d", "a.md", "text", { size: 2, modified_ms: 1 }), entry("/d", "c", "folder", { size: 9, modified_ms: 0 }),
  ];
  const names = (key: SortKey, dir: SortDir, foldersFirst = true) => columnOrder(es, { sortKey: key, sortDir: dir, foldersFirst }).map(e => e.name);

  it("sorts as the pane does", () => {
    expect(names("name", "asc")).toEqual(["A", "c", "a.md", "b.txt"]);
    expect(names("name", "desc")).toEqual(["c", "A", "b.txt", "a.md"]);
    expect(names("name", "asc", false)).toEqual(["A", "a.md", "b.txt", "c"]);
    expect(names("size", "asc", false)).toEqual(["A", "a.md", "b.txt", "c"]);
    expect(names("modified", "desc")).toEqual(["A", "c", "b.txt", "a.md"]);
    expect(names("type", "asc", false)).toEqual(["A", "c", "a.md", "b.txt"]);
  });
});
