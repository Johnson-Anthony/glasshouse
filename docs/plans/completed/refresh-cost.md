# refresh-cost

Branch: `claude/cool-gauss-d234ca` (worktree `cool-gauss-d234ca`), started 2026-11-13 from `main` (`f74e07d`).
Backlog entry: section 14 of `docs/plans/active/survey-2.md`.
Overlap: pane-perf (task 13) changes `useTabState`'s `relist` equality and `setEntries`/`gitInfo` updates. This task changes only `fetchAll` and the polling and timer code there. pane-perf was merged into this branch (`b1916f0`); `keepGitInfo` now ignores the dropped `status` map.
Added by the lead: the user-reported stale sidebar tree, top priority within the task.

## Problems
1. **Two git status scans per refresh.** `list_dir` scans the listed folder's subtree (the whole repo at its root), and `git_status` scans the whole repo again. `git_status` also builds and sends a `status` map nobody reads. This runs on every navigation, fs event and 30 s poll, in background tabs too.
2. **Refresh storms.** While a paste lands, the debouncer reports the folder about every 75 ms, and `fetchAll` starts a new listing each time, even while one is running.
3. **`list_dir`'s sort** lowercases both names on every comparison. The sidebar tree and the folder picker show `list_dir`'s order as-is, so the sort stays.
4. **Startup.**
   - The sidebar awaits home, then drives, then WSL, then the home listing, one after another.
   - `wsl.exe --list` has no timeout and runs twice at startup: once for the sidebar, once for the terminal drawer's profiles, which load even while the drawer is closed. Each terminal menu that lists profiles runs it again.
   - *(Windows)* `drives()` queries every letter with no error mode set, so an empty removable drive can show a "no disk" dialog, and a disconnected or unreachable network drive can hang the list.
5. **The sidebar tree goes stale** (user report). The user deleted `~/kestrel-test`; the tree still listed it, and clicking it showed "can't read this folder". The tree lists a folder when first opened and never again unless its menu's Refresh is used, and keeps the rows and open state of folders that are gone.

## Approach
**Git status (`commands/git.rs`):**
- Drop `GitInfo.status`.
- Cache each repo's dirty count, keyed by the canonical workdir, together with the repo state it was counted at: what HEAD points to and the index file's size and modification time.
- `git_status(path, max_age_ms)` reuses a count when HEAD and the index still match and its scan started at most `max_age_ms` ago:
  - a navigation passes the poll interval;
  - a refresh (fs event, poll, F5) passes the time since it began, so only a scan it started itself counts;
  - none always scans.

  A key of HEAD and index alone would miss edits that aren't staged.
- `list_dir` at a repo's root already scans the whole repo, so it stores its dirty count too. `fetchAll` asks for git status after the listing, so at the root one scan serves both.

**`list_dir`:** `sort_by_cached_key` on (not a folder, lowercase name). It's stable, so the order is the same.

**Frontend refresh (`state.ts`, inside `fetchAll` and the polling code only):**
- A quiet fetch (fs event, poll, refresh) starts only when no listing is running and the last one ended at least 500 ms ago. Otherwise one trailing fetch is queued for then, with the latest arguments.
- A navigation or a Show Hidden change starts at once and drops the queued one.
- A background tab doesn't poll, and doesn't list on fs events either. It notes that it missed something and lists once, quietly, when it becomes active. `useTabState` takes an `active` flag, which `TabShell` passes.

**Startup:**
- The sidebar starts home, drives and WSL together. The home listing follows home, not the others.
- The terminal drawer loads its profiles the first time it opens. (Dropped in the merge: pane-perf mounts the whole drawer on first open.)
- `commands/wsl.rs` holds one WSL distro lister for the sidebar and the profiles:
  - it runs `wsl.exe --list --quiet` under a 5 s timeout;
  - its result is cached for 5 minutes, and concurrent callers wait for the one run.

  The timeout runner and the UTF-16 decoding are plain code, tested on Linux.
