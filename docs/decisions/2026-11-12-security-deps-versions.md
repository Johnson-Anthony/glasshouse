# Dependency versions for the advisory fixes

Date: 2026-11-12 · Task: `security-deps` (survey-2 §10b) · Picked by the task session.

## tauri: the 2.12 line, so Rust 1.90
The backlog asked for tauri ≥ 2.11.1 (GHSA-7gmj-67g7-phm9). The lock now has tauri 2.12.5, tauri-build 2.7.4 and each plugin's latest release (dialog 2.8.4, fs 2.7.1, opener 2.7.3, os 2.4.0, shell 2.6.0). The npm packages are on the same minors (`@tauri-apps/api` and `cli` 2.12.4). `rust-version` goes from 1.88 to 1.90, the MSRV of the whole tauri 2.12 line. CI and release builds use stable Rust, so nothing builds with anything older.

Rejected: **tauri 2.11.6**, the last 2.11 release, which keeps Rust 1.77.2. It clears the advisory with a smaller change, but:
- tauri 2.12.0 has its own security fix, which 2.11 doesn't: channel payloads and large invoke responses could be read by other webviews (GHSA-w28w-mhc8-qvjv);
- tauri 2.11.6 accepts `tauri-runtime`, `tauri-utils` and the others at their 2.12 releases (which need Rust 1.90), so staying on 2.11 means holding about ten crates back by hand, and Dependabot would propose undoing that every week;
- the plugins' 2.11-compatible releases are older minors with their own fixes missing.

Changes in the 2.12 line that touch glasshouse: windows 0.62 and webview2-com 0.39 (Windows 7 is no longer supported), tray-icon 0.25, tao now links libdbus on Linux (`libdbus-1-dev`, already pulled in by `libgtk-3-dev` in CI), and tauri-build statically links the MSVC runtime on Windows (`static_vcruntime`). The ACL changes don't affect glasshouse. Since 2.11.1 remote origins are always checked, and since 2.12.0 a deny applies only to its capability's origin, local or remote. glasshouse has an app manifest, a single local-only capability and no deny entries.

The manifest floors in `Cargo.toml` are the advisory floors (`tauri = "2.11.1"`, `zip = "9.0.5"`), each with a comment naming the advisory. The lock decides the version that's built.

## zip 9: rooted entry names still fail the extraction
zip 2.4.2's `enclosed_name` returned None for an absolute name (`/x`) or one with a drive, and `zip_extract` failed with "points outside the folder". zip 9's `enclosed_name` drops a leading root or drive instead (`/tmp/x` becomes `tmp/x`). That's still inside the folder, but it's a silent change to what gets extracted. `entry_path` now refuses a name that starts with `/`, `\` or `X:` before calling `enclosed_name`, so the old rule holds. The new test `zip_extract_refuses_rooted_entry_names` pins it.

Three zip 9 changes are kept as they are, because each one makes extraction stricter or more correct:
- `\` is a separator on every platform, so on Linux `a\b.txt` from a Windows-made zip becomes `a/b.txt` (before, it was one file with a backslash in its name), and `..\x` counts as climbing out;
- on Windows, `enclosed_name` refuses device names (`CON`, `NUL`, …), stream names (`a:b`) and trailing dots or spaces. The extraction fails, and the message says the entry "points outside the folder", which is wrong for these names but rare;
- `unix_mode()` already drops setuid, setgid and sticky. `zip_extract` still masks them itself.

## zstd 0.14, not 0.13.4
The backlog said zstd 0.13.4 and zstd-safe 7.4.0. zip 9 depends on `zstd ^0.14.2`, and the comment on our direct zstd dependency says it uses the same copy as zip. Staying on 0.13 would build two zstd crates. zstd 0.14.3, zstd-safe 8.2.0 and zstd-sys 2.1.2 clear the same advisories, plus zstd-sys's own (RUSTSEC-2026-0410, a wasm-only allocator bug). `copy_encode` and `copy_decode` work the same.

## Notices: `bzip2-1.0.6` accepted
zip 9 reads bzip2 entries with `libbz2-rs-sys`, a Rust port of bzip2, in place of `bzip2-sys`, which compiled the C bzip2. lzma goes the same way, with `lzma-rust2` in place of `lzma-sys`. The port keeps bzip2's own license (SPDX `bzip2-1.0.6`, BSD-style), so `about.toml` accepts it. The app already shipped that license, as the bundled C source's notice. `BUNDLED_C` in `gen-notices.mjs` keeps its `bzip2-sys` and `lzma-sys` entries: they're unused now, but if either crate comes back, its C license still gets listed.

The demo bundles `third-party.json` and `@tauri-apps/api`, so `docs/demo` is rebuilt and committed even though the UI is the same; CI's site job fails on a stale demo.

## Also bumped, and left for task 28
- **serde_with 3.18 → 3.21.0** (GHSA-7gcf-g7xr-8hxj, moderate: a panic while serializing; it comes in through tauri-utils). It's a real advisory, not a warning, and wasn't on the backlog's list. 3.21.0 is the fixed version. 3.24 would also pull in syn 3 and jiff.
- quick-xml goes to 0.42.0 through plist 1.10.3, past the 0.41 the backlog asked for.
- **Left for task 28.** These are the warnings-only "unsound" advisories with semver-compatible fixes: anyhow < 1.0.103, event-listener < 5.4.2, memmap2 < 0.9.11, rustix < 1.1.6 and tokio < 1.53.3. Each is one `cargo update -p`. The npm dev tools have advisories too (none of them ship in the app). In-range fixes exist for @babel/core, browserslist, baseline-browser-mapping, nanoid, postcss and source-map-js. vite, vitest, esbuild and tinypool need the vite and vitest majors.
