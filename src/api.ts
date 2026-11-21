import { invoke as rawInvoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { audioDir, desktopDir, documentDir, downloadDir, pictureDir, videoDir } from "@tauri-apps/api/path";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { errKind, errText, fromBackend } from "./errors";
import { joinPath } from "./paths";

export async function winClose(): Promise<void> {
  if (!TAURI_AVAILABLE) return;
  try { await getCurrentWindow().close(); } catch {}
}

export async function winMinimize(): Promise<void> {
  if (!TAURI_AVAILABLE) return;
  try { await getCurrentWindow().minimize(); } catch {}
}

export async function winToggleMaximize(): Promise<void> {
  if (!TAURI_AVAILABLE) return;
  try { await getCurrentWindow().toggleMaximize(); } catch {}
}

/** Tells the window whether the app's theme is dark or light, so what the
 *  system draws for it (on Linux, GTK popups such as a <select>'s list)
 *  matches. Null: follow the OS again (on Linux that also clears GTK's
 *  dark preference until the next portal change; see useLook.ts). */
export async function winSetTheme(scheme: "dark" | "light" | null): Promise<void> {
  if (!TAURI_AVAILABLE) return;
  try { await getCurrentWindow().setTheme(scheme); } catch {}
}

/** The window's theme: the one set, else the OS's. */
export async function winTheme(): Promise<"dark" | "light" | null> {
  if (!TAURI_AVAILABLE) return null;
  try { return await getCurrentWindow().theme(); } catch { return null; }
}

/** Calls `cb` with whether the window is maximized now and after each
 *  resize. Returns the cleanup. */
export function onWinMaximized(cb: (maximized: boolean) => void): () => void {
  if (!TAURI_AVAILABLE) return () => {};
  const w = getCurrentWindow();
  const check = () => { w.isMaximized().then(cb, () => {}); };
  check();
  let off: (() => void) | null = null;
  let gone = false;
  w.onResized(check).then(u => { if (gone) u(); else off = u; }, () => {});
  return () => { gone = true; off?.(); };
}

export interface FileEntry {
  name: string;
  path: string;
  kind: string;
  size: number;
  modified_ms: number;
  hidden: boolean;
  ext: string;
  is_symlink: boolean;
  /** True when the on-disk path isn't valid UTF-8 — `name`/`path` are lossy
   *  renderings and mutating ops are blocked on this entry. */
  lossy: boolean;
  /** Single-char git status: "M"|"A"|"D"|"U"|"?", or null when clean,
   *  ignored or outside a repo. */
  git: string | null;
}

export interface BlameLine {
  line_no: number;
  sha: string;
  author: string;
  content: string;
  timestamp_ms: number;
}

export interface FindMatch {
  path: string;
  line_no: number;
  line: string;
}

/** Find & Replace in Files: what to replace, and where. */
export interface ReplaceRequest {
  root: string;
  query: string;
  replacement: string;
  caseInsensitive: boolean;
}

export interface PlannedFile {
  path: string;
  matches: number;
  /** Size now, and after the replace. */
  bytes: number;
  new_bytes: number;
}

/** A file with a match that a replace leaves alone, and why. */
export interface SkippedFile {
  path: string;
  reason: string;
}

export interface ReplacePlan {
  files: PlannedFile[];
  skipped: SkippedFile[];
  /** The search stopped at `cap` files with matches, and there are more. */
  capped: boolean;
  cap: number;
  /** Every planned file's old and new text fit what's kept for undo. */
  undoable: boolean;
}

export interface ChangedFile {
  path: string;
  matches: number;
  /** The whole old and new text, when kept for undo. */
  before: string | null;
  after: string | null;
}

export interface ReplaceOutcome {
  changed: ChangedFile[];
  skipped: SkippedFile[];
  /** Cancelled between files: `changed` is what was done first. */
  cancelled: boolean;
}

export interface Drive {
  letter: string;
  label: string;
  total: number;
  free: number;
  fs: string;
}

export interface WslDistro {
  name: string;
  path: string;
}

export interface SystemInfo {
  cpu_pct: number;
  mem_pct: number;
  mem_used: number;
  mem_total: number;
  uptime_s: number;
  host: string;
}

export interface GitInfo {
  repo_root: string;
  branch: string;
  ahead: number;
  behind: number;
  /** Changed, staged, deleted, conflicted and untracked items. */
  dirty: number;
}

export interface FileStatExt {
  created_ms: number | null;
  modified_ms: number | null;
  owner: string | null;
  file_index: number | null;
  readonly: boolean;
  /** Permission bits with setuid, setgid and sticky, unix only (a link
   *  reports its target's). Null on Windows and for a dangling link. */
  mode: number | null;
  is_symlink: boolean;
  symlink_target: string | null;
}

export interface GitFileInfo {
  last_commit_ago: string | null;
  author: string | null;
  sha: string | null;
  added: number;
  removed: number;
}

export interface NetRate {
  down_bps: number;
  up_bps: number;
}

interface TauriWindow {
  __TAURI_INTERNALS__?: unknown;
}

export const TAURI_AVAILABLE: boolean =
  typeof window !== "undefined" &&
  (window as unknown as TauriWindow).__TAURI_INTERNALS__ !== undefined;

/** Every command goes through here: a structured backend error (error.rs)
 *  rejects as a BackendError, whose message is the sentence for the user. */
function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  return rawInvoke<T>(cmd, args).catch((e: unknown) => Promise.reject(fromBackend(e)));
}

