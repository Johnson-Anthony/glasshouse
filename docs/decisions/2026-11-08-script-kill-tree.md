# Killing a timed-out script's whole process tree

Date: 2026-11-08 · Task: `script-kill-tree` · Picked by the task session (the lead said to choose and record), on the plan in `docs/plans/completed/script-kill-tree.md`.

## The problem
`run_script` gives up on a script after 60 s with `Child::kill`, which reaches only the direct child. Anything the script started kept running: a background `sleep`, a dev server, a stuck `curl`. If such a process inherited stdout or stderr, it also held the output pipes open, so `run_capped` waited out its full drain grace before returning.

## Decision: `proc_tree.rs`, a process group on Unix and a job object on Windows
- **`proc_tree::spawn(&mut Command) -> TreeChild`, then `TreeChild::kill_tree()`.** `run_capped` uses it, and calls `kill_tree()` only at the timeout.
- **Unix:**
  - At spawn, `Command::process_group(0)`: the child leads a new group whose id is its pid. A non-interactive shell has no job control, so `cmd &` children stay in that group.
  - At the timeout, `libc::killpg(pgid, SIGKILL)`, then reap the child.
  - The leader is reaped only after the `killpg`, so the group id can't have been reused by an unrelated process in between.
  - libc was a Linux-only dependency; it's now listed for all `cfg(unix)`, and the lock file doesn't change.
- **Windows:**
  - Right after spawn, `CreateJobObjectW` + `AssignProcessToJobObject`. Processes the child starts afterwards join the job.
  - At the timeout, `TerminateJobObject`, then `Child::kill` + `wait` as a fallback.
  - The job handle is closed on drop.
  - New `windows` crate feature: `Win32_System_JobObjects`.

## Choices inside that
- **SIGKILL, not SIGTERM and then SIGKILL.** The direct child already got SIGKILL (`Child::kill`), and `TerminateJobObject` is just as abrupt. A TERM grace would add delay and a second wait to a path that only runs after 60 s of no answer. Scripts that need cleanup belong in the terminal.
- **Only the timeout kills the tree.** After a normal exit, processes a script started on purpose (`nohup server &`) keep running, as they would from a terminal. So the Windows job has no `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`; with it, closing the handle would kill them. Tests pin this on Linux.
- **The child joins the job after it starts, not suspended.** The thorough way is to spawn with `CREATE_SUSPENDED`, assign, then resume, which is what the `command-group` crate does. But std doesn't expose the main thread handle, so resuming means walking a ToolHelp thread snapshot. What's left is a race of microseconds after CreateProcess, against powershell and cmd.exe, which take far longer than that before running a script's first command. Not worth the extra Win32 surface in code that can only be run in CI.
- **If job assignment fails**, for example where an outer job forbids nesting, the script still runs. Only the timeout falls back to killing the child alone.
- **No crate.** `command-group` pulls in `winapi` and `nix`, and its successor `process-wrap` pins its own `windows` version. The hand-rolled code is about 60 lines over dependencies already in the lock file, as the lead suggested.

Rejected:
- **Kill the tree on every exit:** that kills deliberately backgrounded work.
- **Linux cgroups or `PR_SET_CHILD_SUBREAPER`, to also catch processes that `setsid` out of the group:** much more machinery for daemonizing scripts, which are rare.

## Not reached
- Processes that leave the group (`setsid`, `setpgid`, a daemonizing tool) on Unix.
- Processes started with `CREATE_BREAKAWAY_FROM_JOB` on Windows; the job doesn't allow breakaway, so that flag fails rather than escaping.
- Processes started in the microseconds before job assignment.

## Checked
- **Linux:**
  - `proc_tree` tests: `kill_tree` kills a shell's background `sleep`, and a normal exit leaves it running.
  - `run_capped` test, with a 300 ms timeout injected: the background child is dead afterwards, and the drain doesn't wait out its grace (`incomplete` is false).
- **Windows:**
  - `proc_tree.rs` (its Windows test included) type-checks and passes `clippy -D warnings` for `x86_64-pc-windows-msvc`, through a scratch crate that includes the file by path; see `~/.claude/environment.md`. A deliberate type error in a `cfg(windows)` probe was caught, so the Windows code really was compiled.
  - The Windows test itself (a PowerShell starts a second PowerShell, and after `kill_tree` `tasklist` no longer lists it) first runs on the `windows-latest` CI job.
