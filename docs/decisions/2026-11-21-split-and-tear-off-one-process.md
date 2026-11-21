# split-and-tear-off: every window in one process

Date: 2026-11-21. Task: `split-and-tear-off` (survey-3 task 50, phase 2). Plan: `docs/plans/active/split-and-tear-off.md`. Code: `src-tauri/src/app_windows.rs`, the run loop in `lib.rs`, `src/events.ts`. Goes with `2026-11-21-split-and-tear-off-session.md` (what's saved) and `2026-11-21-split-and-tear-off-handoff.md` (a second launch).

## Context
File → New Window started another glasshouse process (`spawn_new_window`). Each process had its own backend: its own folder watches, terminals, op registry and update state, and only the first one saved the session. Phase 3 (tearing a tab off into a window, and dropping one into another window) needs the windows to share one backend, as a browser's do; the cross-process WIP (`claude/split-and-tear-off-xproc-wip`) showed how much a handoff between processes costs for each thing that has to move.

## Chosen
- **One process opens every window**: File → New Window, Open in New Window on a sidebar or breadcrumb folder (which used to open a tab), the command line, a second launch handed off, and the FileManager1 resident. `new_window` is the command; `spawn_new_window` is gone. Only `--chooser` (another app's file dialog) is still a process per dialog.
- **Labels** are `main` and `main-<n>`, the lowest free, up to `main-9999`. The capability (`capabilities/default.json`) matches `main` and `main-*`; the window-state plugin keys each window's size and place by its label. The config's window has `"create": false`, so Tauri makes none of its own: every window, the first too, is made by `app_windows::open` from that config, which keeps one place for the startup ID, the fit to the screen and the registry.
- **Events go to the window they're for.** A page's plain `listen` hears an event emitted to any window, so each page listens with its own window as the target (`listenHere` in `src/events.ts`), and the backend sends with `emit_to` the window's label:
  - `op-progress`: the window that started the op;
  - `pty-data` / `pty-exit`: the window that started the terminal;
  - `fs-changed`: the windows that watch that folder (watches are counted per window and folder; one OS watch serves them all);
  - `config-changed` (new): pins, tags and remotes written by one window, to the others, which read the file again. Tags reread unless a write of their own is out.
  - `update-progress` still goes to every window; only the one with the Updates dialog open shows it.
- **Settings in localStorage** (`glasshouse.tweaks`: theme, zoom, cosmetics) are shared by the browser's `storage` event: a change in one window applies in the others without being written back (`src/useSharedSetting.ts`). Other keys are read when a window opens, as before.
- **A window's backend state goes with it.** When a window closes, or its page loads again (a reload, Import Layout), its folder watches are dropped and its terminals killed (`forget_backend`, logged). Before, a reload leaked them until the process ended.
- **Op ids** have a random part: every window's ops share one registry now, and two windows opening in the same millisecond would otherwise pick the same ids, so Cancel in one could stop the other's.
- **The automatic update check** runs once: each window's page asks, and the first one's check makes the others not due (`2026-11-21-split-and-tear-off-session.md`).
- **Closing and quitting.** Closing the last window ends the app. Quit (Ctrl+Q, `quit_app`) ends it with every window, and every window stays in the session; before, it closed only that window's process.
- **Commands that make windows are async** (`#[tauri::command(async)]`): on Windows, making a WebView2 window from a command on the main thread deadlocks.

## Trade-off: one panic closes every window
Release builds have `panic = "abort"` (Cargo.toml), so a panic anywhere in the backend ends the process, and now that's every window, not one. Kept, because unwinding through Tauri's and GTK's callbacks isn't something the app is written for, and an abort is what task 33 planned around: its panic hook logs the panic with where it happened and shows the crash box with the log's location (`2026-11-20-diagnostics-and-errors-design.md`). The session written half a second after each change is what comes back on the next start. If panics turn up in the log, unwinding per command is the thing to look at.

## Not done
- Tear-off (dragging a tab out into a window, or into another window) is phase 3.
- macOS isn't a target (owner decision D6), so its Dock "new window" and reopen events aren't handled.
- The Windows paths in `app_windows.rs` (WebView2 windows made from the handoff thread, focus through `AllowSetForegroundWindow`) are first built by the windows-latest CI job and checked by hand (docs/testing/windows.md).
