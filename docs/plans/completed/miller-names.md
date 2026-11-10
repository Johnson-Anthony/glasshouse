# miller-names

Branch: `claude/elastic-heisenberg-27fb3b` · Backlog entry: `## miller-names` in `survey-fixes.md`
Found 2026-11-08 by link-display. Fixed in `b6db33d`, which the lead merged as `d2b0e32`. These docs follow on top of that.

## Status
**Done 2026-11-10.** Checks: `pnpm build` OK, `pnpm test` 233/233, `check:wiring` clean. This is a frontend-only change; cargo wasn't run.

## The bug *(reproduced)*
`src/Miller.tsx` appended `.${e.ext}` to `e.name` in 4 places: the parent, current and child columns, and the preview title. `FileEntry.name` already includes the extension, because the backend's `list_dir` uses the full file name. Only the main list's `entryToRow` strips the extension, since it shows the extension as a separate dimmed chip.

**Reproduced** in the vite dev server (`?mockRows=30`, Ctrl+7 for Miller columns) with the pre-fix `Miller.tsx`: 54 of 60 rows showed `file-1.rs.rs` and so on, which is every file; the other 6 rows are folders. With the fix, 0 of 60.

Before the fix, the bug was hidden in mock mode. The browser-only `mockRows()` in `src/api.ts` built names without their extension (`file-1` plus `ext: "rs"`), unlike real entries, so the doubled suffix happened to produce a correct-looking name.

## Fix
- **Miller:** all 4 spots show `e.name` / `focused.name` as is.
- **Mock data:** `mockRows()` names now include the extension, the same shape as real entries. The main list renders them the same, because `entryToRow` strips a matching extension.
- **Test:** `src/Miller.test.tsx` renders `MillerView` with `react-dom/server`, which runs in node without a DOM. It checks that each name appears once, without a doubled extension, in the middle column and the preview title, and that only a symlink row gets the `↪` marker. It fails on the pre-fix code.

Choices are recorded in `docs/decisions/2026-11-10-miller-names-plain-names.md`.
