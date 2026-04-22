import type { Handler } from "./types";
import {
  gitStage,
  gitUnstage,
  gitDiscard,
  gitBlame,
  spawnTerminal,
} from "../api";

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
      await spawnTerminal(ctx.cwd);
      console.log("git intent: status");
      return true;
    }
    case "Git: Commit…":
    case "Commit…":
    case "Commit Amend": {
      const msg = window.prompt(
        label === "Commit Amend" ? "amend message:" : "commit message:",
      );
      if (msg == null || msg.trim() === "") return true;
      await spawnTerminal(ctx.cwd);
      console.log(`git intent: ${label === "Commit Amend" ? "commit --amend" : "commit"} ${msg}`);
      return true;
    }
    case "Checkout…":
    case "New Branch…":
    case "Rebase onto…":
    case "Merge…": {
      const branch = window.prompt(`${label} branch:`);
      if (branch == null || branch.trim() === "") return true;
      await spawnTerminal(ctx.cwd);
      console.log(`git intent: ${label} ${branch}`);
      return true;
    }
    case "Fetch All":
    case "Pull":
    case "Push":
    case "Stash":
    case "Clean Untracked…":
    case "Log (graph)":
    case "Branches": {
      await spawnTerminal(ctx.cwd);
      console.log(`git intent: ${label}`);
      return true;
    }
    case "Git: Checkout Branch →": {
      return true;
    }
    default:
      return false;
  }
};