async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  if (!TAURI_AVAILABLE) return fallback;
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

/** For mutating ops: rejects on failure instead of swallowing it. Wrapping
 *  these in safe() meant a failed delete/move/rename resolved like a success
 *  — callers toasted "done", pushed bogus undo entries, and the user never
 *  learned nothing happened. */
function mustInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!TAURI_AVAILABLE) return Promise.reject(new Error("tauri unavailable"));
  return invoke<T>(cmd, args);
}

export function homeDir(): Promise<string | null> {
  return safe(() => invoke<string | null>("home_dir"), null);
}

const KNOWN_FOLDERS = {
  Desktop: desktopDir, Documents: documentDir, Downloads: downloadDir, Music: audioDir, Pictures: pictureDir, Videos: videoDir,
};
export type KnownFolder = keyof typeof KNOWN_FOLDERS;

/** Where the OS keeps the user's Desktop, Documents, Downloads, Music,
 *  Pictures or Videos folder: OneDrive's copy when it has moved them on
 *  Windows, the localised XDG folders on Linux. When the OS has none set
 *  (Linux without user-dirs.dirs), home plus the English name, as XDG
 *  itself defaults. */
export async function knownFolder(name: KnownFolder): Promise<string | null> {
  const dir = await safe<string | null>(() => KNOWN_FOLDERS[name](), null);
  if (dir) return dir;
  const home = await homeDir();
  return home ? joinPath(home, name) : null;
}

/** Browser-only (dev server, no Tauri): `?mockRows=N` fills every directory
 *  with N synthetic entries so rendering can be profiled without a backend. */
function mockRows(): FileEntry[] {
  const n = Number(new URLSearchParams(window.location.search).get("mockRows"));
  if (!Number.isFinite(n) || n <= 0) return [];
  const kinds = ["text", "code", "img", "archive", "bin"];
  const exts = ["md", "rs", "png", "zip", "dat"];
  const out: FileEntry[] = [];
  for (let i = 0; i < n; i++) {
    const dir = i % 10 === 0;
    out.push({
      // Real entries' names include the extension; match that shape.
      name: dir ? `folder-${i}` : `file-${i}.${exts[i % exts.length]}`,
      path: `/mock/${i}`,
      kind: dir ? "folder" : kinds[i % kinds.length],
      size: (i * 37) % 1_000_000,
      modified_ms: 1_700_000_000_000 + i * 60_000,
      hidden: false,
      ext: dir ? "" : exts[i % exts.length],
      is_symlink: false,
      lossy: false,
      git: i % 23 === 0 ? "M" : null,
    });
  }
  return out;
}

export function listDir(path: string, showHidden: boolean): Promise<FileEntry[]> {
  return safe(
    () => invoke<FileEntry[]>("list_dir", { path, showHidden }),
    mockRows(),
  );
}

/** Like listDir, but rejects when the folder can't be read, so the file pane
 *  can say why instead of looking empty. */
export function readDir(path: string, showHidden: boolean): Promise<FileEntry[]> {
  if (!TAURI_AVAILABLE) return Promise.resolve(mockRows());
  return invoke<FileEntry[]>("list_dir", { path, showHidden });
}

/** What's at `path` now (one stat, following links), or null when nothing
 *  is. "unknown" when the backend can't be asked. */
export function pathKind(path: string): Promise<"folder" | "file" | "unknown" | null> {
  return safe(() => invoke<"folder" | "file" | null>("path_kind", { path }), "unknown");
}

export function drives(): Promise<Drive[]> {
  return safe(() => invoke<Drive[]>("drives"), []);
}

export function listWslDistros(): Promise<WslDistro[]> {
  return safe(() => invoke<WslDistro[]>("list_wsl_distros"), []);
}

export function systemInfo(): Promise<SystemInfo | null> {
  return safe(() => invoke<SystemInfo>("system_info"), null);
}

/** Create a folder. Rejects if the name is already taken (`isAlreadyExists`)
 *  rather than reusing what's there. */
export function makeDir(path: string): Promise<void> {
  return mustInvoke<void>("make_dir", { path });
}

/** Create a folder and any missing parents; an existing one is fine. For
 *  folders the app keeps for itself, not for New Folder. */
export function ensureDir(path: string): Promise<void> {
  return mustInvoke<void>("make_dir", { path, all: true });
}

/** Rename. Rejects if `to` is taken (`isAlreadyExists`); never replaces it. */
export function renameEntry(from: string, to: string): Promise<void> {
  return mustInvoke<void>("rename_entry", { from, to });
}

/** True for the error make_dir, rename_entry and a creating write_text give
 *  when the target name is already taken (kind "exists"), and for undo's own
 *  refusal, worded the same: `"<name>" already exists in <folder>`. */
