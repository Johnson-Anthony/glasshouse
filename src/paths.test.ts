import { describe, expect, it } from "vitest";
import { pathOps } from "./paths";

const win = pathOps(true);
const posix = pathOps(false);

describe("joinPath", () => {
  it("joins posix dirs", () => {
    expect(posix.joinPath("/home/me", "x.txt")).toBe("/home/me/x.txt");
    expect(posix.joinPath("/home/me/", "x.txt")).toBe("/home/me/x.txt");
    expect(posix.joinPath("/", "etc")).toBe("/etc");
  });

  it("treats a trailing \\ on linux as part of the dir name", () => {
    expect(posix.joinPath("/home/me/odd\\", "x.txt")).toBe("/home/me/odd\\/x.txt");
  });

  it("joins windows dirs with backslash", () => {
    expect(win.joinPath("C:\\Users\\me", "x.txt")).toBe("C:\\Users\\me\\x.txt");
    expect(win.joinPath("\\\\server\\share", "x.txt")).toBe("\\\\server\\share\\x.txt");
  });

  it("handles drive roots and bare drives", () => {
    expect(win.joinPath("C:\\", "x.txt")).toBe("C:\\x.txt");
    expect(win.joinPath("C:", "x.txt")).toBe("C:\\x.txt");
  });

  it("follows forward-slash windows dirs", () => {
    expect(win.joinPath("C:/Users/me", "x.txt")).toBe("C:/Users/me/x.txt");
  });

  it("empty dir returns the name", () => {
    expect(win.joinPath("", "x.txt")).toBe("x.txt");
    expect(posix.joinPath("", "x.txt")).toBe("x.txt");
  });
});

describe("parentPath", () => {
  it("climbs posix paths and stops at /", () => {
    expect(posix.parentPath("/home/me/proj")).toBe("/home/me");
    expect(posix.parentPath("/home/me/proj/")).toBe("/home/me");
    expect(posix.parentPath("/home")).toBe("/");
    expect(posix.parentPath("/")).toBe("/");
  });

  it("keeps \\ inside linux names", () => {
    expect(posix.parentPath("/home/me/a\\b")).toBe("/home/me");
    expect(posix.parentPath("/home/me/a\\b/c")).toBe("/home/me/a\\b");
  });

  it("climbs windows paths and stops at the drive root", () => {
    expect(win.parentPath("C:\\Users\\me")).toBe("C:\\Users");
    expect(win.parentPath("C:\\Users")).toBe("C:\\");
    expect(win.parentPath("C:\\")).toBe("C:\\");
    expect(win.parentPath("C:")).toBe("C:\\");
    expect(win.parentPath("C:/Users/me")).toBe("C:/Users");
  });

  it("stops at a UNC share root", () => {
    expect(win.parentPath("\\\\server\\share\\dir\\sub")).toBe("\\\\server\\share\\dir");
    expect(win.parentPath("\\\\server\\share\\dir")).toBe("\\\\server\\share\\");
    expect(win.parentPath("\\\\server\\share\\")).toBe("\\\\server\\share\\");
    expect(win.parentPath("\\\\server\\share")).toBe("\\\\server\\share\\");
    expect(win.parentPath("\\\\wsl$\\Ubuntu\\home")).toBe("\\\\wsl$\\Ubuntu\\");
  });
});

describe("basename", () => {
  it("returns the last posix component", () => {
    expect(posix.basename("/home/me/x.txt")).toBe("x.txt");
    expect(posix.basename("/home/me/")).toBe("me");
    expect(posix.basename("x.txt")).toBe("x.txt");
    expect(posix.basename("/")).toBe("");
  });

  it("keeps \\ inside linux names", () => {
    expect(posix.basename("/home/me/a\\b.txt")).toBe("a\\b.txt");
  });

  it("splits windows paths on either separator", () => {
    expect(win.basename("C:\\Users\\me\\x.txt")).toBe("x.txt");
    expect(win.basename("C:/Users/me/x.txt")).toBe("x.txt");
    expect(win.basename("C:\\Users\\me\\")).toBe("me");
    expect(win.basename("C:\\")).toBe("C:");
    expect(win.basename("\\\\wsl$\\Ubuntu\\")).toBe("Ubuntu");
  });
});

describe("pathSegments", () => {
  it("splits on the platform's separators", () => {
    expect(posix.pathSegments("a/b\\c//d")).toEqual(["a", "b\\c", "d"]);
    expect(win.pathSegments("a/b\\c\\\\d")).toEqual(["a", "b", "c", "d"]);
  });
});

