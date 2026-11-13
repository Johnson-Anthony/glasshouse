// The command palette's rows: every command the menus hold that makes sense
// without a right-clicked row, once each, with where it lives and its
// shortcut. A row sends what a click on its menu item sends (`action ??
// label`) to handleMenuCommand, so routing, the lossy-name guard
// (MUTATING_LABELS) and `pnpm check:wiring` treat it like that click.
import { CONTEXT_EMPTY, CONTEXT_FILE, MENUS, PALETTE_ONLY, type MenuItemDef } from "./data";
import { fuzzyMatch } from "./fuzzy";
import { looksLikePath } from "./paths";

/** One name a command goes by: a menu item's label and the menus above it. */
export interface PaletteName {
  label: string;
  /** The menu, then any submenus: ["File", "New"]. Empty for PALETTE_ONLY. */
  where: string[];
}

export interface PaletteEntry {
  /** The label handleMenuCommand gets. */
  send: string;
  /** Every item that runs this command, in menu order, one per label. */
  names: PaletteName[];
  /** Its section in the unfiltered list. */
  group: string;
  kb?: string;
  ic?: string;
  danger?: boolean;
}

interface Source {
  group: string;
  /** What rows from this tree show as their menu. */
  menu?: string;
  items: MenuItemDef[];
}

/** The trees the palette reads. The sidebar, tab, breadcrumb and remote
 *  menus are left out: every item on them acts on the row that was
 *  right-clicked (cmdState.contextTarget), and from the palette there is
 *  none. The file and empty-area menus act on the active tab's selection
 *  and folder, as the menubar does. */
export const PALETTE_SOURCES: readonly Source[] = [
  ...Object.entries(MENUS).map(([menu, items]) => ({ group: menu, menu, items })),
  { group: "Selected items", menu: "Selected items", items: CONTEXT_FILE },
  { group: "This folder", menu: "This folder", items: CONTEXT_EMPTY },
  { group: "More", items: PALETTE_ONLY },
];

/** Labels that run the same command as another label, so the palette shows
 *  one row for both. Each key folds into its value. Most pairs share a
 *  `case` in src/handlers/ (palette.test.ts checks that every such pair on
 *  the palette is here); the rest run the same code from separate cases. */
export const SAME_COMMAND: Readonly<Record<string, string>> = {
  // One case.
  "Type": "Type / Extension",
  "Bookmark Folder": "Bookmark This Folder",
  "Copy as WSL Path": "Copy Path (WSL)",
  "Paste as Symlink": "Paste as Link (symlink)",
  "Checksum SHA256": "Checksum (SHA256)",
  "ZIP (bundled)": "Zip (.zip)",
  "TAR.GZ": "Tar + gzip (.tar.gz)",
  "7-Zip": "7-zip (.7z)",
  "Text Editor (.txt)": "Default App",
  "Open in New Window": "New Window",
  // Separate cases: Open With's two dispatch the File menu's command, and
  // the file menu's git items call what the Git menu's do.
  "VS Code": "Open in VS Code",
  "Terminal": "Open in Terminal",
  "Git: Stage": "Stage Selected",
  "Git: Unstage": "Unstage Selected",
  "Git: Discard changes": "Discard Changes",
  "Git: Blame": "Blame Selected",
};

/** Menu items that make no sense from the palette. */
const LEFT_OUT = new Set(["Command Palette"]);

const subName = (label: string) => label.replace(/\s*→$/, "");

export function buildPalette(sources: readonly Source[]): PaletteEntry[] {
  const out: PaletteEntry[] = [];
  const byCommand = new Map<string, PaletteEntry>();
  const walk = (items: MenuItemDef[], group: string, where: string[], ic: string | undefined) => {
    for (const it of items) {
      if (it.kind === "sub") {
        walk(it.children, group, [...where, subName(it.label)], it.ic || ic);
        continue;
      }
      // Separators, group labels and dynamic lists (recents, pins, branches,
      // terminal profiles) have no command to run.
      if (it.kind !== "item" || it.payload) continue;
      const send = it.action ?? it.label;
      if (LEFT_OUT.has(send)) continue;
      const command = SAME_COMMAND[send] ?? send;
      let entry = byCommand.get(command);
      if (!entry) {
        entry = { send, names: [], group, danger: it.danger };
        byCommand.set(command, entry);
        out.push(entry);
      }
      if (!entry.names.some(n => n.label === it.label)) entry.names.push({ label: it.label, where });
      entry.kb ??= it.kb;
      entry.ic ||= it.ic || ic;
    }
  };
  for (const s of sources) walk(s.items, s.group, s.menu ? [s.menu] : [], undefined);
  return out;
}

export const PALETTE_ENTRIES: readonly PaletteEntry[] = buildPalette(PALETTE_SOURCES);

/** A row as the palette shows it: an entry under the name that matched. */
export interface PaletteRow {
  send: string;
  label: string;
  where: string[];
  group: string;
  kb?: string;
  ic?: string;
  danger?: boolean;
}

const words = (s: string) => s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/** fuzzyMatch takes the first place each letter fits, so on its own "theme"
 *  ranks Git › Branches › Merge… above Switch Theme. Each query word that
 *  starts a word of the text makes up for that. */
const WORD_BONUS = 40;

function scoreText(q: string, qWords: string[], text: string): number | null {
  const score = fuzzyMatch(q, text);
  if (score === null) return null;
  const tw = words(text);
  return score + WORD_BONUS * qWords.filter(w => tw.some(t => t.startsWith(w))).length;
}

const asRow = (e: PaletteEntry, name: PaletteName): PaletteRow =>
  ({ send: e.send, label: name.label, where: name.where, group: e.group, kb: e.kb, ic: e.ic, danger: e.danger });

/** The rows for `query`, best match first (then shorter names, then menu
 *  order); every entry, in menu order, for an empty one. A name matches on
 *  its own or after its menus ("new folder" finds File › New › Folder). A
 *  query that looks like a path comes first as "Go to <path>", which sends
 *  the path: navHandler opens path-like labels. */
export function searchPalette(query: string, entries: readonly PaletteEntry[] = PALETTE_ENTRIES): PaletteRow[] {
  const q = query.trim();
  if (!q) return entries.map(e => asRow(e, e.names[0]));
  const qWords = words(q);
  const scored: Array<{ score: number; i: number; row: PaletteRow }> = [];
  entries.forEach((e, i) => {
    let best: { score: number; name: PaletteName } | null = null;
    for (const name of e.names) {
      for (const text of [name.label, [...name.where, name.label].join(" ")]) {
        const score = scoreText(q, qWords, text);
        if (score !== null && (!best || score > best.score)) best = { score, name };
      }
    }
    if (best) scored.push({ score: best.score, i, row: asRow(e, best.name) });
  });
  scored.sort((a, b) => b.score - a.score || a.row.label.length - b.row.label.length || a.i - b.i);
  const rows = scored.map(s => s.row);
  if (looksLikePath(q)) rows.unshift({ send: q, label: `Go to ${q}`, where: [], group: "" });
  return rows;
}

/** "Ctrl+Shift+D" → ["Ctrl", "Shift", "D"]; "Ctrl+G S" → ["Ctrl", "G", "S"]. */
export function kbKeys(kb: string): string[] {
  return kb.split(/\+(?=.)|\s+/);
}