export function isAlreadyExists(err: unknown): boolean {
  if (errKind(err) === "exists") return true;
  const msg = errText(err);
  return /^".*" already exists in /s.test(msg);
}

/** With `opId` the copy reports progress and can be cancelled (see ops.ts). */
export function copyEntry(from: string, to: string, opId?: string): Promise<void> {
  return mustInvoke<void>("copy_entry", { from, to, opId });
}

export function moveEntry(from: string, to: string): Promise<void> {
  return mustInvoke<void>("move_entry", { from, to });
}

export function deleteEntry(path: string, recursive: boolean): Promise<void> {
  return mustInvoke<void>("delete_entry", { path, recursive });
}

export function readText(path: string, maxBytes: number): Promise<string> {
  return safe(() => invoke<string>("read_text", { path, maxBytes }), "");
}

export function readImageB64(path: string, maxBytes: number = 0): Promise<string> {
  return mustInvoke<string>("read_image_b64", { path, maxBytes });
}

/** The git line for the repo holding `path`. Its dirty count is reused from
 *  a scan that started at most `maxAgeMs` ago, if HEAD and the index haven't
 *  moved since; omitted, the repo is always scanned. */
export function gitStatus(path: string, maxAgeMs?: number): Promise<GitInfo | null> {
  return safe(() => invoke<GitInfo | null>("git_status", { path, maxAgeMs }), null);
}

export function gitBlame(path: string, maxLines: number): Promise<BlameLine[]> {
  return mustInvoke<BlameLine[]>("git_blame", { path, maxLines });
}

export function gitStage(paths: string[]): Promise<void> {
  return mustInvoke<void>("git_stage", { paths });
}

export function gitUnstage(paths: string[]): Promise<void> {
  return mustInvoke<void>("git_unstage", { paths });
}

/** What Discard did (commands/git.rs `DiscardResult`). */
export interface GitDiscardResult {
  /** Files put back as the last commit has them. */
  restored: number;
  /** Untracked files and folders moved to the trash. */
  trashed: number;
  /** Paths left as they were: repo-relative, `/`-separated, with why. */
  skipped: Array<{ path: string; reason: string }>;
}

export function gitDiscard(paths: string[]): Promise<GitDiscardResult> {
  return mustInvoke<GitDiscardResult>("git_discard", { paths });
}

export interface GitRunResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  exit: number;
}

export interface GitBranch {
  name: string;
  current: boolean;
  upstream: string | null;
  ahead: number;
  behind: number;
  /** Upstream is set but its ref is gone; ahead/behind are 0 but not "in sync". */
  upstream_gone: boolean;
  /** A remote-tracking branch (`origin/main`); listed only with `remotes`. */
  remote?: boolean;
}

/** Run a git menu command (git.rs `GIT_RUN_ALLOWED`). With `opId` it reports
 *  progress and can be cancelled (ops.ts); it then rejects with "cancelled". */
export function gitRun(cwd: string, args: string[], opId?: string): Promise<GitRunResult> {
  return mustInvoke<GitRunResult>("git_run", { cwd, args, opId });
}

/** The local branches, then with `remotes` the remote-tracking ones. */
export function gitBranchList(cwd: string, remotes?: boolean): Promise<GitBranch[]> {
  return mustInvoke<GitBranch[]>("git_branch_list", { cwd, remotes });
}

/** One staged file (git.rs `StagedFile`). */
export interface StagedFile {
  /** "A" added, "M" modified, "D" deleted, "R" renamed, "T" type change. */
  code: string;
  /** Repo-relative, `/`-separated. */
  path: string;
  old_path: string | null;
}

/** What the commit dialog shows (git.rs `CommitInfo`). */
export interface CommitInfo {
  branch: string;
  /** At most 500; `staged_total` has the count. */
  staged: StagedFile[];
  staged_total: number;
  /** Changed or untracked items that aren't staged. */
  unstaged: number;
  /** HEAD's message; null on a branch with no commits. */
  head_message: string | null;
}

export function gitCommitInfo(cwd: string): Promise<CommitInfo> {
  return mustInvoke<CommitInfo>("git_commit_info", { cwd });
}

/** Without `opId`, any failure is no matches. With one the search rejects
 *  instead, so a cancel can be told apart from an empty result. */
export function findInFiles(
  root: string,
  query: string,
  caseInsensitive: boolean,
  maxResults: number,
  opId?: string,
): Promise<FindMatch[]> {
  const args = { root, query, caseInsensitive, maxResults, opId };
  if (opId) return mustInvoke<FindMatch[]>("find_in_files", args);
  return safe(() => invoke<FindMatch[]>("find_in_files", args), []);
}

/** What a Find & Replace would change and leave alone. With `opId` it
 *  reports files searched and can be cancelled. */
export function replacePreview(request: ReplaceRequest, opId?: string): Promise<ReplacePlan> {
  return mustInvoke<ReplacePlan>("replace_preview", { request, opId });
}

/** Replace in `paths` (from a preview). A cancel stops between files and
 *  resolves with what was changed (`cancelled` set). */
