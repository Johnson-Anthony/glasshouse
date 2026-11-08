# Progress

## Done
- 2026-11-08: Set up as a long-running project (CLAUDE.md, PROGRESS.md, docs/SPEC.md, docs/ARCHITECTURE.md, plans/decisions folders). Linux arm64 build env set up (see `~/.claude/environment.md`); the release build is linked into the fuzzel launcher. The codebase survey is the backlog in `docs/plans/active/survey-fixes.md`.

## In progress
- Survey-fix pass: 11 tasks, each in its own worktree session. Per-task scope and status are in `docs/plans/active/survey-fixes.md`; each session keeps its detail in `docs/plans/active/<task>.md` on its branch.

## Next
1. Merge task branches into `main` as they finish, in the merge order in `survey-fixes.md`. After each merge, rerun all checks and update this file and the task's status.
2. Start `split-big-files` only after the other branches are merged.
3. Settle the open questions in `docs/SPEC.md` (remote browsing, macOS, command-line path, `origin/feature`).
4. Tag a v0.2.0 release once the pass is merged and CI is green.

## Broken / known issues
- **Data loss:** Copy then Paste in the same folder empties the file (`fs::copy` onto itself), and undoing that paste deletes the original (task `paste-conflicts`). Merging `symlink-safety` turns the emptying into an error.
- `shred` follows symlinks: it overwrites the link's target and deletes only the link (task `symlink-safety`).
- All Rust commands are synchronous and run on the main thread, so heavy operations freeze the UI (task `async-commands`).
- Custom commands have no permission gating, and devtools are enabled in release builds (task `command-security`).
- `scripts/audit-wiring.mjs` can't run: it reads the deleted `design/` folder (task `dead-code`).
- `origin/feature` has one unmerged commit from April (`ddb5466`: layered terminal probe, menubar close fix, drive label dedup) that nobody has reviewed.
- The `rust-version = "1.77"` in `Cargo.toml` is stale: the locked dependencies need rustc 1.88 or newer.
