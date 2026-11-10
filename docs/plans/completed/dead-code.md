# dead-code

Branch: `claude/intelligent-turing-9d8036` (worktree `intelligent-turing-9d8036`).
Backlog section: `## dead-code` in `docs/plans/active/survey-fixes.md`.

## Status
**Done 2026-11-08.** The lead approved implementing without a user check-in, and approved the Rust list.
- Frontend part: merged into main as `ad66d6e` (branch commit `2968133`).
- Rust part: `b653e4e`..`8e11937` on this branch, on top of main `718bca5` (merged in at `9b88ea7`). Shared hash loop, five dependencies dropped, rust-version 1.88, five uncalled commands removed (with `discover_repo`, `gtk_uses_wayland` and the `window` permission group), Cargo.lock updated.
- Checks on the final commit: `pnpm build` OK, `pnpm test` 151/151, `pnpm check:wiring` 0 in every category, `RUSTFLAGS="-D warnings" cargo clippy --all-targets` clean, `cargo test` 53/53 (new `hashes_match_known_digests_across_chunks`; reworked `upstream_ahead_behind_counts_and_nothing_to_compare`, `git_status_outside_a_repo_is_none`). Linux only: `cfg(windows)` code wasn't compiled, but none of it changed.
- Beyond the backlog: Select by Tag now works (the audit flagged it as theater); cut rows dim again (dead `dimmed` inline opacity); the dead `Go to Path:<target>` dispatch is gone; unused `HandlerCtx.openTweaks`/`openPalette` removed. The follow-up `unsent-labels` ran on this branch too (`docs/plans/completed/unsent-labels.md`).

Decision records: `docs/decisions/2026-11-08-dead-code-{wiring-audit,command-owners,toggles,uncalled-commands}.md`.

## Scope and approach
One removal per commit, so each merges on its own.

### Frontend
1. **Shadowed handler cases.** App.tsx's global switch and `doFileOp` run before the `HANDLERS` chain, so a handler case for the same label never runs. The App.tsx side is what users get today, so it stays the owner and the handler case is deleted (no behavior change). Today's list: nav `New Tab`, `Home`, `Open in Terminal`, `Open in VS Code`; misc `Preferences`/`Preferences…`, `Refresh`/`Reload`, `Clear All Tags`, `Text File`, `Markdown Note`, `Script (.sh)`, `Open With →`; tools `Compress →`, `Open With →`, `Checksum (SHA256)`/`Checksum SHA256`, `Copy as WSL Path`; view `Tag →`. Helpers left unused by the deletions go too. Only handler files change, so the New File/Folder/Rename code in App.tsx (create-rename-conflicts) isn't touched.
2. **Unused code:** `HexDialog`; mock `FILES`, `SIDEBAR`, `TREE` and the types only they use; `ping`, `gitAheadBehind`, `setAlwaysOnTop`, `wslToWin` in api.ts; the `--scanlines` CSS variable (the overlay is driven by `data-scanlines`).
3. **Theme list:** one `THEMES` export in `data.ts`, used by App.tsx's "Switch Theme" and the Tweaks panel.
4. **Toggles that do nothing:** remove "Show Ignored (.gitignore)", "Show Checksums" and "Browse archive in place" (menu items, check state, Tweaks row, tweak fields, handler cases). Also remove the "!" git badge, which no backend path can produce since backend-bugs. See the decision record.
5. **Audit script:** keep it and rework it against `src/data.ts`, App.tsx and the handler chain, parsed with the TypeScript compiler API instead of regexes and fixed line ranges. It fails on labels that something sends but nothing handles, on shadowed handler cases and on theater handlers, and lists handled-but-never-sent labels as a note. Add `pnpm check:wiring` and run it in CI's frontend job.

### Rust
6. Remove uncalled commands: `git_dirty_count` and `git_ahead_behind` (both duplicate what `git_status` already returns), plus `ping`, `set_always_on_top` and `wsl_to_win`, whose only callers were the api.ts wrappers removed in step 2. Tests for still-used logic move onto `upstream_ahead_behind` and `git_status`. `set_always_on_top` takes its Wayland helper and the `window` permission group with it (command-security's `build.rs` requires `permissions/app.toml` to match `generate_handler!`).
7. Drop the unused dependencies `thiserror`, `anyhow`, `tokio`, `walkdir`, `grep-matcher`.
8. One read loop (`read_chunks`, with `digest_file` for the Digest hashers) shared by `hash_sha256`, `hash_md5`, `hash_crc32`, with a unit test against known digests.
9. `rust-version = "1.88"` (highest `rust_version` among locked deps: `time` 0.3.47, `darling` 0.23).

## Checks
`pnpm build`, `pnpm test`, `pnpm check:wiring`; in `src-tauri`, `RUSTFLAGS="-D warnings" cargo clippy --all-targets` and `cargo test`.

## For review
- **Removed the three no-op toggles rather than implementing them** (Show Ignored, Show Checksums, Browse archive in place), plus the "!" badge. Hiding gitignored files would make a reasonable feature task of its own.
- **Removed commands other tasks had just fixed:** `git_ahead_behind`/`git_dirty_count`/`wsl_to_win` (backend-bugs) and `set_always_on_top`'s Wayland check (linux-parity). Nothing called them; the commits are listed in the uncalled-commands decision record for recovery.
- **App.tsx owns the commands that were handled twice.** split-big-files can decide whether they move into the handlers.
- The command-security decision record still says seven permission groups; there are six now. I left that file alone, since it belongs to another task; ARCHITECTURE.md is updated.
- `tokio` is gone as a direct dependency; async-commands uses Tauri's runtime, and the lead told that session.
