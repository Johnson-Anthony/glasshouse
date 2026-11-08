# undo-redo

Branch: `claude/cool-satoshi-4102fc` (same worktree as tab-state, which is merged). Frontend only.
Scope: `## undo-redo` in `docs/plans/active/survey-fixes.md`.

## Problem
- `UndoEntry` is `{label, inverse}`. Redo pops the entry and calls `inverse` again, so a redo repeats the undo: rename back again, delete again. It fails, or worse, does something.
- The entry moves to the redo stack *before* its inverse runs. A failed undo still leaves it there.
- Two quick Ctrl+Z presses run two inverses at the same time.
- The backend's `rename_entry` (`fs::rename`) and `write_text` (`fs::write`) replace an existing destination without asking. A new redo would therefore clobber anything that has appeared at the target since the undo.
- Undoing "new folder" deletes it recursively, which takes along any files put in it since.

## Approach
1. **`UndoEntry` gets `redo`** (required, so an entry without it fails to typecheck). `inverse` keeps its name, which keeps the diff and paste-conflicts' merge small.
2. **Runner in `state.ts`.** `undoLast()` / `redoLast()` replace `popUndo` / `popRedo`.
   - Calls run one at a time, in order.
   - An entry changes stacks only after its action succeeds. On failure it is dropped and the caller gets `{status: "failed"}`: a half-applied step can't safely be replayed in either direction.
3. **Entry builders in `src/undoActions.ts`.** They take a small injectable fs interface (real one: api.ts wrappers), so tests can run full round trips:
   - `moveUndo(label, items, via)` covers rename and move (undo moves back in reverse order, redo moves again);
   - `copyUndo(label, items)` covers paste-copy, duplicate and drag-copy (undo deletes the copies, redo copies again);
   - `createUndo(label, path, what)` covers a new folder or file (undo deletes it, redo creates it again).
   - **Guards:**
     - every step that creates a path first checks it's free, by listing the parent; Windows compares case-insensitively, and a case-only rename is allowed;
     - undoing a new folder uses non-recursive delete, so the backend refuses if it isn't empty;
     - undoing a new file refuses if its size has changed.
4. **App.tsx:** the `pushUndo` sites use the builders, and the undo/redo commands use the runner. `handlers/types.ts` uses the `UndoEntry` type.
   - *As merged:* paste-conflicts moved Paste, Paste Special, Duplicate, Move to… and drops onto `runTransfer`, whose undo entries all come from `transferUi.pushTransferUndo`. That function now uses `copyUndo` / `moveUndo`. The merge conflicts were only at those sites, and main's side was kept.
   - The remaining App.tsx sites (both Renames, New Folder/File/Note/Script) use `moveUndo` / `createUndo`.
5. **Edge cases:**
   - closing the last tab replaces it with a fresh Home tab (`closeTab` gets a fallback path);
   - the label-sync effect keeps `(private) ` through a `tabLabel()` helper shared with `makeTab`.
6. **Tests:**
   - `undo.test.ts`: runner order, failure handling, serialization;
   - `undoActions.test.ts`: undo → redo → undo round trips on an in-memory fs for each builder, plus each guard;
   - `tabs.test.ts`: last-tab replacement and the private label.

## Out of scope / flagged
- Undoing a copy (paste, duplicate, drag) still deletes the copies recursively, even if they've been edited since. Checking that would need content hashes. Flag it.
- The original "New File" / "Rename" actions (not their undo or redo) can still overwrite an existing file. That's now the backlog item `create-rename-conflicts`. Its fix is checks before each operation, which this branch doesn't touch.

## For review
- Decision record: `docs/decisions/2026-11-08-undo-redo-forward-actions.md`.

## Status
Done, 2026-11-08.
- [x] Builders and runner
- [x] App sites, types, edge cases
- [x] `git merge main`: paste-conflicts merged, so Paste goes through `pushTransferUndo`
- [x] Tests: 24 new or rewritten (`undo.test.ts` 9, `undoActions.test.ts` 13, two in `tabs.test.ts`); `pnpm test` 126/126, `pnpm build` passes (only the existing chunk-size warning).
- [x] Dev server: closing the last tab leaves a fresh, working tab at `/` (the browser has no Home); a private tab keeps `(private) ` after navigating. Real undo/redo of file ops needs the Tauri backend (in the browser every op rejects), so the round trips are covered by the in-memory tests.
- [x] Handoff
