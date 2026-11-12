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
- [ ] plan + decision record
- [ ] Rust: open_regular, copy cleanup, move delete failure, times/modes, fsync, staging scan
- [ ] frontend: delete/trash batches
- [ ] tests
- [ ] checks: pnpm build, pnpm test, check:wiring, clippy -D warnings, cargo test (site:build + capture check: the confirm text changed)
