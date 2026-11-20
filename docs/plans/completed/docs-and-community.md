# Task 43: docs-and-community

Scope: §43 of `docs/plans/active/survey-3.md` (README for users, repo files, manual checklists), plus D1's SmartScreen note and task 48's privacy line. Nothing under "Found by tasks" is marked for 43. Docs and repo files only, no app code.

## Status
Done on 2026-11-20. Decisions: `docs/decisions/2026-11-20-docs-and-community-readme.md`.

| Step | What | Status |
|---|---|---|
| 1 | Plan | done |
| 2 | README rewritten for users: install per platform and which file to pick, requirements, integration, privacy, data and removal, checking downloads, known limitations, getting help | done |
| 3 | CONTRIBUTING.md (build from source, checks, conventions, the stack, releases), SECURITY.md | done |
| 4 | `.github/ISSUE_TEMPLATE/` (bug form, feature form, `config.yml`), a short PR template | done |
| 5 | `docs/testing/`: an index, `windows.md` (80 checks), `linux.md` (71 checks); `docs/_config.yml` keeps them off the site | done |
| 6 | Link check, and every claim checked against code and config | done |

Checks: a link check of every changed file (relative files, heading anchors by GitHub's slug rules, and each external URL; crates.io refuses curl's default agent, so its four pages were checked through its API); the issue forms and `config.yml` validated against SchemaStore's `github-issue-forms` and `github-issue-config` schemas; `actionlint`. No app code changed, so `pnpm build`, the tests and the site weren't run: the site doesn't link to the README, and the `_config.yml` exclude doesn't change what `pnpm site:build` makes or what `site:capture check` tests.

Not verified: everything the checklists list, by definition. The upgrade over 0.2.0's setup.exe (README, W2.7) is reasoned from the NSIS template, not run.

Lines that change when other tasks land:
- task 48 (updater): README "Privacy" → "Update checks (planned)", "Known limitations" → "No automatic updates yet", and "Linux" → the .deb and AppImage update notes;
- task 33 (diagnostics): README "Getting help" → Help → Open Log Folder (planned); the bug form's ids for Report Bug…'s pre-fill;
- task 49 (AppImage menu entry): README "Linux" → "An AppImage doesn't add itself to your app menu", and `linux.md` L2.3.

Found while checking:
- On Windows, tools are found on PATH only (`find_tool`), and 7-Zip's installer doesn't add itself to PATH, so `.7z` needs a manual PATH change. Looking in `%ProgramFiles%\7-Zip` too would fix it (task 34, windows-paths, or 33).
- On Windows, the terminal's `bash` profile is whatever `bash.exe` is first on PATH, which is usually `System32\bash.exe`, WSL's launcher, not Git Bash. Unverified on a real PC; `windows.md` W9.1 checks it.
- A code of conduct needs a contact for reports: the owner's call.

## Design
- **The README describes `main`**, as it does now, with one line pointing at CHANGELOG for what each release has. Things the latest release (0.2.0) doesn't have are worded so they stay true, such as "releases after 0.2.0" for `SHA256SUMS` and the Windows arm64 installers.
- **Moves out of the README:** build from source, the stack and the project site go to CONTRIBUTING.md. The README keeps a short pointer.
- **Planned features** are written as planned, marked in the text, and listed in the report so the lead can update them when they land:
  - task 48: the update check (off by default; fetches the release's `latest.json`) and in-app updates for the setup.exe, MSI and AppImage;
  - task 33: Help → Open Log Folder, the log folder, and Report Bug… filling in the version, OS and desktop.
- **Privacy** from the code: no HTTP client in `Cargo.toml`, and a CSP whose `connect-src` is only `'self' ipc: http://ipc.localhost`. Programs the user starts (git, ssh, the browser) reach the network as usual, and the Windows installers' WebView2 bootstrapper downloads the runtime when it's missing (`webviewInstallMode: embedBootstrapper`).
- **Data folders** from `migrate.rs` and Tauri's path rules: on Linux `~/.config/<id>` and `~/.local/share/<id>` (the webview's storage and cache are in the second), on Windows `%APPDATA%\<id>` and `%LOCALAPPDATA%\<id>`. What each uninstaller removes is from `docs/decisions/2026-11-20-release-identity-installers.md`.
- **Issue forms:** the bug form's field ids (`version`, `os`, `desktop`) are stable, so task 33's Report Bug… can fill them through the URL's query string. `config.yml` turns off blank issues and links security reports to the private advisory form.
- **SECURITY.md** at the repo root: report through Security → "Report a vulnerability" (private reporting is on, D7), never a public issue; the latest release is the supported one.
- **Checklists** (`docs/testing/`): numbered checks with what to expect, so a tester can mark pass or fail, grouped by area. They cover what CI's unit, e2e and `installers` jobs don't drive, taken from CHANGELOG's [Unreleased] and the "Not run" notes in PROGRESS.md. `docs/_config.yml` keeps them off the Pages site, like the other working docs.
- **Not added:** a code of conduct. It needs an enforcement contact, which is the owner's to choose, so it goes to the lead as a question.
- **No owner setup** in anything written: no machine, desktop or paths of the owner's.
