// Keyboard rules for menus, the menubar's mnemonics and the file list's
// type-ahead, as pure functions. menus.tsx and FilePane hold the state.

import type { MenuItemDef } from "./data";

/** Where a context menu opens: a mouse event, or a point the keyboard chose. */
export interface MenuAnchor {
  clientX: number;
  clientY: number;
  /** Opened with the Menu key or Shift+F10: it starts on its first item. */
  keyboard?: boolean;
}

/** The Menu key, or Shift+F10: the focused thing's context menu. */
export function isContextMenuKey(e: Pick<KeyboardEvent, "key" | "shiftKey" | "ctrlKey" | "altKey" | "metaKey">): boolean {
  if (e.key === "ContextMenu") return true;
  return e.key === "F10" && e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey;
}

// ─── menus ──────────────────────────────────────────────────────────────────

/** The highlighted index at each open level of a menu. `[2]` is item 2 of
 *  the top list, `[2, -1]` its submenu open with nothing highlighted in it,
 *  `[]` nothing highlighted. */
export type MenuPath = number[];

/** What a key can land on: commands and submenus, not separators or headings. */
export function isActionable(it: MenuItemDef | undefined): boolean {
  return !!it && (it.kind === "item" || it.kind === "sub");
}

/** The next index a key can land on after `from`, going `dir` and wrapping;
 *  -1 when there is none. From -1 it starts at the first (or the last). */
export function step(items: MenuItemDef[], from: number, dir: 1 | -1): number {
  const n = items.length;
  let i = from < 0 ? (dir === 1 ? -1 : n) : from;
  for (let k = 0; k < n; k++) {
    i = (i + dir + n) % n;
    if (isActionable(items[i])) return i;
  }
  return -1;
}

export const firstIndex = (items: MenuItemDef[]): number => step(items, -1, 1);
export const lastIndex = (items: MenuItemDef[]): number => step(items, -1, -1);

/** The list shown at `level` of `path`: the top items, or the children of
 *  the submenu opened above it. */
export function listAt(items: MenuItemDef[], path: MenuPath, level: number): MenuItemDef[] | null {
  let list = items;
  for (let l = 0; l < level; l++) {
    const it = list[path[l]];
    if (!it || it.kind !== "sub") return null;
    list = it.children;
  }
  return list;
}

/** `path` cut back to what `items` still has (the menu changed under it,
 *  for instance when its dynamic entries arrived). */
export function fitPath(items: MenuItemDef[], path: MenuPath): MenuPath {
  const out: MenuPath = [];
  let list = items;
  for (let l = 0; l < path.length; l++) {
    const i = path[l];
    const it = list[i];
    if (i === -1 && l > 0 && l === path.length - 1) { out.push(-1); break; }
    if (!isActionable(it)) break;
    out.push(i);
    if (it.kind !== "sub") break;
    list = it.children;
  }
  return out;
}

const labelOf = (it: MenuItemDef | undefined): string =>
  it && (it.kind === "item" || it.kind === "sub") ? it.label : "";

const COLLATOR = new Intl.Collator(undefined, { sensitivity: "base", usage: "search" });

/** `name` starts with `prefix`, ignoring case and accents. */
export function startsLoosely(name: string, prefix: string): boolean {
  const n = name.normalize("NFC");
  const p = prefix.normalize("NFC");
  return n.length >= p.length && COLLATOR.compare(n.slice(0, p.length), p) === 0;
}

/** The next item after `from` (wrapping) whose label starts with `ch`. A
 *  branch's "* " mark doesn't count. -1 when none does. */
export function nextByLetter(items: MenuItemDef[], from: number, ch: string): number {
  const n = items.length;
  for (let k = 1; k <= n; k++) {
    const i = (((from + k) % n) + n) % n;
    if (isActionable(items[i]) && startsLoosely(labelOf(items[i]).replace(/^[\s*]+/, ""), ch)) return i;
  }
  return -1;
}

export type MenuKeyResult =
  | { path: MenuPath }
  | { run: Extract<MenuItemDef, { kind: "item" }> }
  /** Leave the menu: ← at the top (`prev`), → on a command (`next`), Esc at
   *  the top (`close`). The menubar moves to a neighbouring menu. */
  | { exit: "prev" | "next" | "close" };

export type MenuKeyEvent = Pick<KeyboardEvent, "key" | "ctrlKey" | "altKey" | "metaKey">;