- **Windows `drives()`:**
  - `SetErrorMode(SEM_FAILCRITICALERRORS)` at startup, as Microsoft recommends for every app, so no "no disk" dialog appears.
  - Each letter is skipped when it has no root, and a mapped network drive is skipped when `WNetGetConnectionW` says it's disconnected.
  - The rest are queried on their own threads, and any that doesn't answer within 2 s is left out.
  - This goes in its own std-plus-`windows` file, type-checked with the scratch-crate recipe.

**The sidebar tree (`Sidebar.tsx`, `src/treeRefresh.ts`):**
- Watch each open folder on show through `watchDir`/`unwatchDir`, and unwatch it when it's closed, a parent is closed, it's gone or the root changes.
- On `fs-changed` for one, list just that folder again, through a `RefreshGate` per folder.
- A listing drops the `children` and `expanded` entries of child folders no longer in it, with everything under them.
- A failed listing asks a new `path_kind` command (one stat): gone or now a file, drop it and list its parent; there but unreadable, show it empty.
- A folder shown again after being unwatched lists again.
- A click or Enter on a row asks `path_kind` first; a gone row is removed (its parent listed at once) and the pane isn't sent there.
- Refresh and the Show Hidden / Show Files toggles list parents first and skip folders found gone in the same pass.

## Measuring
- **Backend:** a temporary, uncommitted timing test against `~/linux` (93k tracked files) times:
  - a full scan, a subfolder listing, the root listing and git status;
  - the sort on a folder of 50,000 files;

  each before and after.
- **Frontend:** a vitest with fake timers fires an fs event every 75 ms for 3 s while each listing takes 100 ms, and counts listings and git status calls, before and after.

## Tests
- **Rust:**
  - the dirty cache: navigation reuses, a refresh counts an unstaged edit, staging or committing invalidates, and a root listing's scan serves the git status after it (a scan counter under `cfg(test)`);
  - the `list_dir` sort order is unchanged (folders first, case-insensitive, stable);
  - the timeout runner: a fast command returns its output, and a slow one is killed and gives `None`;
  - the WSL list decoding.
- **vitest:**
  - one listing at a time, plus the trailing one;
  - a navigation isn't held back, and neither is an explicit refresh;
  - a background tab doesn't poll or list, and lists once when activated;
  - the storm count;
  - the tree's pruning helpers (node), and the sidebar tree in happy-dom: watching and unwatching, a report re-lists one folder, a deleted folder's entries go, a gone open folder lists its parent, bursts are spaced out, a folder opened again re-lists, clicking or entering a gone row removes it without navigating, Refresh skips pruned folders, unmount unwatches all.
- **Rust:** `path_kind` for a folder, a file, nothing, a link and a dangling link.
- **Demo e2e:** Delete, Move to Trash, Rename and New Folder in the pane show in the tree; a stale row goes when clicked.

## Status
- [x] Plan (`3e39cc3`)
- [x] Before numbers
- [x] Backend: git_status cache, no status map, list_dir sort (`84dbcca`)
- [x] Frontend: one listing at a time, trailing refresh, background tabs (`f858890`)
- [x] Startup: WSL lister, drawer profiles on first open, sidebar in parallel, Windows drives (`0d10282`)
- [x] After numbers
- [x] Windows code type-checked with a scratch crate
- [x] Decision record: `docs/decisions/2026-11-13-refresh-cost-design.md` (`b9c6093`)
- [x] Merged main (pane-perf) into the branch (`b1916f0`)
- [x] The sidebar tree follows the disk; `path_kind`; explicit refreshes list at once
- [x] Checks
- [x] Handoff

## Results
**Backend.** Debug build, `~/linux` (93,016 tracked files), median of 5 warm runs. The release build is faster in absolute terms; the number of scans is what changed.

