# pty-writer

Branch: `claude/cool-gauss-d234ca` (worktree `cool-gauss-d234ca`), started after `async-commands` merged.
Backlog entry: `## pty-writer` in `docs/plans/active/survey-fixes.md`.

## Problem
`pty_write` stays on the main thread so keystrokes reach the shell in the order they were typed (see `docs/decisions/2026-11-08-async-commands-threading.md`). But it calls `write_all` on the pty itself, which blocks while the pty's input buffer is full. Pasting more than the buffer holds (about 4 KB in the line discipline, plus up to 64 KB queued in the kernel) while a program that doesn't read stdin is running freezes the window until that program reads or exits.

## Approach
- Each session gets a **writer thread** fed by an unbounded `std::sync::mpsc` channel. `PtySession.writer` (a shared, locked `Write`) becomes `PtySession.input: Sender<Vec<u8>>`.
- `pty_write` only queues the data. Its body moves into `queue_input(&Sessions, id, data)` so a test can call it without Tauri. A send on an unbounded channel never blocks, so `pty_write` stays on the main thread, and that is what keeps the order.
- **When the writer thread ends:**
  - the session is gone (wait thread or `pty_kill`, which drops the `Sender`) and the queue has drained;
  - or a write fails, which drops the rest of the queue.
  - **Known gap, unix:** the thread can't end if the session ends while the pty is full. See the decision record.
- The thread also owns the dropping of the pty writer. portable-pty's unix writer sends `\n` + EOF from `Drop`, using a write that can block. That used to happen wherever the session was dropped, which is the main thread in `pty_kill`.
- `pty_write` still returns an error for an unknown session, and now also when the session's input is closed (the writer thread ended after a failed write). The frontend ignores both, as before.
- The command list is unchanged, so `permissions/app.toml` doesn't need editing.

## Tests
- **All platforms:** a fake writer that blocks each write until the test releases it.
  - Queued input is written in order.
  - The thread ends, and drops the writer, once the `Sender` is gone and the queue has drained.
  - A failed write ends the thread and drops the queue: later sends fail.
- **Unix, real pty:** a raw-mode child that never reads (`stty raw -echo; printf ready; exec sleep 30`). It has to be raw mode: in line mode, Linux never blocks pty writes.
  - Queueing 1 MB through `queue_input` returns at once.
  - **Negative check:** I temporarily swapped in a zero-capacity channel, which makes each enqueue wait for the writer. The test then fails with "queueing input blocked on the pty: Timeout". The swap was not kept.
  - The test doesn't assert that the writer thread ends after the kill. In this exact case it can't (the known gap above).

## Not built here
- Windows ConPTY isn't compiled or run locally. The change is platform-neutral (`Box<dyn Write + Send>` plus a thread), and the windows-latest CI job is its first build.
- The known-gap fix (drain the slave on teardown, which needs `libc`). See the decision record.

## Status
**Done** (2026-11-08).
- [x] Merged `main` (`b86cd25`); read the pty code fresh
- [x] Writer thread, plus `queue_input` (pty_write's body)
- [x] Tests: 2 fake-writer tests on all platforms, 1 unix real-pty test, plus the negative check
- [x] Checks: build, test, check:wiring, clippy `-D warnings`, cargo test
- [x] Decision record: `docs/decisions/2026-11-08-pty-writer-queue.md`; the pty row of `docs/ARCHITECTURE.md` is updated
- [x] Handoff

## For review
- **Known gap** (unix, raw-mode pty full when the session ends): one blocked thread and pty are left behind, where before the app hung for good. The fix is sketched in the decision record.
- **Unbounded queue:** it only holds what the user typed or pasted.
- **`pty_write` error text:** an unknown session still gives `no pty session: <id>`. It now also errors with `input to <id> is closed` once the writer thread has ended after a failed write. The frontend ignores both.