/** What `e` does in a menu showing `items` with `path` highlighted; null
 *  when it isn't a menu key. */
export function menuKey(items: MenuItemDef[], path: MenuPath, e: MenuKeyEvent): MenuKeyResult | null {
  // A submenu the pointer opened has nothing highlighted: until → or Enter
  // goes into it, keys move in the menu it hangs from (← and Esc close it).
  if (path.length > 1 && path[path.length - 1] === -1 && e.key !== "ArrowLeft" && e.key !== "Escape") {
    path = path.slice(0, -1);
  }
  const level = Math.max(path.length - 1, 0);
  const list = listAt(items, path, level) ?? items;
  const cur = path[level] ?? -1;
  const item = cur >= 0 ? list[cur] : undefined;
  const at = (i: number): MenuKeyResult => ({ path: i < 0 ? path : [...path.slice(0, level), i] });
  const openSub = (sub: Extract<MenuItemDef, { kind: "sub" }>): MenuKeyResult => {
    const first = firstIndex(sub.children);
    return { path: first < 0 ? path : [...path.slice(0, level), cur, first] };
  };
  switch (e.key) {
    case "ArrowDown": return at(step(list, cur, 1));
    case "ArrowUp": return at(step(list, cur, -1));
    case "Home": return at(firstIndex(list));
    case "End": return at(lastIndex(list));
    case "ArrowRight":
      return item?.kind === "sub" ? openSub(item) : { exit: "next" };
    case "ArrowLeft":
      return level > 0 ? { path: path.slice(0, level) } : { exit: "prev" };
    case "Escape":
      return level > 0 ? { path: path.slice(0, level) } : { exit: "close" };
    case "Enter":
    case " ":
      if (item?.kind === "sub") return openSub(item);
      if (item?.kind === "item") return { run: item };
      return { path };
  }
  if ([...e.key].length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) return at(nextByLetter(list, cur, e.key));
  return null;
}

/** Each menubar title's underlined letter, as an index into the title: its
 *  first letter no earlier title has taken (File F … Go G, Git i). -1 when
 *  every letter is taken. */
export function mnemonics(titles: string[]): number[] {
  const taken = new Set<string>();
  return titles.map(t => {
    for (let i = 0; i < t.length; i++) {
      const c = t[i].toLowerCase();
      if (/\p{L}/u.test(c) && !taken.has(c)) { taken.add(c); return i; }
    }
    return -1;
  });
}

/** The title whose mnemonic `e` types, if any. With Alt held a key reports
 *  its unshifted letter, or on another layout only its code (KeyF). */
export function titleForKey(titles: string[], marks: number[], e: Pick<KeyboardEvent, "key" | "code">): string | undefined {
  const fromCode = /^Key([A-Z])$/.exec(e.code ?? "")?.[1];
  const want = [e.key.toLowerCase(), fromCode?.toLowerCase()];
  return titles.find((t, i) => marks[i] >= 0 && want.includes(t[marks[i]].toLowerCase()));
}

// ─── type-ahead ─────────────────────────────────────────────────────────────

/** How long the file list waits for the next letter of a typed name. */
export const TYPE_AHEAD_MS = 1000;

/** The letters typed so far: keys less than TYPE_AHEAD_MS apart add up. */
export class TypeAhead {
  private typed = "";
  private at = 0;
  constructor(private readonly ms = TYPE_AHEAD_MS) {}

  /** A name is being typed. */
  active(now: number): boolean {
    return this.typed !== "" && now - this.at < this.ms;
  }

  /** Adds `ch` and returns everything typed. */
  push(ch: string, now: number): string {
    if (!this.active(now)) this.typed = "";
    this.typed += ch;
    this.at = now;
    return this.typed;
  }
}

/** Where type-ahead goes in `names` from position `from`: the first name
 *  from there that starts with `typed`. One letter, or one letter typed
 *  again and again, moves past `from` to the next name with that letter,
 *  so repeating it cycles through them. -1 when nothing matches. */
export function typeAheadMatch(names: string[], from: number, typed: string): number {
  const n = names.length;
  const chars = [...typed];
  if (n === 0 || chars.length === 0) return -1;
  const repeat = chars.every(c => c === chars[0]);
  const prefix = repeat ? chars[0] : typed;
  const start = repeat ? from + 1 : Math.max(from, 0);
  for (let k = 0; k < n; k++) {
    const i = (((start + k) % n) + n) % n;
    if (startsLoosely(names[i], prefix)) return i;
  }
  return -1;
}
