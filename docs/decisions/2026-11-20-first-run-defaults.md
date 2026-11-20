# first-run-defaults: the status bar, pins, tags and the first window

Date: 2026-11-20. Task: `first-run-defaults` (survey-3 task 40, owner decision D4; theme, font and window buttons were task 47).

## The problem
A new user's glasshouse looked like the owner's setup: a status bar with cpu, memory, network, uptime and a clock (plus a fake `i/o ▁▂▃▅▂▁` graph and a `READY` badge that never changed), polled every 2 s even while hidden; a sidebar saying "no pins yet"; tags named project, school, secret, review and archive; and a 1400×900 window that ran under the taskbar on a 1024×768 screen and was too big at 1920×1080 with 150% scaling.

## Chosen
- **One first-run signal**, as in `look.ts`: no `glasshouse.tweaks` in localStorage when the app starts. Settings saved without a newer setting keep what they showed; new users get the new defaults.
- **Status bar items are a setting** (`TweakState.statusItems`, `src/statusItems.ts`), shown or hidden one by one in Preferences → status bar, with "lean" and "everything" buttons.
  - New users: items and selection, size, free space. Size is the selected files' when something is selected (as other file managers show it), else the folder's files'.
  - Free space is new: `path_space` (`statvfs`, `GetDiskFreeSpaceExW`) for the folder's volume, read when the folder or its listing changes. Saved settings don't get it, since they never had it.
  - Opt-in: folder path and git branch (both repeat the path bar), file system, cpu, memory, network, uptime, clock, terminal button. Settings saved before get all of these, so the owner's bar looks the same.
  - Gone for everyone: the `i/o` graph (made up) and `READY` (it said READY during a long copy too). Neither reported anything, so neither is "what they see" worth keeping. The git item shows nothing outside a repository instead of "⎇ —". Memory is one item ("mem 37% 5.9G"), not two segments both labeled mem.
  - Fetching follows what shows: `system_info` every 2 s only for cpu, memory or uptime; `net_rate` every 2 s only for network; a 1 s tick only for the clock (it showed seconds but moved every 2 s); nothing while the window is hidden (`visibilitychange`) or the status bar is off (it isn't rendered then).
- **A first run's pins** (`src/places.ts`): home and the known folders that exist (Desktop, Documents, Downloads, Music, Pictures, Videos, wherever the OS keeps them), then the desktop's own bookmarks (`desktop_places`), each once.
  - Only when it's a first run **and** there is no pins file: `read_pins` returns null for a missing file now, so someone who removed every pin keeps none, and someone whose settings were lost but whose pins file is there keeps their pins.
  - GTK's `gtk-3.0/bookmarks` (or the old `~/.gtk-bookmarks`) and KDE's `user-places.xbel`: `file://` entries only; KDE's hidden entries and its own system entries (Home, Root, Trash, Network) are left out. The xbel file is scanned for `<bookmark>` elements rather than parsed with an XML crate: KDE writes it one way, and a new dependency would be bigger than the scan.
  - Windows: Quick Access, enumerated through the shell (`shell:::{679f85cb-0220-4080-b29b-5540cc05aab6}` as an `IShellItem`, `BHID_EnumItems`, each item's `SIGDN_FILESYSPATH`). That list has the pinned folders and the frequent ones, which are a fair start too; telling them apart needs a property that differs between Windows 10 and 11. Reading `f01b4d95cf55d32a.automaticDestinations-ms` directly was rejected: an undocumented compound file.
  - Only folders that exist, at most 24, and the bookmarks get 3 s (a share that's gone can hold the OS's calls up); then the known folders are pinned alone. A pin added meanwhile is kept.
  - Pins stay paths: a bookmark's own label isn't kept (pins have none).
- **Tags** (`TweakState.tagSet`): new users are offered important, todo, work, personal and archive; settings saved before keep project, school, secret, review and archive. Every label of both sets keeps its color in either. "none" was the other option, but then new tags would all be gray and the TAGS group would start empty with nothing to explain it.
- **The window fits the screen** (`src-tauri/src/window_fit.rs`), when the app's Ready event comes: the window exists, the window-state plugin has restored it (its restore runs as the window is made), and nothing has been painted.
  - Nothing saved (a first run): the config's size, capped at 90% of the work area of the monitor the OS put it on (never under the 960×600 minimum unless the work area is smaller), centered there. 1920×1080 at 100% gets 1400×900; the 1024×720 runner gets 960×648; 1920×1080 at 150% gets 1152×619 logical.
  - Restored, or a second window (which has no saved state and is placed by the OS): left alone if it fits; otherwise the side that doesn't fit shrinks (to 90%, at least the minimum) and the window moves inside the work area.
  - A work area smaller than the minimum size lowers the minimum for that run.
  - Maximized and fullscreen windows are left alone. (A window restored maximized whose normal size doesn't fit will still un-maximize too big; rare, and fixing it means un-maximizing first.)
  - The two agree: the plugin's move and resize handlers run after the fit, so it saves the fitted size, and the next start restores a size that fits. Whether something was saved comes from the plugin's own file (`.window-state.json`, an entry for `main` with a size), the same test its restore makes.
  - On Linux the window hasn't been configured yet when Ready comes: its size and place read as zeros, and the plugin's restore is only queued. The fit then works from what the window was asked to be, the saved size and place from that same file, or for a second window the config's size, whose size alone is changed so the window manager still places it. Its requests are queued after the plugin's, so they win.
  - The file chooser's window gets the same fit (Fresh). tauri.conf.json isn't changed.
  - Tauri's `preventOverflow` was rejected: it fits only when the window is made, on the primary monitor, before the plugin restores a saved size, and it can't take a share of the work area.

## Checked
- Linux under Xvfb at 1024×768 and 1920×1080 (no window manager): a first run opens centered at 960×691 and 1400×900; a saved 3000×2000 window is restored at 960×691; one saved partly off the screen moves in at its size; one saved off every monitor is moved onto the primary; one that fits stays where it was. After Ctrl+Q the plugin's file holds the fitted size. `pnpm e2e` passes at both sizes.

## Not verified
- Windows: Quick Access enumeration, `path_space`'s `GetDiskFreeSpaceExW` and the window fit on a real Windows desktop (the CI windows job and its e2e leg are the first runs). The Quick Access code was type-checked for `x86_64-pc-windows-msvc`.
- KDE and GNOME desktops: the bookmark files were tested as files, not with Dolphin or Files writing them.
- A second window's fit on Linux, and the fit under a real window manager or a Wayland compositor (which places windows itself and ignores positions).
