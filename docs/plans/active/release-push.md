# release-push: every queued task, then a release

The owner asked on 2026-11-23 for agents to finish every queued task so glasshouse can have a release, without stopping. The lead session runs this as a loop: it starts each task as a background agent in its own worktree, reviews and merges what comes back, and starts the next.

## Order
Up to three agents at a time. Tasks that share files run one after the other.

| Step | Tasks | Why this order |
|---|---|---|
| 1 | 34 windows-paths, 36 os-clipboard, 38 a11y | the first of each area; 38 is frontend only |
| 2 | 39 locale-and-names, 41 devices, 42 transfers-and-cloud | as step 1's finish |
| 3 | 16 menu-honesty (after 38: both change the file list), 37 linux-launch-env, 25 folder-size (after 42) | |
| 4 | 51 thumbnails (after 16), 49 appimage-menu-entry (after 37), 26 test-gaps, 52 small-fixes | |
| 5 | 44 e2e-core-flows (after 16, 36 and 38: it drives their UI), 45 e2e-nightly-matrix, 46 release-smoke | CI work is checked by the lead's pushes |
| 6 | 28 deps-bump, alone | it changes both lockfiles |
| 7 | release prep: version, CHANGELOG section, a last full check | the tag and the signing secrets wait for the owner's OK |

Follow-ups the agents find go under "Found by tasks" in `survey-3.md`. A bug in something this release ships is fixed before the release (in task 52 or its own task); a new feature or a wider rework is marked "after the release" and waits.

Tasks 16–28 are in `survey-2.md`, the rest in `survey-3.md`. Each backlog's Status table is the record of what's running and merged.

## Worker rules
These add to CLAUDE.md's rules for task branches. The lead is the session that started you: write to it with SendMessage to "main".

**Start**
- Your worktree is new. Check `git log --oneline -1` against `origin/main` (`git fetch`); if you're behind, `git reset --hard origin/main`. Then `git checkout -b claude/<task-name>` and `pnpm install` (with `COREPACK_ENABLE_DOWNLOAD_PROMPT=0`).
- Read CLAUDE.md, your task's section in its backlog, every "Found by tasks" line in `survey-3.md` that names your task's number, and `docs/ARCHITECTURE.md`.
- Write a short plan to `docs/plans/active/<task-name>.md` (files, steps, tests), send the lead a summary, then build. Don't wait for an answer.

**Decisions**
- Decide what you can undo, and record a real choice in `docs/decisions/<yyyy-mm-dd>-<task-name>-<topic>.md`. Ask the lead only when you're blocked, or when a choice changes what users see in a way your task's section doesn't settle.
- This is a production app for any user on Windows or any Linux desktop. Don't build for the owner's own setup.
- If part of the task turns out much bigger than its size says, do the rest, hand off, and describe the part as a new task in your report.

**Scope**
- Keep the diff to your task. `App.tsx`, `components.tsx` and `src-tauri/src/commands/` are shared: don't reformat or move code you aren't changing.
- Don't edit `PROGRESS.md`, `CHANGELOG.md`, the survey backlogs or this file.
- Don't push, open PRs, or change anything on GitHub.
- Never stop, signal or hand off to the owner's running glasshouse, and never touch their real config or data: hand tests use scratch `HOME`/`XDG_*` folders and a debug build (its D-Bus name is `…AppDebug`).

**This machine** (15 GB RAM, no swap; see `~/.claude/environment.md`)
- Run every heavy command through `heavy-job`, in the background: `heavy-job cargo clippy …`, `heavy-job -m 3G pnpm test`, `heavy-job -m 3G pnpm site:capture check`, `heavy-job pnpm tauri build --debug --no-bundle`, `heavy-job -m 2G pnpm e2e`, and any Xvfb, browser or GUI run. It caps memory and lets two run at once across all agents; yours may wait in line, so don't use a short timeout.
- cargo with `-j 4`. Check `df -h /` before your first cargo build, and tell the lead if under 12 GB is free.
- A frontend-only task doesn't build Rust in its worktree. Say so in your report; the lead runs the Rust checks and e2e at the merge.

**Checks before handoff** (all must pass; give numbers)
- `pnpm build`, `pnpm test`, `pnpm check:wiring`, `pnpm notices --check` (after `pnpm notices` if a lockfile changed).
- Rust tasks: `RUSTFLAGS="-D warnings" cargo clippy --all-targets`, `cargo test`, then `pnpm tauri build --debug --no-bundle` and `pnpm e2e`.
- `pnpm site:build` (commit a changed `docs/demo`), then `pnpm site:capture check`.
- New behavior has tests: vitest, cargo, and an e2e flow where a real window is the only proof.
- Windows code can't be built here. Type-check pure-Rust helpers through a scratch crate, mind the dead-code gotcha in CLAUDE.md, add hand checks to `docs/testing/windows.md`, and list what wasn't built.

**Handoff**
- Fill in your plan's Status and move the plan to `docs/plans/completed/`.
- Commit on your branch. End each message with `Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>`.
- Your last message is the report: branch, commits, check results, what wasn't built or run, what the lead should review, follow-ups you found but didn't do, and CHANGELOG lines (New / Changed / Fixed, plain sentences for users, in the style of `CHANGELOG.md`).
- If you pass about 60% of your context before you're done, commit what works, write the plan's Status precisely, and report: another agent continues from the plan.
