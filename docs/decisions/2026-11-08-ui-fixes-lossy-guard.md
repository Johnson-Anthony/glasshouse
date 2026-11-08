# Lossy-name guard: derived from `mutates` flags in data.ts

Date: 2026-11-08 · Task: ui-fixes

## Context
`App.tsx` blocks selection-writing commands when an entry's on-disk name isn't valid UTF-8, because its path is lossy. The blocked commands lived in a hand-typed `MUTATING_OPS` set that drifted from the real labels. "Batch Rename…", "Shred…" and "Compress to Zip…" matched nothing, and Delete, git, archive and paste-as-link commands were missing entirely.

## Decision
- Menu and palette items in `data.ts` take an optional `mutates: true`, meaning "writes to the files in the current selection".
- `data.ts` builds `MUTATING_LABELS` from the flagged items by walking every menu, context menu and the palette (it collects `action ?? label`). `doFileOp` checks against that set.
- One label is dispatched from code rather than a menu: the Inspector's `"Compress to ZIP…"`. It sits in `MUTATING_CODE_LABELS` beside the derivation.
- The paste-as-link actions are **not** flagged. They read the app clipboard, not the selection, and only Copy and Cut fill that clipboard. Both of those are flagged, so a lossy path can't get into it. A selection check on paste would block valid pastes and still guard nothing.
- The Git menu's `Ctrl+G X` hints feed `GIT_CHORDS` the same way, so the keydown chord handler and the hints can't drift apart.

## Consequences
- A new menu item that writes to the selection needs `mutates: true`. A missing flag means a missing guard, not a crash.
- A label renamed in `data.ts` stays guarded under its new name automatically.
- `src/data.test.ts` checks the flagged set against a list of the expected labels.
- Drag-and-drop moves don't go through `doFileOp`, so they remain unguarded.
