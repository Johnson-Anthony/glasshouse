// The look: every cosmetic setting (theme, fonts, chrome, file-list style,
// effects), saved with the other settings in localStorage["glasshouse.tweaks"]
// and set from Preferences → Appearance. All of it reaches the page as
// attributes and custom properties on <html> (lookAttrs), so a change
// restyles the app through CSS and re-renders no file row.
// docs/decisions/2026-11-20-themes-system-and-defaults.md

import { isHexColor, normalizeHex, textOn } from "./contrast";
import {
  CONTRAST_DARK, CONTRAST_LIGHT, DEFAULT_DARK, DEFAULT_LIGHT, THEME_IDS, THEME_LIST, builtinTheme, type ThemeScheme,
} from "./themes";

export type Density = "tight" | "compact" | "default" | "comfy" | "spacious";
export type LineHeight = "tight" | "normal" | "relaxed" | "loose";
export type WindowControls = "auto" | "windows" | "gnome" | "mac" | "hidden";
export type Frame = "auto" | "flat" | "line" | "rounded";
export type Radius = "none" | "small" | "medium" | "large";
export type Borders = "none" | "subtle" | "normal" | "strong";
export type Shadows = "none" | "soft" | "deep";
export type TabStyle = "pill" | "line" | "chrome" | "minimal";
export type IconSize = "small" | "medium" | "large";
export type Breadcrumbs = "slashes" | "chevrons" | "pills";
export type IconSet = "color" | "mono" | "nerd" | "glyphs";
export type GridLines = "none" | "rows" | "both";
export type Selection = "fill" | "tint" | "outline" | "bar";
export type GitStyle = "both" | "dot" | "letter" | "tint";
export type NameColors = "none" | "type" | "tag";
export type Motion = "system" | "reduced" | "full";

export interface LookState {
  /** 2 from task 47 on. Saved settings without it are from before, and get
   *  the classic look for everything new (migrateLook). */
  lookVersion: number;
  /** "system" (follow the OS's light or dark setting) or a theme id. */
  theme: string;
  /** System's picks. */
  lightTheme: string;
  darkTheme: string;
  /** "" for the theme's own accent, else "#rrggbb". */
  accent: string;
  /** The interface font, a CSS font-family list. */
  font: string;
  /** The file list's font; "" for the interface font. */
  listFont: string;
  /** Code, previews and the terminal. */
  monoFont: string;
  /** Text size in px; the app's sizes scale from 13. */
  fontSize: number;
  lineHeight: LineHeight;
  density: Density;
  windowControls: WindowControls;
  frame: Frame;
  radius: Radius;
  borders: Borders;
  shadows: Shadows;
  tabStyle: TabStyle;
  /** px. */
  sidebarWidth: number;
  sidebarIcons: IconSize;
  navButtons: boolean;
  breadcrumbs: Breadcrumbs;
  iconSet: IconSet;
  zebra: boolean;
  gridLines: GridLines;
  selection: Selection;
  gitStyle: GitStyle;
  nameColors: NameColors;
  scanlines: boolean;
  glow: boolean;
  vignette: boolean;
  frosted: boolean;
  motion: Motion;
}

export const LOOK_VERSION = 2;

// ---- fonts ----
/** Always last in a font list: the sidebar's and the Nerd Font icon set's
 *  glyphs come from it whatever font is chosen. */
const NERD = '"JetBrainsMono Nerd Font"';
export const FONT_SYSTEM = 'system-ui, "Segoe UI Variable Text", "Segoe UI", Cantarell, "Noto Sans", Ubuntu, "DejaVu Sans", sans-serif';
export const FONT_NERD_MONO = '"JetBrainsMono Nerd Font", "JetBrains Mono", ui-monospace, monospace';

export interface FontOption {
  label: string;
  value: string;
  /** Bundled with the app, so it works offline everywhere. Others apply only
   *  when installed, and Preferences offers them only then. */
  bundled: boolean;
  mono: boolean;
  /** The family to look for when it isn't bundled. */
  family?: string;
}

