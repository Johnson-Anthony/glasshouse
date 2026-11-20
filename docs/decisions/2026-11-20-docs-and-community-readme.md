# docs-and-community: the README, repo files and checklists

Date: 2026-11-20. Task: `docs-and-community` (survey-3 task 43).

## The README describes `main`
GitHub shows the README of `main`, and Help → Documentation opens it, so it describes the current code, with one line pointing at CHANGELOG for what each release has. Where the latest release (0.2.0) lacks something, the text says "releases after 0.2.0" (`SHA256SUMS`, the Windows arm64 installers), which stays true after the next release. Build from source, the stack and the project site moved to CONTRIBUTING.md.

## Claims and where they come from
- **Privacy:** no HTTP client in `src-tauri/Cargo.toml`; the CSP's `connect-src` is `'self' ipc: http://ipc.localhost` and `img-src`/`font-src` allow no remote hosts. git, ssh and the browser are the user's own programs. The Windows installers embed the WebView2 bootstrapper (`webviewInstallMode: embedBootstrapper`), which downloads the runtime when it's missing.
- **Data folders:** Tauri's `app_config_dir` and `app_local_data_dir` (see `migrate.rs`). On Linux the webview keeps its storage and cache in `~/.local/share/<id>`; there's no `~/.cache/<id>`.
- **The AppImage carries its own WebKitGTK** (0.2.0's AppImages are 82–84 MB, the .debs 9 MB), so it isn't updated with the system.
- **Uninstall:** the NSIS checkbox is "Delete the application data" and removes `$APPDATA\<id>` and `$LOCALAPPDATA\<id>` (Tauri CLI 2.12.4's NSIS template); the rest is from `2026-11-20-release-identity-installers.md`.
- **Upgrade over 0.2.0's setup.exe:** the template's strings are "Uninstall before installing", "Do not uninstall" and "Unable to uninstall!". That the second works is the release-identity record's reasoning; nobody has run it (W2.7 in `docs/testing/windows.md`).
- **Optional programs** are looked up on PATH only (`find_tool` in `launch.rs`). 7-Zip's Windows installer doesn't add itself to PATH, so the README says to add it.
- **git:** status, branch, stage, unstage, discard and blame use libgit2; the Git menu's other commands, the branch lists and the Inspector's last commit run `git`.

## Planned features, written as planned
The update check (task 48) and Help → Open Log Folder (task 33) are described as planned, each in one place, so they're easy to update when those tasks land.

## Issue forms
- The bug form's field ids `version`, `install`, `os` and `desktop` are meant to stay, so Report Bug… (task 33) can fill them from the new-issue URL.
- `blank_issues_enabled: false`, so `/issues/new` shows the chooser, which also links the private advisory form and the README's install notes.
- Labels are the repo's existing `bug` and `enhancement`.

## Not added
- **A code of conduct.** It needs a contact for reports, which is the owner's to choose. GitHub's community profile counts it.
- **Checklists on the site.** `docs/testing/` is excluded in `docs/_config.yml`, like the other working docs; GitHub shows them in the repo.
