import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CONTEXT_BREADCRUMB,
  CONTEXT_EMPTY,
  CONTEXT_FILE,
  CONTEXT_SIDEBAR,
  CONTEXT_SIDEBAR_DRIVE,
  CONTEXT_SIDEBAR_FOLDER,
  CONTEXT_SIDEBAR_REMOTE,
  CONTEXT_TAB,
  GIT_CHORDS,
  MENUS,
  MUTATING_LABELS,
  PALETTE_ONLY,
  THEMES,
  type MenuItemDef,
} from "./data";

const TREES: MenuItemDef[][] = [
  ...Object.values(MENUS),
  CONTEXT_FILE,
  CONTEXT_SIDEBAR,
  CONTEXT_SIDEBAR_FOLDER,
  CONTEXT_SIDEBAR_DRIVE,
  CONTEXT_SIDEBAR_REMOTE,
  CONTEXT_TAB,
  CONTEXT_BREADCRUMB,
  CONTEXT_EMPTY,
  PALETTE_ONLY,
];

function items(list: MenuItemDef[]): Array<Extract<MenuItemDef, { kind: "item" }>> {
  return list.flatMap(it =>
    it.kind === "item" ? [it] : it.kind === "sub" ? items(it.children) : [],
  );
}

const ALL_ITEMS = TREES.flatMap(items);
const DISPATCHABLE = new Set(ALL_ITEMS.map(it => it.action ?? it.label));

describe("MUTATING_LABELS", () => {
  it("covers the selection-writing ops", () => {
    for (const label of [
      // Edit / keyboard
      "Cut", "Copy", "Rename", "Bulk Rename…", "Move to Trash", "Delete Permanently",
      "Shred (srm)", "Paste Text into Filename", "Duplicate", "Move to…",
      // Tools
      "Batch Permissions…", "Change Owner (chown)…", "Run Script on Selection…",
      "Zip (.zip)", "Tar + gzip (.tar.gz)", "Tar + zstd (.tar.zst)", "7-zip (.7z)",
      "ZIP (bundled)", "ZIP (each individually)", "TAR.GZ", "7-Zip",
      "Extract Here", "Extract to Folder…",
      // Git
      "Stage Selected", "Unstage Selected", "Discard Changes",
      "Git: Stage", "Git: Unstage", "Git: Discard changes",
      // dispatched from code (Inspector compress chip)
      "Compress to ZIP…",
    ]) {
      expect(MUTATING_LABELS, label).toContain(label);
    }
  });

  it("contains only labels that something actually dispatches", () => {
    for (const label of MUTATING_LABELS) {
      if (label === "Compress to ZIP…") continue; // code-dispatched, see data.ts
      expect(DISPATCHABLE, label).toContain(label);
    }
  });

  it("drops the old misspelled labels", () => {
    for (const label of ["Batch Rename…", "Shred…", "Compress to Zip", "Compress to Zip…"]) {
      expect(MUTATING_LABELS).not.toContain(label);
    }
  });

  it("leaves read-only and clipboard-sourced ops alone", () => {
    for (const label of [
      "Open", "Copy Path", "Properties", "Checksum SHA256", "Blame Selected",
      "Paste", "Paste as Link (symlink)", "Paste as Hard Link",
    ]) {
      expect(MUTATING_LABELS).not.toContain(label);
    }
  });
});

describe("GIT_CHORDS", () => {
  it("maps every Ctrl+G hint in the Git menu", () => {
    expect(GIT_CHORDS).toEqual({
      s: "Status",
      a: "Stage Selected",
      c: "Commit…",
      p: "Pull",
    });
  });
});

describe("shortcut hints", () => {
  it("only the palette toggle advertises Ctrl+P", () => {
    expect(ALL_ITEMS.filter(it => it.kb === "Ctrl+P").map(it => it.label)).toEqual(["Command Palette"]);
  });

  it("nothing advertises F6, which cycles panes", () => {
    expect(ALL_ITEMS.filter(it => it.kb === "F6").map(it => it.label)).toEqual([]);
  });
});

describe("THEMES", () => {
  it("lists exactly the [data-theme] blocks in themes.css", () => {
    // Read from disk: vitest stubs CSS imports, ?raw included.
    const themesCss = readFileSync(new URL("./styles/themes.css", import.meta.url), "utf8");
    const inCss = new Set([...themesCss.matchAll(/\[data-theme="([^"]+)"\]/g)].map(m => m[1]));
    expect(new Set(THEMES)).toEqual(inCss);
    expect(new Set(THEMES).size).toBe(THEMES.length);
  });
});
