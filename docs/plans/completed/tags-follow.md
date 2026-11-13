# tags-follow

Branch: `claude/festive-leakey-a10edf` (worktree `festive-leakey-a10edf`), started 2026-11-13 from `main` (`7a4d8bd`).
Backlog entry: section 24 of `docs/plans/active/survey-2.md`. Frontend only.

## Status
**Done** 2026-11-13. Commits: `93b3d2a` (the change), `9dc80ba` (demo rebuild).
- Everything in the approach below is in. Also found while doing it: Shred deletes too, so it drops the file's tags (`droppingTags(shred)`); Git → Discard's trashed items lose theirs at the refresh's listing (the backend reports only counts).
- Checks: `pnpm build`; `pnpm test` 756 passed, 3 skipped (57 files; 41 new tests); `pnpm check:wiring` clean (315 sent labels, 212 cases); `pnpm site:build` (reproducible); `pnpm site:capture check` 24/24 under a 3 GB cap. In the site demo (browser pane): F2 rename of a tagged file keeps its tag under the new name, Ctrl+Z takes it back; Move to Trash takes the count to 0 and Ctrl+Z brings the item and its tag back.
- Not checked: the desktop app itself (WebKitGTK) and Windows; the Windows path rules are covered by unit tests only.
- Not done (possible follow-ups): tags for items in the trash aren't kept across a restart; two windows editing tags can still overwrite each other (each writes its whole map); a file created outside the app at a tagged path inherits the tags (only paths are compared).

## Problems
1. Tags are a `{ path: labels[] }` map keyed by path. Rename, move, transfer, trash and delete never touch it, so a renamed or moved file loses its tags, the sidebar's counts include files that are gone, and a new file at an old path inherits that path's tags.
2. Nothing removes entries whose paths are gone.
3. Three copies of the map: App's `tagStore` state, `TagPicker` (reads the file on open, then writes its whole snapshot back, so it can undo a change made meanwhile) and `Select by Tag →` (reads the file each time). The tag handlers write the file from inside a React state updater.

## Approach
**One store (`src/tags.ts`, new):** the map lives in a module, like the undo stacks and `cmdState`, so code outside React (undo entries, `transferDeps`) can change it.
- `loadTags()` reads the file once at start; `getTags()`, `setTags(next | prev => next)`, `useTags()` (`useSyncExternalStore`).
- `setTags` writes the file, one write at a time, coalescing changes made while a write is in flight, and only when the map changed. Changes made before the load finished are applied to the loaded map, so an early write can't replace the file with an empty map.
- App's `tagStore` / `setTagStore` become `useTags()` / `setTags`, so `ctx.app` and the handlers keep their shape. `removeTagPrompt` and `clearAllTags` stop writing the file themselves.
- `TagPicker` edits a draft of one path's labels and saves only that path's entry. `Select by Tag →` reads `getTags()`.

**Pure map helpers (`src/tagMap.ts`, new), platform rules from `pathOps(windows)`:**
- `moveTagKeys(map, src, dst)`: `src` and every key under it are re-keyed to `dst`; stale keys at or under `dst` go first (the backend refuses a taken destination, so anything recorded there is gone). Handles a case-only rename on Windows. Returns the same map when nothing changes.
- `dropTagKeys(map, paths)`: removes each path and everything under it, and returns what it removed.
- `putTagKeys(map, add)`: merges labels back (restore).
- `goneCandidates(map, dir, names)`: the children of a listed folder that some tag key goes through but the listing doesn't have.

**Following file operations (tag-aware wrappers in `tags.ts`):** `renamePath`, `movePath`, `deletePath`, `trashPath`, `restoreTrashed`: the backend call, then the store change. Call sites swap to them:
- rename: F2 (`fileOps.ts`), the target menu's Rename (`target.ts`), Rename from Clipboard (`misc.ts`), Bulk Rename's `renameOne` (App);
- move: `transferDeps.move` (so every `runTransfer` move: paste, drag, Move to…, Auto-sort, extract), Paste Special's `moveEntry` (App);
- trash: `trashPaths` (`fileOps.ts`), `transferDeps.trash` and Paste Special's replace (App);
- delete: Delete Permanently and the no-Recycle-Bin branch of `trashPaths`;
- undo: `undoActions.ts`'s `realFs` (`rename`, `move`, `remove`) and `realTrash` (`trash`, `restore`), so undo and redo of renames, moves, bulk renames, copies and the trash move the tags back and forth; the Trash view's Restore uses `restoreTrashed`.

**Decisions (to record in `docs/decisions/2026-11-13-tags-follow-design.md`):**
- **Copy:** a copy starts untagged. Undo of a copy then has no tags to take back, and Duplicate doesn't double the sidebar counts.
- **Trash:** Move to Trash drops the item's tags (so counts are right and a new file at that path starts clean). The app keeps what it dropped in memory, keyed by the trash record (original path and deletion time), and a restore during the same run (Undo, or Restore in the Trash view) puts them back. After a restart, a restored item comes back untagged. Redo of Move to Trash drops them again.
- **Prune:** no scan on render.
  - After each listing of a tab's folder: tag keys under that folder whose first component isn't in the listing are candidates; each is checked with one `path_kind` stat (a hidden item missing from the listing is still there) and dropped if nothing is there. A listing that finds nothing missing costs nothing.
  - When the sidebar's TAGS group is shown (mount, or expanded): every tagged path gets one stat; a missing path is dropped only if its parent folder is still there, so an unplugged drive or an unreachable share keeps its tags.
  - A prune that overlaps a rename or move in the app throws its result away (the stat may have seen the old name gone before the tags moved); the next listing tries again.
- **Outside changes can't be followed:** a rename in another file manager looks like a deletion and an unrelated new file. Its tags are pruned; a new file created outside the app at a tagged path before glasshouse lists the folder again inherits them. An empty mount point (a static fstab mount with the drive absent) looks like a folder whose contents were deleted.

## Tests
- `tagMap.test.ts`: move (file, folder subtree, stale destination, swap through a temp name, Windows case-only and case-insensitive keys, sibling prefixes like `a` vs `ab`), drop, put, goneCandidates (POSIX root, Windows drive root, hidden names).
- `tags.test.ts`: store load/write coalescing, early changes, wrappers (rename follows, failure doesn't, trash drops and restore puts back, keyed by deletion time), prune on listing and on open (parent-missing keeps, race discards).
- `undoActions.test.ts`: undo/redo of a move and a bulk rename swap carry the tags; trash undo/redo.
- `selection.test.ts`: Select by Tag reads the store.
- DOM test for `TagPicker`: saves only its path, against the store.

## Checks
`pnpm build`, `pnpm test`, `pnpm check:wiring`, `pnpm site:build`, `pnpm site:capture check` (3 GB cap).
