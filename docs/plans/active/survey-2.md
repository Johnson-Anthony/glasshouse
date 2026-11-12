# Second survey pass

On 2026-11-11, four read-only agents surveyed the app (at `45ea31b`): frontend bugs, backend bugs and security, the spec versus what the app does, and tests, release and performance. This is the deduplicated backlog, with one task per worktree session. Line numbers drift, so search by name. Items marked *(Win, unverified)* are Windows code, read but never compiled here; the windows-latest CI job is their first build.

## Status
| # | Task | Area | Size | Status |
|---|---|---|---|---|
| **Wave 1: data loss and security** |||||
| 1 | archive-safety | Rust + `handlers/archive.ts` | M | **merged** (4c535a0) |
| 2 | git-safety | Rust + `handlers/git.ts` | S–M | **merged** (3756be3) |
| 3 | selection-integrity | frontend | M | **merged** (ee32e5b) |
| 4 | terminal-cd | frontend | S | **merged** (3d23a8b) |
| 5 | focus-and-targets | frontend | M | **merged** (8a3dfc8) |
| 6 | inspector-perms | both | M | **merged** (41bde85) |
| 7 | find-replace-safety | both | S | queued |
| 8 | fs-robustness | Rust + `handlers/fileOps.ts` | S–M | merged (2bd2208) |
| 9 | watcher-fixes | Rust | S | **running** (`cool-gauss-d234ca`; resumed 11-12 after the RAM pause) |
| **Wave 2: release** |||||
| 10b | security-deps | both | M | queued: chip offered for a fresh session (before the v0.2.0 tag; Dependabot PRs #3–#8 overlap, lead handles them) |
| 10 | release-prep | config + CI | S | **merged** (c6dab0c; the tag itself is the user's call) |
| **Wave 3: undo and trash** |||||
| 11 | undo-coverage | frontend | M | merged (e225489; Extract undo done here; Find & Replace and Trash left to tasks 7 and 12) |
| 12 | trash-restore | both | M | queued |
| **Wave 4: performance** |||||
| 13 | pane-perf | frontend | L | **paused** (`cool-satoshi-4102fc`; plus a vitest DOM environment; no 100k-entry data in headless Chromium) |
| 14 | refresh-cost | both | M | queued |
| **Wave 5: promises and UX** (README and site claims first) |||||
| 15 | palette-commands | frontend | M | queued |
| 16 | menu-honesty | frontend | S–M | queued (needs user decisions) |
| 17 | paths-and-search | frontend | S–M | queued |
| 18 | session-persistence | both | S–M | queued |
| 19 | keyboard-menus | frontend | M | queued |
| 20 | git-ux | frontend + `GIT_RUN_ALLOWED` | S–M | queued |
| 21 | open-with | both | S–M | queued |
| 22 | os-drag-drop | both | M–L | queued |
| 23 | miller-parity | frontend | M | queued |
| 24 | tags-follow | frontend | M | queued |
| 25 | folder-size | both | S–M | queued |
| **Wave 6: tests, CI and dependencies** |||||
| 26 | test-gaps | both | S | queued |
| 27 | ci-hygiene | CI | S | merged (7bb4385) |
| 28 | deps-bump | both | M | queued |

**Scheduling notes:**
- Run at most two Rust tasks at once (RAM).
- Tasks 3, 5 and 13 all touch `App.tsx` and `components.tsx`, so run 13 after 3 and 5 are merged.
- Tasks 7 and 11 both touch `handlers/tools.ts`.
- Task 1's extract loop is what task 11's extract undo builds on.

## Every task
- Read CLAUDE.md, PROGRESS.md, docs/ARCHITECTURE.md and your section below.
- Write your plan to `docs/plans/active/<task>.md`, then implement it; no OK is needed. For a design choice, pick the option you'd recommend and record it in `docs/decisions/`.
- **Before calling it done:**
  - run `pnpm build`, `pnpm test` and `pnpm check:wiring`;
  - for Rust, also run `RUSTFLAGS="-D warnings" cargo clippy --all-targets` and `cargo test` in `src-tauri`;
  - after UI changes, also run `pnpm site:build` and `pnpm site:capture check`.

  Add tests for what you fix.
- Keep the "file writes never clobber" rule (ARCHITECTURE.md → Conventions). A new command needs `permissions/app.toml`.
- **Wrap up** as CLAUDE.md describes for task branches. Don't push.

## 1. archive-safety (Rust + `handlers/archive.ts`, M)
- **Extract overwrites existing files.** Extract Here and Extract to Folder replace any file whose name is already taken: the zip crate's `extract` uses `File::create`, `tar -xf` replaces by default, and `7z x -y` answers yes to everything (`archive.rs` `archive_extract`). Three agents found this, and tar and 7z were reproduced.
  - Fix: extract into a fresh temp folder next to the target, then move each top-level entry in without replacing, through the paste conflict dialog or a `name (2)` folder.
  - Clean up the temp folder and partial output on failure.
- **Zip of a file ≥ 4 GiB fails.** It fails with "Large file option has not been set", and the writer's Drop still finalizes a valid-looking zip missing entries. Set `.large_file(len >= u32::MAX)` per entry. Remove the output on any error, for zip and tar.gz alike.
- **Zip creation silently skips** symlinks and entries whose metadata can't be read. Count them and report them in the result.
- *(Win, unverified)* **Extracted files lose Mark-of-the-Web.** Copy the archive's `Zone.Identifier` onto each extracted file, and pass `-snz` to 7z. A zip with symlink entries fails partway on Windows without Developer Mode, with error 1314; skip or flag those entries. Also check where zip symlink entries point.

## 2. git-safety (Rust + `handlers/git.ts`, S–M)
- **Discard permanently deletes folders.** Git → Discard Changes `remove_dir_all`s untracked, ignored and staged-but-never-committed folders. `git.rs` `git_discard` builds `to_delete`, and the git-menu handler sends every selected path unfiltered.
  - Fix: delete only paths that are WT_NEW and have no index entries under the prefix, and move them to the trash rather than deleting.
  - Make `git.ts` and `fileOps.ts` Stage/Unstage/Discard filter the same way.
- **The Checkout… prompt can discard work.** Typing a folder name (`docs`, `.`) runs `git checkout docs`, which restores those paths from the index; reproduced. Send `checkout <branch> --` (allow it in `GIT_RUN_ALLOWED`) or use `switch`.
- **Staging an untracked folder always fails.** libgit2's `add_path` rejects directories, so use `index.add_all([rel])` for them.
- **Read size caps.** `git_blame` and `diff_files` (`file_info.rs`) read whole files with no size cap; refuse anything over about 16 MiB.

## 3. selection-integrity (frontend, M)
- **Selection, focus and anchor are row indexes**, never remapped on re-list (`state.ts`, `components.tsx`, App's ctx). After a file appears or disappears, Delete acts on a different file. Key them by path, or remap by path in `fetchAll`.
- **Stale rows during navigation.** After navigating, the old folder's rows stay visible and clickable until the new listing arrives, which on a slow share can be seconds. Clear the entries on a path change (a non-quiet fetch).
- **The search filter is window-wide and never clears.** Select All, Invert (Ctrl+I) and Select by… pick hidden rows (`handlers/selection.ts` uses `entries`), so a filtered Ctrl+I then Delete trashes hundreds of hidden files.
  - Keep the filter per tab (or clear it on navigation), and have the selection commands use the visible rows.
  - Show "no matches for x".
- If it fits, fix Find in Files staying on "searching…" when the query is cleared mid-search (`App.tsx`).

## 4. terminal-cd (frontend, S)
- **Follow-folder `cd` runs commands.** `shellCd.ts` double-quotes the path, so a folder named `$(touch PWNED)` runs that command in bash, zsh, fish and PowerShell. Quote properly for each shell:
  - POSIX shells: single quotes, with `'\''` escaping;
  - PowerShell: `Set-Location -LiteralPath '…'`, doubling `'`;
  - cmd: `cd /d "…"`.
- **The `cd` is typed into whatever is running.** It's sent even into vim, a REPL, ssh or a sudo prompt, and even while the drawer is closed. Only send it while the drawer is open, and offer a setting to turn follow-folder off.
- Copy as Command builds `cd "<path>"` the same way, so use the same quoting.
- With the drawer open, Ctrl+Shift+` opens two terminal tabs: `Terminal.tsx` and `keymap.ts` both handle it.

## 5. focus-and-targets (frontend, M)
- **Enter in a modal dialog runs Open on the selection.** The pane's key handler and App's window listener don't know a dialog is open (`DialogHost.tsx`, `FolderPicker.tsx`). In Move to…, Enter moves the item and also navigates the pane. Add a modal-open flag that both check, and autofocus the dialog's primary button.
- **File keys act on the pane's selection while the sidebar has focus.** Delete, F2 and Ctrl+C/X/V do this (`keymap.ts`, `Sidebar.tsx`). Only fire file bindings when the pane has focus, or route them to the sidebar's row.
- **Sidebar file rows** (tree "Show files", pinned files) are treated as folders: a click says "can't read this folder", and their context-menu commands fall through to the pane's selection. For example, Git: Discard on a tree file discards the pane's files. Open files with the default app, and run commands on the right-clicked path (`handlers/target.ts`).
- **Smaller ones:**
  - in Miller, Enter on a file opens it twice (the event isn't stopped);
  - Ctrl+C on selected text in the Inspector preview copies the selected files instead;
  - right-clicking empty pane space while something is selected shows the file menu, which has no Paste or New.

## 6. inspector-perms (both, M)
- **The Inspector's permission grid is hard-coded.** It always shows `rwxr----- 0740` (`preview/Inspector.tsx`), and one click runs chmod from that fake value: owner-exec on a 0600 ssh key makes it 0640. Return the real mode from `file_stat_extended`, reset the grid when the file changes, and confirm before applying. On Windows, show only read-only.
- A slow "# hash" result lands on whatever file is selected when it finishes; drop it if the path changed.

## 7. find-replace-safety (both, S)
- **Find & Replace in Files corrupts files.** `handlers/tools.ts` reads with lossy UTF-8 (`read_text`) and writes back with a plain, non-atomic overwrite, so Latin-1 and cp1252 bytes become U+FFFD for good.
  - Fix: add a backend replace that works on bytes and skips files that aren't valid UTF-8, and writes through a temp file plus rename.
- Search ignores case but replace doesn't. Use one rule for both.
- It stops at 500 matches while the toast still says "replaced in N files": report the cap.
- Add a per-file preview, and push an undo entry (task 11 can do the undo).

## 8. fs-robustness (Rust + `handlers/fileOps.ts`, S–M)
- **Partial copies are left behind.** A failed folder copy (a socket inside, an unreadable file) leaves the half-copied destination, and a retry then says "already exists". A cross-volume move whose delete step fails leaves the copy plus part of the source. Cleanup only runs on cancel (`fs_ops.rs`). On any error, remove the destination; that's safe because `create_dir` refused a taken name.
- **Delete Permanently stops partway.** `deleteEntry(p, false)` refuses a non-empty folder, and the first failure aborts the batch with no refresh. Move to Trash aborts the same way. Decide on recursive delete (with the confirm saying so), keep going, report what failed, and always refresh.
- **FIFOs hang a worker thread.** Previewing, hashing, compressing or reading a FIFO blocks forever (`File::open`), and about 10 stuck calls stall every async command. Refuse anything that isn't a regular file before opening.
- **Cross-volume moves and copies reset modification times** on Linux. Fix with `File::set_times` per file; set folder modes and times after their contents are done.
- `write_config_atomic` never fsyncs before the rename *(inferred)*.

## 9. watcher-fixes (Rust, S)
- **Two tabs share one watch.** With two tabs on the same folder, when one leaves, its `unwatch_dir` drops the only registration and the other stops getting `fs-changed` (`watcher.rs`). Add a reference count per path, plus a test that unwatches once.
- **`watch_dir` stats every entry on the main thread.** The debouncer's default file-ID cache does this, and on Windows it opens every file, so a 50k-entry or SMB folder freezes the UI. Use `new_debouncer_opt` with `NoCache`, since rename stitching isn't used *(Win part unverified)*.
- The watcher tests are unix-only; make the platform-neutral ones run on the Windows job.

## 10. release-prep (config + CI, S)
- **The version is still 0.1.0** in `package.json`, `src-tauri/Cargo.toml` and `tauri.conf.json`. Bump all three to 0.2.0 and commit `Cargo.lock` (CI uses `--locked`). Add a release.yml step that fails when the tag doesn't match the version.
- **release.yml hazards:**
  - running it by hand from `main` tags and publishes a "Latest" release named `main`;
  - both build jobs publish a non-draft release, so a Linux-only release is public while Windows builds, and stays that way if Windows fails.

  Publish as a draft, make it public in a final job, and require a `v*` tag.
- **Linux packages:**
  - build them on `ubuntu-22.04`, since `ubuntu-latest`'s glibc 2.39 keeps the AppImage and .deb off Debian 12 and Ubuntu 22.04;
  - add arm64 Linux builds on `ubuntu-24.04-arm`;
  - say in the README that the AppImage needs `libfuse2` on Ubuntu 24.04+.
- **A CHANGELOG** with v0.2.0 notes: the data-loss fixes since July; that saved tweaks reset once (new key); and that Show Ignored, Show Checksums and Browse archive in place are gone.
- Wave 1 should be merged first, since the site's Download button serves July's v0.1.0, which still has the paste-clobber bugs. Tagging is the user's decision.

## 10b. security-deps (both, M; before the v0.2.0 tag; found 2026-11-12 by ci-hygiene)
ci-hygiene checked Cargo.lock against OSV (RustSec plus GitHub advisories). The parts of task 28 that must land before a release:
- **zip 2.4.2 → 9.x:**
  - GHSA-m665-v7pm-7grj (critical; fixed in 9.0.5): a parser differential makes a zip look different to different readers;
  - GHSA-q7v9-x93c-xqv3 (high) and GHSA-8hxf-qr8p-62x4 (AES HMAC bypass), both fixed in 9.0.0;
  - RUSTSEC-2026-0367, 0368, 0369 and 0429, fixed in 9.0.0. They concern `ZipArchive::extract` and SUID bits, which archive-safety's own extraction loop and mode mask probably avoid, but cargo audit flags them.

  This is a major bump through archive-safety's code (`commands/archive.rs`): rerun all its tests, including the ignored 4 GiB one.
- **tauri 2.10.3 → ≥ 2.11.1:** GHSA-7gmj-67g7-phm9 (moderate), "origin confusion" lets remote pages call local-only IPC commands. glasshouse loads no remote pages, so the impact is probably low, but bump it. Keep the JS `@tauri-apps/*` versions in step.
- **zstd 0.13.3 → 0.13.4 and zstd-safe → 7.4.0** (RUSTSEC-2026-0391, 0398, 0403), **quick-xml → 0.41** (0194, 0195), **crossbeam-epoch → 0.9.20** (0204) and **libz-sys → 1.1.31** (0418).
- The warnings-only items (git2 unsound, glib, rand 0.7, unmaintained crates) stay in task 28.
- Every lockfile change needs `pnpm notices`. Windows CI is the first Windows build.
- **User decision:** turn on Dependabot alerts and security updates in the repo's GitHub settings. dependabot.yml only covers version updates.

## 11. undo-coverage (frontend, M)
- **These push no undo entry**, so Ctrl+Z undoes an older, unrelated action:
  - Bulk Rename and its rollback (`dialogs/BulkRename.tsx`);
  - From Template, Python Module, Paste Text into Filename, Create Symlink and Paste as links (`handlers/misc.ts`);
  - Extract, Screenshot Auto-sort (`handlers/tools.ts`) and Find & Replace.

  Push undo entries, or clear the undo stack after anything that can't be undone.
- Move Bulk Rename's rollback loop into `names.ts` and test it, including swaps through temporary names.
- Screenshot Auto-sort reports "moved N" even when some months' conflict prompt was cancelled *(inferred)*.

## 12. trash-restore (both, M)
- **Nothing can be restored from the trash.** Move to Trash, the most common delete, has no undo (`fileOps.ts`), and on Windows Go → Trash just says "trash view coming in v2" (`nav.ts`). The `trash` crate's `os_limited` list and restore cover both platforms.
  - Add undo for Move to Trash, and a Trash view with Restore.
- *(Win, unverified)* On a network share, Move to Trash may delete permanently with no warning, because the trash crate passes `FOF_NO_UI`. Check, and warn first.

## 13. pane-perf (frontend, L; after 3 and 5)
- **The file list isn't virtualised** (`components.tsx`): at 100k entries that's about 700k DOM nodes. The marquee also calls `getBoundingClientRect` on every row on each mouse move, and focus uses `querySelector` over all rows. Rows are a fixed height, so use a windowed list plus index arithmetic.
- **Every App re-render rebuilds `rows` and re-sorts.** `renderActivePane` builds a new array, and every `PaneRow` memo misses.
  - The sort lower-cases each name on every comparison: 280 ms at 100k, against 63 ms with keys computed once.
  - Re-renders happen on each arrow key, and on every background tab's poll (`setEntries` always gets a new array).
  - Memoise the rows, compute sort keys once, and skip `setEntries` when nothing changed.
  - This also fixes the known "re-render scrolls back to the focused row" issue.
- **xterm (~340 kB) loads at startup** through a static import in `App.tsx`, even though the drawer starts closed. `React.lazy` it to clear Vite's chunk-size warning.

## 14. refresh-cost (both, M)
- **Two git status scans per refresh.** `list_dir` scans (whole repo at the repo root) and `git_status` scans the whole repo again, returning a `status` map the frontend never reads. That happens on every navigation, fs event and 30 s poll, in background tabs too.
  - Drop the map, cache the dirty count per HEAD and index change, and don't poll background tabs.
- **Refresh storms during big pastes.** The debouncer emits about every 75 ms while files land, and `fetchAll` starts a new listing even while one is running: about 13 listings a second, each with two scans.
  - Allow one listing at a time per tab, plus a trailing refresh at least 500 ms later.
- **`list_dir`** sorts with two lowercase allocations per comparison: use `sort_by_cached_key`, or drop the sort, since the frontend re-sorts.
- **Startup:**
  - the sidebar awaits home → drives → WSL → home in sequence: parallelise it;
  - `wsl.exe --list` has no timeout, and runs twice (the closed drawer loads profiles too);
  - *(Win, unverified)* `drives()` queries every letter, including disconnected network and empty removable drives, without `SetErrorMode`, so it can hang or show a "no disk" dialog.

## 15. palette-commands (frontend, M)
- **The palette searches only 19 of about 220 commands** (`data.ts` palette list), while the site says it "finds any command from a few letters". Its placeholder ("type a command, path, or :mode", plus Tab, `:go`, `/find`, `!shell`) promises things that don't exist.
- Build it from `MENUS` and the context trees, with shortcuts shown. Either make path entry work or drop those placeholder promises.

## 16. menu-honesty (frontend, S–M; needs user decisions)
These items do nothing, or something else. Make each work, or remove it. For the ones marked **decide**, bring the options to the lead.
- **Partly broken:**
  - Zoom Pane toggles a class nothing styles;
  - Full Screen / F11 only maximises;
  - Terminal → Open in New Window opens a new file-manager window at home, and the sidebar's "Open in New Window" opens a tab;
  - "Text Editor (.txt)" is the same as Default App.
- **Stubs:** Clipboard Stack and File Queue are alerts; Expand Selection to Folder selects everything.
- **Windows shows Unix-only items:**
  - Change Owner always errors;
  - Batch Permissions asks for an octal mode but only toggles read-only;
  - New → Script (.sh) and Root `/` still appear;
  - Copy as UNC gives `\\localhost\C$\…`, wrong for mapped drives (needs `WNetGetConnection`).

  Strip them the way `stripWinOnly` does in the other direction.
- **Fake display modes (decide):** "Grid (thumbs)" has no thumbnails and "Tree Flat" is just denser rows (`styles/app.css`). In Icons, Tiles and Grid, Left/Right do nothing. Build real thumbnails, a flat recursive list and 2-D arrow keys, or cut the modes.

## 17. paths-and-search (frontend, S–M)
- **Typed paths.** Go to Path…, Open… (Ctrl+O) and the path bar advertise `~/…` and `https://…`, but `goTo` (`state.ts`) doesn't expand `~` or open URLs, and a file path gives "can't read this folder". Expand `~`, hand URLs to the opener, and open a file's folder with the file selected.
- **Known folders.** Desktop, Documents, Downloads and Pictures are home + an English folder name (`nav.ts`), which is wrong with OneDrive redirection and with localised XDG folders. Use Tauri's `desktopDir`, `documentDir`, `downloadDir` and `pictureDir`.
- **Search results are dead ends.** A Find in Files hit opens the folder without selecting the file. Find File by Name shows its matches as alert text. Make both open the result selected in place.

## 18. session-persistence (both, S–M)
- **Nothing persists:**
  - window size and position (add the window-state plugin; run `pnpm notices` after the lockfile change);
  - open tabs and their folders;
  - sort column and direction (`state.ts` resets to Name, and the Sort menu's ✓ is hard-coded to Name in `data.ts`);
  - sidebar, Inspector and status-bar visibility.
- Make the ✓ show the real sort.

## 19. keyboard-menus (frontend, M)
- `menus.tsx` has no key handling. Add:
  - arrow keys, Enter and Esc in menus;
  - Alt (or F10) to open the menubar;
  - the Menu key or Shift+F10 for the context menu.
- The file list has no type-ahead (typing letters to jump to a name).

## 20. git-ux (frontend + `GIT_RUN_ALLOWED`, S–M)
- **Commit Amend** says "(leave empty to reuse)", but an empty message does nothing. Use `--no-edit`, which must be added to `GIT_RUN_ALLOWED`.
- **Branch prompts.** Checkout, Merge and Rebase ask for a typed branch name though a branch list exists: use a picker. This builds on task 2's checkout fix.
- **Remote commands.** Pull, Push and Fetch have no progress, cancel or timeout. Use the op-progress tray.
- Commit is a one-line prompt with no view of what's staged.

## 21. open-with (both, S–M)
- **Opening fails silently.** Double-click or Enter on a file with no associated app does nothing, because `openWithDefault` swallows the error. The Inspector chip's VS Code button uses the non-strict `spawnVscode` the same way. Show the error.
- **Custom Command…** runs the whole typed string as one program, so `grep -n foo` fails, and the placeholder `echo` isn't a program on Windows. Split the arguments safely, never through a shell, and keep the command-security rules.
- **Choosing an app.** Open With has no real chooser: list the installed apps for the type (`mimeapps`/`.desktop` files on Linux, the registry on Windows) or let the user browse to a program.

## 22. os-drag-drop (both, M–L)
- **No drag and drop with other apps.** `dragDropEnabled` is on, but nothing listens for drops, so files dragged in from Explorer or Nautilus do nothing, and you can't drag files out.
- **Modifier keys.** Shift+drag copies, while Explorer and Nautilus use Ctrl to copy (and Shift to move).
- **Drop targets.** Make tabs and breadcrumbs accept drops.

## 23. miller-parity (frontend, M)
- Miller columns has no context menu (App blocks the browser's), no multi-select and no drag, and it ignores the sort setting. Share the pane's context menu and selection model. PROGRESS Next already lists Esc to deselect; fold it in.

## 24. tags-follow (frontend, M)
- Tags are keyed by path and don't follow rename, move or trash. A renamed file loses its tags, the sidebar's counts include files that are gone, and a new file at the old path inherits them.
  - Move tag keys in rename, move and transfer, and prune missing paths.
- `selection.ts` and `TagPicker.tsx` read tags from disk instead of App's `tagStore`.

## 25. folder-size (both, S–M)
- Properties shows "—" for a folder's size, and nothing can add one up. Add a cancellable folder-size op through the op-progress tray.

## 26. test-gaps (both, S)
- **Untested Rust commands:** `set_permissions`, `create_symlink`, `create_hard_link`, `change_owner` and `write_text` with overwrite.
- **Untested failure paths:** a copy failing partway (task 8 adds the cleanup), and partial delete batches.
- The bulk-rename rollback is covered by task 11.

## 27. ci-hygiene (CI, S)
- **The demo build.** Nothing checks that `pnpm site:build` leaves `docs/demo` unchanged; it has been rebuilt by hand six times. Add that check, and run `pnpm site:capture check` in CI if chromium is available on the runner.
- **Security updates.** Add Dependabot (or Renovate) and `cargo audit`.
- **Formatting.** rustfmt reports 148 differences. Adopt `cargo fmt --check` only at a quiet point, since it touches the shared files.

## 28. deps-bump (both, M)
- **The windows crate.** Four versions compile on Windows: 0.56 (trash), 0.57 (sysinfo 0.32), 0.58 (ours) and 0.61 (tauri). Move ours to 0.61 and bump sysinfo; that needs the Windows CI loop.
- **Frontend.** Vite 5.4 brings esbuild 0.21.5, which has a dev-server-only advisory (GHSA-67mh-4wv8-2f99). Vitest 2.1 is behind.
- **Rust.** git2 0.19 and notify 7 are a major version behind. git2 0.21 exposes `CheckoutBuilder::disable_pathspec_match`, so its bump can replace `checkout_head_exact`'s raw `libgit2-sys` call in `commands/git.rs` and drop that direct dependency.
- Every lockfile change needs `pnpm notices`.

## Found by tasks (not yet scheduled)
- *(from focus-and-targets)* The sidebar tree doesn't re-list after file ops in the pane: delete `Documents` in the pane and the tree still shows it. Seen in the demo; not yet checked in the real app. Small.
- *(from focus-and-targets)* Pinned files show the folder icon. The sidebar now knows which pins are files (`pinFiles`). Cosmetic, small.

- *(from terminal-cd)* **pty-foreground** (Rust + a little frontend): follow-folder still sends a (harmless, failing) `cd` when ssh or a Python REPL started from the local shell owns the terminal. The backend could report whether the shell is the pty's foreground process: `tcgetpgrp` on the master vs the child pid on unix (portable-pty's `process_group_leader`), child processes on Windows.
- *(from terminal-cd)* **git-bash-paths** (frontend, S): on Windows `winPathToWsl` turns `C:\x` into `/mnt/c/x` for every POSIX shell, but Git Bash wants `/c/x`. Tell it apart from WSL's `bash.exe` by its exec path. Predates terminal-cd.
- *(from terminal-cd)* The zsh, fish and pwsh real-shell tests are skipped locally (not installed). CI's Ubuntu runner has pwsh, so CI is that test's first run.

- *(from archive-safety)* **tar/7z link check** (Rust, S): tar and 7z extraction don't check where archived symlinks point (zip extraction now does). Scan the staging folder after extraction and skip and report links that point outside it.
- *(from archive-safety)* **read-only staged folders** (Rust, S): a tar whose top-level folder is mode 0555 can't be moved out of staging on Linux (rename needs write permission on it). Make staged folders owner-writable before the move, as the zip path does.
- *(from archive-safety)* On Windows the staging folder (`.glasshouse-extract-<pid>-<n>`) is visible while extraction runs, and is left behind if the app dies mid-extract. Set the hidden attribute, and clean up stale staging folders on start.

- *(from git-safety)* `launch::tests::run_capped_kills_the_whole_tree_at_the_timeout` failed once at load average ~7 ("background child outlived the timeout"), then passed alone and in three full runs. Possibly flaky under load; for test-gaps or ci-hygiene.
- *(from git-safety)* git2 0.19's `add_all`/`update_all` callback crashes (null CStr) on an empty pathspec. We no longer hit that path; deps-bump should check whether a newer git2 fixes it.

- *(from selection-integrity)* **dom-tests** (frontend, S): a DOM test environment for vitest (happy-dom or jsdom) so `useTabState` and `FilePane` can be unit-tested; today the hook-level fixes are covered only by the demo checks in `site/capture/capture.mjs`. Lockfile change, so `pnpm notices`.
- *(from selection-integrity)* A shift/ctrl marquee in progress during a re-list mixes old and new indexes (pre-existing; pane-perf reworks the marquee). "Select by Tag" says "nothing in this folder is tagged" when it means "nothing shown" under a filter. Filter and sort now live in `src/viewRows.ts`; pane-perf's sort-key work goes there.
- *(from release-prep)* **actionlint** in CI: folded into ci-hygiene.
- *(from fs-robustness)* 7-Zip 25 fails a whole extraction on one climbing link ("Dangerous link path was ignored", exit 2), where zip and tar now skip the link and report it. Could map that one 7z error to a skip.
- *(from fs-robustness)* On Windows a failed top-level single-file CopyFileW is left to CopyFileW's own cleanup (some of its errors mean the target was already there and isn't ours). Check on a real Windows machine.
- *(from undo-coverage)* Task 7 can push `contentUndo(label, path, before, after)` per file; task 12 (Move to Trash) is the last file change with neither an undo entry nor `markIrreversible`. Change Owner could get an undo if `file_stat_extended` returned uid:gid. Paste Special's undo entry and the "can't undo" toast aren't unit-tested (no DOM; see dom-tests).

## Unconfirmed: check before fixing
- The terminal has no flow control: `yes` or `cat bigfile` sends one `pty-data` event per 4 KiB read and may freeze the webview (`pty.rs`).
- The dialog host holds one dialog at a time, so a second one replaces the first, whose promise then never settles.
- The terminal buffers up to 256 events from every session until a new tab's id arrives, so a busy tab could push out the new tab's first prompt.
- *(Win)* `delete_entry` sends directory symlinks and junctions to `remove_file`.
- *(Win)* `pty_kill` drops the ConPTY on the main thread, where closing it can block.
- *(Win)* An open watch handle may block renaming the watched folder's parent.
- New Tab, Open in New Tab and Duplicate Tab don't switch to the new tab (New Private Session does). It may be intended.
