# test-coverage

Branch: `claude/exciting-davinci-df48b1` (worktree `exciting-davinci-df48b1`). Tests only. Bugs the tests found go to the lead as suggested tasks, except one one-line fix (below).

## Status
**Done 2026-11-08.** vitest 183 → 223 (+40), cargo 63 → 107 (+44, plus 1 ignored helper). `pnpm build`, `pnpm test`, `pnpm check:wiring`, clippy `-D warnings` and `cargo test` pass on Linux arm64.
- [x] Frontend: handler-chain routing, `stripWinOnly`, `winToUnc`, `canExtractArchive`, bulk-rename preview
- [x] Rust: `list_dir`, `delete_entry`, `move_to_trash`
- [x] Rust: tar flavours, 7z, zip-slip
- [x] Rust: `/proc` parsers, `ssh_hosts`, Linux terminal arguments
- [x] Rust: watcher basics, pty output decoding
- [x] Decision on jsdom + Testing Library: `docs/decisions/2026-11-08-test-coverage-component-tests.md` (not now)
- [x] Checks

## Measured before starting (main at 7b94d09)
The survey-time scope was stale: main had 183 vitest and 63 cargo tests. Already covered, so left alone: `splitBreadcrumb` and `basename` (`paths.test.ts`), `move_entry` (5 tests), the tar.zst path and `--` member names, pty spawn/exit/input queue (`pty.rs`), `xdg_trash_files`, `list_dir` symlink kind and git labels, shell profile checks.

## What was added
**Frontend** (new files)
- `src/handlers/routing.test.ts`: routes labels through the real `HANDLERS` the way App.tsx's loop does, with `../api` automocked and `../components` replaced by a `dialogs` mock. Checks the chain order; that an unknown label falls through every handler with no backend call, dialog or ctx callback; that every `case` label in each handler file is consumed by that handler at runtime (the runtime side of `check:wiring`'s static shadow check; it fails if a case returns `false`); and some end-to-end effects (Select All/Invert/by Pattern, Zip, Extract to Folder…'s suggested name, Stage Selected, Copy as UNC).
- `src/data.platform.test.ts`: `stripWinOnly` (removal at depth, Explorer rename keeping the dispatch label, separator collapse, idempotence) and the real menus after module-load stripping (no Windows-only labels, no stray separators, no empty submenus).
- `src/handlers/helpers.test.ts`: `winToUnc`, `canExtractArchive`, and a check that `EXTRACT_EXTS` equals the extensions `archive_extract` in `commands.rs` dispatches on.
- `src/bulkRename.test.ts`: find/replace (literal, regex with groups, bad regex), prefix/suffix, numbering tokens, case modes, extension and dotfile handling.

**Rust** (new files)
- `src-tauri/src/commands/testing.rs`: `Scratch` temp folder (removed on drop) and small helpers.
- `src-tauri/src/commands/fs_tests.rs`: `list_dir` (order, fields, dotfiles, missing folder, non-UTF-8 names), `delete_entry` (file, folders with and without `recursive`, links never followed, missing path), `move_to_trash` (Linux; file, folder, missing path).
- `src-tauri/src/commands/archive_tests.rs`: tar.gz and 7z round trips; extracting .tar/.tgz/.TAR.GZ/.tar.bz2/.tbz2/.tar.xz/.txz; input errors; zip-slip with `../` entries (refused), an absolute entry and an archived symlink (unix), a tar `../` member, and a `../` entry through 7-Zip. The slip tests assert that nothing appears outside the destination.
- `src-tauri/src/commands/parser_tests.rs`: `parse_ssh_hosts`, `terminal_command_for` (folder flags, run flags and order, a `$TERMINAL` path), `fs_type_for` (longest prefix, whole components, `\040`), `parse_net_dev` (loopback, headers, no-space `iface:` form, saturation), plus real `/proc` smoke tests on Linux.
- `src-tauri/src/watcher/tests.rs` (unix): a new file reports its folder; a second watch registers once; a failed watch isn't recorded and can be retried; unwatch stops reports; subfolders aren't watched.
- `src-tauri/src/pty/output_tests.rs` (unix): 45 KB of 2/3/4-byte characters split across 4096-byte reads arrive with no U+FFFD (fails if the carry-over is disabled); invalid bytes become U+FFFD; input to an unknown session errors.

**Seams in production code** (bodies unchanged, only split from their callers)
- `components.tsx`: the Bulk Rename preview `useMemo` body is now the exported `bulkRenamePreview(items, opts)` next to the dialog; `CaseMode` is exported.
- One-word exports: `stripWinOnly` (`data.ts`), `winToUnc` (`handlers/tools.ts`), `EXTRACT_EXTS` (`handlers/archive.ts`).
- `commands.rs`: `parse_ssh_hosts`, `terminal_command_for`, `fs_type_for`, `parse_net_dev`; four `#[cfg(test)] mod` lines at the end.
- `watcher.rs`: `watch_dir`/`unwatch_dir` call `watch(state, path, on_change)`/`unwatch(state, path)`, which take a callback instead of an `AppHandle`, as `pty::spawn_session` does. Without that, testing needs tauri's mock runtime and generic commands.
- `pty.rs`: one `#[cfg(all(test, unix))] mod output_tests;` line.

The trash test runs in a child copy of the test binary with its own `XDG_DATA_HOME`. Setting the variable in-process would race other test threads (and libgit2's `getenv`), and a test must never use the real trash. The child test is `#[ignore]` and does nothing unless its parent set `GLASSHOUSE_TRASH_TEST_ROOT`, so `cargo test -- --ignored` can't reach the real trash either.

## Windows
Nothing here is `cfg(windows)` code, but none of it has been compiled or run on Windows. Tests that need unix semantics, `tar`, 7-Zip or `/proc` are `cfg(unix)` or `cfg(target_os = "linux")`, and so are the watcher and pty tests (like the existing pty tests). Portable tests that will run on windows-latest for the first time: the `list_dir` order/fields/missing-folder tests, the `delete_entry` file/folder/missing tests, `archive_create_refuses_bad_input_before_running_a_tool`, `archive_extract_refuses_unknown_extensions`, `archive_can_handle_knows_the_formats`, `zip_extract_refuses_entries_that_climb_out`, and the two `parse_ssh_hosts` tests.

## Found by the tests
- **Fixed here (one line):** with numbering off, Bulk Rename still expanded `{n}` in the name, so changing only the case of `report{n}.txt` renamed it `REPORT0.txt`. `bulkRenamePreview` now expands tokens in the name only when numbering is on, as it already did for prefix and suffix.
- **For the lead (suggested tasks):**
  1. Bulk Rename's "digits" field does nothing. `numberDigits` is never read (`void numberDigits`), so `{n}` pads to 1 digit whatever it's set to; only `{n:03}` pads. Either make `{n}` use the field or remove the field.
  2. The backend's `copy_entry` and `move_entry` still replace an existing target: `std::fs::copy` overwrites a file, `copy_dir_recursive` merges into an existing folder, and `rename` replaces a file. The frontend's paste-conflict planning checks first, so this is a check-then-act window plus any caller that skips the planner. `no-clobber-fs` covered `write_text`, `make_dir` and `rename_entry` only.
  3. Minor: `parse_ssh_hosts` skips `Host=name`, which ssh_config allows. And `fs_type_for` keeps the first of two mounts stacked on the same mount point, but the visible one is the last.
