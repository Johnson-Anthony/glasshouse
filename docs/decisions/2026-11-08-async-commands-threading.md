# async-commands: where commands run

Date: 2026-11-08. Task: `async-commands`.

## Choice 1: `#[tauri::command(async)]` rather than `spawn_blocking`
Every command used to be a plain `#[tauri::command] fn`, which Tauri 2 runs on the main thread, the same thread that drives the window.

**Chosen:** change the attribute to `#[tauri::command(async)]` and leave the function bodies alone. For a non-async function, Tauri's macro then wraps the call in a task on its tokio runtime (`tauri::async_runtime`, one worker thread per CPU core) and sends the result back when it finishes.

**Alternatives:**
- `async fn` with the body inside `tauri::async_runtime::spawn_blocking(move || …).await`. This is the textbook way to run blocking code under tokio, and it uses a separate pool of up to 512 threads. But it changes the first and last lines of each body and re-indents everything in between. Across 55 commands that's thousands of changed lines in `commands.rs`, which five other branches also edit. Rejected for this pass.
- A thin `async` wrapper per command that calls the unchanged function through `spawn_blocking`. This adds 55 wrappers and a second name for every command, and the wrappers break whenever another branch changes a signature. Rejected.

**Cost of the choice:** a running command occupies a tokio worker until it returns. Tauri's own async work and the plugins' async commands (fs, dialog, shell) share those workers. They would only stall if every worker were busy at once, 12 on this laptop. Commands here are started one at a time by the user, so that doesn't happen in practice.

**If it ever does:** install a runtime with more workers through `tauri::async_runtime::set` in `lib.rs`, or move the few unbounded commands (`find_in_files`, `run_script`, `git_run`, copy/move/delete, archives) to `spawn_blocking` once `split-big-files` has moved them into their own modules.

## Choice 2: what stays on the main thread
The main thread runs commands one at a time, in the order they arrive. Async commands run in parallel and can finish in any order. These stay synchronous because they rely on that order, or because they're too quick for a thread hop to matter:
- **Config:** `read_pins`, `write_pins`, `read_tags`, `write_tags`, `read_recent`, `append_recent`, `clear_recent`. Pin and tag writes are fired without waiting (`void writePins(next)`). Every write goes through the same `<name>.json.tmp` file, and `append_recent` reads the file, changes it and writes it back. In parallel, writes could collide on the temp file or drop entries.
- **Watcher:** `watch_dir` and `unwatch_dir`. They're fired in pairs without waiting, so a reordered pair would leave the wrong folder watched.
- **Terminal:** `pty_write`, `pty_resize` and `pty_kill`. Keystrokes must arrive in order. `pty_spawn` is async: `Terminal.tsx` awaits it and kills the session if the tab closed in the meantime.
- **Instant:** `ping`, `home_dir`, `win_to_wsl`, `wsl_to_win` and `set_always_on_top`.

The other frontend callers whose results can now arrive out of order already discard stale results: the listing (`fetchSeq`), previews, the inspector, Miller columns, the status bar and the dynamic menus.

## Choice 3: scope `list_dir`'s git status instead of caching it
`list_dir` labels only the folder's direct children, but it ran `repo.statuses()` over the whole repository.

**Chosen:** pass the folder's workdir-relative path as a libgit2 pathspec, so only that subtree is examined. Labels don't change: the existing code already matched exact paths only, and every matching path is inside the folder. The repo root, paths outside the workdir, non-UTF-8 paths, and paths libgit2 would read as a pattern (`*?[]\`, a leading `!` or `#`, trailing whitespace) keep the whole-repo scan.

**Rejected: a cache.** A cache keyed by repo would serve stale labels at exactly the wrong moment. A refresh is usually caused by a file changing (`fs-changed`), and that's when the label needs to change. Edits made outside the watched folder, such as `git add` in a terminal, would never invalidate it at all.

`git_status`, which feeds the branch badge and dirty count, still scans the whole repo, since the count is repo-wide. `fetchAll` no longer waits for it before showing the rows.
