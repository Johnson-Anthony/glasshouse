# paste-conflicts

Branch: `claude/cool-shamir-734852` (worktree `cool-shamir-734852`). Backlog entry: `## paste-conflicts` in `survey-fixes.md`.

## Scope
Every frontend path that copies or moves entries into a folder built `dst = dir + basename(src)` and sent it without checking:

| Where | Op |
|---|---|
| `App.tsx` `case "Paste":` | copy / move |
| `App.tsx` `case "Duplicate":` (`p + " (copy)"` broke the extension and overwrote an existing copy) | copy |
| `App.tsx` "Move to…" for the selection and for a sidebar/breadcrumb target | move |
| `App.tsx` `performDrop` (row and sidebar drops; skipped only `src === dst`) | copy / move |
| `components.tsx` `PasteSpecialDialog` (same bug as Paste: copy in place emptied the file) | copy / move |
| `handlers/misc.ts` "Paste as Copy (verify SHA256)" (copy in place emptied the file, then "verified" two empty files) | copy |
| `handlers/tools.ts` Screenshot Auto-sort (overwrote same-named files in the month folder) | move |

Failures before: copy in place truncated the source (and undo deleted it); a same-named item at the destination was silently replaced (or merged, for folders); a folder could be pasted into itself.

Out of scope:
- The Rust side. symlink-safety already makes `copy_entry` refuse same-path and into-itself copies.
- Undo of a move overwriting something created at the old path later.
- Rename and New File/Note/Script/Folder onto an existing name, which overwrite or empty it too. Offered as a separate task ("Guard rename and new-file against existing names").

## Approach (as built)
- `src/transfer.ts` (pure, no imports beyond `paths.ts`):
  - `splitExt`, `copyName`, `pickFreeName`: "name (copy).ext", "name (copy 2).ext", …
  - `isInside`, `findConflicts`, `planSteps`: classify each item against the destination listing (into itself / same place / conflict / free) and produce one step per item, either transfer (maybe trashing the existing entry first) or skip.
  - `planTransfer` / `runTransfer`: list, ask once, run; fs calls and the question are injected (`TransferDeps`).
  - `conflictMessage`, `summarize`, `failureDetails`: dialog, toast and alert text.
- `src/transferUi.ts`: the real `transferDeps` (`readDir(dir, true)`, `copyEntry`, `moveEntry`, `moveToTrash`, `dialogs.showChoice`), `reportTransfer` (toast + failure alert), `pushTransferUndo` (built only from steps that succeeded), `asItems`.
- Destination listing uses main's strict `readDir` (rejects on error), so an unreadable destination aborts the operation. (Before merging main this branch had its own `listDirStrict`; it was dropped in the merge.)
- `src/components.tsx`: `dialogs.showChoice` (cancel + N buttons, Enter picks the primary); `PasteSpecialDialog` gets `planTransfer` and `trashEntry` props.
- Tests: `src/transfer.test.ts`, 28 tests (names, path containment, planning on both platforms, the run loop with fake deps, messages).

## Status
Done, and merged with `main` at `75de4a9` (conflicts in App.tsx, api.ts, components.tsx and both handlers, resolved onto main's `paths.ts` helpers and `readDir`). `pnpm build` and `pnpm test` pass after the merge (9 files, 108 tests). `transfer.ts` now uses `pathOps(windows)` from main's `paths.ts` instead of its own path key. Checked in the Vite dev server: the conflict dialog renders; Enter, Esc and the buttons resolve correctly; `runTransfer` with stubbed fs calls trashes then copies on replace and reports a failed trash without touching the item; and Edit → Paste with no backend refuses with "can't read /" instead of copying. Not run against the real Tauri backend (frontend-only task, no cargo build).

## For review
- [Conflict policy](../../decisions/2026-11-08-paste-conflicts-policy.md):
  - Copy in place gets an automatic copy name.
  - A real conflict asks once per operation: keep both / replace / skip.
  - Replace moves the existing item to the trash first instead of overwriting or merging; undo doesn't bring it back from the trash.
  - A Ctrl-drop into the item's own folder now duplicates it.
