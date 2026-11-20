// Dragging a tab: within its tab bar to reorder it, onto the other pane's
// tab bar or file area, or to the edge of the file area to split
// (tabMoves.ts).
// Pointer events, like the file pane's drag: HTML5 drag and drop doesn't
// reach the page on Windows while Tauri takes file drops (dragDropEnabled).
//
// What takes a tab is marked in the DOM: a tab bar has `data-tab-bar` (its
// pane) and its tabs `data-tab-index`; a pane's file area has
// `data-tab-pane`.
import type { Side } from "./tabLayout";

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
}

/** Starts watching a press on a tab; nothing happens unless it moves past
 *  the threshold with the button down. */
export function beginTabDrag(down: { clientX: number; clientY: number; button: number }, h: TabDragHooks): void {
  if (down.button !== 0) return;
  const feedback = new TabDropFeedback();
  let dragging = false;
  const outsideNow = (x: number, y: number) => x < 0 || y < 0 || x >= window.innerWidth || y >= window.innerHeight;

  const stop = () => {
    window.removeEventListener("pointermove", onMove, true);
    window.removeEventListener("pointerup", onUp, true);
    window.removeEventListener("pointercancel", onCancel, true);
    window.removeEventListener("keydown", onKey, true);
    window.removeEventListener("blur", onCancel);
    feedback.clear();
    document.documentElement.classList.remove("tab-dragging");
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
    if (outsideNow(ev.clientX, ev.clientY)) {
      feedback.clear();
      return;
    }
    const t = tabDropAt(ev.clientX, ev.clientY, h.split, h.pane);
    feedback.label(ev.clientX, ev.clientY, h.label);
    feedback.show(t && h.accepts(t) ? t : null);
  };
  const onUp = (ev: PointerEvent) => {
    stop();
    if (!dragging) return;
    swallowClick();
    // Let go outside the window: nothing takes it, and it stays.
    if (outsideNow(ev.clientX, ev.clientY)) return;
    const t = tabDropAt(ev.clientX, ev.clientY, h.split, h.pane);
    if (t && h.accepts(t)) h.onDrop(t);
  };
  const onCancel = () => stop();
  const onKey = (ev: KeyboardEvent) => {
    if (ev.key !== "Escape") return;
    ev.preventDefault();
    ev.stopPropagation();
    stop();
  };
  window.addEventListener("pointermove", onMove, true);
  window.addEventListener("pointerup", onUp, true);
  window.addEventListener("pointercancel", onCancel, true);
  window.addEventListener("keydown", onKey, true);
  window.addEventListener("blur", onCancel);
}
