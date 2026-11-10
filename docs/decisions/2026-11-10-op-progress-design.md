# op-progress: progress and cancel for hash, copy and find

Date: 2026-11-10. Task: `op-progress`. This builds the sketch from `docs/plans/completed/async-commands.md`.

## Chosen
- **The frontend picks the op id**, and passes it to the command as an optional `opId` (`op_id` in Rust).
  - The command works through an `Op` from the `OpRegistry` managed state. The `Op` sends `op-progress {op_id, done, total}` at most every 100 ms and watches a cancel flag.
  - `cancel_op(op_id)` sets that flag. The op then fails with the plain string `"cancelled"`, which `isCancelled` in `opStore.ts` matches.
  - Without an id, an op is untracked and behaves exactly as before. That keeps every other caller, and `move_entry`'s internal copy, unchanged.
- **A cancel can arrive before its op.** The frontend can't know when an async command's body starts, so `cancel_op` for an unknown id records the cancel, and the op stops as soon as it starts. Records nobody claims are swept after 10 s, whenever the next op starts.
- **Units:** hash and copy count bytes, against a known total. Copy gets its total from a pre-walk using `symlink_metadata`; unreadable entries count as zero. Find counts entries visited, with no total.
- **Copy cancel leaves nothing behind:**
  - The single-file copy already removed its partial file on any error (no-clobber-fs). A cancel is just one more error on that path.
  - A cancelled folder copy removes the whole new folder. That's safe because `copy_entry` creates the top-level folder itself and refuses a taken name, so everything under it came from this copy.
  - A cancel during the size pre-walk stops before anything is created.
- **unix copy slices:** each file is copied as a loop of `io::copy` over 4 MiB `take()` slices, with a cancel check and a progress update between slices. std's Linux `io::copy` uses `copy_file_range` for `File` → `File`, and its specialization covers `Take` readers, so the kernel still does the copy. I couldn't confirm this with a syscall trace locally (no strace or rust-src). The copy tests check the output is correct either way.
- **Windows copy** keeps `CopyFileW`. It checks for a cancel before each file and reports progress after each one. `CopyFileW` cleans up after itself on failure, and a cancel never lands mid-file. Not built locally.
- **Search:** a cancel ORs into the walkers' existing early-stop flag. A cancelled search returns `"cancelled"`, not the matches found so far.

## UI
- **`runOp(label, work, unit)`** (`src/ops.ts`) shows one row in a bottom-left tray (`OpsTray`), with a bar (or a count) and a Cancel button.
  - One UI op can own several backend ids. The Inspector's SHA-256, MD5 and CRC-32 of one file are a single row, and Cancel stops all three.
  - An op appears only after 400 ms, so quick ones don't flash.
- **Paste and copy into a folder** go through `transferDeps.copy`, so each item is an op. `runTransfer` stops at a cancelled item and keeps the finished ones (and their undo entry). It reports "cancelled: N item(s) not copied".
- **The live find panel** doesn't use the tray, since it has its own busy state. It cancels the previous search whenever the query changes. That also fixes stale results landing over newer ones (it had no guard).
- **Tracked `findInFiles`/`findFileByName` calls reject** instead of resolving to `[]`, so a cancel isn't mistaken for "no matches". Untracked calls still swallow errors as before.

## Rejected
- **A JoinHandle or tokio `CancellationToken`.** The commands are sync bodies on Tauri's pool (see async-commands), so a plain `AtomicBool` checked in the loops is all that's needed.
- **Copy progress per file only, on unix.** A single large file, the main case for wanting a bar, would show nothing until it finished.
- **Leaving a cancelled folder copy's partial tree for the user to clean up.** A half-copied folder looks complete at a glance.
- **One op id shared by all three Inspector hashes.** The backend would see three ops claim one registry entry, and the first to finish would unregister the others' cancel. Separate ids under one UI op avoid that.

## Not covered
- `move_entry`'s cross-volume copy, archive create/extract, and `compress` send no progress yet. They can adopt `Op` the same way.
- **Replace then cancel:** if a paste chose "replace" and the copy is then cancelled, the old item stays in the Trash and the new one isn't there. That's the same as a failed copy today; undo restores it.
