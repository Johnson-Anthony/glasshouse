# trash-restore: undo for Move to Trash, a Trash dialog, and drives with no Recycle Bin

Date: 2026-11-13. Task: `trash-restore` (section 12 of `docs/plans/active/survey-2.md`).

## Finding an item again
**Chosen: original path plus a deletion-time window.**
- `move_to_trash` (via `trash_path` in `commands/trash.rs`) returns `{original, from, to}`:
  - `original` is the path as the trash records it: the parent canonicalized the way the trash crate does it before deleting, plus the name;
  - `from` and `to` are the clock in whole seconds just before and just after the delete.
- Restore and purge match an item by that path and a deletion time in the window, with one second of slack each side. Exactly one item must match:
  - none means "isn't in the trash any more";
  - several means "more than one item in the trash matches it" (the same path trashed twice within a second or two).
- **Rejected: the crate's id alone.** On Linux it's the `.trashinfo` path, which is built from the name and reused once that item has left the trash. A later trashing of the same name would get the earlier item's id.
- **Rejected: listing the trash right after each delete to get the id.** Listing reads every trash on every mount (Linux) or enumerates the whole Recycle Bin (Windows), and Move to Trash would pay for that on every use.
- **The Trash view's keys** add the id, with a window of exactly the listed second, so a row names that item.

## Undo and redo
- **`trashUndo`:**
  - Undo restores all the items or none: `trash_restore(keys, all_or_nothing = true)` checks every key first. It refuses when an item has left the trash, when its name is taken at the original path, or when two items would go back to the same path.
  - Redo trashes the paths again, after checking they're all still there. Its new records replace the old ones, so the next undo finds the new items, not the ones the last undo already took out.
- **`restoreUndo` (Restore in the Trash view):** the same two directions the other way round. Undo trashes the restored paths again; redo restores the items that trashing made.
- **Empty Trash and Delete Permanently** in the view call `markIrreversible`.
- **Paste's Replace** still trashes the replaced item without an undo entry (unchanged; the undo-coverage policy says so).

## The Trash dialog
- **A dialog, not a folder in the pane.** Trashed items aren't a folder on Windows, and on Linux they're spread over a trash per drive. A virtual folder would need every pane command to understand rows that aren't paths.
- **What it shows:** name, original folder, deleted time and size (a file's bytes, a folder's entry count), newest first, with a multi-select.
- **Restore:** puts items back at their original path only. The crate can't restore under another name, so there's no "keep both". A taken name is refused with what's in the way, and the rest of the selection is restored. On Linux the crate recreates a missing original folder; on Windows that item fails with the system's error.
- **Go → Trash opens the dialog on both platforms.** On Linux it used to browse `~/.local/share/Trash/files`, which showed neither origins nor trashes on other drives. An "open the trash folder" link keeps that.

## Panics in the trash crate
- The crate's freedesktop `metadata` and `restore_all` `assert!` that the trashed file exists, and the release profile has `panic = "abort"`. So a `.trashinfo` whose file was removed by hand would take the whole app down.
- Every item is checked first (`file_missing`). Such an item shows no size, can't be restored ("its file is missing from the trash folder"), and Delete Permanently removes its `.trashinfo`.

## Drives with no Recycle Bin (Windows)
**What the crate does** (5.2.5, `src/windows.rs`):
- It deletes with `IFileOperation` and `FOF_NO_UI | FOF_ALLOWUNDO | FOF_WANTNUKEWARNING`.
- `FOF_NO_UI` includes `FOF_NOCONFIRMATION`. So the warning that `FOF_WANTNUKEWARNING` asks for, "this item will be deleted permanently", is answered yes without being shown, and the item is deleted for good.

**Chosen:**
- `trash_unsupported` classifies each path with `GetVolumePathNameW` and `GetDriveTypeW`. Only `DRIVE_FIXED` has a Recycle Bin. Network, removable, CD and RAM drives don't, and an unknown type, or a path whose volume can't be found, counts as having none.
- **Move to Trash asks first** when the selection has any such path. The question lists them with why, and offers "delete permanently" or Cancel. Cancel does nothing at all, not even the rest of the selection.
- **`trash_path` refuses those paths too,** so any other caller fails rather than deleting for good:
  - git's Discard reports the item as left alone;
  - Paste's Replace fails for that item.
- The Windows code is in `commands/recycle_bin.rs`, which uses only std and `windows`. It was type-checked here with clippy for `x86_64-pc-windows-msvc` in a scratch crate, as was `trash.rs` with its Tauri attributes stripped. Neither has run on Windows.

## Not covered
- **A full Recycle Bin, or one turned off** ("Don't move files to the Recycle Bin") on a fixed drive also deletes for good, and isn't detected.
- **Daylight saving:** on Linux the crate reads the stored local time back with `earliest()`. In the repeated hour after the clocks go back, a deletion time can come back an hour early, and undo then says the item isn't in the trash. The Trash view still finds it.
- **COM:** the crate panics (and so aborts) if a thread's COM apartment was already set to multithreaded. Nothing in glasshouse calls `CoInitializeEx`, so this isn't expected.
- **macOS:** the crate has no list or restore there. Undo and the dialog report that.
