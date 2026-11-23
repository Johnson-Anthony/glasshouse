import { describe, expect, it } from "vitest";
import { hasWindowsNames, isDeviceName, windowsNameProblem } from "./winNames";

// The same cases as `is_device_name` in src-tauri/src/winpath_tests.rs.
describe("isDeviceName", () => {
  it("knows DOS's devices in any case", () => {
    for (const n of ["CON", "con", "Nul", "PRN", "AUX", "COM1", "com9", "LPT1", "lpt9", "COM¹", "LPT³", "CONIN$", "conout$"]) {
      expect(isDeviceName(n), n).toBe(true);
    }
  });

  it("isn't fooled by an extension or spaces before it", () => {
    for (const n of ["NUL.txt", "con.tar.gz", "aux .txt", "COM1.log", "nul."]) expect(isDeviceName(n), n).toBe(true);
  });

  it("leaves ordinary names alone", () => {
    for (const n of ["CONSOLE", "nulls", "COM0", "COM10", "LPT", "COM", "a.con", "con1", "_nul", "auxiliary.txt", ""]) {
      expect(isDeviceName(n), n).toBe(false);
    }
  });
});

describe("windowsNameProblem", () => {
  const on = (name: string) => windowsNameProblem(name, "on Windows");

  it("takes ordinary names", () => {
    for (const n of ["notes.txt", ".gitignore", "a b", "données (1).csv", "x.y.z", "...a", "con1", "ＣＯＮ"]) {
      expect(on(n), n).toBeNull();
    }
  });

  it("names the character Windows won't take", () => {
    expect(on("a:b")).toBe("a name can't contain : on Windows");
    expect(on("what?.txt")).toBe("a name can't contain ? on Windows");
    expect(on("a*b")).toBe("a name can't contain * on Windows");
    expect(on('say "hi"')).toBe(`a name can't contain " on Windows`);
    expect(on("a<b")).toBe("a name can't contain < on Windows");
    expect(on("a>b")).toBe("a name can't contain > on Windows");
    expect(on("a|b")).toBe("a name can't contain | on Windows");
    expect(on("a\\b")).toBe("a name can't contain \\ on Windows");
    expect(on("tab\there")).toBe("a name can't contain control characters on Windows");
    expect(on("a\u0000")).toBe("a name can't contain control characters on Windows");
  });

  it("refuses a trailing dot or space, which Windows would drop", () => {
    expect(on("notes.")).toBe("a name can't end with a dot or a space on Windows");
    expect(on("notes ")).toBe("a name can't end with a dot or a space on Windows");
    expect(on("notes. .")).toBe("a name can't end with a dot or a space on Windows");
  });

  it("refuses device names, with the place it applies", () => {
    expect(on("CON")).toBe(`"CON" is a reserved name on Windows`);
    expect(on("nul.txt")).toBe(`"nul" is a reserved name on Windows`);
    expect(windowsNameProblem("Com1 .log", "on this drive")).toBe(`"Com1" is a reserved name on this drive`);
  });
});

describe("hasWindowsNames", () => {
  it("is true for FAT, exFAT and SMB", () => {
    for (const fs of ["vfat", "msdos", "exfat", "fuse.exfat", "cifs", "smb3", "smbfs", "VFAT", " exfat "]) {
      expect(hasWindowsNames(fs), fs).toBe(true);
    }
  });

  it("is false for the rest, and for a type that isn't known", () => {
    for (const fs of ["ext4", "btrfs", "xfs", "ntfs", "ntfs3", "fuseblk", "nfs4", "tmpfs", "overlay", "9p", ""]) {
      expect(hasWindowsNames(fs), fs).toBe(false);
    }
  });
});
