# trash-restore

Branch: `claude/cool-gauss-d234ca` (worktree `cool-gauss-d234ca`), started 2026-11-13 from `main` (`18aaecd`).
Backlog entry: section 12 of `docs/plans/active/survey-2.md`.

## Problems
1. **Move to Trash has no undo.** It's the last file change with neither an undo entry nor `markIrreversible` (`handlers/fileOps.ts`, and the target menu in `handlers/target.ts`).
2. **Nothing can be restored.** On Windows, Go → Trash says "trash view coming in v2" (`handlers/nav.ts`). On Linux it browses `~/.local/share/Trash/files`, which shows the trashed files but not where they came from, and offers no way to put them back. Trashes on other drives (`$topdir/.Trash-$uid`) aren't shown at all.
3. **Network shares (Windows, unverified).** The trash crate (5.2.5, `src/windows.rs`) deletes with `IFileOperation` and `FOF_NO_UI | FOF_ALLOWUNDO | FOF_WANTNUKEWARNING`.
   - `FOF_NO_UI` includes `FOF_NOCONFIRMATION`, so the "this will be deleted permanently" question that `FOF_WANTNUKEWARNING` asks is most likely answered yes without being shown.
   - On a drive with no Recycle Bin (a network share, a USB stick), Move to Trash would then delete for good.
   - The same `trash::delete` backs Git → Discard's untracked items and Paste's "Replace".

## Approach
**Backend: `commands/trash.rs` (new).** The trash crate's `os_limited` list, restore and purge are on Windows and Linux.
- **`trash_path` (shared):**
  - It first refuses a path on a drive with no Recycle Bin (Windows).
  - It records the path the trash will store: the canonical parent plus the name, as the crate canonicalizes it.
  - It takes the clock in seconds before and after the delete, so the item can be found again by original path and a deletion-time window.
  - `move_to_trash` and git's discard call it.
- **`trash_list`:** every item, with id, name, original folder, deletion time, and size (bytes for a file, entry count for a folder).
- **`trash_restore(keys, all_or_nothing)`:** a key is an original path, a time window and an optional id. Each key must match exactly one item, otherwise:
  - none: "isn't in the trash any more";
  - several: "more than one trashed item matches".

  It also refuses when the original path is taken (`symlink_metadata`), and when two keys would go back to the same path. All-or-nothing (undo) restores nothing if anything is refused. The view restores what it can and lists the rest. After the crate's `restore_all`, the trash is listed again to see what actually went back. The freedesktop code `assert!`s that the trashed file exists, and the release profile aborts on panic, so each item's file is checked first (`file_missing`) instead of relying on `catch_unwind`.
- **`trash_purge(keys)`:** the same matching, then `purge_all`. An item whose file is missing has only its `.trashinfo` removed.
- **`trash_unsupported(paths)`:** the paths on a drive with no Recycle Bin, each with why. On Windows: `GetVolumePathNameW`, then `GetDriveTypeW`; only `DRIVE_FIXED` has one. On Linux the list is always empty, because the crate trashes into the drive's own `.Trash-$uid`, or copies, and never deletes for good.
- **The Windows helper** goes in its own file (`commands/recycle_bin.rs`, std plus `windows` only), so it can be type-checked here with a scratch crate.
- **Matching is pure code** over a small item type, so it's unit-tested on every platform. One Linux round-trip test uses the real trash, then restores and removes its file.

**Frontend.**
- **Undo builders (`src/undoActions.ts`):**
  - `trashUndo`: undo restores (all or nothing), redo trashes again. The redo's records replace the old ones, so the next undo finds the new items.
  - `restoreUndo`: the reverse, for a restore from the view.
  - Both check the paths are there (or free) before acting, and take an injectable `TrashFs` for tests.
