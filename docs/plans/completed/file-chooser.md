# file-chooser (task 31)

Make glasshouse the open/save dialog other apps show: a text editor's Save As, a messaging app's attach-a-file, a browser's upload. On Linux that's an `org.freedesktop.impl.portal.FileChooser` backend for xdg-desktop-portal. Windows can't replace the common file dialog without DLL hooks (off the table), so this is Linux only, and the docs and Preferences say so. Scope: survey-2.md §31, as widened by the lead on 2026-11-20 (every desktop, every app the standards reach, testing only on a private bus). Builds on task 30's resident (`resident.rs`).

## Status
Done, 2026-11-20 (plan in `docs/plans/completed/`). Checks and the end-to-end results are below.

| Step | State |
|---|---|
| Plan; decisions (`docs/decisions/2026-11-20-file-chooser-backend.md`, `…-integration.md`) | done |
| Resident: `--dbus file-chooser` owns `org.freedesktop.impl.portal.desktop.glasshouse`; OpenFile, SaveFile, SaveFiles; Request.Close | done |
| Chooser window process (`glasshouse --chooser`, request on stdin, answer on a private fd) | done |
| Frontend: `chooser.html`, the pane plus the bottom bar; Save's replace prompt; typed paths; search in subfolders | done |
| Parent window (`x11:` transient-for, `wayland:` xdg-foreign); float otherwise; time to first paint | done |
| Integration: one switch (service file, .portal, portals.conf, environment.d and the session's service manager, portal restart); Advanced per-toolkit checkboxes; self-clean-up when glasshouse is gone; `--integration-on/off dialogs` | done |
| Packaging: the .deb ships `glasshouse.portal` and the D-Bus service file (both inert until the switch names glasshouse) | done |
| Docs: INTEGRATION.md (one switch first; the toolkit table as reference; apps covered and not), ARCHITECTURE, SPEC, README; demo mock | done |
| Checks; end-to-end on a private bus | done |

## What the portal does (read from xdg-desktop-portal 1.20.3's source and checked on a private bus)
- Backend files (`*.portal`): `$XDG_DATA_HOME/xdg-desktop-portal/portals`, then each `$XDG_DATA_DIRS`, then the build's datadir. The user and data-dirs search is new in 1.20.1; 1.17–1.20.0 read only the build's datadir (`/usr/share/...`), so there a root-owned file is needed.
- `portals.conf`: the first file found wins, no merging. Order: `$XDG_CONFIG_HOME`, `$XDG_CONFIG_DIRS`, `/etc`, `$XDG_DATA_HOME`, `$XDG_DATA_DIRS`, `/usr/share`; in each, `<desktop>-portals.conf` for each `XDG_CURRENT_DESKTOP` entry (lowercased), then `portals.conf`. A file with no keys in `[preferred]` doesn't count. Config support is 1.17+; the list order is honored from 1.19.0 (1.17–1.18 take the first *sorted* backend that's listed).
- Both are read once at start, so a change needs a portal restart.
- The backend gets `handle` (where it exports `org.freedesktop.impl.portal.Request`), `app_id`, `parent_window`, `title`, options. The frontend forwards only known options: OpenFile `accept_label modal multiple directory filters current_filter choices current_folder`; SaveFile `accept_label modal filters current_filter current_name choices current_folder current_file`; SaveFiles `accept_label modal current_name current_folder files choices`. Results: `uris` (file:// only), `choices`, `current_filter`, `writable` (missing = writable). A non-zero response forwards only an empty `uris`. Close: the frontend calls the backend Request's `Close`; the reply after that must be non-zero (a 0 would still register documents for a sandboxed app).

## Design (details in the decisions)
**Processes.** The resident (`glasshouse --dbus file-chooser`, D-Bus activated, no webview) owns `org.freedesktop.impl.portal.desktop.glasshouse` and serves the impl interface at `/org/freedesktop/portal/desktop`. Each call exports a Request at `handle`, starts `glasshouse --chooser` with the request as JSON on stdin, and waits. The chooser process moves its stdout aside at start (its WebKit children never hold the answer pipe) and writes one JSON answer line to it. Close kills the chooser's process group and replies 2. The chooser dies with the resident (`PR_SET_PDEATHSIG`). `--dbus file-manager file-chooser` serves both from one process.

**The window.** `chooser.html` (its own Vite entry, so it doesn't load the main app's code): Toolbar (back/forward/up, breadcrumbs, the fuzzy filter, hidden toggle), Sidebar, FilePane, and a bottom bar with the name field (Save), the filter list, the choices, Cancel and the accept button. Enter and double-click accept, Esc cancels, a path typed in the name field goes there. Searching subfolders shows matches as rows. The window starts hidden and is shown after the first paint; the resident's call time goes in the request, and the chooser logs the time to first paint.

**Parenting.** `x11:<hex xid>`: `gdk_x11_window_foreign_new_for_display` + `gdk_window_set_transient_for` (as xdg-desktop-portal-gtk does). `wayland:<handle>`: `gdk_wayland_window_set_transient_for_exported` (xdg-foreign). Dialog type hint and modal when asked, so window managers float it.

**Turning it on** is one switch (lead's direction, 2026-11-20), off by default and fully undone; the steps, the version rules and what was rejected are in `docs/decisions/2026-11-20-file-chooser-integration.md`. In short: the user service file (a `/bin/sh` script that cleans up when glasshouse is gone), `glasshouse.portal` (1.20.1+; older: the .deb's copy or the one root command), the FileChooser line in the portals.conf the running portal reads, the toolkit opt-ins in `~/.config/environment.d/60-glasshouse-dialogs.conf` plus `SetEnvironment` in the systemd user manager, and a portal restart. The opt-ins are each a checkbox under Advanced: `GTK_USE_PORTAL=1`, `GDK_DEBUG=portals` (only for GTK 4.10–4.16), `QT_QPA_PLATFORMTHEME=xdgdesktopportal` (or `PLASMA_INTEGRATION_USE_PORTAL=1` on KDE).

## Testing
Never the live session: a private `dbus-run-session` bus with scratch HOME, XDG_CONFIG_HOME, XDG_DATA_HOME, XDG_DATA_DIRS and XDG_RUNTIME_DIR (the document portal's FUSE mount must not land on the real one), a private xdg-desktop-portal on it, windows under Xvfb or a nested niri, all inside a `systemd-run --user --scope -p MemoryMax=2G` unit, and `pgrep` afterwards. Unit tests: option parsing, results, portals.conf edit/restore, the .portal and service files, environment.d lines, filter matching, typed names, extension swaps.

## Results
End to end on a private bus (dbus-daemon with its own config, scratch HOME, XDG dirs and runtime dir, xdg-desktop-portal 1.20.3 with -gtk as the desktop's backend, `XDG_CURRENT_DESKTOP=niri`), windows under Xvfb and in a nested niri 26.04, each in a 2G scope. The user's session was never touched: its portal (pid 2303) ran throughout, and nothing was written under the real `~/.config` or `~/.local/share`.
- **The portal API** (`portal_call.py`, a Gio client that stays connected; `gdbus call` alone gets its request closed when it exits):
  - OpenFile with every option returned two files, the choices and the current filter;
  - SaveFile: the replace prompt, the extension swapped with the filter, and a choice came back;
  - SaveFiles to a typed `~/Documents` asked about the one existing name;
  - directory mode answered the folder shown; Esc answered 1; the app's Close killed the dialog's process; double-click accepted.
- **Real apps**, each showing glasshouse's dialog and getting the file back:
  - GTK 3 (FileChooserNative, `GTK_USE_PORTAL=1`), GTK 4.18 (`Gtk.FileDialog`, no setting) and zenity;
  - Qt 6 (PyQt6 with the platform theme; without it, Qt's own dialog);
  - Chromium 151 (no setting); LibreWolf 157 in a new profile (no setting, and the same with `GTK_USE_PORTAL=1`); Firefox ESR 140 (`GTK_USE_PORTAL=1`; without it, its own GTK dialog).
- **LibreWolf** asks the portal on its own, so the GTK dialog the owner saw was xdg-desktop-portal-gtk's. No policies.json or prefs fallback is needed.
- **A running app follows the switch.** A GTK 4 app's first dialog was xdg-desktop-portal-gtk's; after `--integration-on dialogs`, the same process's next dialog was glasshouse's. GTK decides once per process whether the portal is there, so an app started during the portal's restart kept GTK's built-in dialog.
- **Parenting:** X11 transient-for (`x11:600003` and others); Wayland through xdg-foreign (`wayland:ZB7L…`), floated by niri over the app. Closing the window answered cancel.
- **First paint** (debug build, from the app's call): 400–590 ms under Xvfb; 1.6–2.5 s in the nested niri.
- **On and off:** on wrote the five files (service, .portal, the niri-portals.conf copy with `FileChooser=glasshouse;gnome;gtk;`, environment.d with `GTK_USE_PORTAL=1` and `QT_QPA_PLATFORMTHEME=xdgdesktopportal`, dialogs.json) and restarted the portal, which started the resident itself. Off removed them, restarted the portal (SIGTERM path; no systemd on the private bus), the resident gave the name up, and the next dialog was xdg-desktop-portal-gtk's.
- **Clean-up when glasshouse is gone:** on from a hard link, the link deleted, the portal restarted. The service file's script removed the .portal, the environment.d file and itself (the portals.conf copy too, after a fix this run found), and the portal came up without a FileChooser backend until its next start. The script's `systemctl --user try-restart` couldn't reach a manager on the private bus, so that restart wasn't run.

## Checks
`pnpm build`; `pnpm test` (913 passed, 2 skipped); `pnpm check:wiring` 0/0/0/0; `pnpm notices --check` (up to date); `RUSTFLAGS="-D warnings" cargo clippy --all-targets` clean; `cargo test` 322 passed, 5 ignored; `pnpm site:build` (demo rebuilt and committed); `pnpm site:capture check` all PASS. Not built here: the Windows side of `integration.rs` (the third Limits line, `dialogs: None`) and `cli_keys`/`off_from_cli` on Windows; the windows-latest CI job is their first compile.

## For the lead
- **CHANGELOG (New):**
  - **glasshouse can be the open and save dialog other apps show** (Linux). One switch, Edit → Preferences → Integration → "Use glasshouse for open and save dialogs" (or `glasshouse --integration-on dialogs`), off by default, makes glasshouse's window the Open, Save As, attach and upload dialog of every app it can reach, with no per-app setup. Flatpak and Snap apps, Chromium, Chrome and Electron apps, GTK 4.18 and recent Firefox-based browsers switch at once; GTK 3, Qt and other Firefox releases from the next login. Turning it off puts the desktop's dialog back. Windows' own dialogs can't be replaced. See docs/INTEGRATION.md.
  - **The dialog** is glasshouse's file pane, sidebar and search, with the app's file types and options. A typed path goes there, the extension follows the file type, saving over a file asks first, and it opens where you last picked for that app.
  - **`glasshouse --integration-off dialogs`** turns one setting off; with no names it still turns them all off.
- **Follow-ups:** first paint on a real session with a release build; the switch on GNOME, KDE and a GTK 4.10–4.16 system (`GDK_DEBUG=portals` session-wide); the clean-up script's systemd restart and environment.d at a real login; `--integration-off` with no names also turns off folders and file-manager, so the owner's session should use `--integration-off dialogs`.

