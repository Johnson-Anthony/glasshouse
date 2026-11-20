# folder-handler (task 30)

Make glasshouse the file manager other apps hand off to: a browser's "Show in folder", "Open containing folder", a folder opened from another app. Scope: survey-2.md §30, widened by the lead on 2026-11-20 (every Linux desktop, Windows opt-in, packaging). Task 31 (file-chooser) builds on the resident D-Bus mode made here.

## Status
Done 2026-11-20. Everything below is built and checked on Linux. The Windows parts are type-checked and unit-tested only, until CI's new `installers` job runs on windows-latest.

| Step | State |
|---|---|
| Plan, decisions (`docs/decisions/2026-11-20-folder-handler-{processes,integration}.md`) | done |
| Command line (`glasshouse PATH…`, `file://`, `--select`, `--properties`, `--integration-on`/`--integration-off`) | done |
| Frontend: launch tabs, multi-select reveal, Properties | done |
| Resident `--dbus file-manager`: FileManager1 + control interface | done |
| Reveal in File Manager doesn't loop back | done |
| Linux integration: mimeapps.list (+ desktop-specific lists), hidden entry, service file, mimeinfo.cache, other-copy warning | done |
| Windows integration: HKCU Directory/Drive verbs | done (type-checked, unit-tested; first real run is CI's `installers` job) |
| Preferences → Integration | done |
| Packaging: deb/AppImage desktop template (no MimeType), NSIS hook, WiX fragment | done (deb built and checked here; NSIS and MSI unbuilt until CI or a release) |
| CI: `installers` job (windows-latest: debug NSIS + MSI build, install / turn on / uninstall / registry check) | done (not run yet) |
| Docs: SPEC, ARCHITECTURE, README, `docs/INTEGRATION.md`, decisions | done |
| Checks + e2e on a private bus (Xvfb for X11, nested niri for Wayland) | done |

### Results
- `pnpm build`, `pnpm test` (900 passed, 3 skipped), `pnpm check:wiring` (0/0/0), `pnpm notices --check`, `pnpm site:build` (demo rebuilt), `pnpm site:capture check`: pass.
- `cargo clippy --all-targets` with `-D warnings`, `cargo test` (289 passed): pass. `integration_win.rs` under clippy for `x86_64-pc-windows-msvc` through a scratch crate: pass.
- End to end, on a private bus with scratch HOME and XDG dirs (never the live session):
  - **X11 (Xvfb):** `--integration-on folders file-manager`. Then a `ShowItems` of two files after `Release`, so D-Bus activation picked our user service file over caja's `/usr/share` one. The window opened the folder with both selected; it got `DESKTOP_STARTUP_ID`, its leader `_NET_STARTUP_ID`, and `_NET_WM_USER_TIME` from the ID's `_TIME`. `xdg-open <folder>` (generic mode) and `XDG_CURRENT_DESKTOP=MATE xdg-open` (`gio open`) each opened a window. `--integration-off` removed both files, restored the earlier `caja-folder-handler.desktop` default and released the name.
  - **Wayland (nested niri, winit):** `ShowItems` opened a focused window with the file selected. `WAYLAND_DEBUG` showed one `xdg_activation_v1.activate` carrying the caller's token, sent as the toplevel was made.
- Found and fixed by the e2e run: xdg-open's generic mode can't unquote `Exec`, so the hidden entry now writes the path bare when nothing in it needs quoting. Also, the `set_focus` at Ready was redundant (GTK already sends the startup ID at map) and made GTK ask for a second token, so it's gone.

## Design
**Processes.** One process per window, as New Window already does. `glasshouse --dbus file-manager` is a resident with no webview, started by D-Bus activation. It owns `org.freedesktop.FileManager1` and spawns a window process per call. It stays running (no idle exit), as caja, Nautilus and the portal backends do, so another file manager can't grab the name in a gap. It spawns the binary path it started from, so a rebuilt binary is what the windows run. Every resident also serves a control interface, `sh.glasshouse.viles.Resident1` at `/sh/glasshouse/viles/Resident` (`Version`, `Release(name)`), which is how the app tells "glasshouse owns the name" and how turning the toggle off makes it give the name back. Task 31 adds `file-chooser` as a second service the same process can serve.

**Command line.** `glasshouse [--select | --properties] [--] PATH|URI…`. Plain: a folder opens, a file opens its folder with it selected. `--select` (ShowItems): every item selected in its parent, even folders. `--properties` (ShowItemProperties): like `--select`, then Properties for the first. One tab per folder, items of the same folder selected together. A window started with paths doesn't claim the session (`session.lock`): it neither restores nor saves tabs, so a "Show in folder" never replaces the user's saved tabs. On Windows, `"C:\"` arrives as `C:"` (MSVC argv rules) and is fixed back.

**Startup ID.** The resident passes `startup_id` to the window as `DESKTOP_STARTUP_ID`. GTK 3 (webkit2gtk-4.1's toolkit) reads only that variable and uses it as the xdg-activation token on Wayland and the startup-notification ID on X11 (checked in libgdk-3 3.24.49). A window launched with only `XDG_ACTIVATION_TOKEN` (GTK 4 / Qt launchers) has it copied over at start, and it's removed so children don't inherit a used token. GTK sends it when it maps the window (checked on X11 and Wayland), so nothing else is needed.

**Linux toggles** (Preferences → Integration, off by default, each fully undone):
- *Open folders with glasshouse:* writes a hidden desktop entry `glasshouse-folders.desktop` in `$XDG_DATA_HOME/applications` (Exec = the running binary, or `$APPIMAGE`, with `%U`; `TryExec`, so GIO and KDE skip it if the binary goes away), and sets `inode/directory` in `$XDG_CONFIG_HOME/mimeapps.list`, plus in any `$XDG_CONFIG_HOME/<desktop>-mimeapps.list` that sets it (those win over mimeapps.list). The previous values are kept in `integration.json` in the app config dir and put back when turned off; a line the user has changed since is left alone. A symlinked mimeapps.list is written through.
- *Show files for other apps:* writes a user D-Bus service file for `org.freedesktop.FileManager1` (`Exec='<binary>' --dbus file-manager`) in `$XDG_DATA_HOME/dbus-1/services`, asks the bus to reload, and starts the resident. A running owner (caja, Nautilus kept alive by GNOME) keeps the name: the resident asks without queueing and replaces only an owner that allowed replacement; Preferences says who holds it. Off: remove the file, reload, `Release` the name.
- No FileManager1 service file in `/usr/share` from the .deb: two system files for one name make dbus pick either (the spec calls it undefined), so it would race caja's or Nautilus's.
- The .deb and AppImage menu entry (`src-tauri/linux/glasshouse.desktop`) has `Exec=glasshouse %U` but no `MimeType`: with no folder default set anywhere, an entry that takes `inode/directory` could become the folder handler on install (tiling setups). The hidden entry the setting writes carries the type instead. Agreed with the lead on 2026-11-20.

**Windows toggle** (opt-in): HKCU\Software\Classes\Directory\shell and Drive\shell get a `glasshouse` verb (`"glasshouse.exe" "%1"`) and become its default; the previous default is kept as a value on our verb key, so the NSIS uninstaller (POSTUNINSTALL hook, skipped on update) and the MSI (an immediate custom action running `glasshouse.exe --integration-off`, skipped on upgrade) can put it back. Virtual folders (This PC, Recycle Bin, Control Panel), Explorer's own Show in folder (SHOpenFolderAndSelectItems) and Win+E stay Explorer's. The key-building is pure and tested here; the registry calls are type-checked through the scratch crate only.

**Reveal in File Manager** asks the bus first: if glasshouse owns FileManager1, or nobody does and our service file is installed, or the ShowItems fallback would open a folder with our desktop entry, the backend answers `self` and the tab reveals the item in place.

## Testing
Never the live session: a private bus (`dbus-run-session` or a scratch config), scratch `XDG_CONFIG_HOME`/`XDG_DATA_HOME`/`XDG_DATA_DIRS`, `gdbus`/`busctl` on that bus. Windows for the e2e check open under Xvfb (X11) and in a nested niri (Wayland: winit backend, scratch config, own Wayland socket), each in a `systemd-run --user --scope -p MemoryMax=2G` unit that's stopped afterwards. Unit tests: argument parsing, mimeapps.list edit and restore, desktop-entry and service-file quoting (round trip through `xdg_apps`'s Exec parser), registry key plans, the frontend's launch planning.
