# undo-coverage

Task 11 of `docs/plans/active/survey-2.md`. Frontend only. Branch `claude/youthful-shtern-2ac1c5`.

## Goal
Every change the app makes to files (or to git) either pushes an undo entry or marks itself as one that can't be undone. Then Ctrl+Z never skips past it to an older, unrelated action.

## Building blocks
- **`state.ts`: `markIrreversible(label)`.** It clears both stacks and leaves a stop entry. The next Ctrl+Z reports "can't undo <label>" (a new `irreversible` outcome, shown as a toast by App's `runUndoStep`), and after that there is nothing to undo.
- **`names.ts`:**
  - `runRenameSteps(steps, rename)`: Bulk Rename's loop and rollback, moved out of the dialog. When a step fails, the steps before it are put back in reverse order, and the result lists any that couldn't be.
  - `renameStepsProblem(steps, listings, windows)`: walks the steps over the folders' listings and returns the first one that would land on a taken name or whose source is gone. Undo and redo of a bulk rename check this before renaming anything. The plain `ensureFree` check can't be used here, because a chain or swap frees names as it goes.
- **`undoActions.ts`:**
  - `renameStepsUndo` for Bulk Rename.
  - `madeUndo(label, paths, remake, opts)` for things the app made where nothing was before: links, archives, extracted entries and a module folder. Undo deletes them only if their fingerprint still matches, and `needs` lists paths that must still exist, such as a hard link's original. Redo checks that the paths are free and makes them again. `copyUndo` becomes `madeUndo` with a copy as `remake`.
  - `contentUndo(label, path, before, after)` for a file whose content was replaced. Undo writes the old content back only if the file still holds what was written. Export Layout uses it, and it's there for task 7's Find & Replace.
  - `groupUndo(label, parts)`: several entries as one step (Screenshot Auto-sort's folders and moves).
  - `permissionsUndo(label, changes)`: undo sets the old permissions back only while every path still has the new ones.

## Coverage
| Action | Where | After this task |
|---|---|---|
| Bulk Rename | `dialogs/BulkRename.tsx` | `renameStepsUndo`. A failed run whose rollback also failed → `markIrreversible` |
| From Template | `handlers/misc.ts` | `createUndo` (file with its body) |
| Python Module | `misc.ts` | `madeUndo` on the folder |
| Paste Text into Filename | `misc.ts` | `moveUndo` (rename) |
| Create Symlink, Paste as Symlink / Hard Link / Shortcut | `misc.ts` | `madeUndo`; for hard links, the original must still be there |
| Export Layout | `misc.ts` | asks before replacing an existing `.glasshouserc` (it was overwritten silently); `createUndo` or `contentUndo` |
| Shred | `misc.ts` | `markIrreversible` |
| Screenshot Auto-sort | `handlers/tools.ts` | one entry for all months (moves plus the month folders it made); the report counts skipped, failed and cancelled months; Cancel stops the sort |
| Batch Permissions | `tools.ts` | `permissionsUndo` (old modes read first); `markIrreversible` if one can't be read |
| Inspector chmod and Windows read-only toggle | `preview/Inspector.tsx` | `permissionsUndo` (added after inspector-perms merged) |
| Change Owner | `tools.ts` | `markIrreversible` (the old owner isn't kept in a form chown takes back) |
| Custom Command, Run Script on Selection | `tools.ts` | `markIrreversible` (what a script changes is unknown) |
| Zip / Tar / 7z, ZIP each individually, Compress to ZIP | `handlers/archive.ts`, `handlers/fileOps.ts` | `madeUndo` on the archive(s) |
| Extract Here / Extract to Folder | `archive.ts` | `madeUndo` on what landed (or on the new folder); redo extracts again under the same names. Extract to Folder no longer leaves an empty new folder when cancelled |
| Paste Special | `dialogs/PasteSpecial.tsx` | copy or move undo, as for Paste |
| Delete Permanently | `fileOps.ts` | `markIrreversible` |
| Git: Stage, Unstage, Discard, Commit, Amend, Pull, Push, Fetch, Stash, Clean, Checkout, New Branch, Merge, Rebase | `handlers/git.ts`, `handlers/helpers.ts` | `markIrreversible` |

**Left to other tasks:** Find & Replace (task 7, which can use `contentUndo`) and Move to Trash (task 12).

**Not file changes**, so no entry: tags, pins, settings, the recent list, the clipboard, and Import Layout (it reloads the app, which empties the in-memory history anyway).

## Tests
- `names.test.ts`: `runRenameSteps` (a swap through `~rename`, rollback after a failure, a rollback that fails) and `renameStepsProblem`.
- `undoActions.test.ts`: round trips and guards for `renameStepsUndo`, `madeUndo` (with `needs`), `contentUndo`, `groupUndo` with `emptyFolderUndo`, and `permissionsUndo`. The existing `copyUndo` tests pass unchanged on top of `madeUndo`.
- `undo.test.ts`: `markIrreversible`.
- `handlers/undoCoverage.test.ts` runs the real handlers against a small in-memory disk behind the mocked api. It checks that each handler above pushes its entry or marks itself irreversible, that undo and redo restore the disk, and the Auto-sort report and its Cancel. Two mutations (dropping git's marker; treating every extract folder as new) made the tests fail as they should.
- **Not unit-tested:** Paste Special's entry and App's "can't undo" toast, because the tests have no DOM. The demo check in the browser was dropped after the RAM crash.

## Status
**Done** 2026-11-12, on `claude/youthful-shtern-2ac1c5`, merged with main after inspector-perms and selection-integrity.
- [x] building blocks + tests
- [x] handlers wired, plus Batch Permissions and the Inspector's chmod via `permissionsUndo` (possible once inspector-perms exposed the mode)
- [x] decision record: `docs/decisions/2026-11-12-undo-coverage-policy.md`
- [x] `pnpm build`, `pnpm test` (456 passed, 3 skipped), `pnpm check:wiring` (0 issues), `pnpm site:build`, `pnpm site:capture check` (all PASS)
