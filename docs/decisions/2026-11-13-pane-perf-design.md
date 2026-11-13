# pane-perf: a windowed list in the list modes, rows that keep their identity, a lazy terminal

Date: 2026-11-13. Task: `pane-perf` (survey-2 task 13). Status: for review by the lead.

## Windowing
**Chosen: our own windowing in FilePane, with the arithmetic in `src/paneWindow.ts`.** No library: rows are one fixed height (`--row-h`), so the window, marquee hits and the scroll to the focused row are each a division. A library would bring its own scroll container and row wrappers, and the pane's CSS, the marquee and drag (which finds rows with `elementFromPoint` and `data-orig`) all assume `.rows > .row`.
- **Which modes:** the list modes (Details, Compact List, Tree) are windowed. The card modes (Grid, Icons, Tiles) wrap rows into columns that change with the pane's width, and they render every row as before. FilePane tells them apart by `.rows`'s computed `display` (`block` for lists, `grid` or `flex` for cards), so no display-mode prop had to be threaded through App.
- **Row height** is measured from a rendered row after each render (a layout effect that only sets state when it changed). It follows density, compact list and tree without the pane knowing about them.
- **Overscan** is 20 rows each side. The window always starts on an even row, and the striping rule is now `.row:nth-child(odd of .row)`, so the spacers don't count and the stripes don't swap as you scroll.
- **Marquee:** in the windowed modes, hits come from the box's y range in content coordinates (`rowsInSpan`), so rows scrolled out of view count, as they did when every row was in the DOM. Card modes keep the old per-row rectangle test; they render every row.
- **Focus scroll:** a layout effect computes the scrollTop (`scrollToRow`, the same "nearest" as `scrollIntoView`) and moves the window in the same commit, before paint, so End never shows blank rows. Its dependencies no longer include the rows array.
- **Mid-drag re-list:** a shift or ctrl marquee holds its starting selection as indexes into the rows at mousedown, remapped by path to the current rows on each move (`remapIndexes`, as the drag source already does).

## Rows that keep their identity
- App passes the memoised `liveRows` to FilePane. The new array per render was what made every App render re-filter, re-sort and re-render every row, and the focus-scroll effect then scrolled back to the focused row.
- `relist` returns the previous listing when a re-read has the same entries (compared by field: path, name, kind, size, modified, hidden, ext, link, lossy, git). `keepGitInfo` does the same for git info. A poll or watcher event that finds nothing new leaves the hook's result unchanged, so App doesn't re-render; React may render the tab's headless shell once to find the state unchanged.
- **Rejected: comparing in the backend** (a version stamp per folder). It would save the transfer as well, but it's a Rust change and this task is frontend only; `refresh-cost` (task 14) is the place for it.

## Sort keys
`viewRows` computes each row's key once and sorts the keyed rows: by name at 100k, 297 → 72 ms. The comparator is otherwise the same (folders first, untagged last, the name as the second key for type), and a test checks the order against the old comparator for every key in both directions.

## Chunks
- **The terminal drawer is `React.lazy`**, mounted the first time the terminal is wanted (opened, or a profile pushed by ssh Connect or a run-profile item), and kept mounted after that so closing keeps its shells. It starts closed for its first style pass so the first open still slides in. "New Terminal Tab" on a drawer that isn't loaded yet still gives one tab: the drawer's open-with-no-tabs effect adds it once the drawer loads. Main chunk: 759 → 433 kB.
- **noticesData stays one 542 kB lazy chunk, so Vite still prints its warning for it.** It's data (license texts, 408 kB of it in `third-party.json`), loaded only when Help → Third-party Notices opens. Splitting the JSON out as its own JS chunk would land at about 496 kB, at the limit. Serving it as a fetched asset would clear the warning for good, but a same-origin `fetch` inside the Tauri webview can't be checked without a Rust build, and nothing in the app fetches same-origin today. Raising `chunkSizeWarningLimit` would hide a main-chunk regression. For the lead: worth a follow-up with a Tauri build at hand (fetch the asset, or have `pnpm notices` write the texts as a separate file).
