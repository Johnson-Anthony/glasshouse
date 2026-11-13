// @vitest-environment happy-dom
// Window zoom: the steps Zoom In/Out walk, saved values, the View menu's
// commands, and the call to the webview.
import { afterEach, describe, expect, it, vi } from "vitest";

const setZoom = vi.fn(async (_z: number) => {});
vi.mock("@tauri-apps/api/webview", () => ({ getCurrentWebview: () => ({ setZoom }) }));

import { applyZoom, currentZoom, stepZoom, validZoom, ZOOM_DEFAULT, ZOOM_STEPS, zoomLabel } from "./zoom";
import { viewHandler } from "./handlers/view";
import type { TweakState } from "./components";
import type { HandlerCtx } from "./handlers/types";

describe("zoom steps", () => {
  it("walk up and down from 100%", () => {
    expect(stepZoom(1, 1)).toBe(1.1);
    expect(stepZoom(1.1, 1)).toBe(1.25);
    expect(stepZoom(1, -1)).toBe(0.9);
    expect(stepZoom(0.9, -1)).toBe(0.8);
  });

  it("stop at the ends", () => {
    expect(stepZoom(2, 1)).toBe(2);
    expect(stepZoom(0.5, -1)).toBe(0.5);
  });

  it("go from between two steps to the next in that direction", () => {
    expect(stepZoom(1.2, 1)).toBe(1.25);
    expect(stepZoom(1.2, -1)).toBe(1.1);
  });

  it("are increasing and include 100%", () => {
    expect([...ZOOM_STEPS].sort((a, b) => a - b)).toEqual(ZOOM_STEPS);
    expect(ZOOM_STEPS).toContain(ZOOM_DEFAULT);
  });
});

describe("saved zoom", () => {
  it("keeps a factor in range and clamps one outside it", () => {
    expect(validZoom(1.25)).toBe(1.25);
    expect(validZoom(5)).toBe(2);
    expect(validZoom(0.1)).toBe(0.5);
  });

  it("falls back to 100% for anything that isn't a number", () => {
    // 0.2 kept the zoom under its own key, as a font size; its tweaks
    // never held one, so an old save has none.
    for (const bad of [undefined, null, "13px", NaN, Infinity, {}]) expect(validZoom(bad)).toBe(1);
  });

  it("reads as a percentage", () => {
    expect(zoomLabel(1)).toBe("100%");
    expect(zoomLabel(0.67)).toBe("67%");
    expect(zoomLabel(1.25)).toBe("125%");
  });
});

describe("applyZoom", () => {
  afterEach(() => setZoom.mockClear());

  it("zooms the webview once per change and says the window resized", async () => {
    const resized = vi.fn();
    window.addEventListener("resize", resized);
    applyZoom(1.5);
    applyZoom(1.5);
    expect(setZoom).toHaveBeenCalledTimes(1);
    expect(setZoom).toHaveBeenCalledWith(1.5);
    expect(currentZoom()).toBe(1.5);
    await Promise.resolve();
    expect(resized).toHaveBeenCalledTimes(1);
    window.removeEventListener("resize", resized);
    applyZoom(1);
    expect(setZoom).toHaveBeenLastCalledWith(1);
  });

  it("clamps what it's given", () => {
    applyZoom(9);
    expect(setZoom).toHaveBeenLastCalledWith(2);
    applyZoom(1);
  });
});

describe("Zoom In / Zoom Out / Reset Zoom", () => {
  const run = (label: string, zoom: number) => {
    const setTweaks = vi.fn();
    const tweaks = { zoom, theme: "tokyo-night" } as TweakState;
    expect(viewHandler(label, { tweaks, setTweaks } as unknown as HandlerCtx)).toBe(true);
    return setTweaks.mock.calls[0]?.[0] as TweakState;
  };

  it("step the saved zoom and keep the other settings", () => {
    expect(run("Zoom In", 1)).toEqual({ zoom: 1.1, theme: "tokyo-night" });
    expect(run("Zoom Out", 1).zoom).toBe(0.9);
    expect(run("Reset Zoom", 1.75).zoom).toBe(1);
  });
});
