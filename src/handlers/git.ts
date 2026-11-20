import type { Handler } from "./types";
import { runGitAction } from "./helpers";
import { dialogs } from "../dialogs/DialogHost";
import { gitDialogs } from "../dialogs/GitDialogs";
import {
  gitBlame,
  gitRun,
  type GitRunResult,
} from "../api";
import { errText } from "../errors";
import { remoteFailureHint, type BranchAction } from "../gitUx";
import { isCancelled, runOp } from "../ops";
import { markIrreversible } from "../state";

/** Run git and show its output. It runs as an op in the tray, labelled
 *  `title`, with git's progress and a Cancel. `refreshAfter` marks a command
 *  that changes something: the pane is refreshed, and since git's changes
 *  aren't in the undo history, the history before it is dropped (even when
 *  git failed or was cancelled: a merge with conflicts still changed files). */
async function runAndShow(
  ctx: Parameters<Handler>[1],
  title: string,
  args: string[],
  refreshAfter: boolean,
): Promise<void> {
  let r: GitRunResult;
  try {
    r = await runOp(title, track => gitRun(ctx.cwd, args, track()), "status");
  } catch (e) {
    if (isCancelled(e)) {
      if (refreshAfter) {
        markIrreversible(title);
        ctx.refresh();
      }
      dialogs.showToast({ message: `${title}: cancelled`, variant: "warning" });
      return;
    }
    const msg = errText(e);
    if (ctx.setGitOutput) ctx.setGitOutput({ title, output: msg, ok: false });
    else void dialogs.showAlert({ title, variant: "error", message: msg });
    return;
  }
  if (refreshAfter) markIrreversible(title);
  // A credential or ssh prompt that couldn't be shown gets a plain hint.
  const hint = r.ok ? null : remoteFailureHint(r.stderr);
  const withHint = (text: string) => (hint && text ? `${text}\n\n${hint}` : text);
  const output = r.stdout.trim() || withHint(r.stderr.trim()) || "(no output)";
  if (ctx.setGitOutput) {
    ctx.setGitOutput({
      title,
      output,
      ok: r.ok,
      exit: r.exit,
      stderr: r.ok ? "" : withHint(r.stderr.trim()),
    });
  } else {
    void dialogs.showAlert({ title, variant: r.ok ? "info" : "error", message: `${title}\nexit ${r.exit}\n\n${output}` });
  }
  if (refreshAfter && r.ok) ctx.refresh();
}

/** Switch to `branch`. The `--` makes git read it as a branch only: plain
 *  `git checkout docs` restores the folder `docs` when no branch has that
 *  name, throwing away its edits. */
function checkoutBranch(ctx: Parameters<Handler>[1], branch: string): Promise<void> {
  return runAndShow(ctx, `git checkout ${branch}`, ["checkout", branch, "--"], true);
}

/** Pick a branch from the list (or type one) and check it out, merge it or
 *  rebase onto it. */
async function pickAndRun(ctx: Parameters<Handler>[1], action: BranchAction): Promise<void> {
  const branch = await gitDialogs.pickBranch({ cwd: ctx.cwd, action });
  if (!branch) return;
  if (action === "checkout") await checkoutBranch(ctx, branch);
  else if (action === "merge") await runAndShow(ctx, `git merge ${branch} --no-edit`, ["merge", branch, "--no-edit"], true);
  else await runAndShow(ctx, `git rebase ${branch}`, ["rebase", branch], true);
}

export const gitHandler: Handler = async (label, ctx) => {
  const entries = ctx.activeHandle?.state.entries ?? [];
  switch (label) {
    case "Stage Selected": {
      await runGitAction("stage", ctx.selectedPaths, entries, ctx.refresh);
      return true;
    }
    case "Unstage Selected": {
      await runGitAction("unstage", ctx.selectedPaths, entries, ctx.refresh);
      return true;
    }
    case "Discard Changes": {
      await runGitAction("discard", ctx.selectedPaths, entries, ctx.refresh);
      return true;
    }
    case "Blame Selected": {
      const first = ctx.firstEntry;
      if (first && first.kind !== "folder" && first.git !== "?") {
        const lines = await gitBlame(first.path, 2000);
        ctx.setBlame({ path: first.path, lines });
      }
      return true;
    }
    case "Status": {
      await runAndShow(ctx, "git status", ["status", "--short"], false);
      return true;
    }
    case "Commit…":
    case "Commit Amend": {
      const amend = label === "Commit Amend";
      const args = await gitDialogs.commit({ cwd: ctx.cwd, amend });
      if (args) await runAndShow(ctx, amend ? "git commit --amend" : "git commit", args, true);
      return true;
    }
    // `--progress`: git reports to a pipe only when asked, and the tray
    // shows it.
    case "Pull": {
      await runAndShow(ctx, "git pull --ff-only", ["pull", "--ff-only", "--progress"], true);
      return true;
    }
    case "Push": {
      await runAndShow(ctx, "git push", ["push", "--progress"], true);
      return true;
    }
    case "Fetch All": {
      await runAndShow(ctx, "git fetch --all --prune", ["fetch", "--all", "--prune", "--progress"], true);
      return true;
    }
    case "Stash": {
      await runAndShow(ctx, "git stash push -u", ["stash", "push", "-u"], true);
      return true;
    }
    case "Log (graph)": {
      await runAndShow(
        ctx,
        "git log (graph)",
        ["log", "--oneline", "--graph", "--decorate", "--all", "-n", "200"],
        false,
      );
      return true;
    }
    case "Clean Untracked…": {
      const ok = await dialogs.showConfirm({
        title: "git clean -fd",
        message: "Remove ALL untracked files and directories? This cannot be undone.",
        danger: true,
        okLabel: "clean",
      });
      if (!ok) return true;
      await runAndShow(ctx, "git clean -fd", ["clean", "-fd"], true);
      return true;
    }
    case "Checkout…":
    case "Git: Checkout Branch →": {
      await pickAndRun(ctx, "checkout");
      return true;
    }
    case "New Branch…": {
      const branch = await dialogs.showPrompt({
        title: "git checkout -b",
        message: "new branch name:",
        placeholder: "feature/…",
        validate: (v) => v.trim() ? null : "name required",
      });
      if (branch == null || branch.trim() === "") return true;
      await runAndShow(
        ctx,
        `git checkout -b ${branch}`,
        ["checkout", "-b", branch.trim()],
        true,
      );
      return true;
    }
    case "Merge…": {
      await pickAndRun(ctx, "merge");
      return true;
    }
    case "Rebase onto…": {
      await pickAndRun(ctx, "rebase");
      return true;
    }
    default: {
      const m = /^git-branch:(.+)$/.exec(label);
      if (m) {
        await checkoutBranch(ctx, m[1]);
        return true;
      }
      return false;
    }
  }
};
