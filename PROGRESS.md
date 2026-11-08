# Progress

## Done
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
4. **Before the first push:** reword unpushed commit `ee1dd9b`, whose message contains the old nickname. Rewrite only `origin/main..main` (e.g. `git filter-branch --msg-filter` on that range) once every task branch that contains it is merged, so it can't come back.
5. Tag a v0.2.0 release once the pass is merged and CI is green.

## Broken / known issues
- Redo re-runs the undo action instead of redoing, so it fails ("redo failed"); closing the last tab leaves zero tabs; navigating drops a private tab's "(private)" label (task `undo-redo`).
- Copy then Paste in the same folder now fails with an error instead of emptying the file (since `symlink-safety`); pasting onto an existing same-name item still replaces it silently, and the paste's undo can delete the original (task `paste-conflicts`).
- All Rust commands are synchronous and run on the main thread, so heavy operations freeze the UI (task `async-commands`).
- Custom commands have no permission gating, and devtools are enabled in release builds (task `command-security`).
- `scripts/audit-wiring.mjs` can't run: it reads the deleted `design/` folder (task `dead-code`).
- `origin/feature` has one unmerged commit from April, `ddb5466` (14 files, +2470/-492, merge base 23 commits behind `main`, so it won't merge cleanly). It contains: a Windows terminal-launch probe (`terminal_probe.rs`, HKCU DelegationTerminal, wt/DelegatedConsole), a menubar outside-click fix, and assorted polish (terminal drawer, themed dialogs, sidebar keyboard/drag-and-drop, remote manager, private tabs, About). Its "drive label dedup" is one Sidebar line, which `linux-parity` ports. The rest is undecided: cherry-pick parts or drop it.
- The `rust-version = "1.77"` in `Cargo.toml` is stale: the locked dependencies need rustc 1.88 or newer.
