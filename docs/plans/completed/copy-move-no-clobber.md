# copy-move-no-clobber

Branch: `claude/bold-haibt-91d29a` (worktree `bold-haibt-91d29a`). Backlog entry: `## copy-move-no-clobber` in `survey-fixes.md`. Assigned by the lead on 2026-11-08; `main` `5ec205c` is merged in.

## Scope (from the lead)
- `copy_entry` and `move_entry` refuse an existing target by default, as no-clobber-fs did for `write_text`, `make_dir` and `rename_entry`:
  - files: `File::create_new` instead of `std::fs::copy` (which overwrites);
  - folders: `create_dir` for the top folder instead of merging into an existing one;
  - moves: `rename_no_replace`, from no-clobber-fs.
- An explicit replace mode for the paste planner's Replace choice. Today Replace trashes the old item first, so check what that path really needs.
- Check every frontend caller.
- Tests in `src-tauri/src/commands/fs_tests.rs` (test-coverage's helpers are in `commands/testing.rs`: `Scratch`, `put`, `read`, `s`, `tree`):
  - each command refuses an existing file and an existing folder;
  - replace mode still works;
  - the cross-device move fallback (copy then delete) refuses too.
- Checks: `pnpm build`, `pnpm test`, `pnpm check:wiring`, `RUSTFLAGS="-D warnings" cargo clippy --all-targets`, `cargo test`, at the 4-job cap.

## What I found
- **Every caller already refuses or frees the target before it copies or moves:**
  - `transferUi` `transferDeps` and Paste Special (`components.tsx`) go through `planTransfer`;
  - undo/redo (`undoActions` `realFs`) calls `ensureFree` first.
- **Replace never overwrites through the backend.** The planner's Replace step moves the existing item to the trash (`deps.trash` / `trashEntry`), then copies or moves into the name that's now free. So Replace needs **no backend replace mode**. With refuse-by-default, something that reappears between the trash and the copy is refused rather than overwritten, which is the safe outcome. Adding a mode that no caller uses would be dead code; this is recorded as a decision.
- **Rust:** `copy_entry` → `copy_symlink` (already refuses: `symlink()` never replaces), `copy_regular_file` (`fs::copy` overwrites), `copy_dir_recursive` (`create_dir_all` merges). `move_entry` → `fs::rename` (replaces a file or an empty folder), with a cross-device fallback to `copy_entry` plus `delete_entry`.

## Approach
1. **Files:** `copy_file_no_clobber`.
   - Windows: `CopyFileW(…, bFailIfExists = TRUE)`, the same Win32 copy `fs::copy` uses, so attributes and timestamps carry over as before.
   - Elsewhere: `create_new` + `io::copy` (std turns that into `copy_file_range` on Linux), then the source's permission bits. A failed copy removes the new file it created.
2. **Folders:** `create_dir` instead of `create_dir_all`, at the top and for every subfolder. `copy_entry` creates the top entry itself, so only a taken top-level name gets the standard `"x" already exists in <folder>` error (`no_clobber_err`). A failure deeper in the tree keeps its own message.
3. **Moves:** `rename_no_replace` (from no-clobber-fs) instead of `fs::rename`. The cross-device fallback goes through the now no-clobber `copy_entry`, so it refuses too and the source is never deleted.
4. **Frontend:** no change needed. All callers already go through the planner or `ensureFree`, and they already show a backend refusal as a failed item.

## For review
- **No replace mode.** Every caller frees the name before it copies or moves. Replace moves the old item to the trash, and undo runs `ensureFree`. An unused overwrite mode would be dead code. See `docs/decisions/2026-11-10-copy-move-no-clobber-no-replace-mode.md`.
- **Not compiled locally:** the `cfg(windows)` `copy_file_no_clobber` (`CopyFileW` with `bFailIfExists`). Its first compile is the Windows CI job, where the new refusal tests run against it.
- **Behavior change:** moving a folder onto an existing *empty* folder now fails. On Linux, `fs::rename` used to replace the empty folder.

## Status
Done 2026-11-10. `main` `dff95f7` merged in, then miller-names before the final checks.
- **`commands.rs`:**
  - `copy_entry` creates the top entry itself (`create_dir`, no-clobber file copy, or symlink), and only that gets `no_clobber_err`;
  - `copy_dir_recursive` / `copy_dir_contents` use `create_dir`;
  - `copy_regular_file` → `copy_file_no_clobber` (`CopyFileW` on Windows; `create_new` + `io::copy` + permission bits elsewhere);
  - `move_entry` → `rename_no_replace`, with the cross-device fallback through the no-clobber `copy_entry`.
- **Tests:** 7 new in `commands/fs_tests.rs`:
  - file, folder and symlink targets refused, with no merge;
  - move refuses a file, an empty folder and a non-empty folder;
  - the Replace flow (free the name, then copy or move) works;
  - permission bits are kept;
  - the cross-device fallback refuses, and that test actually ran here (`/dev/shm` is a separate tmpfs).
- **Mutation check:** going back to `fs::copy`, `create_dir_all` or `fs::rename` fails 4 of the new tests.
- **Checks:** `pnpm build` ok · `pnpm test` 231 passed · `pnpm check:wiring` 0 unwired / 0 unsent · clippy (`-D warnings`) clean · `cargo test` 118 passed, 1 ignored (the existing child-process trash test).
