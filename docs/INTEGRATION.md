# glasshouse as your file manager

Other apps can hand folders to glasshouse: a browser's "Show in folder", an editor's "Open containing folder", a folder opened from a launcher or a terminal. On Linux, glasshouse can also be the open and save dialog other apps show. Installing glasshouse changes none of that. You turn it on in **Edit → Preferences → Integration**, and turning it off puts back what was there before.

- **Open folders with glasshouse:** folders that other apps open (by type, the way they open any file) open in glasshouse.
- **Show files for other apps** (Linux): "Show in folder" and similar commands open glasshouse with the item selected.
- **Use glasshouse for open and save dialogs** (Linux): one switch, and every app it can reach shows glasshouse for Open, Save As, attach and upload. See [Open and save dialogs](#open-and-save-dialogs).

The same settings from a terminal:

```sh
glasshouse --integration-on folders file-manager dialogs   # any of them
glasshouse --integration-off dialogs                       # just those
glasshouse --integration-off                               # everything off
```

## The command line

```sh
glasshouse [--select | --properties] [--] PATH|URI…
```

- A folder opens in a tab. A file opens its folder with the file selected. Items in one folder share a tab.
- `--select` selects every item in its folder, folders too. `--properties` does that, then shows Properties for the first item.
- `file://` URIs work (a desktop entry's `%U`), and relative paths are taken from the current folder.
- With glasshouse already running, the window opens in the running app, and the command exits once it's open (a plain `glasshouse` opens a new window there too). If the running app doesn't answer within 1.5 s, or there's no session bus (Linux), the command opens a window of its own instead.
- Started this way with no glasshouse running, it doesn't restore or save your tabs, so your next plain start opens the tabs you left. If you then start glasshouse plainly, your saved windows open next to it.
- Anything that can't be opened (a missing file, a non-local URI) is listed in a notice, and the rest opens.

## Linux

Everything here follows the freedesktop.org standards, so it works the same on X11 and Wayland and on any desktop or compositor. glasshouse only writes files in your own folders, never system ones.

### Open folders with glasshouse

Turning it on:
- writes a hidden menu entry, `~/.local/share/applications/glasshouse-folders.desktop`, that opens folders with glasshouse (`TryExec` points at glasshouse, so if glasshouse is removed the entry is skipped and folders open with the next app);
- makes it the `inode/directory` default in `~/.config/mimeapps.list`;
- also sets it in any `~/.config/<desktop>-mimeapps.list` that names a folder app, such as `gnome-mimeapps.list` for `XDG_CURRENT_DESKTOP=GNOME`. Those files win over `mimeapps.list`, so without this they'd keep their app;
- if `~/.local/share/applications/mimeinfo.cache` exists, rebuilds it with `update-desktop-database`, so the entry shows up in Open With lists. glasshouse never creates that file.

What each list had before is kept in `~/.config/io.github.johnson-anthony.glasshouse/integration.json`. Turning it off puts each list's old line back, removes the lines and files it added, and removes the hidden entry. A folder app you chose after turning it on is left alone.

Preferences shows which app opens folders now and which file sets it, and warns when a setting glasshouse didn't write wins over its own.

The menu entry that the .deb and the AppImage install has no file types, so installing never changes who opens folders. As a result, other apps' Open With lists offer glasshouse for folders only while this setting is on.

### Show files for other apps

Apps ask the session's D-Bus for `org.freedesktop.FileManager1` (its `ShowItems`, `ShowFolders` and `ShowItemProperties` methods) to show a file in a file manager. Firefox, Chromium-based browsers, Electron apps such as VS Code, and KDE and GNOME apps do this. Sandboxed apps (Flatpak, Snap) ask xdg-desktop-portal, which passes the request on to this service or the folder default.

Turning it on:
- writes `~/.local/share/dbus-1/services/org.freedesktop.FileManager1.service`, which the bus prefers to the system's files in `/usr/share`;
- asks the bus to reload, and starts glasshouse's background process (`glasshouse --dbus file-manager`, no window) if no other file manager has the name.

The background process stays running and opens a window for each request: in the glasshouse that's running, if one is, and otherwise in a new one. It passes on the requesting app's startup ID, so the new window is allowed to take focus: as an xdg-activation token on Wayland, or a startup-notification ID on X11.

**A file manager that's already running keeps the name.** glasshouse doesn't take the name from a running file manager that hasn't offered it. Preferences then says which program holds it. glasshouse answers once that program isn't running: quit it, or log out and back in.

Turning it off removes the service file and makes glasshouse's background process give the name up. The next request starts your previous file manager again, as before.

### Open and save dialogs

**One switch.** Turn on "Use glasshouse for open and save dialogs" and glasshouse's window becomes the open and save dialog of every app it can reach. You don't set anything up per app or per browser. Turning it off undoes all of it.

- **Apps that ask xdg-desktop-portal for their dialogs switch at once,** with their next dialog, even while they're running. These are Flatpak and Snap apps, Chromium, Chrome and Electron apps (VS Code, Discord, Slack and the like), GTK 4.18 and later, and recent Firefox-based browsers (LibreWolf 157 did, with no settings).
- **The rest switch at your next login.** These are GTK 3 apps, GTK 4.10 to 4.16, older Firefox releases (Firefox ESR 140 needed it) and Qt apps. Apps already running keep their old dialog until they're restarted.
- Turning it on or off restarts xdg-desktop-portal, which ends a screen share in progress.

Preferences shows which dialog apps get now, and warns when something else wins over glasshouse's setting.

**The dialog.** It's glasshouse's own file pane, sidebar, breadcrumbs, filter and hidden-files toggle, with a bottom bar: the name field (Save), the app's file types, the app's extra options (an encoding, "open read-only" and so on), Cancel and the app's own button label. Enter and double-click accept, Esc cancels, and a path typed in the name field (`~/Documents/notes.txt`, `../`) goes there. Choosing another file type swaps the name's extension. Saving over a file asks first. The dialog starts where the app asks, or else in the folder you last picked for that app. It's parented to the app's window (X11, and Wayland compositors with xdg-foreign), so it stays on top of it.

**What turning it on does.** Everything is in your own folders, and what was there before is kept in `~/.config/io.github.johnson-anthony.glasshouse/dialogs.json`:
1. writes `~/.local/share/dbus-1/services/org.freedesktop.impl.portal.desktop.glasshouse.service`, which starts glasshouse's background process for the portal (`glasshouse --dbus file-chooser`, no window; each dialog is its own short-lived window process);
2. writes `~/.local/share/xdg-desktop-portal/portals/glasshouse.portal`, which tells the portal glasshouse can show file dialogs (portal 1.20.1 and later; see [Older portals](#older-portals));
3. names glasshouse first for `org.freedesktop.impl.portal.FileChooser` in the portals.conf the portal reads, and keeps the desktop's other choices: it edits your own `~/.config/xdg-desktop-portal/…portals.conf` in place, or otherwise writes a copy of the desktop's file there with the one line added. On portal 1.19 and later the line is `glasshouse;` followed by what it was, so the desktop's dialog is still the fallback;
4. writes the toolkit settings below to `~/.config/environment.d/60-glasshouse-dialogs.conf`, which systemd reads at login. It also sets them in the session's service manager (`systemctl --user set-environment`), for the apps it starts from now on;
5. restarts xdg-desktop-portal, which reads its settings only when it starts.

Turning it off removes each file, puts your own portals.conf line back the way it was, unsets the variables and restarts the portal.

**The toolkit settings** are shown under Advanced, each with its own checkbox (all on by default). This table is for reference:

| Apps | How they reach the portal | What the switch sets |
|---|---|---|
| Flatpak and Snap apps | Always | Nothing |
| Chromium, Chrome, Electron apps | On their own | Nothing |
| GTK 4.18 and later | On their own when the portal is running | Nothing |
| GTK 4.10 to 4.16 | Only with `GDK_DEBUG=portals` | `GDK_DEBUG=portals`, added to any `GDK_DEBUG` value you have |
| GTK 3, GTK 4.6 and 4.8 | Only with `GTK_USE_PORTAL=1` | `GTK_USE_PORTAL=1` |
| Firefox, Thunderbird, LibreWolf and other forks | In their default "auto" mode, with `GTK_USE_PORTAL=1`; recent releases on their own | `GTK_USE_PORTAL=1` |
| Qt 5 and 6 apps | With the `xdgdesktopportal` platform theme, which also changes their look | `QT_QPA_PLATFORMTHEME=xdgdesktopportal` (needs `qt6-xdgdesktopportal-platformtheme`, or the Qt 5 one, on Debian and Ubuntu; Preferences says when it's missing) |
| Qt apps on KDE Plasma | Plasma's own theme, with `PLASMA_INTEGRATION_USE_PORTAL=1` | That, instead of the platform theme, so the look stays |

Firefox's `widget.use-xdg-desktop-portal.file-picker` pref set to `1` makes it ask the portal whatever the environment. glasshouse doesn't edit browser profiles.

**What it can't reach:**
- apps that draw their own dialog: Java (Swing and JavaFX), Tk, Wine and Windows programs, Blender, and most games and terminal apps;
- GTK and Qt apps whose own settings force their built-in dialog;
- Windows. Other apps' dialogs there are Windows' own, and replacing them would mean loading code into every app, which glasshouse doesn't do.

#### Older portals

The switch needs xdg-desktop-portal 1.17 or later (Debian 13, Ubuntu 24.04, Fedora 39 and later). Debian 12 (1.16) and Ubuntu 22.04 (1.14) are older: there the setting says so and stays off.

Portals before 1.20.1 read `glasshouse.portal` only from their own folder, `/usr/share/xdg-desktop-portal/portals`. The .deb installs it there, with the system copy of the service file. For the AppImage, Preferences shows the one command that writes it (`sudo tee`, run once). Neither file does anything until the switch names glasshouse in a portals.conf. If you ran that command, remove the file it wrote (`sudo rm /usr/share/xdg-desktop-portal/portals/glasshouse.portal`) when you remove glasshouse.

Portals 1.17 and 1.18 don't keep the list's order, so there the line names glasshouse alone, and the desktop's dialog isn't the fallback while it's on.

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

The open and save dialogs work on every desktop that runs xdg-desktop-portal (all of the above). The switch keeps each desktop's own portal backends for everything other than file dialogs, and its dialog as the fallback: GNOME's, KDE's, xdg-desktop-portal-gtk on the rest.

### AppImage

The settings point at the AppImage file itself. If you move or rename it, turn the settings off and on again (Preferences warns when folders or dialogs go to another copy of glasshouse).

### Uninstalling

Turn the settings off first, or run `glasshouse --integration-off`. A package manager can't remove files from your home folder. If glasshouse is already gone, nothing breaks:
- the hidden entry's `TryExec` makes it skipped, and apps whose FileManager1 request fails open the folder instead;
- the dialogs' service file cleans up after itself. The next time the portal tries to start glasshouse (at the latest, at your next login), it finds glasshouse gone. It then removes `glasshouse.portal`, the environment.d file, its copy of portals.conf and itself, and restarts the portal, which goes back to the desktop's dialog. A portals.conf of your own keeps the `glasshouse;` entry, which the portal skips.

To clean up by hand, remove the files named above and the `inode/directory=glasshouse-folders.desktop` line in `~/.config/mimeapps.list`.

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

Opening in the running app (2026-11-21, Linux, under Xvfb on a private bus): a second plain launch and a launch with paths each opened their window in the running app and exited in about 70 ms, and the startup ID reached the new window; `ShowItems` through the background process did the same, and started a window process when no glasshouse was running. A stopped (hung) app held a launch up for about 1.7 s, then it opened its own window; with no session bus, glasshouse ran on its own. The Wayland focus and Windows (a named pipe) are hand checks in `docs/testing/`.

The open and save dialogs were tested the same way, with a private xdg-desktop-portal 1.20.3 (and xdg-desktop-portal-gtk as the desktop's dialog), on Debian 13:
- the portal's `OpenFile`, `SaveFile` and `SaveFiles` with every option: several files, folders, file types and the current one, extra options, a suggested name, folder and file, an existing file (the replace prompt), Cancel, Esc, and the app closing its request (the dialog's process is gone);
- real apps, each asking the portal and getting glasshouse's dialog with its file back: a GTK 3 app (with `GTK_USE_PORTAL=1`), a GTK 4.18 app (no setting), zenity, a Qt 6 app (with the platform theme; without it, Qt's own dialog), Chromium 151 (no setting), LibreWolf 157 (a new profile, no setting) and Firefox ESR 140 (with `GTK_USE_PORTAL=1`; without it, its own GTK dialog);
- a running GTK 4 app whose first dialog was the desktop's and whose next one, after the switch was turned on, was glasshouse's;
- parenting: on X11 (Xvfb) as a transient window of the app's, and on Wayland (a nested niri 26.04) through xdg-foreign, floated over the app;
- turning the switch on and off, each file written and removed, and the portal restarted; and the clean-up when glasshouse is gone: with the binary deleted, the portal's next start ran the service file, which removed glasshouse's files. Its restart of the portal through systemd wasn't run, because the private bus has no service manager.

The time from the app's request to the dialog's first paint, with a debug build, was 400 to 500 ms under Xvfb and 1.6 to 2.5 s in the nested niri. KDE's, GNOME's and the other desktops' backends, and real logins (environment.d), haven't been run.
