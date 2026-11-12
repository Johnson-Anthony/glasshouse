import { describe, expect, it } from "vitest";
import { modeOctal, modeString, parseOctalMode, permBit, toggleBit } from "./octal";

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

describe("mode bits", () => {
  it("names each cell's bit", () => {
    expect(permBit(0, 0)).toBe(0o400);
    expect(permBit(1, 1)).toBe(0o020);
    expect(permBit(2, 2)).toBe(0o001);
  });

  it("flips one bit from the real mode and keeps the rest", () => {
    // The old grid started from 0740 whatever the file had: owner-exec on
    // a 0600 key gave 0640.
    expect(toggleBit(0o600, 0, 2)).toBe(0o700);
    expect(toggleBit(0o755, 2, 2)).toBe(0o754);
    expect(toggleBit(0o2775, 1, 1)).toBe(0o2755);
  });

  it("writes modes as ls and chmod do", () => {
    expect([modeString(0o600), modeOctal(0o600)]).toEqual(["rw-------", "0600"]);
    expect([modeString(0o755), modeOctal(0o755)]).toEqual(["rwxr-xr-x", "0755"]);
    expect(modeString(0o4755)).toBe("rwsr-xr-x");
    expect(modeString(0o2745)).toBe("rwxr-Sr-x");
    expect([modeString(0o1777), modeOctal(0o1777)]).toEqual(["rwxrwxrwt", "1777"]);
    expect(modeString(0o1776)).toBe("rwxrwxrwT");
  });
});
