// @vitest-environment happy-dom
// Roles, names and key paths outside the file list (FilePane.a11y.dom.test
// has that): the tab bar, the toolbar, the dialogs' shared wrapper, toasts,
// the palette and the Inspector's controls.
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Palette, TabStrip, Titlebar, Toolbar, type TabDef } from "./components";
import { DialogHost, dialogs } from "./dialogs/DialogHost";
import { openDialogPanels, tabStops, trapTab, useDialogPanel } from "./dialogs/dialogPanel";
import { AboutDialog } from "./dialogs/About";
import { PermissionsGrid } from "./preview/Inspector";
import { CONTROL_SELECTOR } from "./keymap";

vi.mock("@tauri-apps/api/app", () => ({ getVersion: () => Promise.resolve("9.9.9") }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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
  document.documentElement.removeAttribute("data-maximized");
});
const render = (ui: React.ReactNode) => act(() => root.render(ui));
const tick = () => act(async () => { await new Promise(r => setTimeout(r, 0)); });
const keydown = (on: Element, key: string, mods: KeyboardEventInit = {}) => {
  const e = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...mods });
  act(() => { on.dispatchEvent(e); });
  return e;
};

const TABS: TabDef[] = ["home", "Documents", "Music"].map(label => ({ ic: "▸", color: "red", label }));

describe("the tab bar", () => {
  const onSelect = vi.fn(), onClose = vi.fn(), onNew = vi.fn();
  function Bar({ split = false }: { split?: boolean }) {
    const [active, setActive] = useState(1);
    return (
      <TabStrip tabs={TABS} activeTab={active} pane={split ? 1 : 0} dragRegion={!split}
        onSelectTab={i => { onSelect(i); setActive(i); }} onCloseTab={onClose} onNewTab={onNew} />
    );
  }
  const tabs = () => [...host.querySelectorAll<HTMLElement>("[role=tab]")];
  beforeEach(() => { onSelect.mockReset(); onClose.mockReset(); onNew.mockReset(); });

  it("is a tablist of tabs, with the shown one selected and in the Tab order", () => {
    render(<Bar />);
    const list = host.querySelector("[role=tablist]")!;
    expect(list.getAttribute("aria-label")).toBe("Tabs");
    expect(tabs().map(t => t.textContent)).toEqual(["home", "Documents", "Music"]);
    expect(tabs().map(t => t.getAttribute("aria-selected"))).toEqual(["false", "true", "false"]);
    expect(tabs().map(t => t.tabIndex)).toEqual([-1, 0, -1]);
    // The tablist holds tabs and their close buttons, not the New tab button.
    expect(list.querySelector(".tab-btn")).toBeNull();
    expect(host.querySelector(".tab-btn")!.getAttribute("aria-label")).toBe("New tab");
  });

  it("keeps what tab dragging and the e2e suite find: the bar, each tab's index and its label", () => {
    render(<Bar split />);
    const bar = host.querySelector('[data-tab-bar="1"]')!;
    expect(bar.querySelector("[role=tablist]")!.getAttribute("aria-label")).toBe("Tabs, pane 2");
    const items = [...bar.querySelectorAll<HTMLElement>("[data-tab-index]")];
    expect(items.map(t => t.dataset.tabIndex)).toEqual(["0", "1", "2"]);
    expect(items.map(t => t.querySelector(".label")!.textContent)).toEqual(["home", "Documents", "Music"]);
    expect(items[1].classList.contains("active")).toBe(true);
    act(() => items[2].click());
    expect(onSelect).toHaveBeenCalledWith(2);
  });

  it("puts a real, named close button beside each tab, not inside it", () => {
    render(<Bar />);
    const close = [...host.querySelectorAll<HTMLButtonElement>(".tab .close")];
    expect(close.map(c => c.tagName)).toEqual(["BUTTON", "BUTTON", "BUTTON"]);
    expect(close.map(c => c.getAttribute("aria-label"))).toEqual(["Close tab home", "Close tab Documents", "Close tab Music"]);
    expect(close.every(c => c.closest("[role=tab]") === null)).toBe(true);
    act(() => close[2].click());
    expect(onClose).toHaveBeenCalledWith(2);
    // Closing isn't also a click on the tab.
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("moves along the tabs with Left, Right, Home and End, showing the one reached", () => {
    render(<Bar />);
    tabs()[1].focus();
    keydown(tabs()[1], "ArrowRight");
    expect(onSelect).toHaveBeenLastCalledWith(2);
    expect(document.activeElement).toBe(tabs()[2]);
    expect(tabs()[2].getAttribute("aria-selected")).toBe("true");
    // Round the end.
    keydown(tabs()[2], "ArrowRight");
    expect(document.activeElement).toBe(tabs()[0]);
    keydown(tabs()[0], "ArrowLeft");
    expect(document.activeElement).toBe(tabs()[2]);
    keydown(tabs()[2], "Home");
    expect(document.activeElement).toBe(tabs()[0]);
    keydown(tabs()[0], "End");
    expect(document.activeElement).toBe(tabs()[2]);
  });

  it("keeps Enter and Space, and leaves modified keys to the keymap (Ctrl+Tab, Alt+Left)", () => {
    render(<Bar />);
    tabs()[1].focus();
    expect(keydown(tabs()[1], "Enter").defaultPrevented).toBe(true);
    expect(keydown(tabs()[1], " ").defaultPrevented).toBe(true);
    expect(onSelect).not.toHaveBeenCalled();
    expect(keydown(tabs()[1], "ArrowLeft", { altKey: true }).defaultPrevented).toBe(false);
    expect(keydown(tabs()[1], "Delete").defaultPrevented).toBe(false);
    expect(tabs()[1].matches(CONTROL_SELECTOR)).toBe(true);
  });

  it("leaves the focus where it was on a mouse press, so the file list keeps the keys", () => {
    render(<Bar />);
    const down = new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 });
    act(() => { tabs()[0].dispatchEvent(down); });
    expect(down.defaultPrevented).toBe(true);
    // A right press still opens the tab's menu as before.
    const right = new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 2 });
    act(() => { tabs()[0].dispatchEvent(right); });
    expect(right.defaultPrevented).toBe(false);
  });
});

