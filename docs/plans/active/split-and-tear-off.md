# split-and-tear-off (survey-3 task 50), phase 1: split view

The owner asked for "split view for tabs and also to be able to drag drop tabs into their own window like you can with browsers". Scope: "## 50. split-and-tear-off" in `docs/plans/active/survey-3.md`. Task 50 was then split into three phases, each merged on its own (survey-3, `93c7069`): split view, one process with many windows, and tear-off. This branch is phase 1. Why, and what phase 3 can reuse: `docs/decisions/2026-11-20-split-and-tear-off-phases.md`.

## Status
- [x] Plan sent to the lead (the cross-process design); phase-1 scope sent after `93c7069`
- [x] Frontend: tab layout module, split view, tab drag inside the window, menus and keys, session save
- [x] Cross-process tear-off code taken out; kept on the local branch `claude/split-and-tear-off-xproc-wip` (not pushed)
- [ ] Tests: vitest (layout, session, drag, the hook) done; e2e "split view" written, not yet run
- [ ] Full checks, rebase on main, handoff

## Split view
- **State: a new module.** The tab state moved out of App.tsx:
  - `src/tabLayout.ts` is pure: panes, focus, orientation and ratio;
  - `src/useTabLayout.tsx` is the hook: the layout state, tab handles, operations, and the session save.

  App keeps `tabs`, `activeTab` and `activeHandle` for the focused pane, so the handlers, menus, status bar, Inspector and terminal Follow Folder follow focus unchanged.
- **Layout:** one or two panes, each with its own tabs and shown tab. It also holds the focused pane, `row` (side by side) or `column` (top and bottom), and the divider's ratio, which can be dragged (a double-click resets it).
  - Unsplit, the tabs stay in the title bar as before.
  - Split, the title bar keeps the window controls and its drag area, and each pane gets its own tab bar above its file list. Each tab label is its folder, so the second pane needs no path bar of its own.
  - The toolbar, breadcrumb and search box follow the focused pane. Miller columns work per pane.
  - A pane whose last tab closes or moves out goes, and the window is unsplit.
- **Commands:**
  - View → Split has **Split Side by Side** (Ctrl+\\, a toggle), **Split Top and Bottom**, **Focus Other Pane** (Ctrl+F6), **Swap Panes** and **Close Split**.
  - Splitting opens the second pane on the focused pane's folder. Close Split puts the second pane's tabs after the first's, and the focused tab stays shown.
  - The Edit menu and the file context menu have **Copy to Other Pane** and **Move to Other Pane**. Both go through `performDrop`, so they get undo and conflict handling. Unsplit, the file menu hides them, and the Edit menu's say to split first.
  - The tab context menu has **Move to Other Pane**. Unsplit, it splits with that tab; it's hidden for a window's only tab.
  - Neither Ctrl+\\ nor Ctrl+F6 was bound in `keymap.ts`, the menus or the Keybindings sheet.
  - Tab/F6 pane cycling goes sidebar → first pane → second pane → terminal.
- **Tab drag inside the window** uses pointer events, like the pane's file drag (HTML5 drag and drop breaks on Windows with `dragDropEnabled`). Code: `src/tabDrag.ts` and `src/tabMoves.ts`.
  - Over a tab bar it shows an insertion mark, and the drop moves the tab there (a reorder, or into the other pane).
  - Unsplit, over the outer quarter of the file area, it previews that half, and the drop splits with the tab in the new pane.
  - Split, over the other pane's file area, the drop moves the tab there.
  - Escape cancels. Let go outside the window, the tab stays (tear-off is phase 3).
  - Dragging a window's only tab moves the window, as Chrome does.
- **Session:** the record keeps its key, and 0.2 can still read it. See `docs/decisions/2026-11-20-split-and-tear-off-session.md`.

## Files
- New:
  - `src/tabLayout.ts`, `src/useTabLayout.tsx`, `src/tabDrag.ts`, `src/tabMoves.ts`;
  - tests: `src/tabLayout.test.ts`, `src/tabDrag.dom.test.ts`, `src/useTabLayout.dom.test.tsx`.
- Changed:
  - `App.tsx`: the hook in place of the tab code, and two panes;
  - `components.tsx`: a `TabStrip` taken out of `Titlebar`;
  - also `session.ts`, `data.ts`, `keymap.ts`, `menus.tsx`, `commandState.ts`, the `handlers/` app and tab cases and `types.ts`, and CSS;
  - e2e: a `drag` action in `webdriver.mjs` and the "split view" flow in `smoke.test.mjs`.
- No Rust change.

## Tests
- vitest:
  - layout operations;
  - the session: a split's record, an old record, junk split fields, private panes;
  - drop-zone hit tests and the drag controller (happy-dom);
  - the hook: which window saves, what it saves, and a tab keeping its live state when it moves.
- e2e "split view":
  - Ctrl+\\ shows two panes, each listing;
  - Ctrl+F6 moves the focus, and the breadcrumb follows it;
  - a real pointer drag of a tab into the other pane's tab bar;
  - the tab menu's Move to Other Pane;
  - Edit → Copy to Other Pane copies a file;
  - Ctrl+\\ again closes the split.
