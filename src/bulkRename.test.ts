import { describe, expect, it } from "vitest";
import { bulkRenamePreview, type BulkRenameOptions } from "./components";

const NONE: BulkRenameOptions = {
  find: "", replace: "", prefix: "", suffix: "",
  numberEnabled: false, numberStart: 1, caseMode: "none",
};

/** New names for `names` (all in /d) under `opts`. */
function rename(names: string[], opts: Partial<BulkRenameOptions>): string[] {
  const items = names.map(name => ({ path: `/d/${name}`, name }));
  return bulkRenamePreview(items, { ...NONE, ...opts }).map(p => p.to);
}

describe("bulkRenamePreview", () => {
  it("leaves names alone with nothing set, and keeps path and from", () => {
    expect(bulkRenamePreview([{ path: "/d/a.txt", name: "a.txt" }], NONE))
      .toEqual([{ path: "/d/a.txt", from: "a.txt", to: "a.txt" }]);
  });

  it("replaces every literal match in the base name only", () => {
    expect(rename(["a-b-c.tar"], { find: "-", replace: "_" })).toEqual(["a_b_c.tar"]);
    // The extension is never searched.
    expect(rename(["notes.txt"], { find: "txt", replace: "md" })).toEqual(["notes.txt"]);
  });

  it("treats /…/flags as a global regex with groups", () => {
    expect(rename(["IMG_0001.jpg"], { find: "/IMG_(\\d+)/", replace: "photo-$1" }))
      .toEqual(["photo-0001.jpg"]);
    expect(rename(["aAa.txt"], { find: "/a/i", replace: "x" })).toEqual(["xxx.txt"]);
  });

  it("leaves names unchanged when the regex doesn't compile", () => {
    // It falls back to a literal search for "/(/", which no file name contains.
    expect(rename(["a(b.txt"], { find: "/(/", replace: "_" })).toEqual(["a(b.txt"]);
  });

  it("adds prefix and suffix around the base, before the extension", () => {
    expect(rename(["a.txt"], { prefix: "pre-", suffix: "-post" })).toEqual(["pre-a-post.txt"]);
  });

  it("numbers rows from the start value, padded by the token's width", () => {
    expect(rename(["a.jpg", "b.jpg", "c.jpg"], { numberEnabled: true, numberStart: 9, prefix: "{n:03}_" }))
      .toEqual(["009_a.jpg", "010_b.jpg", "011_c.jpg"]);
    expect(rename(["a", "b"], { numberEnabled: true, suffix: "-{n}" })).toEqual(["a-1", "b-2"]);
    // A number longer than the width isn't cut.
    expect(rename(["a"], { numberEnabled: true, numberStart: 1234, prefix: "{n:2}" })).toEqual(["1234a"]);
  });

  it("expands tokens from the replacement too", () => {
    expect(rename(["x.png", "y.png"], { numberEnabled: true, find: "/.+/", replace: "shot{n:2}" }))
      .toEqual(["shot01.png", "shot02.png"]);
  });

  it("with numbering off, leaves {n} as typed", () => {
    expect(rename(["a"], { prefix: "{n}-" })).toEqual(["{n}-a"]);
    // A name that already contains a token isn't touched by an unrelated change.
    expect(rename(["report{n}.txt"], { caseMode: "upper" })).toEqual(["REPORT{N}.txt"]);
  });

  it("changes case of the new base but never the extension", () => {
    expect(rename(["My File.TXT"], { caseMode: "lower" })).toEqual(["my file.TXT"]);
    expect(rename(["my file.txt"], { caseMode: "upper" })).toEqual(["MY FILE.txt"]);
    expect(rename(["hello wORLD.md"], { caseMode: "title" })).toEqual(["Hello World.md"]);
    // Case applies after prefix/suffix, so they're cased too.
    expect(rename(["a.md"], { prefix: "x-", caseMode: "upper" })).toEqual(["X-A.md"]);
  });

  it("splits only the last extension, and keeps dotfiles whole", () => {
    expect(rename(["archive.tar.gz"], { suffix: "!" })).toEqual(["archive.tar!.gz"]);
    expect(rename([".gitignore"], { caseMode: "upper" })).toEqual([".GITIGNORE"]);
    expect(rename([".env.local"], { suffix: "2" })).toEqual([".env2.local"]);
    expect(rename(["Makefile"], { suffix: ".bak" })).toEqual(["Makefile.bak"]);
  });
});
