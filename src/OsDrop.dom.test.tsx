// @vitest-environment happy-dom
// Drops from outside the window (OsDrop.tsx), with Tauri's drag-drop events
// and the backend faked. The backend says whether an OS drag is a pane's
// drag handed off by a glasshouse window (dragOutOwn); how it knows is
// tested in commands/drag_out.rs. Here: what the page asks, when, and what
// it does with the answer. Also the click a handoff's end may make.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { swallowHandOffClicks } from "./dragDrop";
import { OsDrop } from "./OsDrop";

type DragEvent =
  | { type: "enter"; paths: string[]; position: { x: number; y: number } }
  | { type: "over"; position: { x: number; y: number } }
  | { type: "drop"; paths: string[]; position: { x: number; y: number } }
  | { type: "leave" };

const fake = vi.hoisted(() => ({
  drag: null as ((e: { payload: DragEvent }) => void) | null,
  /** What dragOutOwn answers, by whether it's asked for a drop. */
  answer: { over: null as boolean | null, drop: null as boolean | null },
  asked: [] as Array<{ paths: string[]; drop: boolean }>,
  /** Answers held back until released. */
  hold: false,
  held: [] as Array<() => void>,
  events: new Map<string, () => void>(),
}));
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({
    onDragDropEvent: (cb: (e: { payload: DragEvent }) => void) => {
      fake.drag = cb;
      return Promise.resolve(() => { fake.drag = null; });
    },
  }),
}));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ scaleFactor: () => Promise.resolve(1) }) }));
vi.mock("./api", () => ({
  dragOutOwn: (paths: string[], drop: boolean) => {
    fake.asked.push({ paths, drop });
    const v = drop ? fake.answer.drop : fake.answer.over;
    if (!fake.hold) return Promise.resolve(v);
    return new Promise(r => fake.held.push(() => r(v)));
  },
}));
vi.mock("./events", () => ({
  listenHere: (name: string, cb: () => void) => {
    fake.events.set(name, cb);
    return Promise.resolve(() => { fake.events.delete(name); });
  },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Window B, at a scale of 1: its folder /b with a folder row "dest" at the
// top, and a sidebar spot that takes nothing at the bottom.
document.body.innerHTML = `
  <div id="root"></div>
  <section class="pane" data-drop-path="/b"><div class="row" data-drop-path="/b/dest">dest</div></section>
  <nav class="sidebar"><span class="heading">TAGS</span></nav>`;
const DEST = { x: 50, y: 10 }, PANE = { x: 50, y: 300 }, NOWHERE = { x: 50, y: 900 };
document.elementFromPoint = (_x: number, y: number) =>
  document.querySelector(y < 100 ? ".row" : y < 800 ? ".pane" : ".heading");

let root: Root;
let drops: Array<{ paths: string[]; dir: string; copy: boolean }>;
const send = (e: DragEvent) => act(async () => { fake.drag!({ payload: e }); });
const flush = () => act(async () => { await new Promise(r => setTimeout(r, 0)); });
const hint = () => document.querySelector(".drag-ghost")?.textContent ?? null;
const lit = () => [...document.querySelectorAll(".drop-target")].map(e => (e as HTMLElement).dataset.dropPath);

/** An OS drag of `paths` comes in, moves over `at`, and is let go there. */
async function dragIn(paths: string[], at: { x: number; y: number }): Promise<string | null> {
  await send({ type: "enter", paths, position: at });
  await flush();
  await send({ type: "over", position: at });
  const shown = hint();
  await send({ type: "drop", paths, position: at });
  await flush();
  return shown;
}

beforeEach(async () => {
  fake.answer = { over: null, drop: null };
  fake.asked = [];
  fake.hold = false;
  fake.held = [];
  drops = [];
  root = createRoot(document.getElementById("root")!);
  await act(async () => { root.render(<OsDrop onDrop={(paths, dir, copy) => drops.push({ paths, dir, copy })} />); });
});
afterEach(() => act(() => root.unmount()));

describe("a drop from outside the window", () => {
  it("moves a pane's drag handed off by another window, as inside a window", async () => {
    fake.answer = { over: false, drop: false };
    expect(await dragIn(["/a/f1.txt"], DEST)).toBe("move f1.txt to dest");
    expect(drops).toEqual([{ paths: ["/a/f1.txt"], dir: "/b/dest", copy: false }]);
    expect(fake.asked).toEqual([{ paths: ["/a/f1.txt"], drop: false }, { paths: ["/a/f1.txt"], drop: true }]);
  });

  it("copies it when Ctrl was held as it left its window", async () => {
    fake.answer = { over: true, drop: true };
    expect(await dragIn(["/a/f1.txt", "/a/f2.txt"], PANE)).toBe("copy 2 items to b");
    expect(drops).toEqual([{ paths: ["/a/f1.txt", "/a/f2.txt"], dir: "/b", copy: true }]);
  });

  it("takes this window's own drag back as it would have inside the window", async () => {
    // Out of the top edge and back, onto a folder: a move.
    fake.answer = { over: false, drop: false };
    expect(await dragIn(["/b/f1.txt"], DEST)).toBe("move f1.txt to dest");
    expect(drops.pop()).toEqual({ paths: ["/b/f1.txt"], dir: "/b/dest", copy: false });
    // Into its own folder: nothing, unless Ctrl made it a copy (duplicates).
    expect(await dragIn(["/b/f1.txt"], PANE)).toBeNull();
    expect(drops).toEqual([]);
    fake.answer = { over: true, drop: true };
    expect(await dragIn(["/b/f1.txt"], PANE)).toBe("copy f1.txt to b");
    expect(drops).toEqual([{ paths: ["/b/f1.txt"], dir: "/b", copy: true }]);
  });

  it("copies a drop from another app, leaving out what's already there", async () => {
    expect(await dragIn(["/other/o1.txt", "/b/dest/x.txt"], DEST)).toBe("copy o1.txt to dest");
    expect(drops).toEqual([{ paths: ["/other/o1.txt"], dir: "/b/dest", copy: true }]);
    drops = [];
    expect(await dragIn(["/b/f1.txt"], PANE)).toBeNull();
    expect(drops).toEqual([]);
  });

  it("asks at every drop, one nothing takes included, so a later drop from another app copies", async () => {
    // A to B, let go on B's sidebar where nothing takes it. The backend
    // answered for this drop, and the page took that answer by asking.
    fake.answer = { over: false, drop: false };
    expect(await dragIn(["/a/f1.txt"], NOWHERE)).toBeNull();
    expect(drops).toEqual([]);
    expect(fake.asked.at(-1)).toEqual({ paths: ["/a/f1.txt"], drop: true });
    // The same file from another app, onto a folder: the backend has
    // nothing for it now.
    fake.answer = { over: null, drop: null };
    expect(await dragIn(["/a/f1.txt"], DEST)).toBe("copy f1.txt to dest");
    expect(drops).toEqual([{ paths: ["/a/f1.txt"], dir: "/b/dest", copy: true }]);
  });

  it("lights nothing until the backend answers, and ignores an answer for an earlier drag", async () => {
    fake.hold = true;
    fake.answer = { over: false, drop: false };
    await send({ type: "enter", paths: ["/a/f1.txt"], position: DEST });
    await send({ type: "over", position: DEST });
    expect(hint()).toBeNull();
    expect(lit()).toEqual([]);
    await act(async () => { fake.held.shift()!(); });
    expect(hint()).toBe("move f1.txt to dest");
    expect(lit()).toEqual(["/b/dest"]);
    // It leaves; another app's drag comes in before the first answer for it.
    await send({ type: "leave" });
    expect(hint()).toBeNull();
    fake.answer = { over: null, drop: null };
    await send({ type: "enter", paths: ["/other/o1.txt"], position: PANE });
    await send({ type: "enter", paths: ["/other/o1.txt"], position: PANE });
    await act(async () => { fake.held.shift()!(); });
    expect(hint()).toBeNull();
    await act(async () => { fake.held.shift()!(); });
    expect(hint()).toBe("copy o1.txt to b");
  });
});

describe("swallowHandOffClicks", () => {
  const click = () => {
    const ev = new MouseEvent("click", { bubbles: true, cancelable: true });
    document.body.dispatchEvent(ev);
    return ev.defaultPrevented;
  };

  it("swallows clicks from the handoff until a moment after drag-out-end", async () => {
    vi.useFakeTimers();
    try {
      swallowHandOffClicks();
      await Promise.resolve();
      expect(click()).toBe(true);
      fake.events.get("drag-out-end")!();
      expect(click()).toBe(true);
      vi.advanceTimersByTime(0);
      expect(click()).toBe(false);
      expect(fake.events.has("drag-out-end")).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops at the next press, or when the drag didn't start", async () => {
    swallowHandOffClicks();
    window.dispatchEvent(new MouseEvent("mousedown"));
    expect(click()).toBe(false);
    const stop = swallowHandOffClicks();
    stop();
    expect(click()).toBe(false);
    await Promise.resolve();
    expect(fake.events.has("drag-out-end")).toBe(false);
  });
});
