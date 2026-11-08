import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { groupByFolder, linkSegments, NOTICES_INDEX, resolveNoticeLink } from "./notices";
import { NOTICES } from "./noticesData";

const FONTS = fileURLToPath(new URL("./assets/fonts/", import.meta.url));
const FONT_FILE = /\.(woff2?|ttf|otf)$/i;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [relative(FONTS, p).split(sep).join("/")];
  });
}

describe("bundled notices", () => {
  it("are every text file next to the fonts, and no font file", () => {
    const onDisk = walk(FONTS).filter((p) => !FONT_FILE.test(p)).sort();
    expect(NOTICES.map((n) => n.path).sort()).toEqual(onDisk);
    expect(onDisk.length).toBeGreaterThan(10);
  });

  it("hold each file's exact text", () => {
    for (const n of NOTICES) {
      expect(n.text, n.path).toBe(readFileSync(join(FONTS, n.path), "utf8"));
    }
  });

  it("start with the index, then the top-level files", () => {
    expect(NOTICES[0].path).toBe(NOTICES_INDEX);
    const groups = groupByFolder(NOTICES).map((g) => g.folder);
    expect(groups[0]).toBe("");
    expect(new Set(groups).size).toBe(groups.length); // each folder once
  });

  it("link every relative file the index mentions", () => {
    const known = new Set(NOTICES.map((n) => n.path));
    const index = NOTICES[0];
    const relativeLinks = [...index.text.matchAll(/\]\(([^)\s]+)\)/g)]
      .map((m) => m[1])
      .filter((href) => !/^[a-z]+:/i.test(href));
    expect(relativeLinks.length).toBeGreaterThan(10);
    for (const href of relativeLinks) {
      expect(resolveNoticeLink(index.path, href, known), href).not.toBeNull();
    }
    const targets = linkSegments(index.path, index.text, known).filter((s) => s.target);
    expect(targets.length).toBe(relativeLinks.length);
  });
});

describe("resolveNoticeLink", () => {
  const known = new Set(["LICENSES.md", "OFL.txt", "nerd-fonts/LICENSE.md", "nerd-fonts/glyphs/a-LICENSE"]);

  it("resolves relative to the linking file's folder", () => {
    expect(resolveNoticeLink("LICENSES.md", "nerd-fonts/glyphs/a-LICENSE", known)).toBe("nerd-fonts/glyphs/a-LICENSE");
    expect(resolveNoticeLink("nerd-fonts/LICENSE.md", "glyphs/a-LICENSE", known)).toBe("nerd-fonts/glyphs/a-LICENSE");
    expect(resolveNoticeLink("nerd-fonts/glyphs/a-LICENSE", "../../OFL.txt", known)).toBe("OFL.txt");
    expect(resolveNoticeLink("LICENSES.md", "./OFL.txt#section", known)).toBe("OFL.txt");
  });

  it("ignores web links, anchors, absolute paths and unknown files", () => {
    expect(resolveNoticeLink("LICENSES.md", "https://example.com/OFL.txt", known)).toBeNull();
    expect(resolveNoticeLink("LICENSES.md", "#licenses", known)).toBeNull();
    expect(resolveNoticeLink("LICENSES.md", "/OFL.txt", known)).toBeNull();
    expect(resolveNoticeLink("LICENSES.md", "missing.txt", known)).toBeNull();
    expect(resolveNoticeLink("LICENSES.md", "../OFL.txt", known)).toBeNull();
  });
});

describe("linkSegments", () => {
  const known = new Set(["LICENSES.md", "OFL.txt"]);

  it("keeps all of the text and marks only links to notices", () => {
    const text = "See [OFL](OFL.txt) and [site](https://x.dev), [gone](nope.txt).";
    const segs = linkSegments("LICENSES.md", text, known);
    expect(segs.map((s) => s.text).join("")).toBe(text);
    expect(segs.filter((s) => s.target)).toEqual([{ text: "[OFL](OFL.txt)", target: "OFL.txt" }]);
  });

  it("returns the text whole when nothing links", () => {
    expect(linkSegments("OFL.txt", "plain", known)).toEqual([{ text: "plain" }]);
    expect(linkSegments("OFL.txt", "", known)).toEqual([]);
  });
});
