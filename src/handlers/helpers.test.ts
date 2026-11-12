import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { canExtractArchive, EXTRACT_EXTS, extractSummary, leftOutDetails } from "./archive";
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

  it("matches what extract_into in commands/archive.rs dispatches on", () => {
    const rs = readFileSync(new URL("../../src-tauri/src/commands/archive.rs", import.meta.url), "utf8");
    const start = rs.indexOf("fn extract_into(");
    const end = rs.indexOf("\n}\n", start);
    expect(start).toBeGreaterThan(0);
    const backend = new Set([...rs.slice(start, end).matchAll(/ends_with\("(\.[a-z0-9.]+)"\)/g)].map(m => m[1]));
    expect(new Set(EXTRACT_EXTS)).toEqual(backend);
  });
});

describe("extractSummary", () => {
  const res = (over: object = {}) => ({ done: [], replaced: [], skipped: [], failed: [], ...over });
  const moved = (n: number) => Array.from({ length: n }, (_, i) => ({ src: `/s/${i}`, dst: `/d/${i}` }));

  it("says what landed", () => {
    expect(extractSummary(res({ done: moved(3) }), [], false))
      .toEqual({ message: "extracted 3 item(s)", variant: "success" });
    expect(extractSummary(res(), [], false)).toEqual({ message: "extracted 0 item(s)", variant: "info" });
  });

  it("adds replaced, skipped and failed entries, and what the archive left out", () => {
    const r = res({
      done: moved(2),
      replaced: ["/d/0"],
      skipped: [{ src: "/s/x", reason: "conflict" }],
      failed: [{ src: "/s/y", error: "denied" }],
    });
    expect(extractSummary(r, [{ path: "a", reason: "r" }, { path: "b", reason: "r" }], true)).toEqual({
      message: "extracted 2 item(s), replaced 1 (old in the Recycle Bin), skipped 1 that already exist, " +
        "1 failed, left out 2 archive entries",
      variant: "warning",
    });
  });
});

describe("leftOutDetails", () => {
  it("lists the first five and counts the rest", () => {
    const skipped = Array.from({ length: 7 }, (_, i) => ({ path: `e${i}`, reason: "symbolic link" }));
    const lines = leftOutDetails(skipped).split("\n");
    expect(lines).toHaveLength(6);
    expect(lines[0]).toBe("e0: symbolic link");
    expect(lines[5]).toBe("…and 2 more");
  });
});
