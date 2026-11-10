import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { canExtractArchive, EXTRACT_EXTS } from "./archive";
import { winToUnc } from "./tools";

describe("winToUnc", () => {
  it("maps a drive path to its administrative share", () => {
    expect(winToUnc("C:\\Users\\me\\a.txt")).toBe("\\\\localhost\\C$\\Users\\me\\a.txt");
    expect(winToUnc("d:\\data")).toBe("\\\\localhost\\D$\\data");
  });

  it("turns forward slashes into backslashes", () => {
    expect(winToUnc("C:/Users/me")).toBe("\\\\localhost\\C$\\Users\\me");
  });

  it("maps a drive root to the share root", () => {
    expect(winToUnc("C:\\")).toBe("\\\\localhost\\C$\\");
  });

  it("returns UNC, WSL and posix paths unchanged", () => {
    for (const p of ["\\\\server\\share\\x", "\\\\wsl$\\Ubuntu\\home", "/home/me", "relative\\path"]) {
      expect(winToUnc(p)).toBe(p);
    }
  });
});

describe("canExtractArchive", () => {
  it("accepts every supported extension, in any case", () => {
    for (const ext of EXTRACT_EXTS) {
      expect(canExtractArchive(`a${ext}`), ext).toBe(true);
      expect(canExtractArchive(`A${ext.toUpperCase()}`), ext).toBe(true);
    }
  });

  it("refuses compressed files that aren't archives, and other formats", () => {
    for (const name of ["a.gz", "a.bz2", "a.xz", "a.zst", "a.rar", "a.tar.lz", "zip", "a.zip.txt", "tar"]) {
      expect(canExtractArchive(name), name).toBe(false);
    }
  });

  it("matches what archive_extract in commands/archive.rs dispatches on", () => {
    const rs = readFileSync(new URL("../../src-tauri/src/commands/archive.rs", import.meta.url), "utf8");
    const start = rs.indexOf("pub fn archive_extract(");
    const end = rs.indexOf("\n}\n", start);
    expect(start).toBeGreaterThan(0);
    const backend = new Set([...rs.slice(start, end).matchAll(/ends_with\("(\.[a-z0-9.]+)"\)/g)].map(m => m[1]));
    expect(new Set(EXTRACT_EXTS)).toEqual(backend);
  });
});
