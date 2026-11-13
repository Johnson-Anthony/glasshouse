import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CONTEXT_EMPTY, CONTEXT_FILE, GIT_CHORDS, MENUS, PALETTE, type MenuItemDef } from "./data";
import { CHEATSHEET, KEYMAP, findBinding, matches, parseCombo, type KeyAction, type KeyEventLike, type KeyState } from "./keymap";

function key(combo: string, extra: Partial<KeyEventLike> = {}): KeyEventLike {
  const p = parseCombo(combo);
  return { key: p.key, ctrlKey: p.ctrl, metaKey: false, shiftKey: p.shift, altKey: p.alt, defaultPrevented: false, ...extra };
}
const find = (combo: string, state: Partial<KeyState> = {}, extra: Partial<KeyEventLike> = {}) =>
  findBinding(key(combo, extra), { ...state, inText: state.inText ?? false, selected: state.selected ?? 0 });
const sends = (combo: string, state?: Partial<KeyState>, extra?: Partial<KeyEventLike>) => {
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
    expect(sends("Ctrl+Alt+`")).toBe("run:terminal");
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

describe("focus and targets", () => {
  it("runs nothing while a modal dialog is open", () => {
    // Enter in a confirm or the Folder Picker used to also Open the selection.
    expect(sends("Enter", { selected: 1, modal: true })).toBeUndefined();
    for (const combo of ["Delete", "F2", "Ctrl+C", "Ctrl+V", "Ctrl+P", "Ctrl+B", "Ctrl+G", "F1"]) {
      expect(sends(combo, { selected: 1, modal: true }), combo).toBeUndefined();
      expect(sends(combo, { selected: 1, modal: true, inText: true }), combo).toBeUndefined();
    }
  });

  it("keeps file keys off the pane's selection while the sidebar has focus", () => {
    const sidebar = { selected: 2, sidebar: true };
    for (const combo of ["Enter", "Space", "Delete", "Shift+Delete", "F2", "Ctrl+C", "Ctrl+X", "Ctrl+V",
                         "Ctrl+Shift+C", "Ctrl+Shift+V", "Ctrl+Shift+R", "Ctrl+Shift+P", "Ctrl+Shift+E",
                         "Ctrl+I", "Ctrl+U", "Alt+Enter", "*"]) {
      expect(sends(combo, sidebar), combo).toBeUndefined();
      expect(sends(combo, { selected: 2 }), combo).toBeDefined();
    }
    // App-wide keys still work from the sidebar.
    expect(sends("Ctrl+B", sidebar)).toBe("Sidebar");
    expect(sends("Ctrl+T", sidebar)).toBe("New Tab");
    expect(sends("Ctrl+P", sidebar)).toBe("run:palette");
    expect(sends("F5", sidebar)).toBe("Refresh");
  });

  it("leaves Ctrl+C and Ctrl+X to the browser while text is selected", () => {
    // Copying text in the Inspector preview used to copy the selected files.
    expect(sends("Ctrl+C", { selected: 1, textSelected: true })).toBeUndefined();
    expect(sends("Ctrl+X", { selected: 1, textSelected: true })).toBeUndefined();
    expect(sends("Ctrl+V", { textSelected: true })).toBe("Paste");
    expect(sends("Delete", { selected: 1, textSelected: true })).toBe("Move to Trash");
  });

  it("doesn't Open again when a widget already handled Enter", () => {
    // Miller opens the file itself and calls preventDefault.
    expect(sends("Enter", { selected: 1 }, { defaultPrevented: true })).toBeUndefined();
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
    "New Folder": "Folder",
    "Git: Commit…": "Commit…",
  };
  // Handled outside the window keymap.
  const ELSEWHERE: Record<string, string> = {
    "Select All": "FilePane's own key handler (Ctrl+A)",
    "Deselect": "FilePane's own key handler (Escape)",
  };

  const hinted: { send: string; kb: string }[] = [];
  const walk = (list: MenuItemDef[]) => {
    for (const it of list) {
      if (it.kind === "item" && it.kb) hinted.push({ send: it.action ?? it.label, kb: Array.isArray(it.kb) ? it.kb.join("+") : it.kb });
      else if (it.kind === "sub") walk(it.children);
    }
  };
  for (const tree of [...Object.values(MENUS), CONTEXT_FILE, CONTEXT_EMPTY]) walk(tree);
  for (const p of PALETTE) if (p.kb) hinted.push({ send: p.label, kb: p.kb.join("+") });
  const norm = (kb: string) => {
    const p = parseCombo(kb.replace(/\bDel\b/, "Delete").replace("↑", "ArrowUp").replace(/^Esc$/, "Escape"));
    return [p.ctrl, p.shift, p.alt, p.key].join();
  };
  const bound = (h: { send: string; kb: string }) =>
    KEYMAP.some(b => norm(b.combo) === norm(h.kb) && (
      (b.send !== undefined && (b.send === h.send || b.send === ALIAS[h.send])) ||
      (b.run !== undefined && b.run === RUN_FOR[h.send])));
  // "Ctrl+G C" in menus, ["Ctrl","G","C"] in the palette.
  const chord = (h: { send: string; kb: string }) => {
    const m = /^Ctrl\+G[ +]([A-Z])$/.exec(h.kb);
    return !!m && (GIT_CHORDS[m[1].toLowerCase()] === h.send || GIT_CHORDS[m[1].toLowerCase()] === ALIAS[h.send]);
  };

  it("covers the menus and the palette", () => {
    expect(hinted.length).toBeGreaterThan(60);
    expect(hinted).toContainEqual({ send: "Go to Path…", kb: "Ctrl+L" });
  });

  it("each advertised key runs that item's command", () => {
    expect(hinted.filter(h => !bound(h) && !chord(h) && !ELSEWHERE[h.send])).toEqual([]);
  });
});

describe("bindings for advertised keys", () => {
  it("Ctrl+Q quits, but not from a text field or the terminal", () => {
    expect(sends("Ctrl+Q")).toBe("Quit");
    expect(sends("Ctrl+Q", { inText: true })).toBeUndefined();
  });

  it("Ctrl+Shift+C copies the selection's path, and is left alone otherwise", () => {
    expect(sends("Ctrl+Shift+C", { selected: 1 })).toBe("Copy Path");
    expect(sends("Ctrl+Shift+C")).toBeUndefined();
    expect(sends("Ctrl+Shift+C", { inText: true, selected: 1 })).toBeUndefined(); // terminal copy
  });

  it("* selects by pattern, from Shift+8 or the keypad", () => {
    expect(sends("*")).toBe("Select by Pattern…");
    expect(sends("Shift+*")).toBe("Select by Pattern…");
    expect(sends("*", { inText: true })).toBeUndefined();
  });

  it("Ctrl+Shift+` opens a terminal tab, and Ctrl+` only toggles the drawer", () => {
    expect(sends("Ctrl+Shift+`")).toBe("New Terminal Tab");
    expect(sends("Ctrl+Shift+~")).toBe("New Terminal Tab"); // US layout: Shift+` is ~
    expect(sends("Ctrl+Shift+`", { inText: true })).toBe("New Terminal Tab");
    expect(sends("Ctrl+`")).toBe("run:terminal");
  });

  it("leaves Ctrl+Shift+` to the keymap alone, so one press opens one terminal tab", () => {
    // xterm lets the key through to the window, so a listener of the drawer's
    // own would add a second tab on top of the keymap's "New Terminal Tab".
    const src = readFileSync(new URL("./Terminal.tsx", import.meta.url), "utf8");
    expect(src).not.toMatch(/addEventListener\(\s*["']key(down|up|press)["']/);
    expect(src).not.toMatch(/Backquote/);
  });

  it("Ctrl+Shift+H is Find & Replace in Files; Ctrl+Shift+F stays Find in Files", () => {
    expect(sends("Ctrl+Shift+H")).toBe("Find & Replace in Files");
    expect(sends("Ctrl+Shift+H", { inText: true })).toBeUndefined();
    expect(sends("Ctrl+Shift+F")).toBe("run:findInFiles");
  });
});

describe("CHEATSHEET", () => {
  it("lists the keys no menu item advertises", () => {
    expect(CHEATSHEET.map(c => `${c.keys} ${c.label}`).sort()).toEqual([
      "/ Focus search",
      "Backspace Open parent",
      "Ctrl+Drag Copy to a folder, tab or breadcrumb",
      "Ctrl+Shift+Tab Previous Tab",
      "Ctrl+Tab Next Tab",
      "Ctrl+` Toggle terminal",
      "Drag Move to a folder, tab or breadcrumb",
      "Drag out of the window Copy into another app",
      "Enter Open selected",
      "Esc Close modal / palette",
      "Shift+Del Delete permanently",
    ]);
  });
});
