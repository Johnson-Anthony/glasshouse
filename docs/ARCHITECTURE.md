# Architecture

Snapshot from the 2026-11-08 survey. Line numbers will drift, so search by name.

## Layout
| Path | What |
|---|---|
| `src/main.tsx` → `src/App.tsx` | Entry point and the `App()` shell: state, the keydown listener, the command router, drag and drop, layout |
| `src/keymap.ts` | Window keyboard shortcuts as a table (`KEYMAP`); also feeds the Keybindings cheatsheet |
| `src/components.tsx` (~1.1k lines) | Titlebar, Toolbar, FilePane, StatusBar, Palette, Tweaks |
| `src/menus.tsx`, `src/Sidebar.tsx` | Menubar, its dropdowns and the context menu (with dynamic menu items); the Sidebar |
| `src/preview/` | `Inspector.tsx` (the inspector card, permissions grid); `FilePreview.tsx` (type-aware previews and Quick Look) |
| `src/dialogs/` | One file per dialog. `DialogHost.tsx` holds the `dialogs` prompt/alert/confirm/toast API and its host |
| `src/state.ts` | `useTabState` (per-tab state, history, fs watching) and the undo/redo stacks |
| `src/handlers/*.ts` | Command handlers, chained in `handlers/index.ts` as `COMMAND_CHAIN`: `target` (context-menu target), `app` (App-level commands), `fileOps` (file ops on the active tab), then the feature handlers in `HANDLERS` (selection, view, git, archive, tools, nav, misc) |
| `src/data.ts` | Menu, palette and context-menu trees; Windows-only item stripping |
| `src/api.ts` | Typed wrappers over `invoke`. `safe()` swallows errors and returns a fallback |
| `src/paths.ts`, `shellCd.ts`, `fuzzy.ts`, `platform.ts` | Pure helpers; these are what the vitest suite covers |
| `src/Terminal.tsx`, `src/Miller.tsx` | xterm drawer, miller-column view |
| `src/styles/themes.css`, `app.css` | 8 themes as CSS variables on `[data-theme]`; layout and component CSS |
| `src-tauri/src/lib.rs` | Plugin setup, managed state, registration of every command (`generate_handler!`; `build.rs` checks it against `permissions/app.toml`) |
| `src-tauri/src/commands.rs` → `commands/` | Nearly all `#[tauri::command]`s, one module per area: `listing`, `fs_ops`, `file_info`, `search`, `archive`, `hash`, `git`, `config`, `system`, `wsl`, `launch`. Tests are inline at the end of each module, plus `<module>_tests.rs` siblings; shared test helpers are in `commands/testing.rs` |
| `src-tauri/src/pty.rs` (+ `pty/profiles.rs`: `ShellProfile`, shell/WSL/ssh detection, `check_profile`), `watcher.rs` | Terminal sessions (portable-pty; each session has a reader thread, a wait thread and a writer thread that `pty_write` queues input onto; when a session ends on unix, `unblock_writer` drains the slave if that writer is stuck on a full pty) and directory watching (notify, 300 ms debounce) |
| `src-tauri/src/proc_tree.rs` | Spawns a process so its whole tree can be killed (Unix process group / Windows job object). `run_script` uses it at its 60 s timeout |
| `src-tauri/capabilities/default.json` | What the main window may call: plugin permissions (fs, shell, dialog, os, opener) and the app permissions |
| `src-tauri/permissions/app.toml` | App command permissions, grouped (files-read, files-write, git, settings, launch, exec). `build.rs` fails the build if a command in `generate_handler!` isn't in one |

## Frontend
- **State:** there's no store or reducer. `App()` holds about 45 `useState` hooks, and display tweaks persist in `localStorage["glasshouse.tweaks"]`.
  - Each tab is a headless `<TabShell>` running `useTabState` and passing `{state, actions}` up into `tabHandles`.
  - The app clipboard and the context-menu target are in `cmdState` (`src/commandState.ts`). The undo stacks, the `dialogs` API and the git cwd are module-level variables.
  - Components also signal each other with window events (`glasshouse:*`) and attributes on `<html>`.
