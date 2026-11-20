// The look's rules: loading saved settings (old and new), the theme System
// shows, View → Switch Theme, presets, and what reaches <html>.
import { describe, expect, it } from "vitest";
import {
  FONT_NERD_MONO, FONT_SYSTEM, LOOK_CLASSIC, LOOK_DEFAULTS, LOOK_KEYS, LOOK_VERSION, PRESETS,
  applyPreset, customFont, fontFamilyName, isPreset, lookAttrs, migrateLook, nextTheme, pickLook, resolveTheme,
  sanitizeLook, themeScheme, withGlyphs,
} from "./look";
import { THEME_LIST } from "./themes";

const known = (id: string) => THEME_LIST.some(t => t.id === id) || id === "user-mine";
const light = { dark: false, contrast: false };
const dark = { dark: true, contrast: false };

describe("migrateLook", () => {
  it("gives a new user the defaults: System, a system font, colored icons", () => {
    expect(migrateLook(null)).toEqual(LOOK_DEFAULTS);
    expect(LOOK_DEFAULTS).toMatchObject({ theme: "system", font: FONT_SYSTEM, iconSet: "color", zebra: false, motion: "system" });
  });

  it("keeps the look of settings saved before themes-and-cosmetics", () => {
    const old = { theme: "everforest", font: FONT_NERD_MONO, density: "compact", scanlines: true, hidden: true };
    const look = migrateLook(old);
    expect(look).toEqual({ ...LOOK_CLASSIC, theme: "everforest", density: "compact", scanlines: true, fontSize: 12 });
    expect(look).toMatchObject({ windowControls: "mac", frame: "rounded", iconSet: "glyphs", zebra: true, lookVersion: LOOK_VERSION });
    expect(migrateLook({ density: "comfy" }).fontSize).toBe(14);
    expect(migrateLook({}).theme).toBe("gruvbox-dark");
  });

  it("reads saved settings of this version over the defaults", () => {
    const saved = { ...LOOK_DEFAULTS, theme: "nord", iconSet: "nerd", fontSize: 15, accent: "#ABC" };
    expect(migrateLook(saved)).toEqual({ ...LOOK_DEFAULTS, theme: "nord", iconSet: "nerd", fontSize: 15, accent: "#aabbcc" });
  });
});

describe("sanitizeLook", () => {
  it("drops values that aren't allowed, keeping the base's", () => {
    const look = sanitizeLook({
      density: "huge", iconSet: 3, zebra: "yes", theme: "Bad Theme!", accent: "red", font: "x; } body { display: none",
      monoFont: "", listFont: "", fontSize: 99, sidebarWidth: 10,
    }, LOOK_DEFAULTS);
    expect(look).toEqual({ ...LOOK_DEFAULTS, listFont: "", fontSize: 20, sidebarWidth: 160 });
  });

  it("rounds numbers and takes a custom font list", () => {
    const font = customFont("Cascadia Code", true)!;
    const look = sanitizeLook({ fontSize: 12.6, sidebarWidth: 233.2, monoFont: font }, LOOK_DEFAULTS);
    expect(look).toMatchObject({ fontSize: 13, sidebarWidth: 233, monoFont: font });
  });
});

describe("fonts", () => {
  it("builds a family list from a typed name, refusing anything that could break out of CSS", () => {
    expect(customFont("  Cascadia Code ", true)).toBe('"Cascadia Code", ui-monospace, monospace');
    expect(customFont("Inter", false)).toBe(`"Inter", ${FONT_SYSTEM}`);
    for (const bad of ["", "a\"b", "x;y", "a{b}", "<script>", "a\\b", "x".repeat(65)]) expect(customFont(bad, false)).toBeNull();
    expect(fontFamilyName('"Cascadia Code", ui-monospace')).toBe("Cascadia Code");
  });

  it("keeps the Nerd Font last in every list, for the glyphs", () => {
    expect(withGlyphs(FONT_SYSTEM)).toBe(`${FONT_SYSTEM}, "JetBrainsMono Nerd Font"`);
    expect(withGlyphs(FONT_NERD_MONO)).toBe(FONT_NERD_MONO);
  });
});

describe("resolveTheme", () => {
  it("shows a fixed theme whatever the system says", () => {
    expect(resolveTheme({ ...LOOK_DEFAULTS, theme: "nord" }, light, known)).toBe("nord");
    expect(resolveTheme({ ...LOOK_DEFAULTS, theme: "nord" }, { dark: false, contrast: true }, known)).toBe("nord");
  });

  it("follows the system's light or dark with System, and its contrast setting", () => {
    const look = { ...LOOK_DEFAULTS, lightTheme: "solarized-light", darkTheme: "dracula" };
    expect(resolveTheme(look, light, known)).toBe("solarized-light");
    expect(resolveTheme(look, dark, known)).toBe("dracula");
    expect(resolveTheme(look, { dark: true, contrast: true }, known)).toBe("high-contrast-dark");
    expect(resolveTheme(look, { dark: false, contrast: true }, known)).toBe("high-contrast-light");
  });

  it("falls back to the default for the system's scheme when a theme is gone", () => {
    expect(resolveTheme({ ...LOOK_DEFAULTS, theme: "user-deleted" }, dark, known)).toBe("glasshouse-dark");
    expect(resolveTheme({ ...LOOK_DEFAULTS, lightTheme: "user-deleted" }, light, known)).toBe("glasshouse-light");
    expect(resolveTheme({ ...LOOK_DEFAULTS, theme: "user-mine" }, light, known)).toBe("user-mine");
  });
});