describe("the window buttons", () => {
  it("are named buttons out of the Tab order, and the middle one says Restore when maximized", async () => {
    render(<Titlebar tabs={TABS} activeTab={0} onSelectTab={() => {}} onCloseTab={() => {}} onNewTab={() => {}} />);
    const names = () => [...host.querySelectorAll<HTMLButtonElement>(".winctl .wc")].map(b => b.getAttribute("aria-label"));
    expect(names()).toEqual(["Minimize", "Maximize", "Close"]);
    expect([...host.querySelectorAll<HTMLButtonElement>(".winctl .wc")].every(b => b.tabIndex === -1)).toBe(true);
    await act(async () => {
      document.documentElement.setAttribute("data-maximized", "on");
      await new Promise(r => setTimeout(r, 0));
    });
    expect(names()).toEqual(["Minimize", "Restore", "Close"]);
    expect(host.querySelector(".wc.max")!.getAttribute("title")).toBe("Restore");
  });
});

describe("the toolbar", () => {
  const onGoTo = vi.fn();
  const bar = (over: Partial<Parameters<typeof Toolbar>[0]> = {}) => render(
    <Toolbar path="/home/u/Documents" gitInfo={{ branch: "main", ahead: 2, behind: 0, dirty: 3 } as never} canBack={true} canForward={false}
      onBack={() => {}} onForward={() => {}} onUp={() => {}} onRefresh={() => {}} onGoTo={onGoTo}
      searchQuery="" onSearchChange={() => {}} showHidden={false} onToggleHidden={() => {}}
      showInspector={true} onToggleInspector={() => {}} {...over} />,
  );

  it("names its glyph buttons and the search box", () => {
    bar();
    const names = [...host.querySelectorAll<HTMLButtonElement>(".nav-btn")].map(b => b.getAttribute("aria-label"));
    expect(names).toEqual(["Back", "Forward", "Up to the parent folder", "Refresh", "Show hidden files", "Inspector"]);
    expect(host.querySelector(".search input")!.getAttribute("aria-label")).toBe("Find in this folder");
    expect(host.querySelector('[aria-label="Inspector"]')!.getAttribute("aria-pressed")).toBe("true");
    expect(host.querySelector(".git-branch")!.getAttribute("aria-label")).toBe("git branch main, 2 ahead, 3 changed");
  });

  it("makes each breadcrumb segment a button in a named nav, the last marked as where you are", () => {
    bar();
    const nav = host.querySelector("nav.breadcrumb")!;
    expect(nav.getAttribute("aria-label")).toBe("Folder path");
    const crumbs = [...nav.querySelectorAll<HTMLButtonElement>(".crumb")];
    expect(crumbs.every(c => c.tagName === "BUTTON")).toBe(true);
    expect(crumbs[crumbs.length - 1].textContent).toBe("Documents");
    expect(crumbs[crumbs.length - 1].classList.contains("last")).toBe(true);
    expect(crumbs.map(c => c.getAttribute("aria-current"))).toEqual([...Array(crumbs.length - 1).fill(null), "location"]);
    expect([...nav.querySelectorAll(".sep")].every(s => s.getAttribute("aria-hidden") === "true")).toBe(true);
    act(() => crumbs[crumbs.length - 2].click());
    expect(onGoTo).toHaveBeenCalledWith("/home/u");
  });

  it("keeps the focus where it was when a button is pressed with the mouse", () => {
    bar({ tagFilter: "work", onClearTagFilter: () => {} });
    for (const el of [host.querySelector(".nav-btn")!, host.querySelector(".crumb")!, host.querySelector(".tag-chip")!]) {
      const down = new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 });
      act(() => { el.dispatchEvent(down); });
      expect(down.defaultPrevented, el.className).toBe(true);
    }
    // The search box still takes a click.
    const down = new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 });
    act(() => { host.querySelector(".search input")!.dispatchEvent(down); });
    expect(down.defaultPrevented).toBe(false);
    expect(host.querySelector(".tag-chip")!.tagName).toBe("BUTTON");
  });
});

