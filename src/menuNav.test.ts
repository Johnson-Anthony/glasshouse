import { describe, expect, it } from "vitest";
import { MENUS, type MenuItemDef } from "./data";
import {
  fitPath, firstIndex, isContextMenuKey, lastIndex, menuKey, mnemonics, nextByLetter, step,
  titleForKey, TypeAhead, TYPE_AHEAD_MS, typeAheadMatch, type MenuPath,
} from "./menuNav";

const item = (label: string): MenuItemDef => ({ kind: "item", label });
const sub = (label: string, children: MenuItemDef[]): MenuItemDef => ({ kind: "sub", label, children });
const SEP: MenuItemDef = { kind: "sep" };

// 0 heading, 1 Open, 2 sep, 3 Copy, 4 Send to ›, 5 sep, 6 Delete
const MENU: MenuItemDef[] = [
  { kind: "grouplabel", label: "FILE" },
  item("Open"),
  SEP,
  item("Copy"),
  sub("Send to", [item("Desktop"), SEP, item("Mail"), sub("Empty", [])]),
  SEP,
  item("Delete"),
];

const press = (path: MenuPath, key: string, mods: { ctrlKey?: boolean; altKey?: boolean } = {}) =>
  menuKey(MENU, path, { key, ctrlKey: false, altKey: false, metaKey: false, ...mods });

describe("step", () => {
  it("skips separators and headings and wraps", () => {
    expect(step(MENU, -1, 1)).toBe(1);
    expect(step(MENU, 1, 1)).toBe(3);
    expect(step(MENU, 4, 1)).toBe(6);
    expect(step(MENU, 6, 1)).toBe(1);
    expect(step(MENU, 1, -1)).toBe(6);
    expect(step(MENU, -1, -1)).toBe(6);
    expect(firstIndex(MENU)).toBe(1);
    expect(lastIndex(MENU)).toBe(6);
  });

  it("finds nothing in a list with nothing to land on", () => {
    expect(step([SEP, { kind: "grouplabel", label: "X" }], -1, 1)).toBe(-1);
    expect(firstIndex([])).toBe(-1);
  });
});

describe("menuKey", () => {
  it("moves with the arrows, Home and End", () => {
    expect(press([], "ArrowDown")).toEqual({ path: [1] });
    expect(press([], "ArrowUp")).toEqual({ path: [6] });
    expect(press([3], "ArrowDown")).toEqual({ path: [4] });
    expect(press([6], "ArrowDown")).toEqual({ path: [1] });
    expect(press([4], "Home")).toEqual({ path: [1] });
    expect(press([1], "End")).toEqual({ path: [6] });
  });

  it("opens a submenu on its first item with →, Enter or Space, and leaves it with ← or Esc", () => {
    expect(press([4], "ArrowRight")).toEqual({ path: [4, 0] });
    expect(press([4], "Enter")).toEqual({ path: [4, 0] });
    expect(press([4], " ")).toEqual({ path: [4, 0] });
    expect(press([4, 0], "ArrowDown")).toEqual({ path: [4, 2] });
    expect(press([4, 2], "ArrowDown")).toEqual({ path: [4, 3] });
    expect(press([4, 3], "ArrowDown")).toEqual({ path: [4, 0] });
    expect(press([4, 2], "ArrowLeft")).toEqual({ path: [4] });
    expect(press([4, 2], "Escape")).toEqual({ path: [4] });
    // Opened by the pointer, nothing highlighted in it: keys stay in the
    // parent menu until → or Enter goes in.
    expect(press([4, -1], "ArrowDown")).toEqual({ path: [6] });
    expect(press([4, -1], "ArrowUp")).toEqual({ path: [3] });
    expect(press([4, -1], "ArrowRight")).toEqual({ path: [4, 0] });
    expect(press([4, -1], "Enter")).toEqual({ path: [4, 0] });
    expect(press([4, -1], "ArrowLeft")).toEqual({ path: [4] });
    expect(press([4, -1], "Escape")).toEqual({ path: [4] });
  });

  it("doesn't open an empty submenu", () => {
    expect(press([4, 3], "ArrowRight")).toEqual({ path: [4, 3] });
  });

  it("runs a command with Enter or Space, and nothing when none is highlighted", () => {
    expect(press([3], "Enter")).toEqual({ run: MENU[3] });
    expect(press([4, 2], " ")).toEqual({ run: { kind: "item", label: "Mail" } });
    expect(press([], "Enter")).toEqual({ path: [] });
  });

  it("leaves at the edges, for the menubar to move on", () => {
    expect(press([1], "ArrowLeft")).toEqual({ exit: "prev" });
    expect(press([], "ArrowLeft")).toEqual({ exit: "prev" });
    expect(press([1], "ArrowRight")).toEqual({ exit: "next" });
    expect(press([4, 2], "ArrowRight")).toEqual({ exit: "next" });
    expect(press([1], "Escape")).toEqual({ exit: "close" });
  });

  it("jumps to the next item starting with a typed letter", () => {
    expect(press([], "d")).toEqual({ path: [6] });
    expect(press([], "C")).toEqual({ path: [3] });
    expect(press([4, 0], "m")).toEqual({ path: [4, 2] });
    expect(press([3], "x")).toEqual({ path: [3] });
  });

  it("leaves other keys and modified letters alone", () => {
    expect(press([1], "Shift")).toBeNull();
    expect(press([1], "F5")).toBeNull();
    expect(press([1], "d", { ctrlKey: true })).toBeNull();
    expect(press([1], "d", { altKey: true })).toBeNull();
  });
});

