import { beforeEach, describe, expect, it } from "vitest";
import type { FileEntry } from "./api";
import { pushUndo, redoLast, redoStack, undoLast, undoStack, type UndoEntry } from "./state";
import { orderRenames, runRenameSteps, type RenameStep } from "./names";
import {
  contentUndo, copyUndo, createUndo, emptyFolderUndo, groupUndo, madeUndo, moveUndo, renameStepsUndo, type UndoFs,
} from "./undoActions";

// In-memory POSIX file system. Unlike the real backend, which refuses a taken
// destination, rename/move and write here replace whatever is there, so the
// tests show that the builders' own guards keep undo and redo from
// clobbering things. Every write, mkdir and copy gets a
// new mtime from a counter; rename keeps it, as on disk.
type Node = ({ kind: "dir" } | { kind: "file"; content: string }) & { mtime: number };

class MemFs implements UndoFs {
  clock = 0;
  nodes = new Map<string, Node>([["/", { kind: "dir", mtime: 0 }]]);

  constructor(init: Record<string, string | null> = {}) {
    for (const [p, content] of Object.entries(init)) {
      if (content === null) this.mkdirSync(p);
      else this.writeSync(p, content);
    }
  }

  private parentOf(p: string) { return p.slice(0, p.lastIndexOf("/")) || "/"; }
  private under(p: string) { return [...this.nodes.keys()].filter(k => k === p || k.startsWith(p + "/")); }
  private need(p: string) {
    const n = this.nodes.get(p);
    if (!n) throw new Error(`no such file: ${p}`);
    return n;
  }
  mkdirSync(p: string) {
    for (let cur = p; cur !== "/" && !this.nodes.has(cur); cur = this.parentOf(cur)) this.nodes.set(cur, { kind: "dir", mtime: ++this.clock });
  }
  writeSync(p: string, content: string) {
    this.mkdirSync(this.parentOf(p));
    this.nodes.set(p, { kind: "file", content, mtime: ++this.clock });
  }
  /** Snapshot as {path: content | null for folders}, for comparisons. */
  tree(): Record<string, string | null> {
    const out: Record<string, string | null> = {};
    for (const [k, n] of [...this.nodes].sort()) if (k !== "/") out[k] = n.kind === "file" ? n.content : null;
    return out;
  }

  async rename(from: string, to: string) {
    this.need(from);
    this.need(this.parentOf(to));
    const moved = this.under(from).map(k => [k, this.nodes.get(k)!] as const);
    for (const k of this.under(to)) this.nodes.delete(k);
    for (const [k] of moved) this.nodes.delete(k);
    for (const [k, n] of moved) this.nodes.set(to + k.slice(from.length), n);
  }
  async move(from: string, to: string) { await this.rename(from, to); }
  async copy(from: string, to: string) {
    this.need(from);
    for (const k of this.under(from)) this.nodes.set(to + k.slice(from.length), { ...this.nodes.get(k)!, mtime: ++this.clock });
  }
  async remove(p: string, recursive: boolean) {
    const n = this.need(p);
    const inside = this.under(p).filter(k => k !== p);
    if (n.kind === "dir" && inside.length > 0 && !recursive) throw new Error("Directory not empty");
    for (const k of this.under(p)) this.nodes.delete(k);
  }
  async mkdir(p: string) { this.mkdirSync(p); }
  async read(p: string) {
    const n = this.need(p);
    if (n.kind !== "file") throw new Error(`not a file: ${p}`);
    return n.content;
  }
  async overwrite(p: string, content: string) { this.need(p); this.nodes.set(p, { kind: "file", content, mtime: ++this.clock }); }
  async write(p: string, content: string) { this.need(this.parentOf(p)); this.nodes.set(p, { kind: "file", content, mtime: ++this.clock }); }
  async list(dir: string): Promise<FileEntry[]> {
    if (this.need(dir).kind !== "dir") throw new Error(`not a folder: ${dir}`);
    const prefix = dir === "/" ? "/" : dir + "/";
    return [...this.nodes]
      .filter(([k]) => k.startsWith(prefix) && k !== dir && !k.slice(prefix.length).includes("/"))
      .map(([k, n]) => ({
        name: k.slice(prefix.length), path: k, kind: n.kind === "dir" ? "folder" : "text",
        size: n.kind === "file" ? new TextEncoder().encode(n.content).length : 0,
        modified_ms: n.mtime, hidden: false, ext: "", is_symlink: false, lossy: false, git: null,
      }));
  }
}

