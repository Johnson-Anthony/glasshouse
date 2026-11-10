# Copy and move refuse a taken target, with no replace mode

Date: 2026-11-10 · Task: `copy-move-no-clobber` · Picked by the task session (the lead said to check what the paste planner's Replace path needs, then choose and record), on the plan in `docs/plans/completed/copy-move-no-clobber.md`.

## Refuse by default, the same way no-clobber-fs did
- **Files:** `copy_file_no_clobber`.
  - Windows: `CopyFileW` with `bFailIfExists`, the same Win32 copy `fs::copy` uses, so attributes and timestamps behave as before.
  - Elsewhere: `File::create_new` + `io::copy` (`copy_file_range` on Linux), then the source's permission bits. A failed copy removes the file it created.
- **Folders:** `create_dir` instead of `create_dir_all`, so an existing folder is never merged into, and the same for each subfolder.
- **Symlinks:** unchanged. `symlink()` never replaces anything.
- **Moves:** `rename_no_replace`, the helper from no-clobber-fs (`renameat2(RENAME_NOREPLACE)` on Linux, `MoveFileExW` without `REPLACE_EXISTING` on Windows, check-then-rename elsewhere). Before, `fs::rename` replaced a file and, on Linux, an empty folder.
- **Cross-device moves:** the fallback goes through `copy_entry`, so it refuses too, and the source is only deleted after a successful copy.
- **Error message:** a taken top-level target gets the shared `"<name>" already exists in <folder>` error, which `isAlreadyExists` in `api.ts` recognizes. A failure deeper in a folder copy keeps its own message.

## No replace mode
The lead suggested an explicit replace mode for the paste planner's Replace choice. Checking every caller showed that nothing needs one:
- **The paste planner** (`transfer.ts` `runTransfer`, used by Paste, Paste as Copy (verify), drag and drop, Move to…, Duplicate and Screenshot Auto-sort) and **Paste Special** (`components.tsx`): Replace moves the existing item to the trash first, then copies or moves into the name that's now free.
- **Undo/redo** (`undoActions.ts`): checks with `ensureFree` that the target is free, and copies or moves only then.

So Replace never overwrites through the backend, and the old item stays recoverable from the trash. That's better than an in-place overwrite, which would lose it. A replace mode that no caller uses would be dead code, and it would invite a future caller to clobber without trashing. If something reappears at the name between the trash and the copy, the backend now refuses it and the item is reported as failed, rather than silently replacing what just appeared.

Rejected: making Replace an atomic overwrite in the backend (`fs::copy`, or `rename` with replace). The old item would be lost instead of trashed, and nothing else needs it.

## Not changed
- A copy that fails partway through a folder still leaves the partial copy, as before. Only a single file that fails mid-copy is removed.
- On Linux, a copied file gets the current time as its modified time. That's what `fs::copy` did there too; Windows keeps the source's time, as before.
