// @vitest-environment happy-dom
// The Preferences dialog in a DOM: its categories and filter, that each
// control changes the setting at once, the theme picker in both modes,
// custom themes, and the ways it closes.
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PreferencesDialog } from "./Preferences";
import { isModalOpen } from "./modal";
import { THEME_IDS, THEME_TOKENS } from "../themes";
import { FONTS, LOOK_CLASSIC, LOOK_DEFAULTS } from "../look";
import { exportTheme, getUserThemes, resetUserThemesForTest } from "../userThemes";
import type { TweakState } from "../components";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const START: TweakState = {
  ...LOOK_CLASSIC,
  hidden: false,
  showExtensions: true,
  showGitGutters: true,
  foldersFirst: true,
  termFollow: true,
  zoom: 1,
  showSidebar: true,
  showInspector: true,
  showStatusBar: true,
};

let host: HTMLDivElement;
let root: Root;
let latest: TweakState;
const onClose = vi.fn();

function Harness({ start }: { start: TweakState }) {
  const [state, setState] = useState(start);
  latest = state;
  // A new onClose each render, as App passes it.
  return <PreferencesDialog open state={state} setState={setState} onClose={() => onClose()} />;
}

const group = (name: string) => host.querySelector<HTMLElement>(`[role="group"][aria-label="${name}"]`)!;
const button = (groupName: string, text: string) =>
  [...group(groupName).querySelectorAll("button")].find(b => b.textContent === text || b.getAttribute("aria-label") === text)!;
const pressed = (groupName: string) =>
  [...group(groupName).querySelectorAll("button[aria-pressed=true]")].map(b => b.textContent);
const byText = (text: string) =>
  [...host.querySelectorAll("button")].find(b => b.textContent === text)!;
