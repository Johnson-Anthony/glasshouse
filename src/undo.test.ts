import { beforeEach, describe, expect, it } from "vitest";
import { clearRedo, popRedo, popUndo, pushUndo, redoStack, undoStack, type UndoEntry } from "./state";

const entry = (label: string): UndoEntry => ({ label, inverse: () => {} });
const labels = (s: UndoEntry[]) => s.map(e => e.label);

beforeEach(() => {
  undoStack.length = 0;
  redoStack.length = 0;
});

describe("undo stack", () => {
  it("pops entries last-in first-out", () => {
    pushUndo(entry("a"));
    pushUndo(entry("b"));
    expect(popUndo()?.label).toBe("b");
    expect(popUndo()?.label).toBe("a");
    expect(popUndo()).toBeUndefined();
  });

  it("moves an undone entry onto the redo stack, and back", () => {
    pushUndo(entry("a"));
    pushUndo(entry("b"));
    popUndo();
    expect(labels(undoStack)).toEqual(["a"]);
    expect(labels(redoStack)).toEqual(["b"]);
    expect(popRedo()?.label).toBe("b");
    expect(labels(undoStack)).toEqual(["a", "b"]);
    expect(redoStack).toEqual([]);
  });

  it("clears redo when a new action is pushed", () => {
    pushUndo(entry("a"));
    popUndo();
    expect(labels(redoStack)).toEqual(["a"]);
    pushUndo(entry("b"));
    expect(redoStack).toEqual([]);
    expect(popRedo()).toBeUndefined();
  });

  it("drops the oldest entry past 20", () => {
    for (let i = 0; i < 25; i++) pushUndo(entry(`e${i}`));
    expect(undoStack.length).toBe(20);
    expect(undoStack[0].label).toBe("e5");
    expect(undoStack[19].label).toBe("e24");
  });

  it("bounds the redo stack and the undo stack refilled by redo", () => {
    for (let i = 0; i < 20; i++) pushUndo(entry(`e${i}`));
    for (let i = 0; i < 25; i++) popUndo();
    expect(redoStack.length).toBe(20);
    expect(undoStack).toEqual([]);
    for (let i = 0; i < 25; i++) popRedo();
    expect(undoStack.length).toBe(20);
    expect(labels(undoStack).slice(0, 2)).toEqual(["e0", "e1"]);
  });

  it("clearRedo empties only the redo stack", () => {
    pushUndo(entry("a"));
    pushUndo(entry("b"));
    popUndo();
    clearRedo();
    expect(redoStack).toEqual([]);
    expect(labels(undoStack)).toEqual(["a"]);
  });
});
