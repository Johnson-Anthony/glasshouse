# Third-party notices: what the screen shows, and generating dependency lists

Date: 2026-11-08 · Task: `notices-screen` · Picked by the task session (the lead said to choose and record), on the plan in `docs/plans/completed/notices-screen.md`.

## The screen: the bundled font notices, as plain text
Help → Third-party Notices (also a button in About) lists every text file under `src/assets/fonts`, with `LICENSES.md` first, and shows the selected one as plain text.
- **Loading:** the texts come in with `import.meta.glob(…, { query: "?raw" })` in `noticesData.ts`, reached only through a dynamic `import()`. They're a separate chunk (about 92 KB, 19 KB gzipped) that loads when the view first opens, not at startup.
- **Plain text:** there's no Markdown renderer among the dependencies. Pulling one in to show license files isn't worth a new dependency in the shipped bundle, and license texts read fine as text.
- **Links:** a `[text](relative-path)` link that points at another bundled notice is clickable, so the tables in `LICENSES.md` act as the index. Web links stay plain text, because the app makes no third-party requests (`src/offline.test.ts`).
- **Tests:** a test checks that the screen lists exactly the non-font files in that folder. A license added next to a new font therefore shows up without code changes, and a font file never does.

## npm and Rust dependency licenses: generate them at build time, in a later task
The shipped app also contains code from 17 npm production packages (MIT, Apache-2.0, or both) and a Rust dependency tree of 632 crates in `Cargo.lock`, fewer per target. MIT and Apache-2.0 both ask for the license and copyright notices to go along with binary copies. Today they appear nowhere in the app. Generating the lists is the only maintainable way to do this: a hand-kept list goes stale with every lockfile change.

### Options
| | npm | Rust |
|---|---|---|
| No new tool | `pnpm licenses list --prod --json` (built into pnpm; gives name, version, license, and the package path to read `LICENSE*` from) | `cargo metadata --format-version 1 --filter-platform <target>` (built into cargo; gives each crate's `license` field and manifest path, so `LICENSE*` files can be read from the registry source) |
| New tool | `license-checker` and similar (npm devDependency) | `cargo-about` (`cargo install cargo-about`, or a CI action) |

### Recommendation for the follow-up task
- **npm:** `pnpm licenses list`, which needs no new tool.
- **Rust:** `cargo-about`. With only `cargo metadata`, each crate's notice text has to be found by hand. Crates name their files `LICENSE`, `LICENSE-MIT`, `COPYING` and so on, some ship no text at all, and the dual-licensed ones (`MIT OR Apache-2.0`) need one license picked. `cargo-about` does that work:
  - picks a license from an accepted list;
  - extracts each crate's own copyright text;
  - de-duplicates identical license bodies;
  - filters by target, so the Windows build lists `windows-*` and the Linux build lists `zbus`;
  - renders through a template, so it can produce the same JSON this screen reads.

  The costs:
  - a new tool in CI and for anyone building a release (installed once, a few minutes to compile, or a prebuilt binary);
  - an `about.toml` with the accepted licenses;
  - a release-time step. It only needs to run when building a release, not on every `pnpm build`.
- **Output:** a generated `third-party.json`, or one per platform, read the same way the font notices are. The screen would gain an "npm packages" group and a "Rust crates" group. `groupByFolder` and the plain-text view need no other change.
- **Size:** the Rust texts, de-duplicated, should come to a few hundred KB, which is fine for a lazily loaded chunk. Without de-duplication, roughly 600 near-identical MIT/Apache texts would be several MB, which is another reason to use `cargo-about`.

Not done here, because it adds a tool and a release step, and nothing generated would yet be checked by CI. The view is built to take the extra groups.