- **Commands are identified by their display label.** Menus, the palette, context menus and `KEYMAP` bindings all send a label string to App's `handleMenuCommand`. It builds a `HandlerCtx` (with App's state and setters as `ctx.app`) and runs `COMMAND_CHAIN`:
  1. `targetHandler`: commands for the surface a context menu was opened on (`cmdState.contextTarget`);
  2. `appHandler`: App-level commands (panels, dialogs, tabs, window, theme);
  3. `fileOpsHandler`: file ops on the active tab. With no tab it takes every label, so nothing later runs. It refuses mutating ops on lossy names;
  4. the feature handlers in `HANDLERS`.

  The first handler to return true wins, and a "not yet wired" toast shows if none does. A handler that returns a plain boolean runs synchronously. The router catches errors and shows them in a dialog. See `docs/decisions/2026-11-10-split-big-files-app-routing.md`.

  Dynamic menu items carry a `payload` and go to `handleMenuPayload` instead. Renaming a menu label breaks routing unless every case is updated too; `pnpm check:wiring` catches the mismatch.
- **Refresh:** `watch_dir` plus the `fs-changed` event, with a 30 s backup poll.
- **Platform:** `IS_WINDOWS` comes from the user agent. Path helpers guess the separator from the string itself.

## Backend
- Commands return `Result<T, String>`. Some return `Option`, or a default value, on failure.
- Events sent to the frontend: `fs-changed` (parent dir), `pty-data` `{session_id,data}`, `pty-exit` `{session_id,exit_code}`. Long operations send no progress events.
- **Threading:** commands that do I/O are `#[tauri::command(async)]`, so they run on Tauri's tokio workers, in parallel and finishing in any order. Commands that rely on call order stay plain `#[tauri::command]` and run on the main thread, one at a time: config read/write (pins, tags, recents), `watch_dir`/`unwatch_dir`, `pty_write`/`pty_resize`/`pty_kill`, and a few instant ones. A new command that does I/O should be `(async)`. See `docs/decisions/2026-11-08-async-commands-threading.md`.
- Platform splits: `cfg(windows)` covers Win32 drives, hidden attributes, WSL, shortcuts, signatures and `cmd /C` launching. `cfg(not(windows))` covers sysinfo drives, `xdg-open`, terminal discovery (`$TERMINAL`, kitty, alacritty, foot…) and the `/proc` parsers.
- Config data (pins, tags, recents) is stored as JSON in the app config dir, with atomic writes.
- Every command, app or plugin, is ACL-checked: only the `main` window's own (local) pages can call them. **Adding a command means adding it to `permissions/app.toml`**, or the build fails. Commands that start programs check their arguments (`check_profile`, `check_git_args`, `check_open_url`), and none puts user strings on a `cmd.exe` or PowerShell command line. See `docs/decisions/2026-11-08-command-security-design.md`.

## Project site (`docs/` on GitHub Pages)
- `docs/index.html` with `docs/assets/site.css` and `site.js` is the landing page, hand-written with no build step. It uses the app's theme tokens (`docs/assets/themes.css`, copied from `src/styles/themes.css` by the site build), so the theme picker sets `data-theme` on `<html>`.
- `site/demo/` is a browser demo of the real UI: `main.tsx` installs `@tauri-apps/api/mocks` before importing `App`. `mock/` holds an in-memory filesystem, a pretend git repo and shell, and one handler per Tauri command. `scenes.ts` holds the scripted walkthroughs. `pnpm site:build` (`vite.site.config.ts`) builds it into `docs/demo/`, which is committed.
- `site/capture/capture.mjs` serves `docs/` like Pages and drives headless Chromium over the DevTools protocol. It records the hero images and tour clips into `docs/media/` (needs chromium and ffmpeg), takes review shots (`page`) and runs behavior checks (`check`).
- Pages runs Jekyll (there's no `.nojekyll`), and `docs/_config.yml` keeps the working docs off the site. Built asset names never start with `_` or `.`.
- After UI changes, run `pnpm site:build`, then `pnpm site:capture` to refresh the images and clips, then `pnpm site:capture check`.
