# dead-code

Branch: `claude/intelligent-turing-9d8036` (worktree `intelligent-turing-9d8036`).
Backlog section: `## dead-code` in `docs/plans/active/survey-fixes.md`.

## Status
Started 2026-11-08. Main merged at `db582d4`. The lead approved implementing without a user check-in; keep-or-delete calls go to `docs/decisions/` and "For review" below.
- [ ] Frontend items
- [ ] Rust items (wait for a build slot from the lead; merge main first)
- [ ] Checks, decision records, handoff

## Scope and approach
One removal per commit, so each merges on its own.

### Frontend
1. **Shadowed handler cases.** App.tsx's global switch and `doFileOp` run before the `HANDLERS` chain, so a handler case for the same label never runs. The App.tsx side is what users get today, so it stays the owner and the handler case is deleted (no behavior change). Today's list: nav `New Tab`, `Home`, `Open in Terminal`, `Open in VS Code`; misc `Preferences`/`Preferences…`, `Refresh`/`Reload`, `Clear All Tags`, `Text File`, `Markdown Note`, `Script (.sh)`, `Open With →`; tools `Compress →`, `Open With →`, `Checksum (SHA256)`/`Checksum SHA256`, `Copy as WSL Path`; view `Tag →`. Helpers left unused by the deletions go too. Only handler files change, so the New File/Folder/Rename code in App.tsx (create-rename-conflicts) isn't touched.
2. **Unused code:** `HexDialog`; mock `FILES`, `SIDEBAR`, `TREE` and the types only they use; `ping`, `gitAheadBehind`, `setAlwaysOnTop`, `wslToWin` in api.ts; the `--scanlines` CSS variable (the overlay is driven by `data-scanlines`).
3. **Theme list:** one `THEMES` export in `data.ts`, used by App.tsx's "Switch Theme" and the Tweaks panel.
4. **Toggles that do nothing:** remove "Show Ignored (.gitignore)", "Show Checksums" and "Browse archive in place" (menu items, check state, Tweaks row, tweak fields, handler cases). Also remove the "!" git badge, which no backend path can produce since backend-bugs. See the decision record.
5. **Audit script:** keep it and rework it against `src/data.ts`, App.tsx and the handler chain, parsed with the TypeScript compiler API instead of regexes and fixed line ranges. It fails on labels that something sends but nothing handles, on shadowed handler cases and on theater handlers, and lists handled-but-never-sent labels as a note. Add `pnpm check:wiring` and run it in CI's frontend job.

### Rust
6. Remove uncalled commands: `git_dirty_count` and `git_ahead_behind` (both duplicate what `git_status` already returns), plus `ping`, `set_always_on_top` and `wsl_to_win`, whose only callers were the api.ts wrappers removed in step 2. Tests for still-used logic (`upstream_ahead_behind`, the dirty count) move onto `git_status`.
7. Drop the unused dependencies `thiserror`, `anyhow`, `tokio`, `walkdir`, `grep-matcher`.
8. One `hash_file` read loop shared by `hash_sha256`, `hash_md5`, `hash_crc32`, with a unit test against known digests.
9. `rust-version = "1.88"` (highest `rust_version` among locked deps: `time` 0.3.47, `darling` 0.23).

## Checks
`pnpm build`, `pnpm test`, `pnpm check:wiring`; in `src-tauri`, `RUSTFLAGS="-D warnings" cargo clippy --all-targets` and `cargo test`.

## For review
- (filled in as decisions are made)
