# pty-drain

Branch: `claude/cool-gauss-d234ca` (worktree `cool-gauss-d234ca`), started 2026-11-10 after `pty-writer` merged (`0805647`).
Backlog entry: `## pty-drain` in `docs/plans/active/survey-fixes.md`. Sketch: "Known gap" in `docs/decisions/2026-11-08-pty-writer-queue.md`.

## Problem
On unix, a session can end (tab killed, or the program and shell exit) while its pty is full: a raw-mode program stopped reading and more than about 64 KB of input was queued. The writer thread is then blocked in `write`, and the kernel never wakes it, not even after the child is gone. The writer thread, its pty and the queued bytes stay until the app exits.

## Verified first (Python, this kernel)
- A raw-mode child is filled, then killed: the master write stays blocked.
- The slave is reopened with `O_RDONLY|O_NOCTTY|O_NONBLOCK`, and reads discard its input. The blocked write returns within about 1 ms, and a stop flag ends the writer.
- The tty stays in raw mode across the reopen, so the reads return data.

## Approach (`pty.rs` only)
- **Stop flag.** `spawn_writer` returns the input `Sender` and a `WriterHandle`, which holds `stop: Arc<AtomicBool>` and a `done` receiver.
  - The thread writes each queued item in 4 KB pieces and checks `stop` before each piece, so an unblocked writer stops within one piece instead of writing the rest of the queue.
  - When the thread finishes, it drops the pty writer first and then `done_tx`. That order matters because portable-pty's unix writer sends EOF in `Drop` with a write that can block too.
- **`impl Drop for PtySession`.** It sets `stop`. On unix, it hands `done` and the slave path (`master.tty_name()`) to a short-lived helper thread, so nothing waits on the caller's thread, which is the main thread in `pty_kill`.
- **The helper, `unblock_writer`.**
  1. It waits up to 100 ms for `done`. An idle writer ends at once, and a child that's still alive may read its input itself.
  2. Otherwise it opens the slave with `O_NOCTTY|O_NONBLOCK`. `O_NOCTTY` means the app never takes the pty as its controlling terminal.
  3. It reads and discards input until `done` disconnects, giving up after 5 s.
- **Windows:** only the stop flag. Closing the ConPTY already breaks the pipe, which fails the write.

## Tests
- **Unix, real pty.** The test fills a raw-mode child's pty with 1 MB and keeps a clone of the session's input sender. After the session ends, a send on that clone fails once the writer thread has dropped the queue. Two cases:
  - killed the way `pty_kill` does it (extends `input_for_a_child_that_never_reads_does_not_block`);
  - the child exits on its own without reading (the wait thread drops the session).
- **Fake writer, all platforms:** setting `stop` ends the thread after the current piece and drops the queue.
- **Negative check:** with the helper disabled, the unix tests must fail. This is a temporary edit, not kept.

## Status
**Done** (2026-11-10).
- [x] Merged `main` (`def0fb0`); verified the approach in Python
- [x] Stop flag, 4 KB pieces and `done` in `spawn_writer`
- [x] `Drop for PtySession` and `unblock_writer`
- [x] Tests: `killing_a_session_frees_a_writer_stuck_on_a_full_pty`, `exiting_frees_a_writer_stuck_on_a_full_pty` and `stop_ends_the_writer_after_its_current_piece`, plus the negative check
- [x] Checks: build, test (234), check:wiring, clippy `-D warnings`, cargo test (120 passed; 1 ignored, test-coverage's child-process test)
- [x] Decision record `docs/decisions/2026-11-10-pty-drain-unblock.md`; the pty-writer note and the ARCHITECTURE pty row now point at it
- [x] Handoff

## Results
- **Negative check:** with `unblock_writer` disabled, `exiting_frees_a_writer_stuck_on_a_full_pty` fails ("writer thread never ended"). The kill test still passes, because the child's hangup flushes the pty once and the stop flag, already set by then, ends the writer. When the child exits by itself, the flush comes before the stop, the writer refills the pty, and only the drain frees it. Details are in the decision record.
- **Windows:** not built. A scratch crate mirroring `WriterHandle`/`Drop` passes clippy `-D warnings` for `x86_64-pc-windows-msvc`. Without the `cfg_attr(not(unix), allow(dead_code))` on `done`, it fails with "field `done` is never read", which the windows-latest CI job would hit.

## For review
- The drain reopens the slave with `O_NOCTTY|O_NONBLOCK` from a helper thread on session teardown. It only does so if the writer hasn't finished within 100 ms, and gives up after 5 s.
- macOS is untested: its pty reopen and hangup behaviour may differ. The code is generic unix (`libc` flags, std `OpenOptionsExt`).
