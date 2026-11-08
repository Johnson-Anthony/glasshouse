// In-memory filesystem behind the demo's mocked backend. POSIX paths only:
// the demo always presents the Linux flavor of the app.

export type GitCode = "M" | "A" | "D" | "U" | "?";

export interface VNode {
  name: string;
  dir: boolean;
  /** Text content; files without it (images, archives) report `size`. */
  text?: string;
  /** URL of a real file served next to the demo, for image previews. */
  asset?: string;
  size?: number;
  mtime: number;
  git?: GitCode;
  children?: Map<string, VNode>;
}

/** Seed format: a folder is an object, a file is a string (its text) or a
 *  FileSeed. Keys ending in "/" are folders too, so empty ones can be written
 *  as `"name/": {}`. */
export interface FileSeed {
  text?: string;
  asset?: string;
  size?: number;
  git?: GitCode;
  /** Minutes before the seed's base time. */
  age?: number;
}
export type Seed = { [name: string]: Seed | string | FileSeed };

const isFileSeed = (v: unknown): v is FileSeed =>
  typeof v === "object" && v !== null &&
  ("text" in v || "asset" in v || "size" in v || "git" in v || "age" in v);

export function split(path: string): string[] {
  return path.split("/").filter(Boolean);
}

export function join(...parts: string[]): string {
  return "/" + parts.flatMap(split).join("/");
}

export function parent(path: string): string {
  const p = split(path);
  p.pop();
  return "/" + p.join("/");
}

export function basename(path: string): string {
  const p = split(path);
  return p[p.length - 1] ?? "";
}

export class Vfs {
  readonly root: VNode;

  constructor(seed: Seed, private baseTime: number) {
    this.root = { name: "", dir: true, mtime: baseTime, children: new Map() };
    this.plant(this.root, seed, 0);
  }

  private plant(into: VNode, seed: Seed, depth: number): void {
    let i = 0;
    for (const [rawName, value] of Object.entries(seed)) {
      const name = rawName.replace(/\/$/, "");
      // Spread mtimes out a little so sorting by date is interesting.
      const jitter = (depth * 7 + i++ * 13) % 240;
      if (typeof value === "string" || isFileSeed(value)) {
        const f: FileSeed = typeof value === "string" ? { text: value } : value;
        into.children!.set(name, {
          name,
          dir: false,
          text: f.text,
          asset: f.asset,
          size: f.size ?? (f.text !== undefined ? new TextEncoder().encode(f.text).length : 0),
          mtime: this.baseTime - (f.age ?? jitter + 30) * 60_000,
          git: f.git,
        });
      } else {
        const d: VNode = {
          name,
          dir: true,
          mtime: this.baseTime - (jitter + 600) * 60_000,
          children: new Map(),
        };
        into.children!.set(name, d);
        this.plant(d, value, depth + 1);
      }
    }
  }

  get(path: string): VNode | null {
    let node: VNode | undefined = this.root;
    for (const part of split(path)) {
      if (!node?.dir) return null;
      node = node.children!.get(part);
    }
    return node ?? null;
  }

  exists(path: string): boolean {
    return this.get(path) !== null;
  }

  private dirOf(path: string): VNode {
    const d = this.get(parent(path));
    if (!d || !d.dir) throw new Error(`No such file or directory (os error 2): ${parent(path)}`);
    return d;
  }

  list(path: string): VNode[] {
    const d = this.get(path);
    if (!d) throw new Error(`No such file or directory (os error 2): ${path}`);
    if (!d.dir) throw new Error(`Not a directory (os error 20): ${path}`);
    return [...d.children!.values()];
  }

  mkdir(path: string, now: number): void {
    const d = this.dirOf(path);
    const name = basename(path);
    if (d.children!.has(name)) throw new Error(`File exists (os error 17): ${path}`);
    d.children!.set(name, { name, dir: true, mtime: now, children: new Map(), git: this.untracked(path) });
    d.mtime = now;
  }

  write(path: string, text: string, now: number): void {
    const d = this.dirOf(path);
    const name = basename(path);
    const old = d.children!.get(name);
    if (old?.dir) throw new Error(`Is a directory (os error 21): ${path}`);
    d.children!.set(name, {
      name,
      dir: false,
      text,
      size: new TextEncoder().encode(text).length,
      mtime: now,
      git: old ? (old.git ?? "M") : this.untracked(path),
    });
    d.mtime = now;
  }

  remove(path: string): VNode {
    const d = this.dirOf(path);
    const name = basename(path);
    const node = d.children!.get(name);
    if (!node) throw new Error(`No such file or directory (os error 2): ${path}`);
    d.children!.delete(name);
    return node;
  }

  /** Copy (deep) or move `from` to `to`. Refuses same-path and into-itself,
   *  like the real backend; overwrites an existing destination. */
  transfer(from: string, to: string, move: boolean, now: number): void {
    const src = this.get(from);
    if (!src) throw new Error(`No such file or directory (os error 2): ${from}`);
    if (from === to) throw new Error("source and destination are the same path");
    if (src.dir && (to + "/").startsWith(from + "/")) {
      throw new Error("cannot copy or move a folder into itself");
    }
    const dst = this.dirOf(to);
    const node = move ? this.remove(from) : clone(src, now);
    node.name = basename(to);
    if (!move) node.git = this.untracked(to);
    dst.children!.set(node.name, node);
    dst.mtime = now;
  }

  /** "?" when `path` is inside the demo repo, so new files show as untracked. */
  untracked(path: string): GitCode | undefined {
    return this.repoOf(path) ? "?" : undefined;
  }

  repoRoots: string[] = [];

  repoOf(path: string): string | null {
    return this.repoRoots.find(r => path === r || path.startsWith(r + "/")) ?? null;
  }

  /** Every file under `path` (depth-first), for search commands. */
  *walk(path: string): Generator<[string, VNode]> {
    const n = this.get(path);
    if (!n) return;
    if (!n.dir) { yield [path, n]; return; }
    for (const c of n.children!.values()) {
      const p = join(path, c.name);
      yield [p, c];
      if (c.dir) yield* this.walk(p);
    }
  }
}

function clone(n: VNode, now: number): VNode {
  return {
    ...n,
    mtime: now,
    children: n.children
      ? new Map([...n.children].map(([k, v]) => [k, clone(v, now)]))
      : undefined,
  };
}
