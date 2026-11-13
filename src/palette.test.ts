import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CONTEXT_BREADCRUMB,
  CONTEXT_EMPTY,
  CONTEXT_FILE,
  CONTEXT_SIDEBAR,
  CONTEXT_SIDEBAR_DRIVE,
  CONTEXT_SIDEBAR_FILE,
  CONTEXT_SIDEBAR_FOLDER,
  CONTEXT_SIDEBAR_REMOTE,
  CONTEXT_TAB,
  MENUS,
  PALETTE_ONLY,
  type MenuItemDef,
} from "./data";
import { KEYMAP } from "./keymap";
import { PALETTE_ENTRIES, SAME_COMMAND, buildPalette, kbKeys, searchPalette, type PaletteEntry } from "./palette";

type Item = Extract<MenuItemDef, { kind: "item" }>;
const items = (list: MenuItemDef[]): Item[] =>
  list.flatMap(it => (it.kind === "item" ? [it] : it.kind === "sub" ? items(it.children) : []));
const subLabels = (list: MenuItemDef[]): string[] =>
  list.flatMap(it => (it.kind === "sub" ? [it.label, ...subLabels(it.children)] : []));
const sendOf = (it: Item) => it.action ?? it.label;

/** What the palette reads, and the menus whose items need a right-clicked row. */
const READ = [...Object.values(MENUS), CONTEXT_FILE, CONTEXT_EMPTY, PALETTE_ONLY];
const TARGET_MENUS = [
  CONTEXT_SIDEBAR, CONTEXT_SIDEBAR_FOLDER, CONTEXT_SIDEBAR_FILE, CONTEXT_SIDEBAR_DRIVE,
  CONTEXT_SIDEBAR_REMOTE, CONTEXT_TAB, CONTEXT_BREADCRUMB,
];
const READ_SENDS = new Set(READ.flatMap(items).filter(it => !it.payload).map(sendOf));
const SENT = PALETTE_ENTRIES.map(e => e.send);

const commandOf = (label: string) => SAME_COMMAND[label] ?? label;
/** The row that runs `send`'s command. */
const entryOf = (send: string): PaletteEntry | undefined =>
  PALETTE_ENTRIES.find(e => commandOf(e.send) === commandOf(send));
const top = (q: string) => searchPalette(q)[0];

