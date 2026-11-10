# dependency-notices

Branch: `claude/bold-haibt-91d29a` (worktree `bold-haibt-91d29a`). Backlog entry: `## dependency-notices` in `survey-fixes.md`, the follow-up from notices-screen (`docs/decisions/2026-11-08-notices-screen-dependency-licenses.md`). Assigned by the lead on 2026-11-10, starting from `main` at `c9d2f86`.

## Scope
- Add "npm packages" and "Rust crates" groups to Help → Third-party Notices, filtered to what ships for each platform.
- A generator script writes the data. Decide whether it's committed or built in CI, and how a release keeps it current. Minimal CI changes.
- Keep the notices chunk lazy, and note the size of the generated data.
- Install cargo-about locally and record it in `~/.claude/environment.md`.

## What I found
- **npm:** `pnpm licenses list --prod` reports 17 packages, but only 8 reach the app bundle. Vite's module graph shows `react`, `react-dom`, `scheduler`, `@xterm/xterm`, `@xterm/addon-fit`, `pdfjs-dist`, `@tauri-apps/api` and `@tauri-apps/plugin-dialog`. The others never ship: pdfjs's Node-only `@napi-rs/canvas*`, the build-time `loose-envify`/`js-tokens`, and the Tauri plugin JS packages the frontend doesn't import. So the generator takes its npm list from a Vite build (`write: false`), not from `pnpm licenses`.
- `@tauri-apps/plugin-dialog` ships only a `LICENSE.spdx` (it declares MIT and Apache-2.0, with the Tauri copyright) and no license text. Its Rust crate, which the Rust group lists with full texts, comes from the same project.
- **cargo-about 0.9.3** needs `--features cli` to install its binary.

## Approach (as built)
1. **`scripts/gen-notices.mjs`** (`pnpm notices`, `pnpm notices --check`) writes `src/assets/third-party.json`:
   - npm packages from a Vite build that writes nothing, each with its own license files;
   - Rust crates from cargo-about (`src-tauri/about.toml`), run with `--offline --locked --fail` for `x86_64-unknown-linux-gnu`, `aarch64-unknown-linux-gnu` and `x86_64-pc-windows-msvc`, each crate tagged with its platforms;
   - the license files of five bundled C libraries (libgit2, zstd, zlib, bzip2, liblzma), added from an explicit list;
   - each text stored once and referenced by index. The output is sorted and holds no dates or paths, so it's reproducible.
2. **`notices.ts`:** each notice carries a `group` and `label`. That's needed because scoped npm names contain "/", and grouping by path folder would split them. `dependencyNotices(data, platform)` builds the npm and per-platform Rust notices, and only the font files get relative links. `noticesData.ts` (the lazy chunk) imports the JSON. `Notices.tsx` shows the groups and adds a filter box, since the list is now about 400 entries.
3. **Committed JSON,** with a `notices` CI job (`ci.yml`) that pins cargo-about 0.9.3 and fails when the file doesn't match the lockfiles.
4. **`src-tauri/Cargo.toml`** gains `license = "MIT"`, matching `LICENSE`, so `--fail` can stay on.

## For review
- **Decision:** `docs/decisions/2026-11-10-dependency-notices-generated.md`. It covers committed vs built in CI, why the npm list comes from the bundle rather than `pnpm licenses`, the bundled C libraries, and size.
- **Size:** `third-party.json` is 462 KB raw / 72 KB gzipped, and the lazy chunk is 518 KB / 88 KB. The main bundle is unchanged.
- **New CI job `notices`:** about 1–2 minutes (prebuilt cargo-about, `cargo fetch`, Vite build, three cargo-about runs). It hasn't run in CI yet; its first run is the first push.
- **Known gaps:** cargo-about's network-only `workarounds` (gtk-rs copyright lines), and code vendored inside npm packages (pdf.js).
- **This machine:** cargo-about 0.9.3 installed (`--features cli`), recorded in `~/.claude/environment.md`.

## Status
Done 2026-11-10. `main` `c9d2f86` merged in at the start, then pty-drain before the final checks.
- **New:** `scripts/gen-notices.mjs`, `src-tauri/about.toml`, the generated `src/assets/third-party.json`, the `notices` job in `ci.yml`, and the `pnpm notices` script.
- **Changed:** `notices.ts` (group, label, `dependencyNotices`), `noticesData.ts` (imports the JSON), `Notices.tsx` (groups, filter box, links only in font files), `src-tauri/Cargo.toml` (`license = "MIT"`).
- **Tests:** `src/notices.test.ts` has 13. The 5 new ones check the data's shape, the platform tags (`tauri` on both, `webkit2gtk` Linux-only, `webview2-com` Windows-only), libgit2's bundled license, the per-platform filter, and the notice text format.
- **Checks:** `pnpm build` ok · `pnpm test` 239 passed · `check:wiring` 0 unwired / 0 unsent · `pnpm notices --check` up to date · clippy (`-D warnings`) clean · `cargo test` 122 passed, 1 ignored.
- **Seen in the Vite dev server:** Help → Third-party Notices lists fonts, then npm packages (8), then Rust crates (380, Linux). Filtering on "libgit2" leaves libgit2-sys, whose notice shows its declared license, two MIT texts and libgit2's bundled C license.

