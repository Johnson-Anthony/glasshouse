# Progress

## Done
- 2026-11-08: Merged `notices-screen` (c595720). Help → Third-party Notices, and a button in About, show every license text bundled under `src/assets/fonts`, with `LICENSES.md` as a clickable index. The texts load as a separate lazy chunk. Dependency license lists are task `dependency-notices`.
- 2026-11-08: Merged `script-kill-tree` (1fd8435). When `run_script` times out, it kills the script's whole process tree (a process group on unix, a job object on Windows; `src-tauri/src/proc_tree.rs`). A script that exits normally leaves its background children alone. The Windows code was type-checked against the MSVC target, but its test first runs on CI.
- 2026-11-08: Merged `pty-writer` (16293b0). `pty_write` only queues input for a writer thread per session, so a big paste into a raw-mode program that isn't reading no longer freezes the UI. Keystroke order is kept. See `docs/decisions/2026-11-08-pty-writer-queue.md`.
- 2026-11-08: Merged `pages-site` (6f72fd7). It goes live on the next push of `main`.
  - The Pages site has a hero image of the real UI for each theme, and a theme picker that recolors the page and the demo.
  - Six recorded clips: terminal, tabs, git, Quick Look, paste conflicts, palette.
  - A live browser demo of the real React UI over a mocked backend, about 300 KB and loaded on click.
  - The existing text is unchanged.
  - Rebuild with `pnpm site:build`, `pnpm site:capture` and `pnpm site:capture check` (18 browser checks). About 8 MB under `docs/`.
- 2026-11-08: Merged `font-licenses` (19e7dd0). The Nerd Font is shipped as woff2 (lossless, 9.2 → 3.7 MB). Its license and glyph-set notices are in `src/assets/fonts/nerd-fonts/`, indexed by `LICENSES.md`, and `offline.test.ts` fails on an unlicensed font file.
- 2026-11-08: Merged `no-clobber-fs` (7970a86). `write_text`, `make_dir` and `rename_entry` refuse an existing target unless asked to overwrite.
  - Rename uses `renameat2(RENAME_NOREPLACE)` on Linux and `MoveFileExW` without replace on Windows.
  - The name prompt shows the refusal inline.
  - See `docs/decisions/2026-11-08-no-clobber-fs-design.md`.
- 2026-11-08: Merged `dead-code`'s Rust part (27340c6).
  - Removed the uncalled commands `ping`, `wsl_to_win`, `set_always_on_top` (with the `window` permission group) and `git_dirty_count` + `git_ahead_behind`. Their logic is still tested through `git_status`. 69 commands remain.
  - Dropped the dependencies thiserror, anyhow, tokio, walkdir and grep-matcher.
  - The three hash commands share one read loop.
  - `rust-version` is 1.88, and Cargo.lock is now format v4.
  - See `docs/decisions/2026-11-08-dead-code-uncalled-commands.md`.
- 2026-11-08: Merged `local-fonts` (ff0327c). The font picker's JetBrains Mono, IBM Plex Mono and Fira Code are bundled as the upstream woff2 files, with their OFL texts, so the app makes no Google request at startup. The CSP allows only `*.localhost` origins, and `src/offline.test.ts` keeps it that way.
- 2026-11-08: Merged `command-security` (885bd2a). See `docs/decisions/2026-11-08-command-security-design.md`.
  - **App ACL:** `src-tauri/permissions/app.toml` puts every command in one of 7 groups, granted to the main window for local pages only. Before this, any page could call all of them. `build.rs` fails the build if a command is missing from it.
  - **Argument checks:**
    - Terminal profiles must be detected shells, `-d <distro>` or a plain ssh host.
    - `git_run` takes only the git menu's subcommands and flags.
    - `open_url` takes only http, https and mailto.
    - tar and 7z get `--` before member names.
  - **Windows:** no user strings pass through `cmd /C` or PowerShell code any more. That covers opening files and URLs, VS Code, `.bat` scripts, Windows Terminal, signatures and shortcuts.
  - **Hostile repos:** `git_file_info` no longer runs a repo's fsmonitor, filters or gpg program.
  - **Limits:** `run_script` has a 60 s timeout and a 1 MiB output cap, and `read_image_b64` a 64 MiB ceiling.
  - **Release builds:** devtools are off. The CSP allows data: media (the audio preview had been blocked).