export function replaceApply(request: ReplaceRequest, paths: string[], keepContent: boolean, opId?: string): Promise<ReplaceOutcome> {
  return mustInvoke<ReplaceOutcome>("replace_apply", { request, paths, keepContent, opId });
}

/** Replace an existing file's text atomically, keeping its permissions, as
 *  Find & Replace writes. Refuses links, special and read-only files. */
export function rewriteText(path: string, content: string): Promise<void> {
  return mustInvoke<void>("rewrite_text", { path, content });
}

/** "inApp" when glasshouse is the desktop's file manager (Preferences →
 *  Integration): the caller selects the item itself rather than opening
 *  another glasshouse window. */
export function revealInExplorer(path: string): Promise<"shown" | "inApp"> {
  return safe(() => invoke<"shown" | "inApp">("reveal_in_explorer", { path }), "shown");
}

/** Hands `paths` to the OS as a drag (copies), to drop into another app.
 *  Call it while the mouse button is still down: under Wayland a drag can
 *  only start then. Rejects when the drag couldn't start. */
export function startDragOut(paths: string[]): Promise<void> {
  return mustInvoke<void>("start_drag_out", { paths });
}

export function spawnTerminal(path: string): Promise<void> {
  return safe(() => invoke<void>("spawn_terminal", { path }), undefined);
}

/** Throws on failure so callers can surface the error (e.g. alert on missing VS Code). */
export function spawnVscodeStrict(path: string): Promise<void> {
  return mustInvoke<void>("spawn_vscode", { path });
}

/** What opening a file with its default app did. */
export interface OpenOutcome {
  /** False when no app is set to open its type. */
  opened: boolean;
  /** The MIME type (Linux) or extension (Windows) looked up; may be "". */
  file_type: string;
}

/** Opens `path` with its default app, or with `asText` the app for plain
 *  text. Throws when the app can't be started; see `openFile` (openWith.ts),
 *  which says so. Resolves null in the browser demo. */
export function openWithDefaultStrict(path: string, asText = false): Promise<OpenOutcome | null> {
  return mustInvoke<OpenOutcome | null>("open_with_default", { path, asText });
}

/** An installed app that can open a file. */
export interface AppChoice {
  /** Linux: the desktop file ID. Windows: the shell's name for the handler. */
  id: string;
  name: string;
  is_default: boolean;
}

/** The apps that can open `path`, its default first. */
export function openWithApps(path: string): Promise<AppChoice[] | null> {
  return mustInvoke<AppChoice[] | null>("open_with_apps", { path });
}

/** Opens `paths` (absolute) with the app `id` from `openWithApps`. */
export function openWithApp(id: string, paths: string[]): Promise<void> {
  return mustInvoke<void>("open_with_app", { id, paths });
}

/** Opens `paths` with `program`, an executable (or, on Linux, a `.desktop`
 *  file) the user picked, started directly with the paths as arguments. */
export function openWithProgram(program: string, paths: string[]): Promise<void> {
  return mustInvoke<void>("open_with_program", { program, paths });
}

/** What Move to Trash did with one path: enough to find the item in the
 *  trash again (commands/trash.rs). */
export interface Trashed {
  /** The path as the trash records it: the real folder plus the name. */
  original: string;
  /** Unix seconds just before and after; the deletion time is between. */
  from: number;
  to: number;
}

/** Names one trashed item: its original path and a deletion-time window,
 *  plus its id when it comes from the Trash view. */
export interface TrashKey {
  original: string;
  from: number;
  to: number;
  id?: string;
}

export interface TrashProblem {
  path: string;
  reason: string;
}

/** What a restore or purge did: the original paths it handled, and what
 *  it left in the trash and why. */
export interface TrashResult {
  done: string[];
  problems: TrashProblem[];
}

/** One item in the trash. */
export interface TrashEntry {
  id: string;
  name: string;
  original_parent: string;
  original: string;
  /** Unix seconds. */
  deleted: number;
  /** A file's size in bytes. */
  size: number | null;
  /** A folder's entry count, not counting what's inside its subfolders. */
  entries: number | null;
}

/** Refused for a path on a Windows drive with no Recycle Bin, where the
 *  system would delete it for good. */
export function moveToTrash(path: string): Promise<Trashed> {
  return mustInvoke<Trashed>("move_to_trash", { path });
}

/** The paths that can't go to the trash (Windows drives with no Recycle
 *  Bin), each with why. Always empty on Linux. */
export function trashUnsupported(paths: string[]): Promise<TrashProblem[]> {
  return mustInvoke<TrashProblem[]>("trash_unsupported", { paths });
}

export function trashList(): Promise<TrashEntry[]> {
  return mustInvoke<TrashEntry[]>("trash_list");
}

/** Put trashed items back. With `allOrNothing`, any refusal (taken path,
 *  item gone) restores nothing. */
export function trashRestore(keys: TrashKey[], allOrNothing: boolean): Promise<TrashResult> {
  return mustInvoke<TrashResult>("trash_restore", { keys, allOrNothing });
}

/** Delete trashed items for good. */
export function trashPurge(keys: TrashKey[]): Promise<TrashResult> {
  return mustInvoke<TrashResult>("trash_purge", { keys });
}

