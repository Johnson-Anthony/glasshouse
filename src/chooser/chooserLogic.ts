// The file chooser's decisions, pure so they're tested: which rows a filter
// shows, what the accept button says, what a typed name means, which folder
// the dialog opens in and what it answers. Chooser.tsx acts on them. The
// request comes from xdg-desktop-portal through the resident
// (src-tauri/src/portal.rs, chooser.rs).

import type { ChooserGlob, ChooserRequest, FileEntry } from "../api";
import { parseTyped } from "../typedPath";
import type { PathOps } from "../paths";

/** A glob (`*`, `?`, `[...]`, `[!...]`) as a regex over a whole name. */
export function globToRegExp(pattern: string, caseSensitive: boolean): RegExp {
  let re = "";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === "*") re += ".*";
    else if (c === "?") re += ".";
    else if (c === "[") {
      const end = pattern.indexOf("]", i + 2);
      if (end < 0) {
        re += "\\[";
        continue;
      }
      let body = pattern.slice(i + 1, end);
      const negate = body.startsWith("!");
      if (negate) body = body.slice(1);
      re += `[${negate ? "^" : ""}${body.replace(/[\\\]^]/g, m => `\\${m}`)}]`;
      i = end;
    } else re += c.replace(/[.+^${}()|\\/]/g, m => `\\${m}`);
  }
  return new RegExp(`^${re}$`, caseSensitive ? "" : "i");
}

/** Whether a file name passes a filter's globs; no globs passes all. */
export function filterMatcher(globs: ChooserGlob[] | undefined): (name: string) => boolean {
  if (!globs || globs.length === 0) return () => true;
  const res = globs.map(g => globToRegExp(g.pattern, g.caseSensitive));
  return name => res.some(r => r.test(name));
}

/** The rows the dialog lists: every folder, and the files the filter
 *  passes (none when it picks folders). */
export function shownEntries(entries: FileEntry[], directory: boolean, matches: (name: string) => boolean): FileEntry[] {
  return entries.filter(e => e.kind === "folder" || (!directory && matches(e.name)));
}

/** A GTK mnemonic label (`_Open`, `Save __as`) as plain text. */
export function plainLabel(label: string): string {
  return label.replace(/__|_/g, m => (m === "__" ? "_" : ""));
}

export function acceptLabel(req: Pick<ChooserRequest, "acceptLabel" | "kind" | "directory">): string {
  if (req.acceptLabel && plainLabel(req.acceptLabel).trim()) return plainLabel(req.acceptLabel);
  if (req.kind === "open") return req.directory ? "Select" : "Open";
  return "Save";
}

/** The folder the dialog opens in: the file being saved again's, the
 *  app's folder, the last one this app picked from, home. */
export function startFolder(req: ChooserRequest, last: string | null, home: string | null, ops: Pick<PathOps, "parentPath">): string {
  if (req.currentFile) return ops.parentPath(req.currentFile);
  return req.currentFolder || last || home || "/";
}

/** The name field's first text (Save). */
export function startName(req: ChooserRequest, ops: Pick<PathOps, "basename">): string {
  if (req.kind !== "save") return "";
  if (req.currentName) return req.currentName;
  if (req.currentFile) return ops.basename(req.currentFile);
  return "";
}

/** Each choice's first value: the app's if it's one of the choice's,
 *  else the first option (a checkbox: off). */
export function startChoices(req: ChooserRequest): Record<string, string> {
  const out: Record<string, string> = {};
  for (const c of req.choices) {
    if (c.options.length === 0) out[c.id] = c.initial === "true" ? "true" : "false";
    else out[c.id] = c.options.some(([id]) => id === c.initial) ? c.initial : c.options[0][0];
  }
  return out;
}

/** What the name field holds, read as a place: a bare name (in the current
 *  folder), or a path (`/x/y`, `~/x`, `sub/x`, `..`) whose last part is the
 *  name unless it ends in a separator. */
