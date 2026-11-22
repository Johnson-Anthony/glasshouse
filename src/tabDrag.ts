// Dragging a tab: within its tab bar to reorder it, onto the other pane's
// tab bar or file area, to the edge of the file area to split, or out of
// the window into another glasshouse window or a new one (tabMoves.ts).
// Pointer events, like the file pane's drag: HTML5 drag and drop doesn't
// reach the page on Windows while Tauri takes file drops (dragDropEnabled).
//
// What takes a tab is marked in the DOM: a tab bar has `data-tab-bar` (its
// pane) and its tabs `data-tab-index`; a pane's file area has
// `data-tab-pane`.
import { keepSelection, leftWindow } from "./dragDrop";
import type { Landing, Side } from "./tabLayout";

export type TabDropTarget =
  /** Between two tabs of a tab bar: `gap` 0 is before the first. */
  | { kind: "bar"; pane: number; gap: number; el: HTMLElement }
  /** The outer part of the file area, unsplit: split with the tab there. */
  | { kind: "edge"; side: Side; el: HTMLElement }
  /** The other pane's file area: the tab moves to that pane. */
  | { kind: "pane"; pane: number; el: HTMLElement };

interface Box { left: number; right: number; top: number; bottom: number; width: number; height: number }

/** The gap of a row of tabs nearest `x`: before the first tab whose middle
 *  is right of it. */
export function gapAt(x: number, tabs: readonly Pick<Box, "left" | "width">[]): number {
  const i = tabs.findIndex(t => x < t.left + t.width / 2);
  return i < 0 ? tabs.length : i;
}

/** How much of the file area, from each edge, splits. */
export const EDGE_SHARE = 0.25;

/** The edge of `box` that `x`, `y` is in the outer quarter of, nearest
 *  first; null in the middle. */
export function edgeAt(x: number, y: number, box: Box): Side | null {
  const fx = (x - box.left) / box.width;
  const fy = (y - box.top) / box.height;
  if (!(fx >= 0 && fx <= 1 && fy >= 0 && fy <= 1)) return null;
  const near: [Side, number][] = [["left", fx], ["right", 1 - fx], ["top", fy], ["bottom", 1 - fy]];
  const [side, d] = near.reduce((a, b) => (b[1] < a[1] ? b : a));
  return d < EDGE_SHARE ? side : null;
}

function numAttr(el: Element, name: string): number {
  const n = Number(el.getAttribute(name));
  return Number.isInteger(n) ? n : 0;
}

/** What's under `x`, `y` for a tab from pane `from`: a tab bar anywhere,
 *  else (unsplit) an edge of the file area, else (split) the other pane. */
export function tabDropAt(x: number, y: number, split: boolean, from: number, doc: Document = document): TabDropTarget | null {
  const hit = doc.elementFromPoint(x, y);
  const bar = hit?.closest<HTMLElement>("[data-tab-bar]");
  if (bar) {
    const tabs = [...bar.querySelectorAll<HTMLElement>("[data-tab-index]")].map(t => t.getBoundingClientRect());
    return { kind: "bar", pane: numAttr(bar, "data-tab-bar"), gap: gapAt(x, tabs), el: bar };
  }
  const area = hit?.closest<HTMLElement>("[data-tab-pane]");
  if (!area) return null;
  const pane = numAttr(area, "data-tab-pane");
  if (split) return pane !== from ? { kind: "pane", pane, el: area } : null;
  const side = edgeAt(x, y, area.getBoundingClientRect());
  return side ? { kind: "edge", side, el: area } : null;
}

/** The marks a tab drag draws: the tab's label by the pointer, a line where
 *  it would go in a tab bar, and the half of the file area a split would
 *  take. Plain elements on <body>, so nothing re-renders as the pointer
 *  moves. */
export class TabDropFeedback {
  private ghost: HTMLElement | null = null;
  private mark: HTMLElement | null = null;

  private el(cls: string): HTMLElement {
    const e = document.createElement("div");
    e.className = cls;
    e.setAttribute("aria-hidden", "true");
    document.body.appendChild(e);
    return e;
  }

  label(x: number, y: number, text: string | null): void {
    if (text === null) {
      this.ghost?.remove();
      this.ghost = null;
      return;
    }
    this.ghost ??= this.el("drag-ghost tab-ghost");
    this.ghost.textContent = text;
    this.ghost.style.left = `${x + 12}px`;
    this.ghost.style.top = `${y + 12}px`;
  }

