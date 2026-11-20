// Where a dragged tab goes in its window: a tab bar (reorder, or into the
// other pane), the edge of the file area (split with it), or the other
// pane's file area. The layout changes are tabLayout.ts's; tabDrag.ts
// follows the pointer. Dragging a tab out to another window comes later
// (docs/decisions/2026-11-20-split-and-tear-off-phases.md).
import type React from "react";
import { useRef } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { beginTabDrag, type TabDropTarget } from "./tabDrag";
import { findTab, isSplit, moveTabTo, splitWithTab, tabCount, type Layout, type TabAt } from "./tabLayout";
import type { TabLayoutApi } from "./useTabLayout";

/** Whether a drop at `t` takes the tab at `at`. */
export function tabAccepts(l: Layout, at: TabAt, t: TabDropTarget): boolean {
  if (t.kind === "bar") return true;
  if (t.kind === "edge") return !isSplit(l) && (l.panes[at.pane]?.tabs.length ?? 0) > 1;
  return isSplit(l) && t.pane !== at.pane;
}

/** The layout after the tab at `at` is dropped at `t`. */
export function dropTab(l: Layout, at: TabAt, t: TabDropTarget): Layout {
  if (!tabAccepts(l, at, t)) return l;
  if (t.kind === "bar") return moveTabTo(l, at, { pane: t.pane, gap: t.gap });
  if (t.kind === "edge") return splitWithTab(l, at, t.side);
  return moveTabTo(l, at, { pane: t.pane });
}

/** Move to Other Pane: into the other pane, or, unsplit, into a new one. */
export function toOtherPane(l: Layout, at: TabAt): Layout {
  if (!l.panes[at.pane]?.tabs[at.index]) return l;
  return isSplit(l) ? moveTabTo(l, at, { pane: 1 - at.pane }) : splitWithTab(l, at, "right");
}

export interface TabMoves {
  /** The tab bar of `pane`'s handler for a press on a tab. */
  onTabPointerDown: (pane: number) => (e: React.PointerEvent, index: number) => void;
  moveToOtherPane: (pane: number, index: number) => void;
}

export function useTabMoves(api: TabLayoutApi): TabMoves {
  const apiRef = useRef(api);
  apiRef.current = api;

  const onTabPointerDown = (pane: number) => (e: React.PointerEvent, index: number) => {
    if ((e.target as HTMLElement | null)?.closest(".close")) return;
    const l = apiRef.current.layout;
    const rec = l.panes[pane]?.tabs[index];
    if (!rec) return;
    // The tab can move while it's dragged (a tab closed by a key), so its
    // place is looked up by id when it lands.
    const where = () => findTab(apiRef.current.layout, rec.id);
    beginTabDrag(e, {
      label: rec.label,
      single: tabCount(l) === 1,
      split: isSplit(l),
      pane,
      accepts: t => {
        const at = where();
        return !!at && tabAccepts(apiRef.current.layout, at, t);
      },
      onDrop: t => {
        const at = where();
        if (at) apiRef.current.update(cur => dropTab(cur, at, t));
      },
      onWindowMove: () => {
        try { void getCurrentWindow().startDragging().catch(() => {}); } catch { /* no Tauri window */ }
      },
    });
  };

  return {
    onTabPointerDown,
    moveToOtherPane: (pane, index) => apiRef.current.update(l => toOtherPane(l, { pane, index })),
  };
}
