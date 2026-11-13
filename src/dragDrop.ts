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

// A drag handed to the OS can come straight back: aimed at a tab, it
// overshoots the window's top edge and returns. Its drop then arrives as one
// from another app, so the handoff is remembered, and a drop of exactly
// those paths is the pane's own drag again: a move, or a copy with Ctrl held
// at the handoff (the OS drop carries no keys). The record goes with that
// drop, the next press in the window, the window losing focus (a drag in
// another app starts with a press there), or shortly after the pointer is
// back with no button down. The webview sees no pointer events while the OS
// has the drag, and on release the pointer's return can reach the page just
// before the drop does, hence the grace.
export const HANDOFF_GRACE_MS = 1000;
let handOff: { paths: Set<string>; copy: boolean; stop: () => void } | null = null;

export function clearHandOff(): void {
  handOff?.stop();
  handOff = null;
}

export function recordHandOff(paths: string[], copy: boolean): void {
  clearHandOff();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const onMove = (ev: PointerEvent) => {
    if (ev.buttons === 0 && timer === undefined) timer = setTimeout(clearHandOff, HANDOFF_GRACE_MS);
  };
  const onEnd = () => clearHandOff();
  window.addEventListener("pointermove", onMove, true);
  window.addEventListener("pointerdown", onEnd, true);
  window.addEventListener("blur", onEnd);
  handOff = {
    paths: new Set(paths.map(p => normalizePath(p))),
    copy,
    stop: () => {
      clearTimeout(timer);
      window.removeEventListener("pointermove", onMove, true);
      window.removeEventListener("pointerdown", onEnd, true);
      window.removeEventListener("blur", onEnd);
    },
  };
}

/** For a drop arriving from the OS: whether it's the handed-off drag, and if
 *  so whether it copies (null when it came from another app). */
export function handOffCopies(paths: string[]): boolean | null {
  if (!handOff || paths.length !== handOff.paths.size) return null;
  const own = handOff.paths;
  return paths.every(p => own.has(normalizePath(p))) ? handOff.copy : null;
}