/** The browsable trash folder (`$XDG_DATA_HOME/Trash/files`); null on Windows. */
export function trashDir(): Promise<string | null> {
  return safe(() => invoke<string | null>("trash_dir"), null);
}

export function winToWsl(path: string): Promise<string> {
  return safe(() => invoke<string>("win_to_wsl", { path }), path);
}

/** Create a new file holding `content`. Rejects if the path is taken
 *  (`isAlreadyExists`) instead of emptying what's there. */
export function createTextFile(path: string, content: string): Promise<void> {
  return mustInvoke<void>("write_text", { path, content });
}

/** Save `content` to `path`, replacing the file if it exists. For saving on
 *  purpose; anything new goes through `createTextFile`. */
export function writeText(path: string, content: string): Promise<void> {
  return mustInvoke<void>("write_text", { path, content, overwrite: true });
}

export function watchDir(path: string): Promise<void> {
  return safe(() => invoke<void>("watch_dir", { path }), undefined);
}

export function unwatchDir(path: string): Promise<void> {
  return safe(() => invoke<void>("unwatch_dir", { path }), undefined);
}

export function readPins(): Promise<string[]> {
  return readSavedPins().then(p => p ?? []);
}

/** The pins, or null when none were ever saved (no pins file). */
export function readSavedPins(): Promise<string[] | null> {
  return safe(() => invoke<string[] | null>("read_pins"), []);
}

/** The folders the desktop's own file manager bookmarks (GTK, KDE, Quick
 *  Access), for a first run's pins (places.ts). */
export function desktopPlaces(): Promise<string[]> {
  return safe(() => invoke<string[]>("desktop_places"), []);
}

export function writePins(pins: string[]): Promise<void> {
  return safe(() => invoke<void>("write_pins", { pins }), undefined);
}

/** The saved remotes as last written, in the app config folder; the caller
 *  checks each entry's fields. Rejects when the file can't be read. */
export function readRemotes(): Promise<unknown[]> {
  return mustInvoke<unknown[]>("read_remotes");
}

export function writeRemotes(remotes: readonly object[]): Promise<void> {
  return mustInvoke<void>("write_remotes", { remotes });
}

export function readTags(): Promise<Record<string, string[]>> {
  return safe(() => invoke<Record<string, string[]>>("read_tags"), {});
}

export function writeTags(tags: Record<string, string[]>): Promise<void> {
  return safe(() => invoke<void>("write_tags", { tags }), undefined);
}

export type ArchiveFormat = "zip" | "tar.gz" | "tar.zst" | "7z";

/** An input or archive entry left out, and why. */
export interface ArchiveSkip {
  path: string;
  reason: string;
}

/** What archive creation left out (only zip leaves anything out). */
export interface ArchiveReport {
  skipped: ArchiveSkip[];
}

/** An extraction waiting in its staging folder inside the destination. */
export interface StagedExtract {
  staging: string;
  skipped: ArchiveSkip[];
}

export function archiveCreate(
  paths: string[],
  dest: string,
  format: ArchiveFormat,
): Promise<ArchiveReport> {
  return mustInvoke<ArchiveReport>("archive_create", { paths, dest, format });
}

/** Extract into a new staging folder inside `destDir` (made if missing).
 *  Nothing else is written: move the entries in with runTransfer, then
 *  archiveDiscardStaging. */
export function archiveExtract(archive: string, destDir: string): Promise<StagedExtract> {
  return mustInvoke<StagedExtract>("archive_extract", { archive, destDir });
}

/** Delete a staging folder archiveExtract returned, and what's left in it. */
export function archiveDiscardStaging(staging: string): Promise<void> {
  return mustInvoke<void>("archive_discard_staging", { staging });
}

export function archiveCanHandle(
  format: ArchiveFormat,
): Promise<boolean> {
  return safe(() => invoke<boolean>("archive_can_handle", { format }), false);
}

export function hashSha256(path: string, opId?: string): Promise<string> {
  return mustInvoke<string>("hash_sha256", { path, opId });
}

export function setPermissions(path: string, mode: number): Promise<void> {
  return mustInvoke<void>("set_permissions", { path, mode });
}

export function readHexDump(
  path: string,
  offset: number = 0,
  length: number = 0,
): Promise<string> {
  return mustInvoke<string>("read_hex_dump", { path, offset, length });
}

export function diffFiles(a: string, b: string): Promise<string> {
  return mustInvoke<string>("diff_files", { a, b });
}

/** Like findInFiles: with `opId` it rejects on failure or cancel. */
export function findFileByName(
  root: string,
  pattern: string,
  maxResults: number = 0,
  opId?: string,
): Promise<string[]> {
  const args = { root, pattern, maxResults, opId };
  if (opId) return mustInvoke<string[]>("find_file_by_name", args);
  return safe(() => invoke<string[]>("find_file_by_name", args), []);
}

/** Stop the hash, copy or search running as `opId`; it then rejects with
 *  "cancelled" (`isCancelled` in ops.ts). */
export function cancelOp(opId: string): Promise<void> {
  return safe(() => invoke<void>("cancel_op", { opId }), undefined);
}

