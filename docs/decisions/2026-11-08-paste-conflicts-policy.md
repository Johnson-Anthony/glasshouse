# Paste conflicts: what happens when the destination name is taken

Date: 2026-11-08 · Task: paste-conflicts · Status: proposed (for review)

## Context
Paste, Paste Special, Duplicate, Move to… and drag-and-drop all sent `dir/basename(src)` to `copy_entry`/`move_entry` without checking it. Copy-then-paste in the same folder emptied the file, and an existing item with the same name was silently replaced (folders were merged).

## Decision
1. **Same place.** A copy into the folder the item is already in gets a free name without asking: "name (copy).ext", then "name (copy 2).ext". This is what Nautilus, Explorer and Finder do, and it is what Duplicate means. A move into its own folder is a no-op and is reported as "already here".
2. **Into itself.** Copying or moving a folder into itself or one of its subfolders is skipped and reported. The frontend doesn't rely on the backend refusing it.
3. **Real conflict** (a different item with that name exists): ask once per operation, listing the names: **keep both** (default, Enter), **replace**, **skip**, or cancel (Esc). The answer applies to every conflict in that operation. Per-item asking with "apply to all" was left out to keep the dialog simple; most pastes have zero or one conflict.
4. **Replace** moves the existing item to the Trash / Recycle Bin first, then copies or moves. It never overwrites in place and never merges folders.
   - So nothing replaced is lost: the old item can be restored from the trash.
   - Undo of that paste removes (or moves back) the pasted item but does not restore the old one from the trash; the result toast says the old items are in the trash.
   - If trashing fails (no trash on that filesystem, permissions), that item fails. There is no fallback to permanent deletion.
   - If the source is inside the item it would replace (moving `x/x` up into the folder holding `x`), the item gets a free name instead, because trashing would take the source with it.
5. **Names claimed in the same batch** (two sources with the same name, from different folders) always get a free name. A paste never replaces something it just created.
6. Names compare case-insensitively on Windows and case-sensitively elsewhere.
7. If the destination can't be listed, the operation fails rather than guessing.

## Where it applies
The same rules apply everywhere something is copied or moved into a folder:
- Paste and Paste Special. Paste Special keeps its per-row progress and notes "as <new name>" or "(old one trashed)" on a row.
- Duplicate. Every item is "same place", so it never asks.
- Move to… (selection and sidebar/breadcrumb target).
- Drag-and-drop (`performDrop`). A copy-drop (Ctrl) into the item's own folder now makes a "(copy)" instead of doing nothing, like Explorer; a move-drop there is still a no-op.
- "Paste as Copy (verify SHA256)" and Screenshot Auto-sort (one question per month folder).

## Naming rules
- Files split at the last dot, except compound `.tar.*` extensions: "a.tar.gz" → "a (copy).tar.gz".
- Folders and dotfiles have no extension: "v1.2" → "v1.2 (copy)", ".bashrc" → ".bashrc (copy)".
- An existing copy suffix continues: "a (copy).txt" → "a (copy 2).txt", "a (copy 2).txt" → "a (copy 3).txt".

## Alternatives considered
- **Always auto-rename, never ask.** Safe and simple, but there's then no way to replace a file by pasting, which is a common need.
- **Replace by overwriting** (what `fs::copy` / rename do). Not recoverable, merges folders, and breaks undo.
- **Explorer-style "<name> - Copy"**. The backlog asked for "(copy)", which matches Nautilus.