- **`trashPaths` (`handlers/fileOps.ts`):** shared by Move to Trash in the file menu and the target menu.
  - It asks the backend which paths have no Recycle Bin. If any, a confirm says they'd be deleted for good and offers "delete permanently" or Cancel.
  - Then it deletes those (`markIrreversible`), trashes the rest, and pushes one `trashUndo` for what went to the trash.
- **Trash dialog (`src/dialogs/Trash.tsx`), opened by Go → Trash on both platforms:**
  - a table of name, original folder, deleted, and size, newest first, with a multi-select;
  - Restore, with a `restoreUndo`, a toast and a list of what was refused;
  - Delete Permanently and Empty Trash, each confirmed and irreversible;
  - on Linux, a link that browses the trash folder as before.

  A taken name refuses, saying what's there. The crate can only restore to the original path, so there's no "keep both".
- **Demo mock:** move_to_trash records an item, and list, restore, purge and unsupported work on it.

## Tests
- Rust:
  - matching picks the one item in the window; none or two refuses; an id narrows it;
  - a taken path or twin keys refuse; all-or-nothing restores nothing;
  - the Windows drive classification (pure part);
  - a Linux round trip through the real trash, run in a child process of the test binary with a private `XDG_DATA_HOME`, so the user's trash is never touched.
- vitest:
  - `trashUndo` and `restoreUndo` round trips against a fake `TrashFs`; refusals keep the records; redo's new records are the ones the next undo uses;
  - `trashPaths`' split and confirm text (pure helper);
  - the dialog's sort and labels (pure helpers).

## Status
- [x] Plan
- [x] Backend: trash.rs, recycle_bin.rs, permissions, git discard through trash_path (`1a95ada`)
- [x] Frontend: api, undo builders, trashPaths, Trash dialog, Go → Trash (`0c32bbc`, `f7fd33e`)
- [x] Demo mock (`0c32bbc`)
- [x] Windows helper type-checked with a scratch crate
- [x] Checks (`43ab10b` fixes the routing test's mock, which left vitest exiting 1)
- [x] Decision record: `docs/decisions/2026-11-13-trash-restore-design.md`
- [x] Handoff

## Results
- `pnpm build`, `pnpm test` (38 files, 498 passed, 3 skipped), `pnpm check:wiring` (0 issues), `pnpm notices --check` (up to date).
- `RUSTFLAGS="-D warnings" cargo clippy --all-targets` is clean; `cargo test` gives 204 passed and 5 ignored (the 3 real-trash children and Move to Trash's own XDG child, each run by its parent test, and an older archive test).
- Windows: `recycle_bin.rs` and `trash.rs` (Tauri attributes stripped) pass `cargo clippy --target x86_64-pc-windows-msvc -D warnings` in a scratch crate, with the trash crate's Windows code. Not built or run on Windows: the drive check, restore and purge there, and the network-share behavior are unverified until the windows-latest CI job and a real share.
- Headless run of the demo (`docs/demo`), 15 of 15 steps passed:
  - Delete trashes a file; Ctrl+Z restores it; Ctrl+Y trashes it again, and the next Ctrl+Z finds the new item;
  - Go → Trash lists it with its folder; a click selects it; Restore puts it back with "restored 1 item(s)"; Esc closes the dialog;
  - Ctrl+Z after that restore trashes it again, and Ctrl+Y restores it.

## For review
- **A dialog, not a virtual folder.** Go → Trash now opens it on Linux too; "open the trash folder" keeps the old browse.
- **A taken name refuses** (with what's in the way). There's no "keep both", because the crate restores only to the original path.
- **`trash_path` refuses a drive with no Recycle Bin for every caller.** So git's Discard leaves such an item alone, and Paste's Replace fails for it instead of deleting the replaced item for good.
- **Cancel in the no-Recycle-Bin question cancels the whole Move to Trash**, including the items that could have gone to the Recycle Bin.
- **Delete Permanently and Empty Trash** in the dialog call `markIrreversible`, so they clear the undo history.
