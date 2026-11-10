# pty-writer: how terminal input reaches the pty

Date: 2026-11-08. Task: `pty-writer`.

## Chosen
Each pty session has its own writer thread, fed by an **unbounded** `std::sync::mpsc` channel. `pty_write` stays a synchronous command on the main thread and only queues the data, so keystrokes keep the order they were typed in, and the main thread never waits on the pty.

The writer thread ends when either:
- the session, and with it the only sender, is gone and the queue has drained;
- or a write fails, which drops the rest of the queue.

## When a pty write actually blocks (Linux, measured)
I measured this with a Python pty experiment on this machine (kernel 7.3).
- **Line mode** (the default; a shell at its prompt): a write never blocks. The kernel discards input past a full line. After the child dies, writes still succeed and the data goes nowhere.
- **Raw mode** (editors, REPLs, ssh, full-screen programs): the pty holds about 64 KB of unread input, and then a write blocks until the program reads.

## Known gap: a session that ends while its pty is full (unix)
**Fixed on 2026-11-10 by `pty-drain`**: a stop flag plus a drain of the slave side. See `2026-11-10-pty-drain-unblock.md`, which also corrects one detail below: when the child exits, the hangup does flush the pty once, but a writer that hasn't been stopped refills it.

If a raw-mode program has stopped reading, a paste of more than about 64 KB is pending, and then the session ends (the tab is killed, or the program and shell exit), the kernel never wakes the blocked write. Not even after the child is gone, and the writer's own handle keeps the master open. One writer thread, one pty and the queued bytes then stay around until the app exits. Before this change, the same write blocked the main thread, so the whole app hung for good. On Windows, closing the ConPTY breaks its input pipe, so the write fails and the thread ends.

**The fix, not built:** in `PtySession`'s `Drop`, when the writer is mid-write, a helper thread reopens the slave (`tty_name()`) with `O_NOCTTY | O_NONBLOCK` and reads and discards input until the write returns. A stop flag then keeps the writer from writing the rest of the queue. That needs a direct `libc` dependency, and it relies on kernel pty details: reopening a closed slave, unthrottling waking the master's writer, and macOS behaving differently. That's too much risk for a rare case, so it's left as a follow-up.

## Rejected
- **A bounded channel (`sync_channel`).** When it's full, a send blocks, which brings back the original freeze, just later. A `try_send` that drops input when full would silently lose keystrokes or part of a paste. The queue only holds what the user typed or pasted, so unbounded is safe.
- **One writer thread shared by all sessions.** A session whose child stops reading would block input to every other terminal tab.
- **Making `pty_write` `#[tauri::command(async)]` instead.** Async commands run in parallel and finish in any order, so keystrokes could be reordered. That's why it stayed on the main thread in `async-commands`.
- **Keeping queued input after a failed write.** The child is gone by then, so nothing could ever read it.

## Side effect
Dropping portable-pty's unix writer sends `\n` + EOF to the child, using a write that can block. It used to happen wherever the session was dropped, including the main thread in `pty_kill`. The writer thread now owns the writer, so it happens there instead.
