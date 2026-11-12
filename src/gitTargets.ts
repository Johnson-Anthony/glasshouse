// Which selected entries Stage, Unstage and Discard act on, and how a
// discard is reported. The Git menu and the context menu share these
// (handlers/helpers.ts `runGitAction`), so both act on the same paths. The
// backend checks again: git_discard never touches ignored or staged-only
// content (commands/git.rs `discard_paths`).
import type { FileEntry, GitDiscardResult } from "./api";

export type GitAction = "stage" | "unstage" | "discard";

/** The paths in `selected` that `action` can change, in selection order;
 *  paths not among `entries` are dropped.
 *  - A file with no git label is clean or ignored, so it's dropped.
 *  - A folder stays whatever its label: a tracked folder with changes
 *    inside has none, so the backend looks inside.
 *  - Unstage drops untracked (`?`) items, which have nothing staged. */
export function gitTargets(action: GitAction, selected: string[], entries: FileEntry[]): string[] {
  const byPath = new Map(entries.map(e => [e.path, e]));
  return selected.filter(p => {
    const e = byPath.get(p);
    if (!e) return false;
    if (action === "unstage" && e.git === "?") return false;
    return e.kind === "folder" || e.git !== null;
  });
}

const SHOW_SKIPPED = 5;

/** What a discard did, in a sentence or two, and whether anything was
 *  left alone (worth an alert rather than a toast). */
export function discardReport(r: GitDiscardResult): { message: string; leftAlone: boolean } {
  const done: string[] = [];
  if (r.restored > 0) done.push(`restored ${r.restored} file(s) from the last commit`);
  if (r.trashed > 0) done.push(`moved ${r.trashed} untracked item(s) to the trash`);
  const head = done.length > 0 ? done.join(", ") : "nothing discarded";
  if (r.skipped.length === 0) return { message: head, leftAlone: false };
  const lines = r.skipped.slice(0, SHOW_SKIPPED).map(s => `${s.path}: ${s.reason}`);
  if (r.skipped.length > SHOW_SKIPPED) lines.push(`and ${r.skipped.length - SHOW_SKIPPED} more`);
  return { message: `${head}.\n\nLeft alone:\n${lines.join("\n")}`, leftAlone: true };
}
