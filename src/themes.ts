// The built-in themes: their ids (each a [data-theme] block in
// styles/themes.css), names, color scheme and group. No imports, so the
// demo's mock can read it before the app loads.

export type ThemeScheme = "light" | "dark";
export type ThemeGroup = "light" | "dark" | "contrast" | "retro";

export interface ThemeInfo {
  id: string;
  label: string;
  scheme: ThemeScheme;
  group: ThemeGroup;
}

const t = (id: string, label: string, scheme: ThemeScheme, group: ThemeGroup = scheme): ThemeInfo =>
  ({ id, label, scheme, group });

/** In the order Preferences shows them, group by group. */
export const THEME_LIST: readonly ThemeInfo[] = [
  t("glasshouse-light", "Glasshouse Light", "light"),
  t("catppuccin-latte", "Catppuccin Latte", "light"),
  t("github-light", "GitHub Light", "light"),
  t("one-light", "One Light", "light"),
  t("solarized-light", "Solarized Light", "light"),
  t("gruvbox-light", "Gruvbox Light", "light"),
  t("rose-pine-dawn", "Rosé Pine Dawn", "light"),
  t("tokyo-night-day", "Tokyo Night Day", "light"),
  t("everforest-light", "Everforest Light", "light"),
  t("ayu-light", "Ayu Light", "light"),
  t("nord-light", "Nord Light", "light"),
  t("kanagawa-lotus", "Kanagawa Lotus", "light"),

  t("glasshouse-dark", "Glasshouse Dark", "dark"),
  t("tokyo-night", "Tokyo Night", "dark"),
  t("tokyo-night-storm", "Tokyo Night Storm", "dark"),
  t("catppuccin-mocha", "Catppuccin Mocha", "dark"),
  t("catppuccin-macchiato", "Catppuccin Macchiato", "dark"),
  t("catppuccin-frappe", "Catppuccin Frappé", "dark"),
  t("gruvbox-dark", "Gruvbox Dark", "dark"),
  t("rose-pine", "Rosé Pine", "dark"),
  t("rose-pine-moon", "Rosé Pine Moon", "dark"),
  t("everforest", "Everforest Dark", "dark"),
  t("solarized-dark", "Solarized Dark", "dark"),
  t("dracula", "Dracula", "dark"),
  t("nord", "Nord", "dark"),
  t("one-dark", "One Dark", "dark"),
  t("monokai", "Monokai", "dark"),
  t("github-dark", "GitHub Dark", "dark"),
  t("github-dimmed", "GitHub Dimmed", "dark"),
  t("kanagawa", "Kanagawa", "dark"),
  t("ayu-dark", "Ayu Dark", "dark"),
  t("ayu-mirage", "Ayu Mirage", "dark"),
  t("night-owl", "Night Owl", "dark"),
  t("palenight", "Palenight", "dark"),

  t("high-contrast-light", "High Contrast Light", "light", "contrast"),
  t("high-contrast-dark", "High Contrast Dark", "dark", "contrast"),

  t("green-crt", "Green CRT", "dark", "retro"),
  t("amber-crt", "Amber CRT", "dark", "retro"),
  t("synthwave", "Synthwave", "dark", "retro"),
];

export const THEME_IDS: readonly string[] = THEME_LIST.map(x => x.id);

const BY_ID = new Map(THEME_LIST.map(x => [x.id, x]));
export function builtinTheme(id: string): ThemeInfo | undefined {
  return BY_ID.get(id);
}

/** System's picks for new users. */
export const DEFAULT_LIGHT = "glasshouse-light";
export const DEFAULT_DARK = "glasshouse-dark";
/** What System uses when the OS asks for more contrast. */
export const CONTRAST_LIGHT = "high-contrast-light";
export const CONTRAST_DARK = "high-contrast-dark";

/** The color tokens a theme sets, in the theme editor's order. */
export const THEME_TOKENS = [
  "bg-0", "bg-1", "bg-2", "bg-3", "bg-4", "bg-sel",
  "fg-0", "fg-1", "fg-2", "fg-3",
  "border", "border-strong",
  "accent", "accent-2", "on-accent",
  "red", "orange", "yellow", "green", "cyan", "blue", "magenta",
] as const;
export type ThemeToken = typeof THEME_TOKENS[number];

/** What each token colors, for the editor. */
export const TOKEN_HELP: Record<ThemeToken, string> = {
  "bg-0": "file list, main background",
  "bg-1": "sidebar, title bar, panels",
  "bg-2": "hover, raised areas",
  "bg-3": "active tab, buttons",
  "bg-4": "strongest surface",
  "bg-sel": "selected rows",
  "fg-0": "main text",
  "fg-1": "body text",
  "fg-2": "secondary text",
  "fg-3": "hints, muted text",
  "border": "lines between panels",
  "border-strong": "outlines, inputs",
  "accent": "highlights, focus",
  "accent-2": "second highlight",
  "on-accent": "text on the accent",
  "red": "errors, deleted",
  "orange": "archives, warnings",
  "yellow": "modified",
  "green": "added, success",
  "cyan": "links",
  "blue": "folders",
  "magenta": "images",
};

/** The contrast checks a theme must pass: [text token, background token,
 *  minimum ratio, what it is]. Body text is WCAG AA (4.5:1); muted text and
 *  colors used as icons or badges are held to 3:1. The original eight
 *  themes are only held to the body-text ones (task 38 owns the rest). */
export const CONTRAST_CHECKS: ReadonlyArray<[ThemeToken, ThemeToken, number, string, "body" | "all"]> = [
  ["fg-0", "bg-0", 4.5, "main text", "body"],
  ["fg-0", "bg-1", 4.5, "text on panels", "body"],
  ["fg-0", "bg-2", 4.5, "text on hover", "body"],
  ["fg-0", "bg-3", 4.5, "text on the active tab", "body"],
  ["fg-0", "bg-sel", 4.5, "selected row", "body"],
  ["fg-1", "bg-0", 4.5, "body text", "body"],
  ["fg-1", "bg-1", 4.5, "body text on panels", "body"],
  ["fg-1", "bg-2", 4.5, "body text on hover", "body"],
  ["fg-2", "bg-0", 4.5, "secondary text", "all"],
  ["fg-2", "bg-1", 4.5, "secondary text on panels", "all"],
  ["fg-3", "bg-0", 3, "muted text", "all"],
  ["fg-3", "bg-1", 3, "muted text on panels", "all"],
  ["accent", "bg-0", 3, "accent", "all"],
  ["accent", "bg-1", 3, "accent on panels", "all"],
  ["on-accent", "accent", 4.5, "text on the accent", "all"],
  ["red", "bg-0", 3, "red", "all"],
  ["orange", "bg-0", 3, "orange", "all"],
  ["yellow", "bg-0", 3, "yellow", "all"],
  ["green", "bg-0", 3, "green", "all"],
  ["cyan", "bg-0", 3, "cyan", "all"],
  ["blue", "bg-0", 3, "blue", "all"],
  ["magenta", "bg-0", 3, "magenta", "all"],
];

/** The eight themes the app shipped with before task 47. */
export const LEGACY_THEMES: readonly string[] = [
  "tokyo-night", "catppuccin-mocha", "gruvbox-dark", "rose-pine",
  "everforest", "solarized-dark", "green-crt", "synthwave",
];
