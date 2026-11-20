// Custom themes: made in Preferences' theme editor or imported from a small
// JSON file, kept in localStorage["glasshouse.themes.v1"] and applied as
// [data-theme="user-…"] blocks in one <style> element. Only hex colors and
// the known tokens are accepted, so nothing else from a file reaches CSS.
// docs/decisions/2026-11-20-themes-custom-format.md

import { useSyncExternalStore } from "react";
import { contrast, isDark, isHexColor, normalizeHex, textOn } from "./contrast";
import { CONTRAST_CHECKS, THEME_TOKENS, builtinTheme, type ThemeScheme, type ThemeToken } from "./themes";

export interface UserTheme {
  /** "user-" and a slug. */
  id: string;
  name: string;
  scheme: ThemeScheme;
  colors: Record<ThemeToken, string>;
}

const KEY = "glasshouse.themes.v1";
/** The id the editor's unsaved draft is shown under. */
export const DRAFT_ID = "user-draft";
const ID = /^user-[a-z0-9-]{1,48}$/;
export const MAX_THEMES = 50;
/** A theme file is a few hundred bytes; anything far bigger isn't one. */
export const MAX_FILE_BYTES = 64 * 1024;
export const FILE_FORMAT = "glasshouse-theme";

interface Store {
  themes: readonly UserTheme[];
  /** The editor's draft, shown as DRAFT_ID while it's open. */
  draft: UserTheme | null;
}

let store: Store = { themes: [], draft: null };
let loaded = false;
const listeners = new Set<() => void>();

function emit(next: Store) {
  store = next;
  for (const l of listeners) l();
}

function ensureLoaded() {
  if (loaded) return;
  loaded = true;
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "null") as { themes?: unknown } | null;
    const list = Array.isArray(raw?.themes) ? raw!.themes : [];
    const themes: UserTheme[] = [];
    for (const t of list.slice(0, MAX_THEMES)) {
      const v = checkTheme(t);
      if ("theme" in v && ID.test((t as UserTheme).id) && !themes.some(x => x.id === (t as UserTheme).id)) {
        themes.push({ ...v.theme, id: (t as UserTheme).id });
      }
    }
    store = { ...store, themes };
  } catch { /* none saved, or unreadable: start empty */ }
}

function persist(themes: readonly UserTheme[]) {
  try { localStorage.setItem(KEY, JSON.stringify({ themes })); } catch { /* full or blocked */ }
}

export function getUserThemes(): readonly UserTheme[] {
  ensureLoaded();
  return store.themes;
}

export function getDraft(): UserTheme | null {
  return store.draft;
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => { listeners.delete(l); };
}
const snapshot = () => { ensureLoaded(); return store; };

/** The saved themes and the editor's draft, re-rendering on change. */
export function useUserThemes(): Store {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/** A new id for `name`, unlike the ones taken. */
export function newThemeId(name: string, taken: readonly string[] = getUserThemes().map(t => t.id)): string {
  const slug = name.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "theme";
  let id = `user-${slug}`;
  for (let i = 2; taken.includes(id) || id === DRAFT_ID; i++) id = `user-${slug}-${i}`;
  return id;
}

/** Saves a new theme or replaces the one with its id. */
export function saveUserTheme(t: UserTheme): void {
  ensureLoaded();
  const i = store.themes.findIndex(x => x.id === t.id);
  if (i < 0 && store.themes.length >= MAX_THEMES) throw new Error(`at most ${MAX_THEMES} custom themes`);
  const themes = i < 0 ? [...store.themes, t] : store.themes.map(x => (x.id === t.id ? t : x));
  persist(themes);
  emit({ ...store, themes });
}

export function deleteUserTheme(id: string): void {
  ensureLoaded();
  const themes = store.themes.filter(t => t.id !== id);
  persist(themes);
  emit({ ...store, themes });
}

export function setDraft(t: UserTheme | null): void {
  emit({ ...store, draft: t && { ...t, id: DRAFT_ID } });
}

/** For tests. */
export function resetUserThemesForTest(): void {
  loaded = false;
  store = { themes: [], draft: null };
  listeners.forEach(l => l());
}

// ---- CSS ----
export function themeCss(t: UserTheme): string {
  const lines = THEME_TOKENS.map(k => `  --${k}: ${normalizeHex(t.colors[k]) ?? "#000000"};`);
  return `[data-theme="${t.id}"] {\n  color-scheme: ${t.scheme === "light" ? "light" : "dark"};\n${lines.join("\n")}\n}\n`;
}

/** Keeps a <style> with every custom theme (and the draft) in the page.
 *  Returns the cleanup. */
export function installUserThemeStyles(doc: Document = document): () => void {
  const el = doc.createElement("style");
  el.id = "glasshouse-user-themes";
  doc.head.appendChild(el);
  const write = () => {
    const s = snapshot();
    const css = [...s.themes, ...(s.draft ? [s.draft] : [])].filter(t => ID.test(t.id)).map(themeCss).join("\n");
    if (el.textContent !== css) el.textContent = css;
  };
  write();
  const off = subscribe(write);
  return () => { off(); el.remove(); };
}

// ---- reading a theme's colors ----
/** A built-in theme's colors, as the page computes them. */
export function readThemeColors(id: string, doc: Document = document): Record<ThemeToken, string> {
  const probe = doc.createElement("div");
  probe.setAttribute("data-theme", id);
  probe.style.display = "none";
  doc.body.appendChild(probe);
  const cs = getComputedStyle(probe);
  const out = {} as Record<ThemeToken, string>;
  for (const k of THEME_TOKENS) out[k] = normalizeHex(cs.getPropertyValue(`--${k}`).trim()) ?? "#000000";
  probe.remove();
  return out;
}

// ---- files ----
export interface ThemeFile {
  [FILE_FORMAT]: 1;
  name: string;
  scheme: ThemeScheme;
  colors: Record<ThemeToken, string>;
}

export function exportTheme(t: Pick<UserTheme, "name" | "scheme" | "colors">): string {
  const colors = Object.fromEntries(THEME_TOKENS.map(k => [k, normalizeHex(t.colors[k]) ?? "#000000"]));
  const file = { [FILE_FORMAT]: 1, name: t.name, scheme: t.scheme, colors };
  return JSON.stringify(file, null, 2) + "\n";
}

/** A file name for an exported theme. */
export function exportFileName(name: string): string {
  const base = name.trim().replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "-").replace(/^[.\s-]+|[.\s]+$/g, "").slice(0, 60) || "theme";
  return `${base}.glasshouse-theme.json`;
}

