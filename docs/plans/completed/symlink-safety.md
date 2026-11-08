# symlink-safety

Branch: `claude/recursing-allen-a7ecf9` (worktree `.claude/worktrees/recursing-allen-a7ecf9`).
Backlog entry: `## symlink-safety` in `survey-fixes.md`. Everything is in `src-tauri/src/commands.rs`.

## Status
Done 2026-11-08. All in `commands.rs`: `copy_entry`, `copy_dir_recursive`, `move_entry`, `shred`, plus new helpers `copy_regular_file`, `copy_symlink`, `resolve_no_follow`, `check_not_into_self` and `is_cross_device`, and 13 new tests (22 total). Clippy (`-D warnings`), `cargo test`, `pnpm build` and `pnpm test` pass on Linux arm64.
- Not compiled locally: the `cfg(windows)` branches (`copy_symlink`, shred's reparse-point open, `is_cross_device`'s code). Windows CI's clippy and test jobs are the first check of them.
- Decisions: `docs/decisions/2026-11-08-symlink-safety-link-handling.md`.
- Follow-up suggested as a separate task: make Paste pick a free "name (copy)" destination (frontend).

## Findings (confirmed)
- `shred` stats and opens with link-following calls, so on a symlink it overwrites the target and then unlinks only the link.
- `copy_dir_recursive`: `DirEntry::file_type()` doesn't follow links, so a link is neither `is_dir()` nor skipped and goes to `fs::copy`, which follows it. A file link is copied as its target's contents; a directory link fails with "is a directory", leaving a partial copy.
- `copy_entry` uses `Path::is_dir()` (follows), so a selected link to a folder copies the whole target tree.
- `fs::copy(a, a)` truncates `a` to 0 bytes (checked with a scratch program). The frontend's Paste builds `dst = cwd/basename(src)` with no same-path check, so Copy then Paste in the same folder empties the file, or every file in a copied folder. Copying a folder into its own subtree recurses until the path is too long.
- `move_entry` falls back to copy + recursive delete on any rename error. A move onto an existing non-empty folder (ENOTEMPTY) therefore merges into it and deletes the source; a move into the folder's own subtree (EINVAL) goes into the recursive copy.

## Approach
1. **Into-itself guard** shared by `copy_entry` and `move_entry`, run before any filesystem change:
   - source resolved without following its last component (canonical parent + name); destination canonicalized if it exists (that's where `fs::copy`/`create_dir_all` would write), else canonical nearest existing ancestor + the rest;
   - copy: reject when they're equal, and when a real directory's destination is inside it;
   - move: reject a real directory moved into its own subtree; a move onto the identical path returns Ok without touching anything, and a Windows case-only rename (`Foo` → `foo`, which resolves to the same file) still goes to `rename`.
2. **copy_dir_recursive / copy_entry**: decide on `symlink_metadata` / `DirEntry::file_type()`. Links are recreated as links with the same target text (relative stays relative), never followed, at the top level and nested. Special files (FIFO, socket, device) are refused with an error instead of `fs::copy`, which blocks forever reading a FIFO.
3. **move_entry**: rename; fall back to copy + delete only for a cross-device error (`EXDEV` = 18 on unix, `ERROR_NOT_SAME_DEVICE` = 17 on Windows). Matches raw codes because `ErrorKind::CrossesDevices` is newer than the crate's `rust-version` (clippy's `incompatible_msrv` would fail CI); `dead-code` owns the `rust-version` bump.
4. **shred**: `symlink_metadata`; refuse directories and non-regular files. After opening, check the handle is still the file that was stat'ed (unix: dev + inode; Windows: open with `FILE_FLAG_OPEN_REPARSE_POINT` and refuse a link), so a swap between stat and open can't redirect the overwrite.
5. **Tests** (temp dirs, existing `temp_dir` helper): shred on a link leaves the target intact; shred a regular file; copy keeps file, directory and loop links as links; top-level link copy; copy onto itself and into own subtree refused with data intact; move into own subtree refused; move onto a non-empty folder errors without merging; cross-device codes; a real cross-device move (`/dev/shm` vs temp dir, skipped when they share a device). Symlink tests are `cfg(unix)`: creating links on Windows CI needs a privilege.

## Design choices (user picked (a) for both, 2026-11-08)
- **Shredding a symlink**: (a) refuse with an error naming the target, or (b) remove the link only. Either way the target is never opened.
- **Copying links on Windows** without the symlink privilege (no Developer Mode / not admin): (a) the copy fails with an error naming the link, or (b) file links fall back to copying the target's contents (Explorer's behavior) and folder links fail.

## Behavior changes to know about
- A move onto an existing non-empty folder now fails instead of merging. The frontend has no merge UI that relied on it.
- Copy then Paste into the same folder now errors instead of emptying files. Making Paste pick a "name (copy)" destination is frontend work outside this task.

## Out of scope
- Windows junctions are recreated as directory symlinks (std can't create junctions).
- A partial copy is left behind if a copy fails midway (unchanged).
