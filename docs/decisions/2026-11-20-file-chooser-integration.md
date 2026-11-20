# file-chooser: one switch for every app's dialogs

Date: 2026-11-20. Task: `file-chooser` (survey-2 task 31). Directed by the lead on 2026-11-20, relaying the owner: no per-app steps ("we shouldnt be playing wackamole with each menu on each browser"), one switch that reaches every app it can, fully undone when off.

## What decides which dialog an app shows
- **Whether the app asks the portal.** Flatpak and Snap apps always do. Chromium, Chrome and Electron apps do on Linux, and so do GTK 4.18 and later when the portal is running. GTK 3 and GTK 4.6–4.8 ask only with `GTK_USE_PORTAL=1`, GTK 4.10–4.16 only with `GDK_DEBUG=portals`, and Qt only with the `xdgdesktopportal` platform theme (on Plasma, KDE's theme with `PLASMA_INTEGRATION_USE_PORTAL=1`). Firefox's default "auto" mode follows `GTK_USE_PORTAL`.
- **Which backend the portal picks** (read from xdg-desktop-portal's source, 1.16–1.20.3):
  - portals.conf: the first file found with keys in `[preferred]`, no merging. The search goes `$XDG_CONFIG_HOME`, `$XDG_CONFIG_DIRS`, `/etc`, `$XDG_DATA_HOME`, `$XDG_DATA_DIRS`, `/usr/share`, and in each dir `<desktop>-portals.conf` per desktop, then `portals.conf`;
  - the interface's own key, then `default`, then a backend whose `UseIn` names the desktop, then gtk. 1.19+ tries the list in order and skips missing backends. 1.17–1.18 take the first backend in file-name order that the list names. 1.16 reads no config;
  - `.portal` files come from `$XDG_DATA_HOME` and `$XDG_DATA_DIRS` only from 1.20.1; before that, only from the portal's own datadir;
  - both are read once, when the portal starts.

## Chosen
**One switch,** "Use glasshouse for open and save dialogs" (Preferences → Integration, `--integration-on dialogs`), off by default. On (`integration.rs` `dialogs_on`, the text work in `integration_portal.rs`, all of it in the user's own folders):
1. **The service file** `~/.local/share/dbus-1/services/org.freedesktop.impl.portal.desktop.glasshouse.service`, which starts the running binary with `--dbus file-chooser`.
2. **`glasshouse.portal`** in `~/.local/share/xdg-desktop-portal/portals` on 1.20.1 and later. On older portals the switch uses the .deb's copy in the portal's datadir, or Preferences shows the one root command (`printf … | sudo tee …`). Below 1.17 the setting says the portal is too old.
3. **portals.conf.** The switch reads the running portal's own environment (`/proc/<pid>/environ`) to find the file it reads. It edits that file in place when it's the user's; otherwise it writes a copy of the desktop's file to `$XDG_CONFIG_HOME/xdg-desktop-portal/<desktop>-portals.conf`, which comes first in the search, with the FileChooser line added and everything else kept. The value is `glasshouse;<what it was>;` on 1.19+, so the desktop's dialog stays the fallback, and `glasshouse;` alone on 1.17–1.18, where order isn't kept and `cosmic` would sort first.
4. **The toolkit opt-ins** go in `~/.config/environment.d/60-glasshouse-dialogs.conf` (read at login). The same values are set in the systemd user manager (`SetEnvironment`) for the apps it starts from now on, with the earlier values kept to restore. Each opt-in has its own checkbox under Advanced, all on by default:
   - `GTK_USE_PORTAL=1` (GTK 3, GTK 4.6–4.8, Firefox's auto mode);
   - `GDK_DEBUG=portals`, appended to any value, and only when the system's GTK 4 is 4.10–4.16 (or unknown). 4.18+ asks on its own, so a session-wide debug flag isn't set for nothing;
   - `QT_QPA_PLATFORMTHEME=xdgdesktopportal` (it changes Qt apps' look, which the row says; Preferences warns when the Qt 6 plugin is missing), or `PLASMA_INTEGRATION_USE_PORTAL=1` on KDE.
5. **Restart the portal:** `RestartUnit` when systemd's `xdg-desktop-portal.service` MainPID owns the name; else SIGTERM the owner (after checking its exe is xdg-desktop-portal), then activate it again.

**Off** undoes each step from `dialogs.json`: the original portals.conf back when it's as we left it (else only our line out), our files removed, the variables unset or restored, the portal restarted, and the resident told to release the name.

**When glasshouse is gone** (uninstalled, an AppImage deleted) with the switch on, the portal would still pick it, and every app's dialog would fail. So the service file's `Exec` is a `/bin/sh -c` script. It execs glasshouse when it's there; otherwise it removes the `.portal`, the environment.d file, our portals.conf copy (first line ours) and itself, and restarts the portal through systemd. The restart happens only when it removed something, so it can't loop.

**The .deb ships two inert files:** `/usr/share/xdg-desktop-portal/portals/glasshouse.portal` (for portals before 1.20.1) and `/usr/share/dbus-1/services/org.freedesktop.impl.portal.desktop.glasshouse.service` (`/usr/bin/glasshouse --dbus file-chooser`). The service file is there for 1.17–1.18 with a `default=*` portals.conf: `*` matches any backend in file-name order, and glasshouse sorts before gnome and gtk, so a `.portal` the portal couldn't start would break every dialog even with the switch off. With the service file, the worst case is glasshouse's dialog. Neither file does anything otherwise, and the switch's user copy takes the system service file's place.

**Status** reads the same rules back (`chosen_backend`). It says which backend apps get now, warns when a setting glasshouse didn't write wins, when the portal started before our files changed (with two seconds' slack, since the start time comes from the boot time in whole seconds), and when the service file starts another copy of glasshouse.

## Checked on a private bus
LibreWolf 157 in a new profile with no portal prefs asked the portal without any variable. So the GTK dialog the owner saw was most likely xdg-desktop-portal-gtk's, which this switch replaces, and no policies.json or prefs file is needed. Firefox ESR 140 needed `GTK_USE_PORTAL=1`. Chromium 151 and GTK 4.18 needed nothing. A GTK 3 app needed `GTK_USE_PORTAL=1`, and a Qt 6 app needed the platform theme. A running GTK 4 app moved to glasshouse's dialog on its next dialog after the switch. GTK decides once per process whether the portal is there, so an app started during a portal restart can keep its own dialog until it's restarted.

## Risks not run
- systemd's restart from the clean-up script, and environment.d at a real login: the private bus has neither.
- `GDK_DEBUG=portals` on a GTK 4.10–4.16 system reaches every GTK 4 process in the session, portal backends included. It wasn't run on such a system (this one has 4.18).
- GNOME's, KDE's and the other desktops' backends: the edits follow the portal's rules, but only niri with xdg-desktop-portal-gtk was run.

## Rejected
- **Per-app setup** (browser prefs, policies.json, per-app wrappers): the owner asked for none, and it misses every app not listed.
- **Editing `default=` instead of the FileChooser key:** that would hand other interfaces to glasshouse.
- **System-wide changes** (`/etc/xdg-desktop-portal`, `/etc/environment`) from the app: glasshouse writes only the user's own files. The one root command for old portals is shown, not run.
- **Windows:** the common file dialog can be replaced only by injecting code into every process.
