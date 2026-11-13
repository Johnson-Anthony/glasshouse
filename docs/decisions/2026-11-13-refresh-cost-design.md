# refresh-cost: git status scans, refresh storms, background tabs, startup and the sidebar tree

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
- A listing for a watcher report or the poll starts no sooner than 500 ms after the last one **ended**, not after it started. That way a slow folder gets a rest between listings instead of being listed back to back.
- Reports that come meanwhile become one trailing listing with the latest arguments, so the last change is always shown.
- A navigation or a Show Hidden change starts at once, even beside a listing that's still running, whose result is dropped as before. It forgets the queued refresh, and so does leaving a folder.
- **An explicit refresh starts at once too**: F5, and the refresh after the app's own change (`actions.refresh()`). It keeps the rows on screen meanwhile. At first these waited their turn like reports, and a rename then showed in the pane up to 500 ms late when a listing had just ended; the sidebar tree's check in the demo found it.

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

**The terminal drawer** no longer lists profiles at startup. This task first made the drawer list them on first open, which also stopped the first New Terminal Tab on a closed drawer opening two terminals. pane-perf, merged first, mounts the whole drawer on first open, which does both, so the merge kept pane-perf's version.

**Windows drive letters (`commands/drive_letters.rs`):**
- Startup calls `SetErrorMode(SEM_FAILCRITICALERRORS)`, as Microsoft advises every app to, keeping any mode already set. An empty removable or CD drive then fails quietly instead of showing "There is no disk in the drive".
- A letter with no root isn't asked. Neither is a mapped drive for which `WNetGetConnectionW` says the connection is unavailable, or that there's no network.
- Every other letter is asked on its own thread. One that doesn't answer within 2 s is left out, and its thread ends when the system call gives up.
- Only type-checked here (clippy for `x86_64-pc-windows-msvc` in a scratch crate). It hasn't run on Windows.

## The sidebar tree follows the disk
The user deleted `~/kestrel-test`. The tree still listed it, and clicking it showed "can't read this folder". The tree listed a folder once, when first opened, and again only on its menu's Refresh.

**Chosen:**
- **Watching.** Each open folder on show (an open folder whose parents are all open) is watched through the same ref-counted `watch_dir`/`unwatch_dir` as the tabs. It's unwatched when it's closed, a parent is closed, it's gone, the root changes or the sidebar goes.
- **Reports.** A report for one of them lists just that folder again, through its own `RefreshGate`, so a burst is spaced out as in the pane.
- **Pruning.** A listing drops what the tree kept (rows and open state) for each child folder no longer in it, with everything under it (`src/treeRefresh.ts`). A later folder of that name starts closed and is listed afresh.
- **A failed listing** is checked with a new `path_kind` command (one stat). If the folder is gone, or is now a file, it's dropped and its parent listed again. If it's there but unreadable, it shows empty, as before.
- **Shown again.** A folder shown again after a while unwatched (opened again, or a parent was) shows its kept rows at once and is listed again.
- **Clicks.** A click or Enter on a tree row asks `path_kind` first. When the file or folder is gone, its row goes (its parent is listed at once) and the pane isn't sent there. The pane keeps what it shows, including any error it already shows for that folder.
- **Refresh and the Show Hidden / Show Files toggles** list every kept folder, parents first, and skip any that an earlier listing in the same pass found gone.
- **The app's own changes** (Delete, Move to Trash, Rename, New Folder) reach the tree through the same watcher reports. In the demo each showed in the tree within about 20 ms. The demo reports at once; the real watcher adds its 300 ms debounce.

**Rejected:**
- **Listing the parent on every click** to check the row. At a repo's root that's a scan of the repo; a stat is enough.
- **`file_stat_extended` for the check.** On Windows it also looks up the owner, which is slow.
- **Watching every folder the tree has listed.** Closed ones don't need it, since they're listed again when shown.
- **A toast when a clicked row is gone.** The row going away answers the click, and when the pane already shows that folder's error, a toast would be a second one.

**The cost:**
- A tree click waits for one stat before the pane navigates.
- Each open folder on show holds one OS watch, shared with any tab on the same folder.
