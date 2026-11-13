// @vitest-environment happy-dom
// DialogHost's pick list (dialogs.showPick), which Find File by Name shows its
// matches in: the arrow keys move, Enter and a click pick, Esc cancels.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DialogHost, dialogs, pickMove } from "./DialogHost";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
const options = () => [...host.querySelectorAll<HTMLElement>("[role=option]")];
const chosen = () => options().findIndex(o => o.getAttribute("aria-selected") === "true");

/** Opens the list; `picked` is what it resolves with. (Wrapped: an async
 *  function returning the promise itself would wait for it.) */
async function open(items: string[]): Promise<{ picked: Promise<number | null> }> {
  let picked!: Promise<number | null>;
  await act(async () => { picked = dialogs.showPick({ title: "2 matches", items }); });
  // The list takes focus after a tick.
  await act(async () => { await new Promise(r => setTimeout(r, 0)); });
  return { picked };
}
async function press(key: string) {
  await act(async () => {
    (document.activeElement ?? window).dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  });
}

beforeEach(async () => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root.render(<DialogHost />); });
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("showPick", () => {
  it("lists the items with the first chosen and the keyboard on the list", async () => {
    await open(["a/notes.md", "b/notes.txt"]);
    expect(options().map(o => o.textContent)).toEqual(["a/notes.md", "b/notes.txt"]);
    expect(chosen()).toBe(0);
    expect(document.activeElement?.getAttribute("role")).toBe("listbox");
    await press("Escape");
  });

  it("moves with the arrows and picks with Enter", async () => {
    const { picked } = await open(["a", "b", "c"]);
    await press("ArrowDown");
    await press("ArrowDown");
    await press("ArrowDown");
    await press("ArrowUp");
    expect(chosen()).toBe(1);
    await press("Enter");
    await expect(picked).resolves.toBe(1);
    expect(options()).toEqual([]);
  });

  it("picks the row clicked", async () => {
    const { picked } = await open(["a", "b", "c"]);
    await act(async () => { options()[2].click(); });
    await expect(picked).resolves.toBe(2);
  });

  it("resolves null on Esc", async () => {
    const { picked } = await open(["a"]);
    await press("Escape");
    await expect(picked).resolves.toBeNull();
  });
});

describe("pickMove", () => {
  it("steps, pages and jumps, within the list", () => {
    expect(pickMove("ArrowDown", 0, 3)).toBe(1);
    expect(pickMove("ArrowDown", 2, 3)).toBe(2);
    expect(pickMove("ArrowUp", 0, 3)).toBe(0);
    expect(pickMove("PageDown", 0, 30)).toBe(10);
    expect(pickMove("PageDown", 25, 30)).toBe(29);
    expect(pickMove("PageUp", 5, 30)).toBe(0);
    expect(pickMove("Home", 7, 30)).toBe(0);
    expect(pickMove("End", 7, 30)).toBe(29);
    expect(pickMove("a", 7, 30)).toBeNull();
  });
});
