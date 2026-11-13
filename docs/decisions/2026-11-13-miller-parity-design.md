# miller-parity: the file pane is Miller's middle column

Date: 2026-11-13. Task 23 of `docs/plans/active/survey-2.md`. Plan: `docs/plans/completed/miller-parity.md`.

## The problem
Miller columns (`MillerView`) had its own row list for the current folder: one-row selection, no context menu (App blocks the browser's), no drag, its own fixed sort (folders first, then name), no filter, and no Esc to deselect. Every one of those already exists in FilePane.

## Choice: render FilePane as the middle column
App builds its `<FilePane>` once. In Miller mode it wraps it: `<MillerView …>{pane}</MillerView>`. MillerView keeps only the parent and preview columns; the middle column is the same component, state and handlers as in every other display mode.

So the middle column has, from the code that already does it: the file and empty-area menus by right-click, the Menu key and Shift+F10; Ctrl/Shift click, Shift+arrows, Home/End/PageUp/PageDown, Ctrl+A, the marquee, Esc to deselect and type-ahead; the drag (Ctrl copies; folder rows, tabs, breadcrumbs, sidebar rows; the OS hand-off at the window's edge); the sort column and direction, folders-first, the filter box and tag filter; selection, focus and drag sources following files by path across a re-list; cut rows dimmed, git dots, the windowed list, the pane's focus ref for Tab/F6 and its error notice. `ctx.visibleRows` no longer has a Miller branch, so the selection commands see what is shown.

**Rejected: shared helpers.** Pulling FilePane's click rules, key moves, menu anchoring and drag closure into modules that both FilePane and a Miller list call. It would share the rules but keep two list renderers, and each future pane feature (and fix) would need doing twice. It would also have changed far more of `components.tsx`, which other branches touch.

**What it changes in the look:** the middle column's rows are the pane's rows (kind icons in colour, git dots, stripes), shown as icon, name and size: CSS hides the header and the tag, date and git columns in `.miller > .pane`. Selected rows have the pane's selection colour and accent edge, which is what Miller's single "active" row looked like. The keyboard focus outline shows only while the pane has focus, as elsewhere; the preview column follows the focused row either way.

## Miller's keys: a FilePane prop
`millerKeys` on FilePane: ← and h open the parent folder (`onUp`), → and l open the focused row (`onOpen`, as Enter), j and k move like ↓ and ↑ (Shift+J/K extend, as Shift+↓/↑). Only without Ctrl, Alt or Meta, so Alt+← (Back) and Ctrl+L (Go to Path) are untouched. ← works in an empty folder.

These letters would otherwise start a type-ahead. They stay Miller's keys, except that a letter typed while a type-ahead is under way continues it (the same rule Space follows), so "aj" can still be typed after "a". Finding a name that starts with h, j, k or l by typing isn't possible in Miller; the filter box (/) does it.

## The outer columns
- **Sort:** the same key, direction and folders-first as the pane, through `viewRows` (`columnOrder` in `Miller.tsx`). Not the filter box or tag filter, which are about the current folder. `entryName` (in `viewRows.ts`) splits a listing entry's name the way the pane's rows are built, and App's `entryToRow` now uses it too, so the two orders can't drift apart. One difference left: a git code outside M/A/D/U/? (App normalises those to none) sorts by its letter in the outer columns.
- **Hidden files:** they list with the tab's `showHidden`, as before, now covered by a test.
- **Drops:** each outer column carries `data-drop-path` for the folder it lists (the parent column, the parent folder; the preview column, the focused folder), and each folder row its own path. The pane's drag finds them like any other target (`dropTargetOf`), lights them, and App's `performDrop` runs the move or copy.
- **Menus:** a right-click on an outer row opens the sidebar's per-path menu for it (`CONTEXT_SIDEBAR_FOLDER` or `CONTEXT_SIDEBAR_FILE`, run on that path by `handlers/target.ts`); on a column's empty space, the menu of the folder it lists. These menus already act on one path and never fall through to the pane's selection.
- **Staying current:** each outer column watches its folder while shown (`watchDir`, reference-counted in the backend) and re-lists on a report through a `RefreshGate`, as the tab and the sidebar tree do. Without that, a Ctrl+drop into the preview column or a rename from the parent column's menu wouldn't show, because the current folder doesn't change. A column's entries are kept with the folder they belong to, so while the next folder's listing is on the way the column is empty rather than showing the previous folder's rows under the new path (and taking drops for it).
- **Not done:** dragging from the outer columns (they navigate), a keyboard cursor in them (they're click-only, as before), and a marquee across columns.

## Limits
- Renaming or trashing the current folder from the parent column's menu leaves the tab on a path that's gone, as the sidebar's menu does; the tab shows the listing error.
- Not checked in the desktop app (WebKitGTK) or on Windows; checked in the site demo in Chromium and in happy-dom tests.
