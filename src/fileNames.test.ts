import { readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Windows file systems ignore case. Two modules whose names differ only in
// case (`Notices.tsx` and `notices.ts`) build on Linux, but on Windows
// `import "./Notices"` finds `notices.ts` first and the build breaks. This
// shipped once and was only caught by the Windows release build.
const SRC = fileURLToPath(new URL(".", import.meta.url));
const MODULE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs)$/;

function clashes(dir: string): string[][] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const byKey = new Map<string, Set<string>>();
  const add = (key: string, name: string) => {
    if (!byKey.has(key)) byKey.set(key, new Set());
    byKey.get(key)!.add(name);
  };
  for (const e of entries) {
    // Whole names (what a checkout collides on) and module names without
    // the extension (what an import resolves).
    add(`name:${e.name.toLowerCase()}`, e.name);
    if (e.isFile() && MODULE_EXT.test(e.name)) add(`module:${e.name.replace(MODULE_EXT, "").toLowerCase()}`, e.name.replace(MODULE_EXT, ""));
  }
  const found = [...byKey.values()].filter(names => names.size > 1).map(names => [...names].map(n => relative(SRC, join(dir, n))));
  for (const e of entries) if (e.isDirectory()) found.push(...clashes(join(dir, e.name)));
  return found;
}

describe("file names", () => {
  it("no two files or modules in src differ only in case", () => {
    expect(clashes(SRC)).toEqual([]);
  });
});
