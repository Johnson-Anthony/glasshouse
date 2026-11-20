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
- [ ] **Phase 2, one process with many windows:** design below. Send it to the lead before building, on a fresh branch from main once phase 1 is merged.
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

**Open questions for phase 2:**
1. Who writes the session: Rust (one writer, sees every window) or each page (simpler, but they race)? Leaning to Rust holding each window's last report and writing on change.
2. Single-instance plugin or our own handoff? The plugin is less code. Our D-Bus already exists for FileManager1, but Windows would still need a pipe.
3. Does `--chooser` stay a process per dialog? It's another app's modal dialog with its own lifetime, so yes unless a reason turns up.
4. Restoring several windows: open them all at once, or only the last-focused one plus a "Reopen windows" item?
5. Private windows (if any later) and private tabs: never in the session, as now.
6. The panic trade-off (`panic = "abort"` closes every window) goes in the decision note. Task 33 adds a panic hook that logs.

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
