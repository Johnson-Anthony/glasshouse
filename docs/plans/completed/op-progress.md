# op-progress

Branch: `claude/cool-gauss-d234ca` (worktree `cool-gauss-d234ca`), reset to `main` `bdd0682` on 2026-11-10 after the history rewrite.
Backlog entry: `## op-progress` in `docs/plans/active/survey-fixes.md`. The original sketch is in `docs/plans/completed/async-commands.md`.

## Goal
Hashing, copying and finding can take minutes. Today they show no progress and can't be stopped. Give them progress events, a cancel, and a small UI. A cancelled copy must leave nothing half-written.

## Backend
- **New module `src-tauri/src/ops.rs`:**
  - `OpRegistry`, managed state: op id → `Arc<AtomicBool>`.
  - `Op`, the handle a long command works through. It is `Sync`, so the parallel search walkers can share it. Methods:
    - `check()`: `Err("cancelled")` once cancelled;
    - `set_total(n)`;
    - `advance(n)`: emits `op-progress {op_id, done, total}`, at most every 100 ms;
    - `Drop`: unregisters the op.
  - `Op::untracked()` is used when a caller passes no id, or for internal calls. It sends no events and can't be cancelled.
  - `cancel_op(op_id)` is a sync command. If the id isn't running yet, it records the cancel so the op stops as soon as it starts. Records like that are dropped after 10 s if no op claims them.
- **Commands** get `op_id: Option<String>` plus `AppHandle`/`State`. Existing callers that pass no id behave as before. The work moves into inner functions that take `&Op`.
  - **hash** (`read_chunks`): total = file size; check and advance per 64 KB chunk.
  - **copy** (`copy_entry`, folder trees included):
    - A pre-walk (`symlink_metadata`, links not followed) sums the regular files' sizes for the total.
    - unix: the file copy becomes a loop of `io::copy` over 4 MiB `take()` slices. That's still `copy_file_range`, with a check and an advance between slices. A cancel goes through the existing "remove the partial file on error" path.
    - Windows: `CopyFileW` is unchanged; there's a check before each file and an advance after it. Not built locally.
    - A cancelled **folder** copy removes the whole new folder. Safe: `copy_entry` created that top-level folder itself, refusing a taken name, so everything under it came from this copy.
    - `move_entry`'s cross-volume fallback calls the inner copy untracked, so moves don't change.
  - **find** (`find_in_files`, `find_file_by_name`): a cancel ORs into the walkers' existing early-stop flag. Progress is files visited, with no total.
