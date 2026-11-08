# undo-redo: forward actions, guarded steps, failed steps are dropped

Date: 2026-11-08. Task: `undo-redo`. Status: for review by the lead.

## Entry shape
**Chosen:** `UndoEntry = {label, inverse, redo}`, with `redo` required.
- Keeping the name `inverse` kept the diff and the paste-conflicts merge small.
- A required field makes any new or missed `pushUndo` site fail to typecheck instead of silently not redoing.

**Rejected:**
- *Optional `redo` (entries without it aren't redoable).* Easy to forget, and the failure only shows at runtime.
- *Ops as data (`{op: "rename", from, to}` lists) run by one interpreter.* More general, but every operation here fits one of three builders.

## Builders, not inline closures
**Chosen:** `src/undoActions.ts` has three builders:
- `moveUndo` covers rename and move;
- `copyUndo` covers paste, duplicate and drag copies;
- `createUndo` covers a new folder or file.

They take an injectable fs, so tests run real round trips against an in-memory one. `transferUi.pushTransferUndo` (Paste, Paste Special, Duplicate, Move to…, drops) and the rename and create sites in App.tsx all use them.

## Guards
- **Every step that creates a path first checks it's free**, by listing the parent folder, case-insensitively on Windows.
  - The backend's `rename_entry` (`fs::rename`) and `write_text` (`fs::write`) replace an existing destination without asking, and redo is the new way to reach them long after the original action.
  - A case-only rename doesn't count as a conflict.
  - If the parent can't be listed, the operation itself is left to fail.
- **Undoing a new folder deletes non-recursively**, so the backend refuses once anything is inside. Before this change it was `remove_dir_all`.
- **Undoing a new file refuses if the file's size has changed** since it was created.
- **Not guarded:** undoing a copy still deletes the copies recursively, even if they were edited since. Doing better needs content hashes. Flagged for the backlog.

## Failure handling and ordering
**Chosen:**
- `undoLast` / `redoLast` move an entry to the other stack only after its step succeeds.
- A failed step is dropped from both stacks, and the alert says so.
- Steps run one at a time, through a promise queue.

**Why drop rather than keep:**
- A multi-item step can fail halfway (e.g. 2 of 3 items moved back). Neither replaying it nor reversing it is then safe.
- Keeping a failed entry on top of the undo stack would also block every older undo behind it.

**Rejected:** popping first and running afterwards (the old behaviour). A failed undo then sat on the redo stack, ready to "redo" an action that was never undone.

## Tabs
- Closing the last tab replaces it with a fresh tab at Home (`FALLBACK_PATH` if Home is unknown), rather than refusing the close. This matches how browsers handle closing the last tab and keeps Ctrl+W predictable.
- Tab labels go through `tabLabel(path, private)`, used by both `makeTab` and the label-sync effect, so navigating keeps `(private) `.
