# refresh-cost: git status scans, refresh storms, background tabs and startup

Date: 2026-11-13. Task: `refresh-cost` (section 14 of `docs/plans/active/survey-2.md`).

## The dirty count
`git_status` scanned the whole repo on every call, beside `list_dir`'s own scan. On the 93,000-file kernel tree a scan takes about 500 ms (debug build).

**Chosen: keep each repo's last count with the state it was counted at, and let the caller say how old a count may be.**
- **The state** is the commit HEAD points to and the index file's size and modification time. Committing, checking out, resetting and staging change one of them.
- **The age limit.** An edit that isn't staged changes neither, so the state alone can't tell a count is stale. `git_status(path, max_age_ms)` reuses a count only when the state matches and the scan started at most that long ago:
  - a navigation passes the poll interval (30 s), the staleness the poll already allowed;
  - a refresh (watcher report, poll, F5) passes the time since it began. Any scan that started after that saw the change that prompted it;
  - none (the default) always scans.
- **A listing at a repo's root** scans the whole repo anyway. It stores its count, and `fetchAll` asks for git status after the listing, so one scan serves both.
- **The cache** holds 16 repos; the one counted longest ago goes first.

**Rejected:**
- **HEAD and index as the whole key**, as the backlog put it. Saving a file in an editor would then leave the count wrong until the next commit or stage.
- **Counting from the watcher's events.** The app watches only the folders it shows, not the repo, so edits elsewhere in the repo would be missed just the same.
- **One command for the listing and the git line.** It would change `readDir`'s result, which `relist` (pane-perf's area) and several other callers use.

**The cost:**
- Git status now waits for the listing instead of running beside it. The rows are as quick as before, and the git line comes after them.
- In a subfolder, a refresh still scans the whole repo for the count (180 ms + 500 ms on the kernel tree). Only a navigation saves it.

## Refresh storms
**Chosen: `RefreshGate` (`src/refreshGate.ts`), one per tab.**
- One listing at a time.
- A quiet listing starts no sooner than 500 ms after the last one **ended**, not after it started. That way a slow folder gets a rest between listings instead of being listed back to back.
- Reports that come meanwhile become one trailing listing with the latest arguments, so the last change is always shown.
- A navigation or a Show Hidden change starts at once, even beside a listing that's still running, whose result is dropped as before. It forgets the queued refresh, and so does leaving a folder.

In the demo, 40 watcher reports 75 ms apart cost 7 listings and 7 git status calls instead of 40 and 40.

## Background tabs
- A tab that isn't shown doesn't re-list on watcher reports or the poll. It notes that it missed one and re-lists once, quietly, when it's shown again.
- Explicit refreshes (`actions.refresh()`) still run.
- Nothing reads a background tab's rows: App reads only its path, for the tab title.
- **Not changed:** each restored tab still lists its folder once at startup.

## `list_dir`'s sort
- The sidebar tree and the folder picker show `list_dir`'s order as it is, so the sort stays.
- `sort_by_cached_key` builds one lowercase name per entry. It's stable, so the order is unchanged.
- 50,000 files: the sort went from 361 ms to 69 ms, and the listing from 528 ms to 177 ms (debug build).

## Startup
**The sidebar** starts home, drives and WSL together. The home listing follows home only.

**WSL:**
- `wsl.exe --list --quiet` runs under a 5 s timeout. A cold start of the WSL service takes a few seconds.
- The result is kept for 5 minutes and shared by the sidebar, the terminal profiles and the terminal menus, which each ran it before. A caller that comes while it runs waits for that run.
- A failed or timed-out run is kept too, so a hung WSL costs one timeout, not one per menu.
- A distro installed while the app runs shows up within 5 minutes.

**The terminal drawer** lists profiles the first time it opens.
- Before, the closed drawer listed them at startup.
- That change also fixes the first New Terminal Tab on a closed drawer opening two terminals. The new-tab event and the drawer's open effect each added one.

**Windows drive letters (`commands/drive_letters.rs`):**
- Startup calls `SetErrorMode(SEM_FAILCRITICALERRORS)`, as Microsoft advises every app to, keeping any mode already set. An empty removable or CD drive then fails quietly instead of showing "There is no disk in the drive".
- A letter with no root isn't asked. Neither is a mapped drive for which `WNetGetConnectionW` says the connection is unavailable, or that there's no network.
- Every other letter is asked on its own thread. One that doesn't answer within 2 s is left out, and its thread ends when the system call gives up.
- Only type-checked here (clippy for `x86_64-pc-windows-msvc` in a scratch crate). It hasn't run on Windows.
