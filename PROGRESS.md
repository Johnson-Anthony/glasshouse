# Progress

## Done
- 2026-11-08: Merged `symlink-safety` (shred/copy never follow links; copy/move into itself refused), `ui-fixes` (strict chmod, real lossy-name guard labels, shortcuts, About version/link) and `platform-paths` (case-sensitive paths off Windows, `\` in Linux names, WSL path). Vitest on `main` now runs only `src/` tests. Launcher binary rebuilt.
- 2026-11-08: Set up as a long-running project (CLAUDE.md, PROGRESS.md, docs/SPEC.md, docs/ARCHITECTURE.md, plans/decisions folders). Linux arm64 build env set up (see `~/.claude/environment.md`); the release build is linked into the fuzzel launcher. The codebase survey is the backlog in `docs/plans/active/survey-fixes.md`.

## In progress
- Survey-fix pass: 12 tasks, each in its own worktree session, run a few at a time by the lead session. Per-task scope and status are in `docs/plans/active/survey-fixes.md`; each session keeps its detail in `docs/plans/active/<task>.md` on its branch.

## Next
1. Merge task branches into `main` as they finish, in the merge order in `survey-fixes.md`. After each merge, rerun all checks and update this file and the task's status.
2. Start `split-big-files` only after the other branches are merged.
3. Settle the open questions in `docs/SPEC.md` (remote browsing, macOS, command-line path, `origin/feature`).
4. Tag a v0.2.0 release once the pass is merged and CI is green.

## Broken / known issues
- Copy then Paste in the same folder now fails with an error instead of emptying the file (since `symlink-safety`); pasting onto an existing same-name item still replaces it silently, and the paste's undo can delete the original (task `paste-conflicts`).
- All Rust commands are synchronous and run on the main thread, so heavy operations freeze the UI (task `async-commands`).
- Custom commands have no permission gating, and devtools are enabled in release builds (task `command-security`).
- `scripts/audit-wiring.mjs` can't run: it reads the deleted `design/` folder (task `dead-code`).
- `origin/feature` has one unmerged commit from April (`ddb5466`: layered terminal probe, menubar close fix, drive label dedup) that nobody has reviewed.
- The `rust-version = "1.77"` in `Cargo.toml` is stale: the locked dependencies need rustc 1.88 or newer.
