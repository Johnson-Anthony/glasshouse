# split-and-tear-off: a split saves in the same session record

Date: 2026-11-20. Task: `split-and-tear-off` (survey-3 task 50, phase 1: split view). The scope said split state is part of the saved session.

## Options
- **A new key** (`glasshouse.session.v2`) with a record per pane. An older build would read none of it, so going back to 0.2 would open one tab at home and lose every saved tab.
- **The same key, with flags** on the existing record: `tabs` stays every tab, and the new fields are ones an older build ignores.

## Chosen: the same key
`glasshouse.session.v1` is now:
```json
{
  "tabs": [
    { "path": "/a", "sort": { "key": "name", "dir": "asc" } },
    { "path": "/b", "sort": { "key": "size", "dir": "desc" }, "pane": 1 }
  ],
  "active": 1,
  "split": { "other": 0, "dir": "row", "ratio": 0.5 }
}
```
- `tabs` lists the first pane's tabs, then the second's; each tab in the second pane has `"pane": 1`.
- `active` is the shown tab of the pane with the focus, as an index into `tabs`, which is what 0.2 reads it as.
- `split.other` is the other pane's shown tab, also an index into `tabs`. `split.dir` is `row` (side by side) or `column` (top and bottom). `split.ratio` is the first pane's share, kept between 0.15 and 0.85.
- With no split, the record is exactly what 0.2 writes.

## How it's read
- An older build reads the flat list and opens every tab, unsplit, on the tab that had the focus.
- A missing or malformed `split`, a `dir` it doesn't know, or every tab (or none) in one pane means no split. A bad `ratio` is 0.5.
- Tabs that can't be read are dropped, as before. `active` and `other` follow their tabs past dropped ones; an `other` that lands in the wrong pane falls back to that pane's first tab.
- Private tabs are never saved. A pane holding only private tabs saves as no split, so the next start doesn't open an empty pane.
- Only the window that owns the session (`session.rs`'s lock) saves, as before. A window opened with paths, or a second window, never writes it.

Code: `sessionOf`, `parseSession` and `restoreSession` in `src/session.ts`, and `layoutFromSession` in `src/tabLayout.ts`. Tests: `src/session.test.ts` ("a split's session") and `src/useTabLayout.dom.test.tsx`.
