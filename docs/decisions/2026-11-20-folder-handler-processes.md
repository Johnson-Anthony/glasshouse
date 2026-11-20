# folder-handler: processes, the command line and focus

Date: 2026-11-20. Task: `folder-handler` (survey-2 task 30). Approved by the lead on 2026-11-20.

## The problem
Other apps hand folders to a file manager in two ways. They run its menu entry with a path (`%U`), or they call `org.freedesktop.FileManager1` on the session bus (`ShowFolders`, `ShowItems`, `ShowItemProperties`), which needs a process that owns the name. glasshouse had neither. It had no command line, and it already runs one process per window (File → New Window spawns itself).

## Chosen: a window process per request, plus a resident on Linux
- **`glasshouse [--select | --properties] [--] PATH|URI…`** opens a window (`startup.rs`, pure and tested).
  - A folder opens in a tab; a file opens its folder with it selected. `--select` selects every item, folders too (ShowItems); `--properties` also shows Properties for the first (ShowItemProperties).
  - `file://` URIs are taken as paths, and a non-local URI is skipped with a reason. Relative paths are taken from the current folder; `.` and `..` are resolved lexically.
  - `--dbus` and `--integration-on`/`--integration-off` count only as the first argument, so a folder named `--dbus` can still be opened after `--`.
  - On Windows, `"%1"` for a drive root arrives as `C:"` (MSVC argv rules) and is put back to `C:\`.
- **`glasshouse --dbus file-manager`** is the resident (`resident.rs`, Linux only). It has no webview. It owns the name and starts `glasshouse --select -- PATH…` (or the matching mode) for each call, then returns. That's the same process-per-window model as New Window, so a crash in one window takes nothing else down, and FileManager1 calls return at once.
- **The resident stays running.** It doesn't exit when idle, as caja, Nautilus and the portal backends don't. If it exited, another file manager could take the name in the gap. It exits when the bus goes away or when it's told to `Release` its last name.
- **It starts the binary it was started from** (`self_exe`, read once at start), so windows run the same build as the resident. For an AppImage that's `$APPIMAGE`, the file itself, because the mount the binary runs from goes away with the process that made it. A binary replaced while running reads as `… (deleted)`, and that suffix is dropped.
- **A control interface**, `sh.glasshouse.viles.Resident1` at `/sh/glasshouse/viles/Resident`, has `Version` and `Names` properties and a `Release(name)` method. The app uses it to tell that the owner of FileManager1 is glasshouse (a `Version` read on the owner's unique name) and to take the name back when the setting is turned off. Task 31 (the file-chooser portal) can add a second service to the same process: `--dbus file-manager file-chooser`.

## The session
A window started with paths is a session guest (`SessionOwner::guest()`): it doesn't take `session.lock`, so it neither restores nor saves tabs or the window's size. A "Show in folder" must not replace the tabs the user left, and the user's next plain start must still restore them. A plain start claims the session as before.

## Focus: the startup ID
A new window opened for another app is allowed to take focus only with that app's activation proof. FileManager1 calls carry it as `startup_id`.
- The resident passes it to the window as `DESKTOP_STARTUP_ID`. That's the only variable GTK 3 (webkit2gtk-4.1's toolkit) reads. GTK uses it when it maps the window, as the xdg-activation token on Wayland and the startup-notification ID on X11, and then unsets it.
- A launcher that sets only `XDG_ACTIVATION_TOKEN` (GTK 4 and Qt ones) has it moved to `DESKTOP_STARTUP_ID` at start (`take_activation_token`), and the old variable is removed so children don't inherit a used token.
- Checked end to end on a private bus:
  - **X11 (Xvfb):** the window's leader got `_NET_STARTUP_ID` = the ID, and its `_NET_WM_USER_TIME` came from the ID's `_TIME` part.
  - **Wayland (nested niri, `WAYLAND_DEBUG`):** the window sent `xdg_activation_v1.activate(<the ID>, surface)` right after its toplevel was made.
- An earlier version also called `set_focus` once the app was ready. The Wayland trace showed that made GTK ask for a token of its own as well. That's redundant, and a desktop with focus-stealing prevention may flag the window for it, so the call was dropped.

## Rejected
- **One process with many windows,** handling calls in the running app: that's a bigger change to the app (shared state, the session, window-state per window) than this task. New Window already works per process.
- **A resident that exits when idle:** it leaves a gap in which a running Nautilus or caja could take the name back.
- **D-Bus activation only, with no control interface:** then the app can't tell whether glasshouse or another file manager answers, which Preferences and Reveal in File Manager need.
