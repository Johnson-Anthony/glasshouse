// Scripted walkthroughs of the demo, used by the site's tour and by the
// capture script that records the site's images and clips. A scene drives the
// real UI with synthetic pointer and key events and a visible pretend cursor;
// any real input from the visitor stops it.
import { HOME, REPO } from "./mock/content";
import { backend } from "./mock/install";

export class Cancelled extends Error {}

let token = 0;
let speed = 1;

function check(t: number): void {
  if (t !== token) throw new Cancelled("scene stopped");
}

const sleep = (t: number, ms: number) =>
  new Promise<void>(r => setTimeout(r, ms * speed)).then(() => check(t));

async function waitFor<T>(t: number, fn: () => T | null | undefined | false, timeout = 5000): Promise<T> {
  const end = Date.now() + timeout;
  for (;;) {
    check(t);
    const v = fn();
    if (v) return v;
    if (Date.now() > end) throw new Error("scene: timed out waiting for the UI");
    await new Promise(r => setTimeout(r, 40));
  }
}

// ---- pretend cursor ----
let cursor: HTMLDivElement | null = null;
const pos = { x: 640, y: 420 };

function ensureCursor(): HTMLDivElement {
  if (cursor) return cursor;
  cursor = document.createElement("div");
  cursor.id = "demo-cursor";
  cursor.innerHTML =
    '<svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true"><path d="M3 2l14 8.5-6.2 1.3L7.6 18z" fill="#fff" stroke="#111" stroke-width="1.4" stroke-linejoin="round"/></svg><span class="ring"></span>';
  document.body.appendChild(cursor);
  place(pos.x, pos.y, false);
  return cursor;
}

function place(x: number, y: number, animate: boolean): void {
  const c = ensureCursor();
  c.style.transition = animate ? `transform ${Math.round(420 * speed)}ms cubic-bezier(.3,.7,.2,1)` : "none";
  c.style.transform = `translate(${x}px, ${y}px)`;
  pos.x = x;
  pos.y = y;
}

export function hideCursor(): void {
  cursor?.classList.remove("on");
}

function center(el: Element): { x: number; y: number } {
  const r = el.getBoundingClientRect();
  return { x: r.left + Math.min(r.width / 2, 60), y: r.top + r.height / 2 };
}

async function moveTo(t: number, el: Element): Promise<{ x: number; y: number }> {
  ensureCursor().classList.add("on");
  const p = center(el);
  place(p.x, p.y, true);
  await sleep(t, 480);
  return p;
}

function pulse(): void {
  const ring = cursor?.querySelector(".ring");
  ring?.classList.remove("go");
  void (ring as HTMLElement | undefined)?.offsetWidth;
  ring?.classList.add("go");
}

async function click(t: number, el: Element, opts: { double?: boolean; right?: boolean } = {}): Promise<void> {
  const { x, y } = await moveTo(t, el);
  const base = { bubbles: true, cancelable: true, clientX: x, clientY: y, button: opts.right ? 2 : 0 };
  pulse();
  el.dispatchEvent(new PointerEvent("pointerdown", { ...base, pointerId: 1, pointerType: "mouse", isPrimary: true }));
  el.dispatchEvent(new MouseEvent("mousedown", base));
  el.dispatchEvent(new PointerEvent("pointerup", { ...base, pointerId: 1, pointerType: "mouse", isPrimary: true }));
  el.dispatchEvent(new MouseEvent("mouseup", base));
  if (opts.right) {
    el.dispatchEvent(new MouseEvent("contextmenu", base));
  } else {
    el.dispatchEvent(new MouseEvent("click", { ...base, detail: 1 }));
    if (opts.double) {
      el.dispatchEvent(new MouseEvent("click", { ...base, detail: 2 }));
      el.dispatchEvent(new MouseEvent("dblclick", { ...base, detail: 2 }));
    }
  }
  await sleep(t, 260);
}

