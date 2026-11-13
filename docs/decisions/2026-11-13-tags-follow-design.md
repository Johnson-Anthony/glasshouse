# tags-follow: how tags follow file operations

Date: 2026-11-13. Task 24 of `docs/plans/active/survey-2.md`. Code: `src/tags.ts` (store, wrappers, prunes), `src/tagMap.ts` (pure map functions).

## Context
Tags are a `{ path: labels[] }` map in the app config dir (`read_tags` / `write_tags`). Nothing touched the map when files changed, so a renamed or moved file lost its tags, the sidebar counted files that were gone, and a new file at an old path inherited that path's tags. App's state, the Tag Picker and Select by Tag each had their own copy.

## Decisions

**One store, in a module.** The map lives in `tags.ts`, like the undo stacks and `cmdState`, because undo entries and `transferDeps` change it from outside React. App reads it with `useTags()` and passes `setTags` as `setTagStore`, so `ctx.app` keeps its shape. Every change goes through `setTags`, which writes the file one write at a time (changes made during a write go out together in the next). Changes made before the first read finishes are applied to what the file held, so an early write can't replace the file with an empty map. The Tag Picker edits one path's labels and saves only that entry; Select by Tag reads `getTags()`.

**Rename and move carry the tags; so do their undo and redo.** `renamePath` and `movePath` call the backend, then move the keys of the item and everything under it. Keys already at or under the destination are dropped first: the backend refuses a taken destination, so whatever they were for is gone. They replace `renameEntry` / `moveEntry` at every rename (F2, the target menu, Rename from Clipboard, Bulk Rename), in `transferDeps.move` (paste, drag, Move to…, Auto-sort, extract), in Paste Special, and in the undo layer's file system, so undo and redo move the tags back and forth. Bulk Rename's swaps through temporary names work because each step moves the keys in order.

**A copy starts untagged.** Tags here are the app's notes about one item, not part of the file. A copy taking them would double the sidebar's counts on every Duplicate, and its undo would have to take them back. Finder copies tags because macOS stores them in the file's extended attributes; glasshouse doesn't, and Windows has nothing to follow.

**Delete and shred drop the tags** of the item and everything in it (`deletePath`, `droppingTags(shred)`).

**Move to Trash drops the tags, and a restore in the same run puts them back.** Keeping the tags on the trashed path would leave the sidebar counting items in the trash, would hand them to a new file at that path, and would be undone by the next prune anyway. So `trashPath` drops them and keeps what it dropped in memory, keyed by the trash record (original path and deletion-time window). `restoreTrashed` puts them back for each item it restored whose record matches, whether the restore is Undo of Move to Trash or Restore in the Trash view. Redo of Move to Trash drops them again, and undo of a Trash-view restore (which trashes again) does the same. The memory isn't saved: after a restart, a restored item comes back untagged. An item replaced by a paste or drop goes to the trash and loses its tags; undo of that paste leaves it in the trash, as before.

**Pruning, without a scan on render:**
- **After each listing of a tab's folder** (`useTabState`): tag keys under that folder whose first path component isn't in the listing are candidates. Each gets one `path_kind` stat, since a listing without hidden items leaves out a tagged hidden file, and it's dropped only if nothing is there. A listing that lacks nothing tagged costs nothing. This also catches a whole folder deleted outside the app, as soon as its parent is listed.
- **When the sidebar's TAGS group is shown** (the sidebar mounts with it open, or it's expanded): every tagged path gets one stat, a few at a time. A missing path is dropped only if its parent folder is still there, so a drive that isn't plugged in (Windows `E:\`, or a udisks mount under `/media`) or a share that can't be reached keeps its tags. A stat that fails ("unknown") never counts as gone.
- A prune that overlaps one of the app's own renames, moves, deletes or restores throws its result away (the stat may have seen the old name gone before the keys moved); the next listing tries again.
- Git → Discard moves untracked items to the trash in the backend, which reports only counts; their tags go at the refresh's listing.

## What can't be followed
Changes made outside the app can't be followed: a rename in another file manager, a `mv` in a terminal (including glasshouse's own terminal drawer) or a sync tool looks like a deletion plus an unrelated new file. The old path's tags are pruned at the next listing; they don't move to the new name. Following them would need a file identity (inode or file ID) stored with each tag and a scan to find it again.

Two cases go wrong:
- A file created outside the app at a tagged path before glasshouse lists that folder again inherits the old file's tags, because only the path is compared.
- An empty mount point (a static `fstab` mount whose drive is absent) looks like a folder whose contents were deleted, so listing it, or showing TAGS while its files are tagged directly inside it, drops those tags.

## Not done
- Tags in several windows: each window loads the map once and writes its whole map, so two windows editing tags can undo each other's changes (this was already so).
- Tags aren't kept across a restart for items in the trash.