describe("splitBreadcrumb", () => {
  it("splits posix paths", () => {
    expect(posix.splitBreadcrumb("/home/me")).toEqual([
      { label: "home", path: "/home" },
      { label: "me", path: "/home/me" },
    ]);
    expect(posix.splitBreadcrumb("/")).toEqual([]);
    expect(posix.splitBreadcrumb("")).toEqual([]);
  });

  it("keeps \\ inside linux names", () => {
    expect(posix.splitBreadcrumb("/home/me/a\\b")).toEqual([
      { label: "home", path: "/home" },
      { label: "me", path: "/home/me" },
      { label: "a\\b", path: "/home/me/a\\b" },
    ]);
  });

  it("starts windows paths at the drive", () => {
    expect(win.splitBreadcrumb("C:\\Users\\me")).toEqual([
      { label: "C:", path: "C:\\" },
      { label: "Users", path: "C:\\Users" },
      { label: "me", path: "C:\\Users\\me" },
    ]);
    expect(win.splitBreadcrumb("C:\\")).toEqual([{ label: "C:", path: "C:\\" }]);
    expect(win.splitBreadcrumb("C:/Users")).toEqual([
      { label: "C:", path: "C:\\" },
      { label: "Users", path: "C:\\Users" },
    ]);
  });

  it("keeps the leading \\\\ of UNC paths", () => {
    expect(win.splitBreadcrumb("\\\\server\\share\\dir")).toEqual([
      { label: "\\\\server\\share", path: "\\\\server\\share\\" },
      { label: "dir", path: "\\\\server\\share\\dir" },
    ]);
    expect(win.splitBreadcrumb("\\\\wsl$\\Ubuntu\\")).toEqual([
      { label: "\\\\wsl$\\Ubuntu", path: "\\\\wsl$\\Ubuntu\\" },
    ]);
  });
});

describe("normalizePath", () => {
  it("ignores trailing separators on both platforms", () => {
    expect(posix.normalizePath("/home/me/")).toBe("/home/me");
    expect(win.normalizePath("C:\\Users\\me\\")).toBe(win.normalizePath("C:\\Users\\me"));
  });

  it("is case-insensitive on windows", () => {
    expect(win.normalizePath("C:\\Users\\Me")).toBe(win.normalizePath("c:\\users\\me"));
    expect(win.normalizePath("C:/Users/Me")).toBe(win.normalizePath("c:\\users\\me"));
  });

  it("is case-sensitive on linux", () => {
    expect(posix.normalizePath("/home/me/Foo")).not.toBe(posix.normalizePath("/home/me/foo"));
  });

  it("keeps \\ significant on linux", () => {
    expect(posix.normalizePath("/home/me/a\\")).toBe("/home/me/a\\");
    expect(posix.normalizePath("/home/me/a\\b")).not.toBe(posix.normalizePath("/home/me/a/b"));
  });
});

describe("collapsePath", () => {
  it("works out . and .. and drops repeated and trailing separators", () => {
    expect(posix.collapsePath("/home/me/./src/../docs//notes/")).toBe("/home/me/docs/notes");
    expect(posix.collapsePath("/home/me")).toBe("/home/me");
    expect(posix.collapsePath("//home")).toBe("/home");
  });

  it("stops .. at the root", () => {
    expect(posix.collapsePath("/../../etc")).toBe("/etc");
    expect(posix.collapsePath("/home/..")).toBe("/");
    expect(win.collapsePath("C:\\..\\Users")).toBe("C:\\Users");
    expect(win.collapsePath("\\\\server\\share\\..\\x")).toBe("\\\\server\\share\\x");
  });

  it("keeps a leading .. on a relative path", () => {
    expect(posix.collapsePath("../a/./b/..")).toBe("../a");
    expect(posix.collapsePath("a/..")).toBe(".");
  });

  it("gives Windows paths backslashes, and a bare drive its root", () => {
    expect(win.collapsePath("C:/Users/me/../you/")).toBe("C:\\Users\\you");
    expect(win.collapsePath("//server/share/dir")).toBe("\\\\server\\share\\dir");
    expect(win.collapsePath("C:")).toBe("C:\\");
  });

  it("leaves a \\ alone on Linux, where it's part of a name", () => {
    expect(posix.collapsePath("/tmp/odd\\name/..")).toBe("/tmp");
    expect(posix.collapsePath("/tmp/a\\..")).toBe("/tmp/a\\..");
  });
});
