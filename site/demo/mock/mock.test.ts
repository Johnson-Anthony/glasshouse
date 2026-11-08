import { describe, expect, it } from "vitest";
import { createBackend, extOf, kindFromExt } from "./backend";
import { HOME, REPO } from "./content";
import { FakeShell, tokenize } from "./shell";
import { GitRepo } from "./git";
import { Vfs, basename, join, parent } from "./vfs";

const quietHooks = () => {
  const events: Array<[string, unknown]> = [];
  return {
    events,
    hooks: {
      emit: (e: string, p: unknown) => { events.push([e, p]); },
      notice: () => {},
      fetchDataUrl: async (u: string) => `data:image/jpeg;base64,${u}`,
      openExternal: () => {},
    },
  };
};

describe("vfs paths", () => {
  it("joins, splits and takes parents", () => {
    expect(join("/a/", "b", "/c")).toBe("/a/b/c");
    expect(parent("/a/b/c")).toBe("/a/b");
    expect(parent("/a")).toBe("/");
    expect(basename("/a/b.txt")).toBe("b.txt");
  });
});

describe("Vfs", () => {
  const make = () => new Vfs({ home: { u: { "a.txt": "hello", docs: { "b.md": "# b" }, "empty/": {} } } }, 1_000_000);

  it("seeds files and folders", () => {
    const v = make();
    expect(v.get("/home/u/a.txt")?.size).toBe(5);
    expect(v.get("/home/u/empty")?.dir).toBe(true);
    expect(v.list("/home/u").map(n => n.name).sort()).toEqual(["a.txt", "docs", "empty"]);
  });

  it("copies deeply and moves", () => {
    const v = make();
    v.transfer("/home/u/docs", "/home/u/docs2", false, 2);
    v.get("/home/u/docs2/b.md")!.text = "changed";
    expect(v.get("/home/u/docs/b.md")?.text).toBe("# b");
    v.transfer("/home/u/a.txt", "/home/u/empty/a.txt", true, 3);
    expect(v.exists("/home/u/a.txt")).toBe(false);
    expect(v.get("/home/u/empty/a.txt")?.text).toBe("hello");
  });

  it("refuses same-path and into-itself transfers, like the real backend", () => {
    const v = make();
    expect(() => v.transfer("/home/u/docs", "/home/u/docs", false, 2)).toThrow(/same path/);
    expect(() => v.transfer("/home/u/docs", "/home/u/docs/inner", true, 2)).toThrow(/into itself/);
  });

  it("errors like the OS for missing paths and clashes", () => {
    const v = make();
    expect(() => v.list("/nope")).toThrow(/os error 2/);
    expect(() => v.mkdir("/home/u/docs", 2)).toThrow(/os error 17/);
  });

  it("marks new files in a repo as untracked", () => {
    const v = make();
    v.repoRoots.push("/home/u/docs");
    v.write("/home/u/docs/new.md", "x", 2);
    v.write("/home/u/outside.md", "x", 2);
    expect(v.get("/home/u/docs/new.md")?.git).toBe("?");
    expect(v.get("/home/u/outside.md")?.git).toBeUndefined();
  });
});

describe("file kinds", () => {
  it("matches the Rust mapping", () => {
    expect(kindFromExt("md", false)).toBe("text");
    expect(kindFromExt("tsx", false)).toBe("code");
    expect(kindFromExt("JPG", false)).toBe("img");
    expect(kindFromExt("7z", false)).toBe("archive");
    expect(kindFromExt("AppImage", false)).toBe("bin");
    expect(kindFromExt("", true)).toBe("folder");
  });

  it("has no extension for dotfiles", () => {
    expect(extOf(".bashrc")).toBe("");
    expect(extOf("data.tar.gz")).toBe("gz");
  });
});

describe("GitRepo", () => {
  it("reports changes and commits them", () => {
    const v = new Vfs({ r: { "a.md": { text: "a", git: "M" }, "n.md": { text: "n", git: "?" } } }, 0);
    const g = new GitRepo(v, "/r");
    expect(g.statusText()).toContain("modified:   a.md");
    expect(g.statusText()).toContain("Untracked files:");
    const before = g.ahead;
    expect(g.commit("msg", 10)).toMatch(/1 file changed/);
    expect(g.ahead).toBe(before + 1);
    expect(v.get("/r/a.md")?.git).toBeUndefined();
    expect(v.get("/r/n.md")?.git).toBe("?");
    expect(() => g.commit("again", 11)).toThrow(/nothing to commit/);
  });

  it("switches and creates branches", () => {
    const g = new GitRepo(new Vfs({ r: {} }, 0), "/r");
    expect(g.run(["checkout", "nope"], 0).ok).toBe(false);
    expect(g.run(["checkout", "-b", "feature"], 0).ok).toBe(true);
    expect(g.branch).toBe("feature");
  });
});

