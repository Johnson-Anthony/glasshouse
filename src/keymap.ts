// Window-level keyboard shortcuts, as data. App's keydown listener asks
// findBinding() for the first binding an event matches, calls preventDefault
// and either dispatches its command label (`send`) or runs one of the few
// App-local actions that aren't commands (`run`). Stateful or DOM-bound keys
// stay in App: the second key of a Ctrl+G git chord, Tab/F6 pane cycling,
// and Escape (which closes overlays without consuming the key).
//
// Matching: modifiers named in `combo` must be down, the others must be up
// unless listed in `any`. "Ctrl" means Ctrl or ⌘. Keys compare
// case-insensitively; `alsoKeys` are other e.key values for the same binding.
// Order matters: the first match wins.

export type KeyAction =
  | "palette" | "findInFiles" | "terminal" | "tweaks" | "cheatsheet"
  | "focusSearch" | "gitChord" | "quickLook";

type Mod = "Ctrl" | "Shift" | "Alt";

export interface KeyBinding {
  combo: string;
  alsoKeys?: string[];
  /** Modifiers whose state doesn't matter. */
  any?: Mod[];
  /** Also fires while a text field has focus. */
  inText?: boolean;
  /** Needs a selection in the active tab (`multi`: more than one item). */
  when?: "selection" | "multi";
  /** Skip the event if a focused widget already handled it. */
  unlessHandled?: boolean;
  send?: string;
  run?: KeyAction;
  /** Listed in the Keybindings cheatsheet (menu items list their own keys). */
  cheat?: { label: string; group: string; keys?: string };
}

export const KEYMAP: KeyBinding[] = [
  { combo: "Ctrl+Tab", any: ["Alt"], inText: true, send: "Next Tab", cheat: { label: "Next Tab", group: "Navigate" } },
  { combo: "Ctrl+Shift+Tab", any: ["Alt"], inText: true, send: "Prev Tab", cheat: { label: "Previous Tab", group: "Navigate" } },
  { combo: "Ctrl+P", any: ["Alt"], inText: true, run: "palette" },
  { combo: "Ctrl+Shift+F", any: ["Alt"], inText: true, run: "findInFiles" },
  { combo: "Ctrl+Shift+G", any: ["Alt"], inText: true, send: "Connect to Server…" },
  { combo: "Ctrl+Shift+V", any: ["Alt"], send: "Paste Special…" },
  // Menu-advertised Ctrl+Shift bindings.
  { combo: "Ctrl+Shift+N", inText: true, send: "New Private Session" },
  { combo: "Ctrl+Shift+P", inText: true, send: "Batch Permissions…" },
  { combo: "Ctrl+Shift+E", send: "Open in VS Code" },
  { combo: "Ctrl+Shift+R", send: "Bulk Rename…" },
  { combo: "Ctrl+Shift+D", send: "Folder" },
  { combo: "Ctrl+`", any: ["Alt"], inText: true, run: "terminal", cheat: { label: "Toggle terminal", group: "View" } },
  // Shift+` is ~ on US layouts.
  { combo: "Ctrl+Shift+`", alsoKeys: ["~"], any: ["Alt"], inText: true, send: "New Terminal Tab" },
  { combo: "Ctrl+,", any: ["Shift", "Alt"], inText: true, run: "tweaks" },
  // Panel/layout toggles work even while a text input has focus: they don't
  // insert text (VS Code treats Ctrl+B the same way).
  { combo: "Ctrl+B", inText: true, send: "Sidebar" },
  { combo: "Ctrl+J", inText: true, send: "Inspector" },
  { combo: "Ctrl+L", inText: true, send: "Go to Path…" },
  { combo: "Ctrl+[", inText: true, send: "Previous Location" },
  { combo: "Ctrl+]", inText: true, send: "Next Location" },
  { combo: "Ctrl+1", inText: true, send: "Details (rows)" },
  { combo: "Ctrl+2", inText: true, send: "Compact List" },
  { combo: "Ctrl+3", inText: true, send: "Icons" },
  { combo: "Ctrl+4", inText: true, send: "Tiles" },
  { combo: "Ctrl+5", inText: true, send: "Grid (thumbs)" },
  { combo: "Ctrl+6", inText: true, send: "Tree Flat" },
  { combo: "Ctrl+7", inText: true, send: "Miller Columns (ranger)" },
  { combo: "/", any: ["Shift"], run: "focusSearch", cheat: { label: "Focus search", group: "Navigate" } },

  // Everything below is file and selection work, so none of it fires while
  // typing in a field.
  { combo: "Ctrl+G", run: "gitChord" },
  // Not while typing: the terminal drawer has focus as a text field, and
  // Ctrl+Q there is the shell's (XON, emacs quoted-insert).
  { combo: "Ctrl+Q", send: "Quit" },
  { combo: "Space", when: "selection", unlessHandled: true, run: "quickLook" },
  { combo: "Ctrl+Z", send: "Undo" },
  { combo: "Ctrl+Y", send: "Redo" },
  { combo: "Ctrl+Shift+Z", send: "Redo" },
  // Copy/Cut only with a selection, so the browser keeps plain text copy.
  { combo: "Ctrl+C", when: "selection", send: "Copy" },
  { combo: "Ctrl+X", when: "selection", send: "Cut" },
  { combo: "Ctrl+V", send: "Paste" },
  { combo: "Ctrl+Shift+C", when: "selection", send: "Copy Path" },
  { combo: "Ctrl+Shift+H", send: "Find & Replace in Files" },
  // Shift+8 on many layouts, or the keypad *.
  { combo: "*", any: ["Shift"], send: "Select by Pattern…" },
  { combo: "Ctrl+H", send: "Toggle Hidden Files" },
  { combo: "Ctrl+W", send: "Close Tab" },
  { combo: "Ctrl+T", send: "New Tab" },
  { combo: "Ctrl+=", alsoKeys: ["+"], send: "Zoom In" },
  { combo: "Ctrl+-", alsoKeys: ["_"], send: "Zoom Out" },
  { combo: "Ctrl+0", send: "Reset Zoom" },
  { combo: "Ctrl+O", send: "Open…" },
  { combo: "Ctrl+N", send: "New Window" },
  { combo: "Ctrl+I", send: "Invert Selection" },
  { combo: "Ctrl+U", send: "Duplicate" },
  { combo: "Ctrl+D", send: "Bookmark This Folder" },
  { combo: "Ctrl+Home", send: "Home" },
  { combo: "Alt+ArrowLeft", send: "Back" },
  { combo: "Alt+ArrowRight", send: "Forward" },
  { combo: "Alt+ArrowUp", send: "Open Parent" },
  { combo: "Alt+Enter", send: "Properties" },
  { combo: "F5", any: ["Ctrl", "Shift", "Alt"], send: "Refresh" },
  { combo: "F11", any: ["Ctrl", "Shift", "Alt"], send: "Full Screen" },
  { combo: "F3", any: ["Ctrl", "Shift", "Alt"], send: "Tree + Pane + Inspector" },
  { combo: "F7", any: ["Ctrl", "Shift", "Alt"], send: "Single Pane" },
  { combo: "F2", any: ["Ctrl", "Shift", "Alt"], when: "multi", send: "Bulk Rename…" },
  { combo: "F2", any: ["Ctrl", "Shift", "Alt"], send: "Rename" },
  { combo: "F1", any: ["Ctrl", "Shift", "Alt"], run: "cheatsheet" },
  { combo: "Ctrl+?", any: ["Shift", "Alt"], run: "cheatsheet" },
  // F6 cycles panes (in App), so Move to… has no key.
  { combo: "Shift+Delete", any: ["Ctrl", "Alt"], send: "Delete Permanently", cheat: { label: "Delete permanently", group: "Edit", keys: "Shift+Del" } },
  { combo: "Delete", any: ["Ctrl", "Alt"], send: "Move to Trash" },
  { combo: "Backspace", any: ["Shift"], send: "Up", cheat: { label: "Open parent", group: "Navigate" } },
  { combo: "Enter", when: "selection", send: "Open", cheat: { label: "Open selected", group: "File" } },
];

