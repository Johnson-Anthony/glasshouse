# glasshouse spec

Written 2026-11-08 from the existing code and README. The "Open questions" section lists what still needs the owner's confirmation.

## What it is
glasshouse is a desktop file manager built with Tauri 2 (Rust backend) and React 18 + TypeScript. It is Windows-first, aiming at what stock Explorer does poorly, and also runs on Linux. It's a personal project by Anthony Johnson, public and MIT-licensed, with pre-built releases for other users.

## What it does today (v0.1.0 release + `main`)
- Multi-tab browsing with private tabs, plus details, miller-column and other display modes.
- An embedded terminal drawer (xterm.js plus a Rust pty) with several shell tabs pinned to the current folder. Profiles cover local shells, WSL distros and ssh hosts from `~/.ssh/config`.
- A git-aware sidebar and file decorations (libgit2), with stage, unstage, discard, blame, branches and a raw `git` runner.
- In-process zip; tar.gz, tar.zst and 7z through external tools.
- Tags, bookmarks/pins, recents, fuzzy search, find in files, checksums, diff, hex view, bulk rename and undo for common operations.
- An inspector with type-aware previews (text, image, PDF, audio, hex) and quick look.
- 8 themes plus themed dialogs and context menus instead of native OS chrome.

## Platforms and constraints
- **Windows:** WebView2 and an msi/nsis bundle. **Linux:** WebKitGTK 4.1, AppImage/deb built in CI. Development also happens on Linux arm64 under Wayland (niri).
- **Toolchain:** pnpm 9 (pinned in `packageManager`), Node 20+ (CI uses 22), Rust stable. `Cargo.lock` needs rustc 1.88 or newer, even though `rust-version` says 1.77.
- **CI** (`.github/workflows/ci.yml`): frontend build and vitest on Ubuntu; `cargo clippy -D warnings` and `cargo test` on Ubuntu and Windows. Both must stay green.
- **Releases:** pushing a `v*` tag builds them with tauri-action (`release.yml`).
- Local-only app: no accounts, no network services.
- `docs/` is also the GitHub Pages source (`docs/index.html` is the landing page).

## Current milestone
The survey-fix pass (2026-11-08) fixes the defects found in the codebase survey, one task branch each. See `docs/plans/active/survey-fixes.md`.

## Open questions (owner to confirm)
- **Remote browsing:** the README mentions "remote-target browsing", but there's no remote filesystem backend, only ssh terminal profiles. Is that planned or dropped?
- **macOS:** only `open_url` has a macOS branch. Is macOS a non-goal?
- **Launch path:** should the app accept a path on the command line, so it can be the default folder handler?
- **`origin/feature`:** it has one commit, `ddb5466`, that was never merged. Merge, cherry-pick or drop?
