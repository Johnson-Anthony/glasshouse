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
- No ESLint or Prettier is configured.

# Parallel task branches
Some work is split into task branches, each in its own git worktree with its own Claude session. The backlog and per-task scope are in `docs/plans/active/survey-fixes.md`.
- On a task branch, don't edit `PROGRESS.md`, `survey-fixes.md` or other tasks' files. Put your status in your own plan, `docs/plans/active/<task>.md`, and decisions in `docs/decisions/<yyyy-mm-dd>-<task>-<topic>.md`.
- A handoff on a task branch updates your plan's Status, moves the plan to `docs/plans/completed/` when the task is done, and commits on the branch. `PROGRESS.md` is updated on `main` when the branch is merged.
- Don't push or open PRs unless the user asks in that session: the repo is public.
- Keep diffs focused on your task. `components.tsx`, `App.tsx` and `commands.rs` are shared by several branches, so avoid reformatting or moving code you aren't changing.
- Frontend-only tasks can skip Rust builds. A worktree's first cargo build takes a few minutes and several GB.

# Gotchas
