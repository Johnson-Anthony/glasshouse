// Drag and drop between the pane, the rest of the window and other apps.
// Inside the window the drag is the pane's own (pointer events, see
// FilePane). When it leaves the window it's handed to the OS
// (commands/drag_out.rs), so it can be dropped into another app; drops from
// other apps arrive through Tauri's drag-drop event (OsDrop.tsx).
//
// Anything that takes a drop carries `data-drop-path`, the folder a drop
// there goes into: folder rows, the pane itself (its current folder), tabs,
// breadcrumb segments and sidebar rows.
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
