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
// Order matters: the first match wins. Nothing matches while a modal dialog
// is open: the dialog owns the keyboard.

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
  /** Acts on the file pane's selection or folder, so it doesn't fire while
   *  the sidebar (which has its own row cursor) has focus. */
  pane?: boolean;
  /** Leave the key to the browser while text is selected on the page. */
  unlessText?: boolean;
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
  { combo: "Ctrl+Shift+V", any: ["Alt"], pane: true, send: "Paste Special…" },
  // Menu-advertised Ctrl+Shift bindings.
  { combo: "Ctrl+Shift+N", inText: true, send: "New Private Session" },
  { combo: "Ctrl+Shift+P", inText: true, pane: true, send: "Batch Permissions…" },
  { combo: "Ctrl+Shift+E", pane: true, send: "Open in VS Code" },
  { combo: "Ctrl+Shift+R", pane: true, send: "Bulk Rename…" },
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
  { combo: "Space", when: "selection", unlessHandled: true, pane: true, run: "quickLook" },
  { combo: "Ctrl+Z", send: "Undo" },
  { combo: "Ctrl+Y", send: "Redo" },
  { combo: "Ctrl+Shift+Z", send: "Redo" },
  // Copy/Cut only with a selection and no selected text, so the browser
  // keeps plain text copy (the Inspector preview, Properties, Blame).
  { combo: "Ctrl+C", when: "selection", unlessText: true, pane: true, send: "Copy" },
  { combo: "Ctrl+X", when: "selection", unlessText: true, pane: true, send: "Cut" },
  { combo: "Ctrl+V", pane: true, send: "Paste" },
  { combo: "Ctrl+Shift+C", when: "selection", pane: true, send: "Copy Path" },
  { combo: "Ctrl+Shift+H", send: "Find & Replace in Files" },
  // Shift+8 on many layouts, or the keypad *.
  { combo: "*", any: ["Shift"], pane: true, send: "Select by Pattern…" },
  { combo: "Ctrl+H", send: "Toggle Hidden Files" },
  { combo: "Ctrl+W", send: "Close Tab" },
  { combo: "Ctrl+T", send: "New Tab" },
  { combo: "Ctrl+=", alsoKeys: ["+"], send: "Zoom In" },
  { combo: "Ctrl+-", alsoKeys: ["_"], send: "Zoom Out" },
  { combo: "Ctrl+0", send: "Reset Zoom" },
  { combo: "Ctrl+O", send: "Open…" },
  { combo: "Ctrl+N", send: "New Window" },
  { combo: "Ctrl+I", pane: true, send: "Invert Selection" },
  { combo: "Ctrl+U", pane: true, send: "Duplicate" },
  { combo: "Ctrl+D", send: "Bookmark This Folder" },
  { combo: "Ctrl+Home", send: "Home" },
  { combo: "Alt+ArrowLeft", send: "Back" },
  { combo: "Alt+ArrowRight", send: "Forward" },
  { combo: "Alt+ArrowUp", send: "Open Parent" },
  { combo: "Alt+Enter", pane: true, send: "Properties" },
  { combo: "F5", any: ["Ctrl", "Shift", "Alt"], send: "Refresh" },
  { combo: "F11", any: ["Ctrl", "Shift", "Alt"], send: "Full Screen" },
  { combo: "F3", any: ["Ctrl", "Shift", "Alt"], send: "Tree + Pane + Inspector" },
  { combo: "F7", any: ["Ctrl", "Shift", "Alt"], send: "Single Pane" },
  { combo: "F2", any: ["Ctrl", "Shift", "Alt"], when: "multi", pane: true, send: "Bulk Rename…" },
  { combo: "F2", any: ["Ctrl", "Shift", "Alt"], pane: true, send: "Rename" },
  { combo: "F1", any: ["Ctrl", "Shift", "Alt"], run: "cheatsheet" },
  { combo: "Ctrl+?", any: ["Shift", "Alt"], run: "cheatsheet" },
  // F6 cycles panes (in App), so Move to… has no key.
  { combo: "Shift+Delete", any: ["Ctrl", "Alt"], pane: true, send: "Delete Permanently", cheat: { label: "Delete permanently", group: "Edit", keys: "Shift+Del" } },
  { combo: "Delete", any: ["Ctrl", "Alt"], pane: true, send: "Move to Trash" },
  { combo: "Backspace", any: ["Shift"], send: "Up", cheat: { label: "Open parent", group: "Navigate" } },
  // unlessHandled: Miller and the dialogs handle Enter themselves.
  { combo: "Enter", when: "selection", unlessHandled: true, pane: true, send: "Open", cheat: { label: "Open selected", group: "File" } },
];

