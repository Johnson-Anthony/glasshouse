# script-kill-tree

Branch: `claude/silly-hertz-cfba21` (same worktree). Task: `script-kill-tree` in `docs/plans/active/survey-fixes.md`. The lead said to implement without an OK, with a decision record for choices made.

## Problem
`run_script` kills a script at its 60 s timeout with `Child::kill`, which reaches only the direct child. Anything the script started (a background `sleep`, a server) keeps running, and if it inherited stdout or stderr, the output drain waits out its whole grace period.

## Approach
- **New module `src-tauri/src/proc_tree.rs`:** `spawn(&mut Command) -> TreeChild` and `TreeChild::kill_tree()`.
  - **Unix:** `process_group(0)` at spawn, and `libc::killpg(pgid, SIGKILL)` on kill. The leader is reaped only afterwards, so the group id can't have been reused.
  - **Windows:** a job object created right after spawn, with the child assigned to it, and `TerminateJobObject` on kill. No `KILL_ON_JOB_CLOSE`, so closing the job after a normal exit kills nothing, as on Unix. If assignment fails, it falls back to killing the child alone.
  - Only std plus libc/windows, so the Windows half can be type-checked by itself.
- **`run_capped`** spawns through `proc_tree` and calls `kill_tree()` at the timeout. The timeout was already a parameter (tests pass 300 ms), so `run_script` keeps its 60 s.
- **Only a timeout kills the tree.** After a normal exit, background children a script started on purpose keep running.
- **Cargo.toml:** libc moves from the linux-only table to `cfg(unix)`, and the `windows` crate gains `Win32_System_JobObjects`. The lock file is unchanged.
- **Tests:**
  - `proc_tree` (Linux): `kill_tree` kills a background child, and a normal exit leaves it alone.
  - `proc_tree` (Windows): a PowerShell starts a second PowerShell via Start-Process; after `kill_tree` it's gone (`tasklist`). Only Windows CI can run this.
  - `run_capped` (Linux): at the timeout, the background child is dead and the drain doesn't wait out its grace.
- **Windows type-check:** add the `x86_64-pc-windows-msvc` std through rustup, then `cargo check --tests` a scratch crate that includes `proc_tree.rs` by path. The whole app can't be checked for Windows from here because of its C dependencies.

## Status
Done 2026-11-08. Decision: `docs/decisions/2026-11-08-script-kill-tree.md`.
- [x] `proc_tree.rs` and `run_capped`.
- [x] Tests: 2 in proc_tree (Linux) + 1 for Windows, and 1 for `run_capped` (Linux). No stray `sleep` processes remain after the run.
- [x] Windows type-check: `proc_tree.rs` with its tests passes `cargo clippy --tests --target x86_64-pc-windows-msvc` with `-D warnings`. A deliberate type error in a `cfg(windows)` probe was caught, so the Windows code really compiles.
- [x] Decision note.
- [x] Checks at 4 jobs, all green: `pnpm build`, `pnpm test` (183), `pnpm check:wiring` (0), `RUSTFLAGS="-D warnings" cargo clippy --all-targets`, `cargo test` (66).

## For review
- **The Windows test needs CI.** It's `proc_tree::tests::kill_tree_kills_a_background_child` on Windows: PowerShell + Start-Process + tasklist, and it type-checks but has never run. If the CI runner forbids nested jobs, its `job.is_some()` assert fails. That would be the fallback path (only the child is killed), not a crash.
- **A timed-out script's children now die with SIGKILL / TerminateJobObject**, with no grace to clean up. Background children of a script that exits normally are untouched.
- **Toolchain:** the Windows std is now installed through rustup; see `~/.claude/environment.md`. The same scratch-crate trick could type-check other pure-Rust, Windows-only helpers.
