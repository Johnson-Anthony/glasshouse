# pane-perf

Branch: `claude/cool-satoshi-4102fc`. Frontend only, so no Rust build. Task 13 of the second survey, plus a vitest DOM environment (the lead's addition).
Scope: `## 13. pane-perf` in `docs/plans/active/survey-2.md`.

## Problems
- The file list renders every row: at 100k entries that's about 700k DOM nodes.
  - The marquee calls `getBoundingClientRect` on every row on each mouse move.
  - Scrolling to the focused row runs `querySelector` over all rows.
- Every App render rebuilds `rows` (`renderActivePane`), so FilePane re-filters and re-sorts, and every `PaneRow` memo misses.
  - Re-renders happen on each arrow key and on every poll, including background tabs', because `setEntries` always gets a new array.
  - This is also the known "re-render scrolls back to the focused row" issue.
- The sort lower-cases names inside the comparator, on every comparison.
- xterm (about 340 kB) is in the main chunk and loads at startup, though the drawer starts closed. The main chunk is 759 kB, and Vite warns about chunks over 500 kB. `noticesData` (518 kB, already lazy) trips the same warning.
- From selection-integrity: a shift or ctrl marquee that's in progress during a re-list mixes old and new indexes.

## Approach
- **DOM tests first.** Add `happy-dom` as a dev dependency. Tests opt in per file (`// @vitest-environment happy-dom`), so the rest stay in node. The lockfile changes, so run `pnpm notices` and commit `src/assets/third-party.json`. Then the hook and the pane get real tests:
  - `useTabState`: re-list remap, navigation clears, an unchanged listing doesn't re-render;
  - FilePane: the window, keyboard, focus scroll, marquee.
- **Baseline before any change:** a vitest bench of `viewRows` at 100k, plus a headless-Chromium run of the demo with a 100k-entry folder:
  - render time, DOM nodes, arrow-key frame, filter keystroke, a no-change poll, marquee move.
- **Windowed list in FilePane:**
  - Measure the row height from a rendered row, since `--row-h` changes with density.
  - Track `.rows` scrollTop and height, and render the visible slice plus overscan between two spacers.
  - Marquee hits come from index arithmetic over the y range in content coordinates. That also covers rows scrolled out of view when the marquee extends past the pane, as before.
  - The focused row scrolls into view by arithmetic, the same "nearest" behavior as `scrollIntoView`.
  - Keep `data-orig` on rendered rows: drag targets use `elementFromPoint`.
  - The marquee's base selection is remapped by path when the rows change mid-drag.
- **Rows stop changing identity:**
  - App passes the memoised `liveRows` to FilePane instead of building `rows` per render;
  - `relist` returns the previous listing when the new one is equal, and `gitInfo` is only set when it changed, so a no-change poll renders nothing.
- **Sort keys once:** `viewRows` computes each row's key once, then sorts indexes by key. Same order as before; the existing `viewRows` tests guard it.
- **Lazy xterm:** App loads `TerminalDrawer` through `React.lazy`, and mounts it the first time the terminal is wanted. The drawer gets one closed frame, so the first open still slides in.
- **noticesData:** left as one lazy chunk (542 kB, data only), so Vite still warns for it; see the decision note for why and the follow-up.

## Tests
- happy-dom tests for `useTabState` and FilePane, as above.
- `viewRows` order tests, as now, plus key cases for each sort.
- The demo checks in `pnpm site:capture check` must all still pass: keyboard, marquee, drag, scroll.

## Status
- [x] happy-dom + notices (`pnpm notices` regenerates nothing: third-party.json lists runtime deps only)
- [x] Baseline numbers
- [x] viewRows keys
- [x] Memoised rows, unchanged-listing skip
- [x] Windowed list, marquee, focus scroll
- [x] Lazy xterm; noticesData left as is (decision note)
- [x] Tests: paneWindow, listing, FilePane in happy-dom, useTabState in happy-dom
- [x] After numbers (Chromium at 10k)
- [x] Real-browser checks (Chromium, 400 rows): End scrolls the last row fully into view, striping holds after scrolling an odd number of rows, Tiles renders every row and Details windows again, the terminal isn't loaded until opened and slides in on the first open
- [x] Checks, after merging main (trash-restore): `pnpm build`, `pnpm test` (534 passed, 3 skipped), `pnpm check:wiring`, `pnpm notices --check`, `pnpm site:build`, `pnpm site:capture check` (23 of 23, capped at 3G). No Rust changes, so no cargo.
- [x] Handoff

Decisions: `docs/decisions/2026-11-13-pane-perf-design.md`.

## Numbers
Before → after. The 100k numbers come from vitest; Chromium is capped at 10k (the lead's memory rule).

| | before | after |
|---|---|---|
| viewRows, sort by name, 100k (bench mean) | 297 ms | 72 ms |
| by name, descending | 286 ms | 75 ms |
| by type | 155 ms | 76 ms |
| by size | 39 ms | 25 ms |
| by modified | 56 ms | 30 ms |
| filter "a1", then sort | 32 ms | 23 ms |
| FilePane in happy-dom, 10k: mount | 2132 ms | 81 ms |
| DOM nodes | 108,586 | 731 |
| rows in the DOM | 10,000 | 65 |
| arrow key, new rows array per render (App before) | 640 ms | 63 ms |
| arrow key, same rows | 115 ms | 28 ms |
| End | 192 ms | 14 ms |
| marquee move | 384 ms | 3 ms |
| FilePane in happy-dom, 100k | out of heap (also at 25k) | mount 169 ms, 731 nodes, arrow 37 ms, End 19 ms, marquee 8 ms |
| main JS chunk | 759 kB | 433 kB (+ Terminal 342 kB, lazy); 441 kB with trash-restore merged |
| Chromium, demo, 10k: open the folder | 692 ms | 106 ms |
| pane DOM nodes | 110,013 | 509 |
| arrow key (keydown to two frames) | 117 ms | 33 ms |
| End | 110 ms | 33 ms |
| no-change poll | 82 ms | 33 ms |
| filter keystroke | 51 ms | 16 ms |
| clear the filter | 516 ms | 33 ms |
| marquee move | 147 ms | 33 ms |

33 ms is two frames, the floor of the Chromium method (keydown, then two `requestAnimationFrame`s), so those rows are at the floor rather than measured exactly.
