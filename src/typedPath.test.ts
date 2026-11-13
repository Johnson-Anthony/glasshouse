import { describe, expect, it } from "vitest";
import { parseTyped } from "./typedPath";

const linux = (input: string, cwd = "/home/me/src", home: string | null = "/home/me") => parseTyped(input, cwd, home, false);
const windows = (input: string, cwd = "C:\\Users\\me\\src", home: string | null = "C:\\Users\\me") => parseTyped(input, cwd, home, true);
const path = (p: string) => ({ kind: "path", path: p });

describe("parseTyped", () => {
  it("hands http, https and mailto links to the browser as typed", () => {
    for (const url of ["https://example.com/a?b=1&c=2", "HTTP://example.com", "mailto:me@example.com"]) {
      expect(linux(`  ${url} `)).toEqual({ kind: "url", url });
      expect(windows(url)).toEqual({ kind: "url", url });
    }
  });

  it("refuses other links, which the backend won't open", () => {
    expect(linux("ftp://example.com/x")).toEqual({ kind: "error", message: "can't open ftp:// links: only http, https and mailto" });
    expect(windows("smb://server/share").kind).toBe("error");
  });

  it("reads a file:// URL as its path", () => {
    expect(linux("file:///home/me/My%20Notes/a.txt")).toEqual(path("/home/me/My Notes/a.txt"));
    expect(linux("file://localhost/etc/hosts")).toEqual(path("/etc/hosts"));
    expect(windows("file:///C:/Users/me/a%20b.txt")).toEqual(path("C:\\Users\\me\\a b.txt"));
    expect(windows("file://server/share/x.txt")).toEqual(path("\\\\server\\share\\x.txt"));
    expect(linux("file://server/share/x.txt").kind).toBe("error");
  });

  it("expands ~ to the home folder", () => {
    expect(linux("~")).toEqual(path("/home/me"));
    expect(linux("~/Downloads/")).toEqual(path("/home/me/Downloads"));
    expect(windows("~\\Documents")).toEqual(path("C:\\Users\\me\\Documents"));
    expect(windows("~/Documents")).toEqual(path("C:\\Users\\me\\Documents"));
    expect(linux("~/x", "/w", null)).toEqual({ kind: "error", message: "home folder unavailable" });
  });

  it("reads ~name as a name in the current folder, not someone's home", () => {
    expect(linux("~backup")).toEqual(path("/home/me/src/~backup"));
  });

  it("finds a relative path in the current folder, with .. worked out", () => {
    expect(linux("docs/a.md")).toEqual(path("/home/me/src/docs/a.md"));
    expect(linux("../Pictures")).toEqual(path("/home/me/Pictures"));
    expect(linux(".")).toEqual(path("/home/me/src"));
    expect(windows("..\\Desktop")).toEqual(path("C:\\Users\\me\\Desktop"));
    expect(linux("docs", "", null)).toEqual({ kind: "error", message: "no folder open to find docs in" });
  });

  it("takes absolute paths as they are, tidied", () => {
    expect(linux("/etc/../usr//share/")).toEqual(path("/usr/share"));
    expect(windows("C:/Program Files/../Users")).toEqual(path("C:\\Users"));
    expect(windows("\\\\server\\share\\dir")).toEqual(path("\\\\server\\share\\dir"));
    expect(windows("D:")).toEqual(path("D:\\"));
    // looksLikePath sends drive paths here on Linux too; they aren't joined
    // to the current folder.
    expect(linux("C:\\Users")).toEqual(path("C:\\Users"));
  });

  it("drops one pair of quotes around the whole path, as Copy as path adds", () => {
    expect(windows('"C:\\Users\\me\\My Files\\a.txt"')).toEqual(path("C:\\Users\\me\\My Files\\a.txt"));
    expect(linux("'/tmp/a b'")).toEqual(path("/tmp/a b"));
    expect(linux('"/tmp/a"b"')).toEqual(path('/tmp/a"b'));
  });

  it("needs something to open", () => {
    expect(linux("   ")).toEqual({ kind: "error", message: "path required" });
    expect(linux('""')).toEqual({ kind: "error", message: "path required" });
  });
});
