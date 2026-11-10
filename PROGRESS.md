# Progress

## Done
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
Nothing.

## Next
1. **User decisions:**
   - tag a v0.2.0 release, now that CI is green;
   - the open questions in `docs/SPEC.md`: remote browsing, macOS, the command-line path, and `origin/feature` (`ddb5466`; see below).
2. **Manual checks in the real app:**
   - undo and redo: rename, then Ctrl+Z, then Ctrl+Y;
   - the font picker's three fonts and the Nerd Font icons render (now woff2);
   - on Windows: open a URL with `&` in it, Open in Terminal on a folder named `a&b;c` (with and without Windows Terminal), and Verify Signature on `Tom’s.exe`.
3. **Possible follow-ups, not started:**
   - progress and cancel for cross-volume move, archives and compress;
   - progress inside one big file on Windows (CopyFileExW with a progress routine);
   - Esc to deselect in Miller columns;
   - Bulk Rename numbering without a `{n}` token (design question).

## Broken / known issues
- Esc doesn't clear the selection in Miller columns (its key handler has no Escape case).
- Renames can still race where `renameat2(RENAME_NOREPLACE)` isn't available (non-Linux unix, NFS, older FUSE), which falls back to check-then-rename.
- On Windows, a file whose on-disk case differs from git's index loses its git label. Copy progress there is per file, not within a file.
- Saved ssh remotes are limited to ASCII host names. A timed-out script's process tree is hard-killed with no grace period, and processes that `setsid` out of its group aren't reached.
- macOS is untested; pty-drain's pty reopen in particular.
- `origin/feature` has one unmerged commit from April, `ddb5466` (14 files, +2470/-492; it won't merge cleanly). It holds a Windows terminal-launch probe (`terminal_probe.rs`), a menubar outside-click fix, and polish for the terminal drawer, dialogs, sidebar keyboard and drag-and-drop, remote manager, private tabs and About. Cherry-pick parts or drop it.
