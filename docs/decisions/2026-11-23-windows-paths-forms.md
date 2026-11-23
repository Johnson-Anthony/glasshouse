# windows-paths: which form of a path the app shows, saves and passes on

Date: 2026-11-23. Task 34 of `docs/plans/active/survey-3.md`. Code: `src-tauri/src/winpath.rs` (the rules, pure functions), `commands/listing.rs` (`list_dir`), `commands/config.rs` (saved paths), `src/paths.ts` (`plainPath`), `src/winNames.ts` (name rules).

## Context
`list_dir` canonicalized the folder it was asked for and built every entry's path from the result. So a row's path was the *real* folder's, not the one the tab was in:
- On Windows, `canonicalize` gives the verbatim form (`\\?\C:\…`, `\\?\UNC\server\share\…`). `dunce` turns it back into `C:\…` only for a drive path under MAX_PATH; a share never comes back, and neither does a long path. A folder on a mapped drive (`Z:\photos`) listed its rows as `\\?\UNC\nas\media\photos\…`, and opening one put that in the tab, the breadcrumb, the recents, pins and tags. Programs handed such a path (`explorer`, an editor, cmd) often refuse it.
- On every platform, a folder reached through a link (a symlink, a junction, a `subst` drive) listed its rows under the link's target, so opening a subfolder silently left the place the user was in.

The app's own raw Win32 calls (`MoveFileExW` for a rename that mustn't replace, `CopyFileW`, `ReplaceFileW`) got paths as typed, so past MAX_PATH they failed wherever the system-wide long-path switch is off, which is the default.

## Decisions

**A listing keeps the path it was asked for.** `list_dir` reads the folder as given and joins each name to it. The canonical path is still worked out, once, for the one thing that needs it: finding the repository and matching libgit2's status paths (`real.join(name)`). This is the same on Linux, and it's a deliberate change there: rows of a folder reached through a symlink now have paths through the symlink, like the tab itself always had.

**The app shows, saves and compares the plain form; raw Win32 calls get the verbatim one.** `winpath::plain` turns `\\?\C:\x` into `C:\x` and `\\?\UNC\s\sh\x` into `\\s\sh\x` whatever the length, because both std (`maybe_verbatim`) and `to_verbatim` add the prefix back when a call needs it. It refuses, and the verbatim path is kept as it is, where the plain spelling would name something else: a volume GUID path, a component ending in a dot or a space, `.` or `..`, or a DOS device name (`\\?\C:\x\NUL` is a file; `C:\x\NUL` is the device). The same rule runs in the frontend (`plainPath` in `paths.ts`) on every path a tab is given (`navInit`, `navGoTo`, a typed path, a restored session), so a verbatim path from a saved session, the command line or another program lands on the plain one.

