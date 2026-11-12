# watcher-fixes: shared watches and no file-ID cache

Date: 2026-11-12. Task: `watcher-fixes` (section 9 of `docs/plans/active/survey-2.md`).

## Chosen
- **A count per folder.**
  - `WatcherState.watched` maps each folder to the number of `watch_dir` calls no `unwatch_dir` has matched yet, plus whether its OS watch is set.
  - The OS watch is set by the first call and removed when the count reaches zero, so two tabs on one folder share it until both leave.
- **A failed watch still counts.** The frontend's folder effect (`src/state.ts`) unwatches on cleanup whether its watch worked or not.
  - If failures weren't counted, a tab whose watch failed (the folder didn't exist yet) would, on leaving, take away the watch a second tab set after the folder appeared.
  - The next `watch_dir` retries an unset OS watch. That keeps the earlier fix: a failed watch is no longer recorded as watched forever.
- **An unmatched `unwatch_dir` does nothing**, so the count can't go below zero and an extra call can't take a later tab's watch.
- **One lock order.** Both commands take the registrations lock, then the debouncer lock, and hold the first until the OS watch is set or removed. They're sync commands on the main thread, so they're already serialized; the order keeps that safe if one ever moves off it.
- **`NoCache`.** The debouncer is built with `new_debouncer_opt::<_, RecommendedWatcher, NoCache>`. notify-debouncer-full 0.4.0's default `RecommendedCache` is:
  - `NoCache` on Linux, so nothing changes there;
  - `FileIdMap` on Windows and macOS. It walks the folder in `watch` and reads every entry's file ID, opening each file on Windows. It does the same for each created or modified path on notify's event thread.

  The source shows one reader of the cache, `handle_rename_to`'s `file_ids_match`. It joins a rename's two halves into one event when the backend gives no tracker, and Windows' backend gives none. Our callback reports the folder of every event path, and each half names its own folder, so the folders reported are the same either way.
- **Tests on Windows.** `watcher/tests.rs` loses its `cfg(unix)`. Every test is platform-neutral, and the two rename tests are the ones that go through the unstitched path on Windows.

## Rejected
- **Making `watch_dir` async.** With no cache it's one `inotify_add_watch`, or a `CreateFileW` plus `ReadDirectoryChangesW` on Windows. async-commands kept it sync so a watch/unwatch pair can't run out of order.
- **Normalizing paths before counting.** Tabs pass the paths their listings use. Folding case or trailing separators would need per-platform rules, and the inotify watch is per inode anyway.

## Not covered
- **Two spellings of one folder** (`/a` and `/a/`, or different case on Windows) are counted apart. On Linux, inotify gives both the same watch descriptor, so unwatching one spelling ends the other's watch. The frontend's paths come from listings, so this isn't expected.
- **Dropped events:** when the backend reports a rescan (inotify queue overflow), the event names no path, so no folder is reported. The 30 s refetch in `state.ts` covers it. Reporting every watched folder on a rescan would be a small follow-up.
- **A folder deleted and recreated** while watched keeps its dead registration until every tab leaves it. This was the same before.
- **Windows:** the tests' first run is the windows-latest CI job.