export function createSymlink(target: string, linkPath: string): Promise<void> {
  return mustInvoke<void>("create_symlink", { target, linkPath });
}

export function createHardLink(target: string, linkPath: string): Promise<void> {
  return mustInvoke<void>("create_hard_link", { target, linkPath });
}

export function createShortcut(target: string, linkPath: string): Promise<void> {
  return mustInvoke<void>("create_shortcut", { target, linkPath });
}

export function shred(path: string, passes: number = 3): Promise<void> {
  return mustInvoke<void>("shred", { path, passes });
}

export function verifySignature(path: string): Promise<string> {
  return mustInvoke<string>("verify_signature", { path });
}

export function changeOwner(path: string, owner: string): Promise<void> {
  return mustInvoke<void>("change_owner", { path, owner });
}

/** Runs `script` with `targets` as its arguments, in `cwd` if given, and
 *  resolves with its output. A bare program name is looked up on PATH. */
export function runScript(script: string, targets: string[], cwd?: string): Promise<string> {
  return mustInvoke<string>("run_script", { script, targets, cwd });
}

export function openUrl(url: string): Promise<void> {
  return safe(() => invoke<void>("open_url", { url }), undefined);
}

/** Like openUrl, but rejects when the browser couldn't be started. */
export function openUrlStrict(url: string): Promise<void> {
  return mustInvoke<void>("open_url", { url });
}

/** What Report Bug… fills in about this system (diagnostics.rs): nothing
 *  that names the user, the machine or a file. */
export interface SystemReport {
  version: string;
  os: string;
  arch: string;
  desktop: string | null;
  webview: string | null;
}

export function bugReportInfo(): Promise<SystemReport | null> {
  return safe(() => invoke<SystemReport>("bug_report_info"), null);
}

/** The app's log folder, made if it's missing; null in the browser demo. */
export function logDir(): Promise<string | null> {
  return mustInvoke<string | null>("log_dir");
}

/** A new window in this process (src-tauri/src/app_windows.rs): one tab at
 *  home, or `paths` opened as another app's "Show in folder" would. */
export function newWindow(paths?: string[]): Promise<void> {
  return safe(() => invoke<void>("new_window", { paths: paths ?? null }), undefined);
}

/** Quit: every window closes, and all of them come back at the next start. */
export function quitApp(): Promise<void> {
  return safe(() => invoke<void>("quit_app"), undefined);
}

export interface ShellProfile {
  id: string;
  label: string;
  /** "shell" | "wsl" | "ssh" */
  kind: string;
  exec: string;
  args: string[];
}

export function listShellProfiles(): Promise<ShellProfile[]> {
  return safe(() => invoke<ShellProfile[]>("list_shell_profiles"), []);
}

export function spawnTerminalProfile(
  profile: ShellProfile,
  cwd: string,
): Promise<void> {
  return safe(
    () => invoke<void>("spawn_terminal_profile", { profile, cwd }),
    undefined,
  );
}

/** Spawn a PTY in `cwd` running the given shell profile. Returns session id. */
export function ptySpawn(
  profile: ShellProfile,
  cwd: string,
  cols?: number,
  rows?: number,
): Promise<string> {
  return mustInvoke<string>("pty_spawn", { profile, cwd, cols, rows });
}

export function ptyWrite(sessionId: string, data: string): Promise<void> {
  return safe(
    () => invoke<void>("pty_write", { sessionId, data }),
    undefined,
  );
}

export function ptyResize(sessionId: string, cols: number, rows: number): Promise<void> {
  return safe(
    () => invoke<void>("pty_resize", { sessionId, cols, rows }),
    undefined,
  );
}

export function ptyKill(sessionId: string): Promise<void> {
  return safe(() => invoke<void>("pty_kill", { sessionId }), undefined);
}

/** Whether this window's process saves the session: the one started
 *  plainly does, and every window in it (src-tauri/src/session.rs). */
export function sessionOwner(): Promise<boolean> {
  return safe(() => invoke<boolean>("session_owner"), true);
}

/** How a window started with paths opens them (src-tauri/src/startup.rs):
 *  "open" opens a folder or a file's folder with the file selected; "select"
 *  selects each item in its folder (FileManager1.ShowItems); "properties"
 *  also shows the first one's Properties. */
export type LaunchMode = "open" | "select" | "properties";

export interface LaunchRequest {
  mode: LaunchMode;
  paths: string[];
  /** Arguments that couldn't be used, each with why. */
  skipped: string[];
}

/** What a window opens with (src-tauri/src/app_windows.rs): one tab at
 *  home; the paths another app or the command line handed over; its tabs,
 *  saved or as this page last reported them (a reload); or, for the first
 *  window before there's a session file, the tabs in the v1 key. */
export type WindowStartKind =
  | { kind: "plain" }
  | { kind: "launch"; launch: LaunchRequest }
  | { kind: "restore"; session: unknown }
  | { kind: "legacy" };

export interface WindowStart {
  /** This process saves the session; only then is the v1 key written. */
  owner: boolean;
  start: WindowStartKind;
}

export function windowStart(): Promise<WindowStart> {
  return safe(() => invoke<WindowStart>("window_start"), { owner: true, start: { kind: "legacy" } });
}

