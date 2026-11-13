// @vitest-environment happy-dom
// The command palette in a DOM: what Enter and a click send, that the arrow
// keys follow the rows as shown, and a typed path.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Palette } from "./components";
import { PALETTE_ENTRIES } from "./palette";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
const onCommand = vi.fn();
const onClose = vi.fn();

const input = () => host.querySelector<HTMLInputElement>(".palette-head input")!;
const rows = () => [...host.querySelectorAll<HTMLElement>(".pal-row")];
const active = () => host.querySelector<HTMLElement>(".pal-row.active");
const nameOf = (row: HTMLElement | null) => row?.querySelector(".name > span")?.textContent;
const whereOf = (row: HTMLElement | null) => row?.querySelector(".where")?.textContent;
const headers = () => [...host.querySelectorAll(".pal-group")].map(h => h.textContent);

async function type(text: string) {
  await act(async () => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    set.call(input(), text);
    input().dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function press(key: string) {
  await act(async () => {
    input().dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  });
}

beforeEach(async () => {
  onCommand.mockReset();
  onClose.mockReset();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root.render(<Palette onClose={onClose} onCommand={onCommand} />); });
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("Palette", () => {
  it("lists every command under its menu, with no promises it can't keep", () => {
    expect(rows()).toHaveLength(PALETTE_ENTRIES.length);
    expect(headers().slice(0, 3)).toEqual(["File", "Edit", "Select"]);
    // Under the File header a row shows only its submenu.
    expect(whereOf(rows()[0])).toBeUndefined();
    expect(whereOf(rows().find(r => nameOf(r) === "Folder")!)).toBe("New");
    expect(document.activeElement).toBe(input());
    const text = host.textContent ?? "";
    for (const gone of [":mode", "autocomplete", "run in terminal", "!shell", ":help"]) expect(text).not.toContain(gone);
    expect(input().placeholder).toContain("path");
  });

  it("runs the best match on Enter and closes", async () => {
    await type("new folder");
    expect(nameOf(active())).toBe("Folder");
    expect(whereOf(active())).toBe("File › New");
    expect([...active()!.querySelectorAll(".kb span")].map(k => k.textContent)).toEqual(["Ctrl", "Shift", "D"]);
    // Results are one list, best first: no group headers.
    expect(headers()).toEqual([]);
    await press("Enter");
    expect(onCommand).toHaveBeenCalledWith("Folder");
    expect(onClose).toHaveBeenCalled();
  });

  it("keeps its Enter from a dialog the command opens", async () => {
    // A prompt adds a window keydown listener when it opens, during the
    // same Enter that ran the command, and used to submit itself.
    const dialogEnter = vi.fn();
    onCommand.mockImplementation(() => window.addEventListener("keydown", dialogEnter));
    await type("new folder");
    await press("Enter");
    window.removeEventListener("keydown", dialogEnter);
    expect(onCommand).toHaveBeenCalledWith("Folder");
    expect(dialogEnter).not.toHaveBeenCalled();
  });

  it("sends the item's dispatch label, not its name", async () => {
    await type("open in new window");
    await press("Enter");
    expect(onCommand).toHaveBeenCalledWith("New Window");
  });

  it("moves the highlight down the rows as shown", async () => {
    const shown = rows();
    expect(active()).toBe(shown[0]);
    await press("ArrowDown");
    await press("ArrowDown");
    expect(active()).toBe(rows()[2]);
    await press("ArrowUp");
    expect(active()).toBe(rows()[1]);
    await press("Enter");
    expect(onCommand).toHaveBeenCalledWith(PALETTE_ENTRIES[1].send);
  });

  it("runs a clicked row", async () => {
    await type("git push");
    await act(async () => { rows()[0].click(); });
    expect(onCommand).toHaveBeenCalledWith("Push");
    expect(onClose).toHaveBeenCalled();
  });

  it("sends a typed path as is", async () => {
    await type("~/src/glasshouse");
    expect(nameOf(active())).toBe("Go to ~/src/glasshouse");
    await press("Enter");
    expect(onCommand).toHaveBeenCalledWith("~/src/glasshouse");
  });

  it("keeps Tab in the box and closes on Escape", async () => {
    const tab = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    await act(async () => { input().dispatchEvent(tab); });
    expect(tab.defaultPrevented).toBe(true);
    await press("Escape");
    expect(onClose).toHaveBeenCalled();
    expect(onCommand).not.toHaveBeenCalled();
  });

  it("says when nothing matches, and Enter then only closes", async () => {
    await type("qqzzxx");
    expect(rows()).toEqual([]);
    expect(host.textContent).toContain("no matching command");
    await press("ArrowDown");
    await press("Enter");
    expect(onCommand).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });
});
