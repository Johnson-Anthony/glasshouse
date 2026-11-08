# copy-undo-guard

Branch: `claude/cool-satoshi-4102fc` (same worktree; undo-redo is merged). Frontend only. Low priority.
Scope: `## copy-undo-guard` in `docs/plans/active/survey-fixes.md`.

## Problem
`copyUndo`'s inverse deletes every copy recursively. That covers paste, Paste Special, Duplicate and drag-copy, all through `transferUi.pushTransferUndo`. If you edit a copied file, or add work inside a copied folder, a later Ctrl+Z throws that work away for good.

## Approach
- **Fingerprint each copy right after it's made.** The entry starts this when it's built, as a promise; it's taken again after every redo.
  - For a file or symlink: kind, size and mtime, from the parent folder's listing.
  - For a folder: the same for every entry under it, keyed by relative path, from `readDir` (hidden entries included; symlinks are not followed). Folder mtimes are left out: the listing already catches adds and removes, and editor swap files would otherwise cause false alarms.
  - Taking the fingerprint as a promise keeps `pushUndo` synchronous, so a Ctrl+Z straight after a paste still undoes the paste.
- **Undo** takes the fingerprints again and compares, before deleting anything.
  - If any copy changed, went missing, or couldn't be checked, it **refuses the whole step**. Nothing is deleted, and the message names the changed items.
  - The runner then drops the entry, as with any failed step.
- **Size cap:** a copied tree with more than 20,000 entries isn't fingerprinted, and its undo refuses ("too large to check"). Walking it would mean thousands of synchronous `list_dir` calls on the main thread, until `async-commands` lands.
- **No content hashes.** `hash_sha256` would read every copied byte again, synchronously on the main thread, and size+mtime catches real edits: saves, editor atomic renames, appends.
- Only `undoActions.ts` changes, plus its tests. `pushTransferUndo` and the New/Rename paths (create-rename-conflicts) are untouched.

## Tests (`undoActions.test.ts`)
The in-memory fs gets mtimes. Cases:
- edited copied file: refused, nothing deleted;
- same-size edit: caught by mtime;
- file added inside a copied folder: refused;
- nested edit: refused;
- a copy deleted by hand: refused;
- an untouched copy still round-trips, including undo after redo, which needs fresh fingerprints;
- over the size cap: refused.

## For review
- Decision record: `docs/decisions/2026-11-08-copy-undo-guard-fingerprints.md`.

## Status
Done, 2026-11-08.
- [x] Implementation, in `src/undoActions.ts` only. `copyUndo` gets an optional `limit` parameter, used by tests.
- [x] Tests: 7 new in `undoActions.test.ts`, and the in-memory fs now has mtimes. `pnpm test` 133/133, `pnpm build` passes (only the existing chunk-size warning).
- [x] Handoff

The fingerprint walk is deliberately not awaited by `pushUndo`. The tests let it settle before they edit a copy. An edit made during the walk would become the baseline; that gap is recorded in the decision note.
