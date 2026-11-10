# bulk-rename-digits

Branch: `claude/exciting-davinci-df48b1` (worktree `exciting-davinci-df48b1`), from main 06f1295. Frontend only.

## Status
**Done 2026-11-10.** `pnpm build`, `pnpm test` (232 passed, was 231) and `pnpm check:wiring` pass. Checked in the browser-only dev server (`vite` with `?mockRows=4`): the preview goes `001_` → `01_` → `000000001_` as digits goes 3 → 2 → 20 (clamped to 9). No console errors.
- [x] `{n}` pads to the dialog's "digits" field; `{n:W}` still overrides
- [x] Field clamped to its advertised 1–9
- [x] Tests in `src/bulkRename.test.ts`
- [x] Checks

## Problem
Bulk Rename has a "digits" field (default 3), but `numberDigits` was never read (`void numberDigits`). `{n}` always padded to 1 digit, so with the field at 3, `{n}_` gave `1_`, not `001_`. Only `{n:03}` padded.

## Change (`src/components.tsx`, Bulk Rename section)
- `expandNumbering(s, seq, defaultDigits)`: `{n}` pads to the field; `{n:W}` pads to W, an explicit override per token. Widths below 1 still count as 1.
- `BulkRenameOptions` has `numberDigits`. The dialog passes it to `bulkRenamePreview`, and `void numberDigits` is gone.
- The digits input clamps to 1–9 in `onChange`, matching its `min`/`max`. Before, only the spinner respected 9, and typing 52 meant 52 digits; that didn't matter while the field did nothing.
- The prefix/suffix placeholders say `({n} = number)` instead of `({n:03} ok)`.

Behaviour change: with numbering on, `{n}` now gives `001` by default instead of `1`, which is what the field always showed.

## Tests (`src/bulkRename.test.ts`)
The test defaults now match the dialog's (digits 3). New cases: `{n}` follows the field (1, 3, 5 digits; longer numbers aren't cut); `{n:W}` overrides it per token, alongside a plain `{n}` in the same name. Both fail against the old 1-digit default.

## Noticed, not changed
Turning numbering on without typing `{n}` anywhere changes nothing, and nothing in the dialog says a token is needed. The new placeholders hint at it. Appending a number automatically when no token is present would be a separate design choice.
