# Survey-fix pass

This fixes what the 2026-11-08 codebase survey found. There's one task per worktree session, and each session writes its own `docs/plans/active/<task>.md`.
This file is the backlog. It is only edited on `main`, when a branch is merged (see "Parallel task branches" in CLAUDE.md).
Line numbers are from commit `14c68bd` and drift, so search by name. Items marked *(inferred)* came from reading the code and haven't been reproduced yet; confirm them before fixing.

## Status
| Task | Area | Status |
|---|---|---|
| symlink-safety | Rust | **merged** (60e4eef) |
| paste-conflicts | frontend | **merged** (2b26099) |
| create-rename-conflicts | frontend | running (found by paste-conflicts; same session) |
| ui-fixes | frontend | **merged** (dfe77ca) |
| tab-state | frontend | **merged** (971da66) |
| undo-redo | frontend | **merged** (e1b7067) |
| copy-undo-guard | frontend | queued, low priority (found by undo-redo) |
| platform-paths | frontend | **merged** (2d9fcaf) |
| backend-bugs | Rust | **merged** (3ece93d) |
| linux-parity | Rust + a little frontend | running |
| command-security | Rust + config | running |
| async-commands | Rust | queued |
| dead-code | both | queued |
| test-coverage | both | queued |
| presentation | docs + small code | **merged**; GitHub text awaits the user |
| split-big-files | both | **wait until all the others are merged** |

Merge order is the table order: small, contained fixes go first, and broad changes go last, so the broad ones absorb the conflicts.

## Every task
- Your worktree should contain this file. If `PROGRESS.md` is missing, run `git merge main` first.
- Read CLAUDE.md, PROGRESS.md, docs/ARCHITECTURE.md and your section below.
- Write your plan to `docs/plans/active/<task>.md`, then implement it; no OK is needed. For a design choice, pick the option you'd recommend and record it in `docs/decisions/`.
- **Before calling it done:** `pnpm build` and `pnpm test`. For Rust tasks, also `RUSTFLAGS="-D warnings" cargo clippy --all-targets` and `cargo test` in `src-tauri`. Add tests for what you fix.
- **Wrap up** as CLAUDE.md describes for task branches. Don't push.

## symlink-safety (Rust, small)
- `shred` (`commands.rs` `fn shred`, ~L1896) uses `fs::metadata` and then opens the path. Both follow symlinks, so it overwrites the **link target** and then deletes only the link. Use `symlink_metadata`, and decide what shredding a symlink means (probably: remove the link and never touch the target).
- `copy_dir_recursive` copies symlink targets instead of the links. A link to a directory makes the copy fail partway through.
- Nothing stops copying or moving a directory into itself (`copy_entry`, `move_entry`).
- `move_entry` falls back to copy plus recursive delete on **any** rename error (~L422). Limit the fallback to cross-device errors.
- Add tempdir-based unit tests for each case.

## paste-conflicts (frontend, small; found 2026-11-08 by symlink-safety)
- `case "Paste":` in `src/App.tsx` (~L1401) builds `dst = joinPath(cwd, basename(src))` and calls `copyEntry`/`moveEntry` without checking whether `dst` exists.
- **Data loss on `main`:** Copy, then Paste in the same folder, makes `dst === src`.
  - Rust `copy_entry` then calls `std::fs::copy(a, a)`, which truncates the file to 0 bytes. For a folder, every file in it is emptied.
  - The paste's undo entry for a copy deletes `dst`, so undoing it deletes the **original**.
  - After symlink-safety merges, `copy_entry` refuses same-path and into-itself copies, so pasting in place errors instead.
- Pasting onto an existing item with the same name silently replaces it (`fs::copy` and rename both overwrite). A cut-paste of a folder onto an existing non-empty folder used to merge and then delete the source; after symlink-safety it errors.
- **Wanted:** when the destination exists (including `dst === src`), pick a free name ("name (copy).ext", then "name (copy 2).ext") and/or ask: replace / keep both / skip.
  - Check whether `performDrop` (it already skips `src === dst`) and the FolderPicker "Move to…" flow need the same.
  - Keep the undo entries correct; they record src/dst pairs.
  - Add vitest coverage for the name-picking helper.

