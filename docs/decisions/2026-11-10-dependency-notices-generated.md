# Dependency notices: generated, committed, checked in CI

Date: 2026-11-10 · Task: `dependency-notices` · Picked by the task session (the lead said to choose and record), on the plan in `docs/plans/completed/dependency-notices.md`. Follows `2026-11-08-notices-screen-dependency-licenses.md`.

## What gets listed
- **npm: what Vite bundles, not `pnpm licenses list`.** `pnpm licenses --prod` reports 17 packages, but only 8 reach the app. `scripts/gen-notices.mjs` runs a Vite build that writes nothing and collects the packages behind the bundled modules. That excludes pdfjs's Node-only `@napi-rs/canvas*`, the build-time `loose-envify`/`js-tokens`, and Tauri plugin JS packages the frontend never imports. Each package's own `LICENSE*` / `COPYING*` / `NOTICE*` files are included as they are. `@tauri-apps/plugin-dialog` ships only a `LICENSE.spdx` naming MIT and Apache-2.0 with the Tauri copyright; the full texts appear under its Rust crate, which comes from the same project.
- **Rust: cargo-about 0.9.3, once per release target.** The targets are `x86_64-unknown-linux-gnu`, `aarch64-unknown-linux-gnu` and `x86_64-pc-windows-msvc`. Build and dev dependencies are skipped (`about.toml`). Each crate is tagged with the platforms it ships on, and the view shows only the current platform's crates: Linux 380, Windows 323, 428 in all. The two Linux architectures ship the same set. A dual-licensed crate shows the first license in `accepted`, which for `MIT OR Apache-2.0` is MIT.
- **Bundled C libraries:** `libgit2-sys`, `zstd-sys`, `libz-sys`, `bzip2-sys` and `lzma-sys` compile C code from source into the app. The C library's own license file sits inside the crate, where cargo-about's crate-level detection doesn't look. The generator adds those files from an explicit list (`BUNDLED_C`), and a missing file fails the run, so a crate update that moves one is noticed.
- **The app's own crate** is left out. `src-tauri/Cargo.toml` gained `license = "MIT"`, matching `LICENSE`, so cargo-about's `--fail` can stay on for every other crate.

## Committed, not built in CI
`src/assets/third-party.json` is committed. A CI job (`notices` in `ci.yml`) regenerates it on every push and PR and fails if it differs.

Why commit it:
- Every build has the notices: `pnpm build`, a local `pnpm tauri build` (the arm64 launcher build), and the release workflow. None of them need cargo-about.
- A dependency change that brings in a new license shows up as a diff in review.

Rejected: generating at release time only. The release workflow would need cargo-about and a fetch step, local release builds would ship without notices or need the tool too, and nothing would show license changes before a release.

**How a release stays current:** releases are tagged from `main`, and the `notices` job fails any push to `main` or PR whose lockfile change isn't matched by a regenerated file. The release workflow itself needs no change.
- **Determinism:** the generator runs cargo-about with `--offline --locked` after `cargo fetch`, sorts its output, and stores no dates or paths, so the result depends only on the lockfiles and the cargo-about version. CI pins cargo-about to 0.9.3, the version the committed file was made with. Bumping it means regenerating.
- **Local:** `cargo install cargo-about --locked --features cli`, then `pnpm notices`. Without `--features cli` the install builds nothing in 0.9.

## Size
| | raw | gzip |
|---|---|---|
| `third-party.json` (179 distinct texts, 428 crates, 8 npm packages) | 462 KB | 72 KB |
| the lazy `noticesData` chunk (font texts + this JSON) | 518 KB | 88 KB |
| the main bundle | unchanged (751 KB) | |

Each text is stored once and referenced by index. Without that, 428 crates' texts would be several MB. The JSON is imported only by `noticesData.ts`, the lazily loaded chunk, so startup is unaffected. 462 KB is still reasonable for a chunk loaded on demand: most of it is the 179 texts, and libgit2's `COPYING` alone is about 70 KB.

## Not covered
- **cargo-about's built-in `workarounds`** (for example, gtk-rs crates whose packages lack a license file) fetch the texts from git, which `--offline` rules out. Those crates get cargo-about's standard text for their declared license, without the project's copyright line.
- **Third-party code vendored inside npm packages** (pdf.js bundles some) is covered only by the package's own license file.
- **The system webview** (WebView2, WebKitGTK) isn't shipped with the app, so it isn't listed.
