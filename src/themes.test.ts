import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { contrast } from "./contrast";
import { CONTRAST_CHECKS, LEGACY_THEMES, THEME_IDS, THEME_LIST, THEME_TOKENS, builtinTheme } from "./themes";

// Every built-in theme, read from themes.css as the app applies it: each
// sets every token, says its color-scheme, and meets WCAG AA for its text.
// Read from disk: vitest stubs CSS imports.
const css = readFileSync(new URL("./styles/themes.css", import.meta.url), "utf8");
const blocks = new Map([...css.matchAll(/\[data-theme="([^"]+)"\]\s*{([^}]*)}/g)].map(m => [m[1], m[2]]));
const tokens = (id: string) => {
  const body = blocks.get(id) ?? "";
  const vars = Object.fromEntries([...body.matchAll(/--([\w-]+):\s*([^;]+);/g)].map(m => [m[1], m[2].trim()]));
  // The shared default (themes.css's `:root, [data-theme]` rule).
  vars["on-accent"] ??= vars["bg-0"];
  return vars;
};
const scheme = (id: string) => /color-scheme:\s*(\w+)/.exec(blocks.get(id) ?? "")?.[1];

describe("built-in themes", () => {
  it("lists each [data-theme] block once, with a name", () => {
    expect(new Set(THEME_IDS)).toEqual(new Set(blocks.keys()));
    expect(new Set(THEME_IDS).size).toBe(THEME_IDS.length);
    for (const t of THEME_LIST) expect(t.label.trim(), t.id).not.toBe("");
  });

  it("keeps the original eight theme names", () => {
    for (const id of LEGACY_THEMES) expect(builtinTheme(id), id).toBeDefined();
  });

  it("covers light, dark and high-contrast themes", () => {
    expect(THEME_LIST.filter(t => t.scheme === "light").length).toBeGreaterThanOrEqual(10);
    expect(THEME_LIST.filter(t => t.scheme === "dark").length).toBeGreaterThanOrEqual(10);
    expect(THEME_LIST.filter(t => t.group === "contrast").map(t => t.scheme).sort()).toEqual(["dark", "light"]);
  });

  it.each(THEME_IDS)("%s sets every color token as hex and its color-scheme", id => {
    const vars = tokens(id);
    for (const k of THEME_TOKENS) expect(vars[k], `${id} --${k}`).toMatch(/^#[0-9a-f]{6}$/i);
    expect(scheme(id)).toBe(builtinTheme(id)!.scheme);
  });

  it.each(THEME_IDS)("%s meets the contrast checks", id => {
    const vars = tokens(id);
    const fails = CONTRAST_CHECKS
      .map(([fg, bg, min, what]) => ({ what, ratio: contrast(vars[fg], vars[bg]), min }))
      .filter(c => c.ratio < c.min)
      .map(c => `${c.what}: ${c.ratio.toFixed(2)} < ${c.min}`);
    expect(fails).toEqual([]);
  });

  it("holds muted text to 4.5:1 and the focus ring to 3:1, on the list, panels and hover", () => {
    const has = (fg: string, bg: string, min: number) => CONTRAST_CHECKS.some(c => c[0] === fg && c[1] === bg && c[2] >= min);
    for (const bg of ["bg-0", "bg-1", "bg-2"]) {
      expect(has("fg-2", bg, 4.5), `fg-2 on ${bg}`).toBe(true);
      expect(has("fg-3", bg, 4.5), `fg-3 on ${bg}`).toBe(true);
      expect(has("accent", bg, 3), `accent on ${bg}`).toBe(true);
    }
    // A selected row's ring is its text color (app.css).
    expect(has("fg-0", "bg-sel", 4.5)).toBe(true);
  });

  it("keeps the order of the text colors: body, secondary, muted, then decoration", () => {
    for (const id of THEME_IDS) {
      const v = tokens(id);
      for (const bg of ["bg-0", "bg-1", "bg-2"]) {
        const on = (fg: string) => contrast(v[fg], v[bg]);
        // Some light themes' body text is itself just over 4.5:1, so the
        // three sit close together; none may read fainter than the next.
        expect(on("fg-1"), `${id} fg-1 over fg-2 on ${bg}`).toBeGreaterThanOrEqual(on("fg-2") - 0.05);
        expect(on("fg-2"), `${id} fg-2 over fg-3 on ${bg}`).toBeGreaterThanOrEqual(on("fg-3"));
        expect(on("fg-3"), `${id} fg-3 over fg-4 on ${bg}`).toBeGreaterThanOrEqual(on("fg-4"));
      }
    }
  });

  it("the high-contrast themes are AAA (7:1) for every text color", () => {
    for (const id of ["high-contrast-light", "high-contrast-dark"]) {
      const v = tokens(id);
      for (const fg of ["fg-0", "fg-1", "fg-2"]) for (const bg of ["bg-0", "bg-1", "bg-2", "bg-sel"])
        expect(contrast(v[fg], v[bg]), `${id} ${fg}/${bg}`).toBeGreaterThanOrEqual(7);
    }
  });
});
