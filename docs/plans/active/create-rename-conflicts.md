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
- [x] Plan
- [ ] `names.ts` + tests
- [ ] App.tsx creates and renames, misc.ts handlers
- [ ] BulkRenameDialog
- [ ] Merge main, `pnpm build`, `pnpm test`

## For review
- (filled in as choices are made)
