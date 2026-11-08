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

## Status
- 2026-11-08: not started. `main` is merged in and the task section has been read. This session hit its usage limit before surveying the code. Next steps:
  1. read `copy_entry`, `copy_dir_recursive`, `move_entry` and the paste planner's Replace path (`transfer.ts`, `transferUi.ts`);
  2. write the plan here;
  3. implement and test.