beforeEach(() => {
  undoStack.length = 0;
  redoStack.length = 0;
});

/** Let copyUndo's background fingerprinting finish (MemFs is all
 *  microtasks), as it does in the app long before anyone edits a copy. */
const settle = () => new Promise(r => setTimeout(r, 0));

/** Push `entry` (the action has already been done on `fs`), then undo, redo
 *  and undo again, checking the tree after each step. */
async function roundTrip(fs: MemFs, entry: UndoEntry, before: Record<string, string | null>) {
  const after = fs.tree();
  pushUndo(entry);
  expect(await undoLast()).toEqual({ status: "done", label: entry.label });
  expect(fs.tree()).toEqual(before);
  expect(await redoLast()).toEqual({ status: "done", label: entry.label });
  expect(fs.tree()).toEqual(after);
  expect(await undoLast()).toEqual({ status: "done", label: entry.label });
  expect(fs.tree()).toEqual(before);
}

describe("moveUndo", () => {
  it("round-trips a rename", async () => {
    const fs = new MemFs({ "/d/a.txt": "A" });
    const before = fs.tree();
    await fs.rename("/d/a.txt", "/d/b.txt");
    await roundTrip(fs, moveUndo("rename", [{ src: "/d/a.txt", dst: "/d/b.txt" }], "rename", fs), before);
  });

  it("round-trips a multi-item move, folders included", async () => {
    const fs = new MemFs({ "/src/one.txt": "1", "/src/dir/inner.txt": "in", "/dst": null });
    const before = fs.tree();
    const items = [{ src: "/src/one.txt", dst: "/dst/one.txt" }, { src: "/src/dir", dst: "/dst/dir" }];
    for (const { src, dst } of items) await fs.move(src, dst);
    await roundTrip(fs, moveUndo("move", items, "move", fs), before);
  });

  it("undo refuses to overwrite something now at the old name", async () => {
    const fs = new MemFs({ "/d/a.txt": "A" });
    await fs.rename("/d/a.txt", "/d/b.txt");
    await fs.write("/d/a.txt", "new work");
    pushUndo(moveUndo("rename", [{ src: "/d/a.txt", dst: "/d/b.txt" }], "rename", fs));
    const r = await undoLast();
    expect(r.status).toBe("failed");
    expect(fs.tree()).toEqual({ "/d": null, "/d/a.txt": "new work", "/d/b.txt": "A" });
  });

  it("redo refuses to overwrite something now at the new name", async () => {
    const fs = new MemFs({ "/d/a.txt": "A" });
    await fs.rename("/d/a.txt", "/d/b.txt");
    pushUndo(moveUndo("rename", [{ src: "/d/a.txt", dst: "/d/b.txt" }], "rename", fs));
    await undoLast();
    await fs.write("/d/b.txt", "new work");
    const r = await redoLast();
    expect(r.status).toBe("failed");
    expect(fs.tree()).toEqual({ "/d": null, "/d/a.txt": "A", "/d/b.txt": "new work" });
  });
});

