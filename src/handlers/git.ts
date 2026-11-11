import type { Handler } from "./types";
import { pickNumbered, runGitAction } from "./helpers";
import { dialogs } from "../dialogs/DialogHost";
import {
  gitBlame,
  gitRun,
  gitBranchList,
  type GitRunResult,
} from "../api";
import { errText } from "../errors";

function summarize(title: string, r: GitRunResult): string {
  const body = r.stdout.trim() || r.stderr.trim() || "(no output)";
  return `${title}\nexit ${r.exit}\n\n${body}`;
}

async function runAndShow(
  ctx: Parameters<Handler>[1],
  title: string,
  args: string[],
  refreshAfter: boolean,
): Promise<void> {
  let r: GitRunResult;
  try {
    r = await gitRun(ctx.cwd, args);
  } catch (e) {
    const msg = errText(e);
    if (ctx.setGitOutput) ctx.setGitOutput({ title, output: msg, ok: false });
    else void dialogs.showAlert({ title, variant: "error", message: msg });
    return;
  }
  if (ctx.setGitOutput) {
    ctx.setGitOutput({
      title,
      output: r.stdout.trim() || r.stderr.trim() || "(no output)",
      ok: r.ok,
      exit: r.exit,
      stderr: r.ok ? "" : r.stderr.trim(),
    });
  } else {
    void dialogs.showAlert({ title, variant: r.ok ? "info" : "error", message: summarize(title, r) });
  }
  if (refreshAfter && r.ok) ctx.refresh();
}

/** Switch to `branch`. The `--` makes git read it as a branch only: plain
 *  `git checkout docs` restores the folder `docs` when no branch has that
 *  name, throwing away its edits. */
function checkoutBranch(ctx: Parameters<Handler>[1], branch: string): Promise<void> {
  return runAndShow(ctx, `git checkout ${branch}`, ["checkout", branch, "--"], true);
}

export const gitHandler: Handler = async (label, ctx) => {
  const entries = ctx.activeHandle?.state.entries ?? [];
  switch (label) {
    case "Stage Selected":
    case "Git: Stage Selected": {
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
    case "Git: Commit…":
    case "Commit…": {
      const msg = await dialogs.showPrompt({
        title: "git commit",
        message: "commit message:",
        placeholder: "feat: …",
        validate: (v) => v.trim() ? null : "message required",
      });
      if (msg == null || msg.trim() === "") return true;
      await runAndShow(ctx, "git commit", ["commit", "-m", msg], true);
      return true;
    }
    case "Commit Amend": {
      const msg = await dialogs.showPrompt({
        title: "git commit --amend",
        message: "amend message:",
        placeholder: "(leave empty to reuse)",
      });
      if (msg == null || msg.trim() === "") return true;
      await runAndShow(ctx, "git commit --amend", ["commit", "--amend", "-m", msg], true);
      return true;
    }
    case "Pull": {
      await runAndShow(ctx, "git pull --ff-only", ["pull", "--ff-only"], true);
      return true;
    }
    case "Push": {
      await runAndShow(ctx, "git push", ["push"], true);
      return true;
    }
    case "Fetch All": {
      await runAndShow(ctx, "git fetch --all --prune", ["fetch", "--all", "--prune"], true);
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
    case "Checkout…": {
      const branch = await dialogs.showPrompt({
        title: "git checkout",
        message: "branch to check out:",
        placeholder: "main",
        validate: (v) => v.trim() ? null : "branch required",
      });
      if (branch == null || branch.trim() === "") return true;
      await checkoutBranch(ctx, branch.trim());
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
      const branch = await dialogs.showPrompt({
        title: "git merge",
        message: "branch to merge into current:",
        placeholder: "branch",
        validate: (v) => v.trim() ? null : "branch required",
      });
      if (branch == null || branch.trim() === "") return true;
      await runAndShow(
        ctx,
        `git merge ${branch} --no-edit`,
        ["merge", branch.trim(), "--no-edit"],
        true,
      );
      return true;
    }
    case "Rebase onto…": {
      const branch = await dialogs.showPrompt({
        title: "git rebase",
        message: "rebase onto:",
        placeholder: "main",
        validate: (v) => v.trim() ? null : "branch required",
      });
      if (branch == null || branch.trim() === "") return true;
      await runAndShow(ctx, `git rebase ${branch}`, ["rebase", branch.trim()], true);
      return true;
    }
    case "Git: Checkout Branch →": {
      // Palette path: there's no submenu to hover, so list branches in a
      // prompt and let the user pick by number.
      let branches: Awaited<ReturnType<typeof gitBranchList>> = [];
      try { branches = await gitBranchList(ctx.cwd); }
      catch { branches = []; }
      if (branches.length === 0) {
        dialogs.showToast({ message: "no branches (or not a git repo)", variant: "info" });
        return true;
      }
      const b = await pickNumbered("git checkout", branches, b => `${b.current ? "* " : "  "}${b.name}`, 20);
      if (b) await checkoutBranch(ctx, b.name);
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
