# session-persistence: what's saved, where, and with several windows open

Date: 2026-11-15. Task 18 of `docs/plans/active/survey-2.md`. Code: `src/session.ts`, `src-tauri/src/session.rs`, the startup and save effects in `App.tsx`, `lib.rs`.

## Context
Nothing survived a restart: every start was one tab at home, 1400×900, sorted by Name, with every panel shown. File → New Window (`spawn_new_window`) starts another glasshouse process, not a second window in this one, so "several windows" means several processes, each with its own webview. They share the app config dir and (on both WebKitGTK and WebView2) the same localStorage, and nothing else.

## Decisions

**The first process running owns the session; later ones neither restore nor save.**
- `session.rs` takes an exclusive, non-blocking lock (`File::try_lock`) on `session.lock` in the app config dir, and holds it until the process ends. The OS drops it on exit, crash included, so a stale lock can't lock everyone out. A process that finds it taken isn't the owner.
- The owner restores the window's size and place and the tabs, and saves both. Any other window opens one tab at home at the default size and saves neither. New Window used to open the same way, so nothing changes for it; it can no longer clobber the first window's tabs, or open its tabs on top of it.
- This also covers launching the app twice from the launcher, which a "this process was started by New Window" flag wouldn't.
- When the owner closes first, the others stay non-owners (nobody takes the lock over). What comes back next time is what the owner had when it closed. Taking over would have the last window closed win, which is what browsers do, but it means a window that never restored anything starts saving over the record, and it needs a lock retry while running. The simple rule is easier to predict: the window you started first is the one that's remembered.
- If the lock file can't be made or locked (no config dir, a read-only one, a file system without locks), the process counts as the owner. Saving with no guard is better than never saving.
- The frontend asks `session_owner` (permission group `settings`). Without a backend (the Vite dev server in a browser) it counts as the owner.

**Window size and place: `tauri-plugin-window-state`, registered only in the owner.** The plugin restores a window as it's made, and Tauri makes the config's main window when the app starts running, after the setup hook. So `lib.rs` now calls `build()`, claims the lock, registers the plugin on the handle if it owns the session, then `run()`s. A denylist wouldn't do for the other processes: the plugin writes back every label it loaded from disk when it exits, so a second window would overwrite the owner's newer size with the one it read at its start. It restores size, position and maximized; not visibility or decorations (the app never changes them), and not full screen, which would be a surprise at startup. On Wayland (niri here) the compositor places windows, so the position isn't restored there, and a tiling compositor may size the window itself.

**No capability for the plugin.** The frontend never calls the plugin's commands (it saves on exit by itself), so `capabilities/default.json` doesn't grant `window-state:default`. Granting it would only open three unused commands to the webview.

**The tabs: localStorage, under a versioned key.** `glasshouse.session.v1` holds `{ tabs: [{ path, sort: { key, dir } }], active }`, next to `glasshouse.tweaks` and the other UI keys.
- Parsing checks every field. A tab whose path isn't an absolute path is dropped, an unknown sort becomes Name ascending, an active index that's missing or out of range lands on a real tab, and more than 100 tabs is cut to 100. If no tab is left, or the JSON is broken, the start is a fresh one, and the next save replaces the record. A future format gets a new key, so an old record is ignored rather than misread.
- App writes the record whenever the tab list, the active tab, or a tab's folder or sort changes, and only when it differs from the last write. There's no save on close, so a crash or an OOM kill loses nothing.
- Private tabs aren't saved; they'd otherwise bring a private folder back after a restart. With only private tabs open, the record has no tabs and the next start opens home.
- Export Layout leaves the session out and Import Layout ignores it: a `.glasshouserc` lands in the current folder and is meant to be shared, so it shouldn't carry the folders you had open. Import Layout reloads the window, which now keeps its tabs.

**A folder that's gone opens its nearest existing parent, or home.** Each saved folder gets one `path_kind` stat, walking up until one is a folder, all tabs at once before the first tab is made, so there's no error pane and no flash of one. A folder replaced by a file counts as gone. A check that can't answer ("unknown", or nothing within 1.5 s, as an offline share may take far longer) keeps the saved path, and that tab's listing says what's wrong, as navigating there would.

**Panel visibility is a setting.** `showSidebar`, `showInspector` and `showStatusBar` join `TweakState` in `glasshouse.tweaks`, like Show Hidden Files and Folders First, which the View menu also toggles. Every window reads them, so a second window opens with the same panels. Only a saved `false` hides a panel: a missing or odd value shows it.

**The demo** (`site/demo`) owns its session, so the capture checks run the saving code, but its storage lives in memory (`install.ts`), so no visit reopens another's tabs.

## Not done
- Restoring the other windows' tabs: each non-owner window's tabs are lost when it closes.
- The tab's history (Back/Forward), selection, filter and scroll position aren't saved; a restored tab starts with an empty history at its folder.
- Two windows changing settings still overwrite each other's `glasshouse.tweaks` (as before); panel visibility is now part of that.
