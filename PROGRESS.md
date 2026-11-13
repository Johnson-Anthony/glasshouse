# Progress

## Done
- 2026-11-12: **v0.2.0 released** (tag on `280686f`; https://github.com/Johnson-Anthony/glasshouse/releases/tag/v0.2.0, all six packages). The tag was moved twice before any release existed, because the workflow's first real runs found two bugs: setup-node v5 turned on pnpm caching in the prepare job (`389559b`), and on Windows `import "./Notices"` resolved to `notices.ts`, so tsc failed (`280686f` renames the screen to `NoticesScreen.tsx`; `src/fileNames.test.ts` now fails on names that differ only in case). The release workflow builds the Windows, Linux x64 and Linux arm64 packages into one draft and publishes it only if every build passes. Wave 1 of the second survey (data loss and security), security-deps and the Windows git fix are in it; the CHANGELOG's 0.2.0 section lists everything. Before tagging, the CI site job's 3-hour hang was fixed (`8ded751`: the capture script waited only 10 s for Chromium, then threw while its server kept node alive).
- 2026-11-10: **Cleanup pass.**
  - Docs: ARCHITECTURE.md rewritten from the code, and CLAUDE.md trimmed.
  - Code, with no behavior change: about 13 backend and 21 frontend dedupes and dead-code removals. New shared helpers are `crate::lock`, `clamp_limit`, `src/errors.ts`, `useEscapeClose` and `handlers/helpers.ts`.
  - Three bugs the survey turned up, each fixed in its own commit:
    - on Linux a crafted `wsl` terminal profile could run any program (`2fa2f49`);
    - creating an archive silently replaced an existing file (`fab59d9`);
    - a folder named like `foo.d` showed as `foo`.
  - Checks: 274 vitest and 137 cargo tests.
- 2026-11-10: **Survey-fix pass finished and pushed.** `main` matches GitHub, all four CI jobs pass (frontend, Linux and Windows backend, notices), and Pages serves the new site. The task-by-task record is `docs/plans/completed/survey-fixes.md`, with a plan per task in `docs/plans/completed/` and the choices in `docs/decisions/`. Totals: 274 vitest and 135 cargo tests.
- 2026-11-10: Windows CI went green after three fixes: imports lost or left unused by the `commands/` split (`e8f04ae`), unix-only test helpers (`d077734`), and op-progress's slice-count test, which is now unix-only because Windows copies report per file (`2db13e6`).
- 2026-11-10: First full push (`2a5381c`). Before it, commit `ee1dd9b`'s message was reworded and the docs' cited commit ids were updated (`docs/decisions/2026-11-10-reword-before-push.md`). The pre-reword history is local branch `pre-reword-backup`; never push it.
- 2026-11-10: Merged the follow-ups:
  - `op-progress`: a progress tray with Cancel for hash, copy and find;
  - `shortcut-hints`: every advertised shortcut works, and a dismissed context menu no longer leaves its target behind;
  - `split-big-files`: `components.tsx` 6132 → 1127 lines, `commands.rs` → `commands/` modules, App.tsx 2301 → 1366 with `keymap.ts` and `COMMAND_CHAIN`;
  - `dependency-notices`, `pty-drain`, `parser-fixes`, `copy-move-no-clobber`, `bulk-rename-digits`, `miller-names` and `link-display`.
- 2026-11-08: Merged the survey's correctness and safety fixes:
  - `symlink-safety`, `paste-conflicts`, `create-rename-conflicts`, `no-clobber-fs`, `copy-undo-guard`, `undo-redo`, `tab-state`, `backend-bugs`, `platform-paths`, `ui-fixes`, `linux-parity`;
  - backend work: `async-commands`, `command-security` (app ACL in `permissions/app.toml`, argument checks, no user strings through cmd or PowerShell), `pty-writer`, `script-kill-tree`;
  - cleanup: `dead-code`, `unsent-labels`, `test-coverage`;
  - presentation: `presentation`, `pages-site`, `local-fonts`, `font-licenses`, `notices-screen`.
- 2026-11-08: Behavior changes worth knowing:
  - the settings key is `glasshouse.tweaks` (saved tweaks reset once);
  - Show Ignored, Show Checksums and Browse archive in place are gone (they did nothing);
  - Miller Columns is back on Ctrl+7;
  - moving a folder onto an existing empty folder fails;
  - an exception in a menu command shows the error dialog;
  - release builds have no devtools.
- 2026-11-08: Set up as a long-running project with a lead session running task sessions in worktrees (`lead` skill, `git config claude.lead`). The Linux arm64 build env is in `~/.claude/environment.md`, and the release build is linked into the fuzzel launcher.

## In progress
- 2026-11-11: **Second survey.** Four read-only agents (frontend bugs, backend bugs and security, spec vs app, tests/release/perf) found about 60 issues. The deduplicated backlog is 28 tasks in six waves: `docs/plans/active/survey-2.md`. Wave 1 (data loss and security) is running. The app restarted at 01:36 on 11-11 and stopped every worker mid-turn; all four were resumed on 11-12 (selection-integrity and release-prep had uncommitted work in their worktrees). On 11-12 at 08:25 the machine ran out of RAM (a headless Chromium at ~5 GB on top of five workers and two cargo builds) and the OOM kill took the Claude app down; work since then runs at most three workers with one or two Rust builds (cargo and site captures under a `systemd-run --user --scope -p MemoryMax=…` cap); watcher-fixes, pane-perf and find-replace-safety wait for a slot, and the Windows git odd-name fix is merged (see below).
  - CI is green on all seven jobs at cf5aa11 (Windows built tauri 2.12 and zip 9 for the first time). The launcher binary was rebuilt at 09:17 with everything below. Dependabot PRs still open: #1, #2 (CI actions), #4 (TypeScript 7), #5 (plugin-react 5), #7 (windows 0.62), #9 (pdfjs-dist), #10 (cargo group); they belong to task 28.
  - 2026-11-13: waves 3 and 4 started, two workers at a time: `trash-restore` (task 12) and `pane-perf` (task 13); `refresh-cost` (14) follows. Post-0.2.0 changes go under `## [Unreleased]` in CHANGELOG.md.
  - Merged: `trash-restore`: Move to Trash has undo (restore matched by original path and deletion time) and redo; Go → Trash opens a Trash dialog (Restore, Delete Permanently, Empty Trash) on Linux and Windows, with a link to the trash folder on Linux; `trash_path` refuses a Windows drive with no Recycle Bin for every caller, so Move to Trash asks before deleting permanently there, git Discard leaves such an item alone and Paste's Replace fails for it. Its Windows code (`commands/recycle_bin.rs`, `commands/trash.rs`) was only type-checked here; CI is its first Windows build.
  - **Wave 1 is complete** (all eight tasks plus security-deps and the Windows git fix). The CHANGELOG lists every one; tagging v0.2.0 is the user's call (Next, item 1).
  - Merged so far: `find-replace-safety` (fresh session): Find & Replace in Files works on bytes in the backend (`commands/replace.rs`): only valid UTF-8 files change, byte for byte around the matches, each through a temp file and a rename (ReplaceFileW on Windows, keeping attributes, ACLs and Mark-of-the-Web), never through a link or outside the searched folder; non-UTF-8, binary, over-16-MiB, read-only and hard-linked files are listed as skipped. Case is matched exactly in counts and replace. A per-file confirm, a report covering skips, cancel and the 500-file cap, and one-step undo (`contentsUndo`: checks every file before writing any, rolls back a failed write; over 8 MiB of text it can't be undone and the confirm says so). `security-deps` (fresh session): zip 2.4.2 → 9.5.1, tauri 2.10.3 → 2.12.5 (rust-version 1.90; plugins and `@tauri-apps/*` on their latest; windows 0.62 through tauri, so no Windows 7), zstd 0.14, quick-xml 0.42, crossbeam-epoch, libz-sys and serde_with; OSV finds none of the listed advisories left. archive.rs follows zip 9's API and now refuses rooted entry names itself (zip 9 quietly made them relative). `watcher-fixes`: OS watches are reference-counted per folder (a failed watch counts too, since the frontend always unwatches what it watched, and the next watch retries it), so leaving one of two tabs on a folder no longer stops the other updating; the debouncer uses `NoCache`, so Windows and macOS no longer walk and open every file in a folder when watching it (rename stitching goes with it; the folders reported are the same). `win-git-odd-names` (lead subagent; CI green on all seven jobs, Windows included, at 620c5a7): git2 0.19 rewrites every `\` in a pathspec to `/` on Windows, so the escaped odd names matched nothing. Discard, Unstage and Stage now match exact paths: an exact-path HEAD→index reset, a checkout with `GIT_CHECKOUT_DISABLE_PATHSPEC_MATCH` set through `libgit2-sys` (new direct dependency, already in the lock through git2; git2 0.21 exposes the flag, so task 28's git2 bump can drop the raw call), and `add_all` on the nearest plain parent with a filter. `undo-coverage` (e225489): Ctrl+Z now covers Bulk Rename, From Template, the Paste-as-link family, Paste Special, every Compress, Extract, Export Layout, Auto-sort, Batch Permissions and the Inspector's chmod; `markIrreversible` (Delete Permanently, Shred, git commands, Change Owner, scripts) clears both stacks and the next Ctrl+Z says so. Behavior changes: Auto-sort's Cancel stops the whole sort, Export Layout asks before replacing `.glasshouserc`, any git action or script clears the undo history. `fs-robustness` (2bd2208): a failed folder copy removes its half-made folder; a cross-volume folder move whose delete fails keeps the complete copy (deliberately, against the survey's "remove on any error", since part of the source may be gone: review); Delete Permanently deletes non-empty folders and both deletes carry on past failures; FIFOs, sockets and devices are refused before any read; unix copies keep times and folder modes; config writes fsync; every extraction drops links that leave the staging folder. `ci-hygiene` (7bb4385): CI runs actionlint (with shellcheck), a site job that fails when the committed demo is stale and runs the snapshot and reachability checks, and a non-blocking `cargo audit`; Dependabot opens weekly grouped updates (the tauri npm and cargo PRs must be merged together); demo rebuilds are reproducible (the build date is the sources' last commit). `inspector-perms` (41bde85): the Inspector grid shows the real mode (with setuid/setgid/sticky) and chmods only through edit → apply → confirm, reading the mode back; a late hash result is dropped if the Inspector moved on; Windows shows read-only. `selection-integrity` (ee32e5b): selection, focus and drag sources follow files by path across a re-list; navigating clears the old rows at once; the search filter is per tab, clears on navigation, and selection commands see only visible rows. `release-prep` (c6dab0c): version 0.2.0; release.yml builds one draft (Windows, Linux x64 and arm64 on ubuntu-22.04 for glibc 2.35) and publishes it only when every build passed; the tag must match the manifests and a dated CHANGELOG section; CHANGELOG.md and README install steps. `git-safety` (3756be3): Discard never deletes (restores from HEAD, trashes untracked items, leaves staged-new and ignored paths alone and says why); every branch switch sends `checkout <name> --`; folders stage and unstage; blame and diff refuse files over 16 MiB; selected symlinks aren't followed and names like `a[1].txt` no longer match as patterns. `archive-safety` (4c535a0): extraction goes through a staging folder and Paste's conflict dialog, so it never overwrites; the zip extractor is our own loop (links checked, setuid dropped); zip64 for entries of 4 GiB or more; failed creates remove their output; skipped entries are reported; Windows keeps Mark-of-the-Web on extracted files (first built by CI). A selected symlink is now left out of a zip, not followed. `terminal-cd` (3d23a8b): the follow-folder `cd` is quoted per shell (tested with hostile names in sh, dash and bash) and only typed at an idle prompt with the drawer open, with a Follow Folder setting; Copy as Command on Windows is now PowerShell syntax. `focus-and-targets` (8a3dfc8). Enter in dialogs no longer opens the selection, file keys only act when the pane has focus, and sidebar file rows get their own menu. Behavior changes: Tab-to-Cancel then Enter now cancels, Ctrl+Shift+F no longer closes Find in Files (Esc does), and dialogs return focus on close.

## Next
1. **User decisions:**
   - whether to start wave 2 of `docs/plans/active/survey-2.md` (and resume pane-perf, paused with only its plan);
   - turn on Dependabot alerts and security updates in the repo's GitHub settings;
   - the open questions in `docs/SPEC.md`: remote browsing, macOS, the command-line path, and `origin/feature` (`ddb5466`; see below).
2. **Manual checks in the real app:**
   - undo and redo: rename, then Ctrl+Z, then Ctrl+Y;
   - the font picker's three fonts and the Nerd Font icons render (now woff2);
   - a folder named `foo.d` shows its whole name in the pane, Inspector and Quick Look;
   - on Windows: open a URL with `&` in it, Open in Terminal on a folder named `a&b;c` (with and without Windows Terminal), and Verify Signature on `Tom’s.exe`.
3. **Possible follow-ups, not started:**
   - progress and cancel for cross-volume move, archives and compress;
   - progress inside one big file on Windows (CopyFileExW with a progress routine);
   - Esc to deselect in Miller columns;
   - Bulk Rename numbering without a `{n}` token (design question).
   - Archive creation now refuses a taken name (`fab59d9`). The frontend could pick a free one (`name (2).zip`), as New Folder does, instead of showing the error.
4. **Left over from the 2026-11-10 cleanup** (risky or debatable, so not changed):
   - Windows-only Rust dedupe, which needs a Windows CI loop because none of it compiles here:
     - a `no_window()` helper for the 14 `CREATE_NO_WINDOW` sites, and one detached-spawn helper for launch.rs;
     - shared UTF-16 string and HRESULT helpers (system.rs, file_info.rs, fs_ops.rs);
     - one "PowerShell with paths in env vars" runner (fs_ops.rs, file_info.rs);
     - the profile → program match in launch.rs's two Windows blocks (`profile_program` now exists);
     - the duplicated `wsl.exe -l -q` decoding.
   - Same action, different handling per menu, so unifying would change what users see:
     - Move to Trash, Rename, Open in VS Code and Open with default app each handle errors differently in `fileOps.ts`, `target.ts` and the Inspector chip;
     - "no selection" toasts in some handlers and only logs in others;
     - Stage/Unstage/Discard filter and confirm differently in `git.ts` and `fileOps.ts`;
     - some alerts use `String(e)` and show an "Error: " prefix.
   - Paste Special re-implements `runTransfer`'s loop and pushes no undo entry.
   - Five byte formatters and two date styles give slightly different text across the pane, sidebar, tray, Miller and Properties.
   - `listDir` swallows errors (`safe()`), so the sidebar and Folder Picker never show why a folder didn't load.
   - Tab drag-reorder is wired in state (`moveTab`) but has no UI: build it or delete it.
   - Clipboard writes are done five ways; `try { void writeText() }` doesn't catch the async rejection.
   - The Rust `compress` command is no longer called by the frontend (zip goes through `archive_create`). Drop it and its `app.toml` entry, or keep it.
   - `scripts/*.ps1` and `scripts/win-*.sh` (WSL → Windows build helpers) aren't referenced or documented anywhere: document them in CLAUDE.md or drop them.

## Broken / known issues
- The sidebar tree never refreshes on its own (user-reported 2026-11-13): a folder deleted on disk stays listed, and clicking it shows "can't read this folder". `Sidebar.tsx` loads each expanded folder once and doesn't listen to `fs-changed`. Being fixed in refresh-cost.
- On the GitHub runner, headless Chromium sometimes never opens its DevTools port. `site/capture/capture.mjs` starts it up to three times (20 s each; `9f63f1a`), and the site job has a 20-minute cap. The first attempt hung on 9f63f1a's own run, so it's common; if all three fail, re-run the job.
- Esc doesn't clear the selection in Miller columns (its key handler has no Escape case).
- Renames can still race where `renameat2(RENAME_NOREPLACE)` isn't available (non-Linux unix, NFS, older FUSE), which falls back to check-then-rename.
- On Windows, a file whose on-disk case differs from git's index loses its git label. Copy progress there is per file, not within a file.
- On Windows, New Symlink resolves a relative target against the app's working directory, not the link's folder, when it decides between a file and a directory link (`create_symlink` in `commands/fs_ops.rs`). Copying a symlink uses the link's own type and is fine.
- Saved ssh remotes are limited to ASCII host names. A timed-out script's process tree is hard-killed with no grace period, and processes that `setsid` out of its group aren't reached.
- Disabled Back/Forward buttons look enabled and still highlight on hover: there's no `:disabled` style.
- While the file pane has focus, every App re-render scrolls it back to the focused row, because `renderActivePane` builds a new `rows` array each time (App.tsx). Memoising it would fix that, but it changes the behavior, so the cleanup left it.
- macOS is untested; pty-drain's pty reopen in particular.
- `origin/feature` has one unmerged commit from April, `ddb5466` (14 files, +2470/-492; it won't merge cleanly). It holds a Windows terminal-launch probe (`terminal_probe.rs`), a menubar outside-click fix, and polish for the terminal drawer, dialogs, sidebar keyboard and drag-and-drop, remote manager, private tabs and About. Cherry-pick parts or drop it.