- 2026-11-08: Merged `unsent-labels` (8828d97).
  - Removed 75 command cases that nothing sends (aliases, and no-op cases for submenu parents). App.tsx and the handlers went from 292 switch cases to 212.
  - View → Display Mode → Miller Columns (ranger) is back, on Ctrl+7. The view worked, but its menu item had been dropped in April.
  - `pnpm check:wiring` now also fails on cases for labels nothing sends.
- 2026-11-08: Merged `async-commands` (9c3eefe).
  - 54 commands and `pty_spawn` run off the main thread (`#[tauri::command(async)]`). A 25 s hash no longer freezes the UI; a main-thread ping answered in a 1 ms median during one.
  - Commands that rely on call order stay on the main thread: pins, tags and recents config, watch_dir and unwatch_dir, and pty_write, pty_resize and pty_kill.
  - Git labels in `list_dir` scan only the listed folder, about 3x faster in a big repo, and rows show before the whole-repo `git_status` returns.
  - `git_branch_list` makes one `for-each-ref` call, and a deleted upstream is reported as `upstream_gone`.
  - See `docs/decisions/2026-11-08-async-commands-threading.md`.
- 2026-11-08: Merged `dead-code`'s frontend part (d61379a).
  - It removed 19 handler cases that App.tsx always handled first, plus HexDialog, the mock data and four unused api.ts wrappers.
  - It also removed three menu toggles that did nothing: Show Ignored, Show Checksums and Browse archive in place (see `docs/decisions/2026-11-08-dead-code-toggles.md`).
  - Select by Tag now works, and themes come from one list.
  - `pnpm check:wiring` (the reworked `scripts/audit-wiring.mjs`) runs in CI and fails on unhandled, shadowed or no-op menu labels.
  - The Rust part merged later the same day (see above).
- 2026-11-08: Merged `linux-parity`:
  - symlinked folders list and sort as folders;
  - Reveal selects the item via FileManager1 D-Bus;
  - HOME is used on unix, and drive labels come from /dev/disk/by-label;
  - codium/7zz/7za are found, and $SHELL is the first profile;
  - `trash_dir` for Go to Trash.
  Merged `create-rename-conflicts`: New File/Folder/Note/Script/Template and Rename (single and bulk) refuse taken names inline, and Bulk Rename runs in a safe order with rollback.
