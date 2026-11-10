# create-rename-conflicts

Branch: `claude/cool-shamir-734852` (same session and branch as paste-conflicts). Backlog entry: `## create-rename-conflicts` in `survey-fixes.md`.

## Scope
Every site that creates or renames an entry by name without checking whether the name is taken:

| Where | Backend call | What goes wrong |
|---|---|---|
| `App.tsx` New File / Text File, Markdown Note, Script (.sh) | `write_text` = `fs::write` | empties an existing file; undo then deletes it |
| `App.tsx` New Folder / Folder | `make_dir` = `create_dir_all` | succeeds on an existing folder; undo then deletes it recursively |
| `handlers/misc.ts` From Template… (`promptAndCreate`) | `write_text` | empties an existing file |
| `handlers/misc.ts` Python Module | `make_dir` + `write_text` | empties an existing `__init__.py` |
| `App.tsx` Rename (selection and context target), `misc.ts` Paste Text into Filename | `rename_entry` = `fs::rename` | replaces an existing file |
| `components.tsx` BulkRenameDialog | `rename_entry` per item, in list order | replaces existing files outside the batch, **and** a chain inside the batch (`1→2, 2→3`) overwrites `2` before it moves |

Out of scope:
- The `pushUndo` lines (undo-redo is rewriting them).
- Backend no-clobber primitives (`create_new`, `RENAME_NOREPLACE`). The frontend check leaves a small race; noted as a follow-up for the lead.
- Export Layout (.glasshouserc) overwriting its own export file, which is intended.

## Approach
- New pure module `src/names.ts`:
  - `NameSet`: the names in a folder, compared case-insensitively on Windows.
  - `nameProblem(name, taken, self?)`: empty, `.`/`..`, a path separator, or already taken. `self` lets a rename change only the case of its own name.
  - `freeNewName`: "untitled.txt" → "untitled (2).txt" for default names.
  - `checkRenames` / `orderRenames` for bulk rename: per-row problems (duplicate in batch, taken by an item outside the batch). Then a safe order: chains run target-first, and cycles go through a temporary `name~rename` hop.
- `transferUi.ts`: `namesIn(dir)` (via strict `readDir`) and `assertFree(dir, name, self?)`.
- Each create/rename site:
  - lists the folder before its prompt, so the default name is free and `validate` shows the conflict inline;
  - calls `assertFree` again right before writing, because the prompt may have been open a while.
  - Single rename now uses the entry's own folder instead of `cwd` (search results can live elsewhere).
- BulkRenameDialog:
  - lists each affected folder on open and marks problem rows;
  - renames in the planned order;
  - on failure, rolls back the steps already done.
- Tests: `src/names.test.ts`.

## Status
Done. Merged with `main` at `a0ee531`, which includes undo-redo. The only conflict was the import line in `transferUi.ts`. My checks sit in front of undo-redo's `createUndo` / `moveUndo` calls, and no `pushUndo` line was changed.
- `pnpm build` passes. `pnpm test` passes: 11 files, 143 tests, 17 of them new in `src/names.test.ts`.
- Checked in the Vite dev server with `?mockRows`, where `readDir` returns the mock rows:
  - New Folder with a taken name keeps the prompt open with `"file-1" already exists here`.
  - BulkRenameDialog, mounted with the real `listNames`:
    - the chain 2→3, 3→4, 4→5 ran target-first;
    - a rename onto file-3 (outside the batch) was flagged on its row with the button disabled;
    - the swap 1↔2 went through `file-2~rename`;
    - a failure on the third rename put the first two back.
- Not run against the real Tauri backend (frontend-only task, no cargo build).

## For review
- [Policy](../../decisions/2026-11-08-create-rename-conflicts-policy.md):
  - Typed names that are taken are refused inline, not replaced or auto-renamed.
  - Default names become "untitled (2).txt"-style.
  - `/` (and `\` on Windows), `.` and `..` are refused.
  - Bulk Rename orders its renames, breaks cycles with `name~rename`, and rolls back on failure.
  - Single rename now works in the entry's own folder instead of `cwd`.
- Follow-up for the lead: the frontend check leaves a small race before each write. Closing it needs backend no-clobber commands (`File::create_new` for new files, `create_dir` instead of `create_dir_all`, `renameat2(RENAME_NOREPLACE)` / `MoveFileExW` without `REPLACE_EXISTING`).
- Bulk Rename still pushes no undo entry (undo-redo's area if wanted).
