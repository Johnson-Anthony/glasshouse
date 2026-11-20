// A listing entry as a file-pane row (name without extension, size and
// date as shown, first tag, git label). The main window and the file
// chooser (src/chooser/) both list folders this way.

import type { FileEntry } from "./api";
import type { FileKind, GitStatus } from "./data";
import type { InspectableFile } from "./preview/Inspector";
import { formatDate } from "./components";
import { entryName } from "./viewRows";

function kindFromEntry(k: string): FileKind {
  switch (k) {
    case "folder": return "folder";
    case "code": return "code";
    case "img": return "img";
    case "archive": return "archive";
    case "exec": return "exec";
    case "text": return "text";
    default: return "text";
  }
}

export function formatBytes(bytes: number, isDir: boolean): string {
  if (isDir) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["K", "M", "G", "T"];
  let v = bytes / 1024;
  let ui = 0;
  while (v >= 1024 && ui < units.length - 1) { v /= 1024; ui++; }
  if (v >= 100) return `${v.toFixed(0)}${units[ui]}`;
  if (v >= 10) return `${v.toFixed(1)}${units[ui]}`;
  return `${v.toFixed(1)} ${units[ui]}`;
}

function normalizeGit(flag: string | null | undefined): GitStatus | null {
  if (!flag) return null;
  if (flag === "M" || flag === "A" || flag === "D" || flag === "U" || flag === "?") {
    return flag;
  }
  return null;
}

export function entryToRow(
  e: FileEntry,
  tagStore: Record<string, string[]>,
): InspectableFile {
  const kind = kindFromEntry(e.kind);
  const { name: nameNoExt, ext } = entryName(e);
  const rowTags = tagStore[e.path];
  const firstTag = rowTags && rowTags.length > 0 ? rowTags[0] : null;
  return {
    name: nameNoExt,
    kind,
    size: formatBytes(e.size, kind === "folder"),
    date: formatDate(e.modified_ms),
    tag: firstTag,
    git: normalizeGit(e.git),
    hidden: e.hidden,
    ext,
    link: e.is_symlink,
    entry: e,
  };
}
