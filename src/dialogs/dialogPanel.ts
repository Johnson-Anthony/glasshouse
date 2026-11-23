import { useCallback, useRef, type MutableRefObject, type RefObject } from "react";

// What every dialog's panel shares, as props for its element:
//   const dlg = useDialogPanel("about");
//   <div {...dlg} …>
// - to a screen reader it's a modal dialog with a name (and, for an alert,
//   its message as the description, so the message is read on opening);
// - the focus comes into the panel when it opens, unless the dialog puts it
//   on a field of its own afterwards, and goes back to what had it on close;
// - Tab and Shift+Tab stay inside the topmost open panel.
// The keys behind a dialog are modal.ts's business (useModal), not this.
//
// The work hangs off the element's ref, not an effect: it runs when the
// panel enters and leaves the page, before any dialog's own effects, and a
// component that stays mounted while closed needs no `open` flag here.

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]';

/** The Tab stops inside `root`, in document order. */
export function tabStops(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(el =>
    el.tabIndex >= 0 && !el.closest("[hidden], [inert]") && (typeof el.checkVisibility !== "function" || el.checkVisibility()));
}

interface Held {
  el: HTMLElement;
  /** What had the focus when the panel opened. */
  prev: HTMLElement | null;
  off: () => void;
}

// Open panels, the topmost last.
const stack: Held[] = [];

/** Keeps a Tab press inside `panel`; true when it moved the focus itself. */
export function trapTab(panel: HTMLElement, e: Pick<KeyboardEvent, "key" | "shiftKey" | "ctrlKey" | "altKey" | "metaKey" | "preventDefault">, active: Element | null = document.activeElement): boolean {
  if (e.key !== "Tab" || e.ctrlKey || e.altKey || e.metaKey) return false;
  const stops = tabStops(panel);
  const inside = !!active && panel.contains(active);
  const first = stops[0], last = stops[stops.length - 1];
  let to: HTMLElement | null = null;
  if (stops.length === 0) to = panel;
  else if (!inside) to = e.shiftKey ? last : first;
  else if (e.shiftKey && (active === first || active === panel)) to = last;
  else if (!e.shiftKey && active === last) to = first;
  if (!to) return false;
  e.preventDefault();
  to.focus();
  return true;
}

function open(el: HTMLElement): Held {
  const prev = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
  const top = () => stack[stack.length - 1]?.el === el;
  const onKey = (e: KeyboardEvent) => {
    if (top() && !e.defaultPrevented) trapTab(el, e);
  };
  // The net under the trap: focus that still lands outside (the app putting
  // it back on the file list, a radio group's own Tab order) comes back to
  // the control that had it.
  let last: HTMLElement | null = null;
  const onFocusIn = (e: FocusEvent) => {
    if (!top() || !(e.target instanceof HTMLElement)) return;
    if (el.contains(e.target)) {
      last = e.target;
      return;
    }
    (last && last !== el && el.contains(last) ? last : tabStops(el)[0] ?? el).focus();
  };
  window.addEventListener("keydown", onKey);
  document.addEventListener("focusin", onFocusIn);
  const held: Held = {
    el,
    prev,
    off: () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("focusin", onFocusIn);
    },
  };
  stack.push(held);
  if (!el.contains(document.activeElement)) el.focus({ preventScroll: true });
  return held;
}

function close(h: Held): void {
  h.off();
  const i = stack.lastIndexOf(h);
  if (i >= 0) stack.splice(i, 1);
  // A dialog opened from this one, and still open, would give the focus back
  // to a control that is leaving with this panel: it takes this one's place
  // in line instead.
  for (const above of stack.slice(Math.max(i, 0))) {
    if (above.prev && h.el.contains(above.prev)) above.prev = h.prev;
  }
  // Back to what had the focus, unless it's already somewhere else (in that
  // dialog on top).
  const at = document.activeElement;
  if (h.prev?.isConnected && (!at || at === document.body || h.el.contains(at))) h.prev.focus({ preventScroll: true });
}

export interface DialogPanelOptions {
  /** The id of the element that titles the dialog, instead of a label. */
  labelledBy?: string;
  /** The id of its message, read when it opens. */
  describedBy?: string;
  /** An alert or a question that interrupts: role="alertdialog". */
  alert?: boolean;
  /** The dialog's own ref to its panel, kept current too. */
  ref?: RefObject<HTMLDivElement>;
}

/** Props for a dialog's panel element; see the top of this file. */
export function useDialogPanel(label: string, opts: DialogPanelOptions = {}) {
  const held = useRef<Held | null>(null);
  const outer = useRef(opts.ref);
  outer.current = opts.ref;
  const ref = useCallback((el: HTMLDivElement | null) => {
    if (outer.current) (outer.current as MutableRefObject<HTMLDivElement | null>).current = el;
    if (held.current && held.current.el !== el) {
      close(held.current);
      held.current = null;
    }
    if (el && !held.current) held.current = open(el);
  }, []);
  return {
    ref,
    role: opts.alert ? "alertdialog" : "dialog",
    "aria-modal": true,
    "aria-label": opts.labelledBy ? undefined : label,
    "aria-labelledby": opts.labelledBy,
    "aria-describedby": opts.describedBy,
    tabIndex: -1,
  } as const;
}

/** For tests: how many panels are open. */
export function openDialogPanels(): number {
  return stack.length;
}
