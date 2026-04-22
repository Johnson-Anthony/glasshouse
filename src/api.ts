import { invoke } from "@tauri-apps/api/core";

export interface FileEntry {
  name: string;
  path: string;
  kind: string;
  size: number;
  modified_ms: number;
  hidden: boolean;
  ext: string;
  is_symlink: boolean;
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

export function openWithDefault(path: string): Promise<void> {
  return safe(() => invoke<void>("open_with_default", { path }), undefined);
}

export function revealInExplorer(path: string): Promise<void> {
  return safe(() => invoke<void>("reveal_in_explorer", { path }), undefined);
}

export function winToWsl(path: string): Promise<string> {
  return safe(() => invoke<string>("win_to_wsl", { path }), path);
}

export function wslToWin(path: string): Promise<string> {
  return safe(() => invoke<string>("wsl_to_win", { path }), path);
}