const labels = () => [...host.querySelectorAll(".prefs-label")].map(l => l.firstChild?.textContent);
async function click(el: Element) {
  await act(async () => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
}
async function key(init: KeyboardEventInit, target: EventTarget = window) {
  await act(async () => { target.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init })); });
}
/** Types into a React-controlled input. */
async function type(el: HTMLInputElement | HTMLTextAreaElement, text: string) {
  await act(async () => {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, text);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function category(name: string) {
  await click([...host.querySelectorAll(".prefs-nav button")].find(b => b.textContent === name)!);
}
async function mount(start: TweakState = START) {
  await act(async () => { root.render(<Harness start={start} />); });
}

beforeEach(() => {
  onClose.mockReset();
  localStorage.clear();
  resetUserThemesForTest();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("PreferencesDialog", () => {
  it("shows one category at a time, theme first", async () => {
    await mount();
    const nav = [...host.querySelectorAll(".prefs-nav button")].map(b => b.textContent);
    // Integration only shows where the platform has it (not in a browser).
    expect(nav).toEqual(["theme", "text", "window", "file list", "effects", "files", "terminal"]);
    expect(labels()).toEqual(["presets", "mode", "themes", "accent", "your themes"]);
    await category("text");
    expect(labels()).toEqual(["interface font", "file list font", "code font", "text size", "line spacing", "zoom"]);
    await category("files");
    expect(labels()).toEqual(["hidden files", "file extensions", "folders first", "git gutters"]);
    expect(host.querySelector(".prefs-nav [aria-current=page]")?.textContent).toBe("files");
  });

  it("holds the modal flag and takes the focus", async () => {
    await mount();
    expect(isModalOpen()).toBe(true);
    expect(document.activeElement).toBe(host.querySelector(".prefs"));
  });

  it("leaves focus on the control just used", async () => {
    await mount();
    await category("file list");
    const comfy = button("row height", "comfy");
    comfy.focus();
    await click(comfy);
    expect(latest.density).toBe("comfy");
    expect(document.activeElement).toBe(comfy);
  });

  it("uses no native <select>, whose list WebKitGTK draws with GTK", async () => {
    await mount();
    for (const c of ["theme", "text", "window", "file list", "effects", "files", "terminal"]) {
      await category(c);
      expect(host.querySelector("select")).toBeNull();
    }
  });

  it("filters every category's settings, and Esc clears the filter first", async () => {
    await mount();
    const filter = host.querySelector<HTMLInputElement>(".prefs-filter")!;
    await type(filter, "zebra");
    expect(labels()).toEqual(["striped rows"]);
    await type(filter, "sidebar");
    expect(labels()).toEqual(["sidebar width", "sidebar icons", "sidebar"]);
    await type(filter, "leading");
    expect(labels()).toEqual(["line spacing"]);
    await type(filter, "nothing like this");
    expect(labels()).toEqual([]);
    expect(host.querySelector(".prefs-empty")?.textContent).toContain("nothing like this");
    await key({ key: "Escape" }, filter);
    expect(filter.value).toBe("");
    expect(onClose).not.toHaveBeenCalled();
    expect(labels()).toContain("presets");
  });

  it("offers every theme, each swatch in its own colors", async () => {
    await mount();
    const swatches = [...group("theme").querySelectorAll("button")];
    expect(swatches.map(b => b.dataset.theme)).toEqual([...THEME_IDS]);
    expect(pressed("theme mode")).toEqual(["one theme"]);
    expect(group("theme").querySelector("[aria-pressed=true]")?.getAttribute("data-theme")).toBe("gruvbox-dark");
    await click(swatches.find(b => b.dataset.theme === "synthwave")!);
    expect(latest.theme).toBe("synthwave");
    expect(group("theme").querySelector("[aria-pressed=true]")?.getAttribute("data-theme")).toBe("synthwave");
  });

  it("narrows the themes by group", async () => {
    await mount();
    await click(button("theme group", "light"));
    const ids = [...group("theme").querySelectorAll("button")].map(b => b.dataset.theme);
    expect(ids).toContain("glasshouse-light");
    expect(ids).not.toContain("glasshouse-dark");
    await click(button("theme group", "high contrast"));
    expect([...group("theme").querySelectorAll("button")].map(b => b.dataset.theme)).toEqual(["high-contrast-light", "high-contrast-dark"]);
  });

  it("follows the system with a light pick and a dark pick", async () => {
    await mount({ ...START, ...LOOK_DEFAULTS });
    expect(pressed("theme mode")).toEqual(["follow system"]);
    const card = (id: string) => group("theme").querySelector<HTMLButtonElement>(`[data-theme="${id}"]`)!;
    await click(card("nord"));
    await click(card("solarized-light"));
    expect(latest).toMatchObject({ theme: "system", darkTheme: "nord", lightTheme: "solarized-light" });
    expect([...group("theme").querySelectorAll("[aria-pressed=true]")].map(b => b.getAttribute("data-theme")))
      .toEqual(["solarized-light", "nord"]);
    // One theme: the one on screen (happy-dom reports a light system).
    await click(button("theme mode", "one theme"));
    expect(latest.theme).toBe("solarized-light");
    // Back to System, keeping that theme as its pick.
    await click(card("dracula"));
    await click(button("theme mode", "follow system"));
    expect(latest).toMatchObject({ theme: "system", darkTheme: "dracula", lightTheme: "solarized-light" });
  });

  it("applies a preset and marks it, keeping the theme unless the preset sets one", async () => {
    await mount({ ...START, theme: "nord" });
    expect(pressed("presets")).toEqual([]);
    await click(button("presets", "compact"));
    expect(latest).toMatchObject({ theme: "nord", density: "tight", fontSize: 12, iconSet: "color", hidden: false });
    expect(pressed("presets")).toEqual(["compact"]);
    await click(button("presets", "terminal"));
    expect(latest).toMatchObject({ theme: "gruvbox-dark", iconSet: "glyphs", windowControls: "mac", zebra: true });
    expect(pressed("presets")).toEqual(["terminal"]);
  });

  it("sets the accent from a swatch or a hex color, and back to the theme's", async () => {
    await mount();
    await click(button("accent", "teal"));
    expect(latest.accent).toBe("#12a594");
    const hex = group("accent").querySelector<HTMLInputElement>("input")!;
    await type(hex, "#abc");
    expect(latest.accent).toBe("#aabbcc");
    await type(hex, "#12");
    expect(latest.accent).toBe("#aabbcc");
    expect(hex.classList.contains("bad")).toBe(true);
    await click(button("accent", "theme’s own"));
    expect(latest.accent).toBe("");
  });

  it("sets fonts, each shown in its own font; an unbundled one only when installed", async () => {
    await mount();
    await category("text");
    const plex = button("interface font", "IBM Plex Mono");
    expect(plex.style.fontFamily).toContain("IBM Plex Mono");
    await click(plex);
    expect(latest.font).toBe(FONTS.find(f => f.label === "IBM Plex Mono")!.value);
    expect(pressed("interface font")).toEqual(["IBM Plex Mono"]);
    // happy-dom measures no text, so nothing unbundled counts as installed.
    expect(button("interface font", "Iosevka (not installed)").disabled).toBe(true);
    await click(button("file list font", "same as interface"));
    expect(latest.listFont).toBe("");
    const other = host.querySelector<HTMLInputElement>('input[aria-label="code font: another installed font"]')!;
    await type(other, "Cascadia Code");
    await key({ key: "Enter" }, other);
    expect(latest.monoFont).toBe('"Cascadia Code", ui-monospace, monospace');
    expect(pressed("code font")).toEqual(["Cascadia Code"]);
    expect(host.textContent).toContain("“Cascadia Code” wasn’t found");
  });

  it("steps the text size through its sizes", async () => {
    await mount();
    await category("text");
    const value = () => group("text size").querySelector("output")!.textContent;
    expect(value()).toBe("13px");
    await click(button("text size", "larger text"));
    await click(button("text size", "larger text"));
    expect(latest.fontSize).toBe(15);
    await click(button("text size", "reset"));
    expect(latest.fontSize).toBe(13);
    for (let i = 0; i < 4; i++) await click(button("text size", "smaller text"));
    expect(latest.fontSize).toBe(11);
    expect(button("text size", "smaller text").disabled).toBe(true);
  });

  it("steps the zoom, shows it, and resets it", async () => {
    await mount();
    await category("text");
    const value = () => group("zoom").querySelector("output")!.textContent;
    expect(value()).toBe("100%");
    expect(button("zoom", "reset").disabled).toBe(true);
    await click(button("zoom", "zoom in"));
    await click(button("zoom", "zoom in"));
    expect(latest.zoom).toBe(1.25);
    expect(value()).toBe("125%");
    await click(button("zoom", "reset"));
    expect(latest.zoom).toBe(1);
    for (let i = 0; i < 6; i++) await click(button("zoom", "zoom out"));
    expect(latest.zoom).toBe(0.5);
    expect(button("zoom", "zoom out").disabled).toBe(true);
  });

  it("applies each choice at once", async () => {
    await mount();
    await category("window");
    await click(button("window buttons", "Windows"));
    await click(button("tabs", "underlined"));
    await click(button("sidebar width", "wider sidebar"));
    await click(button("status bar", "hide"));
    await category("file list");
    await click(button("icons", "Nerd Font"));
    await click(button("striped rows", "off"));
    await click(button("selection", "outlined"));
    await category("effects");
    await click(button("scanlines", "on"));
    await click(button("motion", "reduced"));
    await category("files");
    await click(button("hidden files", "show"));
    await click(button("folders first", "off"));
    await category("terminal");
    await click(button("follow folder", "off"));
    expect(latest).toEqual({
      ...START,
      windowControls: "windows",
      tabStyle: "line",
      sidebarWidth: 240,
      showStatusBar: false,
      iconSet: "nerd",
      zebra: false,
      selection: "outline",
      scanlines: true,
      motion: "reduced",
      hidden: true,
      foldersFirst: false,
      termFollow: false,
    });
  });

  it("resets the appearance, leaving the rest, and undoes it", async () => {
    await mount({ ...START, hidden: true, zoom: 1.25 });
    await click(byText("reset appearance"));
    expect(latest).toEqual({ ...START, ...LOOK_DEFAULTS, hidden: true, zoom: 1.25 });
    await click(byText("undo"));
    expect(latest).toEqual({ ...START, hidden: true, zoom: 1.25 });
    expect(byText("reset appearance")).toBeTruthy();
  });

  it("adds a pasted theme and picks it; refuses a bad one", async () => {
    await mount();
    await click(byText("paste a theme…"));
    const area = host.querySelector<HTMLTextAreaElement>('textarea[aria-label="theme file text"]')!;
    await type(area, "{ nope");
    await click(byText("add theme"));
    expect(host.querySelector("[role=alert]")?.textContent).toContain("isn't JSON");
    expect(getUserThemes()).toEqual([]);

    const colors = Object.fromEntries(THEME_TOKENS.map(k => [k, k.startsWith("bg") ? "#101010" : "#e0e0e0"]));
    await type(area, exportTheme({ name: "Night Shift", scheme: "dark", colors: colors as never }));
    await click(byText("add theme"));
    expect(getUserThemes().map(t => t.id)).toEqual(["user-night-shift"]);
    expect(latest.theme).toBe("user-night-shift");
    expect(host.querySelector("[role=status]")?.textContent).toContain("added “Night Shift”");
    expect(pressed("theme group")).toEqual(["all"]);
    expect(button("theme group", "yours (1)")).toBeTruthy();

    // Delete asks first.
    const row = () => host.querySelector(".prefs-uthemes li")!;
    await click([...row().querySelectorAll("button")].find(b => b.textContent === "delete")!);
    expect(getUserThemes()).toHaveLength(1);
    await click([...row().querySelectorAll("button")].find(b => b.textContent === "delete “Night Shift”?")!);
    expect(getUserThemes()).toEqual([]);
  });

  it("customizes the current theme in the editor and saves it", async () => {
    await mount();
    await click(byText("customize the current theme…"));
    const editor = host.querySelector(".theme-editor")!;
    expect(editor).toBeTruthy();
    const name = editor.querySelector<HTMLInputElement>(".te-name input")!;
    expect(name.value).toBe("Gruvbox Dark (custom)");
    await type(name, "Mine");
    const accent = editor.querySelector<HTMLInputElement>('input[aria-label="--accent hex"]')!;
    await type(accent, "#ff8800");
    await click([...editor.querySelectorAll("button")].find(b => b.textContent === "save theme")!);
    expect(host.querySelector(".theme-editor")).toBeNull();
    const saved = getUserThemes();
    expect(saved.map(t => [t.id, t.name, t.colors.accent])).toEqual([["user-mine", "Mine", "#ff8800"]]);
    expect(latest.theme).toBe("user-mine");
  });

  it("closes on Esc, on Ctrl+, and on a click outside, but not inside", async () => {
    await mount();
    await click(host.querySelector(".prefs-body")!);
    expect(onClose).not.toHaveBeenCalled();
    await key({ key: "Escape" });
    await key({ key: ",", ctrlKey: true });
    await click(host.querySelector(".prefs-backdrop")!);
    await click(byText("close"));
    expect(onClose).toHaveBeenCalledTimes(4);
  });
});