/** Keys App handles in code rather than through KEYMAP, for the cheatsheet. */
const CODE_CHEATS: CheatEntry[] = [
  { label: "Close modal / palette", keys: "Esc", group: "View" },
  // Drag and drop (FilePane, dragDrop.ts): the keys held at the drop.
  { label: "Move to a folder, tab or breadcrumb", keys: "Drag", group: "Edit" },
  { label: "Copy to a folder, tab or breadcrumb", keys: "Ctrl+Drag", group: "Edit" },
  { label: "Copy into another app", keys: "Drag out of the window", group: "Edit" },
  // Menus (menus.tsx) and the file list's own keys (FilePane).
  { label: "Open the menu bar", keys: "Alt or F10", group: "Menus" },
  { label: "Open a menu by its underlined letter", keys: "Alt+letter", group: "Menus" },
  { label: "Context menu of the selection", keys: "Menu or Shift+F10", group: "Menus" },
  { label: "Move in a menu; into and out of submenus", keys: "↑ ↓ → ←", group: "Menus" },
  { label: "Run the highlighted menu item", keys: "Enter", group: "Menus" },
  { label: "Close a menu", keys: "Esc", group: "Menus" },
  { label: "Jump to a file by name", keys: "Type its first letters", group: "Navigate" },
];

export interface CheatEntry { label: string; keys: string; group: string }

/** The cheatsheet's entries for keys no menu item advertises. */
export const CHEATSHEET: CheatEntry[] = [
  ...KEYMAP.filter(b => b.cheat).map(b => ({ label: b.cheat!.label, keys: b.cheat!.keys ?? b.combo, group: b.cheat!.group })),
  ...CODE_CHEATS,
];

/** How long Ctrl+G waits for its second key. */
export const GIT_CHORD_MS = 1500;

/** The Ctrl+G git chord: when its first key was pressed, 0 when none is
 *  pending. App's listener starts and takes it; the file pane, whose key
 *  handler runs first, leaves the second key to it. */
export const gitChord = { at: 0 };

export function chordPending(now = Date.now()): boolean {
  return gitChord.at > 0 && now - gitChord.at < GIT_CHORD_MS;
}

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

export interface KeyState {
  /** Focus is in a text field. */
  inText: boolean;
  /** The active tab's selection size. */
  selected: number;
  /** A modal dialog is open. */
  modal?: boolean;
  /** The event's target is inside the sidebar. */
  sidebar?: boolean;
  /** The page has a text selection. */
  textSelected?: boolean;
}

/** The binding `e` triggers, if any. */
export function findBinding(e: KeyEventLike, state: KeyState): KeyBinding | undefined {
  if (state.modal) return undefined;
  for (const b of KEYMAP) {
    if (state.inText && !b.inText) continue;
    if (!matches(b, e)) continue;
    if (b.unlessHandled && e.defaultPrevented) continue;
    if (b.pane && state.sidebar) continue;
    if (b.unlessText && state.textSelected) continue;
    if (b.when === "selection" && state.selected < 1) continue;
    if (b.when === "multi" && state.selected < 2) continue;
    return b;
  }
  return undefined;
}

/** Printable keys a binding takes without Ctrl or Alt (/, *, Space): the
 *  file list's type-ahead leaves them to the keymap. */
export const BOUND_CHARS: ReadonlySet<string> = new Set(
  KEYMAP.flatMap(b => {
    const p = parseCombo(b.combo);
    if (p.ctrl || p.alt) return [];
    return [p.key, ...(b.alsoKeys ?? []).map(k => k.toLowerCase())].filter(k => [...k].length === 1);
  }),
);
