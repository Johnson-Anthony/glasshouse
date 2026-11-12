# fs-robustness (survey-2 §8, plus two archive-safety follow-ups)

Branch `claude/recursing-allen-a7ecf9`. Backlog: `docs/plans/active/survey-2.md` §8.

## Scope
1. **Partial copies.** A failed folder copy removes its new folder, whatever the error (only a cancel did before). A cross-volume move whose delete step fails no longer leaves an unexplained mess: see the decision record.
2. **Delete Permanently / Move to Trash** go through the whole selection, list what failed, and always refresh. Delete Permanently deletes folders with their contents, and the confirm says so when the selection has folders.
3. **Non-regular files.** Preview (text, image, hex), hash, diff/blame reads, zip compress, copy and extraction of an archive refuse FIFOs, sockets and devices before reading, without blocking on the open.
4. **Times and modes.** Copies (and so cross-volume moves) keep each file's modification and access times, and each folder's mode and times, set after the folder's contents are done. Unix only: CopyFileW keeps file times on Windows, and Explorer doesn't keep folder times either.
5. **fsync** in `write_config_atomic`: the temp file is synced before the rename, and the folder after it (unix).
6. **tar/7z links.** After any extraction, the staging folder is scanned and links whose targets leave it are removed and reported, by the same rule as zip (`link_stays_inside`).
7. **Read-only staged folders.** The same scan makes every staged folder owner-writable, so a 0555 folder from a tar can be moved out and the staging folder discarded.

## Approach
- `fs_ops.rs`:
  - `open_regular(path)`: stat first (so a device is never opened), then open with `O_NONBLOCK` and fstat again (closes the swap race), then clear `O_NONBLOCK`. Used by every reader listed in 3.
  - `remove_created_tree(path)`: makes folders owner-writable, then `remove_dir_all`. Only for trees this process just made (a partial copy, a staging folder).
  - `copy_path` cleans up on any error, and the leaf errors name the entry that failed.
- `archive.rs`: `tidy_staging` runs after `extract_into` for every format; the zip add loop skips non-regular entries and reports them.
- `fileOps.ts`: one keep-going helper for both delete commands; `target.ts` refreshes after a failed trash too.

## Status
Done 2026-11-12, on branch `claude/recursing-allen-a7ecf9`.
- All seven scope items are in, as planned. Two details changed while building:
  - folders keep their modification time but not their access time, because the copy's size pass has already read them;
  - a single file whose Windows `CopyFileW` fails is left to CopyFileW.

  Both are in `docs/decisions/2026-11-12-fs-robustness-failures.md`, and the conventions are in ARCHITECTURE.md.
- Tests:
  - Rust, 12 new: failed copy cleanup; read-only cleanup that doesn't follow links; times and modes; cross-volume move delete failures (real /dev/shm vs /tmp); FIFO, device and folder readers; hashing a FIFO; zip leaving FIFOs out; a FIFO archive; tar and 7-Zip outside links; a read-only tar folder; config write failure.
  - vitest, 6 new: delete and trash batches, the confirm text, links not counted as folders, and a right-clicked trash refreshing after a failure.
  - Mutation check: with the staging scan and the copy cleanup disabled, the copy, tar-link, 7-Zip-link and read-only-tar tests fail.
- Checks after merging main (2c6a93f), all passing:
  - `pnpm build`, `pnpm test` (399), `pnpm check:wiring`;
  - `RUSTFLAGS="-D warnings" cargo clippy --all-targets`, `cargo test` (171, 2 ignored);
  - `pnpm site:build`, `pnpm site:capture check`.
- Not built here: the Windows side.
  - The new helpers (`open_regular`, `ensure_regular`, `remove_created_tree`, `keep_dir_attrs`, `tidy_staging`, `remove_link`, `moved_but_not_deleted`) were type-checked with clippy `-D warnings` for `x86_64-pc-windows-msvc` in a scratch crate.
  - The rest of the Windows build is CI's.