describe("nextTheme", () => {
  it("steps a fixed theme through every built-in theme, wrapping", () => {
    expect(nextTheme({ theme: THEME_LIST[0].id }, THEME_LIST[0].id)).toEqual({ theme: THEME_LIST[1].id });
    expect(nextTheme({ theme: THEME_LIST.at(-1)!.id }, THEME_LIST.at(-1)!.id)).toEqual({ theme: THEME_LIST[0].id });
    expect(nextTheme({ theme: "user-mine" }, "user-mine")).toEqual({ theme: THEME_LIST[0].id });
  });

  it("with System, steps the pick for the scheme on screen and stays System", () => {
    const darks = THEME_LIST.filter(t => t.scheme === "dark").map(t => t.id);
    const next = nextTheme({ theme: "system" }, darks[0]);
    expect(next).toEqual({ darkTheme: darks[1] });
    const lights = THEME_LIST.filter(t => t.scheme === "light").map(t => t.id);
    expect(nextTheme({ theme: "system" }, lights.at(-1)!)).toEqual({ lightTheme: lights[0] });
  });
});

describe("presets", () => {
  const mine = { ...LOOK_DEFAULTS, theme: "nord", accent: "#ff8800", lightTheme: "one-light", iconSet: "nerd" as const };

  it("reset the look but keep the theme, the picks and the accent unless they set them", () => {
    const compact = applyPreset("compact", mine);
    expect(compact).toMatchObject({ theme: "nord", accent: "#ff8800", lightTheme: "one-light", density: "tight", iconSet: "color" });
    const contrast = applyPreset("contrast", mine);
    expect(contrast).toMatchObject({ theme: "system", lightTheme: "high-contrast-light", darkTheme: "high-contrast-dark", accent: "" });
    expect(applyPreset("standard", mine)).toEqual({ ...LOOK_DEFAULTS, accent: "#ff8800", lightTheme: "one-light" });
  });

  it("are marked when the look is theirs", () => {
    for (const p of PRESETS) expect(isPreset(p.id, applyPreset(p.id, mine))).toBe(true);
    expect(isPreset("standard", LOOK_DEFAULTS)).toBe(true);
    expect(isPreset("terminal", LOOK_CLASSIC)).toBe(true);
    expect(isPreset("compact", mine)).toBe(false);
  });

  it("pickLook takes only the look's fields", () => {
    const all = { ...mine, hidden: true, zoom: 1.5 };
    expect(Object.keys(pickLook(all)).sort()).toEqual([...LOOK_KEYS].sort());
  });
});

describe("lookAttrs", () => {
  it("sets an attribute or a property for every setting", () => {
    const { attrs, vars } = lookAttrs(LOOK_DEFAULTS, "glasshouse-dark", "dark", false);
    expect(attrs).toMatchObject({
      "data-theme": "glasshouse-dark", "data-scheme": "dark", "data-density": "default", "data-icons": "color",
      "data-zebra": "off", "data-motion": "system", "data-tabs": "chrome",
    });
    expect(vars).toMatchObject({ "--fs-base": "13px", "--fs-k": "1", "--sidebar-w": "220px", "--accent": null, "--on-accent": null });
    expect(vars["--font-list"]).toBe(vars["--font-ui"]);
  });

  it("picks the window style for the platform when automatic", () => {
    expect(lookAttrs(LOOK_DEFAULTS, "x", "dark", true).attrs).toMatchObject({ "data-controls": "windows", "data-frame": "flat" });
    expect(lookAttrs(LOOK_DEFAULTS, "x", "dark", false).attrs).toMatchObject({ "data-controls": "gnome", "data-frame": "line" });
    expect(lookAttrs(LOOK_CLASSIC, "x", "dark", true).attrs).toMatchObject({ "data-controls": "mac", "data-frame": "rounded" });
  });

  it("scales the text and sets an accent with readable text on it", () => {
    const { vars } = lookAttrs({ ...LOOK_DEFAULTS, fontSize: 16, accent: "#ffee00", listFont: FONT_NERD_MONO }, "x", "light", false);
    expect(vars).toMatchObject({ "--fs-base": "16px", "--fs-k": "1.231", "--accent": "#ffee00", "--on-accent": "#000000", "--font-list": FONT_NERD_MONO });
    expect(lookAttrs({ ...LOOK_DEFAULTS, accent: "#1d4ed8" }, "x", "light", false).vars["--on-accent"]).toBe("#ffffff");
  });
});

describe("themeScheme", () => {
  it("is a built-in's own, or a custom theme's", () => {
    expect(themeScheme("solarized-light", () => undefined)).toBe("light");
    expect(themeScheme("dracula", () => "light")).toBe("dark");
    expect(themeScheme("user-mine", () => "light")).toBe("light");
    expect(themeScheme("user-gone", () => undefined)).toBe("dark");
  });
});