## create-rename-conflicts (frontend; found 2026-11-08 by paste-conflicts) — data loss
- **New File / Markdown Note / Script (.sh)** call `writeText` on `dir/name`. Rust `write_text` is `fs::write`, so an existing file with that name is emptied, and its undo then deletes it.
- **New Folder** uses `create_dir_all`, which succeeds on an existing folder. Its undo then recursively deletes that **pre-existing** folder.
- **Rename** (selection, context target and BulkRenameDialog) calls `rename_entry` = `fs::rename`, which replaces an existing file at the destination.
- **Fix:** check the name against the target folder first, reusing `transfer.ts`'s `pickFreeName` and the `readDir` listing; compare case-insensitively on Windows. Then refuse, or suggest a free name. Undo must never delete something that existed before the operation.
- **Coordinate with undo-redo,** which is changing `UndoEntry` and the `pushUndo` sites in `App.tsx`. Keep your edits to the checks before each operation, and `git merge main` before finishing.

## copy-undo-guard (frontend, low priority; found 2026-11-08 by undo-redo)
- Undoing a copy still deletes the copies recursively, even if they were edited after the copy. Guard it the way `createUndo` guards new files: refuse when contents changed since the copy, which needs size, mtime or content hashes recorded at copy time. Builders are in `src/undoActions.ts`.

## undo-redo (frontend; found 2026-11-08 by tab-state)
- **Redo is broken.** `UndoEntry` only has `inverse`, and redo calls that same inverse again. For example, after undoing a rename, redo tries to rename back a second time and fails with "redo failed". Add a forward action to `UndoEntry` and have redo call it. There are about 13 `pushUndo` sites in `src/App.tsx`.
- **Coordinate with paste-conflicts:** that branch is changing Paste's undo entries. Do Paste's entry last, and `git merge main` before finishing to pick up paste-conflicts if it has merged by then.
- `closeTabAt` lets you close the last tab, which leaves zero tabs. Keep at least one, for example by opening Home.
- The label-sync effect overwrites a private tab's "(private)" label once you navigate.
- Add vitest coverage for undo then redo round trips.

## ui-fixes (frontend, small)
- **chmod:** `parseInt(v, 8)` accepts partial input ("78" becomes 7, "0o755" becomes 0) and applies the result (`handlers/tools.ts` ~L451, ~L456). Validate strictly, e.g. `/^[0-7]{3,4}$/`.
- **Lossy-name guard:** `MUTATING_OPS` (`App.tsx` ~L1237) lists labels that don't exist: "Batch Rename…", "Shred…", "Compress to Zip…". The real ones are "Bulk Rename…", "Shred (srm)" and "Compress to ZIP…". It also misses Delete, git, archive and paste-as-link actions. If practical, derive the list from `data.ts` instead of typing it out.
- **Shortcuts:** the palette's Ctrl+P hint for "Find File" clashes with the palette toggle itself (`App.tsx` ~L645). The "Ctrl G C" commit chord has no handler.
- **About dialog:**
  - It shows version "0.0.1" (`data.ts` L5); read the real one with `getVersion()`.
  - Its "built on" date is simply today.
  - Its links point to `anthony/glasshouse` (`handlers/misc.ts` ~L161–176) instead of `Johnson-Anthony/glasshouse`.

## tab-state (frontend)
- Tabs are keyed by index (`App.tsx` ~L2188 `key={i}`), and `useTabState` reads `initialPath` only when it mounts. Closing a middle tab leaves the closed tab's state in that slot, and the last tab's handle stops responding. Give tabs stable ids. `moveTab` doesn't reorder the TabShells either (nothing calls it yet).
- `TabState.error` and `.loading` are never shown. `listDir` goes through `safe()` and returns `[]` on error, so unreadable folders look empty. Show the error.
- *(inferred)* `goTo`, `back` and `forward` run side effects (other setters, `appendRecent`) inside state updaters (`state.ts` ~L225–259). StrictMode runs updaters twice in development, so history entries probably get duplicated. Move the side effects out of the updaters.
- Add tests for the pure history and undo logic.

