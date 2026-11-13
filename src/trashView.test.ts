import { describe, expect, it } from "vitest";
import type { TrashEntry } from "./api";
import { noBinText, problemLines, sortTrash, trashKey, trashSizeText } from "./trashView";

function entry(name: string, deleted: number, more: Partial<TrashEntry> = {}): TrashEntry {
  return {
    id: `/t/info/${name}.trashinfo`, name, original_parent: "/d", original: `/d/${name}`, deleted,
    size: 10, entries: null, ...more,
  };
}

describe("trash view helpers", () => {
  it("sorts newest first, then by name", () => {
    const sorted = sortTrash([entry("b", 5), entry("old", 1), entry("a", 5)]);
    expect(sorted.map(e => e.name)).toEqual(["a", "b", "old"]);
  });

  it("names an entry by id, original path and its deletion second", () => {
    expect(trashKey(entry("a", 7))).toEqual({ original: "/d/a", from: 7, to: 7, id: "/t/info/a.trashinfo" });
  });

  it("shows a size, an entry count or a dash", () => {
    expect(trashSizeText({ size: 512, entries: null })).toBe("512 B");
    expect(trashSizeText({ size: 3 * 1024 * 1024, entries: null })).toBe("3.0 MB");
    expect(trashSizeText({ size: null, entries: 1 })).toBe("1 item");
    expect(trashSizeText({ size: null, entries: 0 })).toBe("0 items");
    expect(trashSizeText({ size: null, entries: null })).toBe("—");
  });

  it("lists five problems, then how many more", () => {
    const problems = Array.from({ length: 7 }, (_, i) => ({ path: `/d/f${i}`, reason: "isn't in the trash any more" }));
    const text = problemLines(problems);
    expect(text.split("\n")).toHaveLength(6);
    expect(text).toMatch(/^f0: isn't in the trash any more\n/);
    expect(text).toMatch(/…and 2 more$/);
  });
});

describe("noBinText", () => {
  const net = (p: string) => ({ path: p, reason: "it's on a network drive" });

  it("asks about one item by name", () => {
    expect(noBinText([net("/z/a.txt")], 1)).toBe(
      "\"a.txt\" can't go to the Recycle Bin: it's on a network drive. Delete it permanently? This cannot be undone.",
    );
  });

  it("says when only some of the selection would be deleted", () => {
    const text = noBinText([net("/z/a.txt")], 3);
    expect(text).toContain("1 of the 3 items can't go to the Recycle Bin:\na.txt: it's on a network drive");
    expect(text).toContain("Delete it permanently, and move the other 2 to the Recycle Bin?");
  });

  it("covers a whole selection", () => {
    expect(noBinText([net("/z/a"), net("/z/b")], 2)).toContain("These 2 items can't go to the Recycle Bin");
  });
});
