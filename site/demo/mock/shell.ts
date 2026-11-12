// A small pretend shell for the terminal drawer. It reads keystrokes the way
// a pty would (echo, backspace, Enter, Ctrl+C/L, history) and runs a handful
// of commands against the virtual filesystem.
import { HOME } from "./content";
import type { GitRepo } from "./git";
import { basename, join, parent, split, type Vfs } from "./vfs";

const C = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
};

export interface ShellHost {
  vfs: Vfs;
  repo: GitRepo;
  now(): number;
  /** Tell the app a folder changed (the real backend's watcher event). */
  changed(dir: string): void;
}

export function tokenize(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quote: string | null = null;
  let has = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (ch === quote) quote = null;
      else if (ch === "\\" && quote === '"' && i + 1 < line.length) cur += line[++i];
      else cur += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      has = true;
    } else if (ch === "\\" && i + 1 < line.length) {
      cur += line[++i];
    } else if (/\s/.test(ch)) {
      if (has || cur) out.push(cur);
      cur = "";
      has = false;
    } else {
      cur += ch;
    }
  }
  if (has || cur) out.push(cur);
  return out;
}

export class FakeShell {
  cwd: string;
  private line = "";
  private history: string[] = [];
  private hIndex = 0;
  private escape = "";

  constructor(private host: ShellHost, cwd: string, private out: (data: string) => void) {
    this.cwd = host.vfs.get(cwd)?.dir ? cwd : HOME;
  }

  started = false;

  start(): void {
    this.started = true;
    this.out(`${C.dim}glasshouse demo shell. Type ${C.reset}help${C.dim} to see the commands.${C.reset}\r\n`);
    this.prompt();
  }

  private tilde(p: string): string {
    return p === HOME ? "~" : p.startsWith(HOME + "/") ? "~" + p.slice(HOME.length) : p;
  }

  private prompt(): void {
    const repo = this.host.vfs.repoOf(this.cwd);
    const branch = repo ? ` ${C.magenta}(${this.host.repo.branch})${C.reset}` : "";
    this.out(`${C.green}${C.bold}demo@glasshouse${C.reset}:${C.blue}${C.bold}${this.tilde(this.cwd)}${C.reset}${branch}$ `);
  }

  write(data: string): void {
    for (const ch of data) {
      if (this.escape) {
        this.escape += ch;
        if (/[A-Za-z~]/.test(ch) && this.escape.length > 1) {
          this.onEscape(this.escape);
          this.escape = "";
        }
        continue;
      }
      if (ch === "\x1b") { this.escape = ch; continue; }
      if (ch === "\r" || ch === "\n") {
        this.out("\r\n");
        const line = this.line;
        this.line = "";
        if (line.trim()) {
          this.history.push(line);
          this.hIndex = this.history.length;
        }
        this.exec(line);
        this.prompt();
      } else if (ch === "\x7f" || ch === "\b") {
        if (this.line) {
          this.line = this.line.slice(0, -1);
          this.out("\b \b");
        }
      } else if (ch === "\x03") {
        this.line = "";
        this.out("^C\r\n");
        this.prompt();
      } else if (ch === "\x0c") {
        this.out("\x1b[2J\x1b[H");
        this.prompt();
        this.out(this.line);
      } else if (ch === "\t") {
        this.complete();
      } else if (ch >= " ") {
        this.line += ch;
        this.out(ch);
      }
    }
  }

  private onEscape(seq: string): void {
    if (seq !== "\x1b[A" && seq !== "\x1b[B") return;
    if (!this.history.length) return;
    this.hIndex = Math.max(0, Math.min(this.history.length, this.hIndex + (seq === "\x1b[A" ? -1 : 1)));
    const next = this.history[this.hIndex] ?? "";
    this.out("\b \b".repeat(this.line.length) + next);
    this.line = next;
  }

  private complete(): void {
    const m = this.line.match(/(\S*)$/);
    const word = m ? m[1] : "";
    const dirPart = word.includes("/") ? word.slice(0, word.lastIndexOf("/") + 1) : "";
    const stem = word.slice(dirPart.length);
    const dir = this.resolve(dirPart || ".");
    const node = this.host.vfs.get(dir);
    if (!node?.dir) return;
    const hits = [...node.children!.values()].filter(c => c.name.startsWith(stem) && (stem.startsWith(".") || !c.name.startsWith(".")));
    if (hits.length !== 1) return;
    const rest = hits[0].name.slice(stem.length) + (hits[0].dir ? "/" : " ");
    this.line += rest;
    this.out(rest);
  }

  resolve(p: string): string {
    if (p === "~" || p === "") return HOME;
    if (p.startsWith("~/")) p = HOME + p.slice(1);
    const parts = p.startsWith("/") ? [] : split(this.cwd);
    for (const s of split(p)) {
      if (s === ".") continue;
      if (s === "..") parts.pop();
      else parts.push(s);
    }
    return "/" + parts.join("/");
  }

  private println(s = ""): void {
    this.out(s.replace(/\n/g, "\r\n") + "\r\n");
  }

