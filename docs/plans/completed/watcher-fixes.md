# watcher-fixes

Branch: `claude/cool-gauss-d234ca` (worktree `cool-gauss-d234ca`), started 2026-11-12 from `main` (`f27bcca`).
Backlog entry: section 9 of `docs/plans/active/survey-2.md`.

## Problems
1. **Two tabs share one watch.** Each tab's folder effect (`src/state.ts`) calls `watch_dir` on entry and `unwatch_dir` on leaving. The backend (`watcher.rs`) keeps a set of watched folders, so with two tabs on one folder the first to leave drops the only registration. The other tab stops getting `fs-changed` and falls back to its 30 s refetch.
2. **`watch_dir` stats every entry on the main thread.**
   - `new_debouncer` uses `RecommendedCache`, which is `FileIdMap` on Windows and macOS (`NoCache` on Linux already).
   - `Debouncer::watch` → `add_root` → `FileIdMap::add_path` walks the folder and reads each entry's file ID. On Windows that opens every file.
   - `watch_dir` is a sync command, kept that way by async-commands so a watch/unwatch pair can't swap. So a 50k-entry or SMB folder froze the UI.
   - The cache is also refilled on every Create and Modify event, on notify's event thread.
3. **The watcher tests are unix-only** (`#![cfg(unix)]` in `watcher/tests.rs`). The Windows backend is never exercised.

## Approach
- **Count registrations.** `watched` becomes `HashMap<PathBuf, Registration { count, active }>`.
  - `watch` adds one to the count, whether the OS watch succeeds or not, because the frontend always unwatches what it watched. It sets the OS watch only when it isn't set yet; a failed one is retried by the next `watch`.
  - `unwatch` takes one off. At zero it drops the entry, and the OS watch if one was set. An unmatched `unwatch` does nothing.
  - `unwatch` now holds the registrations lock while it removes the OS watch, as `watch` does while it sets one (same lock order).
- **No file-ID cache.** `new_debouncer_opt::<_, RecommendedWatcher, NoCache>`.
  - In the vendored notify-debouncer-full 0.4.0, the cache is read in one place only: `handle_rename_to`'s `file_ids_match`, which stitches a rename's halves when the backend gives no tracker (Windows gives none).
  - Our callback reports the parent folder of each event path, and both halves name their own folder, so the reported folders don't change.
- **Tests on every platform.** Drop the `cfg(unix)`; every test there is platform-neutral.

## Tests
- Two watchers on one folder: one unwatch keeps reports coming, the second stops them.
- A failed watch counts: a later watch retries the OS watch, and the failed call's unwatch doesn't drop the second watcher's watch.
- A failed watch alone unwatches to nothing; an extra unwatch doesn't take a later watch.
- A move between two watched folders reports both, and a rename in one folder reports it. On Windows, with no cache, this goes through the unstitched path.

## Status
**Done** (2026-11-12).
- [x] Plan
- [x] Ref count and NoCache
- [x] Tests, platform-neutral
- [x] Checks: build, test (462 passed, 3 skipped), check:wiring (0 issues), notices --check (up to date), clippy `-D warnings`, cargo test (179 passed, 2 ignored, three runs, under a 4G memory cap), site:build (demo unchanged), site:capture check (all pass)
- [x] Decision record `docs/decisions/2026-11-12-watcher-fixes-design.md`
- [x] Handoff

## Results
- **Tests** (`src-tauri/src/watcher/tests.rs`, 9 in all, now on every platform):
  - `two_watchers_share_a_folder_until_both_leave`;
  - `a_failed_watch_counts_and_the_next_one_retries`;
  - `a_failed_watch_alone_unwatches_cleanly`;
  - `an_extra_unwatch_does_not_take_a_later_watch`;
  - `a_move_between_watched_folders_reports_both` and `a_rename_inside_a_folder_reports_it`.

  The four that were already there are kept: a new file, a failed watch retried (rewritten for the count), unwatch, and subfolders.
- **Negative check:** with `unwatch` dropping the count at once, as before, `two_watchers_share_a_folder_until_both_leave` fails.
- **A race in the new test, fixed:** one write can be reported twice, because its create and its close-write can expire in different debouncer ticks. The second report from the first file landed in the next "nothing arrives" check, and the test failed once under the full parallel run. `settle` waits until the reports stop before that check.
- **Not compiled or run:** the Windows backend. The windows-latest CI job is the first run of these tests on Windows and of `NoCache` with ReadDirectoryChangesW. Nothing in the change is `cfg`-gated, so it compiles the same everywhere.
- **Docs:** `docs/ARCHITECTURE.md`'s listing-and-refresh section says the backend counts registrations per folder.

## For review
- **A failed watch counts.** Its unwatch then matches it, so a tab whose watch failed can't take away another tab's watch on the same folder. The next watch retries the OS watch.
- **`watch_dir` stays sync.** With no cache it's one OS call.
- **Rename stitching is gone on Windows and macOS.** It was already off on Linux, and the folders reported are the same.
