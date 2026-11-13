// Plain helpers for the Trash dialog (dialogs/Trash.tsx) and Move to Trash
// (handlers/fileOps.ts `trashPaths`), kept apart from React and the backend so
// they're unit-tested.
import type { TrashEntry, TrashKey, TrashProblem } from "./api";
import { basename } from "./paths";

/** Newest first; ties by name. */
export function sortTrash(entries: TrashEntry[]): TrashEntry[] {
  return [...entries].sort((a, b) => b.deleted - a.deleted || a.name.localeCompare(b.name));
}

/** The key that names exactly this entry: its id, its original path and
 *  the second it was deleted. */
export function trashKey(e: TrashEntry): TrashKey {
  return { original: e.original, from: e.deleted, to: e.deleted, id: e.id };
}

function bytes(n: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${i === 0 ? v : v.toFixed(1)} ${units[i]}`;
}

/** A file's size, a folder's entry count, or "—" when neither could be read. */
export function trashSizeText(e: Pick<TrashEntry, "size" | "entries">): string {
  if (e.size !== null) return bytes(e.size);
  if (e.entries !== null) return e.entries === 1 ? "1 item" : `${e.entries} items`;
  return "—";
}

/** Up to five "name: reason" lines, then how many more. */
export function problemLines(problems: TrashProblem[]): string {
  const lines = problems.slice(0, 5).map(p => `${basename(p.path)}: ${p.reason}`);
  if (problems.length > 5) lines.push(`…and ${problems.length - 5} more`);
  return lines.join("\n");
}

/** The question Move to Trash asks when some of `total` selected items are
 *  on a drive with no Recycle Bin (`noBin`, with why): those can only be
 *  deleted for good. */
export function noBinText(noBin: TrashProblem[], total: number): string {
  const end = "This cannot be undone.";
  if (noBin.length === 1 && total === 1) {
    return `"${basename(noBin[0].path)}" can't go to the Recycle Bin: ${noBin[0].reason}. Delete it permanently? ${end}`;
  }
  const list = problemLines(noBin);
  if (noBin.length === total) {
    return `These ${total} items can't go to the Recycle Bin:\n${list}\n\nDelete them permanently? ${end}`;
  }
  const rest = total - noBin.length;
  return `${noBin.length} of the ${total} items can't go to the Recycle Bin:\n${list}\n\n`
    + `Delete ${noBin.length === 1 ? "it" : "those"} permanently, and move the other ${rest} to the Recycle Bin? ${end}`;
}
