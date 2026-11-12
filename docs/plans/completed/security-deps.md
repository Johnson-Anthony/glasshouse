# security-deps (task 10b of survey-2)

Clear the dependency advisories in `Cargo.lock` before the v0.2.0 tag. Scope and advisory list: `docs/plans/active/survey-2.md`, section 10b. Version choices: `docs/decisions/2026-11-12-security-deps-versions.md`.

## Plan
1. **zip 2.4.2 → 9.5.1** (latest; ≥ 9.0.5 clears GHSA-m665-v7pm-7grj, GHSA-q7v9-x93c-xqv3, GHSA-8hxf-qr8p-62x4, RUSTSEC-2026-0367/0368/0369/0429). Adapt `commands/archive.rs` and `archive_tests.rs` to the new API with no behavior change: own extraction loop, entry-path check, link checks, setuid mask, zip64 from 4 GiB, cleanup of failed creates. Run every archive test, the ignored 4 GiB one included.
2. **zstd 0.13.3 → 0.14.3** (direct), so it stays the one copy zip 9 also uses (zip 9 needs `zstd ^0.14.2`). That brings zstd-safe 8.2.0 and zstd-sys 2.1.2.
3. **tauri 2.10.3 → 2.12.5** (GHSA-7gmj-67g7-phm9, fixed in 2.11.1; 2.12.0 also fixes GHSA-w28w-mhc8-qvjv), tauri-build 2.7.4, and each plugin's latest release. `rust-version` 1.88 → 1.90. JS `@tauri-apps/*` on the same minors. Check `permissions/app.toml` and build.rs.
4. Transitive: quick-xml 0.42 (via plist 1.10.3), crossbeam-epoch 0.9.21, libz-sys 1.1.33, and serde_with 3.21.0 (GHSA-7gcf-g7xr-8hxj, not on the backlog list).
5. Out of scope (task 28): warnings-only items (git2, glib, unmaintained crates, and the semver-compatible "unsound" fixes for anyhow, event-listener, memmap2, rustix and tokio), the npm dev-tool advisories, windows 0.61, typescript, vite, git2, notify.
6. Verify with OSV queries over the whole lockfile (cargo audit isn't installed here), then `pnpm notices` for `src/assets/third-party.json`.
7. Checks, one at a time under memory caps: `pnpm build`, `pnpm test`, `pnpm check:wiring`, `pnpm notices --check`, clippy `-D warnings`, `cargo test`, the ignored 4 GiB zip test, `pnpm site:build`, `pnpm site:capture check`.

## Status
- [x] Plan and decision record
- [x] Version bumps (Cargo.toml, Cargo.lock, package.json, pnpm-lock.yaml)
- [x] archive.rs on the zip 9 API; rooted entry names still refused (new test)
- [x] OSV: every listed advisory gone from Cargo.lock
- [x] `pnpm notices` (`about.toml` accepts `bzip2-1.0.6` for libbz2-rs-sys)
- [x] Checks: `pnpm build`; `pnpm test` (462 passed, 3 skipped); `pnpm check:wiring` (0/0/0/0); `pnpm notices --check`; clippy `-D warnings`; `cargo test` (172 passed, 2 ignored); `zip_of_a_4_gib_file` (passed, 121 s); `pnpm site:build` (demo bundle changed: notices data and tauri api, so it's committed); `pnpm site:capture check` (23 PASS)
- [x] Merged main (094e88f: watcher-fixes, Windows git odd-name fix). Rechecked on the merged tree: clippy `-D warnings`, `cargo test --locked` (180 passed, 2 ignored), `pnpm notices --check`, `pnpm build`, `pnpm test` (462 passed, 3 skipped), `pnpm check:wiring`, `pnpm site:build` (demo unchanged by the merge, so the capture check above stands), OSV (only the task-28 warnings left)
- **Done.** Not built here: the `cfg(windows)` code against the new crates (windows 0.62 through tauri, zip 9's windows-sys 0.61, `static_vcruntime`); the windows-latest CI job is its first build.
