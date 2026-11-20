// What the git menu's dialogs decide, without React or Tauri: which branches
// a picker offers, the arguments a commit sends, and a plain hint for a
// remote command that needed a password it couldn't ask for.
import type { GitBranch } from "./api";
import { fuzzyFilter } from "./fuzzy";

export type BranchAction = "checkout" | "merge" | "rebase";

export interface BranchChoice {
  /** What the list shows: the branch's name, `origin/x` for a remote one. */
  label: string;
  /** What goes to git. */
  value: string;
  remote: boolean;
  /** A note after the name: ahead/behind, or what picking it does. */
  hint?: string;
}

function trackHint(b: GitBranch): string | undefined {
  if (b.upstream_gone) return "upstream gone";
  const parts = [b.ahead ? `↑${b.ahead}` : "", b.behind ? `↓${b.behind}` : ""].filter(Boolean);
  return parts.length ? parts.join(" ") : undefined;
}

/** The branches a picker offers, local ones first. The current branch isn't
 *  one: there's nothing to switch to, merge or rebase onto.
 *  - checkout: a remote branch is offered only when no local branch has its
 *    name, as that name: `git checkout x --` then makes `x` tracking `origin/x`.
 *  - merge and rebase: every remote branch, as `origin/x`. */
export function branchChoices(branches: readonly GitBranch[], action: BranchAction): BranchChoice[] {
  const local = branches.filter(b => !b.remote);
  const localNames = new Set(local.map(b => b.name));
  const out: BranchChoice[] = local
    .filter(b => !b.current)
    .map(b => ({ label: b.name, value: b.name, remote: false, hint: trackHint(b) }));
  for (const b of branches) {
    if (!b.remote) continue;
    if (action !== "checkout") {
      out.push({ label: b.name, value: b.name, remote: true });
      continue;
    }
    // `origin/feature/x` → `feature/x`; remote names rarely have a slash.
    const name = b.name.slice(b.name.indexOf("/") + 1);
    if (!name || localNames.has(name)) continue;
    out.push({ label: b.name, value: name, remote: true, hint: `new branch ${name}` });
  }
  return out;
}

/** The choices matching `query` (fuzzy, best first); all of them for none. */
export function filterChoices(choices: readonly BranchChoice[], query: string): BranchChoice[] {
  const q = query.trim();
  if (!q) return [...choices];
  return fuzzyFilter(q, [...choices], c => c.label).map(r => r.item);
}

/** The `git commit` arguments for the dialog's message, or null when there's
 *  nothing to send (a new commit needs a message). An amend whose message is
 *  empty or unchanged keeps the old one, exactly (`--no-edit`). */
export function commitArgs(message: string, amend: boolean, headMessage: string | null): string[] | null {
  const msg = message.trim();
  if (!amend) return msg ? ["commit", "-m", msg] : null;
  if (!msg || msg === (headMessage ?? "").trim()) return ["commit", "--amend", "--no-edit"];
  return ["commit", "--amend", "-m", msg];
}

/** A sentence for a git failure that came from a credential or ssh prompt
 *  glasshouse can't show (git.rs runs git with no terminal), or null. */
export function remoteFailureHint(stderr: string): string | null {
  if (/terminal prompts disabled|could not read (username|password)|authentication failed/i.test(stderr)) {
    return "glasshouse can't ask for a username or password. Set up a git credential helper, "
      + "or run the command in the terminal drawer (Ctrl+`).";
  }
  if (/permission denied \(publickey|host key verification failed/i.test(stderr)) {
    return "glasshouse can't ask for an SSH passphrase or confirm a new host key. Add your key to "
      + "ssh-agent (ssh-add), or run the command once in the terminal drawer (Ctrl+`).";
  }
  return null;
}
