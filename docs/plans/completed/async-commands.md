# async-commands

Branch: `claude/cool-gauss-d234ca` (worktree `cool-gauss-d234ca`).
Backlog entry: `## async-commands` in `docs/plans/active/survey-fixes.md`.

## Problem
Every Rust command is a plain `#[tauri::command] fn`, and Tauri 2 runs those on the main thread. That thread also runs the window and its input, so a slow command freezes the UI until it returns: hashing a big file, copying a folder, a `git fetch` against a slow remote, `find_in_files` over a large tree, or a script that never exits.

## Approach
1. **Move I/O commands off the main thread with `#[tauri::command(async)]`.** Each function body stays as it is. Tauri then runs it inside a task on its tokio runtime (one worker per CPU core, 12 on this laptop) and sends the result back when it finishes. The diff is one attribute line per command, which is what the other branches editing `commands.rs` need. The choice between this and `spawn_blocking` is in `docs/decisions/2026-11-08-async-commands-threading.md`.
   - In `commands.rs`, this covers every command that touches the filesystem, spawns a process, or asks the OS for data. That's 54 of the 66, including all the slow ones the survey lists.
   - In `pty.rs`, it covers `pty_spawn`. Starting a ConPTY on Windows takes a noticeable time. `Terminal.tsx` already kills a session whose tab closed while it was still starting.
2. **Keep commands on the main thread when their order matters.** The main thread runs commands one at a time, in the order they were sent. Async commands run in parallel and can finish in any order.
   - **Config:** `read_pins`, `write_pins`, `read_tags`, `write_tags`, `read_recent`, `append_recent`, `clear_recent`. The frontend fires off pin and tag writes without waiting for them, all writes go through the same `*.json.tmp` file, and `append_recent` reads the file, changes it and writes it back. In parallel, two writes could collide or drop an entry. The files are tiny, so they stay synchronous.
   - **Watcher:** `watch_dir` and `unwatch_dir`. They're called in pairs without waiting, and a swapped pair would leave the wrong folder watched. Both are fast, because the watch is non-recursive.
   - **Terminal:** `pty_write`, `pty_resize` and `pty_kill`. Keystrokes have to arrive in order.
   - **Instant ones:** `ping`, `home_dir`, `win_to_wsl`, `wsl_to_win` (pure string or env work) and `set_always_on_top` (a window call).
3. **Make `list_dir`'s git status cheaper.** Today every listing runs `repo.statuses()` over the whole repository, even though it only labels the folder's direct children. I'll limit the scan to the listed folder with a libgit2 pathspec, so only that subtree is checked. At the repo root nothing changes. A folder whose path has a pathspec special character (`*?[]\`, or `!`/`#` at the start) falls back to the whole-repo scan, so it still gets correct labels. I won't use a cache: refreshes are triggered by file changes, so a cache would show stale labels exactly when they matter.
4. **Show the listing before `git_status` finishes.** `fetchAll` in `state.ts` waits for both `list_dir` and `git_status`. `git_status` still has to scan the whole repo for the dirty count, so in a large repo the listing would wait for it. I'll set the entries as soon as they arrive and the git info when it does, keeping the existing `fetchSeq` check for stale results. The other frontend callers whose results can now arrive out of order already guard against it: previews, the inspector, Miller columns, the status bar and the dynamic menus all use `cancelled`/`live` flags.
5. **`git_branch_list`: one process instead of 1 + one per branch.** I'll read ahead/behind from `for-each-ref`'s `%(upstream:track,nobracket)` instead of running `rev-list` for every branch. This also covers the backend-bugs follow-up: a missing upstream used to look like "in sync" (0,0). It will now set a new `upstream_gone: true` field, which is added to `GitBranch` in `api.ts`. The UI doesn't show ahead/behind yet, so no component changes.

## Not in this task
- **Progress events:** not built. Hashing and copying are the useful places for them, but the hash read loop is being merged into one helper by `dead-code`, and the copy code was just reworked by `symlink-safety`. Adding events now would conflict with both. Design for later: the frontend passes an `op_id`; the backend sends `op-progress {op_id, done, total}` from the hash loop and the per-file copy loop, at most about 10 a second. A matching `cancel_op(op_id)` would set an `AtomicBool` that the loops check.
- **Cancelling** a long `find_in_files`, copy or `git_run`: the same `op_id` mechanism; follow-up.
- **`run_script` / `git_run` timeouts:** `command-security` owns those bodies. Once they're async, a hanging script no longer freezes the UI, but it still holds one worker thread until it exits.
- **`pty_write` blocking:** this stays on the main thread so keystrokes stay in order. A write still blocks while the pty's input buffer is full, for example when pasting more than about 4 KB while a program that doesn't read stdin is running. The fix is a per-session writer thread fed by a channel. I'll suggest it to the lead as a follow-up rather than touch `pty.rs`'s session struct, which `command-security` is editing.