describe("copyUndo", () => {
  it("round-trips a copy of files and folders", async () => {
    const fs = new MemFs({ "/a/f.txt": "F", "/a/sub/g.txt": "G", "/b": null });
    const before = fs.tree();
    const items = [{ src: "/a/f.txt", dst: "/b/f.txt" }, { src: "/a/sub", dst: "/b/sub" }];
    for (const { src, dst } of items) await fs.copy(src, dst);
    await roundTrip(fs, copyUndo("paste copy", items, fs), before);
  });

  it("undo deletes nothing when a copied file was edited", async () => {
    const fs = new MemFs({ "/a/f.txt": "F", "/a/g.txt": "G", "/b": null });
    const items = [{ src: "/a/f.txt", dst: "/b/f.txt" }, { src: "/a/g.txt", dst: "/b/g.txt" }];
    for (const { src, dst } of items) await fs.copy(src, dst);
    pushUndo(copyUndo("paste", items, fs));
    await settle();
    await fs.write("/b/g.txt", "G and an afternoon of work");
    const r = await undoLast();
    expect(r.status).toBe("failed");
    expect(String((r as { error: unknown }).error)).toContain("g.txt has changed since it was copied");
    // the unchanged copy is kept too: the step is all or nothing
    expect(fs.tree()["/b/f.txt"]).toBe("F");
    expect(fs.tree()["/b/g.txt"]).toBe("G and an afternoon of work");
  });

  it("catches a same-size edit by its mtime", async () => {
    const fs = new MemFs({ "/a/f.txt": "abc", "/b": null });
    await fs.copy("/a/f.txt", "/b/f.txt");
    pushUndo(copyUndo("paste", [{ src: "/a/f.txt", dst: "/b/f.txt" }], fs));
    await settle();
    await fs.write("/b/f.txt", "xyz");
    expect((await undoLast()).status).toBe("failed");
    expect(fs.tree()["/b/f.txt"]).toBe("xyz");
  });

  it("undo deletes nothing when a copied folder gained a file", async () => {
    const fs = new MemFs({ "/a/dir/x.txt": "x", "/b": null });
    await fs.copy("/a/dir", "/b/dir");
    pushUndo(copyUndo("paste", [{ src: "/a/dir", dst: "/b/dir" }], fs));
    await settle();
    await fs.write("/b/dir/new.txt", "new work");
    expect((await undoLast()).status).toBe("failed");
    expect(fs.tree()["/b/dir/new.txt"]).toBe("new work");
  });

  it("undo deletes nothing when a file deep in a copied folder was edited", async () => {
    const fs = new MemFs({ "/a/dir/sub/deep.txt": "d", "/b": null });
    await fs.copy("/a/dir", "/b/dir");
    pushUndo(copyUndo("paste", [{ src: "/a/dir", dst: "/b/dir" }], fs));
    await settle();
    await fs.write("/b/dir/sub/deep.txt", "edited");
    expect((await undoLast()).status).toBe("failed");
    expect(fs.tree()["/b/dir/sub/deep.txt"]).toBe("edited");
  });

  it("undo refuses when a copy was removed by hand", async () => {
    const fs = new MemFs({ "/a/f.txt": "F", "/a/g.txt": "G", "/b": null });
    const items = [{ src: "/a/f.txt", dst: "/b/f.txt" }, { src: "/a/g.txt", dst: "/b/g.txt" }];
    for (const { src, dst } of items) await fs.copy(src, dst);
    pushUndo(copyUndo("paste", items, fs));
    await settle();
    await fs.remove("/b/f.txt", false);
    const r = await undoLast();
    expect(String((r as { error: unknown }).error)).toContain("f.txt is no longer there");
    expect(fs.tree()["/b/g.txt"]).toBe("G");
  });

  it("re-fingerprints after redo, so an untouched redo can be undone", async () => {
    const fs = new MemFs({ "/a/f.txt": "F", "/b": null });
    await fs.copy("/a/f.txt", "/b/f.txt");
    pushUndo(copyUndo("paste", [{ src: "/a/f.txt", dst: "/b/f.txt" }], fs));
    await undoLast();
    await redoLast(); // the new copy has a new mtime
    expect((await undoLast()).status).toBe("done");
    await redoLast();
    await settle();
    await fs.write("/b/f.txt", "edited after the redo");
    expect((await undoLast()).status).toBe("failed");
    expect(fs.tree()["/b/f.txt"]).toBe("edited after the redo");
  });

  it("refuses a copied tree too large to fingerprint", async () => {
    const fs = new MemFs({ "/a/dir/1": "1", "/a/dir/2": "2", "/a/dir/3": "3", "/b": null });
    await fs.copy("/a/dir", "/b/dir");
    pushUndo(copyUndo("paste", [{ src: "/a/dir", dst: "/b/dir" }], fs, 2));
    const r = await undoLast();
    expect(String((r as { error: unknown }).error)).toContain("too large to check");
    expect(fs.tree()["/b/dir/1"]).toBe("1");
  });

  it("redo refuses to copy over a file that appeared since", async () => {
    const fs = new MemFs({ "/a/f.txt": "F", "/b": null });
    await fs.copy("/a/f.txt", "/b/f.txt");
    pushUndo(copyUndo("copy", [{ src: "/a/f.txt", dst: "/b/f.txt" }], fs));
    await undoLast();
    await fs.write("/b/f.txt", "someone else's");
    expect((await redoLast()).status).toBe("failed");
    expect(fs.tree()["/b/f.txt"]).toBe("someone else's");
  });
});

