// @vitest-environment happy-dom
// The file pane's windowed list in a DOM: which rows are rendered, keyboard
// focus scrolling, and the marquee. happy-dom has no layout, so the rows
// container's size and the row height are stubbed below; every
// getBoundingClientRect is zero, so client coordinates are pane coordinates.
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { FilePane } from "./components";
import type { FileRow } from "./data";
import { remapIndexes } from "./listing";
import { OVERSCAN } from "./paneWindow";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Row = FileRow & { entry: { path: string } };
const row = (name: string, kind: FileRow["kind"] = "text"): Row => ({
  name, ext: "", kind, size: "", date: "", tag: null, git: null, hidden: false, link: false,
  entry: { path: "/w/" + name },
});
// f0000 … f0999: name order is index order.
const make = (n: number) => Array.from({ length: n }, (_, i) => row("f" + String(i).padStart(4, "0")));
const pathOf = (r: Row) => r.entry.path;

// Ten rows of 26px fill the 260px viewport.
const ROW_H = 26, VIEW_H = 260;
let rowH = ROW_H;
const stubs: Array<[string, PropertyDescriptor | undefined]> = [];
beforeAll(() => {
  const stub = (prop: string, get: (el: HTMLElement) => number) => {
    stubs.push([prop, Object.getOwnPropertyDescriptor(HTMLElement.prototype, prop)]);
    Object.defineProperty(HTMLElement.prototype, prop, { configurable: true, get() { return get(this as HTMLElement); } });
  };
  stub("clientHeight", el => (el.classList.contains("rows") ? VIEW_H : 0));
  stub("clientWidth", el => (el.classList.contains("rows") ? 400 : 0));
  stub("offsetHeight", el => (el.classList.contains("row") ? rowH : 0));
});
afterAll(() => {
  for (const [prop, d] of stubs) if (d) Object.defineProperty(HTMLElement.prototype, prop, d);
});

interface S { files: Row[]; selected: number[]; focus: number; anchor: number; tick: number }
let set: (f: (s: S) => S) => void;
let current: () => S;
function Host({ files }: { files: Row[] }) {
  const [s, setS] = useState<S>({ files, selected: [], focus: 0, anchor: 0, tick: 0 });
  set = setS;
  current = () => s;
  return (
    <FilePane files={s.files} selected={s.selected} setSelected={sel => setS(p => ({ ...p, selected: sel }))}
      focusIndex={s.focus} setFocusIndex={i => setS(p => ({ ...p, focus: i }))}
      anchorIndex={s.anchor} setAnchorIndex={i => setS(p => ({ ...p, anchor: i }))}
      paneFocused={true} setPaneFocused={() => {}} sortKey="name" sortDir="asc"
      onSortChange={() => {}} onContext={() => {}} />
  );
}

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  rowH = ROW_H;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

const mount = (files: Row[]) => act(() => root.render(<Host files={files} />));
const rowsEl = () => host.querySelector<HTMLDivElement>(".rows")!;
const rendered = () => [...host.querySelectorAll<HTMLElement>(".row")].map(r => Number(r.dataset.orig));
const spacers = () => [...host.querySelectorAll<HTMLElement>(".rows-spacer")].map(s => s.style.height);
const scrollTo = (top: number) => act(() => {
  rowsEl().scrollTop = top;
  rowsEl().dispatchEvent(new Event("scroll"));
});
const key = (k: string) => act(() => {
  host.querySelector(".pane")!.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));
});
const range = (a: number, b: number) => Array.from({ length: b - a }, (_, i) => a + i);

