import type { Handler } from "./types";
import {
  gitStage,
  gitUnstage,
  gitDiscard,
  gitBlame,
  gitRun,
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
    else window.alert(`${title}\n\n${msg}`);
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
    window.alert(summarize(title, r));
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
        if (window.confirm(`Discard local changes to ${n} item(s)?`)) {
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
      const msg = window.prompt("commit message:");
      if (msg == null || msg.trim() === "") return true;
      await runAndShow(ctx, "git commit", ["commit", "-m", msg], true);
      return true;
    }
    case "Commit Amend": {
      const msg = window.prompt("amend message:");
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
      if (!window.confirm("Remove ALL untracked files and directories? (git clean -fd)")) {
        return true;
      }
      await runAndShow(ctx, "git clean -fd", ["clean", "-fd"], true);
      return true;
    }
    case "Checkout…": {
      const branch = window.prompt("checkout branch:");
      if (branch == null || branch.trim() === "") return true;
      await runAndShow(ctx, `git checkout ${branch}`, ["checkout", branch.trim()], true);
      return true;
    }
    case "New Branch…": {
      const branch = window.prompt("new branch name:");
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
      const branch = window.prompt("merge branch:");
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
      const branch = window.prompt("rebase onto branch:");
      if (branch == null || branch.trim() === "") return true;
      await runAndShow(ctx, `git rebase ${branch}`, ["rebase", branch.trim()], true);
      return true;
    }
    case "Git: Checkout Branch →": {
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