## Verification
- `pnpm build`, `pnpm test`; in `src-tauri`, `RUSTFLAGS="-D warnings" cargo clippy --all-targets` and `cargo test`.
- New Rust tests: the scoped `list_dir` git labels (subfolder, repo root, a folder with `[` in its name), and parsing of `%(upstream:track)`.
- Timing: whole-repo vs scoped status on `~/linux` (93k files), as a one-off measurement that isn't committed.
- Responsiveness in `pnpm tauri:dev`: hash a multi-GB file and measure a `ping` round trip while it runs. `ping` stays on the main thread, so its latency shows whether the main thread is free. Compare against `main`'s behaviour.

## Status
**Done** (2026-11-08).
- [x] Merged `main`, re-read the command list (66 commands)
- [x] Attributes: 54 commands in commands.rs, plus `pty_spawn`, are `(async)`. Twelve in commands.rs and five in pty.rs/watcher.rs stay synchronous.
- [x] Scoped git status in `list_dir`, plus tests
- [x] `fetchAll` shows entries before git info
- [x] `git_branch_list` via `upstream:track` (with `LC_ALL=C`), plus `upstream_gone`, plus tests
- [x] Decision record: `docs/decisions/2026-11-08-async-commands-threading.md`; the Backend section of `docs/ARCHITECTURE.md` is updated
- [x] Checks, timing, responsiveness check in tauri:dev
- [x] Handoff

## Results
- `pnpm build` passes; `pnpm test` passes 150/150. In `src-tauri`, `RUSTFLAGS="-D warnings" cargo clippy --all-targets` is clean and `cargo test` passes 43/43 (4 new).
- **Responsiveness** (`pnpm tauri:dev`, SHA-256 of a 512 MB file, a main-thread `ping` every 50 ms; a temporary probe, not committed):

  | | hash | pings during the hash | ping latency |
  |---|---|---|---|
  | `hash_sha256` sync, as on `main` | 24.7 s | 1 | 24.7 s: blocked for the whole hash |
  | this branch, `(async)` | 25.4 s | 497 | median 1 ms, max 10 ms |

  The longest frame gap was about 23 ms in both runs. WebKitGTK renders the page in a separate process, so the freeze shows up as blocked IPC and window input rather than as dropped frames.
- **`list_dir` git scan** on `~/linux` (93k files, debug build, median of 3): whole repo 513 ms, `drivers/net/wireless` 164 ms. Most of what's left is libgit2 loading the 93k-entry index. `git_status` (whole repo, for the dirty count) is about 500 ms, and the listing no longer waits for it.

## For review
- **Threading choice** (decision record): `command(async)` puts blocking work on tokio workers rather than the `spawn_blocking` pool. It's fine at this app's concurrency. The record names the escape hatch.
- **Which commands stay on the main thread** and why (decision record, choice 2). The config writes in particular need it: a fixed `.json.tmp` name, and `append_recent` reads, changes and writes back.
- **Windows is untested.** Scoping needs libgit2's workdir (forward slashes) to be a `Path` prefix of the dunce-canonical folder. If it isn't, the scan falls back to the whole repo: still correct, but `list_dir_git_labels_scan_only_the_listed_folder` asserts the scan was scoped and would fail on Windows CI. `LC_ALL=C` for `for-each-ref` should work with Git for Windows's gettext.
- **Merge with command-security:** my `commands.rs`/`pty.rs` changes there are attribute lines only. Where they changed a signature right below one (`run_script`, `git_run`, `pty_spawn`), git may report an adjacent-line conflict. Resolve it by keeping both: their signature, my `#[tauri::command(async)]`.

## Follow-ups (suggested to the lead)
- `pty_write` can still block the main thread while a pty's input buffer is full, for example when pasting more than about 4 KB while a program that doesn't read stdin is running. Fix: a per-session writer thread fed by a channel (`pty.rs`).
- Progress events and cancellation for hash/copy/find (design above), after `dead-code` and `split-big-files`.