describe("createUndo", () => {
  it("round-trips a new folder", async () => {
    const fs = new MemFs({ "/d": null });
    const before = fs.tree();
    await fs.mkdir("/d/new");
    await roundTrip(fs, createUndo("new folder", "/d/new", { kind: "folder" }, fs), before);
  });

  it("round-trips a new file with content", async () => {
    const fs = new MemFs({ "/d": null });
    const before = fs.tree();
    const content = "#!/usr/bin/env bash\n";
    await fs.write("/d/s.sh", content);
    await roundTrip(fs, createUndo("new script", "/d/s.sh", { kind: "file", content }, fs), before);
  });

  it("undo won't delete a folder that has been filled since", async () => {
    const fs = new MemFs({ "/d": null });
    await fs.mkdir("/d/new");
    pushUndo(createUndo("new folder", "/d/new", { kind: "folder" }, fs));
    await fs.write("/d/new/work.txt", "hours of it");
    expect((await undoLast()).status).toBe("failed");
    expect(fs.tree()["/d/new/work.txt"]).toBe("hours of it");
  });

  it("undo won't delete a file that has been edited since", async () => {
    const fs = new MemFs({ "/d": null });
    await fs.write("/d/notes.md", "");
    pushUndo(createUndo("new note", "/d/notes.md", { kind: "file", content: "" }, fs));
    await fs.write("/d/notes.md", "# draft");
    expect((await undoLast()).status).toBe("failed");
    expect(fs.tree()["/d/notes.md"]).toBe("# draft");
  });

  it("redo won't recreate over a file that appeared since", async () => {
    const fs = new MemFs({ "/d": null });
    await fs.write("/d/x.txt", "");
    pushUndo(createUndo("new file", "/d/x.txt", { kind: "file", content: "" }, fs));
    await undoLast();
    await fs.write("/d/x.txt", "other");
    expect((await redoLast()).status).toBe("failed");
    expect(fs.tree()["/d/x.txt"]).toBe("other");
  });
});