| | before | after |
|---|---|---|
| full status scan | 500 ms | 500 ms |
| refresh at the repo root (listing + git status) | 1000 ms (two scans; they ran in parallel) | 499 ms (one scan) |
| navigate into `drivers/gpu/drm` | 680 ms (subtree + full scan) | 180 ms (count reused) |
| navigate to the root | 1000 ms | 500 ms |
| refresh in `drivers/gpu/drm` | 680 ms | 680 ms (a refresh still counts) |
| list a folder of 50,000 files (no repo) | 528 ms | 177 ms |
| the sort alone, 50,000 names | 361 ms | 69 ms |

**Frontend.** The same headless run of the demo against the old and new build, counting `invoke` calls:

| | before | after |
|---|---|---|
| 40 watcher reports 75 ms apart: listings / git status calls | 40 / 40 | 7 / 7 |
| a background tab, 5 reports | 5 listings | 0, then 1 when shown |
| `list_shell_profiles` at startup | 1 | 0 (1 when the drawer opens) |
| terminals opened by the first New Terminal Tab on a closed drawer | 2 | 1 |
| git line after navigating into the repo | `⎇ main ↑2 ●7` | `⎇ main ↑2 ●7` |

The unit test of the gate (40 reports, 100 ms listings) gives listings at 0, 600, 1200, 1800, 2400 and 3000 ms. The last one comes after the last report.

**The sidebar tree in the demo** (headless, each step on the built site; the demo reports a change at once, the real watcher after its 300 ms debounce). The "before" column is from the old code, which lists a tree folder only when first opened or on the menu's Refresh, and from the user's report; the demo run was only done after. The new Sidebar tests fail 10 of 12 against the old `Sidebar.tsx`; the two that pass check a folder that's there opens, and that reports for unwatched folders are ignored.

| step | before | after |
|---|---|---|
| New Folder in the pane | not in the tree until its menu's Refresh | in the tree after 17 ms |
| Rename | old name stays | old row gone, new one shown after 21 ms |
| Move to Trash of a folder open in the tree, with a subfolder | rows stay | both gone after 11 ms |
| Delete Permanently | row stays | gone after 7 ms |
| a folder deleted while its parent was closed | still there when the parent opens | gone when it opens |
| click a row whose folder went with no report | "can't read this folder" in the pane | row gone, pane stays where it was |

The first run found the pane itself showing the old name after a Rename while the tree had the new one: the refresh after the app's own change waited behind the gate's 500 ms gap. Explicit refreshes now start at once.

**Windows (not run):**
- `drive_letters.rs`, and `wsl.rs` with its Tauri attribute stripped, pass `cargo clippy --target x86_64-pc-windows-msvc -D warnings` in a scratch crate.
- `system.rs`'s nine-line Windows mapping and the `lib.rs` startup call weren't type-checked, because the scratch crate leaves out sysinfo and Tauri.
- Nothing ran on Windows: the error mode, the disconnected-drive check, the 2 s drive deadline and the WSL timeout.

## For review
- **The dirty count on navigation** can be up to one poll (30 s) old when files changed outside the folders the app watches. A refresh (F5, a report, the poll) always counts again.
- **Git status now follows the listing** instead of running beside it. The rows are as quick as before, and the git line comes after them.
- **Background tabs** ignore reports and polls until shown, then list once. Explicit refreshes still run. Each restored tab still lists once at startup.
- **The trailing gap is measured from the end of the last listing**, not its start, so a slow folder gets a rest between listings.
- **WSL distros** are kept for 5 minutes, so one installed while the app runs takes up to that long to appear. A hung `wsl.exe` costs one 5 s timeout per 5 minutes.
- **A Windows drive that takes longer than 2 s to answer** is left out of the sidebar for that load.
- **A tree click waits for one stat** (`path_kind`) before the pane navigates.
- **A clicked tree row whose folder is gone just goes away**, with no toast; the pane isn't sent there, so it keeps what it shows.
- **The tree watches every open folder on show**, one OS watch each (shared with tabs on the same folder). A deep tree with many open folders holds that many watches.
