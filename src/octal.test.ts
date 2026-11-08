import { describe, expect, it } from "vitest";
import { parseOctalMode } from "./octal";

describe("parseOctalMode", () => {
  it("parses 3- and 4-digit modes", () => {
    expect(parseOctalMode("644")).toBe(0o644);
    expect(parseOctalMode("755")).toBe(0o755);
    expect(parseOctalMode("0755")).toBe(0o755);
    expect(parseOctalMode("1777")).toBe(0o1777);
    expect(parseOctalMode("000")).toBe(0);
  });

  it("trims surrounding whitespace", () => {
    expect(parseOctalMode("  700 ")).toBe(0o700);
  });

  it("rejects input parseInt would partially accept", () => {
    expect(parseOctalMode("78")).toBeNull();
    expect(parseOctalMode("758")).toBeNull();
    expect(parseOctalMode("0o755")).toBeNull();
    expect(parseOctalMode("755x")).toBeNull();
    expect(parseOctalMode("7 55")).toBeNull();
  });

  it("rejects wrong lengths and non-octal input", () => {
    expect(parseOctalMode("")).toBeNull();
    expect(parseOctalMode("7")).toBeNull();
    expect(parseOctalMode("75")).toBeNull();
    expect(parseOctalMode("12345")).toBeNull();
    expect(parseOctalMode("-755")).toBeNull();
    expect(parseOctalMode("rwxr-xr-x")).toBeNull();
  });
});
