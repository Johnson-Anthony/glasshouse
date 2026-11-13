// @vitest-environment happy-dom
// The pane's own drag: Ctrl copies, a plain or Shift drag moves, the ghost
// follows Ctrl mid-drag, and leaving the window hands the drag to the OS,
// with the Ctrl state.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FilePane } from "./components";
import type { FileRow } from "./data";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Row = FileRow & { entry: { path: string } };
const row = (name: string, kind: FileRow["kind"] = "text"): Row => ({
  name, ext: "", kind, size: "", date: "", tag: null, git: null, hidden: false, link: false,
  entry: { path: "/w/" + name },
});
// Folders sort first: "dest" (0) and "other" (1), then the files.
const files = [row("dest", "folder"), row("other", "folder"), row("a.txt"), row("b.txt")];

let host: HTMLDivElement;
let root: Root;
const onRowDrop = vi.fn();
const onExternalDrag = vi.fn();
const onDragOut = vi.fn();
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  const noop = () => {};
  act(() => root.render(
    <FilePane files={files} selected={[]} setSelected={noop} focusIndex={0} setFocusIndex={noop}
      anchorIndex={0} setAnchorIndex={noop} paneFocused={false} setPaneFocused={noop}
      sortKey="name" sortDir="asc" onSortChange={noop} onContext={noop} dropPath="/w"
      onRowDrop={onRowDrop} onExternalDrag={onExternalDrag} onDragOut={onDragOut} />,
  ));
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  onRowDrop.mockReset(); onExternalDrag.mockReset(); onDragOut.mockReset();
});

const rowEl = (orig: number) => host.querySelector<HTMLElement>(`.row[data-orig="${orig}"]`)!;
// happy-dom has no layout: the pointer is over whatever this returns.
const over = (el: Element | null) => { document.elementFromPoint = () => el; };
const press = (orig: number) => act(() => {
  rowEl(orig).dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, clientX: 100, clientY: 100 }));
});
const move = (x: number, y: number, keys: PointerEventInit = {}) => act(() => {
  window.dispatchEvent(new PointerEvent("pointermove", { clientX: x, clientY: y, ...keys }));
});
const release = (keys: PointerEventInit = {}) => act(() => {
  window.dispatchEvent(new PointerEvent("pointerup", { clientX: 140, clientY: 140, ...keys }));
});
const ghost = () => document.querySelector(".drag-ghost")?.textContent;

describe("dragging rows inside the window", () => {
  it("moves on a plain drop and on Shift, copies on Ctrl", () => {
    for (const [keys, copy] of [[{}, false], [{ shiftKey: true }, false], [{ ctrlKey: true }, true]] as const) {
      over(rowEl(0));
      press(2);
      move(140, 140, keys);
      release(keys);
      expect(onRowDrop).toHaveBeenLastCalledWith(0, [2], copy);
    }
  });

  it("shows the operation on the ghost, following Ctrl before the pointer moves", () => {
    over(rowEl(0));
    press(2);
    move(140, 140);
    expect(ghost()).toBe("move 1 item");
    act(() => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Control", ctrlKey: true })); });
    expect(ghost()).toBe("copy 1 item");
    act(() => { window.dispatchEvent(new KeyboardEvent("keyup", { key: "Control" })); });
    expect(ghost()).toBe("move 1 item");
    release();
    expect(ghost()).toBeUndefined();
  });

  it("lights up a tab it passes over, but not the pane's own folder", () => {
    const tab = document.createElement("div");
    tab.dataset.dropPath = "/x";
    document.body.append(tab);
    over(rowEl(0));
    press(2);
    move(140, 140);
    over(tab);
    move(150, 150);
    expect(tab.classList.contains("drop-target")).toBe(true);
    over(host.querySelector(".pane"));
    move(160, 160);
    expect(tab.classList.contains("drop-target")).toBe(false);
    expect(host.querySelector(".pane")!.classList.contains("drop-target")).toBe(false);
    release();
    expect(onExternalDrag).toHaveBeenCalledWith([2], 140, 140, false);
    tab.remove();
  });
});

describe("dragging rows out of the window", () => {
  it("hands the drag to the OS at the window's edge, and drops nothing itself", () => {
    over(rowEl(0));
    press(3);
    move(140, 140);
    move(-4, 140);
    expect(onDragOut).toHaveBeenCalledWith([3], false);
    expect(ghost()).toBeUndefined();
    release();
    expect(onRowDrop).not.toHaveBeenCalled();
    expect(onExternalDrag).not.toHaveBeenCalled();
  });

  it("hands it over when the pointer leaves the page", () => {
    over(rowEl(0));
    press(3);
    move(140, 140);
    act(() => { window.dispatchEvent(new MouseEvent("mouseout", { relatedTarget: null })); });
    expect(onDragOut).toHaveBeenCalledWith([3], false);
  });

  it("says whether Ctrl was held as it left", () => {
    over(rowEl(0));
    press(3);
    move(140, 140);
    move(140, 0, { ctrlKey: true });
    expect(onDragOut).toHaveBeenCalledWith([3], true);
  });

  it("doesn't hand over a press that never became a drag", () => {
    press(3);
    act(() => { window.dispatchEvent(new MouseEvent("mouseout", { relatedTarget: null })); });
    move(102, 101);
    release();
    expect(onDragOut).not.toHaveBeenCalled();
  });
});
