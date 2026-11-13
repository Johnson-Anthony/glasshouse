// @vitest-environment happy-dom
// The menubar and the context menu from the keyboard: arrow keys, Enter and
// Esc, submenus, Alt and F10, mnemonics, and focus going back where it was.
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ContextMenu, Menubar } from "./menus";
import { MENUS, type MenuItemDef } from "./data";
import { holdModal } from "./dialogs/modal";

vi.mock("@tauri-apps/api/app", () => ({ getVersion: () => Promise.reject(new Error("no tauri")) }));
vi.mock("./api", async (orig) => ({
  ...(await orig<typeof import("./api")>()),
  gitBranchList: async () => [],
  listShellProfiles: async () => [],
  readPins: async () => [],
  readRecent: async () => [],
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
/** Had focus before a menu opened. */
let before: HTMLButtonElement;
const onCommand = vi.fn();
/** Keys that got past the menus to App's window listener. */
const reachedWindow = vi.fn();

beforeEach(() => {
  onCommand.mockReset();
  reachedWindow.mockReset();
  window.addEventListener("keydown", reachedWindow);
  before = document.createElement("button");
  document.body.append(before);
  before.focus();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  window.removeEventListener("keydown", reachedWindow);
  host.remove();
  before.remove();
  document.querySelectorAll(".term-drawer").forEach(n => n.remove());
});

/** Presses `key` where focus is, as the browser would: keydown, then keyup. */
async function press(key: string, mods: KeyboardEventInit = {}, code?: string) {
  const target = document.activeElement ?? document.body;
  const init = { key, code: code ?? key, bubbles: true, cancelable: true, ...mods };
  await act(async () => { target.dispatchEvent(new KeyboardEvent("keydown", init)); });
  await act(async () => { target.dispatchEvent(new KeyboardEvent("keyup", init)); });
}
/** Alt pressed and released with nothing in between. */
const tapAlt = () => press("Alt", {}, "AltLeft");
const altLetter = async (letter: string) => {
  const target = document.activeElement ?? document.body;
  await act(async () => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key: "Alt", code: "AltLeft", bubbles: true }));
    target.dispatchEvent(new KeyboardEvent("keydown", { key: letter, code: `Key${letter.toUpperCase()}`, altKey: true, bubbles: true, cancelable: true }));
    target.dispatchEvent(new KeyboardEvent("keyup", { key: letter, code: `Key${letter.toUpperCase()}`, altKey: true, bubbles: true }));
    target.dispatchEvent(new KeyboardEvent("keyup", { key: "Alt", code: "AltLeft", bubbles: true }));
  });
};
const hover = (el: Element) => act(() => {
  el.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, relatedTarget: null }));
});
const click = (el: Element) => act(() => {
  el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
  el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
});

const labelOf = (el: Element | null | undefined) => el?.children[1]?.textContent;
/** The highlighted item of each open list, outermost first. */
const highlighted = () => [...host.querySelectorAll(".mi.hover")].map(labelOf);

// ─── context menu ───────────────────────────────────────────────────────────

const item = (label: string, kb?: string): MenuItemDef => ({ kind: "item", label, kb });
const CTX: MenuItemDef[] = [
  item("Open"),
  { kind: "sep" },
  item("Copy"),
  { kind: "sub", label: "Send to", children: [item("Desktop"), item("Mail")] },
  item("Rename"),
];

function CtxHost({ keyboard, items = CTX, onCmd = onCommand }: { keyboard?: boolean; items?: MenuItemDef[]; onCmd?: (l: string) => void }) {
  const [open, setOpen] = useState(true);
  return open ? <ContextMenu items={items} x={10} y={10} keyboard={keyboard} onClose={() => setOpen(false)} onCommand={onCmd} /> : null;
}
const ctxMenu = () => host.querySelector<HTMLElement>(".ctx-menu");

