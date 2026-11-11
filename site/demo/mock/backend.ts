// The demo's stand-in for the Rust backend: one handler per Tauri command the
// frontend calls, over the virtual filesystem. Unknown commands resolve to
// null, like a command that has nothing to report.
import { BASE_TIME, HOME, PINS, RECENT, REPO, SEED, TAGS } from "./content";
import { GitRepo } from "./git";
import { FakeShell } from "./shell";
import { Vfs, basename, join, parent, type VNode } from "./vfs";

type Args = Record<string, unknown>;
type Handler = (a: Args) => unknown;

export interface BackendHooks {
  /** Emit a Tauri event to the app (pty output, fs changes). */
  emit(event: string, payload: unknown): void;
  /** Show a note in the app for things the demo can't do (open a real app). */
  notice(message: string): void;
  /** Read a file served next to the demo as a data URL (image previews). */
  fetchDataUrl(url: string): Promise<string>;
  openExternal(url: string): void;
}

export function kindFromExt(ext: string, dir: boolean): string {
  if (dir) return "folder";
  switch (ext.toLowerCase()) {
    case "md": case "txt": case "log": case "env": case "gitignore": case "ini": case "toml": case "cfg":
      return "text";
    case "rs": case "py": case "js": case "ts": case "tsx": case "jsx": case "json": case "yaml": case "yml":
    case "go": case "c": case "cpp": case "h": case "hpp": case "java": case "cs": case "html": case "css":
    case "scss": case "sh": case "ps1":
      return "code";
    case "png": case "jpg": case "jpeg": case "gif": case "webp": case "svg": case "bmp": case "ico":
      return "img";
    case "zip": case "tar": case "gz": case "zst": case "7z": case "rar": case "xz": case "bz2":
      return "archive";
    case "exe": case "bat": case "cmd": case "msi":
      return "exec";
    default:
      return "bin";
  }
}

/** Like Rust's Path::extension: none for dotfiles such as ".bashrc". */
export function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(i + 1) : "";
}

export function entryOf(path: string, n: VNode) {
  const ext = n.dir ? "" : extOf(n.name);
  return {
    name: n.name,
    path,
    kind: kindFromExt(ext, n.dir),
    size: n.dir ? 0 : n.size ?? 0,
    modified_ms: n.mtime,
    hidden: n.name.startsWith("."),
    ext,
    is_symlink: false,
    lossy: false,
    git: n.git ?? null,
  };
}

