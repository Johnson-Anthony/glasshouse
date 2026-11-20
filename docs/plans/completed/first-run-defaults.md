# Task 40: first-run-defaults

Scope: §40 of `docs/plans/active/survey-3.md`, plus its "for 40" items under "Found by tasks" (generic seeded tags; the first window fitting a small screen). Theme, font and window-control defaults were task 47 (`src/look.ts`) and stay as they are.

## Status
Done. All steps are in; the checks below passed on 2026-11-20.

| Step | What | Status |
|---|---|---|
| 1 | Plan and decisions | done |
| 2 | Window: fit the monitor's work area after window-state restores (Rust, `window_fit.rs`) | done |
| 3 | Status bar: items setting, lean default, saved settings keep theirs, no fake i/o or READY, polling only for shown items; free space (`path_space`) | done |
| 4 | First run: seed pins with the known folders and the desktop's bookmarks (`desktop_places`: GTK, KDE, Quick Access) | done |
| 5 | Tags: a generic seeded set for new users; saved settings keep the old five | done |
| 6 | Demo mock, tests (vitest, cargo, e2e), docs | done |

Checks: `pnpm build`; `pnpm test` (73 files, 1061 passed, 2 skipped); `pnpm check:wiring`; `pnpm notices --check`; `pnpm site:build` and `pnpm site:capture check`; `RUSTFLAGS="-D warnings" cargo clippy --all-targets`; `cargo test`; `pnpm e2e` (7/7, and 7/7 again on a 1024×768 screen); the window fit checked by hand under Xvfb (see the decision record). The Windows code (Quick Access, `GetDiskFreeSpaceExW`) was type-checked for `x86_64-pc-windows-msvc` through a scratch crate, not built.

Not verified: Windows at all (CI's windows job and e2e leg are the first runs); KDE and GNOME writing their bookmark files; a second window's fit on Linux; the fit under a real window manager or Wayland compositor.

Follow-ups:
- `docs/media/` (hero images, tour clips) still show the old status bar (READY, the i/o graph); `pnpm site:capture` re-records them.
- A window restored maximized whose saved normal size doesn't fit un-maximizes too big.

## Design
- **One first-run signal.** As in `look.ts`: no `glasshouse.tweaks` in localStorage when the app starts means a new user. Saved settings without a new field are from before this task and keep what they show.
- **Status bar** (`src/statusItems.ts`): `statusItems`, a list of the items shown, in TweakState.
  - New users: items and selection (`sel 3 / 120`), size (the selection's when there is one, else the folder's files), free space on the folder's drive.
  - Opt-in in Preferences → status bar: folder path and git branch (both repeat the toolbar), file system, cpu, memory, network, uptime, clock, terminal button.
  - Saved settings without `statusItems` get every item they had. The fake `i/o ▁▂▃▅▂▁` graph and the static `READY` badge go for everyone: neither reports anything.
  - Polling: `system_info` every 2 s only while cpu, memory or uptime show; `net_rate` only while network shows; the clock ticks each second only while it shows; nothing while the bar is hidden or the window is in the background.
  - Free space: a new `path_space` command (`statvfs` on unix, `GetDiskFreeSpaceExW` on Windows), read when the folder or its listing changes, not on a timer.
- **Pins on first run** (`src/places.ts`): when it's a new user and no pins file exists (`read_pins` now returns null for a missing file, so a user who removed every pin keeps none), pin Home, Desktop, Documents, Downloads, Music, Pictures and Videos where they exist, then the desktop's own bookmarks (`desktop_places`):
  - GTK: `$XDG_CONFIG_HOME/gtk-3.0/bookmarks` (and the old `~/.gtk-bookmarks`), `file://` lines only.
  - KDE: `$XDG_DATA_HOME/user-places.xbel`, `file://` bookmarks that aren't hidden or system items (Root, Trash, Network).
  - Windows: Quick Access through the shell (`shell:::{679f85cb-…}` enumerated as IShellItems, folders with a file-system path only); pinned and frequent folders both come back.
  - Only folders that exist, deduplicated; at most 3 s for the bookmarks, then the known folders alone. A pin added meanwhile is kept.
- **Tags**: new users get a generic set (important, todo, work, personal, archive); saved settings get the old five (project, school, secret, review, archive), so nothing changes for them. Colors stay known for every label of both sets.
- **Window** (`src-tauri/src/window_fit.rs`): runs at the app's Ready event, after the window-state plugin has restored the window (the plugin's restore runs as the window is made). On Linux the window isn't configured yet then, so the fit works from what it was asked to be (the saved state, or the config's size).
  - First run (no saved state for `main`): the config's 1400×900 (logical), capped at 90% of the work area of the monitor it opens on, centered there.
  - A restored or guest window that fits stays as it is; one that doesn't is shrunk to fit and moved inside the work area.
  - A work area smaller than the window's minimum size (960×600) lowers the minimum for that run.
  - The plugin saves what the window ends up as (its move/resize handlers run after the fit), so the next start restores a size that fits.
  - The file chooser's window gets the same fit.
  - tauri.conf.json is not changed.

## Coordination
- Task 35 (release-identity) changes the identifier, which moves the config dir and the webview's localStorage. If its migration doesn't carry localStorage over, existing users look new here: the lean status bar, the generic tags, and pins seeded only when no pins file exists.

## Decisions
- `docs/decisions/2026-11-20-first-run-defaults.md`
