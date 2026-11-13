# Architecture

How glasshouse works as of 2026-11-10. Search by name; line numbers drift.

## The shape of it
A Tauri 2 app. The window is a React 18 UI (`src/`) that calls Rust commands (`src-tauri/src/`) through `invoke`. The Rust side does all file-system, git, archive, process and terminal work, and sends events back (`fs-changed`, `pty-data`, `pty-exit`, `op-progress`). There's no server and no database: state lives in React, plus small JSON config files and `localStorage`.

**Where to start reading:**
1. `src/App.tsx`, the shell;
2. `src/handlers/index.ts`, where commands go;
3. `src/api.ts`, the backend surface;
4. `src-tauri/src/lib.rs`, the command registry, then the `commands/` module you need.

## Frontend (`src/`)
| Path | What |
|---|---|
| `main.tsx` → `App.tsx` | The shell: tabs, panels, dialogs, theme, drag and drop, the keydown listener, and `handleMenuCommand`, the command router |
| `components.tsx` | Titlebar, Toolbar, FilePane (the file list), StatusBar, Palette, Tweaks |
| `menus.tsx`, `Sidebar.tsx`, `Miller.tsx`, `Terminal.tsx` | Menubar and context menu; the sidebar (pins, tree, tags, devices); the miller-column view; the xterm drawer |
| `preview/` | `Inspector.tsx` (details, permissions, checksums) and `FilePreview.tsx` (type-aware previews and Quick Look) |
| `dialogs/` | One file per dialog. `DialogHost.tsx` holds the promise-based `dialogs` API (prompt, alert, confirm, toast) and its host |
| `state.ts` | `useTabState`: per-tab listing, selection, sort, history (`history.ts`) and fs watching. Also the undo and redo stacks |
| `handlers/` | Command handlers, chained as `COMMAND_CHAIN` in `index.ts`: `target` (context-menu target), `app` (App-level), `fileOps` (file ops on the active tab), then the feature handlers in `HANDLERS` (selection, view, git, archive, tools, nav, misc). `types.ts` defines `HandlerCtx` |
| `keymap.ts` | Window shortcuts as a table (`KEYMAP`), which also feeds the Keybindings cheatsheet |
| `data.ts` | Menu and context-menu trees, the commands only the palette lists (`PALETTE_ONLY`), and Windows-only item stripping |
| `palette.ts` | The command palette's rows: every command in `MENUS`, the file and empty-area context menus and `PALETTE_ONLY`, once each (`SAME_COMMAND` folds labels that run one command), with its menu path and shortcut; the search; a "Go to" row for a typed path |
| `api.ts` | Typed wrappers over `invoke`. `safe()` swallows an error and returns a fallback |
| `transfer.ts`, `transferUi.ts` | Copy and move planning (conflicts, "(copy)" names, keep both / replace / skip) and running, shared by paste, drag and drop, Move to… and Duplicate |
| `undoActions.ts` | Undo and redo entries for moves, copies (fingerprinted), creations, replaced file content, and the trash (Move to Trash and Restore) |
| `findReplace.ts` | Find & Replace in Files: the preview confirm, the report and the undo entry. The search and the writes are the backend's `replace.rs` |
| `names.ts`, `paths.ts`, `tabs.ts`, `fuzzy.ts`, `shellCd.ts`, `octal.ts` | Pure helpers: name conflicts and bulk-rename ordering; path rules per platform; tab-list operations; fuzzy matching; terminal `cd`; chmod parsing |
| `ops.ts`, `opStore.ts`, `OpsTray.tsx` | Long operations (hash, copy, find) with progress and Cancel |
| `dragDrop.ts`, `OsDrop.tsx` | Drag and drop. The pane's own drag uses pointer events (FilePane); at the window's edge it hands off to the OS (`start_drag_out`). Drops from other apps come through Tauri's drag-drop event and copy. Every drop target carries `data-drop-path`: folder rows, the pane, tabs, breadcrumb segments, sidebar rows |
| `NoticesScreen.tsx`, `notices.ts`, `noticesData.ts` | Help → Third-party Notices, from `assets/fonts` and the generated `assets/third-party.json` (lazy chunk) |
| `commandState.ts`, `remotes.ts`, `platform.ts` | `cmdState` (app clipboard, context-menu target); ssh profiles for saved remotes; `IS_WINDOWS` |
| `styles/themes.css`, `styles/app.css` | 8 themes as CSS variables on `[data-theme]`; layout and component CSS |

