// @vitest-environment happy-dom
// Custom themes: the file format and its checks, the store in localStorage,
// and the CSS that reaches the page.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { THEME_TOKENS, type ThemeToken } from "./themes";
import {
  DRAFT_ID, MAX_FILE_BYTES, checkTheme, contrastReport, deleteUserTheme, exportFileName, exportTheme,
  getUserThemes, installUserThemeStyles, isKnownTheme, newThemeId, parseThemeFile, resetUserThemesForTest,
  saveUserTheme, setDraft, themeCss, userThemeScheme, type UserTheme,
} from "./userThemes";

const colors = (over: Partial<Record<ThemeToken, string>> = {}) => ({
  ...Object.fromEntries(THEME_TOKENS.map(k => [k, k.startsWith("bg") ? "#101418" : "#e8eaed"])),
  accent: "#4c9aff", "on-accent": "#000000", "fg-2": "#b0b4ba", "fg-3": "#8a8f96",
  ...over,
}) as Record<ThemeToken, string>;
const theme = (id: string, name = id): UserTheme => ({ id, name, scheme: "dark", colors: colors() });

beforeEach(() => {
  localStorage.clear();
  resetUserThemesForTest();
});
afterEach(() => document.getElementById("glasshouse-user-themes")?.remove());

describe("theme files", () => {
  it("round-trip through export and parse", () => {
    const t = theme("user-x", "Night Shift");
    const text = exportTheme(t);
    expect(JSON.parse(text)).toMatchObject({ "glasshouse-theme": 1, name: "Night Shift", scheme: "dark" });
    const back = parseThemeFile(text);
    expect(back).toEqual({ theme: { name: "Night Shift", scheme: "dark", colors: t.colors }, warnings: [] });
  });

  it("accept a file without on-accent or a scheme, working them out", () => {
    const c: Record<string, string> = { ...colors() };
    delete c["on-accent"];
    const r = checkTheme({ name: "Paper", colors: { ...c, "bg-0": "#FAFAFA" } });
    expect("theme" in r && r.theme).toMatchObject({ scheme: "light" });
    expect("theme" in r && r.theme.colors["on-accent"]).toBe("#000000");
    expect("theme" in r && r.theme.colors["bg-0"]).toBe("#fafafa");
  });

  it("load a theme saved before --fg-4, which takes its --fg-3", () => {
    const c: Record<string, string> = { ...colors() };
    delete c["fg-4"];
    const r = checkTheme({ name: "Old", colors: c });
    expect("theme" in r && r.warnings).toEqual([]);
    expect("theme" in r && r.theme.colors["fg-4"]).toBe(c["fg-3"]);
    expect("theme" in r && r.theme.colors["fg-3"]).toBe(c["fg-3"]);
  });

  it("warn about unknown keys, which are dropped", () => {
    const r = checkTheme({ name: "X", colors: { ...colors(), "font-size": "99px" } });
    expect("theme" in r && r.warnings).toEqual(["ignored: font-size"]);
    expect("theme" in r && Object.keys(r.theme.colors)).not.toContain("font-size");
  });

  it("refuse anything that isn't a theme", () => {
    const err = (x: unknown) => { const r = checkTheme(x); return "error" in r ? r.error : null; };
    expect(err(null)).toMatch(/JSON object/);
    expect(err([])).toMatch(/JSON object/);
    expect(err({ colors: colors() })).toMatch(/no name/);
    expect(err({ name: "x" })).toMatch(/no colors/);
    expect(err({ name: "x", colors: { ...colors(), "bg-0": "red" } })).toMatch(/--bg-0 isn't a hex color/);
    expect(err({ name: "x", colors: { ...colors(), "bg-0": "#000; } body { display: none" } })).toMatch(/--bg-0/);
    const some: Record<string, string> = { ...colors() };
    delete some["fg-0"]; delete some.red;
    expect(err({ name: "x", colors: some })).toBe("missing colors: fg-0, red");
    const perr = (t: string) => { const r = parseThemeFile(t); return "error" in r ? r.error : null; };
    expect(perr("{")).toMatch(/isn't JSON/);
    expect(perr(JSON.stringify({ name: "x", colors: colors() }))).toMatch(/not a glasshouse theme file/);
    expect(perr(" ".repeat(MAX_FILE_BYTES + 1))).toMatch(/too big/);
  });

  it("strip control characters from the name and cap it", () => {
    const r = checkTheme({ name: "a\u0000b\u001bc" + "x".repeat(100), colors: colors() });
    expect("theme" in r && r.theme.name).toBe("abc" + "x".repeat(57));
  });

  it("get a safe file name", () => {
    expect(exportFileName("Night: Shift/2")).toBe("Night- Shift-2.glasshouse-theme.json");
    expect(exportFileName("...")).toBe("theme.glasshouse-theme.json");
  });
});

describe("the store", () => {
  it("saves, replaces and deletes, and keeps them across a reload", () => {
    saveUserTheme(theme("user-a", "A"));
    saveUserTheme(theme("user-b", "B"));
    saveUserTheme({ ...theme("user-a", "A2") });
    expect(getUserThemes().map(t => t.name)).toEqual(["A2", "B"]);
    resetUserThemesForTest();
    expect(getUserThemes().map(t => t.id)).toEqual(["user-a", "user-b"]);
    deleteUserTheme("user-a");
    resetUserThemesForTest();
    expect(getUserThemes().map(t => t.id)).toEqual(["user-b"]);
  });

  it("drops saved entries that don't check out", () => {
    localStorage.setItem("glasshouse.themes.v1", JSON.stringify({
      themes: [theme("user-ok"), { ...theme("bad id") }, { ...theme("user-ok") }, { id: "user-x", name: "x", colors: {} }],
    }));
    resetUserThemesForTest();
    expect(getUserThemes().map(t => t.id)).toEqual(["user-ok"]);
  });

  it("makes ids from names, unlike the ones taken and the draft's", () => {
    expect(newThemeId("Night Shift!", [])).toBe("user-night-shift");
    expect(newThemeId("Night Shift", ["user-night-shift"])).toBe("user-night-shift-2");
    expect(newThemeId("Ünïcode", [])).toBe("user-unicode");
    expect(newThemeId("???", [])).toBe("user-theme");
    expect(newThemeId("draft", [])).toBe("user-draft-2");
  });

  it("knows its themes and the draft's", () => {
    saveUserTheme({ ...theme("user-light"), scheme: "light" });
    expect(isKnownTheme("user-light")).toBe(true);
    expect(isKnownTheme("nord")).toBe(true);
    expect(isKnownTheme("user-nope")).toBe(false);
    expect(isKnownTheme(DRAFT_ID)).toBe(false);
    expect(userThemeScheme("user-light")).toBe("light");
    setDraft(theme("whatever"));
    expect(isKnownTheme(DRAFT_ID)).toBe(true);
    expect(userThemeScheme(DRAFT_ID)).toBe("dark");
  });
});

describe("the page's CSS", () => {
  it("is one block per theme, hex colors only", () => {
    const css = themeCss(theme("user-a"));
    expect(css.startsWith('[data-theme="user-a"] {\n  color-scheme: dark;\n')).toBe(true);
    expect(css.match(/--[a-z0-9-]+: #[0-9a-f]{6};/g)).toHaveLength(THEME_TOKENS.length);
  });

  it("follows the store, the draft included, and goes on cleanup", () => {
    const off = installUserThemeStyles();
    const el = () => document.getElementById("glasshouse-user-themes");
    expect(el()?.textContent).toBe("");
    saveUserTheme(theme("user-a"));
    expect(el()?.textContent).toContain('[data-theme="user-a"]');
    setDraft(theme("user-a"));
    expect(el()?.textContent).toContain(`[data-theme="${DRAFT_ID}"]`);
    setDraft(null);
    expect(el()?.textContent).not.toContain(DRAFT_ID);
    off();
    expect(el()).toBeNull();
  });
});

describe("contrastReport", () => {
  it("flags the pairs under WCAG AA", () => {
    const ok = contrastReport(colors());
    expect(ok.filter(r => !r.ok)).toEqual([]);
    const bad = contrastReport(colors({ "fg-0": "#303438" })).filter(r => !r.ok);
    expect(bad.map(r => [r.fg, r.bg])).toContainEqual(["fg-0", "bg-0"]);
    expect(bad.every(r => r.ratio < r.min)).toBe(true);
  });
});
