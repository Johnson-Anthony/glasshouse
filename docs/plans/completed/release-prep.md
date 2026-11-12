# release-prep

Branch: `claude/exciting-rubin-44f4c0` (worktree `exciting-rubin-44f4c0`). Config, CI and docs; no Rust build.
Scope: section 10 of `docs/plans/active/survey-2.md`. Goal: a `v0.2.0` tag is safe to push. Tagging, releasing and pushing are the user's call, so this task does none of them.

## Status
Done 2026-11-12, merged with `main` at `71e6ab9`. Nothing was tagged, released or pushed.

**Checks:**
- `pnpm build` passes.
- `pnpm test`: 355 passed and 3 skipped (zsh, fish and pwsh aren't installed). That includes 7 new tests in `scripts/release-check.test.mjs`. vitest now also collects `scripts/**/*.test.mjs`.
- `pnpm check:wiring`: 0 problems.
- `pnpm notices --check`: up to date.
- `pnpm site:build`, then `pnpm site:capture check`: 18/18 pass. The demo's About and menubar now say v0.2.0, so `docs/demo` is rebuilt.
- `cargo metadata --locked` passes (no build).

**Workflow, checked locally:**
- actionlint isn't installed, and installing it means a download I had no approval for, so it wasn't run.
- PyYAML parses `release.yml`. A small checker found no unknown `needs`, job outputs or step ids, and shellcheck is clean on all 8 `run:` scripts (expressions stubbed).
- The `run:` scripts were run with a stub `gh`:
  - a fresh run creates a draft and outputs its id;
  - a re-run reuses its own draft;
  - a published tag fails;
  - the notes heredoc renders;
  - publish goes ahead only with all six files present. A missing one leaves the draft and makes no publish call.
- `release-check.mjs`:
  - against the repo as committed it refuses `v0.2.0` (undated heading, TODO marker), `main` and `v0.2.1` (all four manifests named);
  - on a copy with the marker removed and a date set, it passes and prints the notes.

**Only a real tag run can prove:**
- the `ubuntu-22.04-arm` build: apt dependencies, rustup through `dtolnay/rust-toolchain`, linuxdeploy for aarch64;
- the exact arm64 file names (`_aarch64.AppImage`, `_arm64.deb`). They come from Tauri's docs, not from a build here. A wrong guess fails `publish` and leaves a complete draft;
- tauri-action uploading by `releaseId`;
- the `gh api` calls against GitHub (`env.TAG` in `--jq`, `-F body=@file`);
- the AppImage running on Ubuntu 24.04 with `libfuse2t64`.

**Before tagging** (user and lead):
- add the rest of wave 1 to CHANGELOG.md;
- date the 0.2.0 heading;
- delete the `TODO(release)` comment. `release-check` refuses the tag until all three are done.

## Approach

### 1. Version 0.2.0
- `package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`.
- `Cargo.lock` with `cargo update -p glasshouse --offline` (no build), then check `cargo metadata --locked`.

### 2. `scripts/release-check.mjs <tag>`
One script the workflow runs first; it can be run locally too.
- Fails unless the tag is `v<semver>`.
- Fails unless all four versions match the tag: package.json, Cargo.toml `[package]`, tauri.conf.json, and Cargo.lock's `glasshouse` entry (CI builds `--locked`).
- Prints the tag's CHANGELOG section as the release body. It fails when:
  - the section is missing;
  - the heading has no release date (`## [0.2.0] - YYYY-MM-DD`);
  - the section still has the `TODO(release)` marker.

  This way a forgotten placeholder can't reach a public release.

### 3. release.yml
- **`prepare`** (ubuntu-latest):
  - fails early unless the run is for a `v*` tag; a manual run from a branch stops here;
  - runs the check script;
  - creates a **draft** release with that body plus the install notes, and outputs its id.
  - A re-run reuses its own draft. If the tag's release is already published, the run fails instead of uploading over it.
- **`build`**, a matrix:

  | Runner | Bundles | glibc | Notes |
  |---|---|---|---|
  | `windows-latest` | msi, nsis | — | |
  | `ubuntu-22.04` | appimage, deb | 2.35 | |
  | `ubuntu-22.04-arm` | appimage, deb | 2.35 | arm64; linuxdeploy can't cross-build it |

  - Each runs tauri-action@v0 with `releaseId`, so all jobs upload to that one draft.
  - `includeUpdaterJson: false`: there's no updater, and two jobs racing on `latest.json` would collide.
  - Asset names come from the Tauri CLI and include the arch: `_amd64`/`_aarch64` AppImage, `_amd64`/`_arm64` deb, `_x64` msi and exe, so nothing collides.
- **`publish`:** needs `prepare` and every `build` job, so it is skipped if any fails.
  - Checks that the six expected assets are on the draft.
  - Then makes the release public (and Latest).
- `concurrency` per tag, no cancel.

### 4. CHANGELOG.md
- A user-facing 0.2.0 section built from PROGRESS.md Done, `docs/plans/completed/` and `git log v0.1.0..main`.
- What it covers:
  - data-loss and safety fixes;
  - security;
  - new features since July;
  - behavior changes (settings reset once, removed menu items, the focus-and-targets changes);
  - known issues.
- A `TODO(release)` comment marks where the lead adds the rest of wave 1. The release check refuses the section until it's gone and the date is set.

### 5. README
- The install steps match the six assets:
  - Windows x64 .msi or setup .exe, unsigned (SmartScreen: More info → Run anyway);
  - Linux x64 and arm64 .AppImage and .deb, built on Ubuntu 22.04 (glibc 2.35+);
  - the AppImage needs FUSE 2: `libfuse2t64` on Ubuntu 24.04+ and Debian 13, `libfuse2` before that.
- Link the CHANGELOG.

## Decisions
- `ubuntu-22.04-arm` rather than `ubuntu-24.04-arm` for arm64. 24.04's glibc 2.39 would keep the arm64 build off Debian 12, Raspberry Pi OS (bookworm) and Ubuntu 22.04. Tauri's own pipeline guide uses `ubuntu-22.04-arm`.
- Stay on `tauri-action@v0` (0.6.2). v1.0.0 (2026-06) renames inputs and changes release handling; upgrading is deps-bump material.

Both go in `docs/decisions/2026-11-11-release-prep-workflow.md`.

## Checks
- `pnpm build`, `pnpm test`, `pnpm notices --check`.
- `cargo metadata --locked`.
- The check script against good and bad tags, and against a changelog with and without the marker.
- The workflow YAML with actionlint if it can be installed, otherwise a YAML parse.
