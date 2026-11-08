import { beforeEach, describe, expect, it } from "vitest";
import { clearRedo, pushUndo, redoLast, redoStack, undoLast, undoStack, type UndoEntry } from "./state";

/** An entry that records which direction ran into `log`. */
const entry = (label: string, log: string[] = []): UndoEntry => ({
  label,
  inverse: () => { log.push(`undo ${label}`); },
  redo: () => { log.push(`redo ${label}`); },
});
const labels = (s: UndoEntry[]) => s.map(e => e.label);

beforeEach(() => {
  undoStack.length = 0;
  redoStack.length = 0;
});

describe("undoLast / redoLast", () => {
  it("undo runs inverse and redo runs redo, never the same function twice", async () => {
    const log: string[] = [];
    pushUndo(entry("rename", log));
    await undoLast();
    await redoLast();
    await undoLast();
    expect(log).toEqual(["undo rename", "redo rename", "undo rename"]);
  });

  it("goes last-in first-out and moves entries between the stacks", async () => {
    pushUndo(entry("a"));
    pushUndo(entry("b"));
    expect(await undoLast()).toEqual({ status: "done", label: "b" });
    expect(labels(undoStack)).toEqual(["a"]);
    expect(labels(redoStack)).toEqual(["b"]);
    expect(await undoLast()).toEqual({ status: "done", label: "a" });
    expect(await undoLast()).toEqual({ status: "empty" });
    expect(await redoLast()).toEqual({ status: "done", label: "a" });
    expect(await redoLast()).toEqual({ status: "done", label: "b" });
    expect(await redoLast()).toEqual({ status: "empty" });
    expect(labels(undoStack)).toEqual(["a", "b"]);
  });

  it("a new action clears redo", async () => {
    pushUndo(entry("a"));
    await undoLast();
    expect(labels(redoStack)).toEqual(["a"]);
    pushUndo(entry("b"));
    expect(redoStack).toEqual([]);
    expect(await redoLast()).toEqual({ status: "empty" });
  });

  it("drops an entry whose step fails, from both stacks", async () => {
    const err = new Error("locked");
    pushUndo(entry("a"));
    pushUndo({ label: "bad", inverse: () => { throw err; }, redo: () => {} });
    expect(await undoLast()).toEqual({ status: "failed", label: "bad", error: err });
    expect(labels(undoStack)).toEqual(["a"]);
    expect(redoStack).toEqual([]);
  });

  it("drops a redo that fails, leaving the rest", async () => {
    pushUndo({ label: "bad", inverse: () => {}, redo: async () => { throw new Error("gone"); } });
    pushUndo(entry("b"));
    await undoLast();
    await undoLast();
    expect(labels(redoStack)).toEqual(["b", "bad"]);
    expect((await redoLast()).status).toBe("failed");
    expect(labels(redoStack)).toEqual(["b"]);
    expect(undoStack).toEqual([]);
  });

  it("runs queued steps one at a time, in order", async () => {
    const log: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>(r => { release = r; });
    pushUndo(entry("first", log));
    pushUndo({
      label: "slow",
      inverse: async () => { log.push("slow start"); await gate; log.push("slow end"); },
      redo: () => {},
    });
    const a = undoLast();
    const b = undoLast();
    await Promise.resolve();
    expect(log).toEqual(["slow start"]);
    release();
    expect(await a).toEqual({ status: "done", label: "slow" });
    expect(await b).toEqual({ status: "done", label: "first" });
    expect(log).toEqual(["slow start", "slow end", "undo first"]);
  });
});

describe("stack bounds", () => {
  it("drops the oldest entry past 20", () => {
    for (let i = 0; i < 25; i++) pushUndo(entry(`e${i}`));
    expect(undoStack.length).toBe(20);
    expect(undoStack[0].label).toBe("e5");
    expect(undoStack[19].label).toBe("e24");
  });

  it("bounds both stacks through undo and redo", async () => {
    for (let i = 0; i < 20; i++) pushUndo(entry(`e${i}`));
    for (let i = 0; i < 25; i++) await undoLast();
    expect(redoStack.length).toBe(20);
    expect(undoStack).toEqual([]);
    for (let i = 0; i < 25; i++) await redoLast();
    expect(undoStack.length).toBe(20);
    expect(labels(undoStack).slice(0, 2)).toEqual(["e0", "e1"]);
  });

  it("clearRedo empties only the redo stack", async () => {
    pushUndo(entry("a"));
    pushUndo(entry("b"));
    await undoLast();
    clearRedo();
    expect(redoStack).toEqual([]);
    expect(labels(undoStack)).toEqual(["a"]);
  });
});
