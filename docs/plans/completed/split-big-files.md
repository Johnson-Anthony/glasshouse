# split-big-files

Branch: `claude/exciting-davinci-df48b1` (worktree `exciting-davinci-df48b1`), from main 54a1e15. Both frontend and Rust; the only session running.

## Status
**Done 2026-11-10.** Phase 1 (pure moves) and phase 2 (App.tsx routing) are both done. All checks pass after every commit: build, vitest (262), check:wiring, site:build, notices --check, clippy `-D warnings`, cargo test (124 + 1 ignored).

- [x] Phase 1a: `components.tsx` → `menus.tsx`, `Sidebar.tsx`, `preview/`, `dialogs/` (one commit each: 07ed7c4, dbb3ef7, 2a08bb4, a2018de). `components.tsx` 6132 → 1127 lines. UI smoke-tested in the browser-only dev server (menus, Bulk Rename, About, Keybindings, Inspector preview).
- [x] Phase 1b: `commands.rs` → `commands/` modules; shell profiles → `pty/profiles.rs` (3efa85d). `commands.rs` 5381 → 17 lines.
- [x] Phase 1 reported to the lead
- [x] Phase 2a: keymap table, `src/keymap.ts` (7858ab2)
- [x] Phase 2b: `handleMenuCommand`/`doFileOp` → `COMMAND_CHAIN` handlers (699bf29). App.tsx went from 2301 to 1366 lines over the two commits.

### How the moves were made
- **Frontend:** a throwaway script on the TypeScript compiler API moved line ranges verbatim and used the type checker to write each file's imports and to add `export` where another file now needs a declaration (`SEED_TAGS`, `TAG_COLOR_MAP`, `kindIcon`, `tagColor`, `AUDIO_EXTS`). It also rewrote importers. Hand edits: `routing.test.ts`'s `vi.mock` path and the demo's dynamic `import()` of `dialogs`.
- **Rust:** a script moved line ranges per module and split the inline tests by name. Then `cargo check` errors gave the cross-module `use` lines and the six visibility changes. Windows-only code isn't compiled here, so a name scan looked for crate items it uses from other modules; only `CREATE_NO_WINDOW` turned up, now imported under `#[cfg(windows)]`.
- `pnpm site:build` passes after every commit, but the rebuilt `docs/demo` assets are **not committed**. Their hashes change with module structure, not behaviour, and a rebuild per move would add ~1 MB of churn each time. Rebuild once on `main` if wanted.

Checks after every commit: `pnpm build`, `pnpm test`, `pnpm check:wiring`, `pnpm site:build`, `pnpm notices --check`, clippy `-D warnings`, `cargo test` (4 jobs).

## Phase 1 rules
- Moves only: no behaviour change, no reformatting. `git diff -M --color-moved` should show moved blocks.
- Allowed edits beyond moving: import/`use` lines, `export`/`pub(crate)` on items another file now needs, `mod` declarations, and the paths in `lib.rs`'s `generate_handler!`.
- Import sites are updated to the new modules; `components.tsx` doesn't re-export what moved out.

## Phase 1a: components.tsx (6132 lines)
| New file | Sections moved |
|---|---|
| `src/menus.tsx` | dynamic menu expansion, Menubar + dropdowns, ContextMenu |
| `src/Sidebar.tsx` | Sidebar |
| `src/preview/FilePreview.tsx` | file preview (text/hex/folder/pdf/audio), FilePreview, QuickLook |
| `src/preview/Inspector.tsx` | Inspector, PermissionsGrid, `InspectableFile` |
| `src/dialogs/*.tsx` | one file per dialog; `dialogs`/`DialogHost` in `dialogs/DialogHost.tsx` |

Left in `components.tsx`: Titlebar, Toolbar, FilePane, StatusBar, Palette, Tweaks.

Import sites to update: `App.tsx`, the handlers and `transferUi.ts` (`dialogs`), `Miller.tsx`, `tabs.ts`, `bulkRename.test.ts`, `routing.test.ts`'s `vi.mock` path, and `site/demo/mock/install.ts` (it imports `dialogs`). `audit-wiring.mjs` walks all of `src/`, so senders in moved code stay visible.

## Phase 1b: commands.rs (5381 lines)
`commands.rs` stays as the module root (`mod` lines only). Modules, along the section headers:
| Module | Sections |
|---|---|
| `listing` | `FileEntry`, `list_dir`, `is_hidden`, `kind_from_ext`, `home_dir` |
| `git` | git status, list_dir's status helpers, blame, stage/unstage/discard, per-file info, `git_run`/branches |
| `fs_ops` | file operations (incl. read/write text, image), chmod, links, shortcut, shred, chown |
| `file_info` | hex dump, diff, verify signature, extended stat |
| `search` | find in files, find file by name |
| `archive` | compress, archive create/extract |
| `hash` | sha256 and the other checksums |
| `config` | pins/tags, recent paths |
| `system` | system info, drives, fs type, net rate |
| `wsl` | WSL distros, `win_to_wsl` |
| `launch` | open/reveal, terminal and VS Code, run script, open url, new window, `spawn_terminal_profile` |
| `pty::profiles` | `ShellProfile`, shell/WSL/ssh detection, `check_profile` |

Tests go next to their code as `<module>/tests.rs`, including the old inline `mod tests` and this branch's `fs_tests`/`archive_tests`/`parser_tests`. Shared test helpers stay in `commands/testing.rs`. `lib.rs` lists commands by their new paths; `build.rs` matches on the last path segment, so `permissions/app.toml` doesn't change.

## Phase 2
Design: `docs/decisions/2026-11-10-split-big-files-app-routing.md`.
- **Keymap:** the bindings keep each old branch's modifier rules (`any`). The Ctrl+G chord, pane cycling and Escape stay as App code. `CHEATSHEET` replaces the dialog's hand-written list. check:wiring reads `send:` labels.
- **Routing:** the case bodies moved verbatim into `handlers/target.ts`, `app.ts` and `fileOps.ts`, with App's names passed as `ctx.app`. `return;` became `return true;`, and the defaults return false. The router is sync-first, and its try/catch covers the whole chain (the one intended behaviour change). `cmdState` holds the clipboard and the context target. check:wiring reads `COMMAND_CHAIN`, and a planted duplicate case is still reported.
- **Smoke-tested** in the browser-only dev server: Ctrl+B/J/P/1/2, F1, `/`, Escape, Select All from the menu, Bulk Rename from the menu, and Duplicate Tab from a tab's context menu.

## Found, not fixed (for the lead)
Seven menu shortcut hints don't run their item's command. They're listed as `KNOWN_GAPS` in `keymap.test.ts`, which fails if one gets fixed without the list being updated:
- no binding: Ctrl+Q Quit, Ctrl+Shift+C Copy Path, Esc Deselect, `*` Select by Pattern…;
- Ctrl+Shift+` New Terminal Tab toggles the drawer, as Ctrl+` does;
- the File menu's Ctrl+` on "Open in Terminal" toggles the drawer instead;
- Ctrl+Shift+F on "Find & Replace in Files" opens Find in Files instead.
