# backend-bugs

Branch: `claude/bold-haibt-91d29a` (worktree `bold-haibt-91d29a`)

## Scope
The five items in the `## backend-bugs` section of `survey-fixes.md`:
1. PTY sessions stay in the registry after the child exits; mutex `.unwrap()`s in `pty.rs`.
2. `git_status` labels differ from `list_dir`'s, and its "ignored" label can never appear.
3. `wsl_to_win("/mnt/c")` returns `\mnt\c`.
4. The `archive_can_handle` comment promises a zstd fallback that doesn't exist.
5. `git_dirty_count` and `git_ahead_behind` return `Ok(default)` on failure.

Files: `src-tauri/src/pty.rs`, `src-tauri/src/commands.rs`, `src-tauri/Cargo.toml` (+ `Cargo.lock`), `src/api.ts`.

## What I found
- **PTY:** the wait thread emits `pty-exit` but never touches the registry. There's also a race: the session is inserted *after* the wait thread starts, so a child that exits at once would be removed (once removal exists) before it's inserted, and leak.
- **Poisoned locks:** with `panic = "abort"` in the release profile, a panic aborts the process before any lock can be poisoned, so in release builds the `.unwrap()`s can't fire. They can in dev and test builds (unwinding). `pty_kill` has the opposite bug: `if let Ok(k) = killer.lock()` silently skips the kill when the lock is poisoned.
- **git labels:** nothing on the frontend reads `GitInfo.status` (only `branch`/`ahead`/`behind`/`dirty`), so changing its labels has no UI impact. `list_dir`'s "!" (ignored) is documented but also never produced, because `scan_repo_statuses` uses `include_ignored(false)`.
- **zstd:** GNU tar's `--zstd` runs an external `zstd` binary, which many Linux installs don't have. Whether Windows' `tar.exe` (bsdtar) has zstd built in is uncertain. So `archive_can_handle("tar.zst")` can say yes and then fail. The `zstd` crate is already compiled into the app (through `zip`).
- **git_dirty_count / git_ahead_behind:** neither has a frontend caller. `git_dirty_count` has no `api.ts` wrapper at all; `gitAheadBehind` has one that nothing calls. Signature changes are free.

## Approach
1. **PTY** (`pty.rs`)
   - `PtyRegistry.sessions` becomes `Arc<Mutex<…>>` so the wait thread can hold it.
   - Move the openpty/spawn/thread part of `pty_spawn` into `spawn_session(sessions, id, cmd, size, on_data, on_exit)`, which takes closures instead of an `AppHandle`, so it's unit-testable without Tauri. `pty_spawn` keeps building the command from the profile (so `command-security`'s edits there don't collide) and passes closures that emit the events.
   - Insert the session *before* starting the wait thread. On exit, the wait thread removes the session, drops it outside the lock, then emits `pty-exit`.
   - A `lock()` helper recovers poisoned guards (`PoisonError::into_inner`) instead of panicking. The protected data (a map, a counter, a writer, a killer) has no invariant a panic could break halfway. `pty_kill` removes under the lock and kills after releasing it.
2. **git labels** (`commands.rs`): one `git_status_code(Status) -> Option<&str>` used by `scan_repo_statuses`, `git_status` and `git_dirty_count`, so all three agree ("M", "A", "D", "U", "?"). Remove the dead "ignored" arm, and correct the "!" claims in the `FileEntry` and `api.ts` docs.
3. **wsl_to_win:** handle `/mnt/<letter>` with no trailing slash, and require the letter to be ASCII alphabetic.
4. **zstd: implement it, in-process.** For `.tar.zst`, run plain `tar -cf -` / `tar -xf -` and do the zstd step with the `zstd` crate (`default-features = false`, matching `zip`, so nothing new gets compiled). This works wherever `tar` exists, so `archive_can_handle`'s claim becomes true; rewrite the comment to say how. I'd rather do this than "try `--zstd`, fall back on failure": a failed attempt can leave partial output behind, and telling "tar lacks zstd" apart from "corrupt archive" means parsing stderr.
5. **git_dirty_count → `Result<Option<u32>, String>`; git_ahead_behind → `Result<Option<(u32, u32)>, String>`.**
   - `Ok(None)` means there's nothing to show: not a repo, bare repo, detached/unborn HEAD, no upstream, or the upstream ref is gone.
   - `Err` carries the real failure: unreadable repo, dubious ownership, a failing status walk.
   - `git_ahead_behind` moves from the `git rev-list` shell-out to libgit2. That gives typed error codes (no parsing of localized stderr, no extra spawns) and shares one helper with `git_status`, which already computes ahead/behind with libgit2 inline.
   - `api.ts`: `gitAheadBehind` returns `Promise<[number, number] | null>`. No wrapper is added for `git_dirty_count`, since nothing would call it.