describe("palette entries", () => {
  it("cover every command of the menus they're built from", () => {
    const missing = [...READ_SENDS].filter(s => s !== "Command Palette" && !entryOf(s));
    expect(missing).toEqual([]);
    expect(PALETTE_ENTRIES.length).toBeGreaterThan(150);
  });

  it("send only what one of those menu items sends", () => {
    expect(SENT.filter(s => !READ_SENDS.has(s))).toEqual([]);
  });

  it("list each command once", () => {
    const commands = SENT.map(commandOf);
    expect(commands.filter((c, i) => commands.indexOf(c) !== i)).toEqual([]);
    // Same-label items in two menus are one row with one name.
    const extract = PALETTE_ENTRIES.filter(e => e.send === "Extract Here");
    expect(extract.map(e => e.names)).toEqual([[{ label: "Extract Here", where: ["Tools", "Extract"] }]]);
  });

  it("leave out submenu headers, group labels and the palette itself", () => {
    const headers = new Set(READ.flatMap(subLabels));
    expect(headers).toContain("Open With →");
    const names = PALETTE_ENTRIES.flatMap(e => e.names.map(n => n.label));
    expect(names.filter(n => headers.has(n))).toEqual([]);
    for (const n of ["PINNED", "RECENT", "Command Palette"]) expect(names).not.toContain(n);
  });

  it("leave out commands that need a right-clicked row", () => {
    const targetOnly = [...new Set(TARGET_MENUS.flatMap(items).map(sendOf))].filter(s => !READ_SENDS.has(s));
    expect(targetOnly).toEqual(expect.arrayContaining(["Open in New Tab", "Duplicate Tab", "Pin", "Connect", "Copy as Command"]));
    expect(SENT.filter(s => targetOnly.includes(s))).toEqual([]);
  });

  it("show where each name lives", () => {
    const folder = entryOf("Folder")!;
    expect(folder.names[0]).toEqual({ label: "Folder", where: ["File", "New"] });
    expect(folder.group).toBe("File");
    expect(entryOf("Add Tag…")!.names[0]).toEqual({ label: "Add Tag…", where: ["Selected items", "Tag"] });
    expect(entryOf("Find in Files")!.names[0]).toEqual({ label: "Find in Files", where: [] });
    // Terminal's "New Tab" is its own command; the row says where it is.
    expect(entryOf("New Terminal Tab")!.names).toEqual([{ label: "New Tab", where: ["Terminal"] }]);
    expect(entryOf("New Tab")!.names).toEqual([{ label: "New Tab", where: ["File"] }]);
  });

  it("merge labels that share a handler case", () => {
    // `case "A": case "B":` with nothing between run one body. One that
    // reads `label` (Desktop / Documents / … each open their own folder)
    // runs a command per label.
    const dir = new URL("./handlers/", import.meta.url);
    const stacked: string[][] = [];
    for (const f of readdirSync(dir)) {
      if (!f.endsWith(".ts") || f.endsWith(".test.ts")) continue;
      const src = readFileSync(new URL(f, dir), "utf8");
      for (const m of src.matchAll(/(?:case "[^"]+":\s*){2,}/g)) {
        const rest = src.slice(m.index! + m[0].length);
        const body = rest.slice(0, rest.search(/\n\s*(case "|default:)/));
        if (/\blabel\b/.test(body)) continue;
        stacked.push([...m[0].matchAll(/case "([^"]+)":/g)].map(c => c[1]));
      }
    }
    expect(stacked).toContainEqual(["Checksum SHA256", "Checksum (SHA256)"]);
    expect(stacked).not.toContainEqual(["Desktop", "Documents", "Downloads", "Pictures"]);
    for (const group of stacked) {
      const rows = new Set(group.filter(l => READ_SENDS.has(l)).map(entryOf));
      expect(rows.size, group.join(" / ")).toBeLessThanOrEqual(1);
    }
  });

  it("fold each SAME_COMMAND label into a real one", () => {
    const data = readFileSync(new URL("./data.ts", import.meta.url), "utf8");
    for (const [from, to] of Object.entries(SAME_COMMAND)) {
      expect(data, from).toContain(`label: "${from}"`);
      expect(data, to).toContain(`label: "${to}"`);
      // One step: what a label folds into doesn't fold again.
      expect(SAME_COMMAND[to], to).toBeUndefined();
      // Platform stripping removes both or neither.
      expect(READ_SENDS.has(from), from).toBe(READ_SENDS.has(to));
    }
    expect(entryOf("Tweaks")!.names.map(n => n.label)).toEqual(["Preferences…", "Tweaks"]);
    expect(entryOf("Git: Stage")).toBe(entryOf("Stage Selected"));
  });

  it("show the shortcut of every command a key runs", () => {
    for (const b of KEYMAP) {
      if (!b.send || b.when === "multi") continue;
      const e = entryOf(b.send);
      if (e) expect(e.kb, b.send).toBeDefined();
    }
    expect(entryOf("Find in Files")!.kb).toBe("Ctrl+Shift+F");
    expect(entryOf("Toggle Drawer")!.kb).toBe("Ctrl+`");
    expect(entryOf("Commit…")!.kb).toBe("Ctrl+G C");
    expect(entryOf("Prev Tab")!.kb).toBe("Ctrl+Shift+Tab");
    // A merged row takes a key from any of its names.
    expect(entryOf("Copy Path")!.kb).toBe("Ctrl+Shift+C");
  });
});

describe("buildPalette", () => {
  const tree: MenuItemDef[] = [
    { kind: "item", ic: "a", label: "One", kb: "Ctrl+1" },
    { kind: "sep" },
    { kind: "grouplabel", label: "GROUP" },
    { kind: "dynamic", source: "recent" },
    { kind: "item", label: "/some/path", payload: { type: "open-path", path: "/some/path" } },
    { kind: "sub", ic: "s", label: "Sub →", children: [
      { kind: "item", label: "Two", danger: true },
      { kind: "item", label: "Shown", action: "Sent" },
    ] },
    { kind: "item", label: "Command Palette" },
  ];

  it("keeps commands, with their menus, icons and flags", () => {
    expect(buildPalette([{ group: "G", menu: "Menu", items: tree }])).toEqual([
      { send: "One", names: [{ label: "One", where: ["Menu"] }], group: "G", kb: "Ctrl+1", ic: "a", danger: undefined },
      { send: "Two", names: [{ label: "Two", where: ["Menu", "Sub"] }], group: "G", kb: undefined, ic: "s", danger: true },
      { send: "Sent", names: [{ label: "Shown", where: ["Menu", "Sub"] }], group: "G", kb: undefined, ic: "s", danger: undefined },
    ]);
  });

  it("merges a label found again, keeping the first menu", () => {
    const again: MenuItemDef[] = [{ kind: "item", label: "One" }, { kind: "item", label: "Two", kb: "F9" }];
    const out = buildPalette([{ group: "G", menu: "Menu", items: tree }, { group: "H", menu: "Other", items: again }]);
    expect(out.map(e => [e.send, e.group, e.names.length, e.kb])).toEqual([
      ["One", "G", 1, "Ctrl+1"], ["Two", "G", 1, "F9"], ["Sent", "G", 1, undefined],
    ]);
  });
});

describe("searchPalette", () => {
  it("lists every entry in menu order for an empty query", () => {
    const rows = searchPalette("  ");
    expect(rows.map(r => r.send)).toEqual(SENT);
    // Groups don't interleave, so their headers each show once.
    const groups = rows.map(r => r.group).filter((g, i, a) => g !== a[i - 1]);
    expect(new Set(groups).size).toBe(groups.length);
    expect(groups.slice(0, 3)).toEqual(["File", "Edit", "Select"]);
  });

  it("finds a name together with its menus", () => {
    expect(top("new folder")).toMatchObject({ send: "Folder", label: "Folder", where: ["File", "New"], kb: "Ctrl+Shift+D" });
    expect(top("git commit").send).toBe("Commit…");
    expect(top("git push").send).toBe("Push");
    expect(top("zoom in").send).toBe("Zoom In");
    expect(top("add tag").send).toBe("Add Tag…");
  });

  it("ranks names that start with a query word first", () => {
    // fuzzyMatch alone put Git › Branches › Merge… above Switch Theme, and
    // Close Other Tabs above the Sort By items.
    expect(top("theme").send).toBe("Switch Theme →");
    expect(top("sort").where).toEqual(["View", "Sort By"]);
    expect(top("del").send).toBe("Delete Permanently");
    expect(top("git").where).toEqual(["Git"]);
    // A tie goes to the shorter name.
    expect(top("open").label).toBe("Open");
  });

  it("finds what the site's demo types", () => {
    // site/demo/scenes.ts: "hidden", Enter, then "find in", Enter.
    expect(top("hidden").send).toBe("Show Hidden Files");
    expect(top("find in").send).toBe("Find in Files");
  });

  it("shows the name that matched", () => {
    expect(top("tweaks")).toMatchObject({ label: "Tweaks", where: ["View"], send: "Preferences…" });
    expect(top("preferences")).toMatchObject({ label: "Preferences…", where: ["Edit"] });
    const rows = searchPalette("checksum");
    expect(rows.filter(r => r.send === "Checksum (SHA256)")).toHaveLength(1);
  });

  it("finds nothing for nonsense", () => {
    expect(searchPalette("qqzzxx")).toEqual([]);
  });
});

describe("paths", () => {
  it("offers to go to a typed path first", () => {
    for (const p of ["/usr/share", "~/src", "~", "C:\\Users", "D:/x"]) {
      expect(top(p), p).toEqual({ send: p, label: `Go to ${p}`, where: [], group: "" });
    }
    expect(top("  /tmp  ").send).toBe("/tmp");
  });

  it("doesn't for anything else", () => {
    for (const q of ["find", "src/app", "C:"]) {
      expect(searchPalette(q).filter(r => r.label.startsWith("Go to ")), q).toEqual([]);
    }
  });
});

describe("kbKeys", () => {
  it("splits a hint into keys", () => {
    expect(kbKeys("Ctrl+Shift+D")).toEqual(["Ctrl", "Shift", "D"]);
    expect(kbKeys("Ctrl+G S")).toEqual(["Ctrl", "G", "S"]);
    expect(kbKeys("Ctrl+=")).toEqual(["Ctrl", "="]);
    expect(kbKeys("Ctrl++")).toEqual(["Ctrl", "+"]);
    expect(kbKeys("*")).toEqual(["*"]);
  });
});