/** This window's tabs, as saved (session.ts `sessionOf`): the backend keeps
 *  every window's and writes the session file. */
export function sessionReport(session: unknown): Promise<void> {
  return safe(() => invoke<void>("session_report", { session }), undefined);
}

export interface IntegrationFeature {
  on: boolean;
  /** What the desktop does now, in a line. */
  detail: string;
  warning: string | null;
}

export interface IntegrationStatus {
  supported: boolean;
  /** The program the settings start. */
  program: string | null;
  /** Open folders with glasshouse (Linux and Windows). */
  folders: IntegrationFeature | null;
  /** Answer other apps' "Show in folder" (Linux). */
  fileManager: IntegrationFeature | null;
  /** Use glasshouse for other apps' open and save dialogs (Linux). */
  dialogs: IntegrationDialogs | null;
  /** What can't be changed, for a footnote. */
  limits: string[];
}

/** One toolkit opt-in of the dialogs setting (its Advanced part). */
export interface IntegrationToolkit {
  key: "gtk3" | "gtk4" | "qt";
  label: string;
  on: boolean;
  /** What it sets, e.g. `GTK_USE_PORTAL=1`; null when nothing is needed. */
  sets: string | null;
  note: string;
  warning: string | null;
}

export interface IntegrationDialogs extends IntegrationFeature {
  toolkits: IntegrationToolkit[];
  /** Run once as root first (portals older than 1.20.1 without the .deb's file). */
  rootCommand: string | null;
  /** The toolkit settings are written but apply at the next login. */
  pendingLogin: boolean;
}

export type IntegrationKey = "folders" | "fileManager" | "dialogs" | `dialogs.${IntegrationToolkit["key"]}`;

const NO_INTEGRATION: IntegrationStatus = { supported: false, program: null, folders: null, fileManager: null, dialogs: null, limits: [] };

export function integrationStatus(): Promise<IntegrationStatus> {
  return safe(() => invoke<IntegrationStatus>("integration_status"), NO_INTEGRATION);
}

/** Turns a Preferences → Integration setting on or off; the new status. */
export function integrationSet(feature: IntegrationKey, on: boolean): Promise<IntegrationStatus> {
  return mustInvoke<IntegrationStatus>("integration_set", { feature, on });
}

export function readRecent(): Promise<string[]> {
  return safe(() => invoke<string[]>("read_recent"), []);
}

export function appendRecent(path: string): Promise<void> {
  return safe(() => invoke<void>("append_recent", { path }), undefined);
}

export function clearRecent(): Promise<void> {
  return safe(() => invoke<void>("clear_recent"), undefined);
}

/**
 * Open a native directory-picker dialog via the Tauri dialog plugin. Returns
 * the absolute path chosen, or null if the user cancelled.
 */
export async function pickDirectory(defaultPath?: string): Promise<string | null> {
  if (!TAURI_AVAILABLE) return null;
  try {
    const res = await openDialog({
      directory: true,
      multiple: false,
      defaultPath,
    });
    if (res === null || res === undefined) return null;
    if (Array.isArray(res)) return res[0] ?? null;
    return res;
  } catch {
    return null;
  }
}

/** A native file picker for one file (Open With → Choose a program…).
 *  Null if cancelled. */
export async function pickFile(opts: {
  title?: string;
  defaultPath?: string;
  filters?: Array<{ name: string; extensions: string[] }>;
}): Promise<string | null> {
  if (!TAURI_AVAILABLE) return null;
  const res = await openDialog({ directory: false, multiple: false, ...opts });
  if (Array.isArray(res)) return res[0] ?? null;
  return res ?? null;
}

/** A native Save dialog (Preferences → export a theme). Null if cancelled
 *  or outside the app. */
export async function pickSavePath(opts: {
  title?: string;
  defaultPath?: string;
  filters?: Array<{ name: string; extensions: string[] }>;
}): Promise<string | null> {
  if (!TAURI_AVAILABLE) return null;
  return (await saveDialog(opts)) ?? null;
}

export function fileStatExtended(path: string): Promise<FileStatExt | null> {
  return safe(
    () => invoke<FileStatExt>("file_stat_extended", { path }),
    null,
  );
}

export function hashMd5(path: string, opId?: string): Promise<string> {
  return mustInvoke<string>("hash_md5", { path, opId });
}

export function hashCrc32(path: string, opId?: string): Promise<string> {
  return mustInvoke<string>("hash_crc32", { path, opId });
}

export function gitFileInfo(cwd: string, path: string): Promise<GitFileInfo | null> {
  return safe(
    () => invoke<GitFileInfo>("git_file_info", { cwd, path }),
    null,
  );
}

export function pathFsType(path: string): Promise<string> {
  return safe(() => invoke<string>("path_fs_type", { path }), "");
}

export interface Space {
  /** What the user can still write. */
  free: number;
  total: number;
}

/** Free and total space of the volume holding `path`; null when the OS
 *  can't say. */
export function pathSpace(path: string): Promise<Space | null> {
  return safe(() => invoke<Space | null>("path_space", { path }), null);
}

