# split-big-files

Branch: `claude/exciting-davinci-df48b1` (worktree `exciting-davinci-df48b1`), from main 54a1e15. Both frontend and Rust; the only session running.

## Status
- [ ] Phase 1a: `components.tsx` → `menus.tsx`, `Sidebar.tsx`, `preview/`, `dialogs/` (one commit each)
- [ ] Phase 1b: `commands.rs` → `commands/` modules; shell profiles → `pty/profiles.rs`
- [ ] Phase 1 reported to the lead
- [ ] Phase 2: App.tsx keymap table; `handleMenuCommand`/`doFileOp` into the handlers (design in docs/decisions/)

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
Design to be written in `docs/decisions/` before starting.
