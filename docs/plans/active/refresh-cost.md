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
- `git_status(path, rescan)`:
  - With `rescan: false` (a navigation), a cached count whose HEAD and index still match is reused.
  - With `rescan: true` (an fs event, the poll, a refresh), the repo is scanned again. The exception is a scan that started less than a second ago with the same HEAD and index, which is reused.
  - A key of HEAD and index alone would miss edits that aren't staged, so the worktree is never assumed unchanged when something says it changed.
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
  - `SetErrorMode(SEM_FAILCRITICALERRORS | SEM_NOOPENFILEERRORBOX)` at startup, as Microsoft recommends for every app, so no "no disk" dialog appears.
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
  - the dirty cache: navigation reuses, a rescan sees an unstaged edit, staging or committing invalidates, and a scan in the last second is shared (a scan counter under `cfg(test)`);
  - the `list_dir` sort order is unchanged (folders first, case-insensitive, stable);
  - the timeout runner: a fast command returns its output, and a slow one is killed and gives `None`;
  - the WSL list decoding.
- **vitest:**
  - one listing at a time, plus the trailing one;
  - a navigation isn't held back;
  - a background tab doesn't poll or list, and lists once when activated;
  - the storm count.

## Status
- [x] Plan
- [ ] Before numbers
- [ ] Backend: git_status cache, no status map, list_dir sort
- [ ] Startup: WSL lister, drawer profiles on first open, sidebar in parallel, Windows drives
- [ ] Frontend: one listing at a time, trailing refresh, background tabs
- [ ] After numbers
- [ ] Windows code type-checked with a scratch crate
- [ ] Checks
- [ ] Decision record
- [ ] Handoff
