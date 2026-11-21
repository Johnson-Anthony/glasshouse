// Where a dragged tab goes, and tabs that come from other windows. Inside
// the window a drop moves the tab (tabLayout.ts): a tab bar (reorder, or
// into the other pane), the edge of the file area (split with it), or the
// other pane's file area. Out of the window it goes to another glasshouse
// window, or into a new window of its own (src-tauri/src/tab_drag.rs):
// - Linux, X11 and Wayland: at the window's edge the drag becomes the OS's,
//   carrying only the tab, and the windows under it answer. This window
//   hears `tab-drag-end` with how it went.
// - Windows: the page keeps the pointer. Out of the window it asks the
//   backend to show the window under it where the tab would go, and on
//   release whether that window took it.
// The tab's record (tabTransfer.ts) goes to the backend as the drag leaves
// the window; the tab leaves this window only once the move is done, and a
// window whose last tab leaves closes. Move to New Window on the tab menu
// does the same without a drag.
// See docs/decisions/2026-11-21-split-and-tear-off-tear-off.md.
import type React from "react";
import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { tabDragCancel, tabDragHover, tabDragRelease, tabDragStart, tabDropZones, tabToNewWindow, winClose } from "./api";
import { dialogs } from "./dialogs/DialogHost";
import { errText } from "./errors";
import { listenHere } from "./events";
import { IS_WINDOWS } from "./platform";
import { beginTabDrag, dropZones, tabAnchor, tabDropAt, TabDropFeedback, targetOf, type TabDropTarget } from "./tabDrag";
import { findTab, isSplit, landTab, moveTabTo, removeTab, splitWithTab, tabCount, type Landing, type Layout, type TabAt } from "./tabLayout";
import type { TabRecord } from "./tabs";
import { parseTransfer, recordFromTransfer, transferOf, transferOfRecord, type TabTransfer } from "./tabTransfer";
import type { TabLayoutApi } from "./useTabLayout";
import { currentZoom } from "./zoom";

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

/** `tab-drag-over`, from the backend: where a tab from another window
 *  would land here; or (`home`) this window's own tab, dragged back over
 *  it, at `x`, `y`. `label`: the tab's name, to draw by the pointer where
 *  the OS draws nothing (Windows). */
export interface TabOver {
  zone: Landing | null;
  home: boolean;
  x: number;
  y: number;
  label: string | null;
}

/** `tab-drop`: a tab from another window (its record, and where), or this
 *  window's own tab back on it (`home`, at `x`, `y`). */
export interface TabDrop {
  tab: unknown;
  zone: Landing | null;
  home: boolean;
  x: number;
  y: number;
}

/** `tab-drag-end`, to the window tab `tab` was dragged out of. */
export interface TabDragEnd {
  tab: number;
  outcome: "moved" | "home" | "cancelled" | "failed";
  message: string | null;
}

/** The layout once a tab from another window has landed here, or null
 *  when what came isn't a tab. */
export function receiveTab(l: Layout, drop: Pick<TabDrop, "tab" | "zone">): Layout | null {
  const t = parseTransfer(drop.tab);
  return t && landTab(l, recordFromTransfer(t), drop.zone);
}

/** Tab `id`, dragged out and dropped back on its own window at `x`, `y`:
 *  where a drag inside the window would put it there, or where it was. */
export function homeDrop(l: Layout, id: number, x: number, y: number, doc: Document = document): Layout {
  const at = findTab(l, id);
  const t = at && tabDropAt(x, y, isSplit(l), at.pane, doc);
  return at && t ? dropTab(l, at, t) : l;
}

/** What tab `id` leaving for another window leaves: the layout without it,
 *  "close" when it was the window's last tab, or null when it's gone
 *  already (closed during the drag). */
export function afterMove(l: Layout, id: number): Layout | "close" | null {
  if (!findTab(l, id)) return null;
  return removeTab(l, id) ?? "close";
}

export interface TabMoves {
  /** The tab bar of `pane`'s handler for a press on a tab. */
  onTabPointerDown: (pane: number) => (e: React.PointerEvent, index: number) => void;
  moveToOtherPane: (pane: number, index: number) => void;
  /** Move to New Window; not for a window's only tab. */
  moveToNewWindow: (pane: number, index: number) => void;
}

/** Where a tab drag goes once it's out of the window, on this platform. */
const OUTSIDE = IS_WINDOWS ? "track" : "handoff";

