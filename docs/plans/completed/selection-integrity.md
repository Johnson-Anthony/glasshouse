# selection-integrity

Branch: `claude/cool-satoshi-4102fc`. Frontend only, so no Rust build. Task 3 of the second survey.
Scope: `## 3. selection-integrity` in `docs/plans/active/survey-2.md`.

## Problems
1. **Selection, focus and anchor are row indexes into `entries`**, and nothing remaps them when the folder is re-listed (fs watcher, 30 s poll, refresh). After a file appears or disappears, the same indexes point at other files, so Delete can trash a file you never selected.
2. **Stale rows while navigating.** The old folder's rows stay on screen and clickable until the new listing arrives. An in-flight fetch for the old folder can also land after you've left it.
3. **The search filter is window-wide and never clears.** Select All, Invert, Select by… and the other selection commands walk all of `entries`, so they pick rows the filter hides. A filtered Ctrl+I then Delete trashes the hidden files.
4. When the filter hides every row, the pane looks empty with no explanation.
5. Find in Files stays on "searching…" if you clear the query mid-search.

## Approach
- **One listing state** in `useTabState`: entries, selected, focus and anchor change together, so no render ever pairs new entries with old indexes. The pure helpers go in a new `src/listing.ts`:
  - `relist(prev, entries)` maps the selection, focus and anchor by path (`normalizePath`). Selected files that are gone drop out. A focus that's gone stays at the same position, clamped, so after a delete it lands on the next row. An anchor that's gone follows the focus.
  - `setSelected`, `setFocusIndex` and `setAnchorIndex` are **bound to the entries they were rendered with**. If a re-list landed before the update applies, the indexes are moved to the same files in the new listing. That covers a click racing a background re-list, and the selection commands that await a prompt. `TabState` and `TabActions` keep their shape, so `fileOps.ts` and the rest don't change.
- **Navigation** (`commitNav`) clears the listing, sets `loading` and clears `error` right away, and bumps `fetchSeq` so any fetch still in flight for the old folder is dropped.
- **Filter per tab:** `searchQuery` moves from App into `TabState` (with `setSearchQuery`), and navigation clears it. The tag filter keeps its chip and stays as it is.
- **One definition of "visible rows":** FilePane's filter and sort move unchanged into a pure `viewRows()` (`src/viewRows.ts`).
  - FilePane uses it as before.
  - App gives handlers `ctx.visibleRows()`, the rows on screen in display order. It's lazy, so nothing extra is sorted unless a command asks. In Miller mode it's Miller's own order.
  - Every command in `handlers/selection.ts` uses it, including Extend to Line End and Add Next Match, which now follow display order.
- **The selection never holds a hidden row.** When the visible rows change, FilePane drops selected rows that went out of view, and moves focus to the first visible row if the focused one is hidden. Enter only opens a visible focused row.
- **Notice:** `no matches for "x"` when rows exist but the filter hides them all. With a tag filter it says `nothing tagged "t"`, and with both it gives both.
- **Find in Files:** clearing the query also clears `busy`, and the status label never says "searching…" for an empty query. The label moves to a small pure helper so it can be tested.

## Tests
- `listing.test.ts`: relist keeps the selection on the same files when rows are added or removed, drops vanished files, handles focus and anchor fallback, and the bound setters remap across a re-list.
- `viewRows.test.ts`: filter, tag filter and sort, the same as FilePane's old behavior.
- `routing.test.ts` / a selection test: Select All, Invert and Select by… use only the visible rows; Extend to Line End and Add Next Match follow display order.
- FilePane static render: the "no matches" notice.
- Find in Files status label: an empty query never shows "searching…".

## Also fixed
- **Row drag:** the drag's sources were indexes from pointer-down. A file appearing mid-drag moved a different file (in the demo, Downloads instead of Music). They're now matched by path at the drop (`remapIndexes`).
- **Marquee:** it sets its live-DOM hits through the latest render's setter.

## For review
- Decision records:
  - `docs/decisions/2026-11-11-selection-integrity-listing.md`: indexes vs paths, bound setters, focus fallback, navigation;
  - `docs/decisions/2026-11-11-selection-integrity-filter.md`: filter scope, visible rows, pruning, notice, tests.
- `site/capture/capture.mjs` has five new `demo:` checks: the file pane's behavior in the live demo. These are the only tests of the hook-level fixes, because the unit tests have no DOM environment.

## Status
- [x] Reproduced in the demo, before the fix:
  - re-list: the selection moved from Pictures to a new Notes folder;
  - Ctrl+I under a filter selected 5 of 5, with 4 of them hidden;
  - for 20 ms after opening a folder, the old rows still showed;
  - a mid-drag re-list made the drag move the wrong file.
- [x] listing.ts + state.ts
- [x] viewRows.ts + FilePane
- [x] per-tab search + App ctx
- [x] selection handlers
- [x] Find in Files
- [x] Merged main (24 commits; one conflict in `components.tsx`, where both sides added a helper, so both were kept).
- [x] Checks on the merged tree:
  - `pnpm build` passes (only the existing chunk-size warning);
  - `pnpm test`: 376 passed, 3 skipped (26 new tests here);
  - `pnpm check:wiring`: 0 problems;
  - `pnpm site:build`, then `pnpm site:capture check`: 23/23 pass, including the five new `demo:` checks.
- [x] Handoff

Done, 2026-11-12 (the work is from 2026-11-11; the app restart interrupted the last check run).
