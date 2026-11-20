# folder-handler: what the Integration settings write, and how they're undone

Date: 2026-11-20. Task: `folder-handler` (survey-2 task 30). Scope set by the lead on 2026-11-20: every Linux desktop through the standards only, Windows opt-in, both fully reversible. The user-facing account, desktop by desktop, is `docs/INTEGRATION.md`.

## Principles
- Off by default. Installing changes nothing, and turning a setting off puts back what was there.
- Only the user's own files and keys. Nothing system-wide, so nothing can race another package.
- Each file glasshouse writes carries a marker (`X-Glasshouse-Integration=folders`, `# Written by glasshouse`). Turning off removes only marked files, and a same-named file without the marker is reported, never replaced.
- Both settings point at the running program (`self_exe`), so an AppImage works. Preferences warns when a setting starts another copy.
- The same switches are on the command line (`--integration-on folders file-manager`, `--integration-off`), for the MSI's uninstall, CI and whoever sets a machine up.

## Linux: Open folders with glasshouse
- **A hidden entry of its own,** `$XDG_DATA_HOME/applications/glasshouse-folders.desktop`: `MimeType=inode/directory;`, `NoDisplay=true`, `Exec=<program> %U`, and `TryExec=<program>`, so GLib and KDE skip it once the program is gone and folders fall to the next app.
- **The default** goes in `$XDG_CONFIG_HOME/mimeapps.list` and in each `$XDG_CONFIG_HOME/<desktop>-mimeapps.list` that already names a folder app. By the mime-apps spec those win over `mimeapps.list`, so leaving them would leave the setting without effect. A desktop list that names no folder app isn't created or touched.
- **The undo record.** What each list had (its old value, whether the file or the `[Default Applications]` group was created) is kept in `<app config>/integration.json`. Turning off writes the old value back, but only where the line is still ours: a choice the user made since stays. A list we created and that's now empty is removed. A symlinked list is written through the link. With no record (a lost state file), turning off still takes our value out.
- **`Exec` is bare when the path allows it.** xdg-open's generic mode (sway, Hyprland, niri…) reads the first word of `Exec` without unquoting. A quoted path made it skip the entry and fall through to run-mailcap and browsers. The end-to-end run found this. Paths with characters the spec reserves are still quoted, which every other launcher handles.
- **mimeinfo.cache.** GLib lists an entry in Open With from its folder's `mimeinfo.cache`; the default in mimeapps.list works without one. If the user's `applications/` folder has a cache, it's rebuilt (`update-desktop-database`) after the entry is written and after it's removed, so the cache never names a missing entry. If it has none, none is made.

## Linux: Show files for other apps (FileManager1)
- **A user service file,** `$XDG_DATA_HOME/dbus-1/services/org.freedesktop.FileManager1.service`, with `Exec='<program>' --dbus file-manager`. The bus splits `Exec` like a shell, so the path is single-quoted. A user file beats the system's in `/usr/share`. The end-to-end run checked this against caja's file: D-Bus activation started glasshouse.
- **No fight over a running owner.** The resident asks for the name with `ReplaceExisting | DoNotQueue`. It replaces only an owner that allowed replacement, and it never waits in the queue. Nautilus, Dolphin, Thunar, Nemo or caja keep the name while they run, and Preferences says which program holds it (its pid's `/proc/<pid>/exe`). A queued request would take the name when that program exits, but it would also leave a process waiting for the whole session without the user knowing why.
- **Turning on** writes the file, asks the bus to `ReloadConfig`, and starts the resident if no glasshouse owns the name, so Preferences can say at once who answers. **Turning off** removes the file, reloads, and calls `Release` on our resident.
- **Reveal in File Manager doesn't loop back.** When glasshouse would answer the FileManager1 call itself (it owns the name, or nobody does and our file would be activated, or the fallback would open a folder with our entry), the backend answers `inApp`. The window then selects the item in place instead of opening a second glasshouse.

## Packaging
- **No FileManager1 service file in `/usr/share`.** With two system service files for one name, which one the bus starts isn't defined (the D-Bus spec leaves it open), so a system file would race caja's or Nautilus's. The user-level file the setting writes always wins and is the only one.
- **No `MimeType` in the menu entry the .deb and the AppImage install** (`src-tauri/linux/glasshouse.desktop`). With no folder default in any mimeapps.list, GLib, xdg-mime and KDE pick the first app whose entry takes `inode/directory`. On a compositor without a desktop (sway, Hyprland, niri) and with Nautilus, Thunar, Nemo or PCManFM installed, glasshouse could come first and become the folder handler just by being installed. GNOME, KDE and XFCE ship desktop defaults; the tiling setups don't. **Cost:** while the setting is off, other apps' Open With lists don't offer glasshouse for folders. Preferences says so next to the setting. The entry keeps `Exec=glasshouse %U` (files dropped on a launcher icon open) and `StartupNotify=true`.

## Windows: Open folders with glasshouse
- **HKCU only:** `Software\Classes\Directory\shell` and `…\Drive\shell` get a `glasshouse` verb (`"<exe>" "%1"`, an icon, "Open in glasshouse") and it becomes their default verb, as the Files app and Directory Opus do. HKCU wins over HKLM in the merged `HKEY_CLASSES_ROOT`.
- **The undo record is in the registry:** the default verb it replaced is a value on our verb key, `GlasshousePreviousDefault`. Turning on twice keeps the first one. Turning off writes it back (or deletes the default) only while the default is still ours. Then it removes our verb, and the shell and class keys if nothing else is left in them. Keeping the record there lets the uninstallers undo it without the app's files.
- **Uninstallers:** the NSIS uninstaller does the same in its own script (`src-tauri/windows/hooks.nsh`, `NSIS_HOOK_POSTUNINSTALL`, so a cancelled uninstall changes nothing). The MSI runs `glasshouse.exe --integration-off` as an immediate custom action before `RemoveFiles` (`src-tauri/windows/integration.wxs`), so it runs as the user and reaches their HKCU. Both skip updates (`/UPDATE`, `UPGRADINGPRODUCTCODE`), which keep the setting. The uninstaller cleans up for the user who runs it.
- **Can't be redirected, and Preferences says so:** Explorer's own "Show in folder" (`SHOpenFolderAndSelectItems`, used by browsers and most apps for downloads), Win+E, and virtual folders (This PC, the Recycle Bin, Control Panel), which aren't Directory or Drive.
- **Testing:** the key plans (`on_ops`, `off_ops`) are pure and unit-tested on every platform, and the `reg` module type-checks with clippy for `x86_64-pc-windows-msvc` through a scratch crate. CI's `installers` job (windows-latest) builds both installers and runs `scripts/installers-check.ps1`: install, set a stand-in default, `--integration-on folders`, uninstall, check that the stand-in is back and our keys are gone. It's the first real run of the registry code and of both hooks.

## Rejected
- **Writing `inode/directory` in `~/.config/mimeapps.list` only:** a `<desktop>-mimeapps.list` that names a folder app would silently win.
- **`xdg-mime default`:** it writes only `mimeapps.list`, keeps no record of the old value, and isn't installed everywhere.
- **Restoring Windows defaults from `integration.json`:** the uninstallers couldn't read it.