export function netRate(): Promise<NetRate | null> {
  return safe(() => invoke<NetRate>("net_rate"), null);
}

// ---------- the file chooser (another app's open or save dialog) ----------

export type ChooserKind = "open" | "save" | "saveFiles";

export interface ChooserFilter {
  name: string;
  rules: { mime: boolean; pattern: string }[];
}

export interface ChooserChoice {
  id: string;
  label: string;
  /** [id, label] pairs; none: a checkbox, "true" or "false". */
  options: [string, string][];
  initial: string;
}

/** What xdg-desktop-portal asked for (src-tauri/src/chooser.rs). */
export interface ChooserRequest {
  kind: ChooserKind;
  appId: string;
  title: string;
  acceptLabel: string | null;
  multiple: boolean;
  directory: boolean;
  modal: boolean;
  filters: ChooserFilter[];
  currentFilter: number | null;
  choices: ChooserChoice[];
  currentName: string | null;
  currentFolder: string | null;
  currentFile: string | null;
  files: string[];
  parentWindow: string;
  requestedMs: number;
}

export interface ChooserGlob {
  pattern: string;
  caseSensitive: boolean;
}

export interface ChooserView {
  request: ChooserRequest;
  /** Each filter's globs, MIME types turned into theirs. */
  globs: ChooserGlob[][];
}

/** 0 picked, 1 cancelled, 2 ended otherwise. */
export interface ChooserAnswer {
  response: number;
  paths: string[];
  choices: [string, string][];
  currentFilter: number | null;
}

/** The dialog this window is, or null for a normal window. */
export function chooserRequest(): Promise<ChooserView | null> {
  return safe(() => invoke<ChooserView | null>("chooser_request"), null);
}

/** The page has rendered: show the dialog (on the caller's window). */
export function chooserReady(): Promise<void> {
  return safe(() => invoke<void>("chooser_ready"), undefined);
}

/** Its first frame is on screen (logs the time it took). */
export function chooserPainted(): Promise<void> {
  return safe(() => invoke<void>("chooser_painted"), undefined);
}

/** Answers the app and closes the dialog. */
export function chooserFinish(answer: ChooserAnswer): Promise<void> {
  return mustInvoke<void>("chooser_finish", { answer });
}

/** Files and folders under `root` whose name has `pattern` in it. */
export function chooserSearch(root: string, pattern: string, showHidden: boolean, opId: string, limit = 500): Promise<FileEntry[]> {
  return mustInvoke<FileEntry[]>("chooser_search", { root, pattern, showHidden, limit, opId });
}

/** How this copy was installed (src-tauri/src/update.rs): the Windows setup
 *  (nsis, per user) or MSI (per machine), an AppImage, a .deb or .rpm, or
 *  built from source. */
export type InstallKind = "nsis" | "msi" | "appimage" | "deb" | "rpm" | "source";

export interface UpdateInfo {
  version: string;
  install: InstallKind;
  /** glasshouse installs an update itself (else it links to one). */
  canInstall: boolean;
  /** The AppImage's path, when it runs as one. */
  appImage: string | null;
  /** The URL a check fetches. */
  endpoint: string;
  /** The last check that got an answer, in ms since 1970. */
  lastCheck: number | null;
}

export type UpdateCheck =
  | { status: "current"; version: string }
  | {
      status: "available";
      version: string;
      current: string;
      /** RFC 3339, from latest.json. */
      date: string | null;
      notes: string;
      /** The package to download, when the user installs it themselves. */
      download: string | null;
      canInstall: boolean;
    }
  /** An automatic check with nothing to show. */
  | { status: "quiet" };

export type UpdateAvailable = Extract<UpdateCheck, { status: "available" }>;

export interface UpdateProgress {
  got: number;
  total: number | null;
  /** Downloaded and verified; the installer is running. */
  installing: boolean;
}

/** How this copy updates, or null without the backend. */
export function updateInfo(): Promise<UpdateInfo | null> {
  return safe(() => invoke<UpdateInfo>("update_info"), null);
}

/** One request for the latest release's latest.json. `auto`: the automatic
 *  check, which asks at most once a day and reports a version once. Rejects
 *  with the reason in words (offline, no update information…). */
export function updateCheck(auto: boolean): Promise<UpdateCheck> {
  return mustInvoke<UpdateCheck>("update_check", { auto });
}

/** Downloads, verifies and installs the update the last check found; the
 *  app then restarts (or, on Windows, its installer takes over). */
export function updateInstall(): Promise<void> {
  return mustInvoke<void>("update_install");
}

/** Stops the download; refused once the installer has started. */
export function updateCancel(): Promise<void> {
  return mustInvoke<void>("update_cancel");
}

/** Calls `cb` with each `update-progress` event. Returns the cleanup. */
export function onUpdateProgress(cb: (p: UpdateProgress) => void): () => void {
  if (!TAURI_AVAILABLE) return () => {};
  let off: (() => void) | null = null;
  let gone = false;
  listen<UpdateProgress>("update-progress", e => cb(e.payload)).then(u => { if (gone) u(); else off = u; }, () => {});
  return () => { gone = true; off?.(); };
}
