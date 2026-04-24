import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open as openDialog } from "@tauri-apps/plugin-dialog";

export async function winClose(): Promise<void> {
  if (!TAURI_AVAILABLE_SYNC()) return;
  try { await getCurrentWindow().close(); } catch {}
}

export async function winMinimize(): Promise<void> {
  if (!TAURI_AVAILABLE_SYNC()) return;
  try { await getCurrentWindow().minimize(); } catch {}
}

export async function winToggleMaximize(): Promise<void> {
  if (!TAURI_AVAILABLE_SYNC()) return;
  try { await getCurrentWindow().toggleMaximize(); } catch {}
}

function TAURI_AVAILABLE_SYNC(): boolean {
  return typeof window !== "undefined" &&
    (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ !== undefined;
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
  /** Single-char git status: "M"|"A"|"D"|"U"|"?"|"!" or null. */
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

export function ping(): Promise<string> {
  return safe(() => invoke<string>("ping"), "");
}

export function homeDir(): Promise<string | null> {
  return safe(() => invoke<string | null>("home_dir"), null);
}

export function listDir(path: string, showHidden: boolean): Promise<FileEntry[]> {
  return safe(
    () => invoke<FileEntry[]>("list_dir", { path, showHidden }),
    [],
  );
}

export async function pathIsDir(path: string): Promise<boolean> {
  if (!TAURI_AVAILABLE) return false;
  try {
    await invoke<FileEntry[]>("list_dir", { path, showHidden: true });
    return true;
  } catch {
    return false;
  }
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

export function makeDir(path: string): Promise<void> {
  return safe(() => invoke<void>("make_dir", { path }), undefined);
}

export function renameEntry(from: string, to: string): Promise<void> {
  return safe(() => invoke<void>("rename_entry", { from, to }), undefined);
}

export function copyEntry(from: string, to: string): Promise<void> {
  return safe(() => invoke<void>("copy_entry", { from, to }), undefined);
}

export function moveEntry(from: string, to: string): Promise<void> {
  return safe(() => invoke<void>("move_entry", { from, to }), undefined);
}

export function deleteEntry(path: string, recursive: boolean): Promise<void> {
  return safe(() => invoke<void>("delete_entry", { path, recursive }), undefined);
}

export function readText(path: string, maxBytes: number): Promise<string> {
  return safe(() => invoke<string>("read_text", { path, maxBytes }), "");
}

export function readImageB64(path: string, maxBytes: number = 0): Promise<string> {
  if (!TAURI_AVAILABLE) return Promise.reject(new Error("tauri unavailable"));
  return invoke<string>("read_image_b64", { path, maxBytes });
}

export function gitStatus(path: string): Promise<GitInfo | null> {
  return safe(() => invoke<GitInfo | null>("git_status", { path }), null);
}

export function gitBlame(path: string, maxLines: number): Promise<BlameLine[]> {
  if (!TAURI_AVAILABLE) return Promise.reject(new Error("tauri unavailable"));
  return invoke<BlameLine[]>("git_blame", { path, maxLines });
}

export function gitStage(paths: string[]): Promise<void> {
  if (!TAURI_AVAILABLE) return Promise.reject(new Error("tauri unavailable"));
  return invoke<void>("git_stage", { paths });
}

export function gitUnstage(paths: string[]): Promise<void> {
  if (!TAURI_AVAILABLE) return Promise.reject(new Error("tauri unavailable"));
  return invoke<void>("git_unstage", { paths });
}

export function gitDiscard(paths: string[]): Promise<void> {
  if (!TAURI_AVAILABLE) return Promise.reject(new Error("tauri unavailable"));
  return invoke<void>("git_discard", { paths });
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
}

export function gitRun(cwd: string, args: string[]): Promise<GitRunResult> {
  if (!TAURI_AVAILABLE) return Promise.reject(new Error("tauri unavailable"));
  return invoke<GitRunResult>("git_run", { cwd, args });
}

export function gitBranchList(cwd: string): Promise<GitBranch[]> {
  if (!TAURI_AVAILABLE) return Promise.reject(new Error("tauri unavailable"));
  return invoke<GitBranch[]>("git_branch_list", { cwd });
}

export function gitAheadBehind(cwd: string): Promise<[number, number]> {
  if (!TAURI_AVAILABLE) return Promise.reject(new Error("tauri unavailable"));
  return invoke<[number, number]>("git_ahead_behind", { cwd });
}

export function findInFiles(
  root: string,
  query: string,
  caseInsensitive: boolean,
  maxResults: number,
  ticket?: number,
): Promise<FindMatch[]> {
  return safe(
    () =>
      invoke<FindMatch[]>("find_in_files", {
        root,
        query,
        caseInsensitive,
        maxResults,
        ticket: ticket ?? 0,
      }),
    [],
  );
}

export function cancelFindInFiles(): Promise<void> {
  return safe(() => invoke<void>("cancel_find_in_files"), undefined);
}

// Streaming event plumbing. The backend emits a `find-in-files:match`
// event per match as it is found and a `find-in-files:done` event when
// the walk terminates. Both carry a numeric `ticket` so the UI can
// ignore events from a superseded search.
export function onFindMatch(
  cb: (ticket: number, match: FindMatch) => void,
): Promise<UnlistenFn> {
  if (!TAURI_AVAILABLE) return Promise.resolve(() => {});
  return listen<{ ticket: number; match: FindMatch }>(
    "find-in-files:match",
    (e) => cb(e.payload.ticket, e.payload.match),
  );
}

export function onFindDone(
  cb: (ticket: number, reason: string) => void,
): Promise<UnlistenFn> {
  if (!TAURI_AVAILABLE) return Promise.resolve(() => {});
  return listen<{ ticket: number; reason: string }>(
    "find-in-files:done",
    (e) => cb(e.payload.ticket, e.payload.reason),
  );
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
  if (!TAURI_AVAILABLE) return Promise.reject(new Error("tauri unavailable"));
  return invoke<void>("spawn_vscode", { path });
}

/** Throws on failure so callers can surface the error. */
export function openWithDefaultStrict(path: string): Promise<void> {
  if (!TAURI_AVAILABLE) return Promise.reject(new Error("tauri unavailable"));
  return invoke<void>("open_with_default", { path });
}

export function moveToTrash(path: string): Promise<void> {
  return safe(() => invoke<void>("move_to_trash", { path }), undefined);
}

export function winToWsl(path: string): Promise<string> {
  return safe(() => invoke<string>("win_to_wsl", { path }), path);
}

export function wslToWin(path: string): Promise<string> {
  return safe(() => invoke<string>("wsl_to_win", { path }), path);
}

export function writeText(path: string, content: string): Promise<void> {
  return safe(() => invoke<void>("write_text", { path, content }), undefined);
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

export function compress(paths: string[], output: string): Promise<void> {
  if (!TAURI_AVAILABLE) return Promise.reject(new Error("tauri unavailable"));
  return invoke<void>("compress", { paths, output });
}

export function archiveCreate(
  paths: string[],
  dest: string,
  format: "zip" | "tar.gz" | "tar.zst" | "7z",
): Promise<void> {
  if (!TAURI_AVAILABLE) return Promise.reject(new Error("tauri unavailable"));
  return invoke<void>("archive_create", { paths, dest, format });
}

export function archiveExtract(archive: string, destDir: string): Promise<void> {
  if (!TAURI_AVAILABLE) return Promise.reject(new Error("tauri unavailable"));
  return invoke<void>("archive_extract", { archive, destDir });
}

export function archiveCanHandle(
  format: "zip" | "tar.gz" | "tar.zst" | "7z",
): Promise<boolean> {
  return safe(() => invoke<boolean>("archive_can_handle", { format }), false);
}

export function hashSha256(path: string): Promise<string> {
  if (!TAURI_AVAILABLE) return Promise.reject(new Error("tauri unavailable"));
  return invoke<string>("hash_sha256", { path });
}

export function setPermissions(path: string, mode: number): Promise<void> {
  if (!TAURI_AVAILABLE) return Promise.reject(new Error("tauri unavailable"));
  return invoke<void>("set_permissions", { path, mode });
}

export function readHexDump(
  path: string,
  offset: number = 0,
  length: number = 0,
): Promise<string> {
  if (!TAURI_AVAILABLE) return Promise.reject(new Error("tauri unavailable"));
  return invoke<string>("read_hex_dump", { path, offset, length });
}

export function diffFiles(a: string, b: string): Promise<string> {
  if (!TAURI_AVAILABLE) return Promise.reject(new Error("tauri unavailable"));
  return invoke<string>("diff_files", { a, b });
}

export function findFileByName(
  root: string,
  pattern: string,
  maxResults: number = 0,
): Promise<string[]> {
  return safe(
    () => invoke<string[]>("find_file_by_name", { root, pattern, maxResults }),
    [],
  );
}

export function createSymlink(target: string, linkPath: string): Promise<void> {
  if (!TAURI_AVAILABLE) return Promise.reject(new Error("tauri unavailable"));
  return invoke<void>("create_symlink", { target, linkPath });
}

export function createHardLink(target: string, linkPath: string): Promise<void> {
  if (!TAURI_AVAILABLE) return Promise.reject(new Error("tauri unavailable"));
  return invoke<void>("create_hard_link", { target, linkPath });
}

export function createShortcut(target: string, linkPath: string): Promise<void> {
  if (!TAURI_AVAILABLE) return Promise.reject(new Error("tauri unavailable"));
  return invoke<void>("create_shortcut", { target, linkPath });
}

export function shred(path: string, passes: number = 3): Promise<void> {
  if (!TAURI_AVAILABLE) return Promise.reject(new Error("tauri unavailable"));
  return invoke<void>("shred", { path, passes });
}

export function verifySignature(path: string): Promise<string> {
  if (!TAURI_AVAILABLE) return Promise.reject(new Error("tauri unavailable"));
  return invoke<string>("verify_signature", { path });
}

export function changeOwner(path: string, owner: string): Promise<void> {
  if (!TAURI_AVAILABLE) return Promise.reject(new Error("tauri unavailable"));
  return invoke<void>("change_owner", { path, owner });
}

export function runScript(script: string, targets: string[]): Promise<string> {
  if (!TAURI_AVAILABLE) return Promise.reject(new Error("tauri unavailable"));
  return invoke<string>("run_script", { script, targets });
}

export function openUrl(url: string): Promise<void> {
  return safe(() => invoke<void>("open_url", { url }), undefined);
}

export function spawnNewWindow(): Promise<void> {
  return safe(() => invoke<void>("spawn_new_window"), undefined);
}

export function setAlwaysOnTop(enabled: boolean): Promise<void> {
  return safe(() => invoke<void>("set_always_on_top", { enabled }), undefined);
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
  if (!TAURI_AVAILABLE) return Promise.reject(new Error("tauri unavailable"));
  return invoke<string>("pty_spawn", { profile, cwd, cols, rows });
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

export function hashMd5(path: string): Promise<string> {
  if (!TAURI_AVAILABLE) return Promise.reject(new Error("tauri unavailable"));
  return invoke<string>("hash_md5", { path });
}

export function hashCrc32(path: string): Promise<string> {
  if (!TAURI_AVAILABLE) return Promise.reject(new Error("tauri unavailable"));
  return invoke<string>("hash_crc32", { path });
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