export const FONTS: readonly FontOption[] = [
  { label: "System UI", value: FONT_SYSTEM, bundled: true, mono: false },
  { label: "JetBrainsMono Nerd Font", value: FONT_NERD_MONO, bundled: true, mono: true },
  { label: "JetBrains Mono", value: '"JetBrains Mono", ui-monospace, monospace', bundled: true, mono: true },
  { label: "IBM Plex Mono", value: '"IBM Plex Mono", ui-monospace, monospace', bundled: true, mono: true },
  { label: "Fira Code", value: '"Fira Code", ui-monospace, monospace', bundled: true, mono: true },
  { label: "Iosevka", value: '"Iosevka", ui-monospace, monospace', bundled: false, mono: true, family: "Iosevka" },
  { label: "Berkeley Mono", value: '"Berkeley Mono", ui-monospace, monospace', bundled: false, mono: true, family: "Berkeley Mono" },
];

/** A font-family list for a family name typed in Preferences, or null if
 *  the name can't be one. */
export function customFont(name: string, mono: boolean): string | null {
  const n = name.trim();
  if (!n || n.length > 64 || /["'\\;{}<>]/.test(n) || /[\u0000-\u001f]/.test(n)) return null;
  return `"${n}", ${mono ? "ui-monospace, monospace" : FONT_SYSTEM}`;
}

/** The first family of a font-family list, unquoted. */
export function fontFamilyName(value: string): string {
  return value.split(",")[0].trim().replace(/^["']|["']$/g, "");
}

const okFont = (v: unknown): v is string =>
  typeof v === "string" && v.length > 0 && v.length <= 400 && !/[;{}<>\\]/.test(v);

/** The list as the page gets it: with the Nerd Font last. */
export function withGlyphs(value: string): string {
  return value.includes("JetBrainsMono Nerd Font") ? value : `${value}, ${NERD}`;
}

// ---- options, for sanitizing and for Preferences ----
export const DENSITIES: readonly Density[] = ["tight", "compact", "default", "comfy", "spacious"];
export const LINE_HEIGHTS: readonly LineHeight[] = ["tight", "normal", "relaxed", "loose"];
export const FONT_SIZES = [11, 12, 13, 14, 15, 16, 18, 20] as const;
export const SIDEBAR_WIDTH = { min: 160, max: 420, step: 20 } as const;

const ENUMS: { [K in keyof LookState]?: readonly string[] } = {
  lineHeight: LINE_HEIGHTS,
  density: DENSITIES,
  windowControls: ["auto", "windows", "gnome", "mac", "hidden"],
  frame: ["auto", "flat", "line", "rounded"],
  radius: ["none", "small", "medium", "large"],
  borders: ["none", "subtle", "normal", "strong"],
  shadows: ["none", "soft", "deep"],
  tabStyle: ["pill", "line", "chrome", "minimal"],
  sidebarIcons: ["small", "medium", "large"],
  breadcrumbs: ["slashes", "chevrons", "pills"],
  iconSet: ["color", "mono", "nerd", "glyphs"],
  gridLines: ["none", "rows", "both"],
  selection: ["fill", "tint", "outline", "bar"],
  gitStyle: ["both", "dot", "letter", "tint"],
  nameColors: ["none", "type", "tag"],
  motion: ["system", "reduced", "full"],
};
const BOOLS: ReadonlyArray<keyof LookState> = ["navButtons", "zebra", "scanlines", "glow", "vignette", "frosted"];

// ---- defaults and presets ----
/** New users: the OS's light or dark, a system font, native-looking window
 *  controls, colored file icons. */
export const LOOK_DEFAULTS: LookState = {
  lookVersion: LOOK_VERSION,
  theme: "system",
  lightTheme: DEFAULT_LIGHT,
  darkTheme: DEFAULT_DARK,
  accent: "",
  font: FONT_SYSTEM,
  listFont: "",
  monoFont: FONT_NERD_MONO,
  fontSize: 13,
  lineHeight: "normal",
  density: "default",
  windowControls: "auto",
  frame: "auto",
  radius: "medium",
  borders: "normal",
  shadows: "soft",
  tabStyle: "chrome",
  sidebarWidth: 220,
  sidebarIcons: "medium",
  navButtons: true,
  breadcrumbs: "chevrons",
  iconSet: "color",
  zebra: false,
  gridLines: "none",
  selection: "fill",
  gitStyle: "both",
  nameColors: "none",
  scanlines: false,
  glow: false,
  vignette: false,
  frosted: false,
  motion: "system",
};

/** The window and file-list style glasshouse had before task 47:
 *  monospace, macOS-style dots, an accent frame, pill tabs, glyph icons,
 *  striped rows. */
const CLASSIC_STYLE: Partial<LookState> = {
  font: FONT_NERD_MONO,
  windowControls: "mac",
  frame: "rounded",
  tabStyle: "pill",
  breadcrumbs: "slashes",
  iconSet: "glyphs",
  zebra: true,
};

/** The look before task 47. Saved settings from before get it, so an update
 *  changes nothing on screen. */
export const LOOK_CLASSIC: LookState = { ...LOOK_DEFAULTS, theme: "gruvbox-dark", ...CLASSIC_STYLE };

export interface LookPreset {
  id: string;
  label: string;
  hint: string;
  look: Partial<LookState>;
}

/** One-click looks. Each resets the look to the defaults and sets its own
 *  values; the theme, System's picks and the accent stay unless it sets
 *  them. */
export const PRESETS: readonly LookPreset[] = [
  { id: "standard", label: "standard", hint: "follows the system's light or dark, like other apps", look: { theme: "system" } },
  { id: "terminal", label: "terminal", hint: "glasshouse's original look: monospace, dots, glyphs", look: { theme: "gruvbox-dark", ...CLASSIC_STYLE } },
  {
    id: "compact", label: "compact", hint: "more rows, smaller text",
    look: { density: "tight", fontSize: 12, radius: "small", sidebarIcons: "small", sidebarWidth: 200, tabStyle: "line", gridLines: "rows" },
  },
  {
    id: "contrast", label: "high contrast", hint: "strong colors, outlines, larger text",
    look: { theme: "system", lightTheme: CONTRAST_LIGHT, darkTheme: CONTRAST_DARK, accent: "", borders: "strong", selection: "outline", fontSize: 14, gridLines: "rows", shadows: "none" },
  },
  {
    id: "retro", label: "retro", hint: "green phosphor, scanlines, glow",
    look: { theme: "green-crt", ...CLASSIC_STYLE, scanlines: true, glow: true, vignette: true },
  },
];

/** The look after picking preset `id`, from the current one. */
export function applyPreset(id: string, current: LookState): LookState {
  const p = PRESETS.find(x => x.id === id);
  const { theme, lightTheme, darkTheme, accent } = current;
  return { ...LOOK_DEFAULTS, theme, lightTheme, darkTheme, accent, ...(p?.look ?? {}), lookVersion: LOOK_VERSION };
}

export const LOOK_KEYS = Object.keys(LOOK_DEFAULTS) as Array<keyof LookState>;

/** The look fields of `s` (the settings hold others too). */
export function pickLook(s: LookState): LookState {
  return Object.fromEntries(LOOK_KEYS.map(k => [k, s[k]])) as unknown as LookState;
}

/** Whether `look` is what preset `id` gives (Preferences marks it). */
export function isPreset(id: string, look: LookState): boolean {
  const p = applyPreset(id, look);
  return LOOK_KEYS.every(k => p[k] === look[k]);
}

/** The look fields of saved settings, each checked; a bad or missing value
 *  takes `base`'s. */
export function sanitizeLook(saved: Record<string, unknown>, base: LookState): LookState {
  const out: LookState = { ...base, lookVersion: LOOK_VERSION };
  const o = out as unknown as Record<string, unknown>;
  for (const [k, allowed] of Object.entries(ENUMS)) {
    const v = saved[k];
    if (typeof v === "string" && allowed!.includes(v)) o[k] = v;
  }
  for (const k of BOOLS) if (typeof saved[k] === "boolean") o[k] = saved[k];
  for (const k of ["theme", "lightTheme", "darkTheme"] as const) {
    const v = saved[k];
    if (typeof v === "string" && /^[a-z0-9-]{1,64}$/.test(v)) out[k] = v;
  }
  if (saved.accent === "" || isHexColor(saved.accent)) out.accent = saved.accent === "" ? "" : normalizeHex(saved.accent as string)!;
  if (okFont(saved.font)) out.font = saved.font;
  if (okFont(saved.monoFont)) out.monoFont = saved.monoFont;
  if (saved.listFont === "" || okFont(saved.listFont)) out.listFont = saved.listFont as string;
  const n = (v: unknown, lo: number, hi: number) =>
    typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : null;
  out.fontSize = n(saved.fontSize, FONT_SIZES[0], FONT_SIZES[FONT_SIZES.length - 1]) ?? out.fontSize;
  out.sidebarWidth = n(saved.sidebarWidth, SIDEBAR_WIDTH.min, SIDEBAR_WIDTH.max) ?? out.sidebarWidth;
  return out;
}

/** The look from saved settings (null: none saved, a new user). Settings
 *  saved before task 47 keep their theme, font, density and scanlines and
 *  get the classic look for the rest; the old density also set the text
 *  size. */
export function migrateLook(saved: Record<string, unknown> | null): LookState {
  if (!saved) return LOOK_DEFAULTS;
  if (typeof saved.lookVersion === "number") return sanitizeLook(saved, LOOK_DEFAULTS);
  const fontSize = saved.density === "compact" ? 12 : saved.density === "comfy" ? 14 : 13;
  return sanitizeLook(saved, { ...LOOK_CLASSIC, fontSize });
}

// ---- resolving ----
export interface OsLook {
  /** The OS prefers dark. */
  dark: boolean;
  /** The OS asks for more contrast. */
  contrast: boolean;
}

/** The theme to show. `known` says whether an id is a theme (built-in or
 *  the user's); an unknown one (a deleted custom theme, say) falls back to
 *  the default for the OS's scheme. */
export function resolveTheme(look: Pick<LookState, "theme" | "lightTheme" | "darkTheme">, os: OsLook, known: (id: string) => boolean): string {
  const fallback = os.dark ? DEFAULT_DARK : DEFAULT_LIGHT;
  if (look.theme !== "system") return known(look.theme) ? look.theme : fallback;
  if (os.contrast) return os.dark ? CONTRAST_DARK : CONTRAST_LIGHT;
  const pick = os.dark ? look.darkTheme : look.lightTheme;
  return known(pick) ? pick : fallback;
}

/** View → Switch Theme: the next built-in theme. A fixed theme steps through
 *  them all; System steps the pick for the scheme shown (`shown`, the theme
 *  on screen) through that scheme's themes, and stays System. */
export function nextTheme(look: Pick<LookState, "theme">, shown: string): Partial<LookState> {
  if (look.theme !== "system") {
    const i = THEME_IDS.indexOf(look.theme);
    return { theme: THEME_IDS[(i < 0 ? 0 : i + 1) % THEME_IDS.length] };
  }
  const scheme = builtinTheme(shown)?.scheme ?? "dark";
  const ids = THEME_LIST.filter(t => t.scheme === scheme).map(t => t.id);
  const next = ids[(ids.indexOf(shown) + 1) % ids.length];
  return scheme === "dark" ? { darkTheme: next } : { lightTheme: next };
}

/** A theme's scheme: a built-in's, or what `user` says for a custom one. */
export function themeScheme(id: string, user: (id: string) => ThemeScheme | undefined): ThemeScheme {
  return builtinTheme(id)?.scheme ?? user(id) ?? "dark";
}

const LINE: Record<LineHeight, string> = { tight: "1.2", normal: "normal", relaxed: "1.5", loose: "1.75" };

export interface LookAttrs {
  attrs: Record<string, string>;
  vars: Record<string, string | null>;
}

/** What `look` sets on <html>: data attributes for app.css's switches, and
 *  custom properties (null: remove, so the theme's own value applies). */
export function lookAttrs(look: LookState, themeId: string, scheme: ThemeScheme, windows: boolean): LookAttrs {
  const onOff = (b: boolean) => (b ? "on" : "off");
  const accent = look.accent && normalizeHex(look.accent);
  return {
    attrs: {
      "data-theme": themeId,
      "data-scheme": scheme,
      "data-density": look.density,
      "data-scanlines": onOff(look.scanlines),
      "data-controls": look.windowControls === "auto" ? (windows ? "windows" : "gnome") : look.windowControls,
      "data-frame": look.frame === "auto" ? (windows ? "flat" : "line") : look.frame,
      "data-radius": look.radius,
      "data-borders": look.borders,
      "data-shadows": look.shadows,
      "data-tabs": look.tabStyle,
      "data-sb-icons": look.sidebarIcons,
      "data-nav": onOff(look.navButtons),
      "data-crumbs": look.breadcrumbs,
      "data-icons": look.iconSet,
      "data-zebra": onOff(look.zebra),
      "data-grid": look.gridLines,
      "data-sel": look.selection,
      "data-git-style": look.gitStyle,
      "data-name-colors": look.nameColors,
      "data-glow": onOff(look.glow),
      "data-vignette": onOff(look.vignette),
      "data-frosted": onOff(look.frosted),
      "data-motion": look.motion,
    },
    vars: {
      "--font-ui": withGlyphs(look.font),
      "--font-list": withGlyphs(look.listFont || look.font),
      "--font-mono": withGlyphs(look.monoFont),
      "--fs-base": `${look.fontSize}px`,
      "--fs-k": String(Math.round((look.fontSize / 13) * 1000) / 1000),
      "--lh": LINE[look.lineHeight],
      "--sidebar-w": `${look.sidebarWidth}px`,
      "--accent": accent || null,
      "--on-accent": accent ? textOn(accent) : null,
    },
  };
}

/** The window event useLook sends after it changes the look, for what
 *  measures the DOM (the file list's row height). */
export const LOOK_APPLIED = "glasshouse:look-applied";

export function applyLookAttrs(el: HTMLElement, { attrs, vars }: LookAttrs): void {
  for (const [k, v] of Object.entries(attrs)) if (el.getAttribute(k) !== v) el.setAttribute(k, v);
  for (const [k, v] of Object.entries(vars)) {
    if (v === null) el.style.removeProperty(k);
    else if (el.style.getPropertyValue(k) !== v) el.style.setProperty(k, v);
  }
}

/** Whether a font family is installed: text in it measures differently from
 *  the fallback. False where nothing can be measured (tests). */
export function fontInstalled(family: string): boolean {
  try {
    const ctx = document.createElement("canvas").getContext("2d");
    if (!ctx || typeof ctx.measureText !== "function") return false;
    const sample = "mmmmmmmmmlli10OQ@#";
    return ["serif", "sans-serif"].some(generic => {
      ctx.font = `32px ${generic}`;
      const base = ctx.measureText(sample).width;
      ctx.font = `32px "${family}", ${generic}`;
      return ctx.measureText(sample).width !== base;
    });
  } catch {
    return false;
  }
}