describe("nextByLetter", () => {
  it("cycles through the items with that letter, and skips a branch's * mark", () => {
    const branches = [item("* main"), item("  maint"), item("  dev")];
    expect(nextByLetter(branches, -1, "m")).toBe(0);
    expect(nextByLetter(branches, 0, "m")).toBe(1);
    expect(nextByLetter(branches, 1, "m")).toBe(0);
    expect(nextByLetter(branches, 0, "d")).toBe(2);
  });
});

describe("fitPath", () => {
  it("keeps a path the menu still has", () => {
    expect(fitPath(MENU, [4, 2])).toEqual([4, 2]);
    expect(fitPath(MENU, [4, -1])).toEqual([4, -1]);
  });

  it("cuts a path back to what is left", () => {
    expect(fitPath(MENU, [9])).toEqual([]);
    expect(fitPath(MENU, [2])).toEqual([]);
    expect(fitPath(MENU, [4, 7])).toEqual([4]);
    expect(fitPath(MENU, [3, 0])).toEqual([3]);
    expect(fitPath(MENU, [-1])).toEqual([]);
  });
});

describe("mnemonics", () => {
  it("gives each title the first letter no earlier title took", () => {
    const titles = ["File", "Edit", "Go", "Git", "Tools", "Terminal"];
    const marks = mnemonics(titles);
    expect(titles.map((t, i) => t[marks[i]])).toEqual(["F", "E", "G", "i", "T", "r"]);
  });

  it("are unique across the real menubar", () => {
    const titles = Object.keys(MENUS);
    const letters = mnemonics(titles).map((m, i) => titles[i][m]?.toLowerCase());
    expect(letters.every(Boolean)).toBe(true);
    expect(new Set(letters).size).toBe(titles.length);
  });

  it("find the title a key types, by letter or by key code", () => {
    const titles = ["File", "Go", "Git"];
    const marks = mnemonics(titles);
    expect(titleForKey(titles, marks, { key: "f", code: "KeyF" })).toBe("File");
    expect(titleForKey(titles, marks, { key: "I", code: "KeyI" })).toBe("Git");
    // A Cyrillic layout types а on the F key.
    expect(titleForKey(titles, marks, { key: "а", code: "KeyF" })).toBe("File");
    expect(titleForKey(titles, marks, { key: "x", code: "KeyX" })).toBeUndefined();
    expect(titleForKey(titles, marks, { key: "Enter", code: "Enter" })).toBeUndefined();
  });
});

describe("isContextMenuKey", () => {
  const k = (key: string, mods: Partial<Record<"shiftKey" | "ctrlKey" | "altKey" | "metaKey", boolean>> = {}) =>
    isContextMenuKey({ key, shiftKey: false, ctrlKey: false, altKey: false, metaKey: false, ...mods });
  it("is the Menu key or Shift+F10", () => {
    expect(k("ContextMenu")).toBe(true);
    expect(k("F10", { shiftKey: true })).toBe(true);
    expect(k("F10")).toBe(false);
    expect(k("F10", { shiftKey: true, ctrlKey: true })).toBe(false);
  });
});

describe("type-ahead", () => {
  const NAMES = ["alpha.txt", "Apple", "banana", "beta", "Éclair", "eel"];

  it("goes to the next name with a typed letter, cycling when it is typed again", () => {
    expect(typeAheadMatch(NAMES, 0, "b")).toBe(2);
    expect(typeAheadMatch(NAMES, 2, "b")).toBe(3);
    expect(typeAheadMatch(NAMES, 3, "bb")).toBe(2);
    expect(typeAheadMatch(NAMES, 1, "aaa")).toBe(0);
    // Nothing focused yet: from the top.
    expect(typeAheadMatch(NAMES, -1, "a")).toBe(0);
  });

  it("keeps a row that still matches a longer prefix", () => {
    expect(typeAheadMatch(NAMES, 0, "al")).toBe(0);
    expect(typeAheadMatch(NAMES, 0, "ap")).toBe(1);
    expect(typeAheadMatch(NAMES, 3, "ban")).toBe(2);
  });

  it("ignores case and accents", () => {
    expect(typeAheadMatch(NAMES, 0, "A")).toBe(1);
    expect(typeAheadMatch(NAMES, 0, "ec")).toBe(4);
    expect(typeAheadMatch(NAMES, 5, "e")).toBe(4);
  });

  it("finds nothing for a prefix no name has", () => {
    expect(typeAheadMatch(NAMES, 0, "zz")).toBe(-1);
    expect(typeAheadMatch([], 0, "a")).toBe(-1);
  });

  it("adds keys up until a pause of TYPE_AHEAD_MS", () => {
    const ta = new TypeAhead();
    expect(ta.active(0)).toBe(false);
    expect(ta.push("b", 1000)).toBe("b");
    expect(ta.active(1000 + TYPE_AHEAD_MS - 1)).toBe(true);
    expect(ta.push("a", 1000 + TYPE_AHEAD_MS - 1)).toBe("ba");
    expect(ta.push("n", 1000 + 2 * TYPE_AHEAD_MS - 1)).toBe("n");
  });
});
