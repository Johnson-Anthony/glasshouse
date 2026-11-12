import { gitBlame, gitDiscard, gitStage, gitUnstage, winToWsl, writeTags, type BlameLine, type FileEntry, type GitDiscardResult } from "../api";
import { dialogs } from "../dialogs/DialogHost";
import { errText } from "../errors";
import { discardReport, gitTargets, type GitAction } from "../gitTargets";
import { markIrreversible } from "../state";
import { winPathToWsl } from "../shellCd";
import type { AppCommands, HandlerCtx } from "./types";

type TagAccess = Pick<AppCommands, "tagStore" | "setTagStore">;

/** The selected paths, or the first entry's path when nothing else is. */
export function selectedOrFirst(ctx: HandlerCtx): string[] {
  if (ctx.selectedPaths.length) return ctx.selectedPaths;
  return ctx.firstPath ? [ctx.firstPath] : [];
}

/** Palette stand-in for a submenu: prompt with the first `shown` items as a
 *  numbered list and return the one picked (undefined if cancelled). Any
 *  number up to the full list is accepted, shown or not. */
export async function pickNumbered<T>(
  title: string,
  items: readonly T[],
  label: (item: T) => string,
  shown: number = Infinity,
): Promise<T | undefined> {
  const picked = await dialogs.showPrompt({
    title,
    message: items.slice(0, shown).map((item, i) => `${i + 1}. ${label(item)}`).join("\n"),
    placeholder: "1",
    validate: (v) => {
      const n = parseInt(v.trim(), 10);
      return (Number.isFinite(n) && n >= 1 && n <= items.length)
        ? null
        : `enter 1..${Math.min(items.length, shown)}`;
    },
  });
  if (picked == null) return undefined;
  return items[parseInt(picked.trim(), 10) - 1];
}

/** Blame `path` into the Blame dialog, or alert why it couldn't be. */
export async function showBlame(
  path: string,
  setBlame: (b: { path: string; lines: BlameLine[] }) => void,
): Promise<void> {
  try {
    const lines = await gitBlame(path, 2000);
    setBlame({ path, lines });
  } catch (err) {
    const msg = errText(err);
    console.error("git blame:", msg);
    void dialogs.showAlert({ title: "git blame failed", variant: "error", message: msg });
  }
}

/** Stage, Unstage or Discard the selection, for the Git menu and the
 *  context menu alike: the same filter (`gitTargets`), the same confirm and
 *  the same report. */
export async function runGitAction(
  action: GitAction,
  selected: string[],
  entries: FileEntry[],
  refresh: () => void,
): Promise<void> {
  if (selected.length === 0) return;
  const targets = gitTargets(action, selected, entries);
  if (targets.length === 0) {
    dialogs.showToast({ message: `nothing to ${action} in the selection`, variant: "info" });
    return;
  }
  // git's changes aren't in the undo history (see runAndShow in git.ts).
  if (action === "stage") {
    await gitStage(targets);
    markIrreversible(`git stage ${targets.length} item(s)`);
  } else if (action === "unstage") {
    await gitUnstage(targets);
    markIrreversible(`git unstage ${targets.length} item(s)`);
  } else {
    const ok = await dialogs.showConfirm({
      title: "discard changes",
      message:
        `Discard local changes to ${targets.length} item(s)? Tracked files go back to the last ` +
        "commit, and untracked ones move to the trash. Staged new files and ignored files are left alone.",
      danger: true,
      okLabel: "discard",
    });
    if (!ok) return;
    let report: GitDiscardResult;
    try {
      report = await gitDiscard(targets);
    } finally {
      markIrreversible(`git discard ${targets.length} item(s)`);
    }
    const { message, leftAlone } = discardReport(report);
    refresh();
    if (leftAlone) void dialogs.showAlert({ title: "discard changes", variant: "info", message });
    else dialogs.showToast({ message, variant: "info" });
    return;
  }
  refresh();
}

/** Copy `path` as a WSL path: the backend's conversion, or the local mapping
 *  when that fails or comes back empty. */
export async function copyWslPath(path: string): Promise<void> {
  let wsl = "";
  try { wsl = await winToWsl(path); } catch { wsl = ""; }
  if (!wsl) wsl = winPathToWsl(path);
  await navigator.clipboard.writeText(wsl);
}

/** Asks which of `path`'s tags to remove, then removes it. */
export async function removeTagPrompt(path: string, { tagStore, setTagStore }: TagAccess): Promise<void> {
  const existing = tagStore[path] ?? [];
  if (existing.length === 0) return;
  const raw = await dialogs.showPrompt({
    title: "remove tag",
    message: `Remove which tag? (current: ${existing.join(", ")})`,
    initialValue: existing[0],
    placeholder: "tag",
    validate: (v) => existing.includes(v.trim()) ? null : `not a current tag`,
  });
  if (raw === null) return;
  const tag = raw.trim();
  if (!tag || !existing.includes(tag)) return;
  setTagStore(prev => {
    const cur = prev[path] ?? [];
    const filtered = cur.filter(t => t !== tag);
    const next = { ...prev };
    if (filtered.length === 0) delete next[path];
    else next[path] = filtered;
    void writeTags(next);
    return next;
  });
}

/** Asks, then removes every tag from `paths`. "none" when none had tags. */
export async function clearAllTags(paths: string[], { tagStore, setTagStore }: TagAccess): Promise<"none" | "cancelled" | "cleared"> {
  const tagged = paths.filter(p => (tagStore[p]?.length ?? 0) > 0);
  if (tagged.length === 0) return "none";
  const ok = await dialogs.showConfirm({
    title: "Remove all tags",
    message: `Remove all tags from ${tagged.length} item(s)?`,
    danger: true,
    okLabel: "remove",
  });
  if (!ok) return "cancelled";
  setTagStore(prev => {
    const next = { ...prev };
    for (const p of tagged) delete next[p];
    void writeTags(next);
    return next;
  });
  return "cleared";
}
