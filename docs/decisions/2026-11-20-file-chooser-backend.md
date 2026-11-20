# file-chooser: the portal backend and the dialog window

Date: 2026-11-20. Task: `file-chooser` (survey-2 task 31). Scope widened by the lead on 2026-11-20: every desktop, every app the standards reach.

## The problem
Other apps' open and save dialogs (Save As, attach a file, a browser's upload) are drawn by the app's toolkit, or, when the app asks xdg-desktop-portal, by the portal's FileChooser backend: xdg-desktop-portal-gtk, -gnome or -kde. glasshouse can be that backend on Linux. On Windows the dialog is the shell's common file dialog. Replacing it would mean loading a DLL into every process, which is off the table, so Windows isn't covered, and Preferences and docs/INTEGRATION.md say so.

## Chosen: a backend in the resident, one window process per dialog
- **`glasshouse --dbus file-chooser`** (`portal.rs`, served by task 30's resident) owns `org.freedesktop.impl.portal.desktop.glasshouse`. It serves `org.freedesktop.impl.portal.FileChooser` (OpenFile, SaveFile, SaveFiles) at `/org/freedesktop/portal/desktop`. It has no webview, so the portal can start it at login for little cost. `--dbus file-manager file-chooser` serves both services from one process.
- **Each call exports a Request at `handle`** and starts `glasshouse --chooser`. The request goes in as JSON on stdin, and the answer comes back as one JSON line. The resident replies to the portal when that process answers or ends; an exit without an answer counts as cancelled.
  - The chooser moves its stdout aside at start, to a close-on-exec descriptor, and points fd 1 at stderr, so WebKit's helper processes never hold the answer pipe open.
  - It runs in its own process group. Request.Close (the portal calls it when the app closes the request or disconnects) kills the group and replies 2. The portal requires a non-zero reply after Close: a 0 would still register documents for a sandboxed app.
  - It gets SIGTERM when the resident dies (`PR_SET_PDEATHSIG`).
- **Options.** The portal has already checked types and drops options it doesn't know, so parsing is lenient. OpenFile: `accept_label`, `modal`, `multiple`, `directory`, `filters`, `current_filter`, `choices`, `current_folder`. SaveFile adds `current_name` and `current_file`. SaveFiles takes `current_name`, `current_folder`, `files` and `choices`. Byte-string paths drop their trailing NUL, and a filter's MIME-type rules become that type's globs (shared-mime-info, as Open With reads it). A `current_filter` that isn't in the list becomes the only filter. Results: `uris` (`file://`), `choices`, and `current_filter`, the type in use. A cancel answers 1 with empty `uris`.
- **The window is `chooser.html`,** its own Vite entry (`src/chooser/`), so it loads none of the main window's code. It reuses the main window's Toolbar, Sidebar and FilePane, with a bottom bar:
  - the name field (Save, with the base name selected) or a location field (Open), the file types, the app's choices (checkbox or list), New Folder, Cancel and the app's accept label (GTK mnemonics read as plain text);
  - Enter and double-click accept, Esc cancels, Ctrl+L focuses the field, Ctrl+H toggles hidden files, and Enter in the search box searches subfolders;
  - a typed name that's a path (`~/x`, `../`, `/abs`) goes there, and a trailing `/` only navigates;
  - choosing another file type swaps the name's extension when the old type matched it;
  - Save asks before replacing (a confirm, Esc closes only that). SaveFiles asks once, listing the names that exist;
  - it starts at `current_file`'s folder, then `current_folder`, then the last folder picked for that `app_id` (the 50 most recent apps, in the chooser's localStorage), then home. The look comes from the user's saved theme, density and font.
- **Parenting** (`chooser.rs`): `x11:<xid>` gives a foreign GdkWindow and transient-for, as xdg-desktop-portal-gtk does. `wayland:<handle>` gives `gdk_wayland_window_set_transient_for_exported` (xdg-foreign). Otherwise the window is a free dialog. Modal when asked, with the dialog type hint, so tiling compositors float it.
- **First paint.** The window is made hidden and shown once the page has rendered. The resident puts its call time in the request, and the chooser logs the time to the first frame after the first listing. Measured with a debug build: 400–590 ms under Xvfb, 1.6–2.5 s in a nested niri (Wayland, EGL inside the nested compositor).

## Rejected
- **A window in the running main app:** a crash or a busy main window would take every app's dialog with it, and the main app needn't be running.
- **A webview in the resident:** the resident would carry WebKit (about 300 MB) for the whole session, and one dialog's state could leak into the next.
- **A long-lived chooser process kept warm** for a faster first paint: it costs memory all session. The cold start is under 600 ms under Xvfb. Reconsider if real sessions measure much slower.
- **Answering on stdout directly:** WebKit's helpers inherit fd 1, so the resident would wait for every helper to exit before it saw end-of-file.
