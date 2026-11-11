import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { errText } from "./errors";

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
  dirty: number;
  /** Repo-relative path → the same single-char code as `FileEntry.git`. */
  status: Record<string, string>;
}

export interface FileStatExt {
  created_ms: number | null;
  modified_ms: number | null;
  owner: string | null;
  file_index: number | null;
  readonly: boolean;
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
 *  when the target name is already taken. The backend words it
 *  `"<name>" already exists in <folder>` (`no_clobber_err`). */
export function isAlreadyExists(err: unknown): boolean {
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

export function gitStatus(path: string): Promise<GitInfo | null> {
  return safe(() => invoke<GitInfo | null>("git_status", { path }), null);
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

export function gitDiscard(paths: string[]): Promise<void> {
  return mustInvoke<void>("git_discard", { paths });
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
}

export function gitRun(cwd: string, args: string[]): Promise<GitRunResult> {
  return mustInvoke<GitRunResult>("git_run", { cwd, args });
}

export function gitBranchList(cwd: string): Promise<GitBranch[]> {
  return mustInvoke<GitBranch[]>("git_branch_list", { cwd });
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

export function openWithDefault(path: string): Promise<void> {
  return safe(() => invoke<void>("open_with_default", { path }), undefined);
}

export function revealInExplorer(path: string): Promise<void> {
  return safe(() => invoke<void>("reveal_in_explorer", { path }), undefined);
}

export function spawnTerminal(path: string): Promise<void> {
  return safe(() => invoke<void>("spawn_terminal", { path }), undefined);
}

export function spawnVscode(path: string): Promise<void> {
  return safe(() => invoke<void>("spawn_vscode", { path }), undefined);
}

/** Throws on failure so callers can surface the error (e.g. alert on missing VS Code). */
export function spawnVscodeStrict(path: string): Promise<void> {
  return mustInvoke<void>("spawn_vscode", { path });
}

/** Throws on failure so callers can surface the error. */
export function openWithDefaultStrict(path: string): Promise<void> {
  return mustInvoke<void>("open_with_default", { path });
}

export function moveToTrash(path: string): Promise<void> {
  return mustInvoke<void>("move_to_trash", { path });
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
  return safe(() => invoke<string[]>("read_pins"), []);
}

export function writePins(pins: string[]): Promise<void> {
  return safe(() => invoke<void>("write_pins", { pins }), undefined);
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

export function runScript(script: string, targets: string[]): Promise<string> {
  return mustInvoke<string>("run_script", { script, targets });
}

export function openUrl(url: string): Promise<void> {
  return safe(() => invoke<void>("open_url", { url }), undefined);
}

export function spawnNewWindow(): Promise<void> {
  return safe(() => invoke<void>("spawn_new_window"), undefined);
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

export function netRate(): Promise<NetRate | null> {
  return safe(() => invoke<NetRate>("net_rate"), null);
}
