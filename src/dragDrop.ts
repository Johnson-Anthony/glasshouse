// Drag and drop between the pane, the rest of the window and other apps.
// Inside the window the drag is the pane's own (pointer events, see
// FilePane). When it leaves the window it's handed to the OS
// (commands/drag_out.rs), so it can be dropped into another app or another
// glasshouse window; drops from outside the window arrive through Tauri's
// drag-drop event (OsDrop.tsx).
//
// Anything that takes a drop carries `data-drop-path`, the folder a drop
// there goes into: folder rows, the pane itself (its current folder), tabs,
// breadcrumb segments and sidebar rows.
import { listenHere } from "./events";
import { normalizePath, parentPath, type PathOps } from "./paths";

/** True once the pointer is at or past the window's edge. The edge pixel
 *  counts, in case the webview stops reporting positions outside. */
export function leftWindow(x: number, y: number, width: number, height: number): boolean {
  return x <= 0 || y <= 0 || x >= width - 1 || y >= height - 1;
}

/** A drag inside the app moves; Ctrl (Cmd on macOS) copies, as in Explorer
 *  and Nautilus. Shift asks for a move, which is already the default. */
export function dragCopies(keys: { ctrlKey: boolean; metaKey: boolean }): boolean {
  return keys.ctrlKey || keys.metaKey;
}

export interface DropTarget {
  /** The folder a drop here goes into. */
  path: string;
  el: HTMLElement;
}

/** The drop target at or around `el`: the nearest element with a
 *  `data-drop-path`, so a folder row wins over the pane it's in. */
export function dropTargetOf(el: Element | null): DropTarget | null {
  const t = el?.closest<HTMLElement>("[data-drop-path]");
  const path = t?.dataset.dropPath;
  return t && path ? { path, el: t } : null;
}

export function dropTargetAt(clientX: number, clientY: number): DropTarget | null {
  return dropTargetOf(document.elementFromPoint(clientX, clientY));
}

/** The paths a drop into `dir` would change: not the ones already in it
 *  (dropping a file on its own folder does nothing, as in Explorer), and not
 *  `dir` itself. */
export function notAlreadyIn(
  paths: string[],
  dir: string,
  ops: Pick<PathOps, "normalizePath" | "parentPath"> = { normalizePath, parentPath },
): string[] {
  const d = ops.normalizePath(dir);
  return paths.filter(p => {
    const n = ops.normalizePath(p);
    return n !== d && ops.normalizePath(ops.parentPath(p)) !== d;
  });
}

/** The paths a drop into `dir` acts on; none when it would change nothing.
 *  A move leaves out the ones already in `dir`. A copy keeps them: runTransfer
 *  gives each a free name ("a (copy).txt"), as Copy then Paste into their
 *  own folder does, which is Explorer's and Nautilus's Ctrl+drag there.
 *  Neither takes `dir` itself. */
export function dropPaths(
  paths: string[],
  dir: string,
  copy: boolean,
  ops: Pick<PathOps, "normalizePath" | "parentPath"> = { normalizePath, parentPath },
): string[] {
  if (!copy) return notAlreadyIn(paths, dir, ops);
  const d = ops.normalizePath(dir);
  return paths.filter(p => ops.normalizePath(p) !== d);
}

/** WebKit lets a selection begin with a press in text that can't be
 *  selected, and grows it as the pointer moves with the button down: a tab
 *  or files dragged out of the window selected the inspector's text. A
 *  press on that selection then starts WebKit's own drag of it, which takes
 *  the release, so the next file drag never ended. From the press of a drag
 *  (a tab, files) until it ends, no selection starts, and one the drag made
 *  anyway is dropped. The press ends with its release; after a handoff to
 *  the OS, with the release the backend hands the webview when the OS drag
 *  ends (src-tauri/src/tab_drag/gtk_dnd.rs). */
export function keepSelection(): void {
  const had = !(window.getSelection()?.isCollapsed ?? true);
  const block = (e: Event) => e.preventDefault();
  const end = () => {
    window.removeEventListener("selectstart", block, true);
    window.removeEventListener("pointerup", end, true);
    window.removeEventListener("pointercancel", end, true);
    const s = window.getSelection();
    if (!had && s && !s.isCollapsed) s.removeAllRanges();
  };
  window.addEventListener("selectstart", block, true);
  window.addEventListener("pointerup", end, true);
  window.addEventListener("pointercancel", end, true);
}

/** The one element showing "a drop goes here", during a drag. */
export class DropHighlight {
  private el: HTMLElement | null = null;
  set(el: HTMLElement | null): void {
    if (el === this.el) return;
    this.el?.classList.remove("drop-target");
    this.el = el;
    el?.classList.add("drop-target");
  }
}

// A drag handed to the OS (App's onDragOut, commands/drag_out.rs) can come
// back: to another glasshouse window, or to this one when a drag aimed at a
// tab overshoots the window's top edge. The backend holds it while the OS
// drag lasts, for every window, and OsDrop asks it (dragOutOwn) whether a
// drop is that drag: a move, or a copy if Ctrl was held at the handoff.
//
// When the OS drag ends, the backend hands this webview the button release
// it missed (Linux, gtk_dnd.rs), and the click that may make isn't one.
// Clicks are swallowed from the handoff until `drag-out-end`, or the next
// press.
let unswallow: (() => void) | null = null;

/** Swallows clicks from a handoff to the OS until its drag ends. Returns
 *  what stops it sooner, for a drag that didn't start. */
export function swallowHandOffClicks(): () => void {
  unswallow?.();
  let stopped = false;
  let off: (() => void) | null = null;
  const swallow = (c: MouseEvent) => {
    c.stopPropagation();
    c.preventDefault();
  };
  const stop = () => {
    if (stopped) return;
    stopped = true;
    window.removeEventListener("click", swallow, true);
    window.removeEventListener("mousedown", stop, true);
    off?.();
    if (unswallow === stop) unswallow = null;
  };
  window.addEventListener("click", swallow, true);
  window.addEventListener("mousedown", stop, true);
  unswallow = stop;
  // A moment after the end: the release's click reaches the page first.
  listenHere<null>("drag-out-end", () => { setTimeout(stop, 0); }).then(
    fn => { if (stopped) fn(); else off = fn; },
    () => { /* no Tauri window */ },
  );
  return stop;
}
