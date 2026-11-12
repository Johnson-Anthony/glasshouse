// Find & Replace in Files around the backend's replace_preview and
// replace_apply (src-tauri/src/commands/replace.rs): the confirm that
// previews a replace, the report after it, and its undo entry. The handler
// is in handlers/tools.ts.
// See docs/decisions/2026-11-12-find-replace-safety-design.md.
import type { ChangedFile, ReplaceOutcome, ReplacePlan, ReplaceRequest, SkippedFile } from "./api";
import type { UndoEntry } from "./state";
import { contentsUndo, type ContentChange } from "./undoActions";

/** Files listed by name in a message; the rest are counted. */
export const LISTED = 20;

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const matches = (n: number) => count(n, "match", "matches");
const sum = (files: Array<{ matches: number }>) => files.reduce((n, f) => n + f.matches, 0);

/** `path` relative to the search root, where it's under it. */
export function shownPath(root: string, path: string): string {
  if (!root || !path.startsWith(root)) return path;
  const rest = path.slice(root.length);
  if (!/^[\\/]/.test(rest) && !/[\\/]$/.test(root)) return path;
  return rest.replace(/^[\\/]+/, "") || path;
}

function listed<T>(items: T[], line: (item: T) => string): string[] {
  const out = items.slice(0, LISTED).map(i => `• ${line(i)}`);
  if (items.length > LISTED) out.push(`• …and ${items.length - LISTED} more`);
  return out;
}

const skippedLines = (root: string, skipped: SkippedFile[]) =>
  listed(skipped, f => `${shownPath(root, f.path)}: ${f.reason}`);

const cappedNote = (plan: ReplacePlan) =>
  `The search stopped at ${plan.cap} files with matches, so files past them weren't searched or changed.`;

/** The confirm before a replace: each file and its matches, the files with
 *  a match that will be left alone and why, the cap, and whether the
 *  replace can be undone. */
export function previewMessage(plan: ReplacePlan, req: ReplaceRequest): string {
  const parts = [[
    `Replace "${req.query}" with "${req.replacement}" in ${count(plan.files.length, "file")} (${matches(sum(plan.files))}):`,
    ...listed(plan.files, f => `${shownPath(req.root, f.path)} (${f.matches})`),
  ].join("\n")];
  if (plan.skipped.length > 0) parts.push([`Left alone (${plan.skipped.length}):`, ...skippedLines(req.root, plan.skipped)].join("\n"));
  if (plan.capped) parts.push(cappedNote(plan));
  if (!plan.undoable) parts.push("This can't be undone: the files are too large to keep a copy of.");
  return parts.join("\n\n");
}

/** The alert when a search found nothing it can change. */
export function nothingMessage(plan: ReplacePlan, req: ReplaceRequest): string {
  if (plan.skipped.length === 0) return `no matches for "${req.query}"`;
  const parts = [[`"${req.query}" is only in files that won't be changed:`, ...skippedLines(req.root, plan.skipped)].join("\n")];
  if (plan.capped) parts.push(cappedNote(plan));
  return parts.join("\n\n");
}

export interface Report {
  message: string;
  /** Everything confirmed was replaced as expected: a toast will do. */
  clean: boolean;
}

/** What a replace did: the files and matches replaced, the confirmed files
 *  left alone and why, the files a cancel kept it from, the cap again, and
 *  whether it can be undone (`undoable`: an undo entry was pushed). */
export function outcomeReport(plan: ReplacePlan, out: ReplaceOutcome, req: ReplaceRequest, undoable: boolean): Report {
  const done = `${matches(sum(out.changed))} in ${count(out.changed.length, "file")}`;
  const irreversible = out.changed.length > 0 && !undoable;
  // A replace the confirm already said can't be undone is no surprise.
  if (out.skipped.length === 0 && !out.cancelled && !plan.capped && (!irreversible || !plan.undoable)) {
    return { message: `replaced ${done}${irreversible ? " (can't be undone)" : ""}`, clean: true };
  }
  const parts = [out.changed.length > 0 ? `Replaced ${done}.` : "Nothing was replaced."];
  if (out.skipped.length > 0) parts.push([`Not changed (${out.skipped.length}):`, ...skippedLines(req.root, out.skipped)].join("\n"));
  if (out.cancelled) {
    const left = plan.files.length - out.changed.length - out.skipped.length;
    parts.push(`Cancelled with ${count(left, "file")} not reached.`);
  }
  if (plan.capped) parts.push(cappedNote(plan));
  if (irreversible) parts.push("It can't be undone: the files were too large to keep a copy of.");
  return { message: parts.join("\n\n"), clean: false };
}

/** Undo for a replace: every changed file's old text written back, as one
 *  step. Null when some file's text wasn't kept (too large), so the replace
 *  can't be undone and the caller marks it irreversible. */
export function replaceUndo(label: string, changed: ChangedFile[]): UndoEntry | null {
  const changes: ContentChange[] = [];
  for (const f of changed) {
    if (f.before == null || f.after == null) return null;
    changes.push({ path: f.path, before: f.before, after: f.after });
  }
  return contentsUndo(label, changes);
}
