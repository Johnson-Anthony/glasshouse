import { existsSync, readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The app makes no third-party requests: fonts are bundled, and the CSP
// allows nothing outside the app and Tauri's own *.localhost protocols.
// docs/decisions/2026-11-08-local-fonts-bundled.md

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

describe("no third-party requests", () => {
  it("index.html loads nothing from the network", () => {
    expect(read("../index.html")).not.toMatch(/https?:\/\//);
  });

  it("the CSP only allows the app and Tauri's localhost protocols", () => {
    const conf = JSON.parse(read("../src-tauri/tauri.conf.json"));
    const csp: string = conf.app.security.csp;
    const origins = csp.split(/[\s;]+/).filter((t) => /^https?:/.test(t));
    expect(origins.length).toBeGreaterThan(0);
    for (const o of origins) expect(o).toMatch(/^https?:\/\/[a-z]+\.localhost$/);
  });

  it("stylesheets only use bundled files, and every one exists", () => {
    const dir = new URL("./styles/", import.meta.url);
    for (const name of readdirSync(dir).filter((f) => f.endsWith(".css"))) {
      const css = readFileSync(new URL(name, dir), "utf8");
      for (const [, ref] of css.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)) {
        if (ref.startsWith("data:")) continue;
        expect(ref, `${name}: ${ref}`).not.toMatch(/^(https?:)?\/\//);
        expect(existsSync(new URL(ref, new URL(name, dir))), `${name}: ${ref}`).toBe(true);
      }
    }
  });

  it("each font the picker offers from the bundle has its faces", () => {
    // The Tweaks picker's families that used to come from Google Fonts, at
    // the weights Google served. Iosevka and Berkeley Mono are never
    // bundled: they apply only when installed.
    const css = read("./styles/app.css");
    const faces = [...css.matchAll(/@font-face\s*{([^}]*)}/g)].map((m) => m[1]);
    const weights = (family: string) =>
      faces
        .filter((f) => f.includes(`font-family: "${family}"`))
        .map((f) => Number(/font-weight:\s*(\d+)/.exec(f)?.[1]));
    expect(weights("JetBrains Mono")).toEqual([400, 500, 600]);
    expect(weights("IBM Plex Mono")).toEqual([400, 500, 600]);
    expect(weights("Fira Code")).toEqual([400, 500]);
  });
});
