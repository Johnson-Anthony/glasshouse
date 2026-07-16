import { describe, expect, it } from "vitest";
import { joinPath, normalizePath, parentPath } from "./paths";

describe("joinPath", () => {
  it("joins posix dirs", () => {
    expect(joinPath("/home/me", "x.txt")).toBe("/home/me/x.txt");
    expect(joinPath("/home/me/", "x.txt")).toBe("/home/me/x.txt");
  });

  it("joins windows dirs with backslash", () => {
    expect(joinPath("C:\\Users\\me", "x.txt")).toBe("C:\\Users\\me\\x.txt");
  });

  it("handles drive roots and bare drives", () => {
    expect(joinPath("C:\\", "x.txt")).toBe("C:\\x.txt");
    expect(joinPath("C:", "x.txt")).toBe("C:\\x.txt");
    expect(joinPath("/", "etc")).toBe("/etc");
  });

  it("prefers forward slash for mixed-separator dirs", () => {
    expect(joinPath("C:/Users/me", "x.txt")).toBe("C:/Users/me/x.txt");
  });

  it("empty dir returns the name", () => {
    expect(joinPath("", "x.txt")).toBe("x.txt");
  });
});

describe("parentPath", () => {
  it("climbs posix paths and stops at /", () => {
    expect(parentPath("/home/me/proj")).toBe("/home/me");
    expect(parentPath("/home")).toBe("/");
    expect(parentPath("/")).toBe("/");
  });

  it("climbs windows paths and stops at the drive root", () => {
    expect(parentPath("C:\\Users\\me")).toBe("C:\\Users");
    expect(parentPath("C:\\Users")).toBe("C:\\");
    expect(parentPath("C:\\")).toBe("C:\\");
  });
});

describe("normalizePath", () => {
  it("ignores case and trailing separators", () => {
    expect(normalizePath("C:\\Users\\Me\\")).toBe(normalizePath("c:\\users\\me"));
    expect(normalizePath("/home/me/")).toBe("/home/me");
  });
});
