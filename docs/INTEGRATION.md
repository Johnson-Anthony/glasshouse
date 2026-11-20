# glasshouse as your file manager

Other apps can hand folders to glasshouse: a browser's "Show in folder", an editor's "Open containing folder", a folder opened from a launcher or a terminal. Installing glasshouse changes none of that. You turn it on in **Edit → Preferences → Integration**, and turning it off puts back what was there before.

- **Open folders with glasshouse:** folders that other apps open (by type, the way they open any file) open in glasshouse.
- **Show files for other apps** (Linux): "Show in folder" and similar commands open glasshouse with the item selected.

The same settings from a terminal (Linux and Windows):

```sh
glasshouse --integration-on folders file-manager   # either or both
glasshouse --integration-off                       # everything off
```

## The command line

```sh
glasshouse [--select | --properties] [--] PATH|URI…
```

- A folder opens in a tab. A file opens its folder with the file selected. Items in one folder share a tab.
- `--select` selects every item in its folder, folders too. `--properties` does that, then shows Properties for the first item.
- `file://` URIs work (a desktop entry's `%U`), and relative paths are taken from the current folder.
- A window opened this way doesn't restore or save your tabs, so your next plain start opens the tabs you left.
- Anything that can't be opened (a missing file, a non-local URI) is listed in a notice, and the rest opens.

## Linux

Everything here follows the freedesktop.org standards, so it works the same on X11 and Wayland and on any desktop or compositor. glasshouse only writes files in your own folders, never system ones.

### Open folders with glasshouse

Turning it on:
- writes a hidden menu entry, `~/.local/share/applications/glasshouse-folders.desktop`, that opens folders with glasshouse (`TryExec` points at glasshouse, so if glasshouse is removed the entry is skipped and folders open with the next app);
- makes it the `inode/directory` default in `~/.config/mimeapps.list`;
- also sets it in any `~/.config/<desktop>-mimeapps.list` that names a folder app, such as `gnome-mimeapps.list` for `XDG_CURRENT_DESKTOP=GNOME`. Those files win over `mimeapps.list`, so without this they'd keep their app;
- if `~/.local/share/applications/mimeinfo.cache` exists, rebuilds it with `update-desktop-database`, so the entry shows up in Open With lists. glasshouse never creates that file.

What each list had before is kept in `~/.config/sh.glasshouse.viles/integration.json`. Turning it off puts each list's old line back, removes the lines and files it added, and removes the hidden entry. A folder app you chose after turning it on is left alone.

Preferences shows which app opens folders now and which file sets it, and warns when a setting glasshouse didn't write wins over its own.

The menu entry that the .deb and the AppImage install has no file types, so installing never changes who opens folders. As a result, other apps' Open With lists offer glasshouse for folders only while this setting is on.

### Show files for other apps

Apps ask the session's D-Bus for `org.freedesktop.FileManager1` (its `ShowItems`, `ShowFolders` and `ShowItemProperties` methods) to show a file in a file manager. Firefox, Chromium-based browsers, Electron apps such as VS Code, and KDE and GNOME apps do this. Sandboxed apps (Flatpak, Snap) ask xdg-desktop-portal, which passes the request on to this service or the folder default.

Turning it on:
- writes `~/.local/share/dbus-1/services/org.freedesktop.FileManager1.service`, which the bus prefers to the system's files in `/usr/share`;
- asks the bus to reload, and starts glasshouse's background process (`glasshouse --dbus file-manager`, no window) if no other file manager has the name.

The background process stays running and opens a window for each request. It passes on the requesting app's startup ID, so the new window is allowed to take focus: as an xdg-activation token on Wayland, or a startup-notification ID on X11.

**A file manager that's already running keeps the name.** glasshouse doesn't take the name from a running file manager that hasn't offered it. Preferences then says which program holds it. glasshouse answers once that program isn't running: quit it, or log out and back in.

Turning it off removes the service file and makes glasshouse's background process give the name up. The next request starts your previous file manager again, as before.

### Per desktop

| Desktop | Opening folders (xdg-open and other apps) | "Show in folder" |
|---|---|---|
| GNOME | `gio open`: follows the setting. GNOME's own defaults are system files, which `~/.config/mimeapps.list` beats. | Nautilus holds the name while it runs. glasshouse answers once Nautilus has exited, or after logging out and in. |
| KDE Plasma | `kde-open`: follows the setting. | Dolphin holds the name while it runs. |
| Cinnamon | `gio open`: follows the setting. | Nemo holds the name while it runs. |
| MATE | `gio open`: follows the setting. | Caja usually runs the whole session to draw the desktop, so it keeps the name. glasshouse answers only if Caja isn't drawing the desktop. |
| XFCE | xdg-open runs `exo-open`, which can use Xfce's own preferred file manager for folders (Settings → Default Applications → Utilities); set glasshouse there too. Apps that open folders through GIO follow the setting. | Thunar holds the name if it runs as a daemon. |
| LXDE | xdg-open runs PCManFM itself for folders. Apps that open folders through GIO follow the setting. | PCManFM holds the name while it runs. |
| LXQt | `qtxdg-mat`: follows the setting. | PCManFM-Qt holds the name while it runs. |
| sway, Hyprland, niri, river and other compositors without a desktop | xdg-open's generic mode: follows the setting. | Usually no file manager is running, so glasshouse answers. |

xdg-open's generic mode reads the first word of the menu entry's `Exec` line as is, so it can't start a program whose path needs quoting (spaces, quotes, `$`…). glasshouse writes the path bare when it can, so keep the binary or AppImage at such a path for that mode.

### AppImage

The settings point at the AppImage file itself. If you move or rename it, turn the settings off and on again (Preferences warns when folders open with another copy of glasshouse).

### Uninstalling

Turn both settings off first, or run `glasshouse --integration-off`. A package manager can't remove files from your home folder. If glasshouse is already gone, nothing breaks: the hidden entry's `TryExec` makes it skipped, and apps whose FileManager1 request fails open the folder instead. To clean up by hand, remove the two files named above and the `inode/directory=glasshouse-folders.desktop` line in `~/.config/mimeapps.list`.

## Windows

**Open folders with glasshouse** adds an "Open in glasshouse" command to folders and drives under `HKEY_CURRENT_USER\Software\Classes\Directory\shell` and `…\Drive\shell` (`"glasshouse.exe" "%1"`), and makes it their default, as the Files app and Directory Opus do. Folders double-clicked in Explorer, and folders other apps open, then open in glasshouse. The default it replaced is kept beside it (`GlasshousePreviousDefault`) and put back when it's turned off.

Windows doesn't let another app take over:
- Explorer's own "Show in folder" (`SHOpenFolderAndSelectItems`), which browsers and most apps use to show a download;
- Win+E;
- This PC, the Recycle Bin, Control Panel and other virtual folders.

Those keep opening Explorer.

Uninstalling turns the setting off: the setup.exe uninstaller in its own script, the .msi by running `glasshouse.exe --integration-off`. An update keeps it on. The uninstaller cleans up for the user who runs it; other users who turned it on should turn it off first.

## What was tested

On Linux, on a private D-Bus with scratch home and XDG folders (never a real session): the X11 path under Xvfb, and the Wayland path in a nested niri. On both, turning the settings on, `ShowItems` with the item selected, the startup ID reaching the window, `xdg-open` in generic mode and through `gio open`, and turning them off. The other desktops in the table follow from the standards and from what each one's `xdg-open` runs; they haven't been run. The Windows registry code is unit-tested and type-checked; CI's `installers` job installs, turns the setting on, uninstalls and checks the registry on a Windows runner.
