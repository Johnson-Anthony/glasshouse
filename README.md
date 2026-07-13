# glasshouse

> A riced-out file manager for Windows — tabbed browsing, embedded terminal, git-aware sidebar, themed dialogs.

<!-- Screenshot goes here once you have one — replace this line with:
![glasshouse](docs/screenshot.png)
-->

## What it is

Glasshouse is a desktop file manager built with Tauri 2 (Rust backend) and React 18 + TypeScript on the frontend. It targets Windows and focuses on the things stock Explorer doesn't do well: a real embedded terminal, multi-tab navigation, archive handling, and a sidebar that knows what's a git repo and what isn't.

## Features

- **Multi-tab browsing** with private/incognito tabs
- **Embedded terminal drawer** (xterm.js) — open a shell pinned to the current directory without leaving the app
- **Git-aware sidebar** — repos are detected via `libgit2`; status decorations on tracked paths
- **Inline archive handling** — extract `.zip`, `.tar.gz`, `.tar.zst`, `.7z` without external tools
- **File tagging** and bookmarks
- **Fuzzy search** across the active directory
- **Themed dialogs and context menus** — consistent styling instead of native OS chrome
- **Inspector + status bar** — file metadata and live operation feedback

## Stack

- **Frontend:** React 18, TypeScript, Vite, [xterm.js](https://xtermjs.org)
- **Backend:** Rust, Tauri 2, [`git2`](https://crates.io/crates/git2), [`notify`](https://crates.io/crates/notify), [`sysinfo`](https://crates.io/crates/sysinfo)
- **Tauri plugins:** `fs`, `dialog`, `shell`, `os`, `opener`
- **Package manager:** pnpm 9

## Run it

Requires Rust toolchain, Node 20+, and pnpm. On Windows additionally requires the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) (WebView2, Visual Studio Build Tools).

```bash
pnpm install
pnpm tauri:dev      # run the desktop app in dev mode
pnpm tauri:build    # produce a release bundle
```

## Status

Active development. Core file operations, tabs, terminal, archive handling, and git decorations work. Polish passes ongoing on dialog theming, drag-and-drop, and remote-target browsing.

## License

MIT — see [LICENSE](LICENSE).
