# miller-parity

Branch: `claude/modest-nobel-8ee21d` (worktree `modest-nobel-8ee21d`), started 2026-11-13 from `main` (`39385f2`).
Backlog entry: section 23 of `docs/plans/active/survey-2.md`. Frontend only.

## Status
**Done** 2026-11-13. Commits: `fe749c6` (the change), `922fddd` (merge of `main`), `2e09097` (demo rebuild).
- Everything in the approach below is in. Also done: the outer columns watch their folders (so a Ctrl+drop into the preview column or a rename from the parent column's menu shows), a column never shows the previous folder's rows while the next listing is on its way, the Keybindings cheatsheet lists Esc (clear the selection) and Miller's keys, and stale comments that described Miller's own key handler are fixed.
- Checks: `pnpm build`; `pnpm test` 797 passed, 3 skipped (59 files; `Miller.dom.test.tsx` has 21 tests and replaces the server-render `Miller.test.tsx`; 2 `entryName` tests); `pnpm check:wiring` clean; `pnpm site:build` from the committed sources; `pnpm site:capture check` 25/25 under a 3 GB cap (new: "demo: Miller columns multi-select, file menu, Esc closes then deselects"). By hand in the site demo (browser pane, Chromium): Ctrl and Shift click, the file menu with Bulk Rename… for two rows, Esc closing the menu and then deselecting, h/l/→ navigation keeping focus on the pane, a drag lighting a preview-column folder and moving into it, Descending reversing the middle and parent columns, Ctrl+H showing hidden files in the parent column, a right-click on the parent column opening its folder's menu.
- Not checked: the desktop app (WebKitGTK) and Windows.
- Not done (possible follow-ups): dragging from the outer columns; a keyboard cursor in them; renaming or trashing the current folder from the parent column's menu leaves the tab on a gone path (as the sidebar's menu does).

## Problems
1. Miller columns (View → Miller Columns, Ctrl+7; `MillerView`) has no context menu: App blocks the browser's, and Miller's rows have no handler. The Menu key and Shift+F10 do nothing there either.
2. No multi-select: a click or an arrow key selects one row. No Ctrl/Shift click, Shift+arrows, Ctrl+A, marquee.
3. No drag: rows can't be moved or copied onto folders, tabs, breadcrumbs, the sidebar or another app.
4. It ignores the sort setting (always folders first, then name) and the filter box and tag filter, so `ctx.visibleRows` has a Miller branch that disagrees with what the pane would show.
5. Esc doesn't clear the selection (PROGRESS "Broken" and "Next").
6. Selection and focus by path across a re-list: the tab state already remaps them (selection-integrity), but anything Miller does with indexes outside it (a drag's sources) would need the same.

## Approach
**The middle column is the file pane.** Instead of copying FilePane's selection, menu and drag code into Miller, App renders the same `<FilePane>` it renders in every other mode, and in Miller mode wraps it: `<MillerView …>{filePane}</MillerView>`. Miller keeps only what is its own: the parent column, the preview column, and ranger's keys. So the middle column gets, from the code that already does it for the pane:
- the context menus by right-click (file menu on a row, empty-area menu elsewhere) and by the Menu key / Shift+F10 (`openMenuFromKeys`);
- the selection rules: Ctrl/Shift click, Shift+arrows, Home/End/PageUp/PageDown, Ctrl+A, Esc to deselect, the marquee, type-ahead;
- the drag: Ctrl copies, drops on folder rows, tabs, breadcrumbs and sidebar rows, the OS hand-off at the window's edge, sources remapped by path after a re-list;
- sort column and direction, folders-first, the filter box and tag filter (`viewRows`), so `ctx.visibleRows` loses its Miller branch;
- selection, focus and drag sources following files by path across a re-list (state.ts `relist`, FilePane's `remapIndexes`);
- cut rows dimmed, git dots, the windowed list, the pane's focus ref for Tab/F6.

Details:
- **FilePane** gets one prop, `millerKeys`: ← and h open the parent folder (`onUp`), → and l open the focused row (`onOpen`), j and k move like ↓ and ↑ (Shift extends). Only without Ctrl/Alt/Meta. A type-ahead under way keeps its letters. ← works in an empty folder too.
- **CSS:** in `.miller`, the pane is the middle grid cell (`min-height: 0`, a row track of `minmax(0, 1fr)`), its header is hidden and rows show icon, name and size only, as Miller did.
- **Outer columns follow the same sort** (key, direction, folders-first) through `viewRows`, with no filter: the filter box is about the current folder. A small `entryName` helper in `viewRows.ts` splits a listing entry's name the way App's `entryToRow` does, and `entryToRow` uses it, so both orders agree. Hidden files: the outer columns already list with the tab's `showHidden`; covered by a test.
- **Outer columns take drops and have menus:** each column carries `data-drop-path` for the folder it lists (parent column: the parent folder; preview column: the focused folder), and each folder row its own path, so a drag from the middle column can drop there; a drop highlight style for them. A right-click on an outer row opens the sidebar's per-path menu for it (`CONTEXT_SIDEBAR_FOLDER` / `_FILE`, run by `handlers/target.ts` on that path); on a column's empty space, the menu of the folder the column lists.
- **App:** removes the Miller branch of `visibleRows`, builds the FilePane element once and wraps it in Miller mode; `MillerView` drops `entries`, `focusIndex`, `setFocusIndex`, `setSelected` and `error` (the pane shows the error) and takes the focused entry, the sort options and `onPathContext`.
- Not in scope: dragging from the outer columns (they're navigation), a marquee across columns.

**Decision record:** `docs/decisions/2026-11-13-miller-parity-design.md` (the pane as the middle column, rather than shared helpers; outer columns' sort, menus and drops; vim keys versus type-ahead).

## Tests
- `Miller.dom.test.tsx` (FilePane with `millerKeys` inside MillerView): with `millerKeys`, ←/h call `onUp`, →/l open the focused row, j/k move focus and selection, Shift+J extends, a type-ahead under way keeps `j`; without it, `j` is type-ahead.
- `Miller.dom.test.tsx`: the outer columns sort by the sort key and direction with folders first or not; they list with `showHidden`; the columns and folder rows carry `data-drop-path`; right-click on an outer row calls `onPathContext` with its path and kind, and on empty space with the column's folder; the middle slot renders its child.
- `viewRows.test.ts`: `entryName`.
- Site demo check: Miller mode (Ctrl+7), Ctrl+click two rows, right-click opens the file menu with Bulk Rename…, Esc closes it and a second Esc deselects; then back to Details.

## Checks
`pnpm build`, `pnpm test`, `pnpm check:wiring`, `pnpm site:build`, `pnpm site:capture check` (3 GB cap); commit the rebuilt `docs/demo` after the last source commit.
