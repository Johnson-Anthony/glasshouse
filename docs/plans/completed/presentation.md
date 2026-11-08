# presentation

Rewrite the public and user-facing copy in a plain, matter-of-fact voice, and remove every form of the word the user no longer wants (called "the old word" below, so this file doesn't contain it). Scope is in the `## presentation` section of `survey-fixes.md`.

## Status
Done (2026-11-08). `pnpm build` and `pnpm test` (51 tests) pass, and the Pages site renders with the same layout. The done-check grep finds only the Nerd Font files and `survey-fixes.md` (see "Not changed"). No Rust files changed except the Cargo.toml description, so cargo wasn't run. GitHub changes below are waiting on the user's review.

## Changes

### Code and config
- `package.json`: `productName` becomes `glasshouse`; add a `description` matching Cargo.toml.
- `src-tauri/Cargo.toml`: `description = "Desktop file manager for Windows and Linux"`.
- `index.html`: `<title>glasshouse</title>`.
- `src/App.tsx`: the display-tweaks key becomes `glasshouse.tweaks`. The old key isn't read or migrated, so saved tweaks reset once (accepted by the user).
- `src/handlers/misc.ts`: Export/Import Layout only handle the `glasshouse.` prefix. The old-word prefix check is gone.
- The layout export file, previously named after the old word, becomes `.glasshouserc`: menu labels in `src/data.ts`, the handler cases, file names and messages in `misc.ts`, and the Pages site. Old export files are no longer picked up by name, and their tweaks key would be filtered out anyway.
- `src/components.tsx`: the tweaks panel header said the tweaks live in a home-folder rc file, which was never true (they're in localStorage). It now just says `tweaks`.
- The About dialog was already plain ("app / version / tauri / built on"), so it's unchanged. The other dialog and toast messages are terse and factual, so they're unchanged too.

### Docs
- `README.md`: new tagline and copy. Also fixes factual errors:
  - archives: only zip is built in; tar.gz, tar.zst and 7z use the system `tar` and 7-Zip;
  - "remote-target browsing" was listed as in progress, but it doesn't exist (an open question in SPEC.md), so it's dropped;
  - the build command: `pnpm tauri:build` only builds the Windows bundles, so a Linux line is added (`--bundles appimage,deb`, as `release.yml` does).
- `docs/index.html`: same design and layout (no CSS or element changes). The title, meta description, heading prefix, tagline, caption, card text, build note and stack text are rewritten. Fixed facts: archive tools, "8 themes", "about 70" commands (71 today), binary size about 15 MB (the Linux arm64 release binary is 15.3 MB).
- `docs/ARCHITECTURE.md`: the localStorage key name.
- `.github/workflows/release.yml`: release notes template lightly reworded (it was already plain).

### Not changed (not mine to edit)
- `docs/plans/active/survey-fixes.md` quotes the old word in the `## presentation` section (lines ~152–171), so the done-check grep still finds it there. The lead should reword that section on `main` when it records the merge.

### Screenshot
`docs/screenshot.png` doesn't show the old word. It shows the tab bar, menu bar ("glasshouse v0.0.1"), sidebar, file list and status bar. The version shown is out of date (v0.0.1), which only matters if the screenshot is retaken.

## GitHub changes (for the lead to apply after the user reviews)
- **Description:**
  `Desktop file manager for Windows and Linux, with tabs, a built-in terminal and git status. Built with Tauri 2 and React.`
- **Website:** keep `https://johnson-anthony.github.io/glasshouse/`.
- **Topics:** remove the old-word topic and add `file-explorer`, `git`, `linux`, `terminal`, `windows`. Result:
  `desktop-app, file-explorer, file-manager, git, linux, react, rust, tauri, terminal, typescript, windows, xtermjs`
- **v0.1.0 release:** the title (`glasshouse v0.1.0`) and notes don't contain the old word and are already plain, so no change is needed. To match the new template, the notes could optionally be replaced with:

  ```
  Windows installers (`.msi` and NSIS `.exe`) and Linux packages (`.AppImage` and `.deb`).

  The binaries are unsigned, so Windows SmartScreen shows a warning the first time you run the installer: choose More info → Run anyway. On Linux, make the AppImage executable with `chmod +x` before running it.
  ```

## For review
- **Heading prefix on the Pages site:** I replaced the old prefix with `~/` in the same accent-colored span, so the heading still looks the same (`~/glasshouse`). The alternative is to drop the span, so the heading is just `glasshouse` in the normal heading color.
- **Layout export file name:** `.glasshouserc` keeps the old behavior (a hidden file in the current folder). The alternative is `glasshouse-layout.json`, which is visible and opens as JSON in editors.
- **Card headings on the Pages site** (text only, same markup): "multi-tab browsing" became "tabs", "git-aware" became "git status", "archives inline" became "archives", "themed everything" became "themes", "keyboard-first" became "keyboard", and "small & native" became "small". "embedded terminal" and "tags & bookmarks" are unchanged.
- **Build commands:** the README and the Pages site's build block now have a separate Linux line (`pnpm tauri build --bundles appimage,deb`), because `pnpm tauri:build` alone only builds the Windows bundles. That adds one line to the site's code block.
- **Topics:** `tauri-app` is another common topic for Tauri projects if the user wants more discoverability.
- The release assets for v0.1.0 are x64 only, though the README and site don't promise arm64. No change made.

## Checks
- The done-check `git grep` from `survey-fixes.md`, plus a case-insensitive substring search for the old word (to catch the old dotfile name, which the done-check regex misses): only the fonts and `survey-fixes.md` should remain.
- `pnpm build`, `pnpm test`.
