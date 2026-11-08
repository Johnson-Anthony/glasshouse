# Creating and renaming onto a name that's taken

Date: 2026-11-08 · Task: create-rename-conflicts · Status: proposed (for review)

## Context
New File / Note / Script used `write_text` (`fs::write`), which empties an existing file of that name. New Folder used `create_dir_all`, which succeeds on an existing folder. In both cases the undo entry then deleted the pre-existing item. Rename, Paste Text into Filename and Bulk Rename used `fs::rename`, which replaces an existing destination file. Bulk Rename also ran in list order, so a chain like `1→2, 2→3` overwrote `2` before it moved.

## Decision
1. **A name the user typed is refused, not changed.** If it's taken, the prompt shows `"x" already exists here` inline and won't submit. Replacing is exactly what we're preventing. Silently picking another name would surprise someone who typed an exact name. This matches Nautilus's rename and new-folder behaviour.
2. **Default names are made free up front.** The prompt for New Folder / New File / Note / Script / From Template… starts at "new-folder (2)", "untitled (2).txt" and so on when the plain default is taken. This uses Explorer-style "(2)" numbering, since "(copy)" is for copies.
3. **Names are single names.** `.`, `..` and names containing `/` (and also `\` on Windows) are refused. They would create nested folders or move the entry somewhere the name check didn't look.
4. **Checked twice.**
   - When the prompt opens, the folder is listed so the inline check and the default name are right.
   - Right before writing, it is listed again, because the prompt may have been open a while.
   - A small race remains between that last check and the write. Closing it needs no-clobber backend commands (`File::create_new`, `renameat2(RENAME_NOREPLACE)` / `MoveFileExW` without `REPLACE_EXISTING`). That's out of scope for a frontend task and is suggested as a follow-up.
5. **Same-name case changes are allowed on Windows.** Renaming `a.txt` to `A.txt` isn't a conflict with itself.
6. **Bulk Rename:**
   - The preview flags rows whose new name is empty, invalid, used twice in the batch, or held by something outside the batch. The rename button stays off until there are none.
   - Names freed by the batch itself are fine. The renames run in an order where each target is already free, and a cycle (`a↔b`) is broken by parking one item under `a~rename` first.
   - If a rename fails, the ones already done are put back, newest first. The dialog says whether that worked.
7. **Single rename uses the entry's own folder,** not the current folder, since search results can live elsewhere.
8. **Undo entries are unchanged.** Because a create or rename only goes ahead on a free name, the existing undo (delete the new item, or rename it back) never touches anything that existed before. Bulk Rename still pushes no undo entry; that belongs to undo-redo if wanted.

## Not changed
- Export Layout (.glasshouserc) still overwrites its own export file. That's what "export" means here.
- Python Module refuses an existing folder name rather than adding `__init__.py` to it.

## Alternatives considered
- **Ask "replace?" for a taken name.** That adds a destructive path to operations that never needed one. To replace, delete or trash the old item first.
- **Auto-rename typed names** ("x (2)"). The user asked for a specific name and wouldn't get it.
- **Two-phase bulk rename** (everything to temporary names, then to the final names). Simpler ordering, but twice the renames, and temporary names show up on any failure. Ordering with cycle-breaking only uses a temporary name when there's a real cycle.