describe("context menu", () => {
  it("opened from the keyboard: takes focus on its first item, Enter runs one, focus goes back", async () => {
    await act(async () => root.render(<CtxHost keyboard />));
    expect(document.activeElement).toBe(ctxMenu());
    expect(highlighted()).toEqual(["Open"]);
    await press("ArrowDown");
    expect(highlighted()).toEqual(["Copy"]);
    await press("Enter");
    expect(onCommand).toHaveBeenCalledWith("Copy");
    expect(ctxMenu()).toBeNull();
    expect(document.activeElement).toBe(before);
  });

  it("opened by the mouse: nothing highlighted until a key or the pointer moves", async () => {
    await act(async () => root.render(<CtxHost />));
    expect(document.activeElement).toBe(ctxMenu());
    expect(highlighted()).toEqual([]);
    await press("ArrowUp");
    expect(highlighted()).toEqual(["Rename"]);
    await hover([...host.querySelectorAll(".mi")].find(m => labelOf(m) === "Copy")!);
    expect(highlighted()).toEqual(["Copy"]);
    // The keys go on from where the pointer was.
    await press("ArrowDown");
    expect(highlighted()).toEqual(["Send to"]);
  });

  it("goes into a submenu with → and out with ← or Esc", async () => {
    await act(async () => root.render(<CtxHost keyboard />));
    await press("End");
    await press("ArrowUp");
    expect(highlighted()).toEqual(["Send to"]);
    await press("ArrowRight");
    expect(highlighted()).toEqual(["Send to", "Desktop"]);
    expect(host.querySelector(".mi .dropdown")).not.toBeNull();
    await press("ArrowDown");
    expect(highlighted()).toEqual(["Send to", "Mail"]);
    await press("ArrowLeft");
    expect(highlighted()).toEqual(["Send to"]);
    expect(host.querySelector(".mi .dropdown")).toBeNull();
    await press("Enter");
    await press("Escape");
    expect(highlighted()).toEqual(["Send to"]);
    await press("ArrowRight");
    await press("Enter");
    expect(onCommand).toHaveBeenCalledWith("Desktop");
    expect(document.activeElement).toBe(before);
  });

  it("opens a submenu under the pointer; keys stay in the parent until → goes in", async () => {
    await act(async () => root.render(<CtxHost />));
    const mi = (label: string) => [...host.querySelectorAll(".mi")].find(m => labelOf(m) === label)!;
    await hover(mi("Send to"));
    expect(host.querySelector(".mi .dropdown")).not.toBeNull();
    expect(highlighted()).toEqual(["Send to"]);
    await hover(mi("Mail"));
    expect(highlighted()).toEqual(["Send to", "Mail"]);
    await hover(mi("Copy"));
    expect(host.querySelector(".mi .dropdown")).toBeNull();
    await hover(mi("Send to"));
    await press("ArrowDown");
    expect(highlighted()).toEqual(["Rename"]);
    expect(host.querySelector(".mi .dropdown")).toBeNull();
    await hover(mi("Send to"));
    await press("ArrowRight");
    expect(highlighted()).toEqual(["Send to", "Desktop"]);
  });

  it("closes on Esc or Tab and gives focus back, running nothing", async () => {
    await act(async () => root.render(<CtxHost keyboard />));
    await press("Escape");
    expect(ctxMenu()).toBeNull();
    expect(document.activeElement).toBe(before);
    await act(async () => root.render(<></>));
    await act(async () => root.render(<CtxHost />));
    await press("Tab");
    expect(ctxMenu()).toBeNull();
    expect(document.activeElement).toBe(before);
    expect(onCommand).not.toHaveBeenCalled();
  });

  it("jumps to an item by its first letter", async () => {
    await act(async () => root.render(<CtxHost />));
    await press("r");
    expect(highlighted()).toEqual(["Rename"]);
    await press("o");
    expect(highlighted()).toEqual(["Open"]);
  });

  it("keeps the keys from the pane and App's shortcuts while it's open", async () => {
    await act(async () => root.render(<CtxHost keyboard />));
    for (const k of ["Delete", "ArrowDown", "Enter"]) await press(k);
    expect(reachedWindow).not.toHaveBeenCalled();
  });

  it("gives focus back so the pane's own focus handler runs (it draws the focused row)", async () => {
    function PaneAndMenu() {
      const [focused, setFocused] = useState(false);
      const [open, setOpen] = useState(false);
      return (
        <>
          <section className="fake-pane" tabIndex={0} data-focused={focused}
            onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
            onKeyDown={(e) => { if (e.key === "ContextMenu") setOpen(true); }} />
          {open && <ContextMenu items={CTX} x={0} y={0} keyboard onClose={() => setOpen(false)} />}
        </>
      );
    }
    await act(async () => root.render(<PaneAndMenu />));
    const pane = host.querySelector<HTMLElement>(".fake-pane")!;
    await act(async () => pane.focus());
    await press("ContextMenu");
    expect(document.activeElement).toBe(ctxMenu());
    expect(pane.dataset.focused).toBe("false");
    await press("Escape");
    expect(document.activeElement).toBe(pane);
    expect(pane.dataset.focused).toBe("true");
  });

  it("leaves focus alone when the command moved it, as a dialog's field does", async () => {
    const field = document.createElement("input");
    document.body.append(field);
    await act(async () => root.render(<CtxHost keyboard onCmd={() => field.focus()} />));
    await press("Enter");
    expect(document.activeElement).toBe(field);
    field.remove();
  });
});

// ─── menubar ────────────────────────────────────────────────────────────────

const TITLES = Object.keys(MENUS);
const bar = () => host.querySelector<HTMLElement>(".menubar")!;
const titleEl = (t: string) => [...host.querySelectorAll(".menubar-item")].find(el => el.textContent?.startsWith(t))!;
const hotTitle = () => host.querySelector(".menubar-item.hot")?.textContent ?? null;
const openTitle = () => host.querySelector(".menubar-item.open > span")?.textContent ?? null;
const firstLabel = (menu: string) => (MENUS[menu].find(i => i.kind === "item" || i.kind === "sub") as { label: string }).label;

async function mountBar() {
  await act(async () => root.render(<Menubar onOpenPalette={() => {}} onCommand={onCommand} />));
  before.focus();
}

