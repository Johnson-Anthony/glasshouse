import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
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
  status: Record<string, string>;
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

export function drives(): Promise<Drive[]> {
  return safe(() => invoke<Drive[]>("drives"), []);
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

export function findInFiles(
  root: string,
  query: string,
  caseInsensitive: boolean,
  maxResults: number,
): Promise<FindMatch[]> {
  return safe(
    () =>
      invoke<FindMatch[]>("find_in_files", {
        root,
        query,
        caseInsensitive,
        maxResults,
      }),
    [],
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

export function hashSha256(path: string): Promise<string> {
  if (!TAURI_AVAILABLE) return Promise.reject(new Error("tauri unavailable"));
  return invoke<string>("hash_sha256", { path });
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
