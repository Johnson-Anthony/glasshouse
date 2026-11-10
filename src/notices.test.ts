import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import thirdParty from "./assets/third-party.json";
import {
  dependencyNotices,
  groupNotices,
  linkSegments,
  NOTICES_INDEX,
  resolveNoticeLink,
  type ThirdPartyData,
} from "./notices";
import { NOTICES } from "./noticesData";

const DATA = thirdParty as ThirdPartyData;
const FILES = NOTICES.filter((n) => n.links);

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
    expect(FILES.map((n) => n.path).sort()).toEqual(onDisk);
    expect(onDisk.length).toBeGreaterThan(10);
  });

  it("hold each file's exact text", () => {
    for (const n of FILES) {
      expect(n.text, n.path).toBe(readFileSync(join(FONTS, n.path), "utf8"));
    }
  });

  it("start with the index and the top-level files, then npm, then Rust", () => {
    expect(NOTICES[0].path).toBe(NOTICES_INDEX);
    const groups = groupNotices(NOTICES).map((g) => g.group);
    expect(groups[0]).toBe("fonts/");
    expect(new Set(groups).size).toBe(groups.length); // each group once
    expect(groups.slice(-2)).toEqual(["npm packages/", "Rust crates/"]);
  });

  it("link every relative file the index mentions", () => {
    const known = new Set(FILES.map((n) => n.path));
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

describe("generated dependency notices (src/assets/third-party.json)", () => {
  it("give every package and crate a license text", () => {
    for (const d of [...DATA.npm, ...DATA.rust]) {
      expect(d.licenses.length, d.name).toBeGreaterThan(0);
      for (const l of d.licenses) expect(DATA.texts[l.text], `${d.name} ${l.id}`).toBeTruthy();
    }
    expect(new Set(DATA.texts).size).toBe(DATA.texts.length); // each text stored once
  });

  it("list what the app bundles, on the platforms it ships for", () => {
    const npm = DATA.npm.map((p) => p.name);
    expect(npm).toContain("react");
    expect(npm).not.toContain("@napi-rs/canvas"); // pdfjs's Node-only canvas never ships
    const rust = (name: string) => DATA.rust.find((c) => c.name === name)?.platforms;
    expect(rust("tauri")).toEqual(["linux", "windows"]);
    expect(rust("webkit2gtk")).toEqual(["linux"]);
    expect(rust("webview2-com")).toEqual(["windows"]);
    expect(rust("glasshouse")).toBeUndefined(); // the app itself
  });

  it("carry the bundled C libraries' own licenses", () => {
    const ids = DATA.rust.find((c) => c.name === "libgit2-sys")?.licenses.map((l) => l.id);
    expect(ids).toContain("libgit2 (bundled C source)");
  });

  it("filter Rust crates to the platform", () => {
    const linux = dependencyNotices(DATA, "linux").map((n) => n.label.split(" ")[0]);
    const windows = dependencyNotices(DATA, "windows").map((n) => n.label.split(" ")[0]);
    expect(linux).toContain("webkit2gtk");
    expect(linux).not.toContain("webview2-com");
    expect(windows).toContain("webview2-com");
    expect(windows).not.toContain("webkit2gtk");
    expect(linux).toContain("react"); // npm packages ship everywhere
  });

  it("show the package, its declared license and each text", () => {
    const data: ThirdPartyData = {
      npm: [{ name: "a", version: "1.0.0", license: "MIT", licenses: [{ id: "LICENSE", text: 0 }] }],
      rust: [{ name: "b", version: "2.0.0", license: "MIT OR Apache-2.0", licenses: [{ id: "MIT", text: 0 }], platforms: ["linux"] }],
      texts: ["the MIT text"],
    };
    const [npm, crate] = dependencyNotices(data, "linux");
    expect(npm).toMatchObject({ path: "npm:a@1.0.0", group: "npm packages/", label: "a 1.0.0" });
    expect(crate).toMatchObject({ path: "rust:b@2.0.0", group: "Rust crates/", label: "b 2.0.0" });
    expect(crate.text).toBe("b 2.0.0\nlicense: MIT OR Apache-2.0\n\n── MIT ──\n\nthe MIT text");
    expect(crate.links).toBeUndefined();
    expect(dependencyNotices(data, "windows")).toHaveLength(1);
  });
});