describe("menubar", () => {
  it("Alt alone highlights the first title; ← → move; ↓ opens; Esc twice leaves and gives focus back", async () => {
    await mountBar();
    await tapAlt();
    expect(document.activeElement).toBe(bar());
    expect(hotTitle()).toBe(TITLES[0]);
    expect(openTitle()).toBeNull();
    await press("ArrowLeft");
    expect(hotTitle()).toBe(TITLES.at(-1));
    await press("ArrowRight");
    await press("ArrowRight");
    expect(hotTitle()).toBe(TITLES[1]);
    await press("ArrowDown");
    expect(openTitle()).toBe(TITLES[1]);
    expect(highlighted()).toEqual([firstLabel(TITLES[1])]);
    await press("Escape");
    expect(openTitle()).toBeNull();
    expect(hotTitle()).toBe(TITLES[1]);
    await press("Escape");
    expect(hotTitle()).toBeNull();
    expect(document.activeElement).toBe(before);
  });

  it("moves to the neighbouring menu with ← and → in an open one", async () => {
    await mountBar();
    await press("F10");
    await press("Enter");
    expect(openTitle()).toBe(TITLES[0]);
    await press("ArrowRight");
    expect(openTitle()).toBe(TITLES[1]);
    expect(highlighted()).toEqual([firstLabel(TITLES[1])]);
    await press("ArrowLeft");
    await press("ArrowLeft");
    expect(openTitle()).toBe(TITLES.at(-1));
  });

  it("F10 opens and closes it", async () => {
    await mountBar();
    await press("F10");
    expect(hotTitle()).toBe(TITLES[0]);
    await press("F10");
    expect(hotTitle()).toBeNull();
    expect(document.activeElement).toBe(before);
  });

  it("Enter runs the item with focus already back, then closes", async () => {
    let focusedAtRun: Element | null = null;
    onCommand.mockImplementation(() => { focusedAtRun = document.activeElement; });
    await mountBar();
    await tapAlt();
    await press("ArrowDown");
    await press("Enter");
    expect(onCommand).toHaveBeenCalledWith(firstLabel(TITLES[0]));
    expect(focusedAtRun).toBe(before);
    expect(openTitle()).toBeNull();
    expect(hotTitle()).toBeNull();
  });

  it("opens a menu by its underlined letter, with Alt or once the bar is active", async () => {
    await mountBar();
    const u = (t: string) => titleEl(t).querySelector(".u")?.textContent;
    expect(u("Go")).toBe("G");
    expect(u("Git")).toBe("i");
    expect(u("Terminal")).toBe("r");
    await altLetter("i");
    expect(openTitle()).toBe("Git");
    expect(highlighted()).toEqual([firstLabel("Git")]);
    await press("Escape");
    await press("v");
    expect(openTitle()).toBe("View");
  });

  it("doesn't count Alt held with another key or a click", async () => {
    await mountBar();
    const target = document.activeElement!;
    await act(async () => {
      target.dispatchEvent(new KeyboardEvent("keydown", { key: "Alt", bubbles: true }));
      target.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", altKey: true, bubbles: true }));
      target.dispatchEvent(new KeyboardEvent("keyup", { key: "Alt", bubbles: true }));
    });
    expect(hotTitle()).toBeNull();
    await act(async () => {
      target.dispatchEvent(new KeyboardEvent("keydown", { key: "Alt", bubbles: true }));
      target.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      target.dispatchEvent(new KeyboardEvent("keyup", { key: "Alt", bubbles: true }));
    });
    expect(hotTitle()).toBeNull();
  });

  it("leaves Alt and F10 to the terminal, and does nothing behind a modal", async () => {
    await mountBar();
    const drawer = document.createElement("div");
    drawer.className = "term-drawer";
    const term = document.createElement("textarea");
    drawer.append(term);
    document.body.append(drawer);
    term.focus();
    await tapAlt();
    await press("F10");
    await altLetter("f");
    expect(hotTitle()).toBeNull();
    expect(openTitle()).toBeNull();
    expect(document.activeElement).toBe(term);

    before.focus();
    const release = holdModal();
    await tapAlt();
    await press("F10");
    expect(hotTitle()).toBeNull();
    release();
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
  });

  it("keeps keys from App's shortcuts while active", async () => {
    await mountBar();
    await tapAlt();
    reachedWindow.mockReset();
    await press("Delete");
    await press("ArrowDown");
    await press("Delete");
    expect(reachedWindow).not.toHaveBeenCalled();
  });

  it("a click opens a menu without taking focus from the pane; closing gives it back", async () => {
    await mountBar();
    await click(titleEl("Edit"));
    expect(openTitle()).toBe("Edit");
    expect(highlighted()).toEqual([]);
    await press("ArrowDown");
    expect(highlighted()).toEqual([firstLabel("Edit")]);
    await click(titleEl("Edit"));
    expect(openTitle()).toBeNull();
    expect(document.activeElement).toBe(before);
  });

  it("closes on a click outside", async () => {
    await mountBar();
    await click(titleEl("File"));
    await act(async () => { document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); });
    expect(openTitle()).toBeNull();
    expect(document.activeElement).toBe(before);
  });
});
