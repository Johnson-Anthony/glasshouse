// @vitest-environment happy-dom
// The Preferences dialog in a DOM: its sections, that each control changes
// the setting at once, and the ways it closes.
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PreferencesDialog, FONTS } from "./Preferences";
import { isModalOpen } from "./modal";
import { THEMES } from "../data";
import type { TweakState } from "../components";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const START: TweakState = {
  theme: "gruvbox-dark",
  font: FONTS[0].value,
  density: "default",
  scanlines: false,
  hidden: false,
  showExtensions: true,
  showGitGutters: true,
  foldersFirst: true,
  termFollow: true,
  zoom: 1,
};

let host: HTMLDivElement;
let root: Root;
let latest: TweakState;
const onClose = vi.fn();

function Harness() {
  const [state, setState] = useState(START);
  latest = state;
  // A new onClose each render, as App passes it.
  return <PreferencesDialog open state={state} setState={setState} onClose={() => onClose()} />;
}

const group = (name: string) => host.querySelector<HTMLElement>(`[role="group"][aria-label="${name}"]`)!;
const button = (groupName: string, text: string) =>
  [...group(groupName).querySelectorAll("button")].find(b => b.textContent === text || b.getAttribute("aria-label") === text)!;
const pressed = (groupName: string) =>
  [...group(groupName).querySelectorAll("button[aria-pressed=true]")].map(b => b.textContent);
async function click(el: Element) {
  await act(async () => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
}
async function key(init: KeyboardEventInit) {
  await act(async () => { window.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init })); });
}

beforeEach(async () => {
  onClose.mockReset();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root.render(<Harness />); });
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("PreferencesDialog", () => {
  it("has the three sections, each with its settings", () => {
    const sections = [...host.querySelectorAll("section")].map(s => [
      s.getAttribute("aria-label"),
      [...s.querySelectorAll(".prefs-label")].map(l => l.firstChild?.textContent),
    ]);
    expect(sections).toEqual([
      ["appearance", ["theme", "font family", "density", "scanlines", "zoom"]],
      ["files", ["hidden files", "file extensions", "folders first", "git gutters"]],
      ["terminal", ["follow folder"]],
    ]);
  });

  it("holds the modal flag and takes the focus", () => {
    expect(isModalOpen()).toBe(true);
    expect(document.activeElement).toBe(host.querySelector(".prefs"));
  });

  it("leaves focus on the control just used", async () => {
    const comfy = button("density", "comfy");
    comfy.focus();
    await click(comfy);
    expect(latest.density).toBe("comfy");
    expect(document.activeElement).toBe(comfy);
  });

  it("uses no native <select>, whose list WebKitGTK draws with GTK", () => {
    expect(host.querySelector("select")).toBeNull();
  });

  it("offers every theme, each swatch in its own colors", async () => {
    const swatches = [...group("theme").querySelectorAll("button")];
    expect(swatches.map(b => b.dataset.theme)).toEqual([...THEMES]);
    expect(pressed("theme")).toEqual(["gruvbox-dark"]);
    await click(swatches.find(b => b.dataset.theme === "synthwave")!);
    expect(latest.theme).toBe("synthwave");
    expect(group("theme").querySelector("[aria-pressed=true]")?.getAttribute("data-theme")).toBe("synthwave");
  });

  it("sets the font family, each shown in its own font", async () => {
    const plex = button("font family", "IBM Plex Mono");
    expect(plex.style.fontFamily).toContain("IBM Plex Mono");
    await click(plex);
    expect(latest.font).toBe(FONTS.find(f => f.label === "IBM Plex Mono")!.value);
    expect(pressed("font family")).toEqual(["IBM Plex Mono"]);
  });

  it("applies each choice at once", async () => {
    await click(button("density", "comfy"));
    await click(button("scanlines", "on"));
    await click(button("hidden files", "show"));
    await click(button("file extensions", "hide"));
    await click(button("folders first", "off"));
    await click(button("git gutters", "hide"));
    await click(button("follow folder", "off"));
    expect(latest).toEqual({
      ...START,
      density: "comfy",
      scanlines: true,
      hidden: true,
      showExtensions: false,
      foldersFirst: false,
      showGitGutters: false,
      termFollow: false,
    });
    expect(pressed("density")).toEqual(["comfy"]);
  });

  it("steps the zoom, shows it, and resets it", async () => {
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

  it("closes on Esc, on Ctrl+, and on a click outside, but not inside", async () => {
    await click(host.querySelector(".prefs-body")!);
    expect(onClose).not.toHaveBeenCalled();
    await key({ key: "Escape" });
    await key({ key: ",", ctrlKey: true });
    await click(host.querySelector(".prefs-backdrop")!);
    await click(button("follow folder", "on"));
    expect(onClose).toHaveBeenCalledTimes(3);
  });
});
