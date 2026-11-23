// @vitest-environment happy-dom
// The file pane as a screen reader meets it: a grid of rows under a header
// row in the list modes, a listbox in the card modes; the focused row named
// by aria-activedescendant only while it's rendered; column headers that
// take focus and say their sort; what's announced. happy-dom has no layout,
// so the sizes the windowed list reads are stubbed, as in FilePane.dom.test.
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { FilePane } from "./components";
import type { FileRow } from "./data";
import { OVERSCAN } from "./paneWindow";
import type { SortDir, SortKey } from "./state";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Each file row works out its icon type once per render: a count of rows
// rendered.
const typeCalls = vi.hoisted(() => ({ n: 0 }));
vi.mock("./fileTypes", async importOriginal => {
  const real = await importOriginal<typeof import("./fileTypes")>();
  return { ...real, fileType: (...a: Parameters<typeof real.fileType>) => { typeCalls.n++; return real.fileType(...a); } };
});

type Row = FileRow & { entry: { path: string } };
const row = (name: string, over: Partial<FileRow> = {}, dir = "/w"): Row => ({
  name, ext: "", kind: "text", size: "", date: "", tag: null, git: null, hidden: false, link: false,
  ...over, entry: { path: `${dir}/${name}` },
});
const make = (n: number, dir = "/w") => Array.from({ length: n }, (_, i) => row("f" + String(i).padStart(5, "0"), {}, dir));

const ROW_H = 26, VIEW_H = 260;
const stubs: Array<[string, PropertyDescriptor | undefined]> = [];
beforeAll(() => {
  const stub = (prop: string, get: (el: HTMLElement) => number) => {
    stubs.push([prop, Object.getOwnPropertyDescriptor(HTMLElement.prototype, prop)]);
    Object.defineProperty(HTMLElement.prototype, prop, { configurable: true, get() { return get(this as HTMLElement); } });
  };
  stub("clientHeight", el => (el.classList.contains("rows") ? VIEW_H : 0));
  stub("clientWidth", el => (el.classList.contains("rows") ? 400 : 0));
  stub("offsetHeight", el => (el.classList.contains("row") ? ROW_H : 0));
});
afterAll(() => {
  for (const [prop, d] of stubs) if (d) Object.defineProperty(HTMLElement.prototype, prop, d);
});

interface S {
  files: Row[]; path: string; selected: number[]; focus: number; anchor: number;
  sortKey: SortKey; sortDir: SortDir; loading: boolean; error: string | null;
}
let set: (f: (s: S) => S) => void;
let current: () => S;
function Host({ files, path, paneName }: { files: Row[]; path: string; paneName?: string }) {
  const [s, setS] = useState<S>({ files, path, selected: [], focus: 0, anchor: 0, sortKey: "name", sortDir: "asc", loading: false, error: null });
  set = setS;
  current = () => s;
  return (
    <FilePane files={s.files} dropPath={s.path} paneName={paneName} loading={s.loading} error={s.error}
      selected={s.selected} setSelected={sel => setS(p => ({ ...p, selected: sel }))}
      focusIndex={s.focus} setFocusIndex={i => setS(p => ({ ...p, focus: i }))}
      anchorIndex={s.anchor} setAnchorIndex={i => setS(p => ({ ...p, anchor: i }))}
      paneFocused={true} setPaneFocused={() => {}} sortKey={s.sortKey} sortDir={s.sortDir}
      onSortChange={k => setS(p => (p.sortKey === k ? { ...p, sortDir: p.sortDir === "asc" ? "desc" : "asc" } : { ...p, sortKey: k, sortDir: "asc" }))}
      onContext={() => {}} />
  );
}

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.querySelectorAll("[data-announce]").forEach(n => n.remove());
  vi.restoreAllMocks();
});

const mount = (files: Row[], path = "/w") => act(() => root.render(<Host files={files} path={path} />));
const pane = () => host.querySelector<HTMLElement>(".pane")!;
const rowsEl = () => host.querySelector<HTMLDivElement>(".rows")!;
const rows = () => [...host.querySelectorAll<HTMLElement>(".row")];
const heads = () => [...host.querySelectorAll<HTMLElement>(".pane-head [data-sort]")];
const said = () => document.querySelector("[data-announce]")?.textContent ?? "";
const scrollTo = (top: number) => act(() => {
  rowsEl().scrollTop = top;
  rowsEl().dispatchEvent(new Event("scroll"));
});
const key = (k: string, mods: KeyboardEventInit = {}, on: Element = document.activeElement?.closest(".pane") ? document.activeElement! : pane()) => {
  const e = new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...mods });
  act(() => { on.dispatchEvent(e); });
  return e;
};
/** The row aria-activedescendant names, which must be in the page. */
const active = () => {
  const id = pane().getAttribute("aria-activedescendant");
  if (id === null) return null;
  const el = document.getElementById(id);
  expect(el, `aria-activedescendant="${id}" names an element in the page`).not.toBeNull();
  return el;
};
// The card modes' `.rows` isn't display: block.
const cardMode = () => {
  const real = window.getComputedStyle;
  vi.spyOn(window, "getComputedStyle").mockImplementation(((el: Element, pseudo?: string | null) => {
    const cs = real(el, pseudo);
    if (!el.classList.contains("rows") && !el.classList.contains("pane-head")) return cs;
    return new Proxy(cs, { get: (t, p) => (p === "display" ? (el.classList.contains("rows") ? "grid" : "none") : Reflect.get(t, p)) });
  }) as typeof window.getComputedStyle);
};

