# pty-drain: freeing a writer stuck on a full pty

Date: 2026-11-10. Task: `pty-drain`. This closes the "Known gap" in `2026-11-08-pty-writer-queue.md`.

## Chosen
- **Stop flag.** `PtySession`'s `Drop` sets a stop flag that the writer thread checks before each 4 KB piece. A freed writer therefore stops after one piece and drops the queue, instead of refilling the pty with the rest of a paste.
- **Drain helper (unix).** `Drop` also hands the writer's `done` receiver and the slave path (`master.tty_name()`) to a short-lived helper thread, `unblock_writer`.
  1. It waits 100 ms for the writer to finish by itself.
  2. If the writer is still busy, it opens the slave with `O_RDONLY|O_NOCTTY|O_NONBLOCK`.
  3. It reads and discards input until the writer thread is done (`done` disconnects after the pty writer is dropped), giving up after 5 s.
- **Windows** gets only the stop flag. Closing the ConPTY breaks the input pipe, which already fails the write.

## Why both parts (measured)
portable-pty makes the child's pty its controlling terminal. When that process exits, the kernel hangs up the tty, which flushes the pty's input once. Without the drain, the two ways a session ends behave differently:
- **Killed (`pty_kill`):** `Drop`, and so the stop flag, comes before the child's exit. The flush frees the blocked write, and the writer stops after that piece.
- **Child exits by itself:** the flush comes before the wait thread drops the session. The writer, not yet stopped, refills the pty with the rest of the paste and blocks again, and nothing reads the pty after that. Only the drain frees it. The test `exiting_frees_a_writer_stuck_on_a_full_pty` fails with the drain disabled; the kill test passes either way.

The drain also covers children that ignore SIGHUP (`pty_kill` only sends SIGHUP) and children with no controlling tty.

## Details
- **Read rather than `tcflush(TCIFLUSH)`.** Reading the slave runs the line discipline's unthrottle, which wakes the master's blocked writer. A flush frees space but, going by the kernel source, doesn't do that wakeup.
- **Reopening works after the child is gone.** The master keeps the pty pair alive, and the tty stays in raw mode across the reopen. I checked this in Python before writing the Rust.
- **`O_NOCTTY` is required.** A GUI app started as a session leader would otherwise take the pty as its controlling terminal, and the pty's later hangup would SIGHUP the app.
- **Ordering:** the writer thread drops the pty writer first and `done_tx` last. portable-pty's unix writer sends EOF from `Drop` with a write that can block too, and the drain has to cover that write.
- **The 100 ms grace** means an idle writer, or a live child that's still reading, never causes a reopen. **The 5 s cap** keeps the helper from spinning on a child that is somehow still alive and holding the pty.

## Rejected
- **A `libc` signal to interrupt the write (EINTR).** It needs a process-wide signal disposition inside a GUI process, and `write_all` retries EINTR anyway.
- **Non-blocking writes with `poll()`.** The master's `O_NONBLOCK` flag is shared with the reader thread's handle, so both threads would need rewriting.
- **Keeping our own slave fd open.** The master would then never see EOF or EIO when the child exits, so the reader thread would hang.