export type CheckResult = { theme: Omit<UserTheme, "id">; warnings: string[] } | { error: string };

/** A theme from parsed JSON (a file, or what was saved): the name, scheme
 *  and every token as a hex color. `on-accent` may be left out, and the
 *  scheme too; both are worked out from the colors. Unknown keys are
 *  ignored, with a warning. */
export function checkTheme(raw: unknown): CheckResult {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { error: "not a theme: expected a JSON object" };
  const o = raw as Record<string, unknown>;
  const warnings: string[] = [];
  const name = typeof o.name === "string" ? o.name.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 60) : "";
  if (!name) return { error: "the theme has no name" };
  const c = o.colors;
  if (!c || typeof c !== "object" || Array.isArray(c)) return { error: "the theme has no colors" };
  const given = c as Record<string, unknown>;
  const colors = {} as Record<ThemeToken, string>;
  const missing: string[] = [];
  for (const k of THEME_TOKENS) {
    const v = given[k];
    if (v === undefined && k === "on-accent") continue;
    if (!isHexColor(v)) {
      if (v === undefined) missing.push(k);
      else return { error: `--${k} isn't a hex color (#rrggbb)` };
      continue;
    }
    colors[k] = normalizeHex(v)!;
  }
  if (missing.length) return { error: `missing colors: ${missing.join(", ")}` };
  if (!colors["on-accent"]) colors["on-accent"] = textOn(colors.accent);
  const extra = Object.keys(given).filter(k => !(THEME_TOKENS as readonly string[]).includes(k));
  if (extra.length) warnings.push(`ignored: ${extra.join(", ")}`);
  const scheme: ThemeScheme = o.scheme === "light" || o.scheme === "dark" ? o.scheme : isDark(colors["bg-0"]) ? "dark" : "light";
  return { theme: { name, scheme, colors }, warnings };
}

/** A theme file's text, checked. */
export function parseThemeFile(text: string): CheckResult {
  if (text.length > MAX_FILE_BYTES) return { error: "too big for a theme file" };
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return { error: "not a theme file: it isn't JSON" }; }
  if (raw && typeof raw === "object" && (raw as Record<string, unknown>)[FILE_FORMAT] !== 1) {
    return { error: `not a glasshouse theme file (no "${FILE_FORMAT}": 1)` };
  }
  return checkTheme(raw);
}

export interface ContrastResult {
  what: string;
  fg: ThemeToken;
  bg: ThemeToken;
  ratio: number;
  min: number;
  ok: boolean;
}

/** Every contrast check, for the editor. */
export function contrastReport(colors: Record<ThemeToken, string>): ContrastResult[] {
  return CONTRAST_CHECKS.map(([fg, bg, min, what]) => {
    const ratio = contrast(colors[fg], colors[bg]);
    return { what, fg, bg, ratio, min, ok: ratio >= min };
  });
}

/** Whether `id` is a theme that can be shown. */
export function isKnownTheme(id: string, s: Store = snapshot()): boolean {
  return !!builtinTheme(id) || (id === DRAFT_ID ? !!s.draft : s.themes.some(t => t.id === id));
}

export function userThemeScheme(id: string, s: Store = snapshot()): ThemeScheme | undefined {
  return id === DRAFT_ID ? s.draft?.scheme : s.themes.find(t => t.id === id)?.scheme;
}
