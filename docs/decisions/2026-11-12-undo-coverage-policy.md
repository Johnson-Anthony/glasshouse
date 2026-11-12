# What every change does to the undo history

Date: 2026-11-12 · Task: `undo-coverage` (second survey, task 11)

Many commands changed files without touching the undo history. Ctrl+Z after any of them undid whatever older step was on top: Shred a file, press Ctrl+Z, and a rename from ten minutes ago is reversed.

## Decision
**Every command that changes files, permissions or git does one of two things.** It pushes an undo entry, or it calls `markIrreversible(label)` (`src/state.ts`). The full list is the coverage table in `docs/plans/completed/undo-coverage.md`.

**`markIrreversible` clears both stacks and leaves a stop entry.** The next Ctrl+Z shows "can't undo <label>, or anything before it" (an `irreversible` outcome, shown as a warning toast) and runs nothing. After that there's nothing to undo. Entries pushed later undo as usual, down to the stop.
- **Rejected: a stop that keeps the older history behind it.** Ctrl+Z would explain once and then carry on with older steps. Every builder checks before it changes anything, so that would be safe. But an older step is exactly what the user didn't mean to undo, and the backlog asked for the history to be cleared.
- **Rejected: clearing with no stop.** Ctrl+Z would then say "nothing to undo", which looks like a bug right after a change.

**Marked irreversible:**
- **Delete Permanently and Shred:** nothing is left to restore. Both mark even when they fail partway, because some items may already be gone or overwritten.
- **Every git command that changes something:** Stage, Unstage, Discard, Commit, Amend, Pull, Push, Fetch All, Stash, Clean, Checkout, New Branch, Merge and Rebase. Read-only ones (Status, Log, Blame) leave the history alone.
  - Undoing these from the app would mean reimplementing git. Unstage for Stage, for example, loses a partial staging that was there before.
  - A failed command marks too. A merge that stops on conflicts has still changed files.
- **Batch Permissions and Change Owner:** the frontend can't read the old mode or owner (`FileEntry` and `FileStatExt` don't carry them). Task 6 (inspector-perms) can add the mode, and then an undo.
- **Run Script on Selection and Custom Command:** the app can't know what a script changed. They mark even when the script fails. One cost is that a read-only script clears the history too. Treating scripts like the terminal (outside the history, not clearing it) was rejected, because then Ctrl+Z right after a renaming script undoes an older app step.
- **A Bulk Rename whose rollback also failed:** some renames stuck and there's no entry for them.
- **Export Layout over a `.glasshouserc` that didn't read back whole** (cut off at the read limit, or not UTF-8): the old text can't be restored exactly.

## New undo entries
**`madeUndo` (`src/undoActions.ts`)** covers things a command made where nothing was before: links (Create Symlink, the Paste as Symlink / Hard Link / Shortcut family), archives (every Compress command), extracted entries, and a Python module folder.
- Undo deletes them only if their fingerprint still matches. This is the size-and-mtime check copies already had. `copyUndo` is now `madeUndo` with a copy as the remake.
- Redo checks that the paths are free, then makes them again. For an archive, that means compressing the current sources again.
- **Hard links:** undo also needs the original to still be there. Without that check, deleting the link could delete the last name the data has.
- **Links are deleted, never followed:** `delete_entry` looks at the path with `symlink_metadata`.

**Extract:** archive-safety's extraction didn't push an entry either.
- **Undo deletes what landed** in the destination. When Extract to Folder made the folder, undo deletes that whole folder instead.
- **Whether the folder is new** comes from a fresh listing of the current folder, hidden entries included. If that check fails, the folder counts as already there, so undo never deletes a folder that may hold older files.
- **The fingerprint is taken after the staging folder is discarded.** Otherwise the staging folder would be in the fingerprint, and every undo would refuse.
- **Redo extracts again** into a new staging folder and moves the same top-level entries in under the names they got the first time, so the conflict question isn't asked again.
- Entries that replaced something stay replaced, as with Paste: the old ones are in the trash.
- **Extract to Folder** also no longer leaves an empty new folder behind when it's cancelled or nothing landed.

**Bulk Rename:**
- **The rollback loop** moved into `runRenameSteps` (`src/names.ts`). Undo and redo use it too.
- **Checking a whole sequence:** the plan's steps can chain (`2→3`, then `1→2`) or swap through `name~rename`. `ensureFree` checks every destination against the current listing, so it would refuse a swap. `renameStepsProblem` walks the steps over the folder listings instead, so a name an earlier step frees counts as free. Undo and redo run it before renaming anything, so a name taken since refuses the whole step.

**Smaller ones:**
- **From Template:** `createUndo` for the file.
- **Paste Text into Filename:** `moveUndo`, as for Rename.
- **Paste Special:** the same copy or move entry as Paste. It's pushed by the dialog, which isn't unit-tested (no DOM in the test setup).
- **Export Layout** used to overwrite an existing `.glasshouserc` silently. It now asks first. Its undo deletes a new file (`createUndo`), or writes the old text back (`contentUndo`) if the file still holds what the export wrote.
- **`contentUndo` is also the hook for task 7.** Find & Replace can push one per file.

## Screenshot Auto-sort
- **The over-report:** a month whose conflict question was cancelled was skipped silently, and the alert still said "moved N" for the rest. The alert now gives what was moved, skipped and failed, how many were left in place without a date, and "cancelled with N not sorted".
- **Cancel now stops the sort.** The months before it stay sorted. Before, the sort went on to the next month and could ask again. Cancel stops the whole operation everywhere else (Paste, Extract).
- **One undo entry covers every month** (`groupUndo`): it moves the screenshots back and removes the month folders the sort made. A month folder that something else has been put in since is left in place (`emptyFolderUndo`).

## Left to other tasks
- **Find & Replace:** task 7 rewrites it (and can use `contentUndo`).
- **Move to Trash:** task 12 adds restore.
- **The Inspector's chmod:** task 6. Until then it changes permissions without marking the history.
