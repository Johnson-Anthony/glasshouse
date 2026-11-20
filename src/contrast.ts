// Color parsing and WCAG 2 contrast, for the theme checks (themes.test.ts)
// and the theme editor's warnings. Colors are hex only: #rgb, #rrggbb or
// #rrggbbaa (alpha is ignored; theme colors are opaque).

/** WCAG AA: normal text, and large text or UI parts (borders, icons). */
export const AA_TEXT = 4.5;
export const AA_LARGE = 3;

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

export function isHexColor(s: unknown): s is string {
  return typeof s === "string" && HEX.test(s.trim());
}

/** [r, g, b] in 0–255, or null for anything but a hex color. */
export function parseHex(s: string): [number, number, number] | null {
  const m = typeof s === "string" ? HEX.exec(s.trim()) : null;
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = [...h].map(c => c + c).join("");
  return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}

/** "#rrggbb", lowercase; null for anything but a hex color. */
export function normalizeHex(s: string): string | null {
  const rgb = parseHex(s);
  return rgb && "#" + rgb.map(v => v.toString(16).padStart(2, "0")).join("");
}

export function luminance([r, g, b]: [number, number, number]): number {
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** The contrast ratio of two hex colors, 1–21; 1 when either isn't one. */
export function contrast(a: string, b: string): number {
  const x = parseHex(a), y = parseHex(b);
  if (!x || !y) return 1;
  const [hi, lo] = [luminance(x), luminance(y)].sort((p, q) => q - p);
  return (hi + 0.05) / (lo + 0.05);
}

/** Black or white, whichever reads better on `bg`. */
export function textOn(bg: string): "#000000" | "#ffffff" {
  return contrast(bg, "#000000") >= contrast(bg, "#ffffff") ? "#000000" : "#ffffff";
}

/** Whether a color is dark (for a custom theme's color-scheme guess). */
export function isDark(hex: string): boolean {
  const rgb = parseHex(hex);
  return !!rgb && luminance(rgb) < 0.18;
}
