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
- [x] Plan
- [ ] Ref count and NoCache
- [ ] Tests, platform-neutral
- [ ] Checks: build, test, check:wiring, clippy `-D warnings`, cargo test
- [ ] Decision record
- [ ] Handoff
