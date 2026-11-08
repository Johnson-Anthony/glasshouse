# Uncalled backend commands: removed, including recently fixed ones

Date: 2026-11-08 · Task: dead-code · The lead approved the list.

## Context
Five registered commands had no frontend caller once dead-code removed the unused api.ts wrappers (`ping`, `gitAheadBehind`, `setAlwaysOnTop`, `wslToWin`). `git_dirty_count` never had a wrapper. Three of them had just been worked on by other tasks:
- backend-bugs gave `git_dirty_count` and `git_ahead_behind` `Ok(None)`-vs-`Err` results, and fixed `wsl_to_win` for bare `/mnt/c`;
- linux-parity made `set_always_on_top` report an error on Wayland, where GTK silently drops the request.

## Decision
Remove all five: `ping`, `wsl_to_win`, `set_always_on_top`, `git_dirty_count`, `git_ahead_behind`.
- **No caller means no user.** Every registered command is IPC surface that command-security now has to list and grant, so a command nobody calls is a cost with no benefit.
- **The git pair duplicates `git_status`,** which already returns `dirty`, `ahead` and `behind` for the toolbar. The shared logic stays: `upstream_ahead_behind` (used by `git_status`) and `git_status_code`. Their tests moved onto those, so the unborn / no upstream / ahead / behind / detached / upstream-gone cases are still covered. `discover_repo` had no other caller and went too.
- **`set_always_on_top` takes its Wayland helper (`gtk_uses_wayland`) and test with it,** and the `window` permission group in `permissions/app.toml`, which held only that command, is gone from the manifest and from `capabilities/default.json`.
- **`wsl_to_win` goes with its tests; `win_to_wsl`,** which "Copy as WSL Path" uses, keeps its own.

## Consequences
- 69 commands are registered, and `build.rs` checks them against `permissions/app.toml`.
- Showing a repo-read error or a Wayland always-on-top failure would now mean adding the command back. The removed code is in git history: `0297c68` (git pair), `a7ce809` (always-on-top), `95af85f` (wsl_to_win).
- The command-security decision record still lists seven permission groups; there are six now, without `window`.