## platform-paths (frontend)
- `normalizePath` always lowercases (`paths.ts` L7). Paths should compare case-insensitively only on Windows. This affects `fs-changed` matching and the Properties lookup.
- Any `\` is treated as a Windows separator (`paths.ts` L14, L47; `splitBreadcrumb` in `components.tsx` ~L469), but it's a legal filename character on Linux.
- Copies of path helpers survive outside `paths.ts` (`components.tsx` ~L596, ~L3898, ~L5718–5729). Replace them with the `paths.ts` versions.
- *(inferred)* UNC breadcrumbs drop the leading `\\`.
- "Go to WSL Distro…" opens `/mnt/wsl/<name>` (`handlers/nav.ts` ~L156) instead of the backend's `\\wsl$\name\` (`commands.rs` ~L336). The sidebar already does this correctly (`components.tsx` ~L981).
- Extend `paths.test.ts`: `basename`, `splitBreadcrumb`, Linux names containing `\`, case handling.

## backend-bugs (Rust)
- PTY sessions are never removed from the registry when the child exits (`pty.rs` ~L178–187). The mutex `.unwrap()`s in `pty.rs` (~L41, 189, 211, 217, 230, 247) combined with `panic = "abort"` mean any poisoned lock kills the app.
- `git_status` labels untracked files "add" (~L557), while `list_dir` uses "?" (~L162). Its "ignored" label can never appear.
- `wsl_to_win("/mnt/c")` returns `\mnt\c`.
- The comment at ~L1441 promises a zstd fallback that ~L1593 doesn't have. Implement it or correct the comment.
- `git_dirty_count` (~L2844) and `git_ahead_behind` (~L2986) hide failures by returning `Ok(default)`. Return real errors where the UI can show them, and update `src/api.ts` if a signature changes.

## linux-parity (Rust + a little frontend)
- `list_dir` uses metadata that doesn't follow links (~L73, ~L82), so symlinked directories are listed as files. Follow the link to decide whether it's a directory, and still mark the entry as a link.
- `reveal_in_explorer` on Linux opens the parent folder without selecting the file (~L630). Use the opener plugin's reveal (already allowed by `opener:default`) or the `org.freedesktop.FileManager1` `ShowItems` D-Bus call.
- `home_dir` checks `USERPROFILE` before `HOME` (~L43). Check `HOME` first on unix.
- The drive "label" is the device name (~L286). **First check `origin/feature` commit `ddb5466` ("drive label dedup").**
- Tool lookup only knows `code` (~L823) and `7z`; also try `codium` and `7zz`. The shell list is hardcoded (~L2270) and ignores `$SHELL`.
- *(inferred)* `set_always_on_top` is probably a no-op on Wayland (niri). Verify it, and hide the action where it can't work.
- The frontend hardcodes trash as `~/.local/share/Trash/files` (`handlers/nav.ts` ~L238). Respect `XDG_DATA_HOME`, or ask the backend for the path.

## command-security (Rust + config: design first)
- **No command permissions:** `build.rs` has no app manifest, so the webview can call every custom command. That includes:
  - `run_script` (~L2017, no timeout);
  - `pty_spawn` with any executable (`pty.rs` ~L88);
  - `git_run` with any arguments, including `-c`.

  The CSP is the only barrier. Options: a Tauri 2 app manifest (`tauri_build::Attributes::app_manifest`) with capabilities listing the allowed commands, plus argument validation on the dangerous ones.
- The `devtools` feature is enabled in release builds (`Cargo.toml` L17). Gate it behind debug builds or a feature flag.
- **CSP:** Google Fonts are allowed. Check whether they're still needed now that the fonts are bundled. There's no `media-src`, so the `data:` audio preview (`components.tsx` ~L2673) is probably blocked.
- `read_image_b64` has no size cap (~L474).
- **Windows `cmd /C` injection:** user strings go through `cmd /C` (~L602, 839, 2072, 2373), so `&`, `|` or `^` in a filename or URL can inject commands. Spawn the process directly, or quote properly.
- **tar argument injection:** tar member names are passed without a `--` separator (~L1496, ~L1505).

## async-commands (Rust, wide: keep diffs line-local)
- All 65 commands in `commands.rs` are synchronous, so Tauri runs them on the main thread. The worst offenders:
  - `list_dir` (it also runs a whole-repo git status on every call, ~L116);
  - `find_in_files`, `find_file_by_name`, `hash_*`;
  - copy, move and delete; `compress` and `archive_*`;
  - `git_run` (network operations), `git_branch_list`, and `git_file_info` (two process spawns on every selection change);
  - `run_script`, `diff_files`, the preview readers, `system_info`, `shred`.
- Prefer `#[tauri::command(async)]` or `tauri::async_runtime::spawn_blocking` over rewriting the bodies. Other branches edit `commands.rs`, so keep changes on the attribute and signature lines where possible.
- `git_branch_list` turns per-branch rev-list failures into (0,0). Return or flag the error while you're changing it (found by backend-bugs).
- Consider making `list_dir`'s git status cheaper (cache it, or scope it to the directory). Progress events for long operations are optional: plan them, but don't build them unless they're small.
- Check that the UI stays responsive, for example while hashing a large file.