describe("a chain of actions", () => {
  it("undoes everything in reverse and redoes it in order", async () => {
    const fs = new MemFs({ "/d/a.txt": "A" });
    const start = fs.tree();

    await fs.mkdir("/d/sub");
    pushUndo(createUndo("new folder", "/d/sub", { kind: "folder" }, fs));
    await fs.rename("/d/a.txt", "/d/b.txt");
    pushUndo(moveUndo("rename", [{ src: "/d/a.txt", dst: "/d/b.txt" }], "rename", fs));
    await fs.move("/d/b.txt", "/d/sub/b.txt");
    pushUndo(moveUndo("move", [{ src: "/d/b.txt", dst: "/d/sub/b.txt" }], "move", fs));
    const end = fs.tree();

    for (let i = 0; i < 3; i++) expect((await undoLast()).status).toBe("done");
    expect(fs.tree()).toEqual(start);
    for (let i = 0; i < 3; i++) expect((await redoLast()).status).toBe("done");
    expect(fs.tree()).toEqual(end);
  });

  it("queued steps run one after another", async () => {
    const fs = new MemFs({ "/d/a.txt": "A" });
    const start = fs.tree();
    await fs.rename("/d/a.txt", "/d/b.txt");
    pushUndo(moveUndo("a→b", [{ src: "/d/a.txt", dst: "/d/b.txt" }], "rename", fs));
    await fs.rename("/d/b.txt", "/d/c.txt");
    pushUndo(moveUndo("b→c", [{ src: "/d/b.txt", dst: "/d/c.txt" }], "rename", fs));
    // Two presses without waiting: the second must see the first's result.
    const [r1, r2] = await Promise.all([undoLast(), undoLast()]);
    expect([r1.status, r2.status]).toEqual(["done", "done"]);
    expect(fs.tree()).toEqual(start);
  });
});

/** Bulk-rename steps in `dir` for `moves`, ordered as the dialog orders them. */
function renameSteps(fs: MemFs, dir: string, moves: Array<[string, string]>): RenameStep[] {
  const names = Object.keys(fs.tree()).filter(k => k.startsWith(dir + "/")).map(k => k.slice(dir.length + 1)).filter(n => !n.includes("/"));
  return orderRenames(moves.map(([from, to]) => ({ from, to })), names, false).map(m => ({ dir, ...m }));
}

/** Run `steps` on `fs` the way the dialog does, expecting them to succeed. */
async function runSteps(fs: MemFs, steps: RenameStep[]) {
  expect((await runRenameSteps(steps, (from, to) => fs.rename(from, to))).ok).toBe(true);
}

describe("renameStepsUndo", () => {
  it("round-trips a swap through a temporary name", async () => {
    const fs = new MemFs({ "/d/a": "A", "/d/b": "B" });
    const before = fs.tree();
    const steps = renameSteps(fs, "/d", [["a", "b"], ["b", "a"]]);
    expect(steps.some(s => s.to.includes("~rename"))).toBe(true);
    await runSteps(fs, steps);
    expect(fs.tree()).toEqual({ "/d": null, "/d/a": "B", "/d/b": "A" });
    await roundTrip(fs, renameStepsUndo("swap", steps, fs, false), before);
  });

  it("round-trips a chain and a rotation across two folders", async () => {
    const fs = new MemFs({ "/x/1": "one", "/x/2": "two", "/y/p": "P", "/y/q": "Q", "/y/r": "R" });
    const before = fs.tree();
    const steps = [
      ...renameSteps(fs, "/x", [["1", "2"], ["2", "3"]]),
      ...renameSteps(fs, "/y", [["p", "q"], ["q", "r"], ["r", "p"]]),
    ];
    await runSteps(fs, steps);
    expect(fs.tree()).toEqual({ "/x": null, "/x/2": "one", "/x/3": "two", "/y": null, "/y/p": "R", "/y/q": "P", "/y/r": "Q" });
    await roundTrip(fs, renameStepsUndo("bulk rename", steps, fs, false), before);
  });

  it("undo renames nothing when an old name has been taken since", async () => {
    const fs = new MemFs({ "/d/a.txt": "A", "/d/c.txt": "C" });
    const steps = renameSteps(fs, "/d", [["a.txt", "b.txt"], ["c.txt", "d.txt"]]);
    await runSteps(fs, steps);
    // Undo runs d→c first, then b→a, which is now blocked: checked up front,
    // so d→c doesn't run either.
    await fs.write("/d/a.txt", "new work");
    const after = fs.tree();
    pushUndo(renameStepsUndo("bulk rename", steps, fs, false));
    const r = await undoLast();
    expect(r.status).toBe("failed");
    expect(String((r as { error: unknown }).error)).toContain(`"a.txt" already exists in /d`);
    expect(fs.tree()).toEqual(after);
  });

  it("redo renames nothing when a source has gone since", async () => {
    const fs = new MemFs({ "/d/a": "A", "/d/b": "B" });
    const steps = renameSteps(fs, "/d", [["a", "a2"], ["b", "b2"]]);
    await runSteps(fs, steps);
    pushUndo(renameStepsUndo("bulk rename", steps, fs, false));
    await undoLast();
    await fs.remove("/d/b", false);
    const r = await redoLast();
    expect(String((r as { error: unknown }).error)).toContain(`"b" is no longer in /d`);
    expect(fs.tree()).toEqual({ "/d": null, "/d/a": "A" });
  });

  it("a rename that fails partway puts the ones before it back", async () => {
    const fs = new MemFs({ "/d/a": "A", "/d/b": "B" });
    const before = fs.tree();
    const steps = renameSteps(fs, "/d", [["a", "b"], ["b", "a"]]);
    await runSteps(fs, steps);
    const after = fs.tree();
    // The swap's undo is three renames; the last one fails.
    const flaky = { list: (d: string) => fs.list(d), rename: async (from: string, to: string) => {
      if (from.includes("~rename") && to === "/d/a") throw new Error("disk on fire");
      await fs.rename(from, to);
    } };
    pushUndo(renameStepsUndo("swap", steps, flaky, false));
    const r = await undoLast();
    expect(String((r as { error: unknown }).error)).toBe("Error: disk on fire (the renames before it were put back)");
    expect(fs.tree()).toEqual(after);
    expect(fs.tree()).not.toEqual(before);
  });
});