**`to_verbatim` for every raw call.** It makes the path absolute and, from 248 UTF-16 units with the NUL (where std starts too: `CreateDirectoryW`'s limit), verbatim, doing the normalizing a verbatim path skips (`/`, repeated separators, `.`, `..`). It does not strip trailing dots or spaces: a long path then names exactly the entry the listing gave. Short paths go as they are, so nothing changes for them.

**The manifest says `longPathAware`, and names Windows 10/11 in `supportedOS`.** With the system switch on, every API the app or its libraries call takes long paths; with it off (the default), std's calls and ours still do, through the verbatim form. What still stops at MAX_PATH with the switch off: programs the app starts in a long folder (the shell, git, 7-Zip, the default app for a file), the Recycle Bin (`IFileOperation`), and the folder watcher. Those are Windows' or other programs' limits.

**Saved paths are moved to the plain form once, when they're read.** `read_pins`, `read_recent` and `read_tags` pass what they read through `saved_paths` / `saved_tags` and write the file back if anything changed (Windows only; other platforms never saved a verbatim path). A `\\?\UNC\server\share\x` key becomes `Z:\x` when a drive is mapped to that share now (`WNetGetConnectionW`, asked only when such a key is there; the deepest share wins), because that's the path the user reached it by and the one listings give again. With no mapping it becomes `\\server\share\x`. Duplicates this makes are dropped (lists) or have their labels joined (tags). The session needs no backend step: `parseTab` runs `plainPath`.

**Tags saved under a link's target stay there.** Before this change, a file tagged inside a folder reached through a symlink (or junction) was saved under the target's path. Those tags still show when the folder is opened by its real path, and in the sidebar's TAGS; they don't show on the row seen through the link, where a new tag is now saved under the link's path. Moving them would need to know which link the user came through, which nothing records, and resolving every tag key on every listing costs a stat per key. The Windows verbatim keys, the case that affected everyone with a share, are migrated as above.

**The trash records the real path; the tags remember the pane's.** `move_to_trash` reports the canonical original, and Redo (and Undo of a restore) trash that path again, while the tags are keyed by the path the pane showed. `tags.ts` keeps, for this run, which pane path each recorded path was trashed by (`trashedAs`), and drops the tags at both.

**Copy and move compare real places, and act on the paths given.** With listings keeping the requested path, two tabs can show one folder under two paths (`/link/sub` and `/real/sub`; `Z:\photos` and `\\nas\media\photos`). As strings, a drop from one onto the other was a move to another folder onto a taken name, and its Replace answer trashed the item being moved (the move then failed, leaving it in the trash). So `planTransfer` asks the backend where the destination and each item's folder really are (`real_path`, one call per folder), and the three place checks in `transfer.ts` (already there, a folder into itself, Replace on a folder holding the source) compare those. The steps still use the paths the user sees. Only folders are resolved, so an item that is itself a link is treated as the link. The backend's own guard (`check_not_into_self`) already resolved links; it runs after the Replace step, which is why the page has to know.

**Names.** `nameProblem` and Bulk Rename's `checkRenames` refuse, on Windows, what the file system or Win32 would mangle or refuse: `< > : " | ? *` and control characters, a trailing dot or space, and DOS device names (`CON`, `NUL.txt`, `COM1`…). `a:b` used to create an alternate data stream on file `a`. On Linux the same rules apply where the *target folder* is on a file system with Windows' rules (`path_fs_type` is vfat, exfat, cifs/smb3…), with "on this drive" in the message instead of "on Windows". The check is in the page only; the backend still does what it's asked, so a script or another caller isn't protected by it.

**Dotfiles show on Windows.** Hidden there means the Hidden or System attribute; a leading dot is a Unix habit, and `.gitignore` or `.github` in a project folder were invisible unless Show Hidden was on. Linux is unchanged.

**Shells on Windows: PowerShell first, then Command Prompt, then bash.** `pwsh.exe`, `powershell.exe`, `cmd.exe`, then `bash.exe` only when it's a real shell: the first on `PATH` that isn't WSL's launcher (`System32\bash.exe`, the Store alias under `WindowsApps`), else Git for Windows' in its usual install folders. WSL distros keep their own profiles.

**Reveal uses `SHOpenFolderAndSelectItems`.** `explorer /select,<path>` splits at a comma, so a file named `a, b.txt` opened Documents instead. The shell call takes the item itself. If it fails (a path the shell can't parse), the old command line is the fallback.

**Tests that need a tool fail on CI when it's missing.** `testing::have_tool` returns false locally and panics when `CI` is set, for `git`, `tar` and 7-Zip; the Linux CI job installs `p7zip-full`. Before, such a test printed "skipped" and passed, so a CI image without the tool tested nothing.

## Found on the way: opening a subfolder could abort the app (Linux)
The new end-to-end flow crashed the app in the second of its first two runs, and not in this task's code. notify watches with `IN_OPEN`, so listing a subfolder queues an event on the watch of the folder above, which the tab is leaving at that moment. When notify reads an event whose watch is already removed, it passes the event on with no path. notify-debouncer-full 0.4.0 reads `event.paths[0]` of every event (`lib.rs:270`), so its thread panicked while holding the debouncer's lock, and the next `watch_dir` or `unwatch_dir` (main thread, inside a command) panicked on the poisoned lock, which aborts the process.

`watcher.rs` now gives the debouncer a watcher type of its own, `PathEvents`, which wraps the OS watcher and passes on only errors, rescan requests and events with a path. `an_event_for_a_watch_that_just_went_is_dropped` reproduces it (300 rounds of opening subfolders and dropping the watch): before the change it aborted the test process with the same two panics. Whether a newer notify-debouncer-full fixes this upstream wasn't checked; updating it is a lockfile change, so that's left as a follow-up.

## What the manifest check covers
The manifest is linked into every exe (`build.rs`), the test exes included, so one Windows refuses stops the app and the tests from starting. It keeps the Common Controls v6 dependency as it was and adds the two elements with the namespaces Microsoft documents: `longPathAware` in `http://schemas.microsoft.com/SMI/2016/WindowsSettings`, inside `windowsSettings` of an `application` in `urn:schemas-microsoft-com:asm.v3`; `supportedOS` inside `application` of a `compatibility` in `urn:schemas-microsoft-com:compatibility.v1`. `xmllint --noout src-tauri/windows/app-manifest.xml` says it's well-formed, which is all that can be checked off Windows. Whether Windows accepts it is known when a built exe starts: the Windows backend tests and the e2e job.

## Not done
- No alias-aware tag store (above).
- The search walker (`ignore` crate) still treats dot-names as hidden on Windows, so Find leaves them out unless hidden items are on.
- The name rules aren't enforced in the backend.
- On a Linux FAT/exFAT/SMB folder, names are still compared case-sensitively when checking for a taken name; the file system refuses the clash, and the app reports its error.
- Mapped drives aren't visible to an elevated process, so an elevated glasshouse migrates a share's saved paths to `\\server\share\…`.
