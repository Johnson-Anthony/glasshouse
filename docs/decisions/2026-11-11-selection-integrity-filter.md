# selection-integrity: the filter is per tab, and the selection never holds a hidden row

Date: 2026-11-11. Task: `selection-integrity`. Status: for review by the lead.

## Filter scope
**Chosen: per tab, and cleared when the tab navigates.** `searchQuery` moved from App into `TabState`. The survey offered either; doing both matches the usual file-manager behavior: you filter to find a folder, open it, and see everything in it.

**The tag filter keeps its current behavior.** It's already per tab, it shows a chip with a clear button, and the sidebar sets it on purpose, so a navigation doesn't drop it.

## What "visible" means
**Chosen: one pure `viewRows()` (`src/viewRows.ts`).** FilePane's filter and sort moved there unchanged, and both FilePane and the selection commands use it.
- Handlers get `ctx.visibleRows()`: indexes in display order, computed only when a command calls it. Building it into every ctx would sort the folder once per command, and a 100k-row sort costs about 280 ms until pane-perf (task 13) speeds it up.
- In Miller mode it's Miller's own order (`sortView`, now exported), because Miller doesn't apply the filter box.
- With display order available, Extend to Line End and Add Next Match now follow what's on screen, not the backend's order.

## Rows hidden after they were selected
Using visible rows in the commands isn't enough on its own. If you select files and then type a filter, the hidden ones stay selected, and Delete takes them.

**Chosen: FilePane drops selected rows that leave the view,** from an effect that runs when the visible set changes. If the focused row is hidden, focus moves to the first visible row, and Enter only opens a visible focused row.
- An effect leaves one render with the old selection. Typing and clicks are discrete events, whose effects React 18 flushes before the next event is handled. The only gap is a background update hiding a selected row (a tag change landing from a promise), and it lasts until the next frame.

**Rejected: pruning in `useTabState`.** The hook doesn't know the tag store or the fuzzy matcher, and putting them there would duplicate `viewRows`.

## Notice
`no matches for "x"` when the folder has rows but the filter hides them all; `nothing tagged "t"` for a tag filter; both together when both are set.

## Find in Files
Clearing the query mid-search cancelled the search, and the cancelled search never cleared `busy`. Now the empty-query branch clears `busy` too, and the status label (`findStatusText`) never says "searching…" for an empty query.

## Tests
- Unit tests:
  - `listing.test.ts`, `viewRows.test.ts` and `handlers/selection.test.ts`;
  - `FilePane.test.tsx`, a static render: only matching rows draw, plus the notice;
  - `findStatus.test.ts`.
- **The hook-level behavior has no unit test:** the remap through `fetchAll`, clearing on navigation, and the drag. There's no DOM test environment (no jsdom), and adding one would change the lockfile and the notices.
  - Instead, five `demo:` checks in `pnpm site:capture check` test these end to end against the live demo.
  - Against main's demo build, the first four fail. The drag moves the wrong file there too; I showed that with the same steps in a scratch script.
  - The per-tab filter was checked by hand in the demo.