/** Keys App handles in code rather than through KEYMAP, for the cheatsheet. */
const CODE_CHEATS: CheatEntry[] = [
  { label: "Close modal / palette", keys: "Esc", group: "View" },
];

export interface CheatEntry { label: string; keys: string; group: string }

/** The cheatsheet's entries for keys no menu item advertises. */
export const CHEATSHEET: CheatEntry[] = [
  ...KEYMAP.filter(b => b.cheat).map(b => ({ label: b.cheat!.label, keys: b.cheat!.keys ?? b.combo, group: b.cheat!.group })),
  ...CODE_CHEATS,
];

export interface ParsedCombo { ctrl: boolean; shift: boolean; alt: boolean; key: string }

/** "Ctrl+Shift+R" → modifiers plus the lowercased key ("Space" → " "). */
export function parseCombo(combo: string): ParsedCombo {
  const parts = combo.split("+");
  // A trailing "+" key ("Ctrl++") splits into an empty last part.
  let key = parts.pop()!;
  if (key === "" && parts[parts.length - 1] === "") { parts.pop(); key = "+"; }
  const mods = new Set(parts);
  return {
    ctrl: mods.has("Ctrl"),
    shift: mods.has("Shift"),
    alt: mods.has("Alt"),
    key: key === "Space" ? " " : key.toLowerCase(),
  };
}

export type KeyEventLike = Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "shiftKey" | "altKey" | "defaultPrevented">;

const PARSED = new Map<KeyBinding, ParsedCombo>();
const parsed = (b: KeyBinding): ParsedCombo => {
  let p = PARSED.get(b);
  if (!p) { p = parseCombo(b.combo); PARSED.set(b, p); }
  return p;
};

export function matches(b: KeyBinding, e: KeyEventLike): boolean {
  const p = parsed(b);
  const key = e.key.toLowerCase();
  if (key !== p.key && !b.alsoKeys?.some(k => k.toLowerCase() === key)) return false;
  const any = new Set(b.any ?? []);
  const ok = (mod: Mod, want: boolean, down: boolean) => any.has(mod) || want === down;
  return ok("Ctrl", p.ctrl, e.ctrlKey || e.metaKey) && ok("Shift", p.shift, e.shiftKey) && ok("Alt", p.alt, e.altKey);
}

/** The binding `e` triggers, if any. `selected` is the active tab's selection size. */
export function findBinding(e: KeyEventLike, state: { inText: boolean; selected: number }): KeyBinding | undefined {
  for (const b of KEYMAP) {
    if (state.inText && !b.inText) continue;
    if (!matches(b, e)) continue;
    if (b.unlessHandled && e.defaultPrevented) continue;
    if (b.when === "selection" && state.selected < 1) continue;
    if (b.when === "multi" && state.selected < 2) continue;
    return b;
  }
  return undefined;
}
