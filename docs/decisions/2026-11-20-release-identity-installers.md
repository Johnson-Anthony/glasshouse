# release-identity: installers, packages and release assets

Date: 2026-11-20. Task: `release-identity` (survey-3 task 35). Owner decision D1: no code signing for now.

## Bundle metadata (`tauri.conf.json`)
- **`publisher`: "Anthony Johnson"** (the LICENSE holder). Left unset, Tauri takes the identifier's second part, which with the new identifier would be "github". It's the MSI's Manufacturer, the "Publisher" in Settings → Apps, the exe's CompanyName, and it names `HKCU\Software\<publisher>\glasshouse`.
- `copyright`, `homepage` (the project page), `category` "Utility", `shortDescription` and `longDescription`. The .deb's `Description` comes from the last two, and Settings → Apps links to the homepage.
- The Linux desktop entry is our own template (`linux/glasshouse.desktop`), which sets `Categories=System;FileTools;FileManager;`, so the empty `Categories=` the survey worried about can't happen. `category` only matters for other bundle types.
- **The .deb:** `Section: utils`, and `Recommends: git, 7zip | p7zip-full, xdg-utils`. Git status and the Git menu need `git`; `.7z` archives need a 7-Zip (`7zz` from `7zip`, or `7z` from `p7zip-full` on older releases); opening files falls back to `xdg-open`.
- **NSIS `installMode` "currentUser"**, written out though it's the default, because the README and the hooks rely on it.

## The MSI upgrade code
Pinned to `d5dc81dc-7659-5d8f-825d-74a5dc726d43`. That's what Tauri derives from the product name today (`tauri inspect wix-upgrade-code`: UUIDv5 of `glasshouse.exe.app.x64`), so 0.2.0 MSIs upgrade in place, and a later rename can't make a second install. Tauri derives it with `x64` whatever the architecture, so the arm64 MSI shares it: it's one product, and installing one architecture's MSI replaces the other's.

## What changes for installs of 0.2.0 (Windows)
- **MSI → MSI:** the same upgrade code, so it's a major upgrade. The old product is removed, along with its `HKCU\Software\glasshouse\glasshouse` values. The new one installs into `Program Files\glasshouse`, the default, which is where 0.2.0 installed unless the folder was changed by hand.
- **setup.exe → setup.exe:** the uninstall entry (`…\Uninstall\glasshouse`, named after the product) is found as before. But the old install folder is read from the new publisher's key, which doesn't exist yet. In silent and update mode that doesn't matter: the new version installs over the old one in the default `%LOCALAPPDATA%\glasshouse`. In the interactive installer, "uninstall before installing" runs the old uninstaller with an empty folder, and may say it couldn't uninstall it; choosing to install over it works. Unverified: nobody has run an upgrade from 0.2.0 on Windows (task 46, release-smoke, should). The release has a handful of downloads.
- 0.2.0's leftover install-folder value is removed by the new installer (below).

## The NSIS install-folder key
NSIS keeps its install folder as the default value of `HKCU\Software\<publisher>\glasshouse`, and clears it on uninstall only when "Delete application data" is ticked. Tauri's MSI reads that same value for its own INSTALLDIR (main.wxs, `PrevInstallDirNoName`). So after a setup.exe install was removed, a later MSI install, which is per machine, went into the old per-user folder in `%LOCALAPPDATA%` (seen in CI on 11-20). Chosen:
- **Uninstalling (not on an update) always forgets it**, in `hooks.nsh`'s post-uninstall hook. It removes that value and the "Installer Language" value, then the key and the publisher key if nothing else is in them. The MSI's own values in that key (InstallDir, the shortcut flags) stay, for an MSI installed alongside.
- **Installing removes 0.2.0's**, under `Software\glasshouse\glasshouse`, the same way.
- `scripts/installers-check.ps1` checks both. It plants a 0.2.0-style key before the NSIS round, checks it's gone after installing and that the new key names the install folder, then checks the new key is gone after uninstalling. Before this change, the script removed the key itself between the rounds.

## What each uninstaller leaves
| | setup.exe (NSIS) | .msi | .deb |
|---|---|---|---|
| The program | removed | removed | removed |
| Integration (folder verbs on Windows) | turned off (`hooks.nsh`) | turned off (`integration.wxs`) | the user turns it off; the files clean up after themselves when glasshouse is gone (docs/INTEGRATION.md) |
| `HKCU\Software\Anthony Johnson\glasshouse` | removed (above) | removed (its components) | n/a |
| Config and data folders (`%APPDATA%`, `%LOCALAPPDATA%`, `~/.config`, `~/.local/share` `<identifier>`) | kept, unless "Delete application data" is ticked | kept | kept |

The README's "Your data, and uninstalling" says the same, for users.

## Release assets
- **Windows arm64** builds natively on `windows-11-arm` (free for public repos). An x64 build would run there only under emulation. The files are `glasshouse_<v>_arm64-setup.exe` and `glasshouse_<v>_arm64_en-US.msi`. CI's backend job gets a `windows-11-arm` leg (clippy and tests), so the first arm64 compile isn't a release.
- **`SHA256SUMS` and provenance:** the publish job downloads each of the eight expected files from the draft and writes `SHA256SUMS` from them. `actions/attest-build-provenance@v4` attests it (`subject-checksums`, one attestation for every file), and the file is uploaded to the draft before it's published. A re-run replaces an earlier run's `SHA256SUMS`. Users check with `sha256sum -c` or `gh attestation verify <file> --repo Johnson-Anthony/glasshouse`.
- Attesting in the publish job, not in each build job, attests exactly the bytes on the release. tauri-action uploads straight to the draft, and every file is listed once.

## Not done
- **AppImage update information** (zsync): task 48's updater handles the AppImage. Two update mechanisms for one file would disagree.
- **AppImage desktop integration** (a menu entry for an AppImage that isn't installed): a feature of its own, left out here; see the report.
- **Code signing:** D1.
