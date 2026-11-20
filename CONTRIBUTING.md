# Contributing to glasshouse

Thanks for helping. Bug reports, ideas, test reports and code are all welcome.

- **Bugs and ideas:** use the forms on the [new issue page](https://github.com/Johnson-Anthony/glasshouse/issues/new/choose). Search the open issues first.
- **Security problems:** don't open an issue. Report them privately, as [SECURITY.md](SECURITY.md) says.
- **Testing on a real PC:** CI can't drive installers, native dialogs, drag and drop with other apps or real desktops. The checklists in [docs/testing/](docs/testing/README.md) list what needs a person, and a report of what passed or failed on your system helps.
- **Code:** for anything bigger than a small fix, open an issue first, so we can agree on the approach before you spend time on it.

## Building from source

You need:
- **Rust** stable, 1.90 or newer ([rustup](https://rustup.rs));
- **Node** 20 or newer, and **pnpm** 9: `corepack enable` gets the version `package.json` names;
- **Windows:** the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/): the Visual Studio C++ Build Tools and WebView2;
- **Linux:** WebKitGTK 4.1 and its build dependencies, plus a C compiler and pkg-config:
  - Debian and Ubuntu: `sudo apt install build-essential pkg-config libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev patchelf`;
  - Arch: `sudo pacman -S --needed base-devel webkit2gtk-4.1 librsvg patchelf`.

Then:

```bash
pnpm install                                # also in every fresh clone or worktree
pnpm tauri:dev                              # run in dev mode, with hot reload of the UI
pnpm tauri build --no-bundle                # a release binary only: src-tauri/target/release/glasshouse
pnpm tauri build --bundles appimage,deb     # Linux: .AppImage and .deb
pnpm tauri:build                            # Windows: the .msi and the setup.exe
```

The first Rust build takes several minutes and a few GB of disk.

## Checks

CI runs these on every pull request (`.github/workflows/ci.yml`). Run the ones your change touches before you push:

| Check | Command |
|---|---|
| Frontend typecheck and build | `pnpm build` |
| Frontend tests (vitest) | `pnpm test` |
| Every menu label reaches a handler | `pnpm check:wiring` |
| Third-party notices match the lockfiles | `pnpm notices --check` (needs [cargo-about](https://github.com/EmbarkStudios/cargo-about) 0.9.3: `cargo install cargo-about --locked --features cli`) |
| Rust lint | `cd src-tauri && RUSTFLAGS="-D warnings" cargo clippy --all-targets` |
| Rust tests | `cd src-tauri && cargo test` |
| The project site's demo is current, and its checks pass | `pnpm site:build`, then `pnpm site:capture check` (needs Chromium) |
| Workflows | `actionlint` |

The backend jobs run on Linux, Windows x64 and Windows on Arm. Windows-only code (`cfg(windows)`) can't be built on Linux, so if you work on Linux, CI is where it first compiles.

**End-to-end tests** (`.github/workflows/e2e.yml`) drive the real app through WebDriver on Linux (under Xvfb) and Windows. Locally on Linux: `pnpm tauri build --debug --no-bundle`, then `pnpm e2e`. They need `webkit2gtk-driver` (apt), `xvfb` and `cargo install tauri-driver --version 2.1.0 --locked`. "End-to-end tests" in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#end-to-end-tests-e2e) has the details, Windows included.

## Things to know

- **Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) first.** It maps the code and says where to start reading. [docs/INTEGRATION.md](docs/INTEGRATION.md) covers the file-manager and dialog integration, and `docs/decisions/` records why things are the way they are.
- **Commands are routed by their menu label.** Renaming a menu item means updating its handler too; `pnpm check:wiring` catches a mismatch.
- **A new Rust command** must also be listed in `src-tauri/permissions/app.toml`, in the group that matches what it can do. The build fails otherwise.
- **A new Git menu command** that runs through `git_run` needs its subcommand and flags in `GIT_RUN_ALLOWED` in `src-tauri/src/commands/git.rs`, or the backend refuses it.
- **Changing a lockfile** (`pnpm-lock.yaml`, `src-tauri/Cargo.lock`) means running `pnpm notices` and committing the regenerated `src/assets/third-party.json`.
- **Changing the UI** can make the site's demo stale: run `pnpm site:build` and commit `docs/demo/`. `pnpm site:capture` re-records the images and clips in `docs/media/` (it needs Chromium and ffmpeg).
- **User-visible changes** get a line in `CHANGELOG.md` under `## [Unreleased]`, written for people using the app, not for developers.
- **Style:** there's no ESLint or Prettier. Match the code around your change, and keep diffs to what the change needs.

## Pull requests

- One change per pull request, with a description of what it changes for users and how you tested it.
- Say what you couldn't test, such as Windows or a particular desktop.
- By contributing, you agree that your contribution is licensed under the project's [MIT license](LICENSE).

## The stack

- **Frontend:** React 18, TypeScript, Vite, [xterm.js](https://xtermjs.org).
- **Backend:** Rust, Tauri 2, [`git2`](https://crates.io/crates/git2), [`notify`](https://crates.io/crates/notify), [`sysinfo`](https://crates.io/crates/sysinfo), [`portable-pty`](https://crates.io/crates/portable-pty).
- **Tauri plugins:** `dialog` and `window-state`, plus the `opener` crate's functions for opening files and links.
- **Package manager:** pnpm 9.

## Releases

A maintainer pushes a `v*` tag. `.github/workflows/release.yml` checks that the versions match and that `CHANGELOG.md` has a dated section for the tag, builds every package into a draft release, and publishes it with `SHA256SUMS` and a build provenance attestation only when every build has passed.
