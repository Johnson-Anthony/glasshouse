# windows-paths (survey-3 task 34)

Scope: "## 34. windows-paths" in `survey-3.md`, without the 7-Zip lookup (task 33 did it). Almost all of it is Windows behavior that this Linux machine can't build, so the path rules are pure functions with tests on every platform, and the Win32 calls around them stay thin.

## Steps
1. **`src-tauri/src/winpath.rs`** (new, pure, no `cfg`): Windows path rules as string and UTF-16 functions.
   - `plain(path)`: `\\?\C:\…` → `C:\…`, `\\?\UNC\server\share\…` → `\\server\share\…`, only when the plain form names the same file (no reserved device name, no component ending in a dot or space); else unchanged.
   - `listing_base(path)`: what `list_dir` joins entry names to: `plain`, `/` → `\`, a bare `C:` → `C:\`.
   - `verbatim(wide)`: the reverse, for raw Win32 calls: an absolute path of 248 units or more becomes `\\?\…` / `\\?\UNC\…` (as std does for its own calls); shorter ones pass unchanged.
   - `saved_form(path, shares)`: a saved path in the old canonical form, in the form listings now give: `plain`, then a mapped drive's letter for its share (`\\server\share\x` → `Z:\x`).
   - `is_wsl_bash(path)`, and the reserved-name test (`is_device_name`).
2. **Listings** (`commands/listing.rs`): entry paths come from the requested path; the canonical path is used only for the git scan and its lookup keys. Dotfiles aren't hidden on Windows.
3. **Raw Win32 calls** take `to_verbatim()`: `MoveFileExW`, `CopyFileW` (`fs_ops.rs`), `ReplaceFileW` (`replace.rs`). Manifest: `longPathAware` and `supportedOS` in `windows/app-manifest.xml`.
4. **Saved data** (`commands/config.rs`): pins, tags and recents read on Windows go through `saved_form` (shares from `WNetGetConnectionW`, asked only when a saved path has the `\\?\UNC\` form) and are written back once. Session tabs go through the frontend guard.
5. **Frontend guard** (`paths.ts`): `plainPath`, used by `navInit`/`navGoTo`, `parseTyped` and the session's tab check; `rootLen` knows the verbatim roots, so a verbatim path that can't be made plain still gets sane breadcrumbs.
6. **Name rules** (`names.ts`): Windows rules (reserved characters, device names, a trailing dot or space) in `nameProblem` and Bulk Rename; on Linux for FAT, exFAT and SMB folders (`path_fs_type`).
7. **Shells** (`pty/profiles.rs`): on Windows PowerShell first, then cmd, then Git Bash; `System32\bash.exe` and the WindowsApps alias (WSL's launcher) are never the bash profile.
8. **Reveal** (`launch.rs`): `SHOpenFolderAndSelectItems` instead of `explorer /select,`.
9. **Tests**: tool-dependent Rust tests fail on CI when the tool is missing; Windows-only cargo tests for verbatim and UNC listings, long-path rename and copy, reserved names; hand checks in `docs/testing/windows.md`.

## Status
Done 2026-11-23 on `claude/windows-paths`. Every step above is in, plus what the work turned up. Decisions: `docs/decisions/2026-11-23-windows-paths-forms.md`.

**Added to the plan while working:**
- **A crash fixed in the folder watcher** (`PathEvents` in `watcher.rs`), which the new end-to-end flow hit and which isn't this task's code: on Linux, opening a subfolder could abort the app. notify hands on an inotify event with no path when its watch was just removed, and notify-debouncer-full 0.4.0 panics on it while holding its lock. A cargo test reproduces it; before the fix it aborted the test process.
- **Copy and move compare real places** (`real_path`, `Places` in `transfer.ts`). With listings keeping the requested path, two tabs can show one folder under two paths; as strings, a drop from one onto the other was a move onto a taken name, and Replace trashed the file being moved.
- **Tags and the trash under a link** (`trashedAs` in `tags.ts`): the trash records the real path, and Redo trashes by it, so the tags at the pane's path are dropped with it.
- `winNamesIn` treats anything but a type name from `path_fs_type` as "can't be told" (the full vitest run found handler tests whose mocked backend returns nothing).

**What changed on Linux** (the rest is Windows-only):
- A folder reached through a symlink lists its rows under the link's path, so a subfolder opened from it stays under the link (it used to jump to the target), and tabs, recents, pins, new tags and the saved session go by that path. The sidebar tree follows it. This is the `/home` → `/var/home` case in the backlog.
- Tags saved by an earlier build inside a linked folder are keyed by the real path: they show when the folder is opened by that path and under TAGS, not on the row seen through the link. Decided, not migrated (see the decision file).
- A copy or move between two views of one folder (the link and its target) says "already there", or makes a `(copy)`, instead of asking about a taken name.
- New File, New Folder, Rename and Bulk Rename refuse Windows-invalid names in a FAT, exFAT or SMB folder.
- Rust tests that need git, tar or 7-Zip fail when `CI` is set and the tool is missing; the Linux CI job installs `p7zip-full`.
- Unchanged: dotfiles are still hidden, the shells' order, Reveal.

**Checked here (Linux arm64):**
- `pnpm build`; `pnpm test`: 1258 passed, 2 skipped (shells not installed), 89 files; `pnpm check:wiring`: 0 findings; `pnpm notices --check`: up to date.
- `RUSTFLAGS="-D warnings" cargo clippy --all-targets`: clean; `cargo test`: 442 passed, 5 ignored.
- `pnpm e2e`: 12 of 12, four runs in a row after the watcher fix (before it, the second run crashed the app). The new flow, "a folder reached through a link", drives the real app through a symlinked folder: row paths, a subfolder opened from it, the watcher's refresh, git status, a tag, a pin, rename, cut and paste, Move to Trash, Undo and Redo of each with the tag following, `session.json`, `recent.json`, `pins.json` and `tags.json` holding the link's path, and a cut pasted into the same folder by its real path ("already there").
- `pnpm site:build` (the demo's mock backend answers `real_path`; `docs/demo` rebuilt and committed) and `pnpm site:capture check`: 25 checks pass.
- Windows-only Rust, type-checked for `x86_64-pc-windows-msvc` through a scratch crate with clippy `-D warnings`: `winpath.rs`, `drive_letters.rs` and `win_reveal.rs` as they are, and copies of the `cfg(windows)` parts of `config.rs`, `listing.rs`, `pty/profiles.rs`, `launch.rs` and the three raw calls. The Windows-only test modules (`listing_tests::windows`, `fs_ops_tests::long_paths`) were compiled once on Linux with their `cfg` flipped (clippy clean), then restored.
- `xmllint --noout src-tauri/windows/app-manifest.xml`: well-formed (`libxml2-utils` installed from apt for it, recorded in `~/.claude/environment.md`).
- By reading the code, not by a test: Reveal through a link (Linux passes the path on without resolving it; the in-app reveal matches the folder and names), search results (walked from the tab's path), the Trash view (the trash's own recorded paths throughout), `path_kind` (one stat of the path given), drag-out (resolves both sides). No archive-browsing listing exists.

**Not built or run: Windows CI's backend and e2e jobs are the first compile and run of**
- every `cfg(windows)` line in the app crate as a whole (the scratch crate can't link, and can't include modules with C dependencies);
- the manifest: Windows refusing it would stop every exe, the test exes included, from starting;
- the Windows-only cargo tests: dotfiles and the Hidden attribute, verbatim and trailing-dot listings, the share listing through `\\localhost\C$` (prints "skipped" and passes if the admin share can't be reached), rename, copy, move and `rewrite_text` past MAX_PATH.

**Only a person on Windows can confirm** (`docs/testing/windows.md` W9.1, W10.1, W13.2–W13.11): a mapped drive, `subst` and a junction staying under their own paths; pins, tags, recents and tabs saved by 0.2.0 as `\\?\UNC\…` moving to `Z:\…` (or `\\server\share\…` with the drive unmapped); Reveal on a path with a comma; the shell profiles and which `bash.exe` runs; the name rules in the prompts; long paths with `LongPathsEnabled` off. On Linux, `docs/testing/linux.md` L14 has the linked-folder and FAT checks for a hand run.

**Follow-ups, not done:**
- Tags saved under a link's target aren't shown through the link (an alias-aware tag store would need a stat per key).
- With long paths off system-wide, programs started in a long folder, the Recycle Bin and the folder watcher still stop at MAX_PATH.
- Find and Find & Replace still skip dot-names on Windows unless hidden items are on (the `ignore` crate's rule).
- The name rules are checked in the page only; the backend does what it's asked.
- On a Linux FAT, exFAT or SMB folder a taken name is still matched case-sensitively.
- An elevated glasshouse can't see mapped drives, so it migrates a share's saved paths to `\\server\share\…`.