- `cancel_op` goes in `permissions/app.toml` (`files-read`: it can only stop an op that's already running).

## Frontend
- **New `src/ops.ts`:**
  - `runOp(label, work)` runs `work(track)`, where each `track()` returns a new backend op id belonging to this UI op.
  - It keeps a small store of running UI ops. The progress shown is the sum over the UI op's ids, and Cancel cancels them all.
  - It listens for `op-progress` once.
  - `isCancelled(err)` recognizes the cancel error.
- **New `src/OpsTray.tsx`**, mounted once in `App.tsx`. It lists ops that have run for more than 400 ms (so quick ones don't flash), with their label, a bar or a count, and a Cancel button. Its styles go in `app.css`.
- **Call sites:**
  - **copy:** `transferDeps.copy`, which every paste or copy into a folder uses, runs as an op. `runTransfer` stops at a cancelled item, marks the result `cancelled`, and keeps what's already done so undo still works. The toast then says it was cancelled. PasteSpecial's direct copy is tracked too.
  - **hash:** the Inspector's three checksums run as one op, as do Checksum (SHA-256 of the selection), Properties and Copy SHA-256. A cancel shows no error.
  - **find:** Find & Replace and Find by Name run as ops in the tray. The live find panel cancels its previous search whenever the query changes, which also stops a stale result from overwriting a newer one. It has its own busy state, so it doesn't use the tray.
- `api.ts`: an optional `opId` on `hashSha256`/`hashMd5`/`hashCrc32`/`copyEntry`/`findInFiles`/`findFileByName`, plus `cancelOp`.

## Tests
- **Rust:**
  - `Op`: the rate limit, a cancel recorded before the op starts, the late-cancel record expiring, unregistering on drop.
  - hash: progress events arrive and add up to the size; a cancel stops it.
  - copy: a file and a tree each report progress up to their total. A cancel mid-copy (from inside the progress callback) leaves no target at all, for a file and for a folder.
  - find: a cancel stops a walk.
- **Frontend:** the `ops.ts` store (progress aggregation, cancel calls every id) and `runTransfer` stopping on a cancelled step with `cancelled` set and earlier steps kept.

## Status
**Done** (2026-11-10).
- [x] Reset to `main`, read the new module layout, wrote this plan
- [x] `ops.rs` with tests; registration and app.toml (`files-read`)
- [x] hash, copy, find wired, with tests
- [x] Frontend: `opStore.ts` (pure, tested), `ops.ts`, `OpsTray`, api, call sites, `runTransfer`; demo mock for `cancel_op`
- [x] Checks: build, test, check:wiring, clippy `-D warnings`, cargo test, `pnpm site:build`, `pnpm site:capture check`
- [x] Decision record `docs/decisions/2026-11-10-op-progress-design.md`; ARCHITECTURE updated; handoff

## Results
- **Checks:**
  - `pnpm build` passes; `pnpm test` passes 269/269 (`opStore.test.ts` is new; `transfer.test.ts` has a cancel case and a summary case).
  - `check:wiring` finds no issues.
  - clippy `-D warnings` is clean; cargo test passes 135, 1 ignored (test-coverage's child-process test).
  - `site:build` output is committed; `site:capture check` passes 18/18.
- **New Rust tests:**
  - ops.rs: 5 (rate limit, cancel reaching a running op and unregistering, a cancel arriving first, an unclaimed cancel expiring, untracked ops).
  - hash: progress up to the size, and cancel.
  - copy: bytes up to the total for a tree with a 9 MiB file; a cancelled file copy leaves no file; a cancelled folder copy (mid-tree, and during the pre-walk) leaves no folder.
  - find: progress counts, and cancel for both searches.
- **End to end in `pnpm tauri:dev`**, with a temporary probe (not committed) on a 512 MB file:
  - hash, copy and find-by-name each cancelled on their first progress event and rejected with "cancelled";
  - the folder held only the source after the cancelled copy;
  - an untracked CRC-32 still worked;
  - a tracked MD5 ran to completion (102 rate-limited events).
- **Tray:** checked in the Browser pane against the plain Vite dev server, by driving `opStore` by hand: layout, the bar and the moving bar, Cancel turning to "cancelling…", the gruvbox and green-crt themes, and no console errors.
- **Windows:** not built. The changed `copy_file_no_clobber` (CopyFileW) passes clippy `-D warnings` for `x86_64-pc-windows-msvc` in a scratch crate, against a stub `Op` and the real `windows` 0.58.

## For review
- **IPC signatures:** the hash, copy and find commands now take `AppHandle` and `State<OpRegistry>` and an optional `op_id`. Their Rust tests call the inner functions, and two test modules shadow `copy_entry` with an untracked helper.
- **Error handling in the find wrappers:** `findInFiles`/`findFileByName` reject when given an `opId`, where they used to resolve to `[]`. Their two tool handlers now alert on a real failure, which they used to only log.
- **Untested here:**
  - `io::copy` over `take()` slices should still use `copy_file_range`, but it isn't confirmed by a syscall trace (no strace or rust-src here).
  - The last progress event of a finished op can be short of the total (rate limit); the tray closes when the call resolves.
- **Not covered:** cross-volume moves, archives and `compress` (same pattern), and replace-then-cancel (see the decision record).
