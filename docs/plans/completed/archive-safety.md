# archive-safety

Branch: `claude/recursing-allen-a7ecf9` (worktree `.claude/worktrees/recursing-allen-a7ecf9`), reset to `main` at `87d1c5b`.
Backlog entry: section 1 of `docs/plans/active/survey-2.md`.
Files: `src-tauri/src/commands/archive.rs` (+ `archive_tests.rs`), `lib.rs`, `permissions/app.toml`, `src/api.ts`, `src/handlers/archive.ts`, `src/handlers/fileOps.ts` (Compress to ZIP…), `site/demo/mock/backend.ts`, tests.

## Status
Done 2026-11-11.
- **Checks:**
  - `RUSTFLAGS="-D warnings" cargo clippy --all-targets` clean;
  - `cargo test`: 146 passed (9 new), 2 ignored: the 4 GiB test, plus an existing child-process test;
  - the 4 GiB zip test run by hand passed in 76 s;
  - `pnpm build` passed, `pnpm test` 284 passed, `pnpm check:wiring` clean;
  - `pnpm site:build` passed, and `pnpm site:capture check` passed all 15 checks.
- **Demo check:** in the browser demo (mock backend), Extract Here extracted, a second run asked the conflict question, and keep both made `photos-2026-10 (copy)`. Cancel changed nothing, no staging folder was left behind, and there were no console errors.
- **Not built here:** the `cfg(windows)` call to `copy_mark_of_the_web`, the Windows branch of `make_archived_link`, and the Windows Mark-of-the-Web test. `copy_mark_of_the_web`, `link_stays_inside` and `make_archived_link` were type-checked with clippy `-D warnings` for `x86_64-pc-windows-msvc` in a scratch crate. Windows CI is the first real build and the first run of the Mark-of-the-Web test.
- **Rebuilt demo bundle not committed:** `docs/demo/` needs `pnpm site:build` on `main` after the merge, because the mock backend changed.
- **Decisions:** `docs/decisions/2026-11-11-archive-safety-extraction.md`.

## Approach
1. **Extract never touches existing files.** `archive_extract(archive, dest_dir)` extracts into a new staging folder inside `dest_dir` (`.glasshouse-extract-<pid>-<n>`, made with `create_dir`, so same volume and no clobber), and returns `{ staging, skipped }`. The frontend lists the staging folder and moves its top-level entries into `dest_dir` with `runTransfer` (the paste planner and its skip / replace / keep both question), then calls the new `archive_discard_staging(staging)`, which deletes only folders this process staged. Extract to Folder uses the same flow into the named folder (created if missing).
2. **Failure leaves nothing.** A failed extraction deletes the staging folder, and also `dest_dir` if the call created it and it's empty. For creation, zip removes its output after dropping the writer (whose Drop would otherwise finish a valid-looking zip that's missing entries). tar.gz now streams `tar -czf -` into a file opened with `create_new`, as tar.zst already does, which also closes the check-then-create race; both remove the output on error. 7z removes its output on error (it was checked absent first).
3. **Zip ≥ 4 GiB:** `.large_file(len >= u32::MAX)` per file entry.
4. **Zip creation reports what it skips.** Symlinks (nested, and now a selected one too, which used to be followed) and entries whose metadata or listing can't be read are still left out, but `archive_create` returns `{ skipped: [{path, reason}] }` and the frontend shows them.
5. **Zip extraction is our own loop** instead of `ZipArchive::extract`:
   - entry paths through `enclosed_name()`; one that climbs out fails the extraction, as before;
   - symlink entries are created last, so nothing is ever written through one, and only when the target is relative and stays inside the extraction (lexically, then by resolving it once everything exists). Others are skipped and reported;
   - on Windows, a link that needs the symlink privilege (error 1314) is skipped and reported instead of failing the extraction;
   - unix mode bits are applied after writing, masked to `0o777` (no setuid/setgid).
6. **Mark-of-the-Web (Windows):** after extraction, copy the archive's `Zone.Identifier` stream onto every extracted regular file, for every format, so `7z -snz` isn't needed. Best effort: a file system without streams (FAT, exFAT) is skipped silently, as Explorer does.

## Tests
Rust: extraction never replaces existing files (each available format); a corrupt second zip entry leaves no partial output; a failed extract into a new folder removes it; `archive_discard_staging` refuses other paths; zip link entries (inside kept, absolute / climbing / escaping through another link skipped and reported); mode bits kept with setuid removed; zip creation reports skipped links; failed zip and tar.gz creation remove their output; a `#[ignore]`d ≥ 4 GiB sparse-file zip round trip (run by hand); a `cfg(windows)` Mark-of-the-Web test for CI.
Frontend (vitest): Extract Here moves staged entries through the conflict question, discards staging in every case (success, cancel, failure); skipped entries reach the user; create reports skips.

## Not built here
`cfg(windows)` code (Mark-of-the-Web copy, symlink 1314 skip, the Windows MotW test) can't be compiled on this machine; Windows CI is its first build. Pure-std parts get type-checked through the scratch-crate recipe where practical.
