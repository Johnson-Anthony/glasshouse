# ui-fixes

Branch: `claude/exciting-rubin-44f4c0` (worktree `exciting-rubin-44f4c0`). Frontend only.
Scope: the `## ui-fixes` section of `survey-fixes.md`.

## Status
**Done 2026-11-08.** The user approved the plan as written. Implemented all four items. `pnpm build` passes, and `pnpm test` passes 37/37: 11 new tests in `octal.test.ts` and `data.test.ts`.

Checked by hand in the browser pane, Vite only (no Tauri backend):
- Ctrl+G C opens the commit prompt.
- Ctrl+G Ctrl+P runs `git pull`, not the palette.
- Plain Ctrl+P opens the palette, and Find File shows no hint.
- The About dialog shows the build-date stamp. Version shows "unknown", the fallback when there's no backend; in the Tauri app it comes from `getVersion()`.

One addition beyond the plan: the "Move to…" `F6` hint is gone from the file and folder context menus, since F6 cycles panes. That's the same kind of shortcut clash as Find File's Ctrl+P.

Decision record: `docs/decisions/2026-11-08-ui-fixes-lossy-guard.md`.

## Approach

### 1. chmod validation (`handlers/tools.ts`)
- New pure helper `parseOctalMode(s): number | null` in `src/octal.ts`. It accepts only `/^[0-7]{3,4}$/` after trimming and returns null for everything else ("78", "0o755", "7", "12345", "").
- Batch Permissions uses it in both the prompt's `validate` and the apply step, so a bad value can't get through.
- Tests: `src/octal.test.ts`.
- The Inspector's rwx grid (`components.tsx`) builds the mode from checkboxes and never parses text, so it doesn't change.

### 2. Lossy-name guard (`data.ts`, `App.tsx`)
- Add an optional `mutates?: true` flag to menu items and palette items in `data.ts`. It means "writes to the files in the current selection".
- `data.ts` exports `MUTATING_LABELS`, built by walking every menu, context menu and the palette and collecting `action ?? label` from flagged items.
- `App.tsx` drops its hand-typed `MUTATING_OPS` and uses `MUTATING_LABELS`.
- One label is dispatched from code rather than a menu: the Inspector's compress chip sends `"Compress to ZIP…"`. It goes in a one-entry extras list next to the derivation, with a comment saying why.
- Flagged labels:
  - Edit: Cut, Copy, Rename, Bulk Rename…, Move to Trash, Delete Permanently, Shred (srm), Paste Text into Filename (it renames the selection).
  - Tools: Bulk Rename…, Batch Permissions…, Change Owner (chown)…, Run Script on Selection…, every Compress and Extract child.
  - Git: Stage Selected, Unstage Selected, Discard Changes.
  - File context menu: the same ops, plus Duplicate, Move to…, Git: Stage / Unstage / Discard changes, and the context menu's Compress/Extract children.
  - Palette: Bulk Rename…, Batch Permissions…, Git: Stage Selected, Run Script on Selection….
- **Departure from the survey: the paste-as-link actions stay unflagged.** They read the app clipboard, not the selection, and only Copy and Cut fill that clipboard. Copy and Cut are already guarded, so a lossy path can never reach a paste. A selection check on paste would block a valid paste whenever a lossy entry happens to be selected, and would still guard nothing.
- Tests in `src/data.test.ts`:
  - `MUTATING_LABELS` contains the labels above;
  - every label it contains exists in a menu (or is the documented extra);
  - the old misspelled labels are gone.

### 3. Shortcuts (`data.ts`, `App.tsx`)
- **Find File's Ctrl+P:** drop the palette hint and add a comment, following the existing `// no kb hint: Ctrl+D belongs to…` style. Ctrl+P keeps toggling the palette. A new binding for Find File would be a feature, not a fix.
- **Ctrl+G chords:** none of the Git menu's chords work, not just C (`Ctrl+G S` Status, `A` Stage Selected, `C` Commit…, `P` Pull). I'll implement all four:
  - `data.ts` exports `GIT_CHORDS` (letter → label), parsed from the Git menu's `kb: "Ctrl+G X"` hints, so the hints and the handler can't drift apart.
  - In `App.tsx`'s keydown handler, Ctrl+G outside text inputs starts a 1.5 s pending chord.
  - The second key is matched with or without Ctrl held, so Ctrl+G Ctrl+P runs Pull instead of opening the palette.
  - A key that doesn't match is swallowed and cancels the chord, as in VS Code, so a typo after Ctrl+G can't fall through to Delete and similar. Modifier-only keydowns are ignored.
  - Test: `GIT_CHORDS` equals the four expected entries.

### 4. About dialog and Help links (`components.tsx`, `handlers/misc.ts`, `vite.config.ts`, `vite-env.d.ts`)
- **Version:** `AboutDialog` reads `getVersion()` from `@tauri-apps/api/app` when it opens and shows `…` until it resolves, or `unknown` if it fails. The `core:app:allow-version` permission is already granted.
  - "Check for Updates" also uses `getVersion()` instead of the hardcoded "0.0.1".
  - `APP_VERSION` is removed from `data.ts`.
- **Built on:** Vite `define` injects `__BUILD_DATE__` (the build's UTC date), declared in `vite-env.d.ts`. In dev it's the date the dev server started.
- **Links:** a `REPO_URL` constant in `misc.ts` pointing to `https://github.com/Johnson-Anthony/glasshouse`. Documentation, Release Notes, Check for Updates and Report Bug all use it.

## Files
`src/octal.ts` (new), `src/octal.test.ts` (new), `src/data.test.ts` (new), `src/data.ts`, `src/App.tsx`, `src/handlers/tools.ts`, `src/handlers/misc.ts`, `src/components.tsx` (AboutDialog only), `vite.config.ts`, `src/vite-env.d.ts`.

## Out of scope / noticed
- Drag-and-drop moves don't go through `doFileOp`, so the lossy guard doesn't cover them (not checked in depth).

## Checks
`pnpm build`, `pnpm test`.
