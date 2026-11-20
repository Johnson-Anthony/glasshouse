# release-identity (task 35)

The app's identity and its release packaging, before anyone but the owner depends on them. Scope: survey-3.md §35 and the owner decisions D1 (no code signing) and D3 (new identifier now, data migrated, lowercase "glasshouse").

## Status
| Step | State |
|---|---|
| Plan | done |
| Identifier: Tauri forbids `_` (CLI 2.12.4 stops the build), asked the lead | asked; the hyphen form meanwhile |
| Migration of the old folders and `~/.glasshouse/remotes.json`, unit tests | done |
| Rename: tauri.conf.json, `APP_ID`, resident control interface (recognizes and releases an old resident) | done |
| Bundle metadata, publisher, pinned upgrade code, NSIS install mode | done |
| NSIS hooks: clear the install-folder key on uninstall; remove 0.2.0's key after install; installers-check | done (makensis compiles them; not run on Windows) |
| Linux: deb Recommends, section; desktop entry categories (already set by our template) | done |
| Release: Windows ARM64, SHA256SUMS, provenance attestation; CI arm64 backend leg | done (actionlint; not run) |
| Drop the fs, os and shell plugins (and opener's unused JS permission); notices | done |
| Remotes in the config folder (commands, frontend, demo mock) | done |
| Name: lowercase in About, the about alert, the two glasshouse theme names, README | done |
| Docs: INTEGRATION, ARCHITECTURE, SPEC, README (installers, checksums, data and uninstalling), decision records | done |
| AppImage update information and desktop integration | asked the lead to cut (48 has the updater; a menu entry is its own feature) |
| Checks | |

## The identifier
D3 picked `io.github.johnson_anthony.glasshouse`: the GitHub Pages domain reversed, `_` for the hyphen, because D-Bus interface names can't contain `-`. But `tauri build` refuses identifiers with anything but letters, digits, `-` and `.`, so the Tauri identifier can't have the `_`. Proposal sent to the lead (11-20):
- Tauri identifier (folders, bundle ID, WebView2 profile, NSIS data folders): `io.github.johnson-anthony.glasshouse`.
- D-Bus (the resident's control interface and object path): `io.github.johnson_anthony.glasshouse`, the D-Bus spec's own rule for a domain with a hyphen.
Both are constants in `lib.rs`, with a test that one is the other with `-` → `_`, and one that the first is tauri.conf.json's.

## Migration (`src-tauri/src/migrate.rs`)
Runs first thing in every mode (window, chooser, resident, `--integration-on/off`), because the CLI reads `integration.json` and `dialogs.json`: run before a window ever starts, `--integration-off` would otherwise find no record and leave the folder default on glasshouse.
- For each base folder Tauri uses (`dirs` config, data, local data and cache: on Linux `~/.config`, `~/.local/share`, `~/.cache`; on Windows `%APPDATA%` and `%LOCALAPPDATA%`), deduplicated: when `<base>/<old id>` exists and `<base>/<new id>` doesn't, rename it. That carries pins, tags, recents, window state, `session.lock`, `integration.json`, `dialogs.json`, and the webview's data (WebKitGTK's `localstorage/` on Linux, `EBWebView` on Windows: settings and tabs). The origin (`tauri://localhost`, `http://tauri.localhost`) doesn't change, so localStorage reads back.
- A rename that fails (another file system, a file held open on Windows): copy into `<new id>.migrating`, then rename that into place, so a half copy never counts as done; the old folder stays. If the copy fails too, remove the partial copy and start fresh (logged).
- Then `~/.glasshouse/remotes.json` moves to `<config>/remotes.json` (if that's missing), and `~/.glasshouse` goes if it's empty.
- Never merges: once the new folder exists, the old one is left alone.

The integration files themselves (mimeapps lines, `glasshouse-folders.desktop`, both D-Bus service files, `glasshouse.portal`, the portals.conf line, environment.d) name the binary's path, never the identifier, so they keep working. What does change is the resident's control interface: a resident started by the old binary answers only on the old one. The new app recognizes both (`holder`) and releases either, so turning a switch off still hands the name back, and Preferences doesn't call the old resident "another program". It goes away at the next login or the next off/on.

## Windows installers
- `publisher` "Anthony Johnson" (else Tauri takes "github" from the identifier). The manufacturer names `HKCU\Software\<manufacturer>\glasshouse`, where NSIS keeps its install folder and the MSI its InstallDir and shortcut flags.
- The upgrade code is pinned to what Tauri derives from the product name today (`tauri inspect wix-upgrade-code`), so 0.2.0 MSIs upgrade in place, and a rename later can't make a second install. ARM64 MSIs get the same code: one product, whichever architecture.
- NSIS `installMode` "currentUser", set explicitly (it's the default).
- NSIS post-uninstall hook (not on update): delete the install-folder value and the key if empty, so the MSI doesn't install into `%LOCALAPPDATA%` after the setup.exe was removed.
- NSIS post-install hook: remove 0.2.0's `HKCU\Software\glasshouse\glasshouse` install-folder value. The new installer reads the previous folder from the new manufacturer's key, so the old one would stay forever.
- installers-check.ps1 checks both, instead of removing the key itself.

## Release
- Windows ARM64 on `windows-11-arm` (native, so no `--target`): `glasshouse_<v>_arm64-setup.exe` and `glasshouse_<v>_arm64_en-US.msi`. CI's backend job gets a `windows-11-arm` leg (clippy and tests), so the release isn't the first arm64 compile.
- The publish job downloads every expected file from the draft, writes `SHA256SUMS`, uploads it, and attests it with `actions/attest-build-provenance@v4` (`subject-checksums`). Then it publishes.

## Not done here
- AppImage update information and desktop integration: see the report to the lead (task 48's updater covers AppImage updates; a menu entry for the AppImage is a feature of its own).
- Code signing (D1).
