# Release workflow: one draft, published last, checked before the builds

Date: 2026-11-11 · Task: release-prep

## Context
release.yml had several hazards:
- A manual run from `main` created a public "Latest" release named `main`.
- Each build job published its own non-draft release. The Linux files went public while Windows was still building, and stayed public if Windows failed.
- Nothing checked that the tag matched the app's version.
- The Linux packages were built on `ubuntu-latest` (glibc 2.39), which keeps them off Debian 12 and Ubuntu 22.04.

## Decision
- **Three jobs:**
  - `prepare` checks the tag, creates one draft release and passes its id on;
  - the `build` matrix uploads to that draft with tauri-action's `releaseId`;
  - `publish` makes the draft public.
- **Publishing:** `publish` needs every build. It also checks that the six expected files are on the draft before it flips `draft` off, so a silent upload gap can't go public either.
  - The tauri-action route that finds or creates a release by tag would race: three jobs could each create a draft.
- **`scripts/release-check.mjs`** does the checks, so they can be run locally and tested (`scripts/release-check.test.mjs`).
  - The tag must be `vX.Y.Z`.
  - package.json, Cargo.toml, tauri.conf.json and Cargo.lock's own entry must have that version.
  - CHANGELOG.md must have a dated `## [X.Y.Z] - YYYY-MM-DD` section with no `TODO(release)` marker. That section is the release body, plus fixed install notes.
  - Pre-release tags (`v0.3.0-rc.1`) are refused, because WiX MSI versions must be numeric.
- **`cargo fetch --locked`** in `prepare`. The build itself isn't `--locked` (tauri build), so a stale lock fails here instead of being rewritten silently on the runner.
- **Re-runs:** a re-run reuses its own draft. A tag whose release is already published fails in `prepare`, so nothing uploads over a public release.
- **arm64 Linux on `ubuntu-22.04-arm`, not `ubuntu-24.04-arm`.**
  - Both runners exist, and linuxdeploy can't cross-build an AppImage, so arm64 needs one of them.
  - 24.04's glibc 2.39 would keep the arm64 packages off Debian 12, Raspberry Pi OS (bookworm) and Ubuntu 22.04. 22.04 gives both architectures the same glibc 2.35 floor.
  - Tauri's pipeline guide uses `ubuntu-22.04-arm` too.
- **`includeUpdaterJson: false`.** There's no updater, and two jobs would race on `latest.json`.
- **Stay on `tauri-action@v0` (0.6.2).** v1.0.0 (2026-06) renames inputs (`assetNamePattern`, `includeUpdaterJson`), drops others and changes release handling. Moving to it belongs with deps-bump.
- **Asset names** stay the Tauri CLI's, which already carry the architecture:
  - `_x64_en-US.msi`, `_x64-setup.exe`;
  - `_amd64.AppImage`, `_amd64.deb`;
  - `_aarch64.AppImage`, `_arm64.deb`.

## Rejected
- **Dropping `workflow_dispatch`.** A manual run from a tag is a useful way to redo a failed release. It now fails at its first step from a branch.
- **`ubuntu-24.04-arm`,** as the backlog suggested. See the glibc floor above.
- **Building with `-- --locked` through `tauri build`.** It would need a full release build here to confirm how the CLI passes it on. The `cargo fetch --locked` step catches the same stale lock more cheaply.
