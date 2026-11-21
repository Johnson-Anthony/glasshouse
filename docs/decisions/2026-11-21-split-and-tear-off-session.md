# split-and-tear-off: the session saves every window

Date: 2026-11-21. Task: `split-and-tear-off` (survey-3 task 50, phase 2: one process, many windows). Successor of `2026-11-15-session-persistence-windows.md`, which still holds for what each window saves (its tabs, checked field by field) and for the window-state plugin. The split's record is `2026-11-20-split-and-tear-off-session.md`, unchanged. Code: `src-tauri/src/session.rs`, `src-tauri/src/app_windows.rs`, `src/useTabLayout.tsx`, the startup effect in `App.tsx`.

## Context
Until phase 2, File → New Window started another process, and only the first process running restored and saved its tabs (in localStorage, `glasshouse.session.v1`). Every other window's tabs were lost when it closed. Now every window lives in one process (`2026-11-21-split-and-tear-off-one-process.md`), so one process can save them all.

## Options
- **Each page writes its own key** (`glasshouse.session.v1.main-2`, …). Every window would race to write, a closed window's key would have to be cleaned up by someone, and the backend, which makes the windows at start, would have to read localStorage to know how many to make.
- **Rust writes one file** from what each page reports. The lead picked this (11-21).

## Chosen: one writer in Rust
- Each window's page reports its record (`session_report`, the same shape `sessionOf` always saved) whenever its tabs, a tab's folder or sort, or the split change. Only a changed record is sent. A record over 256 KiB, or one that isn't an object, is refused.
- The registry (`app_windows.rs`) keeps each window's last report, and `session.rs` writes `session.json` in the app config dir half a second after a change (a burst is one write), through a temp file and a rename, and again at exit. An unchanged session isn't written.
- `session.json` is `{ "version": 1, "focused": "main-2", "windows": [{ "label": "main", "session": { …the page's record… } }] }`, in the order the windows opened. Reading checks the version, a known label (each once), an object with tabs, and the size; it keeps at most 20 windows. A file that isn't a session (broken JSON, another version) counts as none. A file with no windows is still a session.
- **Closing a window** drops it from the session, unless it's the last one: closing the last window quits the app, and what comes back is that window. **Quit** (Ctrl+Q, `quit_app`) closes every window and keeps all of them.
- **Private tabs are never saved**, as before. A window with only private tabs reports no tabs and isn't brought back.

## Restoring
- A plain start restores every saved window at once, each with its label, so the window-state plugin puts it back at its size and place. The focused one is made first, so it gets the launcher's startup ID; once the others are up it's focused again (not on Wayland, where it was activated with the ID).
- No `session.json` yet (0.2, or a build from phase 1): one window, which reads the v1 key as before.
- The page asks `window_start` what it opens with: `plain` (one tab at home), `launch` (paths), `restore` (a record) or `legacy` (the v1 key). After its first report the answer is that report, so a page that loads again (Import Layout reloads it) keeps its tabs. React's dev mode asks twice and gets the same answer.

## The v1 key stays, written by the focused window
0.2 and the phase 1 builds read only `glasshouse.session.v1`. So the page still writes it, but only in the process that owns the session and only while its window has the focus, and a window that takes the focus writes its own tabs there. Going back to 0.2 opens the tabs of the window that had the focus last.

## Who saves: the owner, and the guest that becomes one
- `session.lock` still decides. The first plain process takes it; a process started with paths ("Show in folder" from another app, with no glasshouse running) is a guest: it restores nothing and writes nothing, so the user's next plain start still gets their windows. A second process that couldn't hand off (`2026-11-21-split-and-tear-off-handoff.md`) is a guest too, since the owner holds the lock.
- **A guest becomes the owner** when a plain launch is handed to it and it can take the lock: it registers the window-state plugin, restores the saved windows (which got free labels from it: a guest's windows never take a saved label), and saves from then on. The windows it already had stay and keep their tabs; they're part of the session from then on. Without this, a day that started with "Show in folder" would keep the session shut away until every window closed.
- At exit the owner writes the session and lets go of the lock before the process ends, so an update's restart can take it. The Windows installers' update ends the process with `std::process::exit`, which skips the run loop's Exit, so the updater's `on_before_exit` writes the session first.

## The automatic update check
Every window runs the hook, so `update_check` with `auto` holds a lock through the check: the first window's check makes the others' not due. The check itself is unchanged.

## Not done
- A window's size and place are saved by the window-state plugin by label. A closed window's entry stays in its file; it's used again only if a window gets that label again.
- The windows a guest opened before it became the owner aren't tracked by the window-state plugin, which was registered after they were made, so their size and place aren't saved.
- History, selection and scroll position still aren't saved (phase 3's transfer record carries history, but only between windows of one run).
