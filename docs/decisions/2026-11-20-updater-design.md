# Updater: opt-in checks, how a copy updates, and where latest.json comes from (task 48)

Owner decision D2 (survey-3) asks for an updater that's off until the user turns it on, with Help → Check for Updates as a one-off check. D1 is no code signing for now, so the update signature (minisign) is the only signature these packages carry.

## What it contacts, and when
- **Nothing by default.** `autoUpdate` (Preferences → Updates → "check for updates automatically") is false for new and existing settings. Help → Check for Updates checks once, when clicked.
- **A check is one GET** of `https://github.com/Johnson-Anthony/glasshouse/releases/latest/download/latest.json` (a redirect to GitHub's asset host).
  - The request has the plugin's user agent (`tauri-plugin-updater/<its version>`) and `Accept: application/json`.
  - No glasshouse version, ID or usage data: the URL has no `{{current_version}}` or other template.
  - Preferences shows the URL and says this, and so does the dialog while it checks.
  - A download starts only on Install.
- **It runs in Rust.** The app's commands (`update_info`, `update_check`, `update_install`, `update_cancel`, in the new `update` permission group) call the plugin's Rust API. The webview is granted none of the plugin's own permissions (`updater:default` isn't in `capabilities/default.json`), so a page can't trigger a download or install through them.
  - The CSP is unchanged: `connect-src 'self' ipc: http://ipc.localhost`. The webview never contacts GitHub; the release page opens in the browser through `open_url`.
- **The automatic check is daily at most, per user, not per window.**
  - Only the window that owns the session runs it (`session_owner`), because every window is its own process. It runs 20 s after start, then hourly.
  - Rust lets a check through a day after the last answered one, and an hour after an unanswered attempt (offline), so a laptop that starts offline still hears within the day. The times are kept in `update.json` in the config dir, so restarts and other windows share them.
  - A clock that went back counts as long ago, so a wrong clock can't stop checks.
  - The automatic check shows each version once (a toast with "what's new"); Help → Check for Updates always shows it.

## How glasshouse knows how it was installed
`tauri::utils::platform::bundle_type()`. When the Tauri bundler makes each package, it patches a marker string in that package's copy of the binary (the build log says "Patching … with bundle type information: appimage", then "deb"). A binary built without bundling (`tauri dev`, `tauri build --no-bundle`) has none. No paths, package-manager queries or environment guesses are needed, and the plugin uses the same marker to pick the package from latest.json.

| Marker | Install | What an update does |
|---|---|---|
| `nsis` | setup.exe, per user | downloads the new setup.exe and runs it (`/P /UPDATE /R`, passive): it closes every glasshouse window (Restart Manager), installs to the same per-user folder, and starts glasshouse again |
| `msi` | MSI, per machine | downloads the new MSI and runs `msiexec /i … /passive`: Windows asks for an administrator's approval (UAC) |
| `appimage` | an AppImage | if `$APPIMAGE` is set and its folder is writable (`access(W_OK)`), the file is replaced (the plugin moves the old one aside and puts it back on failure) and this window restarts through `$APPIMAGE`, with its tabs. Its files are made close-on-exec first: the runtime's handle on its mount would otherwise pass to the new image's runtime and keep the old image mounted. Otherwise it links to the new AppImage. Other windows keep running the old image until closed |
| `deb`, `rpm` | a package | never installs. The .deb belongs to the package manager, so the dialog links to the new `.deb` (from latest.json's `linux-<arch>-deb` entry) with the `sudo apt install ./…` line. The .rpm (not shipped) links to the release page |
| none | built from source | says a new version is out and links to the release page |

**The install type stays the same on Windows.** latest.json has `windows-<arch>-nsis` and `windows-<arch>-msi`, and the plugin looks up `<os>-<arch>-<marker>` first, so a setup.exe install updates with the setup.exe (per user) and an MSI install with the MSI (per machine). The bare `windows-<arch>` and `linux-<arch>` keys point at the setup.exe and the AppImage, for a copy without a marker; such a copy never installs, but its check still finds the version.

**An AppImage updates itself through the Tauri updater**, so no zsync update information is embedded (AppImageUpdate isn't used).

## Trust
- Every package is signed with the minisign key pair the lead generated. The public key is `plugins.updater.pubkey`; the private key and its password are the repository secrets `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. Replacing the key would make every installed copy refuse updates, so it must not be regenerated.
- `requireSignedVersion: true`. `tauri build` puts `version:<v>` in each signature's trusted comment (`--app-version`), and the plugin refuses a package whose signed version isn't the one latest.json announces. latest.json itself isn't signed, so without this a tampered latest.json could pair a new version number with an older signed package (a downgrade). No release before this one was signed, so nothing older needs to stay installable.
- latest.json and the packages come over HTTPS from GitHub. Release builds refuse a non-HTTPS endpoint (the plugin's `dangerousInsecureTransportProtocol` is off).

## Where latest.json comes from
The brief said to set tauri-action's `includeUpdaterJson: true`. It stays false: the publish job writes latest.json itself (`scripts/updater-json.mjs write`). The reasons:
- **tauri-action's latest.json races.** Each build job downloads latest.json from the draft, adds its own platforms, deletes it and uploads it again (`upload-version-json.ts`). Four builds run in parallel and can finish together, so one job's entries can be lost, or a delete can fail on an asset another job already removed and fail the build.
- **Its notes would be empty.** Given a `releaseId`, the action's notes are its `releaseBody` input, which we don't pass. The CHANGELOG section (`release-check.mjs`'s output) is what the update dialog should show, without the release page's install notes.
- **It can't check anything.** The publish job already downloads every package. It now downloads each `.sig` too and checks each package against tauri.conf.json's public key and the tag's version. Only then does it write the manifest. A release whose packages wouldn't install stays a draft.

The build jobs still sign: `--config src-tauri/release.conf.json` turns on `createUpdaterArtifacts`, and tauri-action uploads each `.sig` beside its package. The setting isn't in tauri.conf.json itself, so CI's installers job, e2e builds and anyone's local `pnpm tauri build` need no key.

## When the secrets are missing
The prepare job checks before any build starts, so the four builds aren't wasted:
1. Both secrets must be set, or it fails naming the missing one. A fork's message says it needs its own key pair, public key and endpoint.
2. It signs a probe file with `tauri signer sign --app-version <v>`. A wrong password fails here: "incorrect updater private key password".
3. `updater-json.mjs verify` checks the probe against tauri.conf.json's public key and version. A key that isn't the app's fails here and names both key ids.

All three were run locally with a throwaway key. Without the secrets, a release can't be published: a release without latest.json would make every user's check report "no update information" until the next one.

## Release notes in the app
The notes are the CHANGELOG section as markdown. The dialog shows them as text (headings, bullets, paragraphs; link text without the link, marks stripped) and never as HTML, so nothing in a release body can run in the webview. The full notes are a "release page" click away.

## Not done
- Nothing on Windows was run here: NSIS and MSI updates, the UAC prompt, the Restart Manager closing other windows, and `/R` restarting the app.
- No real GitHub release was made, and release.yml hasn't run.
- No "skip this version" or delta updates. The automatic check already reports each version once.
- No .rpm is built. If one is added, it gets the release-page link, since latest.json has no rpm entry.

## README (task 43)
For the privacy section: "glasshouse makes no network requests unless you ask. Help → Check for Updates, or Preferences → Updates → Check for updates automatically (off by default; once a day at most), fetches the latest release's `latest.json` from github.com. Nothing about you or your computer is sent, and an update downloads and installs only when you choose Install. A `.deb` install isn't updated by the app: it tells you a new `.deb` is out."