/** Press a key combo like "ctrl+`", "space", "Enter". */
async function key(t: number, combo: string): Promise<void> {
  const parts = combo.split("+");
  const k = parts.pop()!;
  const named: Record<string, [string, string]> = {
    space: [" ", "Space"], enter: ["Enter", "Enter"], escape: ["Escape", "Escape"], esc: ["Escape", "Escape"],
    "`": ["`", "Backquote"], down: ["ArrowDown", "ArrowDown"], up: ["ArrowUp", "ArrowUp"],
    tab: ["Tab", "Tab"], backspace: ["Backspace", "Backspace"],
  };
  const [keyName, code] = named[k.toLowerCase()] ?? [k, k.length === 1 ? `Key${k.toUpperCase()}` : k];
  const init: KeyboardEventInit = {
    key: keyName, code, bubbles: true, cancelable: true,
    ctrlKey: parts.includes("ctrl"), shiftKey: parts.includes("shift"), altKey: parts.includes("alt"),
  };
  const target = document.activeElement ?? document.body;
  target.dispatchEvent(new KeyboardEvent("keydown", init));
  target.dispatchEvent(new KeyboardEvent("keyup", init));
  await sleep(t, 200);
}

/** Type into the focused text field (a React-controlled input). */
async function typeText(t: number, text: string): Promise<void> {
  const el = document.activeElement as HTMLInputElement | null;
  if (!el || !("value" in el)) return;
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value")?.set;
  for (const ch of text) {
    setter?.call(el, el.value + ch);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    await sleep(t, 70 + Math.random() * 50);
  }
}

/** Type a command into the terminal's shell, keystroke by keystroke. */
async function typeShell(t: number, text: string): Promise<void> {
  for (const ch of text) {
    backend.typeIntoShell(ch);
    await sleep(t, 55 + Math.random() * 45);
  }
}

// ---- UI lookups ----
const sidebarItem = (path: string) =>
  document.querySelector(`.sb-item[data-sidebar-drop-path="${CSS.escape(path)}"]`);

function row(name: string): HTMLElement | null {
  for (const r of document.querySelectorAll<HTMLElement>(".row")) {
    const n = r.querySelector(".name");
    if (n && n.textContent?.replace(/\s+/g, "") === name.replace(/\s+/g, "")) return r;
  }
  return null;
}

const terminalOpen = () => !!document.querySelector(".xterm");

async function goTo(t: number, path: string): Promise<void> {
  const item = await waitFor(t, () => sidebarItem(path));
  await click(t, item);
  await waitFor(t, () => document.querySelector(".breadcrumb, .crumbs") ?? true);
  await sleep(t, 350);
}

async function openTerminal(t: number): Promise<void> {
  if (!terminalOpen()) {
    document.querySelector<HTMLElement>(".pane")?.focus();
    await key(t, "ctrl+`");
  }
  await waitFor(t, () => backend.shellReady());
  await sleep(t, 300);
}

// ---- scenes ----
type Scene = (t: number) => Promise<void>;

export const SCENES: Record<string, Scene> = {
  /** The landing page's hero image: the repo, a selected file, the terminal. */
  async hero(t) {
    await goTo(t, REPO);
    await openTerminal(t);
    await typeShell(t, "git status\r");
    await sleep(t, 400);
    const readme = await waitFor(t, () => row("README.md"));
    await click(t, readme);
    await sleep(t, 500);
  },

  async home(t) {
    await goTo(t, HOME);
  },
};

export interface RunOptions {
  /** Multiplies every delay; 0 runs as fast as the UI allows (captures). */
  speed?: number;
  cursor?: boolean;
}

export async function runScene(name: string, opts: RunOptions = {}): Promise<boolean> {
  const scene = SCENES[name];
  if (!scene) return false;
  const t = ++token;
  speed = opts.speed ?? 1;
  try {
    await scene(t);
    return true;
  } catch (e) {
    if (e instanceof Cancelled) return false;
    throw e;
  } finally {
    if (t === token && opts.cursor === false) hideCursor();
  }
}

export function stopScene(): void {
  token++;
  hideCursor();
}

// Real input from the visitor takes over from a running scene.
for (const type of ["pointerdown", "keydown", "wheel"] as const) {
  window.addEventListener(type, e => { if (e.isTrusted) stopScene(); }, { capture: true });
}
