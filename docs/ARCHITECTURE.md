# Architecture

Snapshot from the 2026-11-08 survey. Line numbers will drift, so search by name.

## Layout
| Path | What |
|---|---|
| `src/main.tsx` → `src/App.tsx` | Entry point and the `App()` shell: state, keybindings, command routing, drag and drop, layout |
| `src/components.tsx` (~6k lines) | Most UI: Titlebar and menus, Toolbar, Sidebar, FilePane, previews and QuickLook, Inspector, StatusBar, Palette, ContextMenu, every dialog, `dialogs` API and DialogHost, FolderPicker |
| `src/state.ts` | `useTabState` (per-tab state, history, fs watching) and the undo/redo stacks |
| `src/handlers/*.ts` | Command handlers split by area (nav, selection, view, git, archive, tools, misc), chained in `handlers/index.ts` |
| `src/data.ts` | Menu, palette and context-menu trees; Windows-only item stripping |
| `src/api.ts` | Typed wrappers over `invoke`. `safe()` swallows errors and returns a fallback |
| `src/paths.ts`, `shellCd.ts`, `fuzzy.ts`, `platform.ts` | Pure helpers; these are what the vitest suite covers |
| `src/Terminal.tsx`, `src/Miller.tsx` | xterm drawer, miller-column view |
| `src/styles/themes.css`, `app.css` | 8 themes as CSS variables on `[data-theme]`; layout and component CSS |
| `src-tauri/src/lib.rs` | Plugin setup, managed state, registration of every command (`generate_handler!`; `build.rs` checks it against `permissions/app.toml`) |
| `src-tauri/src/commands.rs` (~3.1k lines) | Nearly all `#[tauri::command]`s, divided by `// ---------- … ----------` section headers; unit tests at the end |
| `src-tauri/src/pty.rs`, `watcher.rs` | Terminal sessions (portable-pty; each session has a reader thread, a wait thread and a writer thread that `pty_write` queues input onto) and directory watching (notify, 300 ms debounce) |
| `src-tauri/capabilities/default.json` | What the main window may call: plugin permissions (fs, shell, dialog, os, opener) and the app permissions |
| `src-tauri/permissions/app.toml` | App command permissions, grouped (files-read, files-write, git, settings, launch, exec). `build.rs` fails the build if a command in `generate_handler!` isn't in one |

## Frontend
- **State:** there's no store or reducer. `App()` holds about 45 `useState` hooks, and display tweaks persist in `localStorage["glasshouse.tweaks"]`.
  - Each tab is a headless `<TabShell>` running `useTabState` and passing `{state, actions}` up into `tabHandles`.
  - Clipboard, context target, undo stacks, the `dialogs` API and the git cwd are module-level variables.
  - Components also signal each other with window events (`glasshouse:*`) and attributes on `<html>`.
- **Commands are identified by their display label.** Menus, palette, context menus and the keydown handler all send a label string to `handleMenuCommand`:
  1. the right-click target switch;
  2. a global switch;
  3. `doFileOp`;
  4. the selection switch;
  5. the `HANDLERS` chain, where the first handler to return true wins;
  6. a "not yet wired" message if nothing handled it.

  Dynamic menu items carry a `payload` and go to `handleMenuPayload` instead. Renaming a menu label breaks routing unless every switch is updated too.
- **Refresh:** `watch_dir` plus the `fs-changed` event, with a 30 s backup poll.
- **Platform:** `IS_WINDOWS` comes from the user agent. Path helpers guess the separator from the string itself.

## Backend
- Commands return `Result<T, String>`. Some return `Option`, or a default value, on failure.
- Events sent to the frontend: `fs-changed` (parent dir), `pty-data` `{session_id,data}`, `pty-exit` `{session_id,exit_code}`. Long operations send no progress events.
- **Threading:** commands that do I/O are `#[tauri::command(async)]`, so they run on Tauri's tokio workers, in parallel and finishing in any order. Commands that rely on call order stay plain `#[tauri::command]` and run on the main thread, one at a time: config read/write (pins, tags, recents), `watch_dir`/`unwatch_dir`, `pty_write`/`pty_resize`/`pty_kill`, and a few instant ones. A new command that does I/O should be `(async)`. See `docs/decisions/2026-11-08-async-commands-threading.md`.
- Platform splits: `cfg(windows)` covers Win32 drives, hidden attributes, WSL, shortcuts, signatures and `cmd /C` launching. `cfg(not(windows))` covers sysinfo drives, `xdg-open`, terminal discovery (`$TERMINAL`, kitty, alacritty, foot…) and the `/proc` parsers.
- Config data (pins, tags, recents) is stored as JSON in the app config dir, with atomic writes.
- Every command, app or plugin, is ACL-checked: only the `main` window's own (local) pages can call them. **Adding a command means adding it to `permissions/app.toml`**, or the build fails. Commands that start programs check their arguments (`check_profile`, `check_git_args`, `check_open_url`), and none puts user strings on a `cmd.exe` or PowerShell command line. See `docs/decisions/2026-11-08-command-security-design.md`.
