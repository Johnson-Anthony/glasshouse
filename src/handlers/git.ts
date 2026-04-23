import type { Handler } from "./types";
import { dialogs } from "../components";
import {
  gitStage,
  gitUnstage,
  gitDiscard,
  gitBlame,
  gitRun,
  gitBranchList,
  type GitRunResult,
} from "../api";

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
    const msg = e instanceof Error ? e.message : String(e);
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

export const gitHandler: Handler = async (label, ctx) => {
  switch (label) {
    case "Stage Selected":
    case "Git: Stage Selected": {
      if (ctx.selectedPaths.length > 0) {
        await gitStage(ctx.selectedPaths);
        ctx.refresh();
      }
      return true;
    }
    case "Unstage Selected": {
      if (ctx.selectedPaths.length > 0) {
        await gitUnstage(ctx.selectedPaths);
        ctx.refresh();
      }
      return true;
    }
    case "Discard Changes": {
      if (ctx.selectedPaths.length > 0) {
        const n = ctx.selectedPaths.length;
        const ok = await dialogs.showConfirm({
          title: "discard changes",
          message: `Discard local changes to ${n} item(s)?`,
          danger: true,
          okLabel: "discard",
        });
        if (ok) {
          await gitDiscard(ctx.selectedPaths);
          ctx.refresh();
        }
      }
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
    case "Git Status":
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
      await runAndShow(ctx, `git checkout ${branch}`, ["checkout", branch.trim()], true);
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
      const picked = await dialogs.showPrompt({
        title: "git checkout",
        message: branches.slice(0, 20).map((b, i) =>
          `${i + 1}. ${b.current ? "* " : "  "}${b.name}`,
        ).join("\n"),
        placeholder: "1",
        validate: (v) => {
          const n = parseInt(v.trim(), 10);
          return (Number.isFinite(n) && n >= 1 && n <= branches.length)
            ? null
            : `enter 1..${Math.min(branches.length, 20)}`;
        },
      });
      if (picked != null) {
        const n = parseInt(picked.trim(), 10) - 1;
        const b = branches[n];
        if (b) await runAndShow(ctx, `git checkout ${b.name}`, ["checkout", b.name], true);
      }
      return true;
    }
    default: {
      const m = /^git-branch:(.+)$/.exec(label);
      if (m) {
        const branch = m[1];
        await runAndShow(ctx, `git checkout ${branch}`, ["checkout", branch], true);
        return true;
      }
      return false;
    }
  }
};
