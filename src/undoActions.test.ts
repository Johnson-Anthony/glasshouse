import { beforeEach, describe, expect, it } from "vitest";
import type { FileEntry } from "./api";
import { pushUndo, redoLast, redoStack, undoLast, undoStack, type UndoEntry } from "./state";
import { copyUndo, createUndo, moveUndo, type UndoFs } from "./undoActions";

// In-memory POSIX file system. Like the real backend, rename/move and write
// replace whatever is at the destination; the builders' guards are what keep
// undo and redo from clobbering things. Every write, mkdir and copy gets a
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