describe("FakeShell", () => {
  it("tokenizes quotes like a shell", () => {
    expect(tokenize(`cd "/home/demo/My Files"`)).toEqual(["cd", "/home/demo/My Files"]);
    expect(tokenize(`echo 'a b' c ""`)).toEqual(["echo", "a b", "c", ""]);
  });

  const shell = () => {
    const { hooks } = quietHooks();
    const b = createBackend(hooks);
    let out = "";
    const sh = new FakeShell({ vfs: b.vfs, repo: b.repo, now: b.now, changed: () => {} }, REPO, d => { out += d; });
    return { sh, read: () => { const o = out; out = ""; return o; } };
  };

  it("follows the app's cd command and runs ls", () => {
    const { sh, read } = shell();
    sh.write(`cd "${HOME}/Downloads"\r`);
    expect(sh.cwd).toBe(`${HOME}/Downloads`);
    read();
    sh.write("ls\r");
    expect(read()).toContain("photos-2026-10.zip");
  });

  it("echoes keystrokes and handles backspace", () => {
    const { sh, read } = shell();
    sh.write("pwdx\x7f\r");
    expect(read()).toContain(`${REPO}\r\n`);
  });

  it("runs git in the repo only", () => {
    const { sh, read } = shell();
    sh.write("git status\r");
    expect(read()).toContain("On branch main");
    sh.write("cd ~\r");
    read();
    sh.write("git status\r");
    expect(read()).toContain("not a git repository");
  });

  it("says when a command isn't available", () => {
    const { sh, read } = shell();
    sh.write("vim\r");
    expect(read()).toContain("command not found");
  });
});

describe("backend", () => {
  it("lists folders first, hides dotfiles unless asked", async () => {
    const { hooks } = quietHooks();
    const b = createBackend(hooks);
    const rows = await b.invoke("list_dir", { path: REPO, showHidden: false }) as Array<{ name: string; kind: string; git: string | null }>;
    expect(rows[0].kind).toBe("folder");
    expect(rows.some(r => r.name.startsWith("."))).toBe(false);
    expect(rows.find(r => r.name === "README.md")?.git).toBe("M");
    const all = await b.invoke("list_dir", { path: REPO, showHidden: true }) as Array<{ name: string }>;
    expect(all.some(r => r.name === ".git")).toBe(true);
  });

  it("rejects with a string, like the Rust commands", async () => {
    const { hooks } = quietHooks();
    const b = createBackend(hooks);
    await expect(b.invoke("list_dir", { path: "/nope" })).rejects.toMatch(/os error 2/);
  });

  it("reports git status only inside the repo", async () => {
    const { hooks } = quietHooks();
    const b = createBackend(hooks);
    const info = await b.invoke("git_status", { path: `${REPO}/src` }) as { branch: string; dirty: number };
    expect(info.branch).toBe("main");
    expect(info.dirty).toBeGreaterThan(0);
    expect(await b.invoke("git_status", { path: HOME })).toBeNull();
  });

  it("copies, then announces the change", async () => {
    const { hooks, events } = quietHooks();
    const b = createBackend(hooks);
    await b.invoke("copy_entry", { from: `${HOME}/Downloads/aurora.jpg`, to: `${HOME}/Documents/aurora.jpg` });
    expect(b.vfs.exists(`${HOME}/Documents/aurora.jpg`)).toBe(true);
    expect(events).toContainEqual(["fs-changed", `${HOME}/Documents`]);
  });

  it("finds text and file names", async () => {
    const { hooks } = quietHooks();
    const b = createBackend(hooks);
    const hits = await b.invoke("find_in_files", { root: REPO, query: "TAURI", caseInsensitive: true, maxResults: 50 }) as Array<{ path: string }>;
    expect(hits.some(h => h.path.endsWith("README.md"))).toBe(true);
    const names = await b.invoke("find_file_by_name", { root: HOME, pattern: "*.jpg" }) as string[];
    expect(names.length).toBeGreaterThan(3);
  });

  it("returns null for commands it doesn't know", async () => {
    const { hooks } = quietHooks();
    expect(await createBackend(hooks).invoke("not_a_command")).toBeNull();
  });
});
