// Files dragged in from outside the window: another app (a file manager, a
// browser's downloads), or a pane's drag handed to the OS by a glasshouse
// window. Tauri reports the drag over the window (`dragDropEnabled`); the
// target under the pointer lights up with a "copy to …" or "move to …"
// hint, and a drop goes into it.
// From another app it's always a copy: the drop event carries neither the
// keys held nor the source's choice of action, and a copy can't lose
// anything. A pane's own drag, from this window or another one, does what it
// would have inside a window: a move, or a copy if Ctrl was held as it left.
// The backend holds that drag while the OS has it, and says whether a drag
// is it (dragOutOwn, commands/drag_out.rs).
import { useEffect, useRef, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { dragOutOwn } from "./api";
import { DropHighlight, dropPaths, dropTargetAt, type DropTarget } from "./dragDrop";
import { basename } from "./paths";
import { currentZoom } from "./zoom";

/** What a drop of `paths` at a target does, or null when it does nothing.
 *  `own` is dragOutOwn's answer: for a pane's own drag, whether it copies,
 *  which makes duplicates in the folder it came from, as in the window.
 *  Null for a drop from another app: a copy that leaves out what's already
 *  there. */
export function osDropPlan(paths: string[], target: DropTarget | null, own: boolean | null = null): { paths: string[]; dir: string; copy: boolean; label: string } | null {
  if (!target) return null;
  const copy = own ?? true;
  const moving = dropPaths(paths, target.path, own === true);
  if (moving.length === 0) return null;
  const what = moving.length === 1 ? basename(moving[0]) : `${moving.length} items`;
  return { paths: moving, dir: target.path, copy, label: `${copy ? "copy" : "move"} ${what} to ${basename(target.path) || target.path}` };
}

export function OsDrop({ onDrop }: { onDrop: (paths: string[], dir: string, copy: boolean) => void }) {
  const [hint, setHint] = useState<{ x: number; y: number; label: string } | null>(null);
  const onDropRef = useRef(onDrop);
  onDropRef.current = onDrop;

  useEffect(() => {
    let dragged: string[] = [];
    // dragOutOwn's answer for the drag over the window; undefined while it's
    // asked, when nothing lights up. `asked` tells a late answer from an
    // earlier drag's.
    let own: boolean | null | undefined;
    let asked = 0;
    let last: { x: number; y: number } | null = null;
    const highlight = new DropHighlight();
    // Physical pixels from the webview's corner, to CSS pixels: divided by
    // the screen's scale and the window's zoom. Not by devicePixelRatio,
    // which counts the zoom in Chromium (WebView2) but not in WebKit.
    let scale: number | null = null;
    const readScale = () => {
      try {
        getCurrentWindow().scaleFactor().then(s => { if (s > 0) scale = s; }, () => { /* keep the last */ });
      } catch { /* no Tauri window */ }
    };
    readScale();
    const at = (p: { x: number; y: number }) => {
      const r = scale !== null ? scale * currentZoom() : (window.devicePixelRatio || 1);
      return { x: p.x / r, y: p.y / r };
    };
    const clear = () => { highlight.set(null); setHint(null); };
    const show = (pos: { x: number; y: number }) => {
      last = pos;
      if (own === undefined) {
        clear();
        return;
      }
      const { x, y } = at(pos);
      const target = dropTargetAt(x, y);
      const plan = osDropPlan(dragged, target, own);
      highlight.set(plan ? target!.el : null);
      setHint(plan ? { x, y, label: plan.label } : null);
    };
    const reset = () => {
      clear();
      dragged = [];
      own = undefined;
      last = null;
      asked++;
    };

    let unlisten: (() => void) | null = null;
    let disposed = false;
    try {
      getCurrentWebview().onDragDropEvent(e => {
        const ev = e.payload;
        if (ev.type === "enter") {
          reset();
          dragged = ev.paths;
          readScale();
          const n = asked;
          void dragOutOwn(dragged, false).then(v => {
            if (n !== asked) return;
            own = v;
            if (last) show(last);
          });
          show(ev.position);
        } else if (ev.type === "over") {
          show(ev.position);
        } else if (ev.type === "drop") {
          const paths = ev.paths;
          const { x, y } = at(ev.position);
          const target = dropTargetAt(x, y);
          reset();
          // Asked at every drop, one that goes nowhere included: it takes
          // what the backend kept for this window's drop, which then can't
          // answer for a later one.
          void dragOutOwn(paths, true).then(v => {
            const plan = osDropPlan(paths, target, v);
            if (plan) onDropRef.current(plan.paths, plan.dir, plan.copy);
          });
        } else {
          reset();
        }
      }).then(fn => { if (disposed) fn(); else unlisten = fn; }, () => { /* no drag-drop events */ });
    } catch {
      // No Tauri window (the browser demo, tests).
    }
    return () => {
      disposed = true;
      unlisten?.();
      highlight.set(null);
    };
  }, []);

  return hint && <div className="drag-ghost" style={{ left: hint.x + 12, top: hint.y + 12 }}>{hint.label}</div>;
}