describe("madeUndo", () => {
  // MemFs has no links; a file holding its target stands in for one.
  const link = (fs: MemFs, target: string, at: string) => fs.write(at, `-> ${target}`);

  it("round-trips links made in a folder", async () => {
    const fs = new MemFs({ "/t/f": "F", "/t/g": "G", "/d": null });
    const before = fs.tree();
    const make = async () => { await link(fs, "/t/f", "/d/f"); await link(fs, "/t/g", "/d/g"); };
    await make();
    await roundTrip(fs, madeUndo("paste 2 symlink(s)", ["/d/f", "/d/g"], make, { verb: "created", fs }), before);
  });

  it("round-trips a folder with something in it (a python module)", async () => {
    const fs = new MemFs({ "/d": null });
    const before = fs.tree();
    const make = async () => { await fs.mkdir("/d/mod"); await fs.write("/d/mod/__init__.py", ""); };
    await make();
    await roundTrip(fs, madeUndo("new python module", ["/d/mod"], make, { verb: "created", fs }), before);
  });

  it("undo deletes nothing once a made folder has more in it", async () => {
    const fs = new MemFs({ "/d": null });
    const make = async () => { await fs.mkdir("/d/mod"); await fs.write("/d/mod/__init__.py", ""); };
    await make();
    pushUndo(madeUndo("new python module", ["/d/mod"], make, { verb: "created", fs }));
    await settle();
    await fs.write("/d/mod/core.py", "def main(): ...");
    const r = await undoLast();
    expect(String((r as { error: unknown }).error)).toContain("mod has changed since it was created");
    expect(fs.tree()["/d/mod/core.py"]).toBe("def main(): ...");
  });

  it("won't delete a hard link whose original is gone, and says why", async () => {
    const fs = new MemFs({ "/a/data.bin": "data", "/d": null });
    await fs.write("/d/data.bin", "data"); // the hard link
    pushUndo(madeUndo("paste 1 hard link(s)", ["/d/data.bin"], async () => {}, { verb: "created", needs: ["/a/data.bin"], fs }));
    await settle();
    await fs.remove("/a/data.bin", false);
    const r = await undoLast();
    expect(String((r as { error: unknown }).error)).toContain("data.bin is no longer there");
    expect(fs.tree()["/d/data.bin"]).toBe("data");
  });

  it("redo makes nothing over a path taken since", async () => {
    const fs = new MemFs({ "/t/f": "F", "/d": null });
    let made = 0;
    const make = async () => { made++; await link(fs, "/t/f", "/d/f"); };
    await make();
    pushUndo(madeUndo("symlink f", ["/d/f"], make, { verb: "created", fs }));
    await undoLast();
    await fs.write("/d/f", "someone else's");
    expect((await redoLast()).status).toBe("failed");
    expect(made).toBe(1);
    expect(fs.tree()["/d/f"]).toBe("someone else's");
  });
});

