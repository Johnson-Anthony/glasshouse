# windows-paths (survey-3 task 34)

Scope: "## 34. windows-paths" in `survey-3.md`, without the 7-Zip lookup (task 33 did it). Almost all of it is Windows behavior that this Linux machine can't build, so the path rules are pure functions with tests on every platform, and the Win32 calls around them stay thin.

## Steps
1. **`src-tauri/src/winpath.rs`** (new, pure, no `cfg`): Windows path rules as string and UTF-16 functions.
   - `plain(path)`: `\\?\C:\…` → `C:\…`, `\\?\UNC\server\share\…` → `\\server\share\…`, only when the plain form names the same file (no reserved device name, no component ending in a dot or space); else unchanged.
   - `listing_base(path)`: what `list_dir` joins entry names to: `plain`, `/` → `\`, a bare `C:` → `C:\`.
   - `verbatim(wide)`: the reverse, for raw Win32 calls: an absolute path of 248 units or more becomes `\\?\…` / `\\?\UNC\…` (as std does for its own calls); shorter ones pass unchanged.
   - `saved_form(path, shares)`: a saved path in the old canonical form, in the form listings now give: `plain`, then a mapped drive's letter for its share (`\\server\share\x` → `Z:\x`).
   - `is_wsl_bash(path, system_root)`, and the reserved-name test.
2. **Listings** (`commands/listing.rs`): entry paths come from the requested path; the canonical path is used only for the git scan and its lookup keys. Dotfiles aren't hidden on Windows.
3. **Raw Win32 calls** take `to_verbatim()`: `MoveFileExW`, `CopyFileW` (`fs_ops.rs`), `ReplaceFileW` (`replace.rs`). Manifest: `longPathAware` and `supportedOS` in `windows/app-manifest.xml`.
4. **Saved data** (`commands/config.rs`): pins, tags and recents read on Windows go through `saved_form` (shares from `WNetGetConnectionW`, asked only when a saved path has the `\\?\UNC\` form) and are written back once. Session tabs go through the frontend guard.
5. **Frontend guard** (`paths.ts`): `plainPath`, used by `navInit`/`navGoTo`, `parseTyped` and the session's tab check; `rootLen` knows the verbatim roots, so a verbatim path that can't be made plain still gets sane breadcrumbs.
6. **Name rules** (`names.ts`): Windows rules (reserved characters, device names, a trailing dot or space) in `nameProblem` and Bulk Rename; on Linux for FAT, exFAT and SMB folders (`path_fs_type`).
7. **Shells** (`pty/profiles.rs`): on Windows PowerShell first, then cmd, then Git Bash; `System32\bash.exe` and the WindowsApps alias (WSL's launcher) are never the bash profile.
8. **Reveal** (`launch.rs`): `SHOpenFolderAndSelectItems` instead of `explorer /select,`.
9. **Tests**: tool-dependent Rust tests fail on CI when the tool is missing; Windows-only cargo tests for verbatim and UNC listings, long-path rename and copy, reserved names; hand checks in `docs/testing/windows.md`.

## Status
In progress.