- 2026-11-08: Merged `copy-undo-guard`. Undoing a copy fingerprints the copies (size+mtime, plus the entry list for folders) and refuses the whole step if anything changed, went missing, or the tree has more than 20,000 entries.
- 2026-11-08: **Published** the plain-language README, Pages site text and descriptions as `4b8043a` on GitHub `main` (text-only commit on top of the old `origin/main`), and set the new repo description and topics. Everything else is still local; until the full push, the old nickname remains on GitHub in a few code files (`App.tsx`, `components.tsx`, `data.ts`, `handlers/misc.ts`).
- 2026-11-08: Merged `undo-redo`. UndoEntry has a required `redo`, built by `src/undoActions.ts`. Undo and redo steps check that target paths are free, undoing New Folder deletes non-recursively, undoing a new file refuses if it changed, and steps run one at a time. Closing the last tab opens Home, and private tabs keep their label. **Needs one manual pass in the real app:** rename, then Ctrl+Z, then Ctrl+Y.
- 2026-11-08: Merged `backend-bugs` (PTY sessions cleaned up on exit, poison-safe locks, one git status code everywhere, real git errors, `wsl_to_win` drive roots, in-process `.tar.zst` via the zstd crate) and `paste-conflicts` (every copy/move plans targets against the destination: "(copy)" names, a keep both / replace / skip / cancel prompt, Replace trashes the old item, and undo only removes what was created).
- 2026-11-08: Merged `presentation`: plain public copy (README, Pages site text, descriptions, window title, release-notes template); the old nickname is gone from code and docs. Settings key is now `glasshouse.tweaks` (saved tweaks reset once), and the layout export file is `.glasshouserc`. The lead session's id now lives in `git config claude.lead`.
- 2026-11-08: Merged `tab-state` (stable tab ids, side-effect-free nav history, listing errors and loading shown in the pane; Duplicate Tab keeps a private tab private). Follow-up `undo-redo` started.
- 2026-11-08: Merged `symlink-safety` (shred/copy never follow links; copy/move into itself refused), `ui-fixes` (strict chmod, real lossy-name guard labels, shortcuts, About version/link) and `platform-paths` (case-sensitive paths off Windows, `\` in Linux names, WSL path). Vitest on `main` now runs only `src/` tests. Launcher binary rebuilt.
- 2026-11-08: Set up as a long-running project (CLAUDE.md, PROGRESS.md, docs/SPEC.md, docs/ARCHITECTURE.md, plans/decisions folders). Linux arm64 build env set up (see `~/.claude/environment.md`); the release build is linked into the fuzzel launcher. The codebase survey is the backlog in `docs/plans/active/survey-fixes.md`.

## In progress
- Survey-fix pass: 12 tasks, each in its own worktree session, run a few at a time by the lead session. Per-task scope and status are in `docs/plans/active/survey-fixes.md`; each session keeps its detail in `docs/plans/active/<task>.md` on its branch.

## Next
1. Merge task branches into `main` as they finish, in the merge order in `survey-fixes.md`. After each merge, rerun all checks and update this file and the task's status.
2. Start `split-big-files` only after the other branches are merged.
3. Settle the open questions in `docs/SPEC.md` (remote browsing, macOS, command-line path, `origin/feature`).
4. **Before the first push:** run `pnpm site:build` (and `pnpm site:capture` plus `check` if the UI changed visibly) so the demo matches `main`; since pages-site merged, notices-screen has added a Help item. Also reword unpushed commit `ee1dd9b`, whose message contains the old nickname. Rewrite only `origin/main..main` (e.g. `git filter-branch --msg-filter` on that range) once every task branch that contains it is merged, so it can't come back.
5. Tag a v0.2.0 release once the pass is merged and CI is green.

## Broken / known issues
- Renames can still race where `renameat2(RENAME_NOREPLACE)` isn't available (non-Linux unix, NFS, older FUSE), which falls back to check-then-rename. no-clobber-fs's Windows code (`MoveFileExW`, file-id identity) is uncompiled until Windows CI.
- Unix: if a terminal session ends while its pty input is full, its writer thread and pty stay until the app exits (task `pty-drain`). The UI isn't affected.
- Windows is untested for the scoped git-label scan. If `list_dir_git_labels_scan_only_the_listed_folder` fails on Windows CI after the first push, the scan falls back to the whole repo there: labels stay correct, but the test needs adjusting.
- **command-security's Windows code has never been compiled**; the first windows-latest CI run is its first build. Worth trying by hand on Windows:
  - open a URL with `&` in it;
  - Open in Terminal on a folder named `a&b;c`, with and without Windows Terminal;
  - Verify Signature on a file named with a curly apostrophe (`Tom’s.exe`).
- Saved ssh remotes are limited to ASCII host names. A timed-out script's tree is hard-killed with no grace period, and processes that `setsid` out of its group aren't reached.
- `origin/feature` has one unmerged commit from April, `ddb5466` (14 files, +2470/-492, merge base 23 commits behind `main`, so it won't merge cleanly). It contains: a Windows terminal-launch probe (`terminal_probe.rs`, HKCU DelegationTerminal, wt/DelegatedConsole), a menubar outside-click fix, and assorted polish (terminal drawer, themed dialogs, sidebar keyboard/drag-and-drop, remote manager, private tabs, About). Its "drive label dedup" is one Sidebar line, which `linux-parity` ports. The rest is undecided: cherry-pick parts or drop it.
