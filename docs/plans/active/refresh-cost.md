# refresh-cost

Branch: `claude/cool-gauss-d234ca` (worktree `cool-gauss-d234ca`), started 2026-11-13 from `main` (`f74e07d`).
Backlog entry: section 14 of `docs/plans/active/survey-2.md`.
Overlap: pane-perf (task 13) changes `useTabState`'s `relist` equality and `setEntries`/`gitInfo` updates. This task changes only `fetchAll` and the polling and timer code there.

## Problems
1. **Two git status scans per refresh.** `list_dir` scans the listed folder's subtree (the whole repo at its root), and `git_status` scans the whole repo again. `git_status` also builds and sends a `status` map nobody reads. This runs on every navigation, fs event and 30 s poll, in background tabs too.
2. **Refresh storms.** While a paste lands, the debouncer reports the folder about every 75 ms, and `fetchAll` starts a new listing each time, even while one is running.
3. **`list_dir`'s sort** lowercases both names on every comparison. The sidebar tree and the folder picker show `list_dir`'s order as-is, so the sort stays.
4. **Startup.**
   - The sidebar awaits home, then drives, then WSL, then the home listing, one after another.
   - `wsl.exe --list` has no timeout and runs twice at startup: once for the sidebar, once for the terminal drawer's profiles, which load even while the drawer is closed. Each terminal menu that lists profiles runs it again.
   - *(Windows)* `drives()` queries every letter with no error mode set, so an empty removable drive can show a "no disk" dialog, and a disconnected or unreachable network drive can hang the list.

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
- The terminal drawer loads its profiles the first time it opens.
- `commands/wsl.rs` holds one WSL distro lister for the sidebar and the profiles:
  - it runs `wsl.exe --list --quiet` under a 5 s timeout;
  - its result is cached for 5 minutes, and concurrent callers wait for the one run.

  The timeout runner and the UTF-16 decoding are plain code, tested on Linux.
- **Windows `drives()`:**
  - `SetErrorMode(SEM_FAILCRITICALERRORS)` at startup, as Microsoft recommends for every app, so no "no disk" dialog appears.
  - Each letter is skipped when it has no root, and a mapped network drive is skipped when `WNetGetConnectionW` says it's disconnected.
  - The rest are queried on their own threads, and any that doesn't answer within 2 s is left out.
  - This goes in its own std-plus-`windows` file, type-checked with the scratch-crate recipe.

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
  - a navigation isn't held back;
  - a background tab doesn't poll or list, and lists once when activated;
  - the storm count.

## Status
- [x] Plan (`3e39cc3`)
- [x] Before numbers
- [x] Backend: git_status cache, no status map, list_dir sort (`84dbcca`)
- [x] Frontend: one listing at a time, trailing refresh, background tabs (`f858890`)
- [x] Startup: WSL lister, drawer profiles on first open, sidebar in parallel, Windows drives (`0d10282`)
- [x] After numbers
- [x] Windows code type-checked with a scratch crate
- [x] Decision record: `docs/decisions/2026-11-13-refresh-cost-design.md` (`b9c6093`)
- [ ] Checks
- [ ] Handoff

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