describe("the dialogs' wrapper", () => {
  function Dlg({ label = "Test", fields = true }: { label?: string; fields?: boolean }) {
    const dlg = useDialogPanel(label);
    return (
      <div {...dlg} data-panel={label}>
        {fields && <><button id={label + "-a"}>a</button><input id={label + "-b"} /><button id={label + "-c"}>c</button></>}
        <button disabled>off</button>
        <span tabIndex={-1}>not a stop</span>
      </div>
    );
  }
  function App({ open, second = false, fields = true }: { open: boolean; second?: boolean; fields?: boolean }) {
    return (
      <>
        <button id="opener">open</button>
        <button id="other">other</button>
        {open && <Dlg fields={fields} />}
        {second && <Dlg label="Second" />}
      </>
    );
  }
  const panel = (label = "Test") => host.querySelector<HTMLElement>(`[data-panel="${label}"]`)!;
  const byId = (id: string) => document.getElementById(id)!;

  it("is a named modal dialog that takes the focus, and gives it back on close", () => {
    render(<App open={false} />);
    byId("opener").focus();
    render(<App open={true} />);
    expect(panel().getAttribute("role")).toBe("dialog");
    expect(panel().getAttribute("aria-modal")).toBe("true");
    expect(panel().getAttribute("aria-label")).toBe("Test");
    expect(document.activeElement).toBe(panel());
    expect(openDialogPanels()).toBe(1);
    render(<App open={false} />);
    expect(document.activeElement).toBe(byId("opener"));
    expect(openDialogPanels()).toBe(0);
  });

  it("hands its place to a dialog it opened, when it closes first", () => {
    render(<App open={false} />);
    byId("opener").focus();
    render(<App open={true} />);
    byId("Test-b").focus();
    render(<App open={true} second />);
    // The first closes under the second: the focus stays in the second.
    render(<App open={false} second />);
    expect(document.activeElement).toBe(panel("Second"));
    expect(openDialogPanels()).toBe(1);
    // And then goes back to what opened the first, not to nowhere.
    render(<App open={false} />);
    expect(document.activeElement).toBe(byId("opener"));
  });

  it("keeps Tab and Shift+Tab inside, round both ends", () => {
    render(<App open={true} />);
    expect(tabStops(panel()).map(e => e.id)).toEqual(["Test-a", "Test-b", "Test-c"]);
    // From the panel itself, Shift+Tab goes to the last stop.
    expect(keydown(panel(), "Tab", { shiftKey: true }).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(byId("Test-c"));
    expect(keydown(byId("Test-c"), "Tab").defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(byId("Test-a"));
    expect(keydown(byId("Test-a"), "Tab", { shiftKey: true }).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(byId("Test-c"));
    // In the middle, the browser moves it.
    byId("Test-b").focus();
    expect(keydown(byId("Test-b"), "Tab").defaultPrevented).toBe(false);
    // Ctrl+Tab is the keymap's.
    expect(keydown(byId("Test-c"), "Tab", { ctrlKey: true }).defaultPrevented).toBe(false);
  });

  it("brings back a focus that lands behind the dialog, to the control that had it", () => {
    render(<App open={true} />);
    act(() => byId("other").focus());
    expect(document.activeElement).toBe(byId("Test-a"));
    act(() => byId("Test-b").focus());
    act(() => byId("other").focus());
    expect(document.activeElement).toBe(byId("Test-b"));
    // And Tab pressed from behind it comes inside.
    expect(trapTab(panel(), { key: "Tab", shiftKey: false, ctrlKey: false, altKey: false, metaKey: false, preventDefault: () => {} }, byId("other"))).toBe(true);
    expect(document.activeElement).toBe(byId("Test-a"));
  });

  it("holds the focus on a panel with nothing to tab to", () => {
    render(<App open={true} fields={false} />);
    expect(keydown(panel(), "Tab").defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(panel());
  });

  it("traps in the topmost of two dialogs, then in the one left", () => {
    render(<App open={true} />);
    byId("Test-b").focus();
    render(<App open={true} second />);
    expect(openDialogPanels()).toBe(2);
    expect(document.activeElement).toBe(panel("Second"));
    byId("Second-c").focus();
    keydown(byId("Second-c"), "Tab");
    expect(document.activeElement).toBe(byId("Second-a"));
    // The dialog underneath takes no focus while the other is on top.
    act(() => byId("Test-a").focus());
    expect(document.activeElement).toBe(byId("Second-a"));
    render(<App open={true} />);
    // Back to the field that had the focus in the first dialog.
    expect(document.activeElement).toBe(byId("Test-b"));
    byId("Test-c").focus();
    keydown(byId("Test-c"), "Tab");
    expect(document.activeElement).toBe(byId("Test-a"));
  });

  it("is what About uses", async () => {
    await act(async () => { root.render(<AboutDialog open={true} onClose={() => {}} />); });
    const dlg = host.querySelector("[role=dialog]")!;
    expect(dlg.getAttribute("aria-modal")).toBe("true");
    expect(dlg.getAttribute("aria-label")).toBe("About glasshouse");
    expect(document.activeElement).toBe(dlg);
  });
});

describe("DialogHost", () => {
  beforeEach(async () => { await act(async () => { root.render(<><button id="pane">pane</button><DialogHost /></>); }); });
  const dialog = () => host.querySelector<HTMLElement>("[role=dialog], [role=alertdialog]");

  it("shows a confirm as an alertdialog named by its title, whose message is read, and gives the focus back", async () => {
    document.getElementById("pane")!.focus();
    let answer!: Promise<boolean>;
    await act(async () => { answer = dialogs.showConfirm({ title: "delete", message: "Delete 3 items?", danger: true }); });
    await tick();
    const d = dialog()!;
    expect(d.getAttribute("role")).toBe("alertdialog");
    expect(d.getAttribute("aria-modal")).toBe("true");
    expect(d.getAttribute("aria-label")).toBe("delete");
    expect(document.getElementById(d.getAttribute("aria-describedby")!)!.textContent).toBe("Delete 3 items?");
    // The primary button has the focus, inside the dialog.
    expect(d.contains(document.activeElement)).toBe(true);
    expect(document.activeElement!.textContent).toBe("delete");
    expect(d.querySelector('[aria-label="Close"]')!.tagName).toBe("BUTTON");
    keydown(document.activeElement!, "Escape");
    await expect(answer).resolves.toBe(false);
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(document.getElementById("pane"));
  });

  it("names a prompt's field by its message, and says its error at once", async () => {
    let answer!: Promise<string | null>;
    await act(async () => { answer = dialogs.showPrompt({ title: "new folder", message: "folder name:", validate: v => (v ? null : "a name is needed") }); });
    await tick();
    const d = dialog()!;
    expect(d.getAttribute("role")).toBe("dialog");
    expect(d.getAttribute("aria-label")).toBe("new folder");
    const input = d.querySelector("input")!;
    expect(document.activeElement).toBe(input);
    expect(document.getElementById(input.getAttribute("aria-labelledby")!)!.textContent).toBe("folder name:");
    keydown(input, "Enter");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    const err = document.getElementById(input.getAttribute("aria-describedby")!)!;
    expect(err.getAttribute("role")).toBe("alert");
    expect(err.textContent).toBe("a name is needed");
    keydown(input, "Escape");
    await expect(answer).resolves.toBeNull();
  });

  it("keeps a polite live region for toasts in the page, empty or not", async () => {
    const region = host.querySelector<HTMLElement>(".toasts")!;
    expect(region.getAttribute("role")).toBe("status");
    expect(region.getAttribute("aria-live")).toBe("polite");
    expect(region.textContent).toBe("");
    await act(async () => { dialogs.showToast({ message: "copied 2 items", variant: "success", timeout: 5 }); });
    // The same element: what's added to it is what's read.
    expect(host.querySelector(".toasts")).toBe(region);
    expect(region.textContent).toBe("●copied 2 items");
    expect(region.querySelector("[aria-hidden=true]")!.textContent).toBe("●");
    await act(async () => { await new Promise(r => setTimeout(r, 20)); });
    expect(region.textContent).toBe("");
    expect(host.querySelector(".toasts")).toBe(region);
  });
});

describe("the palette", () => {
  it("is a combobox over a listbox, naming the highlighted command", async () => {
    await act(async () => { root.render(<><button id="pane">pane</button></>); });
    document.getElementById("pane")!.focus();
    await act(async () => { root.render(<><button id="pane">pane</button><Palette onClose={() => {}} onCommand={() => {}} /></>); });
    const dlg = host.querySelector("[role=dialog]")!;
    expect(dlg.getAttribute("aria-label")).toBe("Command palette");
    expect(dlg.getAttribute("aria-modal")).toBe("true");
    const input = host.querySelector<HTMLInputElement>("input")!;
    expect(document.activeElement).toBe(input);
    expect(input.getAttribute("role")).toBe("combobox");
    const list = document.getElementById(input.getAttribute("aria-controls")!)!;
    expect(list.getAttribute("role")).toBe("listbox");
    const options = () => [...list.querySelectorAll<HTMLElement>("[role=option]")];
    expect(options().length).toBeGreaterThan(20);
    const activeId = () => input.getAttribute("aria-activedescendant")!;
    expect(document.getElementById(activeId())).toBe(options()[0]);
    expect(options()[0].getAttribute("aria-selected")).toBe("true");
    keydown(input, "ArrowDown");
    expect(document.getElementById(activeId())).toBe(options()[1]);
    expect(options().filter(o => o.getAttribute("aria-selected") === "true")).toEqual([options()[1]]);
    // Group headers aren't options.
    expect([...list.querySelectorAll(".pal-group")].every(g => g.getAttribute("aria-hidden") === "true")).toBe(true);
    // Closed, it gives the focus back to what had it.
    await act(async () => { root.render(<><button id="pane">pane</button></>); });
    expect(document.activeElement).toBe(document.getElementById("pane"));
  });
});

describe("the Inspector's permission controls", () => {
  it("are buttons, and the grid's cells are checkboxes while editing", () => {
    render(<PermissionsGrid path="/a" name="a" mode={0o640} onChanged={() => {}} />);
    const edit = [...host.querySelectorAll("button")].find(b => b.textContent === "edit")!;
    expect(edit.getAttribute("aria-label")).toBe("edit permissions");
    expect(host.querySelector("[role=checkbox]")).toBeNull();
    expect(host.querySelector(".perm-cell")!.getAttribute("role")).toBe("img");
    act(() => edit.click());
    expect([...host.querySelectorAll("button")].map(b => b.textContent)).toEqual(["apply", "cancel"]);
    const cells = [...host.querySelectorAll<HTMLElement>(".perm-cell[role=checkbox]")];
    expect(cells.length).toBe(9);
    expect(cells.every(c => c.tabIndex === 0)).toBe(true);
    const off = cells.find(c => c.getAttribute("aria-checked") === "false")!;
    const label = off.getAttribute("aria-label");
    expect(keydown(off, " ").defaultPrevented).toBe(true);
    expect(host.querySelector(`.perm-cell[aria-label="${label}"]`)!.getAttribute("aria-checked")).toBe("true");
  });
});
