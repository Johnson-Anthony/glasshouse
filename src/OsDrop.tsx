// Files dragged in from other apps: a file manager, a browser's downloads.
// Tauri reports the drag over the window (`dragDropEnabled`); the target under
// the pointer lights up with a "copy to …" hint, and a drop copies into it.
// Always a copy: the drop event carries neither the keys held nor the
// source's choice of action, and a copy can't lose anything. The exception
// is the pane's own drag coming back after it left the window (see
// recordHandOff), which moves as it would have.
import { useEffect, useRef, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { DropHighlight, clearHandOff, dropTargetAt, handOffCopies, notAlreadyIn, type DropTarget } from "./dragDrop";
import { basename } from "./paths";

/** What a drop of `paths` at a target does, or null when it does nothing. */
export function osDropPlan(paths: string[], target: DropTarget | null, copy = true): { paths: string[]; dir: string; copy: boolean; label: string } | null {
  if (!target) return null;
  const moving = notAlreadyIn(paths, target.path);
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
    const highlight = new DropHighlight();
    // Physical pixels from the webview's corner, to CSS pixels.
    const at = (p: { x: number; y: number }) => {
      const r = window.devicePixelRatio || 1;
      return { x: p.x / r, y: p.y / r };
    };
    const planAt = (pos: { x: number; y: number }) => {
      const { x, y } = at(pos);
      const target = dropTargetAt(x, y);
      return { x, y, target, plan: osDropPlan(dragged, target, handOffCopies(dragged) ?? true) };
    };
    const clear = () => { highlight.set(null); setHint(null); };

    let unlisten: (() => void) | null = null;
    let disposed = false;
    try {
      getCurrentWebview().onDragDropEvent(e => {
        const ev = e.payload;
        if (ev.type === "enter" || ev.type === "over") {
          if (ev.type === "enter") dragged = ev.paths;
          const { x, y, target, plan } = planAt(ev.position);
          highlight.set(plan ? target!.el : null);
          setHint(plan ? { x, y, label: plan.label } : null);
        } else if (ev.type === "drop") {
          dragged = ev.paths;
          const { plan } = planAt(ev.position);
          clear();
          dragged = [];
          clearHandOff();
          if (plan) onDropRef.current(plan.paths, plan.dir, plan.copy);
        } else {
          clear();
          dragged = [];
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