describe("the list modes: a grid", () => {
  it("is a named, multi-select grid with a header row and a row of cells per file", () => {
    mount([row("src", { kind: "folder" }), row("notes", { ext: "md", size: "2 KB", date: "2026-11-20 10:00", tag: "work", git: "M" })], "/home/u/Documents");
    expect(pane().getAttribute("role")).toBe("grid");
    expect(pane().getAttribute("aria-label")).toBe("Files in Documents");
    expect(pane().getAttribute("aria-multiselectable")).toBe("true");
    const head = host.querySelector(".pane-head")!;
    expect(head.getAttribute("role")).toBe("row");
    expect([...head.children].map(c => c.getAttribute("role"))).toEqual(Array(6).fill("columnheader"));
    expect(rowsEl().getAttribute("role")).toBe("rowgroup");
    const [dir, file] = rows();
    expect(dir.getAttribute("role")).toBe("row");
    expect([...dir.children].map(c => c.getAttribute("role"))).toEqual(Array(6).fill("gridcell"));
    // A folder says so; a file's icon cell is silent, and so are the dashes.
    expect(dir.querySelector(".ic")!.getAttribute("aria-label")).toBe("folder");
    expect(file.querySelector(".ic")!.getAttribute("aria-label")).toBeNull();
    expect(file.querySelector(".ic i")!.getAttribute("aria-hidden")).toBe("true");
    expect(dir.querySelector(".c-tag span")!.getAttribute("aria-hidden")).toBe("true");
    expect(file.querySelector(".c-git")!.getAttribute("aria-label")).toBe("modified");
    expect(file.querySelector(".name")!.textContent).toBe("notes.md");
  });

  it("says which rows are selected, on those rows only", () => {
    mount(make(5));
    expect(rows().map(r => r.getAttribute("aria-selected"))).toEqual(Array(5).fill("false"));
    key("ArrowDown");
    key("ArrowDown", { shiftKey: true });
    expect(rows().map(r => r.getAttribute("aria-selected"))).toEqual(["false", "true", "true", "false", "false"]);
  });

  it("names the focused row with aria-activedescendant as the keys move it", () => {
    mount(make(5));
    expect(active()).toBe(rows()[0]);
    key("ArrowDown");
    expect(active()).toBe(rows()[1]);
    key("End");
    expect(active()).toBe(rows()[4]);
    expect(active()!.querySelector(".name")!.textContent).toBe("f00004");
  });

  it("counts the rows of a windowed list, the header included", () => {
    mount(make(1000));
    expect(pane().getAttribute("aria-rowcount")).toBe("1001");
    expect(host.querySelector(".pane-head")!.getAttribute("aria-rowindex")).toBe("1");
    expect(rows().length).toBe(10 + OVERSCAN);
    expect(rows().slice(0, 3).map(r => r.getAttribute("aria-rowindex"))).toEqual(["2", "3", "4"]);
    key("End");
    const last = active()!;
    expect(last.dataset.orig).toBe("999");
    expect(last.getAttribute("aria-rowindex")).toBe("1001");
  });

  it("starts the count at the first file where no header shows (Miller's column)", () => {
    const real = window.getComputedStyle;
    vi.spyOn(window, "getComputedStyle").mockImplementation(((el: Element, pseudo?: string | null) => {
      const cs = real(el, pseudo);
      return el.classList.contains("pane-head") ? new Proxy(cs, { get: (t, p) => (p === "display" ? "none" : Reflect.get(t, p)) }) : cs;
    }) as typeof window.getComputedStyle);
    mount(make(1000));
    expect(pane().getAttribute("aria-rowcount")).toBe("1000");
    expect(rows()[0].getAttribute("aria-rowindex")).toBe("1");
  });

  it("never names a row that scrolled out of the page", () => {
    mount(make(1000));
    key("ArrowDown");
    expect(active()!.dataset.orig).toBe("1");
    // The wheel, not the keys: the focused row leaves the window.
    scrollTo(500 * ROW_H);
    expect(host.querySelector('.row[data-orig="1"]')).toBeNull();
    expect(pane().hasAttribute("aria-activedescendant")).toBe(false);
    // Back in view, it's named again.
    scrollTo(0);
    expect(active()!.dataset.orig).toBe("1");
    // And a key from far away brings the row in with its name.
    scrollTo(500 * ROW_H);
    key("ArrowDown");
    expect(active()!.dataset.orig).toBe("2");
  });

  it("names nothing in an empty folder or when a filter hides every row", () => {
    mount([]);
    expect(pane().hasAttribute("aria-activedescendant")).toBe(false);
    expect(pane().getAttribute("aria-rowcount")).toBe("1");
    // The notice isn't a row, so it isn't in a rowgroup.
    expect(rowsEl().getAttribute("role")).toBe("presentation");
    expect(host.querySelector(".pane-notice")!.textContent).toBe("empty folder");
  });

  it("gives another folder's rows new ids, and a re-list of the same folder the same ones", () => {
    mount(make(3));
    const before = active()!.id;
    // A watcher refresh: the same folder, a new array.
    act(() => set(s => ({ ...s, files: make(3) })));
    expect(active()!.id).toBe(before);
    // A navigation: the path changes first, the rows after.
    act(() => set(s => ({ ...s, path: "/w/sub" })));
    expect(active()!.id).toBe(before);
    act(() => set(s => ({ ...s, files: make(4, "/w/sub") })));
    expect(active()!.id).not.toBe(before);
    expect(active()).toBe(rows()[0]);
  });

  it("keeps ids apart between two panes, and names each", () => {
    act(() => root.render(<><Host files={make(2)} path="/a" paneName="pane 1" /><Host files={make(2)} path="/a" paneName="pane 2" /></>));
    const ids = [...host.querySelectorAll(".row")].map(r => r.id);
    expect(new Set(ids).size).toBe(4);
    expect([...host.querySelectorAll(".pane")].map(p => p.getAttribute("aria-label"))).toEqual(["Files in a, pane 1", "Files in a, pane 2"]);
  });
});