export type TypedName =
  | { kind: "empty" }
  | { kind: "name"; name: string }
  | { kind: "path"; path: string; folderOnly: boolean }
  | { kind: "error"; message: string };

export function readTypedName(text: string, cwd: string, home: string | null, win: boolean): TypedName {
  if (!text.trim()) return { kind: "empty" };
  const sep = win ? /[\\/]/ : /\//;
  const pathLike = sep.test(text) || text === "~" || text === "." || text === ".." || /^file:\/\//i.test(text.trim());
  if (!pathLike) return { kind: "name", name: text };
  const t = parseTyped(text, cwd, home, win);
  if (t.kind === "error") return t;
  if (t.kind === "url") return { kind: "error", message: "that's a link, not a file" };
  const folderOnly = /(^|[\\/])(~|\.\.?)?$/.test(text.trim());
  return { kind: "path", path: t.path, folderOnly };
}

/** The name with its extension changed to the new filter's when the filter
 *  changes (Save): only when the old filter typed the name and the new one
 *  is a plain `*.ext` and doesn't. */
export function swapExtension(name: string, before: (n: string) => boolean, after: ChooserGlob[] | undefined): string {
  const first = after?.[0]?.pattern ?? "";
  const ext = /^\*\.([^*?[\]/]+)$/.exec(first)?.[1];
  if (!ext || !name || !before(name) || filterMatcher(after)(name)) return name;
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  return `${base}.${ext}`;
}

/** Why a name can't be saved as, or null. */
export function badSaveName(name: string): string | null {
  if (!name.trim()) return "type a name";
  if (name === "." || name === "..") return `${name} isn't a file name`;
  if (name.includes("/") || name.includes("\0")) return "a name can't have / in it";
  return null;
}

/** SaveFiles' targets, one per name, in the request's order. */
export function saveFilesTargets(folder: string, files: string[], ops: Pick<PathOps, "joinPath">): string[] {
  return files.map(f => ops.joinPath(folder, f));
}

/** The answer for Open with these rows picked, or what to do instead:
 *  one folder picked (not in folder mode) opens it; folder mode with
 *  nothing picked takes the folder shown. */
export type OpenPick =
  | { kind: "accept"; paths: string[] }
  | { kind: "enter"; path: string }
  | { kind: "none" };

export function openPick(picked: FileEntry[], cwd: string, directory: boolean, multiple: boolean): OpenPick {
  if (directory) {
    const folders = picked.filter(e => e.kind === "folder").map(e => e.path);
    if (folders.length === 0) return { kind: "accept", paths: [cwd] };
    return { kind: "accept", paths: multiple ? folders : folders.slice(0, 1) };
  }
  const files = picked.filter(e => e.kind !== "folder");
  if (files.length === 0) {
    const folder = picked.find(e => e.kind === "folder");
    return folder ? { kind: "enter", path: folder.path } : { kind: "none" };
  }
  return { kind: "accept", paths: (multiple ? files : files.slice(0, 1)).map(e => e.path) };
}

/** The last folder an app picked from, by app ID ("" for unsandboxed apps,
 *  which share one). */
const LAST_KEY = "glasshouse.chooser.lastFolder.v1";

export function lastFolder(appId: string): string | null {
  try {
    const all = JSON.parse(localStorage.getItem(LAST_KEY) || "{}") as Record<string, unknown>;
    const v = all[appId];
    return typeof v === "string" && v ? v : null;
  } catch {
    return null;
  }
}

export function rememberFolder(appId: string, folder: string): void {
  try {
    const all = JSON.parse(localStorage.getItem(LAST_KEY) || "{}") as Record<string, unknown>;
    // Re-added, so it's the newest key.
    delete all[appId];
    all[appId] = folder;
    // A bound on what's kept: the 50 most recent apps.
    const keys = Object.keys(all);
    for (const k of keys.slice(0, Math.max(0, keys.length - 50))) delete all[k];
    localStorage.setItem(LAST_KEY, JSON.stringify(all));
  } catch { /* storage unavailable: nothing remembered */ }
}
