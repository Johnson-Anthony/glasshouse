// A pretend git repository over the virtual filesystem: per-file status codes
// live on the VFS nodes; this holds the branch, history and text output.
import { BASE_TIME } from "./content";
import type { Vfs } from "./vfs";

export interface Commit {
  sha: string;
  author: string;
  when: number;
  subject: string;
}

const AUTHOR = "Demo User";

export class GitRepo {
  branch = "main";
  branches = ["main", "quick-look", "paste-conflicts"];
  ahead = 2;
  commits: Commit[] = [
    { sha: "4b8043a", when: BASE_TIME - 3 * 3600_000, subject: "Rewrite the README and project site in plain language" },
    { sha: "62013c8", when: BASE_TIME - 5 * 3600_000, subject: "Paste: ask before replacing an existing name" },
    { sha: "ef8f7ee", when: BASE_TIME - 26 * 3600_000, subject: "Refuse taken names when creating or renaming" },
    { sha: "d9a0b58", when: BASE_TIME - 50 * 3600_000, subject: "Linux: symlinked folders, drive labels, XDG trash" },
    { sha: "01d296e", when: BASE_TIME - 74 * 3600_000, subject: "Undo of a copy refuses when the copies changed" },
    { sha: "a33086c", when: BASE_TIME - 98 * 3600_000, subject: "Strict chmod parsing and shortcut fixes" },
  ].map(c => ({ ...c, author: AUTHOR }));

  constructor(private vfs: Vfs, readonly root: string) {
    vfs.repoRoots.push(root);
  }

  /** Repo-relative path → code, for every changed file. */
  changes(): Array<[string, string]> {
    const out: Array<[string, string]> = [];
    for (const [p, n] of this.vfs.walk(this.root)) {
      if (n.git) out.push([p.slice(this.root.length + 1) + (n.dir ? "/" : ""), n.git]);
    }
    return out.sort((a, b) => a[0].localeCompare(b[0]));
  }

  statusText(): string {
    const ch = this.changes();
    const lines = [`On branch ${this.branch}`];
    lines.push(this.ahead > 0
      ? `Your branch is ahead of 'origin/${this.branch}' by ${this.ahead} commit${this.ahead === 1 ? "" : "s"}.`
      : `Your branch is up to date with 'origin/${this.branch}'.`);
    const staged = ch.filter(([, c]) => c === "A");
    const modified = ch.filter(([, c]) => c === "M" || c === "D");
    const untracked = ch.filter(([, c]) => c === "?");
    if (staged.length) {
      lines.push("", "Changes to be committed:");
      for (const [p] of staged) lines.push(`\tnew file:   ${p}`);
    }
    if (modified.length) {
      lines.push("", "Changes not staged for commit:");
      for (const [p, c] of modified) lines.push(`\t${c === "D" ? "deleted: " : "modified: "}  ${p}`);
    }
    if (untracked.length) {
      lines.push("", "Untracked files:");
      for (const [p] of untracked) lines.push(`\t${p}`);
    }
    if (!ch.length) lines.push("", "nothing to commit, working tree clean");
    return lines.join("\n") + "\n";
  }

  logText(n = 10): string {
    return this.commits.slice(0, n).map(c => `${c.sha} ${c.subject}`).join("\n") + "\n";
  }

  branchText(): string {
    return this.branches.map(b => (b === this.branch ? `* ${b}` : `  ${b}`)).join("\n") + "\n";
  }

  commit(message: string, now: number): string {
    const ch = this.changes().filter(([, c]) => c !== "?");
    if (!ch.length) throw new Error("nothing to commit, working tree clean");
    for (const [rel] of ch) {
      const n = this.vfs.get(`${this.root}/${rel.replace(/\/$/, "")}`);
      if (n) delete n.git;
    }
    const sha = Math.floor(now / 1000).toString(16).slice(-7);
    this.commits.unshift({ sha, author: AUTHOR, when: now, subject: message });
    this.ahead++;
    return `[${this.branch} ${sha}] ${message}\n ${ch.length} file${ch.length === 1 ? "" : "s"} changed\n`;
  }

  /** `git` subcommands the demo understands, for the raw runner and the shell. */
  run(args: string[], now: number): { ok: boolean; stdout: string; stderr: string } {
    const [sub, ...rest] = args;
    const ok = (stdout: string) => ({ ok: true, stdout, stderr: "" });
    try {
      switch (sub) {
        case "status": return ok(this.statusText());
        case "log": return ok(this.logText());
        case "branch": return ok(this.branchText());
        case "commit": {
          const m = rest.indexOf("-m");
          return ok(this.commit(m >= 0 ? rest[m + 1] ?? "" : "update", now));
        }
        case "checkout":
        case "switch": {
          const b = rest.filter(a => !a.startsWith("-"))[0];
          if (!b) throw new Error("missing branch name");
          if (!this.branches.includes(b)) {
            if (!rest.includes("-b") && !rest.includes("-c")) throw new Error(`pathspec '${b}' did not match any file(s) known to git`);
            this.branches.push(b);
          }
          this.branch = b;
          return ok(`Switched to branch '${b}'\n`);
        }
        case "diff": return ok(this.changes().filter(([, c]) => c === "M")
          .map(([p]) => ` ${p} | 4 ++--`).join("\n") + "\n");
        case "pull": return ok("Already up to date.\n");
        case "push": {
          const n = this.ahead;
          this.ahead = 0;
          return ok(n ? `To github.com:demo/glasshouse.git\n   ${this.commits[n]?.sha ?? "0000000"}..${this.commits[0].sha}  ${this.branch} -> ${this.branch}\n` : "Everything up-to-date\n");
        }
        case "fetch": return ok("");
        case undefined: return ok("usage: git <command> [<args>]\n");
        default: throw new Error(`'${sub}' isn't available in the demo`);
      }
    } catch (e) {
      return { ok: false, stdout: "", stderr: (e instanceof Error ? e.message : String(e)) + "\n" };
    }
  }
}
