# Progress

## Done
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
  - The Rust part (unused commands and dependencies, shared hash loop, `rust-version`) waits for command-security.
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
- `pages-site`: the Pages site becomes an interactive showcase of the app (big project; spec in `docs/plans/active/pages-site.md` on its branch).
- Survey-fix pass: 12 tasks, each in its own worktree session, run a few at a time by the lead session. Per-task scope and status are in `docs/plans/active/survey-fixes.md`; each session keeps its detail in `docs/plans/active/<task>.md` on its branch.

## Next
1. Merge task branches into `main` as they finish, in the merge order in `survey-fixes.md`. After each merge, rerun all checks and update this file and the task's status.
2. Start `split-big-files` only after the other branches are merged.
3. Settle the open questions in `docs/SPEC.md` (remote browsing, macOS, command-line path, `origin/feature`).
4. **Before the first push:** reword unpushed commit `ee1dd9b`, whose message contains the old nickname. Rewrite only `origin/main..main` (e.g. `git filter-branch --msg-filter` on that range) once every task branch that contains it is merged, so it can't come back.
5. Tag a v0.2.0 release once the pass is merged and CI is green.

## Broken / known issues
- A few-ms race remains between the frontend's name check and the backend write, because `write_text`, `make_dir` and `rename_entry` still overwrite (task `no-clobber-fs`).
- `pty_write` can still block the main thread when a pty's input buffer is full, for example on a large paste into a program that isn't reading (task `pty-writer`).
- Windows is untested for the scoped git-label scan. If `list_dir_git_labels_scan_only_the_listed_folder` fails on Windows CI after the first push, the scan falls back to the whole repo there: labels stay correct, but the test needs adjusting.
- Custom commands have no permission gating, and devtools are enabled in release builds (task `command-security`).
- `origin/feature` has one unmerged commit from April, `ddb5466` (14 files, +2470/-492, merge base 23 commits behind `main`, so it won't merge cleanly). It contains: a Windows terminal-launch probe (`terminal_probe.rs`, HKCU DelegationTerminal, wt/DelegatedConsole), a menubar outside-click fix, and assorted polish (terminal drawer, themed dialogs, sidebar keyboard/drag-and-drop, remote manager, private tabs, About). Its "drive label dedup" is one Sidebar line, which `linux-parity` ports. The rest is undecided: cherry-pick parts or drop it.
- The `rust-version = "1.77"` in `Cargo.toml` is stale: the locked dependencies need rustc 1.88 or newer.