describe("the card modes: a listbox", () => {
  it("is a listbox of options, with no grid parts", () => {
    cardMode();
    mount([row("src", { kind: "folder" }), row("a", { ext: "txt" })]);
    expect(pane().getAttribute("role")).toBe("listbox");
    expect(pane().getAttribute("aria-multiselectable")).toBe("true");
    expect(pane().hasAttribute("aria-rowcount")).toBe(false);
    expect(rowsEl().getAttribute("role")).toBe("presentation");
    const [dir, file] = rows();
    expect(dir.getAttribute("role")).toBe("option");
    expect(dir.hasAttribute("aria-rowindex")).toBe(false);
    expect([...dir.querySelectorAll("[role]")].map(c => c.getAttribute("role"))).toEqual([]);
    expect(dir.getAttribute("aria-selected")).toBe("false");
    // The option's name is its text: the folder says so, the icon doesn't.
    expect(dir.querySelector(".ic")!.getAttribute("aria-hidden")).toBe("true");
    expect(dir.querySelector(".name")!.textContent).toBe("src, folder");
    expect(file.querySelector(".name")!.textContent).toBe("a.txt");
    expect(active()).toBe(dir);
  });
});

describe("column headers", () => {
  it("say how their column is sorted", () => {
    mount(make(3));
    const sort = () => Object.fromEntries(heads().map(h => [h.dataset.sort, h.getAttribute("aria-sort")]));
    expect(sort()).toEqual({ name: "ascending", tag: null, size: null, modified: null, git: null });
    act(() => heads()[2].click());
    expect(sort()).toEqual({ name: null, tag: null, size: "ascending", modified: null, git: null });
    act(() => heads()[2].click());
    expect(sort().size).toBe("descending");
    expect(said()).toBe("sorted by size, descending");
  });

  it("take the focus with Up from the first row, and give it back with Down", () => {
    mount(make(3));
    pane().focus();
    key("ArrowDown");
    key("ArrowUp");
    expect(document.activeElement).toBe(pane());
    expect(current().focus).toBe(0);
    key("ArrowUp");
    expect(document.activeElement).toBe(heads()[0]);
    // The rows stay as they were.
    expect(current().focus).toBe(0);
    expect(current().selected).toEqual([0]);
    key("ArrowDown");
    expect(document.activeElement).toBe(pane());
    expect(current().focus).toBe(0);
  });

  it("stay out of the way of a held Up, and of Shift+Up", () => {
    mount(make(3));
    pane().focus();
    key("ArrowUp", { repeat: true });
    key("ArrowUp", { shiftKey: true });
    expect(document.activeElement).toBe(pane());
  });

  it("move with Left, Right, Home and End, and sort with Enter or Space", () => {
    mount(make(3));
    pane().focus();
    key("ArrowUp");
    key("ArrowRight");
    key("ArrowRight");
    expect(document.activeElement).toBe(heads()[2]);
    const enter = key("Enter");
    // Prevented: the keymap's Open leaves a handled Enter alone.
    expect(enter.defaultPrevented).toBe(true);
    expect([current().sortKey, current().sortDir]).toEqual(["size", "asc"]);
    expect(key(" ").defaultPrevented).toBe(true);
    expect([current().sortKey, current().sortDir]).toEqual(["size", "desc"]);
    // The header keeps the focus through the re-sort.
    expect(document.activeElement).toBe(heads()[2]);
    key("End");
    expect(document.activeElement).toBe(heads()[4]);
    key("ArrowRight");
    expect(document.activeElement).toBe(heads()[4]);
    key("Home");
    key("ArrowLeft");
    expect(document.activeElement).toBe(heads()[0]);
    // Up from the rows lands on the sorted column.
    key("Escape");
    expect(document.activeElement).toBe(pane());
    key("ArrowUp");
    expect(document.activeElement).toBe(heads()[2]);
  });

  it("leave the rows' keys alone while a header has the focus", () => {
    mount(make(3));
    pane().focus();
    key("ArrowDown");
    key("Home");
    key("ArrowUp");
    expect(document.activeElement).toBe(heads()[0]);
    key("a", { ctrlKey: true });
    key("x");
    expect(current().selected).toEqual([0]);
    expect(current().focus).toBe(0);
  });

  it("keep the focus on the pane when one is clicked", () => {
    mount(make(3));
    pane().focus();
    const down = new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 });
    act(() => { heads()[1].dispatchEvent(down); });
    expect(down.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(pane());
  });

  it("aren't reached from a list with no header (the card modes)", () => {
    cardMode();
    mount(make(3));
    pane().focus();
    key("ArrowUp");
    expect(document.activeElement).toBe(pane());
  });
});

