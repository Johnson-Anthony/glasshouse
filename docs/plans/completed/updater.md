# Task 48: updater

Scope: "## 48. updater" in `docs/plans/active/survey-3.md`, owner decisions D2 (an updater, off by default) and D1 (no code signing).

## Status
Done, 2026-11-20, on branch `claude/eloquent-chebyshev-4e12bf` (plan in `docs/plans/completed/`). One deviation from the brief: tauri-action's `includeUpdaterJson` stays off, and the publish job writes latest.json (`docs/decisions/2026-11-20-updater-design.md`).

| Step | State |
|---|---|
| Plan | done |
| Rust: tauri-plugin-updater 2.14.1, `plugins.updater` config, `update.rs` (install kind, daily gate, check, install, cancel; 12 tests), the `update` permission group, notices | done |
| Frontend: api, the update dialog, Preferences → Updates, Help → Check for Updates, the automatic check and its toast, the demo mock; 21 new tests | done |
| `scripts/updater-json.mjs` (minisign verify with node:crypto, latest.json) with tests against a real CLI signature; release.yml (prepare's key check, signed builds, publish writes latest.json) | done (actionlint; the prepare step run locally with a throwaway key: good key, missing secrets, wrong password, wrong key; the workflow itself not run) |
| Local end to end: debug AppImage and deb bundles at 0.2.0 and 0.2.1, signed with a throwaway key, a local latest.json over http, WebDriver under Xvfb | done: available; AppImage install, replaced file = the 0.2.1 image, restart as 0.2.1 with its tabs and the session lock; nothing new; .deb notice; offline; no latest.json; bad signature (refused, file unchanged); the automatic check (a toast 20 s after turning it on, one request, none on a second start the same day) |
| Found by the end-to-end run: after the restart the old AppImage stayed mounted until the new window closed (the runtime's handle on its mount passed to the new process) | fixed: files are made close-on-exec before the restart; checked again end to end |
| Docs: ARCHITECTURE "Updates", decision note, README privacy line for task 43 (in the decision note) | done |
| Checks | done: `pnpm build`, `pnpm test` (1089 passed), `check:wiring`, `notices --check`, clippy `-D warnings`, `cargo test` (357 passed), actionlint, `site:build`, `site:capture check` |

Not run here: Windows (NSIS and MSI updates, the UAC prompt, Restart Manager closing other windows, `/R` restarting), a real GitHub release, the release workflow.

## Design
- **Rust only on the network.** `tauri-plugin-updater` 2.14.1 is registered, but none of its JS permissions are granted, so the webview can't call it. Three app commands in a new `src-tauri/src/update.rs`, in a new `update` permission group:
  - `update_info`: the running version, how this copy was installed, whether it can update itself, the endpoint, and the time of the last check;
  - `update_check(auto)`: one request for latest.json, returning "up to date", "available" (version, date, notes, the package link) or an error in words (offline, no update information, no package for this system). With `auto`, it does nothing unless a day has passed since the last check (an hour after a failed one), and it reports a version only once;
  - `update_install`: downloads the update the last check found, with progress events, verifies its signature, installs it, and restarts.
- **How glasshouse was installed:** `tauri::utils::platform::bundle_type()`, a marker the Tauri bundler writes into each package's copy of the binary (deb, rpm, AppImage, msi, nsis). No marker means a build from source.
  - NSIS (per user) and MSI (per machine) update in the app; the plugin picks `windows-<arch>-nsis` or `-msi` from that marker, so an update keeps the install type.
  - AppImage updates in the app when `$APPIMAGE` is set and its folder is writable; otherwise it gets a download link.
  - .deb and .rpm get a notice with a download link, never an install.
  - A build from source gets the release page.
- **Config:** `plugins.updater` in tauri.conf.json, with the pubkey, the endpoint `https://github.com/Johnson-Anthony/glasshouse/releases/latest/download/latest.json`, `requireSignedVersion` (the Tauri CLI binds the version into each signature) and Windows `passive` install mode. The CSP stays as it is, because the webview never contacts GitHub.
- **Off by default:** TweakState `autoUpdate: false`. Preferences → Behavior → Updates has the switch, says exactly what is contacted and that nothing else is sent, and has "check now" and the last check. Help → Check for Updates opens the update dialog, which checks once. The automatic check runs only in the window that owns the session: 20 s after start, then hourly ticks that Rust gates to once a day. A newer version shows a toast that opens the dialog.
- **Update dialog:** "what's new" from the release notes, rendered as text (headings and bullets, no HTML), plus the release page. Install happens only on the button, and says that every glasshouse window closes (Windows) or that other windows keep the old version until closed (AppImage).
- **release.yml:**
  - prepare checks that both secrets are set, signs a probe file and checks it against tauri.conf.json's pubkey, so a missing or wrong key fails before the builds start;
  - the builds sign (`--config src-tauri/release.conf.json` sets `createUpdaterArtifacts`, so PR CI and local bundle builds need no key);
  - publish verifies every package's `.sig` and signed version, then writes latest.json itself (`scripts/updater-json.mjs`), with the changelog section as its notes.
  - The brief said to set `includeUpdaterJson: true`, but tauri-action's latest.json is a read-modify-write per job, which races across the four parallel builds, and its notes are empty: `docs/decisions/2026-11-20-updater-design.md`.
- **Demo:** the mock backend answers the update commands with "not in the demo".

## Steps
1. Rust: the dependency, the config, `update.rs` with tests, permissions, registration.
2. Frontend: api wrappers, the update dialog, Preferences → Updates, Help → Check for Updates, the automatic check, the demo mock; tests.
3. `scripts/updater-json.mjs` (a minisign verifier with node:crypto, the latest.json writer) with tests, and release.yml.
4. Local end to end, with a throwaway key in the scratchpad: debug AppImage and deb bundles at 0.2.0 and 0.2.1, a local latest.json over http (a test `--config` overlay, never committed). Check "available" with install and restart (AppImage), the .deb notice (an extracted .deb, not installed), "nothing new", "offline", and a bad signature.
5. Docs: ARCHITECTURE.md "Updates", a decision note, a note for task 43's README privacy line; the full checks; handoff; report.

## Not runnable here
Windows installs (NSIS and MSI updates, UAC), a real GitHub release, and the release workflow itself.
