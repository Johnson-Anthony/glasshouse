import { describe, expect, it } from "vitest";
import { fuzzyFilter, fuzzyMatch } from "./fuzzy";

describe("fuzzyMatch", () => {
  it("empty query matches everything with score 0", () => {
    expect(fuzzyMatch("", "anything")).toBe(0);
    expect(fuzzyMatch("", "")).toBe(0);
  });

  it("returns null when query is not a subsequence", () => {
    expect(fuzzyMatch("xyz", "abc")).toBeNull();
    expect(fuzzyMatch("abc", "ab")).toBeNull();
    expect(fuzzyMatch("a", "")).toBeNull();
  });

  it("matches case-insensitively", () => {
    expect(fuzzyMatch("READ", "readme.md")).not.toBeNull();
    expect(fuzzyMatch("read", "README.md")).not.toBeNull();
  });

  it("scores exact-case runs above cross-case ones", () => {
    const exact = fuzzyMatch("readme", "readme.md")!;
    const cross = fuzzyMatch("README", "readme.md")!;
    expect(exact).toBeGreaterThan(cross);
  });

  it("rewards word-start hits over mid-word hits", () => {
    // "co" at the start of "config" vs buried inside "alcove"
    const wordStart = fuzzyMatch("co", "my-config")!;
    const midWord = fuzzyMatch("co", "myalcove")!;
    expect(wordStart).toBeGreaterThan(midWord);
  });

  it("penalizes skipped characters", () => {
    const tight = fuzzyMatch("abc", "abc")!;
    const spread = fuzzyMatch("abc", "axxbxxc")!;
    expect(tight).toBeGreaterThan(spread);
  });

  it("treats separators as word starts", () => {
    for (const sep of [" ", "-", "_", "/", "\\", "."]) {
      const s = fuzzyMatch("x", `a${sep}x`)!;
      const mid = fuzzyMatch("x", `ayx`)!;
      expect(s).toBeGreaterThan(mid);
    }
  });
});

describe("fuzzyFilter", () => {
  const items = ["README.md", "src/main.tsx", "Cargo.toml", "package.json"];

  it("drops non-matches and sorts by score descending", () => {
    const out = fuzzyFilter("md", items, (s) => s);
    expect(out.map((r) => r.item)).toContain("README.md");
    expect(out.every((r, i, a) => i === 0 || a[i - 1].score >= r.score)).toBe(true);
    expect(out.map((r) => r.item)).not.toContain("Cargo.toml");
  });

  it("empty query keeps original order", () => {
    const out = fuzzyFilter("", items, (s) => s);
    expect(out.map((r) => r.item)).toEqual(items);
  });

  it("breaks score ties by original index", () => {
    const out = fuzzyFilter("aa", ["xaa", "yaa"], (s) => s);
    expect(out.map((r) => r.item)).toEqual(["xaa", "yaa"]);
  });
});