describe("what's announced", () => {
  it("says a folder and its size once its rows are in, not on a re-list", () => {
    mount(make(3), "/home/u");
    expect(said()).toBe("");
    act(() => set(s => ({ ...s, path: "/home/u/Music", loading: true })));
    expect(said()).toBe("");
    act(() => set(s => ({ ...s, files: make(12, "/home/u/Music"), loading: false })));
    expect(said()).toBe("Music: 12 items");
    act(() => set(s => ({ ...s, files: make(13, "/home/u/Music") })));
    expect(said()).toBe("Music: 12 items");
    act(() => set(s => ({ ...s, path: "/home/u/Empty", files: [] })));
    expect(said()).toBe("Empty: empty");
    act(() => set(s => ({ ...s, path: "/home/u/One", files: make(1, "/home/u/One") })));
    expect(said()).toBe("One: 1 item");
  });

  it("leaves a folder that can't be read to its own alert", () => {
    mount(make(3), "/home/u");
    act(() => set(s => ({ ...s, path: "/root", files: [], error: "permission denied" })));
    expect(said()).toBe("");
    expect(host.querySelector(".pane-notice.error")!.getAttribute("role")).toBe("alert");
  });

  it("doesn't call another tab's order a re-sort", () => {
    mount(make(3), "/a");
    act(() => set(s => ({ ...s, path: "/b", files: make(2, "/b"), sortKey: "size", sortDir: "desc" })));
    expect(said()).toBe("b: 2 items");
  });
});

describe("10,000 rows", () => {
  it("renders a window of them, and a selection or focus change re-renders two rows", () => {
    mount(make(10_000));
    expect(rows().length).toBe(10 + OVERSCAN);
    expect(pane().getAttribute("aria-rowcount")).toBe("10001");
    pane().focus();
    typeCalls.n = 0;
    key("ArrowDown");
    // The row left and the row reached.
    expect(typeCalls.n).toBe(2);
    expect(active()!.dataset.orig).toBe("1");
    typeCalls.n = 0;
    key("ArrowDown", { shiftKey: true });
    expect(typeCalls.n).toBe(2);
    expect(rows().filter(r => r.getAttribute("aria-selected") === "true").map(r => r.dataset.orig)).toEqual(["1", "2"]);
  });

  it("re-renders two rows in a card mode too, where every row is in the page", () => {
    cardMode();
    mount(make(2_000));
    expect(rows().length).toBe(2_000);
    typeCalls.n = 0;
    key("ArrowDown");
    expect(typeCalls.n).toBe(2);
    expect(active()!.dataset.orig).toBe("1");
  });
});
