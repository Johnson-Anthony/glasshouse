// Backend events meant for this window. Every glasshouse window is in one
// process (src-tauri/src/app_windows.rs), and the backend sends a window's
// events to it alone: `fs-changed` to the windows watching that folder,
// `pty-data`/`pty-exit` to the terminal's window, `op-progress` to the
// window that started the op, `config-changed` to the windows that didn't
// write. A plain `listen` hears them all, since its target is any window;
// `listenHere` hears this window's.

import { listen, type EventCallback, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

/** This window's label (`main`, `main-2`, …); "main" without Tauri. */
export function windowLabel(): string {
  try {
    return getCurrentWindow().label;
  } catch {
    return "main";
  }
}

/** `listen`, for the events sent to this window. */
export function listenHere<T>(event: string, handler: EventCallback<T>): Promise<UnlistenFn> {
  return listen<T>(event, handler, { target: { kind: "WebviewWindow", label: windowLabel() } });
}
