import { describe, expect, it } from "vitest";
import { CONTEXT_EMPTY, CONTEXT_FILE, GIT_CHORDS, MENUS, type MenuItemDef } from "./data";
import { CHEATSHEET, KEYMAP, findBinding, matches, parseCombo, type KeyAction, type KeyEventLike } from "./keymap";

function key(combo: string, extra: Partial<KeyEventLike> = {}): KeyEventLike {
  const p = parseCombo(combo);
  return { key: p.key, ctrlKey: p.ctrl, metaKey: false, shiftKey: p.shift, altKey: p.alt, defaultPrevented: false, ...extra };
}
const find = (combo: string, state: { inText?: boolean; selected?: number } = {}, extra: Partial<KeyEventLike> = {}) =>
  findBinding(key(combo, extra), { inText: state.inText ?? false, selected: state.selected ?? 0 });
const sends = (combo: string, state?: { inText?: boolean; selected?: number }, extra?: Partial<KeyEventLike>) => {
  const b = find(combo, state, extra);
  return b ? b.send ?? `run:${b.run}` : undefined;
};

describe("parseCombo", () => {
  it("splits modifiers from the key", () => {
    expect(parseCombo("Ctrl+Shift+R")).toEqual({ ctrl: true, shift: true, alt: false, key: "r" });
    expect(parseCombo("Alt+ArrowUp")).toEqual({ ctrl: false, shift: false, alt: true, key: "arrowup" });
    expect(parseCombo("F5")).toEqual({ ctrl: false, shift: false, alt: false, key: "f5" });
    expect(parseCombo("Space").key).toBe(" ");
    expect(parseCombo("Ctrl++").key).toBe("+");
    expect(parseCombo("Ctrl+-").key).toBe("-");
  });
});

describe("matches", () => {
  const b = KEYMAP.find(x => x.combo === "Ctrl+B")!;
  it("needs the named modifiers and no others", () => {
    expect(matches(b, key("Ctrl+B"))).toBe(true);
    expect(matches(b, key("Ctrl+B", { ctrlKey: false, metaKey: true }))).toBe(true); // ⌘ counts as Ctrl
    expect(matches(b, key("Ctrl+Shift+B"))).toBe(false);
    expect(matches(b, key("Ctrl+Alt+B"))).toBe(false); // AltGr reports Ctrl+Alt
    expect(matches(b, key("B"))).toBe(false);
  });
  it("ignores the modifiers a binding lists in `any`", () => {
    expect(sends("Ctrl+F5")).toBe("Refresh");
    expect(sends("Ctrl+Alt+P")).toBe("run:palette");
    expect(sends("Ctrl+Shift+`")).toBe("run:terminal");
  });
  it("compares keys without case and takes alternate keys", () => {
    expect(sends("Ctrl+Shift+R", {}, { key: "R" })).toBe("Bulk Rename…");
    expect(sends("Ctrl+=")).toBe("Zoom In");
    expect(sends("Ctrl++")).toBe("Zoom In");
    expect(sends("Ctrl+_")).toBe("Zoom Out");
  });
});

describe("findBinding", () => {
  it("keeps file shortcuts away from text fields, but not panel toggles", () => {
    expect(sends("Ctrl+B", { inText: true })).toBe("Sidebar");
    expect(sends("Ctrl+P", { inText: true })).toBe("run:palette");
    expect(sends("Delete", { inText: true, selected: 1 })).toBeUndefined();
    expect(sends("Ctrl+V", { inText: true })).toBeUndefined();
    expect(sends("Ctrl+Shift+V", { inText: true })).toBeUndefined(); // plain-text paste stays the browser's
    expect(sends("/", { inText: true })).toBeUndefined();
    expect(sends("Backspace", { inText: true })).toBeUndefined();
  });

  it("leaves Ctrl+C and Ctrl+X to the browser without a selection", () => {
    expect(sends("Ctrl+C")).toBeUndefined();
    expect(sends("Ctrl+C", { selected: 2 })).toBe("Copy");
    expect(sends("Ctrl+X", { selected: 1 })).toBe("Cut");
    expect(sends("Ctrl+V")).toBe("Paste");
  });

  it("picks the variant for the selection or modifier", () => {
    expect(sends("F2", { selected: 1 })).toBe("Rename");
    expect(sends("F2", { selected: 3 })).toBe("Bulk Rename…");
    expect(sends("Delete", { selected: 1 })).toBe("Move to Trash");
    expect(sends("Shift+Delete", { selected: 1 })).toBe("Delete Permanently");
    expect(sends("Ctrl+Tab")).toBe("Next Tab");
    expect(sends("Ctrl+Shift+Tab")).toBe("Prev Tab");
    expect(sends("Ctrl+Z")).toBe("Undo");
    expect(sends("Ctrl+Y")).toBe("Redo");
    expect(sends("Ctrl+Shift+Z")).toBe("Redo");
    expect(sends("Ctrl+P")).toBe("run:palette");
    expect(sends("Ctrl+Shift+P")).toBe("Batch Permissions…");
  });

  it("opens with Enter and Quick Looks with Space only when something is selected", () => {
    expect(sends("Enter")).toBeUndefined();
    expect(sends("Enter", { selected: 1 })).toBe("Open");
    expect(sends("Space")).toBeUndefined();
    expect(sends("Space", { selected: 1 })).toBe("run:quickLook");
    expect(sends("Space", { selected: 1 }, { defaultPrevented: true })).toBeUndefined();
  });

  it("maps Ctrl+1…7 to the display modes in menu order", () => {
    expect([1, 2, 3, 4, 5, 6, 7].map(n => sends(`Ctrl+${n}`))).toEqual([
      "Details (rows)", "Compact List", "Icons", "Tiles", "Grid (thumbs)", "Tree Flat", "Miller Columns (ranger)",
    ]);
  });

  it("leaves Tab, F6 and Escape to App's own code", () => {
    for (const combo of ["Tab", "Shift+Tab", "F6", "Escape"]) expect(find(combo), combo).toBeUndefined();
  });
});

