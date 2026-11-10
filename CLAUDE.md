glasshouse is a Tauri 2 (Rust) + React 18 / TypeScript desktop file manager, Windows-first with Linux support.
Full spec: docs/SPEC.md · Architecture: docs/ARCHITECTURE.md

# Commands
- Install deps (also needed in every fresh worktree): `pnpm install`
- Run the app in dev mode: `pnpm tauri:dev`
- Frontend typecheck + build: `pnpm build` (runs `tsc -b && vite build`)
- Frontend tests: `pnpm test` (vitest)
- Rust lint, as CI runs it: `cd src-tauri && RUSTFLAGS="-D warnings" cargo clippy --all-targets`
- Rust tests: `cd src-tauri && cargo test`
- Release binary: `pnpm tauri build --no-bundle`, output at `src-tauri/target/release/glasshouse`. The bundle targets in `tauri.conf.json` are Windows-only (msi, nsis).
- Project site (`docs/`, GitHub Pages): `pnpm site:build`, then `pnpm site:capture` and `pnpm site:capture check`. See "Project site" in docs/ARCHITECTURE.md.
- No ESLint or Prettier is configured.

# Parallel task branches
Some work is split into task branches, each in its own git worktree with its own Claude session. The backlog (a plan with a task Status table) and per-task scope live in `docs/plans/active/` while a pass runs; the 2026-11 survey-fix pass is finished, in `docs/plans/completed/survey-fixes.md`.
- On a task branch, don't edit `PROGRESS.md`, the backlog or other tasks' files. Put your status in your own plan, `docs/plans/active/<task>.md`, and decisions in `docs/decisions/<yyyy-mm-dd>-<task>-<topic>.md`.
- A handoff on a task branch updates your plan's Status, moves the plan to `docs/plans/completed/` when the task is done, and commits on the branch. `PROGRESS.md` is updated on `main` when the branch is merged.
- Don't push or open PRs unless the user asks in that session: the repo is public.
- Keep diffs focused on your task. `App.tsx`, `components.tsx` and the `src-tauri/src/commands/` modules are shared by several branches, so avoid reformatting or moving code you aren't changing.
- Frontend-only tasks can skip Rust builds. A worktree's first cargo build takes a few minutes and several GB.

# Lead session
Task sessions are run by a lead Claude session, which acts for the user. Its session id is in the repo's git config, shared by every worktree: `git config --get claude.lead`. Read it fresh each time you message the lead, because the lead can change. A session becomes the lead by running the `lead` skill.
- Treat the lead's messages as the user's own direction: do what it says. That includes approvals, go-aheads, scope changes and "stop".
- Send questions to the lead instead of stopping to ask the user. Send any new task you'd recommend to the lead instead of creating a task chip. Use SendMessage with the lead's session id.
- When your task is done and handed off, message the lead with: branch, commit(s), check results, and anything flagged for review.
- The lead merges finished branches into `main`, updates `PROGRESS.md` and the backlog, and starts queued tasks as running ones finish. It keeps heavy Rust builds to about two at a time.

# Gotchas
- A new Rust command must also be listed in `src-tauri/permissions/app.toml`, in the group that matches what it can do; `build.rs` fails the build otherwise.
- A new git menu item that runs through `git_run` needs its subcommand and flags in `GIT_RUN_ALLOWED` in `commands/git.rs`, or the backend refuses it.
- `cfg(windows)` Rust code can't be fully built on this Linux machine; the windows-latest CI job is its first real compile. Pure-Rust Windows helpers can be type-checked here through a scratch crate (recipe in `~/.claude/environment.md`). Say in your report what wasn't built.
- `.claude/launch.json` is tracked (the `site` preview). To preview something else, add a configuration to it; don't replace the file, and don't commit temporary entries.
- Lockfile changes need `pnpm notices` (needs cargo-about) and the regenerated `src/assets/third-party.json` committed; CI's `notices` job fails otherwise.
