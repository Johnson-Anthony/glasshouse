import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { contrast } from "./contrast";
import { CONTRAST_CHECKS, LEGACY_THEMES, THEME_IDS, THEME_LIST, THEME_TOKENS, builtinTheme } from "./themes";

// Every built-in theme, read from themes.css as the app applies it: each
// sets every token, says its color-scheme, and meets WCAG AA for body text.
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
    const legacy = LEGACY_THEMES.includes(id);
    const fails = CONTRAST_CHECKS
      .filter(([, , , , level]) => !legacy || level === "body")
      .map(([fg, bg, min, what]) => ({ what, ratio: contrast(vars[fg], vars[bg]), min }))
      .filter(c => c.ratio < c.min)
      .map(c => `${c.what}: ${c.ratio.toFixed(2)} < ${c.min}`);
    expect(fails).toEqual([]);
  });

  it("the high-contrast themes are AAA (7:1) for every text color", () => {
    for (const id of ["high-contrast-light", "high-contrast-dark"]) {
      const v = tokens(id);
      for (const fg of ["fg-0", "fg-1", "fg-2"]) for (const bg of ["bg-0", "bg-1", "bg-2", "bg-sel"])
        expect(contrast(v[fg], v[bg]), `${id} ${fg}/${bg}`).toBeGreaterThanOrEqual(7);
    }
  });
});