export function useTabMoves(api: TabLayoutApi): TabMoves {
  const apiRef = useRef(api);
  apiRef.current = api;
  // The tab handed to the OS as a drag (Linux), until `tab-drag-end`.
  const outgoing = useRef<number | null>(null);
  // When that drag ends, the backend hands this webview the button release
  // it missed (gtk_dnd.rs), and the click that may make isn't one. Clicks
  // are swallowed from the hand-off until the end, or the next press.
  const unswallow = useRef<(() => void) | null>(null);
  const swallowClicks = () => {
    unswallow.current?.();
    const swallow = (c: MouseEvent) => {
      c.stopPropagation();
      c.preventDefault();
    };
    const done = () => {
      window.removeEventListener("click", swallow, true);
      window.removeEventListener("mousedown", done, true);
      if (unswallow.current === done) unswallow.current = null;
    };
    window.addEventListener("click", swallow, true);
    window.addEventListener("mousedown", done, true);
    unswallow.current = done;
  };

  const recordOf = (rec: TabRecord): TabTransfer => {
    const h = apiRef.current.handles[rec.id];
    return h ? transferOf(h.state) : transferOfRecord(rec);
  };
  const toast = (message: string) => dialogs.showToast({ message, variant: "error" });
  /** Tab `id` is in another window now. */
  const takeOut = (id: number) => {
    const next = afterMove(apiRef.current.layout, id);
    if (next === "close") void winClose();
    else if (next) apiRef.current.update(l => removeTab(l, id) ?? l);
  };

  // Tabs from other windows, and the end of this window's own OS drag.
  useEffect(() => {
    const feedback = new TabDropFeedback();
    const subs: Promise<() => void>[] = [];
    const on = <T,>(name: string, cb: (p: T) => void, here = true) => {
      try {
        subs.push((here ? listenHere<T>(name, e => cb(e.payload)) : listen<T>(name, e => cb(e.payload))).catch(() => () => {}));
      } catch { /* no Tauri */ }
    };
    // A drag began somewhere: say where this window takes a tab. Sent to
    // every window at once.
    on<null>("tab-drag-began", () => {
      void tabDropZones(dropZones(isSplit(apiRef.current.layout), currentZoom()));
    }, false);
    on<TabOver>("tab-drag-over", p => {
      const l = apiRef.current.layout;
      let t: TabDropTarget | null = null;
      if (p.home) {
        const at = outgoing.current === null ? null : findTab(l, outgoing.current);
        const here = at && tabDropAt(p.x, p.y, isSplit(l), at.pane);
        t = at && here && tabAccepts(l, at, here) ? here : null;
      } else if (p.zone) {
        t = targetOf(p.zone);
      }
      feedback.show(t);
      feedback.label(p.x, p.y, p.label);
    });
    on<null>("tab-drag-leave", () => feedback.clear());
    on<TabDrop>("tab-drop", p => {
      feedback.clear();
      const id = outgoing.current;
      if (p.home) {
        if (id !== null) apiRef.current.update(l => homeDrop(l, id, p.x, p.y));
        return;
      }
      apiRef.current.update(l => receiveTab(l, p) ?? l);
    });
    on<TabDragEnd>("tab-drag-end", p => {
      feedback.clear();
      if (outgoing.current === p.tab) outgoing.current = null;
      const done = unswallow.current;
      if (done) setTimeout(done, 0);
      if (p.outcome === "moved") takeOut(p.tab);
      else if (p.outcome === "failed") toast(`couldn't open the tab in a new window: ${p.message ?? "unknown error"}`);
    });
    return () => {
      feedback.clear();
      unswallow.current?.();
      for (const s of subs) void s.then(fn => fn());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onTabPointerDown = (pane: number) => (e: React.PointerEvent, index: number) => {
    if ((e.target as HTMLElement | null)?.closest(".close")) return;
    const l = apiRef.current.layout;
    const rec = l.panes[pane]?.tabs[index];
    if (!rec) return;
    // The tab can move while it's dragged (a tab closed by a key), so its
    // place is looked up by id when it lands.
    const where = () => findTab(apiRef.current.layout, rec.id);
    const start = () => tabDragStart(rec.id, recordOf(rec), rec.label, tabAnchor(currentZoom()));
    // Track mode (Windows): the drag out there, from the first move out to
    // the release, a return or Escape. The window under the pointer is
    // asked for only when the pointer has moved, one call at a time, and
    // not at all once it's back in or let go.
    let started: Promise<boolean> | null = null;
    let out = false;
    let asking = false;
    let again = false;
    const hover = () => {
      if (!out || !started) return;
      if (asking) {
        again = true;
        return;
      }
      asking = true;
      void started.then(ok => (ok && out ? tabDragHover() : undefined)).finally(() => {
        asking = false;
        if (again && out) {
          again = false;
          hover();
        }
      });
    };
    beginTabDrag(e, {
      label: rec.label,
      single: tabCount(l) === 1,
      split: isSplit(l),
      pane,
      outside: OUTSIDE,
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
      onHandOff: () => {
        outgoing.current = rec.id;
        swallowClicks();
        start().catch(err => {
          outgoing.current = null;
          unswallow.current?.();
          toast(`couldn't drag the tab out: ${errText(err)}`);
        });
      },
      onLeave: () => {
        out = true;
        started = start().then(() => true, err => {
          toast(`couldn't drag the tab out: ${errText(err)}`);
          return false;
        });
      },
      onOutsideMove: hover,
      onReturn: () => {
        out = false;
        again = false;
        void started?.then(ok => (ok ? tabDragCancel() : undefined));
        started = null;
      },
      onReleaseOutside: () => {
        out = false;
        again = false;
        const s = started;
        started = null;
        if (!s) return;
        s.then(ok => (ok ? tabDragRelease() : null)).then(
          r => { if (r === "moved") takeOut(rec.id); },
          err => toast(`couldn't move the tab: ${errText(err)}`),
        );
      },
    });
  };

  return {
    onTabPointerDown,
    moveToOtherPane: (pane, index) => apiRef.current.update(l => toOtherPane(l, { pane, index })),
    moveToNewWindow: (pane, index) => {
      const l = apiRef.current.layout;
      const rec = l.panes[pane]?.tabs[index];
      if (!rec || tabCount(l) < 2) return;
      tabToNewWindow(recordOf(rec)).then(
        () => takeOut(rec.id),
        err => toast(`couldn't open the tab in a new window: ${errText(err)}`),
      );
    },
  };
}