## dead-code (both; one removal per commit)
- `scripts/audit-wiring.mjs` reads the deleted `design/project/src/*.jsx` (L26–27). Either rework it against `data.ts` and the handlers, which would still catch unhandled labels and "theater" handlers, or delete it. If you keep it, consider running it in CI.
- About 20 handler cases never run because `App.tsx`'s own switches handle the same commands first. Examples:
  - nav: Home, New Tab, Open in Terminal/VS Code;
  - misc: Refresh, Preferences, the New-file items;
  - tools: Checksum, Compress →.

  Give each command one owner and remove the dead side.
- **Unused frontend code:**
  - `HexDialog` (`components.tsx` ~L4380);
  - mock data `FILES`, `SIDEBAR`, `TREE` (`data.ts` ~L109–180);
  - API functions with no caller: `ping`, `gitAheadBehind`, `setAlwaysOnTop`, `wslToWin`;
  - the `--scanlines` CSS variable;
  - the theme list, which is duplicated (`App.tsx` ~L839, `components.tsx` ~L3358).
- **Unused backend code:**
  - the `git_dirty_count` command;
  - the Rust dependencies `thiserror`, `anyhow`, `tokio`, `walkdir` and the direct `grep-matcher`.
- `components.tsx` renders a "!" git badge that can no longer appear, because backend-bugs removed the "ignored" status. `git_dirty_count` now returns `Result<Option<u32>>` and still has no caller.
- The hash read loop is copied three times (`hash_sha256`, `hash_md5`, `hash_crc32`). Merge it into one helper.
- **Toggles that do nothing:** "Show Ignored" and "Show Checksums" only flip their checkmarks, and "Browse archive in place" just opens the default app. Implement them, or remove or relabel them. Record the decision.
- Also fix the stale `rust-version` in `Cargo.toml` (the locked dependencies need 1.88 or newer).

## test-coverage (both)
- **Frontend:** only `fuzzy`, `paths` (without `basename`) and `shellCd` are tested. Add tests for:
  - command routing through the handler chain;
  - `stripWinOnly`, `splitBreadcrumb`, `canExtractArchive`, `winToUnc`;
  - the bulk-rename functions (`components.tsx` ~L3472–3525).

  Component tests would need jsdom and Testing Library, which aren't installed. Decide whether they're worth it.
- **Rust:** there are only 9 tests. Add tests for:
  - `list_dir`, delete, move and trash;
  - the tar and 7z paths, and the zip-slip guard;
  - the `/proc` parsers (mounts, `net/dev`), `ssh_hosts` parsing and terminal argument building;
  - the basics of the pty and watcher.
- Put new tests in new files where you can. Don't write tests that lock in behaviour other branches are fixing (symlinks, paths, chmod, tabs).

## presentation (docs + small code; added by the user 2026-11-08; **merged**)
The public copy is rewritten in a plain voice: README, the Pages site (same design), package and crate descriptions, the window title, the release-notes template, the settings key (`glasshouse.tweaks`) and the layout export file (`.glasshouserc`). The project's old nickname is gone from the code and docs.
- **Check:** `git grep -i 'r[i]ce' -- ':!src/assets/fonts'` must find nothing. The bundled Nerd Font files match only inside third-party glyph-name data.
- **Still to do, with the user's OK:**
  - apply the GitHub description and topics proposed in `docs/plans/completed/presentation.md`;
  - push `main`, so Pages updates.
- **The user decides separately:** git history and the unmerged `origin/feature` branch.

## split-big-files (both: only after every other task is merged)
- **`components.tsx`:** dialogs (~L3472–6105) into `src/dialogs/`, previews (~L2182–3096) into `src/preview/`, the Sidebar (~L710–1503) into its own file, and the menus into `menus.tsx`.
- **`App.tsx`:** turn the keydown handler (~L591–807) into a keymap table, which could also feed the Keybindings dialog, and move `handleMenuCommand`/`doFileOp` (~L906–1878) into the handlers.
- **`commands.rs`:** split along its `// ---------- … ----------` headers: fs_ops, listing, search, archive, git, hash, wsl, config, sysinfo/net, launch. Move `ShellProfile` next to the pty code.
- These are moves only, with no behaviour change. One area per commit, with all checks run after each.
