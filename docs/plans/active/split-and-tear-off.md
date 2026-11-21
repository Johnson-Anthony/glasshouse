# split-and-tear-off (survey-3 task 50)

The owner asked for "split view for tabs and also to be able to drag drop tabs into their own window like you can with browsers". Scope: "## 50. split-and-tear-off" in `docs/plans/active/survey-3.md`. Task 50 is three phases, each handed off and merged on its own (survey-3, `93c7069`):
1. split view;
2. one process with many windows;
3. tear-off.

Why, and what was considered and dropped: `docs/decisions/2026-11-20-split-and-tear-off-phases.md`.

## Status
- [x] **Phase 1, split view:** built on `claude/serene-swanson-b96e5c`, tested, handed off to the lead for merging.
  - Frontend only.
  - The cross-process tear-off code it started with is on the local branch `claude/split-and-tear-off-xproc-wip` (not pushed).
  - Checks at handoff, all passing:
    - `pnpm build`;
    - vitest: 1175 tests;
    - `check:wiring`;
    - `notices --check`;
    - `cargo clippy --all-targets` with `-D warnings`;
    - `cargo test`: 356 tests after the rebase onto diagnostics-and-errors; not rerun after the updater merge, because the disk filled (this branch changes no Rust);
    - `site:build`, `site:capture` and `site:capture check`;
    - `pnpm e2e`: 9 of 9, including "split view", on Linux under Xvfb.
  - Not run:
    - anything on Windows (WebView2's pointer capture during a tab drag, Ctrl+F6 there): checklist items W8.8 and W8.9;
    - the one-tab window move under a real window manager: L9.10.
- [x] **Phase 2, one process with many windows:** built on `claude/one-process-windows` from main at 18526f4, as planned below (with the lead's guest addition), tested, handed off to the lead for merging.
  - Decisions: `docs/decisions/2026-11-21-split-and-tear-off-one-process.md`, `…-handoff.md` and `…-session.md` (the successor to `2026-11-15-session-persistence-windows.md`, which now points to it).
  - Checks at handoff, all passing:
    - `pnpm build`;
    - vitest: 1186 tests (2 skipped);
    - `check:wiring`;
    - `notices --check` (no new crate or package: zbus and the windows crate were already in);
    - `cargo clippy --all-targets` with `-D warnings`;
    - `cargo test`: 393 tests (5 ignored);
    - `site:build` and `site:capture check`;
    - `pnpm e2e`: 10 of 10, including "new window", on Linux under Xvfb;
    - `handoff.rs` and `handoff/` type-checked for `x86_64-pc-windows-msvc` with clippy `-D warnings`, through a scratch crate with a stub for tauri.
  - By hand under Xvfb on a private bus, with a debug build: a second plain launch and a launch with paths opened their windows in the running app and exited in about 70 ms, with the startup ID on the new window (`_NET_STARTUP_ID`, `_NET_WM_USER_TIME`); Ctrl+Q kept three windows and a restart restored them; a guest wrote nothing, and a plain launch handed to it restored the saved windows beside its own; a stopped (SIGSTOP) app held a launch up for about 1.66 s, then it ran alone with a log line; with no session bus the app ran alone, logged it and restored its windows; the resident handed `ShowItems` to the running app, and started a window process when none ran; the debug name was on the bus and the release name wasn't.
  - Not built or run:
    - the full app on Windows: `cfg(windows)` paths in `app_windows.rs` and the pipe against the real tauri are first built by the windows-latest CI job; the handoff's focus and the restore on Windows are W15;
    - Wayland focus (a nested niri, or GNOME and KDE): L13.2;
    - a real update restart with several windows: W15.11, L12.3.
  - Known and accepted: a launch that gives up waiting on a slow (not hung) app opens its own window, and the app may open one too; a guest's windows opened before it became the owner don't get their size and place saved.
- [ ] **Phase 3, tear-off in one process:** design below, after phase 2.

# Phase 1: split view

## What it does
- **State: a new module.** The tab state moved out of App.tsx:
  - `src/tabLayout.ts` is pure: panes, focus, orientation and ratio;
  - `src/useTabLayout.tsx` is the hook: the layout state, tab handles, operations, and the session save.

  App keeps `tabs`, `activeTab` and `activeHandle` for the focused pane, so the handlers, menus, status bar, Inspector and terminal Follow Folder follow focus unchanged.
- **Layout:** one or two panes, each with its own tabs and shown tab. It also holds the focused pane, `row` (side by side) or `column` (top and bottom), and the divider's ratio, which can be dragged (a double-click resets it).
  - Unsplit, the tabs stay in the title bar as before.
  - Split, the title bar keeps the window controls and its drag area, and each pane gets its own tab bar above its file list. Each tab label is its folder, so the second pane needs no path bar of its own.
  - The toolbar, breadcrumb and search box follow the focused pane. Miller columns work per pane.
  - A pane whose last tab closes or moves out goes, and the window is unsplit.
- **Commands:**
  - View → Split has **Split Side by Side** (Ctrl+\\, a toggle), **Split Top and Bottom**, **Focus Other Pane** (Ctrl+F6), **Swap Panes** and **Close Split**.
  - Splitting opens the second pane on the focused pane's folder. Close Split puts the second pane's tabs after the first's, and the focused tab stays shown.
  - The Edit menu and the file context menu have **Copy to Other Pane** and **Move to Other Pane**. Both go through `performDrop`, so they get undo and conflict handling. Unsplit, the file menu hides them, and the Edit menu's say to split first.
  - The tab context menu has **Move to Other Pane**. Unsplit, it splits with that tab; it's hidden for a window's only tab.
  - Neither Ctrl+\\ nor Ctrl+F6 was bound in `keymap.ts`, the menus or the Keybindings sheet.
  - Tab/F6 pane cycling goes sidebar → first pane → second pane → terminal.
- **Tab drag inside the window** uses pointer events, like the pane's file drag (HTML5 drag and drop breaks on Windows with `dragDropEnabled`). Code: `src/tabDrag.ts` and `src/tabMoves.ts`.
  - Over a tab bar it shows an insertion mark, and the drop moves the tab there (a reorder, or into the other pane).
  - Unsplit, over the outer quarter of the file area, it previews that half, and the drop splits with the tab in the new pane.
  - Split, over the other pane's file area, the drop moves the tab there.
  - Escape cancels. Let go outside the window, the tab stays (tear-off is phase 3).
  - Dragging a window's only tab moves the window, as Chrome does.
- **Session:** the record keeps its key, and 0.2 can still read it. See `docs/decisions/2026-11-20-split-and-tear-off-session.md`.

## Files
- New:
  - `src/tabLayout.ts`, `src/useTabLayout.tsx`, `src/tabDrag.ts`, `src/tabMoves.ts`, `src/tabTransfer.ts`;
  - tests: `src/tabLayout.test.ts`, `src/tabDrag.dom.test.ts`, `src/useTabLayout.dom.test.tsx`, `src/tabTransfer.test.ts`.
- Changed:
  - `App.tsx`: the hook in place of the tab code, and two panes;
  - `components.tsx`: a `TabStrip` taken out of `Titlebar`;
  - `state.ts` and `tabs.ts`: a tab can start with another's history and filters (`TabSeed`), which Duplicate Tab uses;
  - also `session.ts`, `data.ts`, `keymap.ts`, `menus.tsx`, `commandState.ts`, the `handlers/` app and tab cases and `types.ts`, and CSS;
  - e2e: a `drag` action and the F6 key in `webdriver.mjs`, and the "split view" flow in `smoke.test.mjs`;
  - `docs/testing/`: tab-drag and split items W8.8–W8.9 and L9.9–L9.10;
  - `docs/demo/`: rebuilt.
- No Rust change.

## Phase 1 tests
- vitest:
  - layout operations;
  - the session: a split's record, an old record, junk split fields, private panes;
  - drop-zone hit tests and the drag controller (happy-dom);
  - the hook: which window saves, what it saves, and a tab keeping its live state when it moves;
  - the tab transfer record (`src/tabTransfer.ts`), and Duplicate Tab keeping history and filters through it.
- e2e "split view":
  - Ctrl+\\ shows two panes, each listing;
  - Ctrl+F6 moves the focus, and the breadcrumb follows it;
  - a real pointer drag of a tab into the other pane's tab bar;
  - the tab menu's Move to Other Pane;
  - Edit → Copy to Other Pane copies a file;
  - Ctrl+\\ again closes the split.

# Phase 2: one process with many windows

The lead's brief (11-20):
- **New Window** opens a window in the running process (`WebviewWindowBuilder`) instead of `spawn_new_window` starting a process.
- **Backend events** go to their own window.
- **The session** saves and restores every window.
- **A second launch** hands off to the running app, and so does the FileManager1 resident.
- **Startup focus:** DESKTOP_STARTUP_ID and xdg-activation focus keep working.
- **The file chooser** (`--chooser`) may stay a process per dialog.

Rebase on main first: tasks 33 and 48 touch `lib.rs` and the Help menu.

**What's process-wide today** (from a scan on 11-20; check again):
- `emit` (to every window) in `watcher.rs` (`fs-changed`), `pty.rs` (`pty-data` with a session id, `pty-exit`) and `ops.rs` (`op-progress`). `launch_request` is pulled by the page.
- Statics shared across windows:
  - sysinfo and net counters (`commands/system.rs`; fine to share);
  - the archive staging list (`commands/archive.rs`);
  - git's counted-status cache (`commands/git.rs`);
  - drag_out's thread-local;
  - wsl's cache.
- `capabilities/default.json` grants the app's permissions to `"windows": ["main"]` only. New windows need labels the capability matches (`main-*`, say), or every command fails in them.
- `session.rs`: the first plain process owns `session.lock`, and the others are guests.
- window-state plugin: keyed by window label.
- localStorage: one origin per app. In one process every window shares it, and `storage` events reach the other windows.

**Design points to settle in the phase-2 plan:**
- **Window labels:**
  - `main` for the first window, `main-<n>` after it;
  - one capability glob;
  - a registry in Rust (`AppState.windows`) that knows each window's watchers, terminals and ops.
- **Events:** `emit_to(label, …)` everywhere. The watcher keeps a refcount per (window, dir) and drops a window's watches when it closes. Terminals are killed when their window closes. op-progress goes to the window that started the op.
- **Session:**
  - one record holding every window: each window's tabs, active tab, split and its window-state label;
  - written by one place: the Rust side, or the last window to change, debounced;
  - restored as that many windows;
  - it needs a successor to `docs/decisions/2026-11-15-session-persistence-windows.md`;
  - keep 0.2 and phase 1 able to read something: the v1 key could keep the focused window's tabs, with a new key for the list.
- **Settings live in every window:**
  - a `storage` listener on `glasshouse.tweaks` (and pins and tags), so a change in one window reaches the others;
  - this also stops two windows overwriting each other's settings.
- **Second launch:**
  - `tauri-plugin-single-instance` (a new crate: say so, and check its notices) or our own handoff, D-Bus on Linux and a named pipe on Windows;
  - the second process's argv (paths, `--select`, `--properties`), cwd and DESKTOP_STARTUP_ID / XDG_ACTIVATION_TOKEN go to the running app, which opens the window and activates it with that token;
  - the resident (`resident.rs`) asks the running app first and starts it only when none runs;
  - the Windows Directory verb and the Linux menu entry go through the same path.
- **Closing:** the app quits when its last window closes (not the resident). Each window's close tears down its registry entry.

**The lead's answers (11-21) to the open questions:**
1. Rust writes the session: one writer holding each window's last report, writing on change, debounced. The v1 localStorage key keeps the focused window's tabs, for 0.2 and phase 1; the window list goes in a new file. A successor note to `2026-11-15-session-persistence-windows.md`.
2. tauri-plugin-single-instance only if it can carry the second launch's DESKTOP_STARTUP_ID / XDG_ACTIVATION_TOKEN; else our own handoff, D-Bus on Linux and a named pipe on Windows. Record which and why. The FileManager1 resident asks the running app first.
3. `--chooser` stays a process per dialog.
4. Restore every window of the last session at once. Launches started with a path don't restore and don't overwrite the session.
5. Private tabs are never saved.
6. The panic trade-off goes in the decision note.

## Phase 2 plan (11-21)

**Single instance: our own handoff.** tauri-plugin-single-instance 2.4.5 sends only `std::env::args()` and the cwd (D-Bus `ExecuteCallback(as, s)` on Linux, `WM_COPYDATA` on Windows), so the activation token can't go with it. It also `unwrap()`s the session bus, which aborts a release build that has none, and it runs inside Tauri's build, after GTK and the webview are up. So:
- **Linux:** the running app owns `io.github.johnson_anthony.glasshouse.App` on the session bus (object `/io/github/johnson_anthony/glasshouse/App`, interface `….App1`: `Open(mode, paths, skipped, startup_id)` and `NewWindow(startup_id)`). A debug build uses `….AppDebug`, so `tauri dev` doesn't hand off to an installed copy.
- **Windows:** a named pipe, `\\.\pipe\io.github.johnson-anthony.glasshouse.App-<user SID>-<session id>`: inbound, local clients only, the first instance claimed with `FILE_FLAG_FIRST_PIPE_INSTANCE`, and a new instance made before the connected one is read, so there's no gap. The client opens it with `SECURITY_IDENTIFICATION`, checks the server process runs as the same user, calls `AllowSetForegroundWindow(server pid)` and writes one JSON message.
- **The second launch** parses its own command line first (relative paths need its cwd), tries the handoff before Tauri or GTK start, and exits 0 when the running app took it. No answer (nothing running, no bus, a hung app) means it starts as before.
- **The running app** claims the name or pipe right after it decides to run, before building Tauri, and queues requests until it's ready, so a launch during startup isn't lost.
- **Focus:** on Linux the token becomes the display's startup ID (`gdk_wayland_display_set_startup_notification_id` or `gdk_x11_display_set_startup_notification_id`, looked up with `dlsym`, as GtkApplication does) just before the window is made; on X11 `gdk_notify_startup_complete` follows. A request with no token, and File → New Window, call `set_focus`.
- **The resident** calls `Open` first (on its own short-lived connection) and starts a window process only if that fails.
- `--chooser`, `--dbus` and `--integration-*` never hand off or serve.

**Windows in one process** (`app_windows.rs`, new):
- Labels `main` and `main-<n>`, the lowest free one; `capabilities/default.json` matches `["main", "main-*"]`. `tauri.conf.json`'s window gets `"create": false`, so every window, the first too, is made by our code from that config with its own label (the chooser sets `create` back).
- A registry: the windows open, in order; what each window's page starts with (plain, a launch, saved tabs, or "read the v1 key"); each window's last session report; the focused window; the labels a guest process must not take.
- `new_window(paths?)` (async, as WebView2 needs) opens a plain window, or one on a folder (the sidebar's Open in New Window, which opened a tab until now).
- `window_start` gives the page what it starts with. After its first report it gives that report instead, so a reload (Import Layout) keeps the window's tabs.
- `quit_app`: Quit (Ctrl+Q) quits every window and keeps them all in the session. Closing one window drops it from the session, unless it's the last.
- On page load (`on_page_load` Started, which a reload fires too) the window's watches and terminals are dropped; on `Destroyed` too, and its registry entry goes.
- `window_fit.rs` fits each window as it's made, not just `main`.

**Events per window:**
- `watch_dir`/`unwatch_dir` count per (window, folder), and `fs-changed` goes only to the windows watching that folder.
- `pty_spawn` records its window: `pty-data`/`pty-exit` go there, and its terminals are killed when it closes.
- `op-progress` goes to the window that started the op (the op commands take the calling window). The frontend's op ids get a random part, since two windows can load in the same millisecond.
- `update-progress` stays app-wide: an update is the whole app's.
- The frontend listens with its window as the target (`src/events.ts`, `listenHere`); a plain `listen` gets every window's events.

**Session** (`session.rs`):
- `session.json` in the config dir: `{ version: 1, focused, windows: [{ label, session }] }`, where `session` is the page's own record (the v1 shape, checked by `parseSession` as now). Rust writes it 500 ms after a change (temp file and rename), and on exit.
- Restore at a plain start: every saved window with tabs, all at once, each with its label, so the window-state plugin restores its size and place. The focused one is made first, so it takes the launcher's token. No `session.json` yet (0.2, phase 1): one window that reads the v1 key.
- The page also writes the v1 key when it owns the session and has focus (and on focus), so 0.2 and phase 1 reopen the focused window's tabs.
- A process started with paths doesn't restore and doesn't write. Its windows avoid the saved labels. **One addition:** a plain launch handed off to such a process makes it the owner then (if it can take `session.lock`): it restores the saved windows instead of opening one at home, and saves from then on. Otherwise, if the first window of the day came from "Show in folder", the session would stay shut away until every window closed.
- `session.lock` stays: a second process that couldn't hand off is still a guest.
- The automatic update check runs once in the app, not once per window (a lock around its daily gate).

**Settings in every window:** a `storage` listener on `glasshouse.tweaks` applies a change from another window without writing it back. `write_pins` and `write_tags` send `config-changed` to the other windows, which read the file again.

**Files:**
- Rust, new: `app_windows.rs`, `handoff.rs`, `handoff/dbus.rs` (Linux), `handoff/pipe.rs` (Windows).
- Rust, changed: `lib.rs`, `session.rs`, `startup.rs`, `resident.rs`, `watcher.rs` (+ tests), `pty.rs`, `ops.rs`, `window_fit.rs`, `update.rs`; the op commands in `commands/{hash,search,git,fs_ops,replace}.rs` and `chooser.rs` (one parameter each); `commands/config.rs`; `commands/launch.rs` (`spawn_new_window` goes); `permissions/app.toml`; `capabilities/default.json`; `tauri.conf.json`; `Cargo.toml` (windows crate features).
- Frontend: `events.ts` (new), `api.ts`, `App.tsx`, `useTabLayout.tsx`, `session.ts`, `state.ts`, `Sidebar.tsx`, `Miller.tsx`, `Terminal.tsx`, `ops.ts`, `opStore.ts`, `handlers/{nav,app,target}.ts`, `site/demo/mock/backend.ts`.
- e2e: window handles in `webdriver.mjs`, a "new window" flow in `smoke.test.mjs`.
- Docs: this plan; decision notes `2026-11-21-split-and-tear-off-session.md` (the successor), `…-handoff.md` and `…-one-process.md` (labels, events, the panic trade-off); ARCHITECTURE, INTEGRATION and `docs/testing/` items.

**Tests:**
- cargo: the session file's encode and decode (junk, labels, limits, windows with no tabs); the registry (labels, starts, reports, close and quit); the handoff message and its checks; per-window watch counts and dropping a window's watches; a pty's window and killing a window's terminals.
- vitest: `parseSession` from a value; the page reports, and writes the v1 key only with focus; the tweaks `storage` listener; `listenHere`.
- e2e "new window": File → New Window opens a second window in the same process (its label is `main-2`) and it lists a folder; a setting changed in one window reaches the other.
- By hand under Xvfb on a private bus: a second `glasshouse` launch opens a window in the running one (and `_NET_STARTUP_ID`); a restart restores two windows. Windows and Wayland focus go in `docs/testing/`.

# Phase 3: tear-off, in one process

From the lead's review (11-20) of the cross-process design:
- **The data is in memory.** A drag's data is a window label and a tab id. The receiving window asks the shared state for the tab, or the source hands it over. The tab's state travels as `src/tabTransfer.ts`'s record: folder, sort, history, filters, private. There's no `--tab` flag, stdin or "ready" ack, and no serialization.
- **Linux (X11 and Wayland):** an OS drag is still needed.
  - On Wayland the pointer stays grabbed by the source window, even between windows of one process.
  - A GTK drag with one custom target, `application/x-glasshouse-tab`, and no folder URI.
  - Every window's WebKitWebView handles `drag-motion`, `drag-drop` and `drag-data-received` for that target only, and leaves file drops to wry. The tab-bar rectangles are registered with the backend, so `drag-motion` answers at once.
  - `drag-failed` `NO_TARGET` means a new window at the drop. `USER_CANCELLED` means nothing. Check in nested niri whether Wayland reports these two apart.
  - The hand-off happens at the window's edge with the button down, as `drag_out.rs` does for files. The WIP branch has the frontend half: `beginTabDrag`'s "handoff" mode.
- **Windows:** the page keeps the pointer (the webview holds the capture while the button is down). On release outside the window, `GetCursorPos`, then `WindowFromPoint`, then its root window, checked against the app's own windows. Then an in-process move, or a new window at the cursor. The WIP branch has the frontend half: the "track" mode.
- **New window at the drop point:** `WebviewWindowBuilder` placed so the pointer sits over its tab bar, then fit to the work area (`window_fit.rs`). Wayland can't place windows, so the compositor does.
- **Move to New Window** on the tab menu, hidden for a window's only tab.
- **A window's only tab** dragged moves the window (`startDragging()`, already in phase 1).
- **Tests:**
  - the receiving window's handler, called directly with a fake drop;
  - cargo tests of the zone hit test and placement;
  - e2e: Move to New Window (the tab leaves, a second window lists it);
  - by hand: a real drag between two windows under Xvfb (XDND) and in nested niri.
