# release-identity: the new identifier and moving the old data

Date: 2026-11-20. Task: `release-identity` (survey-3 task 35). Owner decision D3: change the identifier now, while the owner is the only user, with a migration.

## The identifier
D3 picked `io.github.johnson_anthony.glasshouse`: the project page's domain (`johnson-anthony.github.io`) reversed, with `_` for the hyphen because D-Bus interface names can't contain `-`. The Tauri CLI (2.12.4) refuses it: every `tauri build` and `tauri dev` stops with "The bundle identifier string must contain only alphanumeric characters (A-Z, a-z, and 0-9), hyphens (-), and periods (.)". There's no setting to turn the check off.

So the Tauri identifier is `io.github.johnson-anthony.glasshouse`, and the D-Bus form `io.github.johnson_anthony.glasshouse` is used only for the resident's interface and object path. `2026-11-20-release-identity-id-form.md` has why, where each form is used, and what a Flatpak would need.

## What moves
`migrate.rs` runs first in every mode: window, file chooser, resident, and `--integration-on/off`. The CLI needs it because `--integration-off` reads `integration.json`. If it ran before any window had started, it would otherwise find no record, so it couldn't put the old folder default back.

For each folder Tauri names after the identifier, `<base>/sh.glasshouse.viles` is renamed to `<base>/<APP_ID>` when that's missing. The bases are the `dirs` crate's config, data, local data and cache folders, which are the same ones Tauri uses, each counted once:
- **Linux:** `~/.config` (pins, tags, recents, `.window-state.json`, `session.lock`, `integration.json`, `dialogs.json`), `~/.local/share` (WebKitGTK's data: `localstorage/` holds the settings and tabs) and `~/.cache`.
- **Windows:** `%APPDATA%` (the config files) and `%LOCALAPPDATA%` (`EBWebView`, WebView2's profile).

The page origin (`tauri://localhost`, `http://tauri.localhost`) doesn't depend on the identifier, so localStorage reads back unchanged.

Then the saved remotes move from `~/.glasshouse/remotes.json` into the config folder (`read_remotes`/`write_remotes`, like pins), and `~/.glasshouse` is removed if it's then empty.

**Rules:**
- **Never merge.** Once the new folder exists, even empty, the old one is left alone. Merging two webview profiles or two pin lists has no right answer, and the new folder existing means this version has already run.
- **Rename first.** Siblings in one folder are almost always on one file system, so it's instant and atomic. If the rename fails (a mount point, or on Windows a file held open by an old glasshouse still running), it copies into `<new>.migrating-<pid>` and renames that into place, so a half copy never counts as done. The old folder is kept then. If the copy fails too, the partial copy is removed and the app starts fresh. Every outcome goes to stderr.
- **Two processes at once** (a window and the resident at login): the second one's rename finds the old folder gone, and that counts as done.

**Unit tests** (scratch folders): everything moves and a second start changes nothing; an existing new folder is never touched; nothing to move creates nothing; the copy fallback, and a copy that fails half-way; remotes moving once and not replacing newer ones.

## What doesn't change, and the residents
None of the integration files names the identifier. They all name the binary's path: the mimeapps lines, `glasshouse-folders.desktop`, both D-Bus service files and the self-clean-up script in the chooser's, `glasshouse.portal`, the portals.conf line and environment.d. So they keep working, and nothing needs turning off and on.

The one thing that does change is the resident's control interface. A resident started by a build from before the change answers only on `sh.glasshouse.viles.Resident1`. No release had a resident, but the owner's session runs one. Without help, Preferences would report it as "another program" holding FileManager1, and turning the switch off wouldn't release it. So `holder` and `release` know both interfaces: such a resident counts as glasshouse and gives its name up when asked. It ends at the next login anyway. The old interface can go once no pre-change build can still be running.

**Caveat:** an old glasshouse window still open during the switch keeps writing to the old paths (it recreates `~/.config/sh.glasshouse.viles` for its next save). Those few writes stay there, because the new folder exists by then. Close old windows before starting the new build.
