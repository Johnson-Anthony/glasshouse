// The page's side of the log file (diagnostics.rs): errors the user saw or
// that nothing caught, so a bug report's log says what happened. Lines land
// in glasshouse.log under the "webview" target. Without Tauri (vite dev in a
// browser, tests) nothing is written.

import { error as pluginError, warn as pluginWarn } from "@tauri-apps/plugin-log";
import { TAURI_AVAILABLE } from "./api";
import { BackendError, errText } from "./errors";

export function logError(message: string): void {
  if (TAURI_AVAILABLE) pluginError(message).catch(() => {});
}

export function logWarn(message: string): void {
  if (TAURI_AVAILABLE) pluginWarn(message).catch(() => {});
}

/** `err` as one log line: a backend error's raw detail, a JS error's stack. */
export function describeForLog(err: unknown): string {
  if (err instanceof BackendError) return `${err.message} [${err.kind}] ${err.detail}`;
  if (err instanceof Error) return err.stack && err.stack.includes(err.message) ? err.stack : `${err.message}\n${err.stack ?? ""}`;
  return errText(err);
}

/** Logs what nothing caught: uncaught errors and unhandled rejections. It
 *  shows nothing (a dialog for each would be noise) and doesn't stop them
 *  reaching the console. Once, at startup. */
export function logUncaught(): void {
  window.addEventListener("error", (e) => {
    logError(`uncaught: ${e.error ? describeForLog(e.error) : e.message} (${e.filename}:${e.lineno})`);
  });
  window.addEventListener("unhandledrejection", (e) => {
    logError(`unhandled rejection: ${describeForLog(e.reason)}`);
  });
}