## Tests
- PTY (unix only; Windows ConPTY can't be checked locally): a child that exits with code 3 leaves the registry empty and reports `Some(3)`; a poisoned registry lock still works.
- git (temp repos via git2, no git binary needed): modified/untracked/staged/deleted labels and dirty count; `git_dirty_count` and `git_ahead_behind` return `None` outside a repo and without an upstream; ahead/behind counts against a fake `origin/main`.
- `wsl_to_win`: `/mnt/c`, `/mnt/C`, non-letter mounts.
- `tar.zst` round-trip through `archive_create`/`archive_extract` (skipped if `tar` isn't on PATH). Manual check: extract with `PATH` containing only `tar`, and cross-check against system `tar --zstd`.

## Out of scope (noticed)
- `git_branch_list` swallows per-branch `rev-list` failures into (0, 0) the same way.
- `components.tsx` renders a "!" git badge that can never appear (for `dead-code`).

## For review
- **zstd is now in-process** for `.tar.zst` (new direct dependency `zstd = { version = "0.13", default-features = false }`, already compiled via `zip`). See `docs/decisions/2026-11-08-backend-bugs-tar-zst.md`.
- **`git_ahead_behind` moved from the `git` CLI to libgit2**, and both it and `git_dirty_count` now return `Ok(None)` for "nothing to show". See `docs/decisions/2026-11-08-backend-bugs-git-errors.md`.
- **Poisoned locks are recovered, not reported.** `lock()` in `pty.rs` uses `PoisonError::into_inner`. With `panic = "abort"` this only matters in dev and test builds.
- **Not run locally:** the Windows ConPTY side of the PTY change (the PTY tests are `cfg(unix)`), and Windows `tar.exe` on pipes (the tar.zst test runs on Windows CI). On Windows, removing a session on exit also closes the ConPTY, which should end the reader thread that previously blocked forever once the child exited. This is inferred and hasn't been seen.

## Status
Done 2026-11-08. The lead approved the plan as written. `main` (symlink-safety) was merged in first.
- `pty.rs`: `spawn_session` helper, sessions removed on exit, `lock()` poison recovery, `pty_kill` kills outside the registry lock. Two new tests (unix).
- `commands.rs`: `git_status_code`, `discover_repo` and `upstream_ahead_behind` helpers; `git_status` codes and ahead/behind; `git_dirty_count` / `git_ahead_behind` now `Result<Option<_>, String>`; `wsl_to_win` bare mount; `.tar.zst` through `PipedTar` plus the `zstd` crate. Four new tests.
- `api.ts`: `gitAheadBehind` returns `[number, number] | null`; git code docs corrected. `Cargo.toml` / `Cargo.lock`: `zstd` added as a direct dependency.
- Checks on Linux arm64: `pnpm build` ok, `pnpm test` 26 passed, `RUSTFLAGS="-D warnings" cargo clippy --all-targets` clean, `cargo test` 29 passed.
- Decisions: `docs/decisions/2026-11-08-backend-bugs-tar-zst.md`, `docs/decisions/2026-11-08-backend-bugs-git-errors.md`.
