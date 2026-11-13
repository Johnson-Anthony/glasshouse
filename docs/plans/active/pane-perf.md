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
- **noticesData:** split the generated JSON into its own lazy chunk, so no chunk is over 500 kB.

## Tests
- happy-dom tests for `useTabState` and FilePane, as above.
- `viewRows` order tests, as now, plus key cases for each sort.
- The demo checks in `pnpm site:capture check` must all still pass: keyboard, marquee, drag, scroll.

## Status
- [ ] happy-dom + notices
- [ ] Baseline numbers
- [ ] viewRows keys
- [ ] Memoised rows, unchanged-listing skip
- [ ] Windowed list, marquee, focus scroll
- [ ] Lazy xterm, notices chunk
- [ ] After numbers
- [ ] Checks: build, test, check:wiring, site:build, site:capture check
- [ ] Handoff