**State.** There's no store or reducer.
- `App()` holds about 40 `useState` hooks. Display tweaks persist in `localStorage["glasshouse.tweaks"]`.
- Each tab is a headless `<TabShell>` running `useTabState` and passing `{state, actions}` up into `tabHandles`.
- Module-level state: `cmdState`, the undo stacks, the `dialogs` API and the git cwd.
- Components also signal each other with window events (`glasshouse:*`) and attributes on `<html>`.

**Commands are identified by their display label.**
- Menus, the palette, context menus and `KEYMAP` bindings all send a label string to `handleMenuCommand`. A palette row sends what a click on its menu item sends; its "Go to" row sends the typed path, which `navHandler`'s fallback opens (`looksLikePath` in `paths.ts`).
- It builds a `HandlerCtx` (with App's state and setters as `ctx.app`) and runs `COMMAND_CHAIN`. The first handler to return true wins, and the router shows errors in a dialog.
- Dynamic menu items (recents, bookmarks, open-with apps) carry a `payload` and go to `handleMenuPayload` instead.
- Renaming a label breaks routing unless its case changes too. `pnpm check:wiring` (`scripts/audit-wiring.mjs`, run in CI) fails on labels that nothing handles, cases that never run, no-op cases and cases nothing sends.
- See `docs/decisions/2026-11-10-split-big-files-app-routing.md`.

**Listing and refresh.**
- `useTabState` calls `list_dir`, which returns each entry with its git label scanned for that folder only, then `git_status` for the toolbar's git line.
- It then calls `watch_dir`. The backend sends `fs-changed` for the folder (300 ms debounce) and the tab re-lists. A 30 s poll is the backup.
- Each `watch_dir` needs one `unwatch_dir`. The backend counts them per folder, so tabs on the same folder share one watch until the last one leaves.
- `refreshGate.ts` runs one listing at a time per tab. One for a watcher report or the poll starts no sooner than 500 ms after the last ended, and reports in between become one trailing listing. A navigation and an explicit refresh (F5, or after the app's own change) start at once.
- Only the tab shown re-lists on reports and the poll. A tab in the background notes that it missed one and re-lists when shown.
- The sidebar tree watches its open folders on show the same way, and a report re-lists just that folder (a `RefreshGate` per folder). A listing drops what the tree kept for child folders that are gone (`treeRefresh.ts`). A click on a row asks `path_kind` (one stat) first, and a row whose file or folder is gone goes away instead of opening.
- The git dirty count needs a scan of the whole repo. `git.rs` keeps each repo's last count with the HEAD commit and index stamp it was counted at. `git_status(path, max_age_ms)` reuses it when those match and the scan is recent enough: a navigation accepts one up to a poll old, and a refresh one since it began, which a listing at the repo's root just made.

**Paths.** Paths are plain strings. `paths.ts` applies the platform's rules (`IS_WINDOWS` comes from the user agent): `\` is a separator, and comparisons are case-insensitive, only on Windows.

## Backend (`src-tauri/src/`)
| Path | What |
|---|---|
| `lib.rs` | Plugins, managed state, and every command in `generate_handler!` |
| `commands/` | The commands, one module per area: `listing`, `fs_ops`, `file_info`, `search`, `replace`, `archive`, `hash`, `git`, `config`, `system` (Windows drive letters in `drive_letters.rs`), `wsl` (one timed, cached `wsl.exe --list` for the sidebar and the terminal profiles), `launch`, `drag_out` (a native drag of files into other apps: GTK on Linux, OLE through the `drag` crate on Windows), `trash` (Move to Trash, and the Trash dialog's list, restore and purge; `recycle_bin.rs` checks a Windows drive has a Recycle Bin). Tests are inline or in `<module>_tests.rs`; shared helpers are in `testing.rs` |
| `ops.rs` | `OpRegistry` and `Op`: `op-progress` events (at most every 100 ms) and cancellation for calls given an `op_id`, plus `cancel_op` |
| `pty.rs`, `pty/profiles.rs` | Terminal sessions (portable-pty; per session a reader, a wait and a writer thread, with `pty_write` queuing onto the writer); shell, WSL and ssh profile detection and `check_profile` |
| `watcher.rs` | Folder watching (notify, 300 ms debounce) emitting `fs-changed` |
| `proc_tree.rs` | Spawns a process so its whole tree can be killed (Unix process group, Windows job object); used by `run_script`'s 60 s timeout |
| `build.rs`, `permissions/app.toml`, `capabilities/default.json` | The app ACL: every command belongs to a permission group, granted to the main window's local pages only. `build.rs` fails if a registered command isn't in `app.toml` |

**Conventions.**
- Commands return `Result<T, String>`; a few return `Option` or a default.
- Commands that do I/O are `#[tauri::command(async)]` and run on Tauri's worker threads. Those that rely on call order stay on the main thread: config read and write, `watch_dir`/`unwatch_dir`, and `pty_write`/`pty_resize`/`pty_kill`. See `docs/decisions/2026-11-08-async-commands-threading.md`.
- **File writes never clobber.** Create, rename, copy and move refuse an existing target (`create_new`, `RENAME_NOREPLACE` or `MoveFileExW` without replace, `CopyFileW` with fail-if-exists). The frontend's Replace choice trashes the old item first.
- **Find & Replace changes only UTF-8 text, atomically.** `replace.rs` works on bytes and lists the files it won't touch (other encodings, binary, too large, read-only, hard-linked). It writes each file through a temp file in its folder and a rename (`ReplaceFileW` on Windows), keeping its permissions. It never writes through a link or outside the searched folder. Undo goes the same way (`rewrite_text`). See `docs/decisions/2026-11-12-find-replace-safety-design.md`.
- **Failures clean up, and readers never block.**
  - A copy that fails or is cancelled removes what it made. A cross-volume move whose delete fails removes a file's copy, or keeps a folder's complete copy and says so.
  - File readers (previews, hex dump, hash, diff and blame, zip compression, copy) open through `open_regular`, which refuses FIFOs, sockets and devices without blocking on them.
  - See `docs/decisions/2026-11-12-fs-robustness-failures.md`.
- **Launching never builds a shell command line from user strings.** Arguments are checked (`check_profile`, `check_git_args`, `open_url`'s scheme list), and Windows paths go through the opener, direct spawns or environment variables. See `docs/decisions/2026-11-08-command-security-design.md`.
- Git uses libgit2 for status and numstat, and the `git` CLI for history and for running menu commands (`git_run`, limited to `GIT_RUN_ALLOWED`).
  - Stage, Unstage and Discard use libgit2. Discard never deletes: it restores tracked files from HEAD, moves untracked items to the trash, and leaves staged-only and ignored ones alone. Branch switches end with `--`. See `docs/decisions/2026-11-11-git-safety-design.md`.
- Platform splits: `cfg(windows)` covers Win32 drives, hidden attributes, WSL, shortcuts, signatures, job objects and `CREATE_NO_WINDOW`. `cfg(not(windows))` covers sysinfo drives, `xdg-open` and FileManager1 reveal, terminal discovery, XDG trash and the `/proc` parsers.
- Pins, tags and recents are JSON in the app config dir, written atomically (a synced temp file, then a rename).

## Build, CI and release
- **CI** (`.github/workflows/ci.yml`):
  - frontend: build, test, `check:wiring`;
  - backend on Ubuntu and Windows: clippy with `-D warnings`, cargo test;
  - `notices`: `pnpm notices --check` against the lockfiles.
- **Releases:** `release.yml` runs on a `v*` tag. It builds the Windows installers (msi, NSIS) and Linux packages (AppImage, deb) with tauri-action.
- **Locally:** `pnpm tauri build --no-bundle` makes the Linux binary. This machine links it into its app launcher.
- **Third-party notices:** `pnpm notices` (`scripts/gen-notices.mjs`, cargo-about) regenerates `src/assets/third-party.json`.

## Project site (`docs/` on GitHub Pages)
- `docs/index.html` with `docs/assets/site.css` and `site.js` is the landing page, hand-written with no build step. It uses the app's theme tokens (`docs/assets/themes.css`, copied from `src/styles/themes.css` by the site build).
- `site/demo/` is a browser demo of the real UI. `main.tsx` installs `@tauri-apps/api/mocks` before importing `App`, and `mock/` holds an in-memory file system, a pretend git repo and shell, and one handler per command. `pnpm site:build` (`vite.site.config.ts`) builds it into `docs/demo/`, which is committed.
- `site/capture/capture.mjs` drives headless Chromium to record `docs/media/` (hero images and tour clips; needs chromium and ffmpeg) and runs the behavior checks (`check`).
- Pages runs Jekyll; `docs/_config.yml` keeps the working docs (SPEC, ARCHITECTURE, plans, decisions) off the site, so no published name may start with `_` or `.`.
- After UI changes: `pnpm site:build`, `pnpm site:capture`, `pnpm site:capture check`.
