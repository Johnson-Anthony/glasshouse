# selection-integrity: indexes stay, remapped by path; setters bound to their listing

Date: 2026-11-11. Task: `selection-integrity`. Status: for review by the lead.

## Index state or path state
**Chosen: keep selection, focus and anchor as indexes, and remap them by path.** Entries, selection, focus and anchor live in one `Listing` value in `useTabState` (`src/listing.ts`), so they always change together.
- A re-list goes through `relist(prev, entries)`, which moves each index to the same file (`normalizePath`, so on Windows a case-only rename keeps its selection).
- `TabState` and `TabActions` keep their shape. `fileOps.ts`, App's ctx, the Inspector and Miller didn't change, and neither did the branches running beside this one.

**Rejected: store paths and derive indexes.** That would mean the same remap on every render, plus a change to every consumer of `selected`. It also doesn't solve the harder case below.

## Updates that race a re-list
A click arrives with indexes from the rows on screen. If a background re-list is already queued, React applies the queued updates in order, re-list first, so the click's raw indexes would land on the new entries and pick other files. Remapping only in `fetchAll` doesn't help with that.

**Chosen: the index setters are bound to the entries of the render that made them** (`useCallback(..., [entries])`). `withSelected`, `withFocus` and `withAnchor` move the indexes from that basis to the current listing whenever the two differ.
- This covers selection commands that await a prompt (Select by Pattern…) and the pane's own handlers.
- A file that's gone since then drops out of the selection, and leaves focus or anchor where they were.
- `actions` now changes identity on each re-list. Nothing depends on that identity beyond the tab handle, which already changed with `state`.

**Same idea for a row drag.** Its sources are indexes from pointer-down. At the drop they're matched by path against the rows on screen (`remapIndexes`), so a file that appears mid-drag no longer swaps which file moves. The marquee takes its hits from the live DOM, so it sets them through the latest render's setter.

## Where a lost focus goes
**Chosen: the same position, clamped.** The backend lists folders first, then names ignoring case, which is the pane's default order, so after a delete the focus lands on the next row. A lost anchor follows the focus. A lost selection just drops out: nothing is ever selected that you didn't select.

## Navigation
**Chosen: `commitNav` clears the listing at once,** sets `loading` and clears `error` and the filter. It also bumps `fetchSeq`, so a fetch still in flight for the folder you left can't write its rows into the new one. The new folder's own fetch still waits for the 60 ms debounce.

`gitInfo` is left alone. Clearing it would make the branch badge blink on every move inside a repo, and the next fetch replaces it.