describe("contentUndo", () => {
  it("round-trips a replaced file", async () => {
    const fs = new MemFs({ "/d/.glasshouserc": "old" });
    const before = fs.tree();
    await fs.overwrite("/d/.glasshouserc", "new");
    await roundTrip(fs, contentUndo("export layout", "/d/.glasshouserc", "old", "new", fs), before);
  });

  it("undo won't overwrite an edit made since", async () => {
    const fs = new MemFs({ "/d/f": "old" });
    await fs.overwrite("/d/f", "new");
    pushUndo(contentUndo("export layout", "/d/f", "old", "new", fs));
    await fs.overwrite("/d/f", "new, edited");
    const r = await undoLast();
    expect(String((r as { error: unknown }).error)).toContain(`"f" has changed since`);
    expect(fs.tree()["/d/f"]).toBe("new, edited");
  });

  it("redo won't overwrite an edit made since the undo", async () => {
    const fs = new MemFs({ "/d/f": "old" });
    await fs.overwrite("/d/f", "new");
    pushUndo(contentUndo("export layout", "/d/f", "old", "new", fs));
    await undoLast();
    await fs.overwrite("/d/f", "old, edited");
    expect((await redoLast()).status).toBe("failed");
    expect(fs.tree()["/d/f"]).toBe("old, edited");
  });
});

describe("groupUndo with emptyFolderUndo (Screenshot Auto-sort)", () => {
  const items = [{ src: "/w/s1.png", dst: "/w/2026-11/s1.png" }, { src: "/w/s2.png", dst: "/w/2026-11/s2.png" }];
  const sort = async (fs: MemFs) => {
    await fs.mkdir("/w/2026-11");
    for (const { src, dst } of items) await fs.move(src, dst);
    return groupUndo("auto-sort 2 screenshot(s)", [
      emptyFolderUndo("make 2026-11", "/w/2026-11", fs),
      moveUndo("move into 2026-11", items, "move", fs),
    ]);
  };

  it("round-trips the moves and the month folder", async () => {
    const fs = new MemFs({ "/w/s1.png": "1", "/w/s2.png": "2" });
    const before = fs.tree();
    await roundTrip(fs, await sort(fs), before);
  });

  it("leaves the month folder when something else went into it, and redo uses it", async () => {
    const fs = new MemFs({ "/w/s1.png": "1", "/w/s2.png": "2" });
    pushUndo(await sort(fs));
    await fs.write("/w/2026-11/notes.txt", "mine");
    expect((await undoLast()).status).toBe("done");
    expect(fs.tree()).toEqual({ "/w": null, "/w/s1.png": "1", "/w/s2.png": "2", "/w/2026-11": null, "/w/2026-11/notes.txt": "mine" });
    expect((await redoLast()).status).toBe("done");
    expect(fs.tree()["/w/2026-11/s1.png"]).toBe("1");
    expect(fs.tree()["/w/2026-11/notes.txt"]).toBe("mine");
  });

  it("stops at the first part that fails", async () => {
    const log: string[] = [];
    const part = (name: string, fail = false): UndoEntry => ({
      label: name,
      inverse: () => { if (fail) throw new Error(`${name} failed`); log.push(`undo ${name}`); },
      redo: () => { log.push(`redo ${name}`); },
    });
    pushUndo(groupUndo("both", [part("first"), part("second", true)]));
    const r = await undoLast();
    expect(String((r as { error: unknown }).error)).toContain("second failed");
    expect(log).toEqual([]);
  });
});
