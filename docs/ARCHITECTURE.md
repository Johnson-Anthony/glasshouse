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
| `chooser/` (`chooser.html`) | The open and save dialog other apps get through xdg-desktop-portal (Linux): its own Vite entry, so it loads none of the main window's code. `Chooser.tsx` puts the Toolbar, Sidebar and FilePane over a bottom bar (name, file types, the app's choices, Cancel, accept); `chooserLogic.ts` holds the decisions (filter globs, typed names and paths, the start folder, the last folder per app). See `docs/decisions/2026-11-20-file-chooser-backend.md` |
| `rows.ts` | A listing entry as a file-pane row (`entryToRow`, `formatBytes`), shared by the main window and the chooser |
| `components.tsx` | Titlebar, Toolbar, FilePane (the file list), Palette, and `TweakState` (the saved settings) |
| `StatusBar.tsx`, `statusItems.ts` | The status bar, and which items it shows (a setting: new users get items, size and free space; settings saved before keep every item they had). An item's data is fetched only while it shows |
| `places.ts` | A first run's pins: home and the known folders that exist, then the desktop's own bookmarks (`desktop_places`). Only with no saved settings and no pins file. See `docs/decisions/2026-11-20-first-run-defaults.md` |
| `menus.tsx`, `Sidebar.tsx`, `Miller.tsx`, `Terminal.tsx` | Menubar and context menu; the sidebar (pins, tree, tags, devices); the miller-column view, whose middle column is the FilePane itself (with `millerKeys`) between a parent and a preview column; the xterm drawer |
| `preview/` | `Inspector.tsx` (details, permissions, checksums) and `FilePreview.tsx` (type-aware previews and Quick Look) |
| `dialogs/` | One file per dialog. `DialogHost.tsx` holds the promise-based `dialogs` API (prompt, alert, confirm, choice, pick list, toast) and its host. `GitDialogs.tsx` holds `gitDialogs` the same way: the branch picker (Checkout…, Merge…, Rebase onto…) and the commit dialog (what's staged, a multi-line message); their decisions are in `gitUx.ts`. `Preferences.tsx` (Edit → Preferences…, Ctrl+,) edits the saved settings live, in categories with a filter; `ThemeEditor.tsx` is its custom-theme editor |
| `zoom.ts` | Window zoom: the webview's page zoom (`setZoom`), stepped by Zoom In/Out and saved as `zoom` in the settings. See `docs/decisions/2026-11-13-settings-dialog-zoom.md` |
| `state.ts` | `useTabState`: per-tab listing, selection, sort, history (`history.ts`) and fs watching; `reveal` opens a file's folder with the file selected once the listing arrives. Also the undo and redo stacks |
| `handlers/` | Command handlers, chained as `COMMAND_CHAIN` in `index.ts`: `target` (context-menu target), `app` (App-level), `fileOps` (file ops on the active tab), then the feature handlers in `HANDLERS` (selection, view, git, archive, tools, nav, misc). `types.ts` defines `HandlerCtx` |
| `keymap.ts` | Window shortcuts as a table (`KEYMAP`), which also feeds the Keybindings cheatsheet; the Ctrl+G chord's pending state, which the file pane defers to |
| `menuNav.ts` | Keyboard rules for the menus (a highlighted path per open level, moved by keys and hover), the menubar's mnemonics, and the file list's type-ahead. `menus.tsx` takes focus while a menu is open and gives it back when it closes |
| `data.ts` | Menu and context-menu trees, the commands only the palette lists (`PALETTE_ONLY`), and Windows-only item stripping |
| `palette.ts` | The command palette's rows: every command in `MENUS`, the file and empty-area context menus and `PALETTE_ONLY`, once each (`SAME_COMMAND` folds labels that run one command), with its menu path and shortcut; the search; a "Go to" row for a typed path |
| `api.ts` | Typed wrappers over `invoke`. `safe()` swallows an error and returns a fallback |
| `transfer.ts`, `transferUi.ts` | Copy and move planning (conflicts, "(copy)" names, keep both / replace / skip) and running, shared by paste, drag and drop, Move to… and Duplicate |
| `undoActions.ts` | Undo and redo entries for moves, copies (fingerprinted), creations, replaced file content, and the trash (Move to Trash and Restore) |
| `tags.ts`, `tagMap.ts` | The tag store (one copy of the `{ path: labels }` map, written on each change) and the wrappers that make tags follow the app's renames, moves, deletes and trash; pruning of gone paths after a listing and when the sidebar's TAGS group is shown. `tagMap.ts` is the pure map work. See `docs/decisions/2026-11-13-tags-follow-design.md` |
| `session.ts` | The tabs a window reopens with (each tab's folder and sort, and the active tab), in `localStorage["glasshouse.session.v1"]`: checked field by field on load, written as they change, private tabs left out; a gone folder opens its nearest existing parent, or home. Only the window that owns the session (`session_owner`) restores and saves it. See `docs/decisions/2026-11-15-session-persistence-windows.md` |
| `launch.ts` | A window started with paths (`launch_request`: another app's "Show in folder", a folder opened from another app, `glasshouse PATH…`): one tab per folder, each file selected in its folder, Properties for `--properties`, a notice for what couldn't be opened. Such a window doesn't load or save the session. See `docs/INTEGRATION.md` |
| `openWith.ts`, `commandLine.ts` | Opening files in other apps: `openFile` (double-click, Enter, Open, Default App) says when no app is set or it won't start and offers Choose App…, a pick list of the installed apps for the type plus Choose a program…; the Open With submenu's app rows (the `open-with-apps` dynamic source). `commandLine.ts` splits Custom Command…'s line into a program and arguments, with no shell. See `docs/decisions/2026-11-20-open-with-*.md` |
| `findReplace.ts` | Find & Replace in Files: the preview confirm, the report and the undo entry. The search and the writes are the backend's `replace.rs` |
| `names.ts`, `paths.ts`, `typedPath.ts`, `tabs.ts`, `fuzzy.ts`, `shellCd.ts`, `octal.ts` | Pure helpers: name conflicts and bulk-rename ordering; path rules per platform; what a typed path or link means (`~`, relative, `..`, `file://`); tab-list operations; fuzzy matching; terminal `cd`; chmod parsing |
| `ops.ts`, `opStore.ts`, `OpsTray.tsx` | Long operations (hash, copy, find, every git menu command) with progress and Cancel; a git op shows git's latest progress line |
| `dragDrop.ts`, `OsDrop.tsx` | Drag and drop. The pane's own drag uses pointer events (FilePane); at the window's edge it hands off to the OS (`start_drag_out`). Drops from other apps come through Tauri's drag-drop event and copy. Every drop target carries `data-drop-path`: folder rows, the pane, tabs, breadcrumb segments, sidebar rows, Miller's outer columns and their folder rows |
| `updates.ts`, `dialogs/Update.tsx` | Updates (see "Updates" below): the words for each kind of install, the release notes as text, and the automatic check (`useAutoUpdateCheck`); the dialog Help → Check for Updates opens |
| `NoticesScreen.tsx`, `notices.ts`, `noticesData.ts` | Help → Third-party Notices, from `assets/fonts` and the generated `assets/third-party.json` (lazy chunk) |
| `commandState.ts`, `remotes.ts`, `platform.ts` | `cmdState` (app clipboard, context-menu target); ssh profiles for saved remotes; `IS_WINDOWS` |
| `styles/themes.css`, `styles/app.css` | 39 themes as CSS variables on `[data-theme]`, each with its `color-scheme`; layout and component CSS, whose look switches (`html[data-icons]`, `[data-tabs]`, `[data-controls]`…) are at the end of `app.css` |
| `themes.ts`, `contrast.ts` | The built-in themes' ids, names, schemes and groups; the color tokens; the WCAG contrast checks every theme passes (`themes.test.ts`) |
| `look.ts`, `useLook.ts` | The look: every cosmetic setting (`LookState`, part of the settings), its defaults and presets, the migration of settings saved before it, which theme System shows, and `lookAttrs`, the attributes and properties it puts on `<html>`. `useLook` applies them, follows the OS's light/dark and contrast settings, and keeps the window's own theme in step. A look change re-renders no file row. See `docs/decisions/2026-11-20-themes-system-and-defaults.md` |
| `userThemes.ts`, `fileTypes.ts` | Custom themes: the store (`localStorage["glasshouse.themes.v1"]`), the checked JSON file format, the `<style>` they reach the page through. A row's icon type for the icon sets (`.row[data-ft]`). See `docs/decisions/2026-11-20-themes-custom-format.md` |

**State.** There's no store or reducer.
- `App()` holds about 40 `useState` hooks. The settings (`TweakState`: the look from `look.ts`, zoom, the file-list toggles, which panels are shown…) persist in `localStorage["glasshouse.tweaks"]`; Preferences… and the View menu change them. The tabs persist through `session.ts`.
- Each tab is a headless `<TabShell>` running `useTabState` and passing `{state, actions}` up into `tabHandles`.
- Module-level state: `cmdState`, the undo stacks, the tag store (`tags.ts`, read with `useTags()`), the `dialogs` API and the git cwd.
- Components also signal each other with window events (`glasshouse:*`) and attributes on `<html>`.

**Commands are identified by their display label.**
- Menus, the palette, context menus and `KEYMAP` bindings all send a label string to `handleMenuCommand`. A palette row sends what a click on its menu item sends; its "Go to" row sends the typed path, which `navHandler`'s fallback opens (`looksLikePath` in `paths.ts`) as Go to Path… and Open… do: `openTyped` (`handlers/helpers.ts`) opens a link in the browser, a folder in the tab, or a file's folder with the file selected. See `docs/decisions/2026-11-13-paths-and-search-design.md`.
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
| `lib.rs` | `APP_ID` (tauri.conf.json's identifier), plugins (dialog, the updater, which only `update.rs` calls; window-state below), managed state, and every command in `generate_handler!`. The app is built, then run: in between it claims the session (`session.rs`) and, if it owns it, registers the window-state plugin, which restores the main window's size and place as it's made and saves them on exit. When the app is ready, `window_fit.rs` fits the window to its monitor's work area |
| `migrate.rs` | First thing in every mode: moves the folders named after 0.2.0's identifier, `sh.glasshouse.viles` (config, data and cache; the webview's localStorage is in the data one), to `APP_ID`'s, and `~/.glasshouse/remotes.json` into the config folder, unless the new ones exist. See `docs/decisions/2026-11-20-release-identity-migration.md` |
| `window_fit.rs` | The window fits the screen: with nothing saved, the config's size capped at 90% of the work area, centered; a restored or second window that doesn't fit shrinks and moves inside. See `docs/decisions/2026-11-20-first-run-defaults.md` |
| `startup.rs` | The command line: a window (with `--select`/`--properties` and paths or `file://` URIs), `--dbus SERVICE…` (the resident), `--integration-on`/`--integration-off`. Also `self_exe` (the AppImage file itself for an AppImage) and the XDG activation token handoff to GTK. See `docs/decisions/2026-11-20-folder-handler-processes.md` |
| `resident.rs` | Linux: `glasshouse --dbus file-manager`, a windowless process that owns `org.freedesktop.FileManager1` and starts one window process per call, passing the caller's startup ID on as `DESKTOP_STARTUP_ID`. Every resident also serves `io.github.johnson_anthony.glasshouse.Resident1` (`Version`, `Release`; `APP_ID` with `_` for `-`), which is how the app tells it's ours and takes the name back (it also knows the interface from before the identifier changed). `--dbus file-chooser` is the second service (`portal.rs`); one process can serve both |
| `portal.rs`, `chooser.rs` | Linux: the xdg-desktop-portal FileChooser backend (`org.freedesktop.impl.portal.desktop.glasshouse`). `portal.rs` answers `OpenFile`, `SaveFile` and `SaveFiles`, exports each call's Request (its `Close` kills the dialog) and starts one `glasshouse --chooser` window process per call, the request as JSON on stdin and the answer as one JSON line back. `chooser.rs` is that process's side: the request for the page, the parent window (X11 transient-for, Wayland xdg-foreign), the first-paint time, and the answer. See `docs/decisions/2026-11-20-file-chooser-backend.md` |
| `session.rs` | Which glasshouse process owns the saved session: the first one running, which holds a lock on `session.lock` in the app config dir. File → New Window starts another process, which restores and saves neither the window nor the tabs. See `docs/decisions/2026-11-15-session-persistence-windows.md` |
| `commands/` | The commands, one module per area: `listing`, `fs_ops`, `file_info`, `search`, `replace`, `archive`, `hash`, `git`, `config`, `system` (Windows drive letters in `drive_letters.rs`), `wsl` (one timed, cached `wsl.exe --list` for the sidebar and the terminal profiles), `launch`, `places` (the desktop's bookmarks for a first run's pins: GTK's bookmarks file, KDE's places, Quick Access on Windows), `open_with` (the apps for a file and starting one: `xdg_apps.rs` reads shared-mime-info, desktop entries and `mimeapps.list` on Linux; `win_open_with.rs` asks the shell on Windows), `drag_out` (a native drag of files into other apps: GTK on Linux, OLE through the `drag` crate on Windows), `trash` (Move to Trash, and the Trash dialog's list, restore and purge; `recycle_bin.rs` checks a Windows drive has a Recycle Bin), `integration` (Preferences → Integration: `integration_xdg.rs` writes and undoes the Linux files, mimeapps.list included; `integration_portal.rs` does the open and save dialogs: the portal's version and config search, portals.conf edits, the .portal, service and environment.d files, the portal restart; `integration_win.rs` plans the Windows registry changes, which only its `reg` module makes; see `docs/INTEGRATION.md` and `docs/decisions/2026-11-20-file-chooser-integration.md`). Tests are inline or in `<module>_tests.rs`; shared helpers are in `testing.rs` |
| `update.rs` | Updates: how this copy was installed, the once-a-day gate (`update.json` in the config dir), the check, and the download and install through tauri-plugin-updater, with `update-progress` events. See "Updates" below |
| `ops.rs` | `OpRegistry` and `Op`: `op-progress` events (at most every 100 ms, with an optional `detail` line) and cancellation for calls given an `op_id`, plus `cancel_op` |
| `pty.rs`, `pty/profiles.rs` | Terminal sessions (portable-pty; per session a reader, a wait and a writer thread, with `pty_write` queuing onto the writer); shell, WSL and ssh profile detection and `check_profile` |
| `watcher.rs` | Folder watching (notify, 300 ms debounce) emitting `fs-changed` |
| `proc_tree.rs` | Spawns a process so its whole tree can be killed (Unix process group, Windows job object); used by `run_script`'s 60 s timeout, and by `git_run` through `spawn_detached`, which on Unix also leaves the app's session so nothing can prompt on its terminal |
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
  - A desktop entry's `Exec` is split into words before its field codes are expanded, so a file name is always whole arguments; a field code inside quotes is refused. On Windows, Open With starts the shell's own handler (`IAssocHandler::Invoke`). See `docs/decisions/2026-11-20-open-with-linux-apps.md` and `…-windows-handlers.md`.
  - Custom Command…'s line is split in `commandLine.ts` and started directly; `{}` is the file. See `docs/decisions/2026-11-20-open-with-custom-command.md`.
- Git uses libgit2 for status and numstat, and the `git` CLI for history and for running menu commands (`git_run`, limited to `GIT_RUN_ALLOWED`).
  - Stage, Unstage and Discard use libgit2. Discard never deletes: it restores tracked files from HEAD, moves untracked items to the trash, and leaves staged-only and ignored ones alone. Branch switches end with `--`. See `docs/decisions/2026-11-11-git-safety-design.md`.
  - `git_run` never waits on a prompt. git runs with stdin closed, `GIT_TERMINAL_PROMPT=0` and (on Unix) no controlling terminal, so a credential nothing can supply fails at once. Each run is an op: git's `--progress` lines go to the tray, Cancel kills its process tree, and pull, push and fetch stop after 120 s with no output. A commit needs `-m` or `--amend --no-edit`, so no editor opens. See `docs/decisions/2026-11-20-git-ux-remote-commands.md`.
- Platform splits: `cfg(windows)` covers Win32 drives, hidden attributes, WSL, shortcuts, signatures, job objects and `CREATE_NO_WINDOW`. `cfg(not(windows))` covers sysinfo drives, desktop entries for Open With (`xdg-open` only as a fallback), FileManager1 reveal (answered in the window itself when glasshouse is the file manager), terminal discovery, XDG trash and the `/proc` parsers.
- Pins, tags, saved remotes and recents are JSON in the app config dir (`~/.config/<APP_ID>` on Linux, `%APPDATA%\<APP_ID>` on Windows), written atomically (a synced temp file, then a rename). A missing pins file reads as null, which tells a first run (`places.ts`) from pins the user removed. The webview keeps `localStorage` in the app's local data dir (`~/.local/share/<APP_ID>`; `%LOCALAPPDATA%\<APP_ID>\EBWebView`). Tags are keyed by path; the frontend moves and drops keys as the app changes files (`tags.ts`).

## Build, CI and release
- **CI** (`.github/workflows/ci.yml`):
  - frontend: build, test, `check:wiring`;
  - backend on Ubuntu, Windows x64 and Windows arm64: clippy with `-D warnings`, cargo test;
  - `notices`: `pnpm notices --check` against the lockfiles.
  - `installers` (Windows): a debug build of the NSIS and MSI installers with their hooks (`src-tauri/windows/`), then `scripts/installers-check.ps1` installs each, turns "Open folders with glasshouse" on, uninstalls and checks the registry, the NSIS install-folder keys included.
- **e2e** (`.github/workflows/e2e.yml`): the end-to-end smoke test (below) on ubuntu-22.04 and windows-latest. It runs on pushes to main and by hand, and isn't a required check.
- **Releases:** `release.yml` runs on a `v*` tag. It builds the Windows installers (msi, NSIS; x64 and arm64) and Linux packages (AppImage, deb; x64 and arm64) with tauri-action into a draft, each signed for the updater, then adds `SHA256SUMS`, a build provenance attestation for it (`gh attestation verify`) and `latest.json`, and publishes. It needs the update signing secrets (see "Updates"). The Linux menu entry comes from `src-tauri/linux/glasshouse.desktop`. The bundle metadata, the publisher (which names the Windows registry key `HKCU\Software\Anthony Johnson\glasshouse`) and the pinned MSI upgrade code are in `tauri.conf.json`; see `docs/decisions/2026-11-20-release-identity-installers.md`.
- **Locally:** `pnpm tauri build --no-bundle` makes the Linux binary. This machine links it into its app launcher.
- **Third-party notices:** `pnpm notices` (`scripts/gen-notices.mjs`, cargo-about) regenerates `src/assets/third-party.json`.

## Updates
Off until the user asks: Help → Check for Updates checks once, and Preferences → Updates → "check for updates automatically" (`autoUpdate` in the settings, off by default) checks at most once a day. Nothing else touches the network. See `docs/decisions/2026-11-20-updater-design.md`.
- **The check** is one GET of the latest release's `latest.json` (`plugins.updater.endpoints` in tauri.conf.json), made in Rust by tauri-plugin-updater (`update.rs`). The webview has none of the plugin's permissions, and the CSP's `connect-src` stays local. The automatic check runs only in the window that owns the session, 20 s after start and then hourly; Rust lets it through a day after the last answer (an hour after a failed attempt) and reports each version once, kept in `update.json` in the config dir.
- **How a copy updates** follows how it was installed: `tauri::utils::platform::bundle_type()` reads a marker the bundler writes into each package's copy of the binary.
  - The NSIS setup and the MSI download and run the new installer of the same kind (latest.json's `windows-<arch>-nsis` and `-msi` entries), so a per-user install stays per user and a per-machine one per machine.
  - An AppImage (`$APPIMAGE`) is replaced in place and restarted, if its folder is writable.
  - A .deb or .rpm gets a link to the new package, and a build from source (no marker: `tauri dev`, `tauri build --no-bundle`) a link to the release.
- **Trust:** each package is signed with a minisign key (`tauri signer`). The app installs one only if its signature checks out against `plugins.updater.pubkey` and names the version latest.json announces (`requireSignedVersion`). The private key and its password are the repository secrets `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`; a new key would strand every installed copy.
- **The release workflow:**
  - prepare stops a run whose secrets are missing, or whose key doesn't match the public key: it signs a probe and checks it with `scripts/updater-json.mjs verify`;
  - the builds sign their packages through `--config src-tauri/release.conf.json`, which turns on `createUpdaterArtifacts`. CI's and local bundle builds don't, so they need no key;
  - publish checks every package against its `.sig` and writes `latest.json` (`scripts/updater-json.mjs write`), with the CHANGELOG section as the notes. tauri-action's own latest.json is off, because each of the four build jobs rewrites it and they race.
- **Trying it locally:** build with a throwaway key pair (`pnpm tauri signer generate`) and a `--config` overlay that sets its `pubkey`, a local `endpoints` URL and `dangerousInsecureTransportProtocol`, then serve a latest.json from a folder. Never commit the overlay or the key.

## End-to-end tests (`e2e/`)
These drive the real app, built with `pnpm tauri build --debug --no-bundle`, through W3C WebDriver.
- **Driver chain:** `e2e/webdriver.mjs` (a small client over `fetch`, with a deadline on every request) → `tauri-driver` 2.1.0 → WebKitWebDriver on Linux or msedgedriver on Windows → the app. tauri-driver sets `TAURI_WEBVIEW_AUTOMATION=true`, which Tauri reads to allow automation, so the app has no test code. There's no macOS driver.
- **Harness** (`e2e/harness.mjs`): finds the binaries (overrides: `E2E_APP`, `E2E_TAURI_DRIVER`, `E2E_NATIVE_DRIVER`), makes the scratch folder and the fixture, starts tauri-driver and stops its whole process tree, and takes the desktop screenshot.
  - On Linux, the app gets a minimal environment: a scratch HOME and XDG dirs with the known folders and `user-dirs.dirs`, `GDK_BACKEND=x11` and no `WAYLAND_DISPLAY`. It also runs on a private session bus whose config starts no system services (`sessionBus`), so a local run touches none of the user's session.
  - On Windows, it runs as the runner's user, because known folders come from the profile. tauri-driver starts through `e2e/unelevated.ps1`, without admin rights: an elevated WebView2 ignores the `WEBVIEW2_*` variables msedgedriver attaches through, and GitHub's runners run steps elevated (`docs/decisions/2026-11-20-e2e-windows-elevation.md`). The WebView2 profile is msedgedriver's scratch folder; the app's config folder is the runner's own.
- **Flow 1** (`e2e/smoke.test.mjs`):
  - the window renders with no notice, pane error or dialog;
  - Ctrl+L, a typed fixture path and Enter list the fixture's entries;
  - the sidebar's DEVICES lists `/` or `C:\`, and the tree shows home with Documents and Downloads;
  - there are no uncaught errors or unhandled rejections from the session's start. On Windows, msedgedriver's browser log (`ms:loggingPrefs`) also covers the time before that, and any Content Security Policy violation fails the test too.
- **Artifacts:** `e2e/artifacts/` (ignored by git) gets them on every run:
  - a webview screenshot after each test, and `desktop.png`, taken while the app is open;
  - `driver-and-app.log` (both drivers' output and, on Linux, the app's stderr; on Windows it's usually empty);
  - `session.json` (the drivers and the versions they report), and the page's text and errors;
  - on Windows, `session.txt`: `query user`, the screens, the app's process session and window rect (`e2e/windows-desktop.ps1`).
- **Running it:**
  - Linux: `pnpm e2e` (Xvfb at 1920x1080x24 through `xvfb-run`). It needs `webkit2gtk-driver` (apt) and `cargo install tauri-driver --version 2.1.0 --locked`. Run it in a memory-capped scope; the app and WebKit take about 300 MB.
  - Windows: `node --test e2e/smoke.test.mjs` in an interactive session. First run `e2e/edgedriver.ps1`: msedgedriver must match the WebView2 Runtime in the first three version parts, or the session start hangs. The script uses the runner image's driver when it matches and otherwise downloads the matching one, then sets `E2E_NATIVE_DRIVER`. An elevated terminal is fine, because the harness drops admin rights for tauri-driver and the app.
- **Adding a flow:** poll with `waitFor`, never sleep, because listings and watcher refreshes are asynchronous. Read the page with `session.execute`, and type with `sendKeys` or `chord`, so the input goes through real key events. See `docs/decisions/2026-11-20-e2e-smoke-design.md`.

## Project site (`docs/` on GitHub Pages)
- `docs/index.html` with `docs/assets/site.css` and `site.js` is the landing page, hand-written with no build step. It uses the app's theme tokens (`docs/assets/themes.css`: the site build copies `src/styles/themes.css` up to its "site cut" line, the eight themes the page offers).
- `site/demo/` is a browser demo of the real UI. `main.tsx` installs `@tauri-apps/api/mocks` before importing `App`, and `mock/` holds an in-memory file system, a pretend git repo and shell, and one handler per command. It starts in the look from before themes-and-cosmetics, which the site's images show; `?theme=<id>` and `?look=<preset>` start it in another. `pnpm site:build` (`vite.site.config.ts`) builds it into `docs/demo/`, which is committed.
- `site/capture/capture.mjs` drives headless Chromium to record `docs/media/` (hero images and tour clips; needs chromium and ffmpeg) and runs the behavior checks (`check`). `themes <dir>` saves review shots of some themes and looks.
- Pages runs Jekyll; `docs/_config.yml` keeps the working docs (SPEC, ARCHITECTURE, plans, decisions) off the site, so no published name may start with `_` or `.`.
- After UI changes: `pnpm site:build`, `pnpm site:capture`, `pnpm site:capture check`.
