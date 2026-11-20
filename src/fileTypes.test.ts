// File types for the icon sets: by name, by extension, then by kind; and
// every type has its glyph, color and shape in app.css.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fileType } from "./fileTypes";

describe("fileType", () => {
  it("knows special names before extensions, in any case", () => {
    expect(fileType("text", null, "Dockerfile")).toBe("docker");
    expect(fileType("text", "json", "package.json")).toBe("npm");
    expect(fileType("text", "lock", "Cargo.lock")).toBe("lock");
    expect(fileType("text", "md", "README.md")).toBe("md");
    expect(fileType("text", null, "LICENSE")).toBe("license");
    expect(fileType("text", null, ".gitignore")).toBe("git");
  });

  it("goes by extension, in any case", () => {
    expect(fileType("code", "ts", "a.ts")).toBe("ts");
    expect(fileType("code", "TSX", "A.TSX")).toBe("react");
    expect(fileType("img", "jpeg", "x.jpeg")).toBe("image");
    expect(fileType("archive", "zst", "x.tar.zst")).toBe("archive");
    expect(fileType("text", "pdf", "x.pdf")).toBe("pdf");
  });

  it("falls back on the backend's kind, and a folder is a folder whatever its name", () => {
    expect(fileType("folder", "rs", "src.rs")).toBe("folder");
    expect(fileType("code", "weird", "x.weird")).toBe("code");
    expect(fileType("img", null, "x")).toBe("image");
    expect(fileType("exec", null, "run")).toBe("exe");
    expect(fileType("text", "xyz", "x.xyz")).toBe("file");
    expect(fileType("text", undefined)).toBe("file");
  });
});

describe("the icon sets in app.css", () => {
  const css = readFileSync(new URL("./styles/app.css", import.meta.url), "utf8");
  const src = readFileSync(new URL("./fileTypes.ts", import.meta.url), "utf8");
  const types = new Set([
    ...[...src.matchAll(/add\("([a-z]+)"/g)].map(m => m[1]),
    ...[...src.matchAll(/: "([a-z]+)"/g)].map(m => m[1]),
    "folder", "code", "image", "archive", "exe", "file",
  ]);
  const ruled = (re: RegExp) => new Set([...css.matchAll(re)].flatMap(m => [...m[0].matchAll(/data-ft="([a-z]+)"/g)].map(x => x[1])));

  it("gives every type a Nerd Font glyph", () => {
    const glyphs = ruled(/\.row\[data-ft="[a-z]+"\] \{ --nf: "\\[0-9a-f]+"; \}/g);
    expect([...types].filter(t => !glyphs.has(t))).toEqual([]);
  });

  it("gives every type a color and a shape", () => {
    const colored = ruled(/\.row:is\([^)]*\) \{ --ic-c: [^}]+\}/g);
    const shaped = ruled(/\.row:is\([^)]*\) \{ --ic-s: [^}]+\}/g);
    expect([...types].filter(t => !colored.has(t))).toEqual([]);
    expect([...types].filter(t => !shaped.has(t))).toEqual([]);
  });
});