describe("windowed file list", () => {
  it("renders the rows in view plus overscan, with a spacer for the rest", () => {
    mount(make(1000));
    expect(rendered()).toEqual(range(0, 10 + OVERSCAN));
    expect(spacers()).toEqual([`${(1000 - 10 - OVERSCAN) * ROW_H}px`]);
  });

  it("follows the scroll, starting on an even row so the striping stays put", () => {
    mount(make(1000));
    scrollTo(101 * ROW_H);
    const shown = rendered();
    expect(shown[0]).toBe(80);
    // Rows 101-110 are in view, then the overscan.
    expect(shown.at(-1)).toBe(110 + OVERSCAN);
    expect(spacers()[0]).toBe(`${80 * ROW_H}px`);
  });

  it("uses the row height it measures, which follows density and display mode", () => {
    rowH = 18;
    mount(make(1000));
    expect(rendered().length).toBe(Math.ceil(VIEW_H / 18) + OVERSCAN);
    expect(spacers()[0]).toBe(`${(1000 - rendered().length) * 18}px`);
  });

  it("renders every row in the card modes, which wrap rows into columns", () => {
    const real = window.getComputedStyle.bind(window);
    vi.spyOn(window, "getComputedStyle").mockImplementation(el =>
      (el as HTMLElement).classList.contains("rows") ? ({ display: "grid" } as CSSStyleDeclaration) : real(el));
    mount(make(300));
    expect(rendered()).toEqual(range(0, 300));
    expect(spacers()).toEqual([]);
  });

  it("scrolls End's row into view and renders it, and Home's", () => {
    mount(make(1000));
    key("End");
    expect(current().focus).toBe(999);
    expect(rowsEl().scrollTop).toBe(1000 * ROW_H - VIEW_H);
    expect(rendered()).toContain(999);
    expect(host.querySelector('.row[data-orig="999"]')!.classList).toContain("focused");
    key("Home");
    expect(rowsEl().scrollTop).toBe(0);
    expect(rendered()[0]).toBe(0);
  });

  it("doesn't scroll back to the focused row when the pane re-renders", () => {
    mount(make(1000));
    scrollTo(500 * ROW_H);
    act(() => set(p => ({ ...p, selected: [3], tick: p.tick + 1 })));
    expect(rowsEl().scrollTop).toBe(500 * ROW_H);
    expect(rendered()).toContain(500);
  });
});

describe("marquee in the windowed list", () => {
  const down = (y: number, opts: MouseEventInit = {}) => act(() => {
    rowsEl().dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0, clientX: 100, clientY: y, ...opts }));
  });
  const move = (y: number) => act(() => {
    window.dispatchEvent(new MouseEvent("mousemove", { clientX: 150, clientY: y }));
  });
  const up = () => act(() => { window.dispatchEvent(new MouseEvent("mouseup")); });

  it("selects the rows the box covers, from their positions", () => {
    mount(make(1000));
    down(30);
    move(100);
    expect(current().selected).toEqual([1, 2, 3]);
    up();
    expect(host.querySelector(".marquee")).toBeNull();
  });

  it("counts the scrolled-off rows above the viewport", () => {
    mount(make(1000));
    scrollTo(200 * ROW_H);
    down(5);
    move(-3 * ROW_H);
    // From row 200 up past the viewport's top edge, to row 197.
    expect(current().selected).toEqual([197, 198, 199, 200]);
    up();
  });

  it("keeps a shift-marquee's starting selection on the same files when the folder re-lists", () => {
    const files = make(100);
    mount(files);
    act(() => set(p => ({ ...p, selected: [5] })));
    down(900, { shiftKey: true });
    // Mid-drag, a file appears before the others, and the listing moves the
    // selection with it: f0005 is now index 6.
    const next = [row("a-new"), ...files];
    act(() => set(p => ({ ...p, files: next, selected: remapIndexes(p.files, next, p.selected, pathOf) })));
    move(920);
    // The box covers positions 34 and 35 and adds them to f0005. Without the
    // remap, index 5 (now f0004) would have been added instead.
    expect(current().selected.map(i => next[i].name).sort()).toEqual(["f0005", next[34].name, next[35].name].sort());
    up();
  });
});
