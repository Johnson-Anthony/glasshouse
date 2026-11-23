# a11y: roles, names and where the focus is

Date: 2026-11-23. Task: `a11y` (survey-3 task 38). Plan: `docs/plans/completed/a11y.md`. Code: `src/components.tsx` (FilePane, TabStrip, Toolbar, Palette), `src/dialogs/dialogPanel.ts`, `src/announce.ts`, `src/keymap.ts`, `src/App.tsx`. The contrast choices are in `2026-11-23-a11y-contrast.md`.

## Context
The file list kept the focus on its `<section>` and drew its own focused row, with no roles, so a screen reader announced nothing as the arrow keys moved. Tabs, their close marks and several links were `<span>`s and `<div>`s. Dialogs had no role, name or focus handling in common. The list renders a window of rows, split view has two panes, and one row's selection change must re-render two rows, not all of them.

## Chosen

**The file list is a `grid` in the row modes and a `listbox` in the card modes; the focus stays on the pane.**
- The pane names the focused row with `aria-activedescendant`. Moving the DOM focus to each row instead would need a focusable element per row and a focus call per arrow key, and would lose the focus whenever the window of rows moved past the focused one.
- `aria-activedescendant` is set only while the focused row is in the page. A scrolled-away row gets no id to point at, so the attribute is dropped until the row is back (the arrow keys scroll it back first, so a keyboard user never meets the gap).
- The row modes are a grid, not a listbox: the columns have headers, and a grid reads "size 4 KB" where a listbox would read a row as one string. It has `aria-rowcount` and `aria-rowindex`, because only a window of rows exists. The header is row 1 when it's shown.
- The card modes (Icons, Tiles, Grid) are a listbox of options. They render every row, so the browser counts them and `aria-setsize`/`aria-posinset` would only repeat that. If a card mode is ever windowed, it needs them. Their arrow keys are unchanged (the display-mode task adds 2-D movement).
- Row ids are `useId` plus a counter that goes up when the pane lists another folder. Two panes never share an id, and a new folder's first row is a new node, so it's announced even when its index is the same as before.
- A folder's kind is said in words ("folder"), git letters as words ("modified"), and placeholder dashes aren't read.
- **Announcements** (`announce.ts`, one polite region): "<folder>: 12 items" when another folder is listed, and "sorted by size, descending" on a re-sort. Selection counts aren't announced: the screen reader reads the row and its selected state itself.

**Column headers take the focus from the keys only.** Up from the first row, on a new press (a held Up stops at the first row), goes to the sorted column's header; Left/Right/Home/End move; Enter or Space sorts; Down or Escape goes back. A mouse press on a header sorts and leaves the focus on the pane. Tab wasn't available: it moves between the panes (below).

**Each tab bar is a `tablist`; the tab is the label and the close control is a button beside it.** A `tab`'s children are presentational to assistive technology, so a button inside the tab would not exist for a screen reader. The tablist wrapper is `display: contents`, so the bar's layout and tab dragging's geometry are as before. Tabs use a roving `tabIndex` and Left/Right/Home/End, which select as they move (a tab's content is already loaded, so there's nothing to wait for). `data-tab-bar`, `data-tab-index`, `.label`, `.close` and `.tab-btn` keep their places for `tabDrag.ts` and the e2e suite, so no e2e selector changed.

**One hook for every dialog: `useDialogPanel(name)`.** A hook that returns props, not a wrapper component, because the dialogs' panels differ (classes, sizes, their own refs and handlers) and a wrapper would have meant moving each one's markup.
- It gives `role` (`alertdialog` for alert, confirm and choice, whose message is the description), `aria-modal`, the name, the focus moved in on opening (a dialog's own autofocus still wins, as it runs afterwards), Tab kept inside the topmost panel, and the focus given back on close.
- The work hangs off the element's ref, not an effect, so it runs when the panel enters and leaves the page whether or not the component stays mounted, and before the dialog's own effects.
- Focus that lands behind the dialog comes back to the control that had it. A dialog that closes under one it opened hands that one its place, so the focus still ends up where it started.
- The palette uses it too: it gave the focus back to nothing before.
- Toasts go into a `role="status"` region that's always in the page (a live region added together with its first message is often not read).

**Enter and Space on a focused control are that control's.** The keymap's Enter (open) and Space (Quick Look) are `unlessHandled`; `findBinding` now also skips those when the event's target is a button, link, tab or column header. Otherwise Enter on a focused breadcrumb button would both go to that folder and open the selected file.

**A mouse press on a tab or a toolbar button doesn't take the focus.** Now that they're real buttons and tabs, a click would move the focus onto them and the arrow keys would stop moving through the files. The press's default is prevented, as a native toolbar does; the keyboard reaches them through the tablist's keys and the menus.

**The active file pane has the focus when the window opens, and after a split.** Nothing focused the pane until a click or Tab, so the first arrow key did nothing and a screen reader started on the page itself. A split, and closing one, rebuild the panes' elements and dropped the focus the same way. Found with the accessibility tree check; the first row now shows its focus outline from the start.

**Ctrl+\\ also matches the physical key.** On layouts that type `\` with AltGr (German, Nordic), Ctrl+AltGr+ß never reaches the app as Ctrl+\\. The binding also takes `code === "Backslash"` with Ctrl, which is the key beside Enter or left of it on those keyboards (`#` or `'`).

## Not chosen
- **Tab between controls.** Tab and F6 still move between the sidebar, the file lists and the terminal, by the spec's choice (Task #18). So the toolbar's, the Inspector's and the status bar's buttons are real and named but aren't Tab stops; their commands are in the menus, the palette and the keymap. Changing that is the owner's call and its own task.
- **The sidebar as a `tree`, Miller's outer columns, the terminal.** Outside this task's section; listed in the plan's follow-ups.

## Checked with
- happy-dom tests: `src/FilePane.a11y.dom.test.tsx`, `src/a11y.dom.test.tsx`, `src/keymap.test.ts`.
- `pnpm site:capture a11y`: the accessibility tree headless Chromium (156) builds for the demo, read over the DevTools protocol. It's the engine WebView2 uses, so it stands in for Windows' tree.
- WebKitGTK's AT-SPI tree, read once by hand (the plan's Checks has what it showed). The recipe, for whoever turns it into a script in the repo:
  - a viewer process: a `WebKit2` 4.1 web view (PyGObject) on the demo served from `docs/` at `/glasshouse/`, which sends keys as `keydown` events on the focused element once the page has loaded;
  - a reader process: `gi.repository.Atspi`, walking from the desktop to the viewer's frame (a client can't read its own tree), printing each node's role, name, description, states, attributes and Text-interface text, since WebKitGTK gives a cell's content as text, not as a name;
  - around both: `dbus-run-session --config-file=…` with a bus config whose only service is a copy of `org.a11y.Bus.service` (so no portal, gvfs or keyring starts), `org.a11y.Status`'s `IsEnabled` and `ScreenReaderEnabled` set to true before the viewer starts, `xvfb-run`, `GSETTINGS_BACKEND=memory`, and scratch `HOME` and `XDG_*` folders. `XDG_RUNTIME_DIR` needs a short path, because the accessibility bus's socket lives under it and socket paths are capped near 108 bytes.
- Real screen readers are hand checks (`docs/testing/linux.md` L16, `windows.md` W17).
