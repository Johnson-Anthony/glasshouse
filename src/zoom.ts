// Window zoom: the webview's own page zoom, which scales everything (text,
// rows, icons, the terminal, dialogs) the way a browser's zoom does. The
// factor is `zoom` in the saved tweaks; App applies it when it changes. See
// docs/decisions/2026-11-13-settings-dialog-zoom.md.
import { getCurrentWebview } from "@tauri-apps/api/webview";

/** The zoom levels Zoom In and Zoom Out step through, as factors. */
export const ZOOM_STEPS: readonly number[] = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];
export const ZOOM_DEFAULT = 1;
const MIN = ZOOM_STEPS[0];
const MAX = ZOOM_STEPS[ZOOM_STEPS.length - 1];

/** A saved zoom as a factor in range; 100% for anything else. */
export function validZoom(z: unknown): number {
  return typeof z === "number" && Number.isFinite(z) ? Math.max(MIN, Math.min(MAX, z)) : ZOOM_DEFAULT;
}

/** The next step above (`dir` 1) or below (-1) `z`. A zoom between two steps
 *  goes to the nearer one in that direction; the ends stay put. */
export function stepZoom(z: number, dir: 1 | -1): number {
  const cur = validZoom(z);
  const eps = 1e-6;
  if (dir > 0) return ZOOM_STEPS.find(s => s > cur + eps) ?? MAX;
  return [...ZOOM_STEPS].reverse().find(s => s < cur - eps) ?? MIN;
}

/** "125%". */
export function zoomLabel(z: number): string {
  return `${Math.round(validZoom(z) * 100)}%`;
}

// The webview starts at 100%.
let current = ZOOM_DEFAULT;

/** The zoom last applied to the window. */
export function currentZoom(): number {
  return current;
}

/** Zooms the window to `z`. A no-op outside Tauri (tests); the browser
 *  demo's mock answers the call with a notice. */
export function applyZoom(z: number): void {
  const next = validZoom(z);
  if (next === current) return;
  current = next;
  let done: Promise<void>;
  try {
    done = getCurrentWebview().setZoom(next);
  } catch {
    return; // No Tauri window.
  }
  // Page zoom changes the window's size in CSS pixels. Chromium reports
  // that as a resize; say so anyway, so the terminal and the lists refit.
  done.then(() => window.dispatchEvent(new Event("resize")), err => console.error("zoom failed:", err));
}