  show(t: TabDropTarget | null): void {
    if (!t) {
      this.mark?.remove();
      this.mark = null;
      return;
    }
    this.mark ??= this.el("");
    const r = t.el.getBoundingClientRect();
    const m = this.mark.style;
    if (t.kind === "bar") {
      const tabs = [...t.el.querySelectorAll<HTMLElement>("[data-tab-index]")].map(e => e.getBoundingClientRect());
      const x = tabs.length === 0 ? r.left + 4 : t.gap < tabs.length ? tabs[t.gap].left - 3 : tabs[tabs.length - 1].right + 3;
      this.mark.className = "tab-insert";
      Object.assign(m, { left: `${x - 1}px`, top: `${r.top + 4}px`, width: "2px", height: `${Math.max(r.height - 8, 8)}px` });
      return;
    }
    this.mark.className = "split-preview";
    const half = t.kind === "edge" ? t.side : null;
    const left = half === "right" ? r.left + r.width / 2 : r.left;
    const top = half === "bottom" ? r.top + r.height / 2 : r.top;
    const width = half === "left" || half === "right" ? r.width / 2 : r.width;
    const height = half === "top" || half === "bottom" ? r.height / 2 : r.height;
    Object.assign(m, { left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px` });
  }

  clear(): void {
    this.label(0, 0, null);
    this.show(null);
  }
}

/** Past this, a press on a tab is a drag. */
export const TAB_DRAG_THRESHOLD_PX = 5;

export interface TabDragHooks {
  /** What the pointer carries. */
  label: string;
  /** The window's only tab: dragging it moves the window. */
  single: boolean;
  split: boolean;
  pane: number;
  /** Whether `t` takes this tab. */
  accepts: (t: TabDropTarget) => boolean;
  onDrop: (t: TabDropTarget) => void;
  onWindowMove: () => void;
  /** Out of the window, for another window or a new one (tabMoves.ts):
   *  - "handoff" (Linux): at the window's edge, with the button still down,
   *    the drag becomes the OS's (`onHandOff`), and the windows under it
   *    answer from then on;
   *  - "track" (Windows, where the webview keeps the mouse while the button
   *    is down): `onLeave` when the pointer first goes out, `onOutsideMove`
   *    each time it moves out there, `onReturn` when it comes back in (or
   *    Escape), and `onReleaseOutside` when it's let go out there;
   *  - "none" (unset): let go outside the window, the tab stays. */
  outside?: "handoff" | "track" | "none";
  onHandOff?: () => void;
  onLeave?: () => void;
  onOutsideMove?: () => void;
  onReturn?: () => void;
  onReleaseOutside?: () => void;
}

/** Starts watching a press on a tab; nothing happens unless it moves past
 *  the threshold with the button down. */
export function beginTabDrag(down: { clientX: number; clientY: number; button: number }, h: TabDragHooks): void {
  if (down.button !== 0) return;
  keepSelection();
  const feedback = new TabDropFeedback();
  const mode = h.outside ?? "none";
  let dragging = false;
  /** Track mode: the pointer is out of the window. */
  let out = false;
  const outsideNow = (x: number, y: number) => x < 0 || y < 0 || x >= window.innerWidth || y >= window.innerHeight;

  const stop = () => {
    window.removeEventListener("pointermove", onMove, true);
    window.removeEventListener("pointerup", onUp, true);
    window.removeEventListener("pointercancel", onCancel, true);
    window.removeEventListener("mouseout", onOut, true);
    window.removeEventListener("keydown", onKey, true);
    window.removeEventListener("blur", onCancel);
    feedback.clear();
    document.documentElement.classList.remove("tab-dragging");
  };
  /** Track mode: the pointer is back in, or the drag is over without a
   *  release outside. */
  const back = () => {
    if (!out) return;
    out = false;
    h.onReturn?.();
  };
  const handOff = () => {
    stop();
    swallowClick();
    h.onHandOff?.();
  };
  // The click that ends a drag isn't one: it would select the tab under it.
  const swallowClick = () => {
    const swallow = (c: MouseEvent) => { c.stopPropagation(); c.preventDefault(); };
    window.addEventListener("click", swallow, { capture: true, once: true });
    setTimeout(() => window.removeEventListener("click", swallow, true), 0);
  };
  const onMove = (ev: PointerEvent) => {
    if (!dragging && Math.hypot(ev.clientX - down.clientX, ev.clientY - down.clientY) < TAB_DRAG_THRESHOLD_PX) return;
    if (!dragging) {
      dragging = true;
      if (h.single) {
        stop();
        swallowClick();
        h.onWindowMove();
        return;
      }
      document.documentElement.classList.add("tab-dragging");
    }
    if (mode === "handoff" && leftWindow(ev.clientX, ev.clientY, window.innerWidth, window.innerHeight)) {
      handOff();
      return;
    }
    if (outsideNow(ev.clientX, ev.clientY)) {
      feedback.clear();
      if (mode === "track") {
        if (!out) {
          out = true;
          h.onLeave?.();
        }
        h.onOutsideMove?.();
      }
      return;
    }
    back();
    const t = tabDropAt(ev.clientX, ev.clientY, h.split, h.pane);
    feedback.label(ev.clientX, ev.clientY, h.label);
    feedback.show(t && h.accepts(t) ? t : null);
  };
  const onUp = (ev: PointerEvent) => {
    stop();
    if (!dragging) return;
    swallowClick();
    if (outsideNow(ev.clientX, ev.clientY)) {
      // Track mode hands it to the backend; else nothing takes it, and it
      // stays.
      if (mode === "track") {
        out = false;
        h.onReleaseOutside?.();
      }
      return;
    }
    back();
    const t = tabDropAt(ev.clientX, ev.clientY, h.split, h.pane);
    if (t && h.accepts(t)) h.onDrop(t);
  };
  const onCancel = () => {
    stop();
    back();
  };
  // The pointer left the webview, which may stop saying where it is.
  const onOut = (ev: MouseEvent) => {
    if (dragging && mode === "handoff" && ev.relatedTarget === null && outsideNow(ev.clientX, ev.clientY)) handOff();
  };
  const onKey = (ev: KeyboardEvent) => {
    if (ev.key !== "Escape") return;
    ev.preventDefault();
    ev.stopPropagation();
    onCancel();
  };
  window.addEventListener("pointermove", onMove, true);
  window.addEventListener("pointerup", onUp, true);
  window.addEventListener("pointercancel", onCancel, true);
  window.addEventListener("mouseout", onOut, true);
  window.addEventListener("keydown", onKey, true);
  window.addEventListener("blur", onCancel);
}

/** The window's tab bars and file areas, in CSS pixels, for the backend's
 *  answer to a tab dragged from another window (`zone_at` in
 *  src-tauri/src/tab_drag.rs). */
export interface DropZones {
  zoom: number;
  split: boolean;
  bars: { pane: number; rect: [number, number, number, number]; tabs: [number, number][] }[];
  panes: { pane: number; rect: [number, number, number, number] }[];
}

function boxOf(el: Element): [number, number, number, number] {
  const r = el.getBoundingClientRect();
  return [r.left, r.top, r.width, r.height];
}

export function dropZones(split: boolean, zoom: number, doc: Document = document): DropZones {
  return {
    zoom,
    split,
    bars: [...doc.querySelectorAll<HTMLElement>("[data-tab-bar]")].slice(0, 2).map(el => ({
      pane: numAttr(el, "data-tab-bar"),
      rect: boxOf(el),
      tabs: [...el.querySelectorAll<HTMLElement>("[data-tab-index]")].map(t => {
        const r = t.getBoundingClientRect();
        return [r.left, r.width] as [number, number];
      }),
    })),
    panes: [...doc.querySelectorAll<HTMLElement>("[data-tab-pane]")].slice(0, 2).map(el => ({ pane: numAttr(el, "data-tab-pane"), rect: boxOf(el) })),
  };
}

/** Where a new window's first tab is from the window's top-left, in the
 *  window's own pixels (CSS pixels at `zoom`): a torn-off tab's window opens
 *  with it under the pointer. The title bar's tab strip is where it is in
 *  any window, split or not (split, the strip is empty). */
export function tabAnchor(zoom: number, doc: Document = document): [number, number] {
  const strip = doc.querySelector(".titlebar .tabs") ?? doc.querySelector(".titlebar");
  if (!strip) return [0, 0];
  const r = strip.getBoundingClientRect();
  return [(r.left + 40) * zoom, (r.top + r.height / 2) * zoom];
}

/** The mark for a tab from another window at `at` (the backend's answer). */
export function targetOf(at: Landing, doc: Document = document): TabDropTarget | null {
  if (at.kind === "bar") {
    const el = doc.querySelector<HTMLElement>(`[data-tab-bar="${at.pane}"]`);
    return el && { kind: "bar", pane: at.pane, gap: at.gap, el };
  }
  const el = doc.querySelector<HTMLElement>(`[data-tab-pane="${at.kind === "split" ? 0 : at.pane}"]`);
  if (!el) return null;
  return at.kind === "split" ? { kind: "edge", side: at.side, el } : { kind: "pane", pane: at.pane, el };
}