  exec(line: string): void {
    const [cmd, ...args] = tokenize(line.trim());
    if (!cmd) return;
    const vfs = this.host.vfs;
    const fail = (msg: string) => this.println(`${cmd}: ${msg}`);
    switch (cmd) {
      case "help":
        this.println(
          "This is a pretend shell inside the demo; the real app runs your own shell.\n" +
          "Commands: ls, cd, pwd, cat, head, tree, echo, touch, mkdir, git, clear,\n" +
          "          whoami, hostname, uname, date, history",
        );
        return;
      case "pwd": this.println(this.cwd); return;
      case "whoami": this.println("demo"); return;
      case "hostname": this.println("glasshouse"); return;
      case "uname": this.println(args.includes("-a") ? "Linux glasshouse 6.12.0 #1 SMP x86_64 GNU/Linux" : "Linux"); return;
      case "date": this.println(new Date(this.host.now()).toString()); return;
      case "echo": this.println(args.join(" ")); return;
      case "clear": this.out("\x1b[2J\x1b[H"); return;
      case "history": this.println(this.history.map((h, i) => `${String(i + 1).padStart(4)}  ${h}`).join("\n")); return;
      case "cd": {
        const target = this.resolve(args[0] ?? "~");
        const n = vfs.get(target);
        if (!n) return fail(`${args[0]}: No such file or directory`);
        if (!n.dir) return fail(`${args[0]}: Not a directory`);
        this.cwd = target;
        return;
      }
      case "ls":
      case "ll": {
        const flags = args.filter(a => a.startsWith("-")).join("");
        const long = cmd === "ll" || flags.includes("l");
        const all = cmd === "ll" || flags.includes("a");
        const target = this.resolve(args.find(a => !a.startsWith("-")) ?? ".");
        const n = vfs.get(target);
        if (!n) return fail(`cannot access '${args.find(a => !a.startsWith("-"))}': No such file or directory`);
        const items = n.dir ? [...n.children!.values()] : [n];
        const shown = items
          .filter(c => all || !c.name.startsWith("."))
          .sort((a, b) => a.name.localeCompare(b.name));
        const paint = (c: typeof shown[number]) =>
          c.dir ? `${C.blue}${C.bold}${c.name}${C.reset}`
          : /\.(sh|AppImage)$/.test(c.name) ? `${C.green}${C.bold}${c.name}${C.reset}`
          : /\.(zip|gz|7z|zst)$/.test(c.name) ? `${C.red}${C.bold}${c.name}${C.reset}`
          : /\.(jpg|png|svg)$/.test(c.name) ? `${C.magenta}${c.name}${C.reset}`
          : c.name;
        if (long) {
          for (const c of shown) {
            const d = new Date(c.mtime);
            const date = d.toLocaleString("en-US", { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" });
            this.println(`${c.dir ? "drwxr-xr-x" : "-rw-r--r--"} demo demo ${String(c.dir ? 4096 : c.size ?? 0).padStart(10)} ${date} ${paint(c)}`);
          }
        } else {
          this.println(shown.map(paint).join("  "));
        }
        return;
      }
      case "tree": {
        const root = this.resolve(args[0] ?? ".");
        const lines: string[] = [this.tilde(root)];
        const walk = (dir: string, pre: string, depth: number) => {
          const kids = [...(vfs.get(dir)?.children?.values() ?? [])]
            .filter(c => !c.name.startsWith("."))
            .sort((a, b) => a.name.localeCompare(b.name));
          kids.forEach((c, i) => {
            const last = i === kids.length - 1;
            lines.push(`${pre}${last ? "└── " : "├── "}${c.dir ? `${C.blue}${C.bold}${c.name}${C.reset}` : c.name}`);
            if (c.dir && depth < 2) walk(join(dir, c.name), pre + (last ? "    " : "│   "), depth + 1);
          });
        };
        walk(root, "", 0);
        this.println(lines.join("\n"));
        return;
      }
      case "cat":
      case "head": {
        if (!args.length) return fail("missing file operand");
        for (const a of args.filter(x => !x.startsWith("-"))) {
          const n = vfs.get(this.resolve(a));
          if (!n) { fail(`${a}: No such file or directory`); continue; }
          if (n.dir) { fail(`${a}: Is a directory`); continue; }
          if (n.text === undefined) { fail(`${a}: binary file (not shown in the demo)`); continue; }
          const text = cmd === "head" ? n.text.split("\n").slice(0, 10).join("\n") : n.text;
          this.println(text.replace(/\n$/, ""));
        }
        return;
      }
      case "touch":
      case "mkdir": {
        if (!args.length) return fail("missing operand");
        for (const a of args.filter(x => !x.startsWith("-"))) {
          const p = this.resolve(a);
          try {
            if (cmd === "mkdir") vfs.mkdir(p, this.host.now());
            else if (!vfs.exists(p)) vfs.write(p, "", this.host.now());
            this.host.changed(parent(p));
          } catch (e) {
            fail(`cannot create '${basename(p)}': ${e instanceof Error ? e.message.replace(/ \(os error \d+\).*/, "") : e}`);
          }
        }
        return;
      }
      case "git": {
        if (!vfs.repoOf(this.cwd)) return this.println("fatal: not a git repository (or any of the parent directories): .git");
        const r = this.host.repo.run(args, this.host.now());
        const text = (r.stdout + r.stderr).replace(/\n$/, "");
        if (args[0] === "status") {
          this.println(text
            .replace(/^(\t(?:new file:).*)$/gm, `${C.green}$1${C.reset}`)
            .replace(/^(\t(?:modified:|deleted:).*)$/gm, `${C.red}$1${C.reset}`)
            .replace(/^(\t(?!new file:|modified:|deleted:).*)$/gm, `${C.red}$1${C.reset}`));
        } else if (args[0] === "log") {
          this.println(text.replace(/^(\w{7})/gm, `${C.yellow}$1${C.reset}`));
        } else if (text) {
          this.println(text);
        }
        if (r.ok && ["commit", "checkout", "switch"].includes(args[0])) this.host.changed(this.cwd);
        return;
      }
      case "exit":
        this.println("(the demo shell stays open; close the tab instead)");
        return;
      case "sudo":
        this.println("sudo: not available in the demo");
        return;
      default:
        this.println(`${cmd}: command not found (type help for the demo's commands)`);
    }
  }
}
