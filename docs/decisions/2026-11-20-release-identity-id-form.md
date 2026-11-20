# release-identity: two forms of the identifier

Date: 2026-11-20. Task: `release-identity` (survey-3 task 35). Chosen by the lead, for the owner (D3).

## The two forms
- **Tauri:** `io.github.johnson-anthony.glasshouse` (`APP_ID` in `lib.rs`, `identifier` in `tauri.conf.json`). It's the reversed project-page domain, `johnson-anthony.github.io`. The Tauri CLI accepts only letters, digits, `-` and `.`, and stops every build otherwise, so D3's `_` can't go here.
- **D-Bus:** `io.github.johnson_anthony.glasshouse`, used only where the D-Bus specification forbids `-`: the resident's control interface (`….Resident1`) and its object path (`/io/github/johnson_anthony/glasshouse/Resident`). For a reversed domain with a hyphen, the specification itself says to use `_`.

There's one constant per form: `APP_ID`, and `CONTROL_IFACE`/`CONTROL_PATH` in `resident.rs`. A test checks that the D-Bus names are `APP_ID` with `-` → `_`, and that the interface zbus serves is that name. `migrate.rs` checks that `APP_ID` matches `tauri.conf.json`.

Rejected: `io.github.johnsonanthony.glasshouse`, one form everywhere but the reverse of a domain that isn't ours.

## Where the name shows up
Well-known bus names and desktop file names may contain `-`, so nothing else needs the D-Bus form. Most of these places use neither form: they use the product name.

| Where | Name | Form |
|---|---|---|
| Config, data and cache folders (`~/.config`, `~/.local/share`, `~/.cache`; `%APPDATA%`, `%LOCALAPPDATA%`), and the WebKitGTK and WebView2 data inside them | `io.github.johnson-anthony.glasshouse` | Tauri |
| `integration.json` and `dialogs.json` (in the config folder; they store only paths outside it) | in that folder | Tauri |
| NSIS "Delete application data" (`$APPDATA\${BUNDLEID}`, `$LOCALAPPDATA\${BUNDLEID}`) | the bundle ID | Tauri |
| The resident's control interface and object path | `io.github.johnson_anthony.glasshouse.Resident1`, `/io/github/johnson_anthony/glasshouse/Resident` | D-Bus |
| Window app id: Wayland `app_id`, X11 `WM_CLASS` | `glasshouse` | product. Tauri's `enableGTKAppId` is off, so the GtkApplication has no id and GTK uses the program name. Checked under Xvfb: `WM_CLASS` "glasshouse", "Glasshouse", no `_GTK_APPLICATION_ID`, and no bus name of ours. |
| Menu entry (`.deb`, AppImage) | `glasshouse.desktop`, `StartupWMClass=glasshouse`, `Icon=glasshouse` | product; it matches the window's app id |
| The folder default's entry | `glasshouse-folders.desktop` | product |
| The portal backend | bus name `org.freedesktop.impl.portal.desktop.glasshouse`, `glasshouse.portal`, its `.service` file, `FileChooser=glasshouse` in portals.conf | product, following xdg-desktop-portal's `org.freedesktop.impl.portal.desktop.<name>` convention |
| `org.freedesktop.FileManager1` (the resident's name and service file) | the freedesktop name | neither |
| environment.d `60-glasshouse-dialogs.conf`, and the "Written by glasshouse" comments in it and in portals.conf | `glasshouse` | product |
| Windows folder verbs | `HKCU\Software\Classes\{Directory,Drive}\shell\glasshouse` | product |
| The installers' registry key | `HKCU\Software\Anthony Johnson\glasshouse` | publisher and product |
| The MSI upgrade code | from `glasshouse.exe.app.x64`, pinned | product |
| e2e harness | none: it gives the app scratch XDG folders, and the app makes its own folder inside | — |
| `migrate.rs` | `OLD_APP_ID` = `sh.glasshouse.viles` | the old identifier |

Enabling `enableGTKAppId` was rejected: the window's app id would become the identifier, which no longer matches `glasshouse.desktop`. GLib would also make the app single-instance on the session bus. tao (0.37) then has a second `glasshouse` activate the first and exit, and the folder it was asked to open is lost.

## A future Flatpak
Flatpak app IDs follow D-Bus naming, so a Flatpak would likely be `io.github.johnson_anthony.glasshouse`, which differs from Tauri's. The two can differ:
- **Folders:** inside a Flatpak, `XDG_CONFIG_HOME` and the others point into `~/.var/app/<Flatpak ID>/`, and Tauri's folder is made inside those. Nothing clashes. A Flatpak starts with no data, since the migration can't reach the old folders from inside the sandbox.
- **Names:** Flatpak wants the desktop file, the icon and the AppStream metainfo named after its ID. Docks match a window to its desktop file by the Wayland app id, so the window's app id would have to be the Flatpak ID too, and today it's `glasshouse`. That needs a setting of our own (for example `g_set_prgname` from a build flag), not Tauri's `enableGTKAppId`, which uses the Tauri identifier.
- **D-Bus:** the resident's names and the portal backend's bus name would need the sandbox's permission to own them (`--own-name`), and a Flatpak can't export a host portal backend or a FileManager1 service file. So the integration features would largely not work in a Flatpak.