function globToRegExp(glob: string): RegExp {
  const esc = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${esc}$`, "i");
}

function crc32(text: string): string {
  let c = ~0;
  for (const b of new TextEncoder().encode(text)) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ((~c) >>> 0).toString(16).padStart(8, "0");
}

function hexDump(bytes: Uint8Array): string {
  const lines: string[] = [];
  for (let off = 0; off < bytes.length; off += 16) {
    const row = bytes.slice(off, off + 16);
    const hex = [...row].map(b => b.toString(16).padStart(2, "0")).join(" ").padEnd(47);
    const ascii = [...row].map(b => (b >= 32 && b < 127 ? String.fromCharCode(b) : ".")).join("");
    lines.push(`${off.toString(16).padStart(8, "0")}  ${hex}  |${ascii}|`);
  }
  return lines.join("\n");
}

/** Deterministic stand-in bytes for files that have no text. */
function fakeBytes(n: VNode, len: number): Uint8Array {
  const out = new Uint8Array(len);
  let s = n.name.length * 2654435761;
  for (let i = 0; i < len; i++) {
    s = (s * 1103515245 + 12345) >>> 0;
    out[i] = s >>> 24;
  }
  return out;
}

function lineDiff(a: string, b: string, an: string, bn: string): string {
  const al = a.split("\n");
  const bl = b.split("\n");
  const out = [`--- ${an}`, `+++ ${bn}`, `@@ -1,${al.length} +1,${bl.length} @@`];
  const max = Math.max(al.length, bl.length);
  for (let i = 0; i < max; i++) {
    if (al[i] === bl[i]) out.push(` ${al[i] ?? ""}`);
    else {
      if (al[i] !== undefined) out.push(`-${al[i]}`);
      if (bl[i] !== undefined) out.push(`+${bl[i]}`);
    }
  }
  return out.join("\n");
}

export function createBackend(hooks: BackendHooks) {
  const started = Date.now();
  // Clock: starts at the seed's base time and runs in real time from there.
  const now = () => BASE_TIME + (Date.now() - started);
  const vfs = new Vfs(SEED, BASE_TIME);
  const repo = new GitRepo(vfs, REPO);
  const trash = `${HOME}/.local/share/Trash/files`;
  let pins = [...PINS];
  let tags: Record<string, string[]> = structuredClone(TAGS);
  let recent = [...RECENT];
  const shells = new Map<string, FakeShell>();
  let nextSession = 1;

  const must = (p: string) => {
    const n = vfs.get(p);
    if (!n) throw `No such file or directory (os error 2): ${p}`;
    return n;
  };
  const changed = (dir: string) => hooks.emit("fs-changed", dir);
  const str = (v: unknown) => String(v ?? "");
  const notInDemo = (what: string) => () => { hooks.notice(`${what} isn't available in the browser demo.`); return null; };

  const handlers: Record<string, Handler> = {
    home_dir: () => HOME,
    list_dir: a => {
      const p = str(a.path);
      return vfs.list(p)
        .filter(n => a.showHidden || !n.name.startsWith("."))
        .map(n => entryOf(join(p, n.name), n))
        .sort((x, y) => (x.kind === "folder") === (y.kind === "folder")
          ? x.name.toLowerCase().localeCompare(y.name.toLowerCase())
          : x.kind === "folder" ? -1 : 1);
    },
    drives: () => [
      { letter: "/", label: "", total: 512e9, free: 301e9, fs: "ext4" },
      { letter: "/boot/efi", label: "", total: 536e6, free: 498e6, fs: "vfat" },
      { letter: "/mnt/data", label: "data", total: 2e12, free: 1.1e12, fs: "btrfs" },
    ],
    list_wsl_distros: () => [],
    path_fs_type: a => (str(a.path).startsWith("/boot/efi") ? "vfat" : str(a.path).startsWith("/mnt/data") ? "btrfs" : "ext4"),
    system_info: () => {
      const t = (Date.now() - started) / 1000;
      return {
        cpu_pct: 4 + 3 * Math.abs(Math.sin(t / 7)),
        mem_pct: 37 + Math.sin(t / 30),
        mem_used: 5.9e9,
        mem_total: 16e9,
        uptime_s: 9_740 + Math.floor(t),
        host: "glasshouse",
      };
    },
    net_rate: () => {
      const t = (Date.now() - started) / 1000;
      return { down_bps: 24_000 + 20_000 * Math.abs(Math.sin(t / 3)), up_bps: 3_000 + 2_000 * Math.abs(Math.cos(t / 5)) };
    },
    trash_dir: () => trash,
    win_to_wsl: a => a.path,
    watch_dir: () => null,
    unwatch_dir: () => null,

    read_text: a => {
      const n = must(str(a.path));
      if (n.dir) throw `Is a directory (os error 21)`;
      if (n.text === undefined) throw `stream did not contain valid UTF-8`;
      const max = Number(a.maxBytes) || 0;
      return max > 0 ? n.text.slice(0, max) : n.text;
    },
    read_image_b64: a => {
      const n = must(str(a.path));
      if (!n.asset) throw "this file has no preview in the demo";
      return hooks.fetchDataUrl(n.asset);
    },
    read_hex_dump: a => {
      const n = must(str(a.path));
      const len = Math.min(Number(a.length) || 512, 4096);
      const bytes = n.text !== undefined ? new TextEncoder().encode(n.text).slice(0, len) : fakeBytes(n, Math.min(len, n.size ?? len));
      return hexDump(bytes);
    },
    file_stat_extended: a => {
      const n = must(str(a.path));
      return { created_ms: n.mtime - 86_400_000, modified_ms: n.mtime, owner: "demo", file_index: null, readonly: false, is_symlink: false, symlink_target: null };
    },
    hash_sha256: async a => {
      const n = must(str(a.path));
      const data = new TextEncoder().encode(n.text ?? n.name + n.size);
      const d = await crypto.subtle.digest("SHA-256", data);
      return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, "0")).join("");
    },
    hash_md5: a => crc32(str(a.path)).repeat(4),
    hash_crc32: a => { const n = must(str(a.path)); return crc32(n.text ?? n.name); },
    // Demo hashes, copies and searches finish at once, so there's nothing to cancel.
    cancel_op: () => null,
    diff_files: a => {
      const x = must(str(a.a));
      const y = must(str(a.b));
      return lineDiff(x.text ?? "", y.text ?? "", str(a.a), str(a.b));
    },
    verify_signature: () => "No signature information (the demo has no real files).",

    make_dir: a => { const p = str(a.path); vfs.mkdir(p, now()); changed(parent(p)); return null; },
    write_text: a => { const p = str(a.path); vfs.write(p, str(a.content), now()); changed(parent(p)); return null; },
    rename_entry: a => {
      const from = str(a.from);
      const to = str(a.to);
      if (vfs.exists(to)) throw `${to} already exists`;
      vfs.transfer(from, to, true, now());
      changed(parent(from));
      return null;
    },
    copy_entry: a => { const to = str(a.to); vfs.transfer(str(a.from), to, false, now()); changed(parent(to)); return null; },
    move_entry: a => {
      const from = str(a.from);
      const to = str(a.to);
      vfs.transfer(from, to, true, now());
      changed(parent(from));
      changed(parent(to));
      return null;
    },
    delete_entry: a => { const p = str(a.path); vfs.remove(p); changed(parent(p)); return null; },
    shred: a => { const p = str(a.path); vfs.remove(p); changed(parent(p)); return null; },
    move_to_trash: a => {
      const p = str(a.path);
      let dst = join(trash, basename(p));
      for (let i = 2; vfs.exists(dst); i++) dst = join(trash, `${basename(p)}.${i}`);
      vfs.transfer(p, dst, true, now());
      changed(parent(p));
      return null;
    },
    create_symlink: a => { const p = str(a.linkPath); vfs.write(p, `-> ${str(a.target)}\n`, now()); changed(parent(p)); return null; },
    create_hard_link: a => { vfs.transfer(str(a.target), str(a.linkPath), false, now()); changed(parent(str(a.linkPath))); return null; },
    create_shortcut: a => { const p = str(a.linkPath); vfs.write(p, `[Desktop Entry]\nExec=${str(a.target)}\n`, now()); changed(parent(p)); return null; },
    set_permissions: () => null,
    change_owner: () => null,

    archive_can_handle: () => true,
    archive_create: a => {
      const dest = str(a.dest);
      const paths = (a.paths as string[]) ?? [];
      const size = paths.reduce((s, p) => s + (vfs.get(p)?.size ?? 4096), 0);
      vfs.write(dest, "", now());
      const n = vfs.get(dest)!;
      delete n.text;
      n.size = Math.max(1024, Math.round(size * 0.6));
      changed(parent(dest));
      return null;
    },
    archive_extract: a => {
      const archive = str(a.archive);
      const dest = str(a.destDir);
      const stem = basename(archive).replace(/\.(tar\.gz|tar\.zst|zip|7z|gz|zst)$/i, "");
      const dir = join(dest, stem);
      if (!vfs.exists(dir)) vfs.mkdir(dir, now());
      vfs.write(join(dir, "README.txt"), `Extracted from ${basename(archive)} (demo content).\n`, now());
      vfs.write(join(dir, "data.csv"), "id,name,value\n1,alpha,0.42\n2,beta,0.17\n3,gamma,0.93\n", now());
      changed(dest);
      return null;
    },

    find_in_files: a => {
      const q = str(a.query);
      const ci = !!a.caseInsensitive;
      const max = Number(a.maxResults) || 200;
      const needle = ci ? q.toLowerCase() : q;
      const out: Array<{ path: string; line_no: number; line: string }> = [];
      for (const [p, n] of vfs.walk(str(a.root))) {
        if (n.dir || n.text === undefined || p.includes("/.git/")) continue;
        n.text.split("\n").forEach((line, i) => {
          if (out.length < max && (ci ? line.toLowerCase() : line).includes(needle)) out.push({ path: p, line_no: i + 1, line });
        });
      }
      return out;
    },
    find_file_by_name: a => {
      const re = globToRegExp(str(a.pattern).includes("*") || str(a.pattern).includes("?") ? str(a.pattern) : `*${str(a.pattern)}*`);
      const max = Number(a.maxResults) || 500;
      const out: string[] = [];
      for (const [p, n] of vfs.walk(str(a.root))) {
        if (out.length < max && re.test(n.name) && !p.includes("/.git")) out.push(p);
      }
      return out;
    },

    git_status: a => {
      const p = str(a.path);
      if (!vfs.repoOf(p)) return null;
      const changes = repo.changes();
      return {
        repo_root: REPO + "/",
        branch: repo.branch,
        ahead: repo.ahead,
        behind: 0,
        dirty: changes.length,
        status: Object.fromEntries(changes),
      };
    },
    git_branch_list: a => {
      if (!vfs.repoOf(str(a.cwd))) throw "not a git repository";
      return repo.branches.map(name => ({
        name,
        current: name === repo.branch,
        upstream: name === "main" ? "origin/main" : null,
        ahead: name === repo.branch ? repo.ahead : 0,
        behind: 0,
      }));
    },
    git_file_info: a => {
      const p = str(a.path);
      if (!vfs.repoOf(p)) return null;
      const n = vfs.get(p);
      if (n?.git === "?") return { last_commit_ago: null, author: null, sha: null, added: 0, removed: 0 };
      const c = repo.commits[(p.length * 7) % repo.commits.length];
      const hours = Math.max(1, Math.round((now() - c.when) / 3600_000));
      return {
        last_commit_ago: hours < 24 ? `${hours} hours ago` : `${Math.round(hours / 24)} days ago`,
        author: c.author,
        sha: c.sha,
        added: n?.git === "M" ? 6 : 0,
        removed: n?.git === "M" ? 2 : 0,
      };
    },
    git_blame: a => {
      const n = must(str(a.path));
      const lines = (n.text ?? "").split("\n");
      if (lines[lines.length - 1] === "") lines.pop();
      const max = Number(a.maxLines) || lines.length;
      return lines.slice(0, max).map((content, i) => {
        const c = repo.commits[Math.floor(i / 4) % repo.commits.length];
        return { line_no: i + 1, sha: c.sha, author: c.author, content, timestamp_ms: c.when };
      });
    },
    git_stage: a => {
      for (const p of (a.paths as string[]) ?? []) {
        const n = vfs.get(p);
        if (n && (n.git === "?" || n.git === "M")) n.git = "A";
      }
      changed(REPO);
      return null;
    },
    git_unstage: a => {
      for (const p of (a.paths as string[]) ?? []) {
        const n = vfs.get(p);
        if (n?.git === "A") n.git = "M";
      }
      changed(REPO);
      return null;
    },
    git_discard: a => {
      // Like the real one: untracked items go (to the trash, there), staged
      // new files stay, and the rest go back to the last commit.
      const res = { restored: 0, trashed: 0, skipped: [] as Array<{ path: string; reason: string }> };
      for (const p of (a.paths as string[]) ?? []) {
        const n = vfs.get(p);
        if (n?.git === "?") { vfs.remove(p); res.trashed++; }
        else if (n?.git === "A") {
          res.skipped.push({ path: p.slice(REPO.length + 1), reason: "staged but never committed; unstage it first" });
        } else if (n?.git) { delete n.git; res.restored++; }
      }
      changed(REPO);
      return res;
    },
    git_run: a => {
      const cwd = str(a.cwd);
      if (!vfs.repoOf(cwd)) return { ok: false, stdout: "", stderr: "fatal: not a git repository\n", exit: 128 };
      const r = repo.run((a.args as string[]) ?? [], now());
      changed(cwd);
      return { ...r, exit: r.ok ? 0 : 1 };
    },

    read_pins: () => pins,
    write_pins: a => { pins = (a.pins as string[]) ?? []; return null; },
    read_tags: () => tags,
    write_tags: a => { tags = (a.tags as Record<string, string[]>) ?? {}; return null; },
    read_recent: () => recent,
    append_recent: a => { const p = str(a.path); recent = [p, ...recent.filter(r => r !== p)].slice(0, 20); return null; },
    clear_recent: () => { recent = []; return null; },

    list_shell_profiles: () => [
      { id: "shell:bash", label: "bash", kind: "shell", exec: "/usr/bin/bash", args: [] },
      { id: "shell:zsh", label: "zsh", kind: "shell", exec: "/usr/bin/zsh", args: [] },
      { id: "shell:fish", label: "fish", kind: "shell", exec: "/usr/bin/fish", args: [] },
      { id: "ssh:homelab", label: "SSH: homelab", kind: "ssh", exec: "ssh", args: ["homelab"] },
    ],
    pty_spawn: a => {
      const id = `demo-${nextSession++}`;
      const sh = new FakeShell(
        { vfs, repo, now, changed },
        str(a.cwd) || HOME,
        data => hooks.emit("pty-data", { session_id: id, data }),
      );
      shells.set(id, sh);
      setTimeout(() => sh.start(), 30);
      return id;
    },
    pty_write: a => { shells.get(str(a.sessionId))?.write(str(a.data)); return null; },
    pty_resize: () => null,
    pty_kill: a => {
      const id = str(a.sessionId);
      if (shells.delete(id)) hooks.emit("pty-exit", { session_id: id, exit_code: 0 });
      return null;
    },
    run_script: a => `ran "${str(a.script)}" on ${((a.targets as string[]) ?? []).length} item(s) (simulated in the demo)\n`,

    open_url: a => { hooks.openExternal(str(a.url)); return null; },
    open_with_default: notInDemo("Opening files in other apps"),
    reveal_in_explorer: notInDemo("Revealing files in another file manager"),
    spawn_terminal: notInDemo("Opening an external terminal"),
    spawn_terminal_profile: notInDemo("Opening an external terminal"),
    spawn_vscode: notInDemo("Opening VS Code"),
    spawn_new_window: notInDemo("Opening a second window"),

    "plugin:app|version": () => __DEMO_VERSION__,
    "plugin:app|name": () => "glasshouse",
    "plugin:app|tauri_version": () => "2",
    "plugin:dialog|open": () => null,
  };

  async function invoke(cmd: string, args: Args = {}): Promise<unknown> {
    const h = handlers[cmd];
    if (!h) {
      if (cmd.startsWith("plugin:window|is_")) return false;
      return null;
    }
    try {
      return await h(args);
    } catch (e) {
      // The real backend rejects with a plain string.
      throw e instanceof Error ? e.message : e;
    }
  }

  /** The newest open shell, which the scenes type into. */
  const latestShell = () => [...shells.values()].pop();

  return {
    invoke,
    vfs,
    repo,
    now,
    typeIntoShell: (data: string) => latestShell()?.write(data),
    shellReady: () => !!latestShell()?.started,
  };
}
