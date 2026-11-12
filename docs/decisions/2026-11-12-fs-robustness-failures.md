# What a failed copy, move or delete leaves behind, and special files

Date: 2026-11-12 · Task: `fs-robustness` (survey-2 §8, plus two archive-safety follow-ups) · Picked by the task session; the lead delegated the choices.

## A failed copy removes what it made
`copy_path` removes the new folder after any failure, not just a cancel. That's safe: `create_dir` refused a taken name, so everything under it is from this copy. The cleanup (`remove_created_tree`) first makes the copy's folders owner-writable, because the copy now keeps folder modes and a copied 0555 folder would otherwise keep its contents. It doesn't follow links. Errors from inside a folder name the entry: `can't copy /src/sub/pipe: a named pipe, not a regular file`.

A single file was already removed on failure on unix. On Windows a failed `CopyFileW` is left to CopyFileW: with fail-if-exists, some errors mean the target was already there and isn't ours, so the app doesn't delete after one.

## A cross-volume move whose delete fails
A move between volumes is copy, then delete. The copy cleans up after itself, so a failed copy leaves the source as it was. When the copy worked but the delete fails:
- **File:** the delete is all or nothing, so the source is intact. The copy is removed and the move fails cleanly: `can't remove … after copying it, so it wasn't moved: …`.
- **Folder:** `remove_dir_all` may have removed part of the source by then, so the copy is the only complete one. It stays, and the error says `copied to <to>, but some of the original couldn't be removed from <from>: …`. Every file is still whole in the destination; what's left at the source is duplicates.

Rejected:
- **Removing the copy in the folder case too,** as the survey's "on any error, remove the destination" reads. That could lose data: half the source is already gone.
- **Moving file by file** (copy one, delete one), as Explorer does. A failure then leaves the tree split between two places, with nothing complete anywhere.
- **Checking first that the whole source can be deleted.** That's racy and can't be complete (open files on Windows, immutable flags), and it doubles the walk.

## Delete Permanently deletes folders whole, and both deletes keep going
- Delete Permanently now deletes folders with everything in them (`deleteEntry(p, true)`). Before, it refused any non-empty folder. When the selection has a folder, the confirm says so: `Permanently delete 1 folder and everything in it?` or `…, including 2 folder(s) and everything in them?`. A link to a folder isn't counted, because the backend removes the link, not what it points to.
- Delete Permanently and Move to Trash carry on past a failed item. They always refresh, and then list what failed (up to five lines, `name: error`) in an alert titled `couldn't delete 1 of 3 item(s)` or `couldn't move 2 of 3 item(s) to the Trash`. A right-clicked Move to Trash refreshes after a failure too.
- Within one folder, a permanent delete still stops at the first entry it can't remove (std's `remove_dir_all`). It doesn't delete what it can around it, as `rm -rf` does. The failure is reported, and stopping deletes less.

## Special files are refused before they're read
Opening a FIFO waits for a writer, and reading a device can go on forever. Either hangs the command's worker thread, and about ten of those stall every async command. `open_regular` is now the only way the readers open a file: preview text and images, the hex dump, hashing, diff and blame reads, zip compression and the copy loop. It:
- stats the path first, so a device is never opened at all;
- opens with `O_NONBLOCK`, so a FIFO swapped in after the stat doesn't block the open;
- checks the open file again, then clears `O_NONBLOCK`.

The error says what the file is: `a named pipe`, `a socket`, `a device` or `a folder`, then `, not a regular file`.
- Zip compression leaves such entries out and lists them, as it does links. `tar -c` stores a FIFO as a FIFO, and 7-Zip stores it as an empty file; neither blocks, so they're unchanged.
- Extraction refuses an "archive" that isn't a regular file before any tool runs.

## Times and modes on copies
- On unix a copied file keeps its access and modification times, read before the copy reads it.
- A copied folder keeps its mode and modification time, set once its contents are in, so a 0555 folder still gets its files. A folder's access time isn't kept: adding up the copy's size has already read every folder.
- Times are best effort, because a file system that can't store them should still get the copy. Folder modes fail the copy, as file modes already did.
- Windows is unchanged. CopyFileW already keeps file times, and Explorer keeps neither the times nor the attributes of folders.

## Extraction: links checked for every format, staged folders made writable
After any extraction, `tidy_staging` walks the staging folder without following links:
- A link whose target leaves the staging folder, by zip's rule (`link_stays_inside`), is removed and reported. GNU tar extracts absolute and `../..` links as they are. 7-Zip 25 refuses a climbing link and fails the extraction, and it points an absolute one into its output folder by an absolute path, which this also removes.
- Every folder is made owner-writable (`| 0o700`), as zip extraction already did. Linux needs write permission on a folder to move it to another parent, so a 0555 folder from a tar couldn't be moved out of staging.
- Anything the walk can't check or remove fails the extraction, which then removes the staging folder.

## Config writes
`write_config_atomic` syncs the temp file before the rename, then (on unix, best effort) the folder, so the rename is on disk too. Without the first sync, a power cut could leave the rename on disk ahead of the data and an empty pins or tags file. A failed write removes the temp file and leaves the old config in place.
