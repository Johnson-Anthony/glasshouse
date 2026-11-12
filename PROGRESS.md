# Progress

## Done
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
- 2026-11-11: **Second survey.** Four read-only agents (frontend bugs, backend bugs and security, spec vs app, tests/release/perf) found about 60 issues. The deduplicated backlog is 28 tasks in six waves: `docs/plans/active/survey-2.md`. Wave 1 (data loss and security) is running. The app restarted at 01:36 on 11-11 and stopped every worker mid-turn; all four were resumed on 11-12 (selection-integrity and release-prep had uncommitted work in their worktrees).
  - Merged so far: `git-safety` (3756be3): Discard never deletes (restores from HEAD, trashes untracked items, leaves staged-new and ignored paths alone and says why); every branch switch sends `checkout <name> --`; folders stage and unstage; blame and diff refuse files over 16 MiB; selected symlinks aren't followed and names like `a[1].txt` no longer match as patterns. `archive-safety` (4c535a0): extraction goes through a staging folder and Paste's conflict dialog, so it never overwrites; the zip extractor is our own loop (links checked, setuid dropped); zip64 for entries of 4 GiB or more; failed creates remove their output; skipped entries are reported; Windows keeps Mark-of-the-Web on extracted files (first built by CI). A selected symlink is now left out of a zip, not followed. `terminal-cd` (3d23a8b): the follow-folder `cd` is quoted per shell (tested with hostile names in sh, dash and bash) and only typed at an idle prompt with the drawer open, with a Follow Folder setting; Copy as Command on Windows is now PowerShell syntax. `focus-and-targets` (8a3dfc8). Enter in dialogs no longer opens the selection, file keys only act when the pane has focus, and sidebar file rows get their own menu. Behavior changes: Tab-to-Cancel then Enter now cancels, Ctrl+Shift+F no longer closes Find in Files (Esc does), and dialogs return focus on close.

## Next
1. **User decisions:**
   - tag a v0.2.0 release, now that CI is green;
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
- Esc doesn't clear the selection in Miller columns (its key handler has no Escape case).
- Renames can still race where `renameat2(RENAME_NOREPLACE)` isn't available (non-Linux unix, NFS, older FUSE), which falls back to check-then-rename.
- On Windows, a file whose on-disk case differs from git's index loses its git label. Copy progress there is per file, not within a file.
- On Windows, New Symlink resolves a relative target against the app's working directory, not the link's folder, when it decides between a file and a directory link (`create_symlink` in `commands/fs_ops.rs`). Copying a symlink uses the link's own type and is fine.
- Saved ssh remotes are limited to ASCII host names. A timed-out script's process tree is hard-killed with no grace period, and processes that `setsid` out of its group aren't reached.
- Disabled Back/Forward buttons look enabled and still highlight on hover: there's no `:disabled` style.
- While the file pane has focus, every App re-render scrolls it back to the focused row, because `renderActivePane` builds a new `rows` array each time (App.tsx). Memoising it would fix that, but it changes the behavior, so the cleanup left it.
- macOS is untested; pty-drain's pty reopen in particular.
- `origin/feature` has one unmerged commit from April, `ddb5466` (14 files, +2470/-492; it won't merge cleanly). It holds a Windows terminal-launch probe (`terminal_probe.rs`), a menubar outside-click fix, and polish for the terminal drawer, dialogs, sidebar keyboard and drag-and-drop, remote manager, private tabs and About. Cherry-pick parts or drop it.