describe("menu shortcut hints", () => {
  // The command a `run` action stands for, when a menu item advertises its key.
  const RUN_FOR: Record<string, KeyAction> = {
    "Command Palette": "palette",
    "Find in Files": "findInFiles",
    "Toggle Drawer": "terminal",
    "Tweaks": "tweaks",
    "Preferences…": "tweaks",
    "Keybindings Cheatsheet": "cheatsheet",
  };
  // Labels one switch case handles together.
  const ALIAS: Record<string, string> = {
    "Show Hidden Files": "Toggle Hidden Files",
    "Bookmark Folder": "Bookmark This Folder",
  };
  // Handled outside the window keymap.
  const ELSEWHERE: Record<string, string> = {
    "Select All": "FilePane's own key handler",
  };
  // Hints whose key does something else, or nothing. Found when the keymap
  // became a table; reported, not fixed here. Remove an entry once fixed.
  const KNOWN_GAPS = [
    "Quit Ctrl+Q", "Copy Path Ctrl+Shift+C", "Deselect Esc", "Select by Pattern… *", // no binding
    "New Terminal Tab Ctrl+Shift+`", // toggles the drawer, like Ctrl+`
    "Open in Terminal Ctrl+`", // toggles the drawer instead
    "Find & Replace in Files Ctrl+Shift+F", // opens Find in Files instead
  ];
  const gapKey = (h: { send: string; kb: string }) => `${h.send} ${h.kb}`;

  const hinted: { send: string; kb: string }[] = [];
  const walk = (list: MenuItemDef[]) => {
    for (const it of list) {
      if (it.kind === "item" && it.kb) hinted.push({ send: it.action ?? it.label, kb: Array.isArray(it.kb) ? it.kb.join("+") : it.kb });
      else if (it.kind === "sub") walk(it.children);
    }
  };
  for (const tree of [...Object.values(MENUS), CONTEXT_FILE, CONTEXT_EMPTY]) walk(tree);
  const norm = (kb: string) => {
    const p = parseCombo(kb.replace(/\bDel\b/, "Delete").replace("↑", "ArrowUp").replace(/^Esc$/, "Escape"));
    return [p.ctrl, p.shift, p.alt, p.key].join();
  };
  const bound = (h: { send: string; kb: string }) =>
    KEYMAP.some(b => norm(b.combo) === norm(h.kb) &&
      (b.send !== undefined && (b.send === h.send || b.send === ALIAS[h.send])) || (b.run !== undefined && b.run === RUN_FOR[h.send]));

  it("each advertised key runs that item's command", () => {
    const chords = new Set(Object.values(GIT_CHORDS));
    const unbound = hinted.filter(h =>
      !bound(h) && !(h.kb.startsWith("Ctrl+G ") && chords.has(h.send)) && !ELSEWHERE[h.send] && !KNOWN_GAPS.includes(gapKey(h)));
    expect(unbound).toEqual([]);
  });

  it("still lists only real gaps as known gaps", () => {
    for (const gap of KNOWN_GAPS) {
      const h = hinted.find(x => gapKey(x) === gap);
      expect(h, gap).toBeDefined();
      expect(bound(h!), gap).toBe(false);
    }
  });
});

describe("CHEATSHEET", () => {
  it("lists the keys no menu item advertises", () => {
    expect(CHEATSHEET.map(c => `${c.keys} ${c.label}`).sort()).toEqual([
      "/ Focus search",
      "Backspace Open parent",
      "Ctrl+Shift+Tab Previous Tab",
      "Ctrl+Tab Next Tab",
      "Ctrl+` Toggle terminal",
      "Enter Open selected",
      "Esc Close modal / palette",
      "Shift+Del Delete permanently",
    ]);
  });
});
