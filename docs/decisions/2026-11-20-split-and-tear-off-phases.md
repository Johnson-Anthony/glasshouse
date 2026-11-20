# split-and-tear-off: three phases; phase 1 is split view

Date: 2026-11-20. Task: `split-and-tear-off` (survey-3 task 50). Open: phases 2 and 3 add their own decisions here or in successor notes.

## The phases
The owner asked why glasshouse moves tabs between windows the way it was planned, when browsers don't. Since then, glasshouse is moving to one process with many windows, as browsers do (survey-3, commit `93c7069`). Task 50 is three phases, each handed off and merged on its own:
1. **Split view** (this branch, frontend only).
2. **One process, many windows.** New Window, the command line, a second launch and the FileManager1 resident open windows in the running app. Backend events are scoped per window, and the session saves every window. The design goes to the lead before building.
3. **Tear-off, in that one process.** A tab moves to a new window or another window's tab bar in memory, and there's Move to New Window.

## Phase 1, as built
- Split view:
  - two panes, side by side or top and bottom, each with its own tab bar;
  - the focus drives the menus, toolbar, status bar, Inspector and Follow Folder;
  - a draggable divider.
- View → Split: Ctrl+\\, Split Top and Bottom, Focus Other Pane (Ctrl+F6), Swap Panes and Close Split.
- Copy and Move to Other Pane.
- The tab drag inside the window: reorder, into the other pane, or to the file area's edge to split. Move to Other Pane on the tab menu.
- The split saved in the session (`2026-11-20-split-and-tear-off-session.md`).
- Dragging a window's only tab moves the window (`startDragging()`), as in Chrome. A tab let go outside the window stays where it was until phase 3.
- The tab transfer record (`src/tabTransfer.ts`: folder, sort, back and forward history, filter text, tag filter, private) is kept for phase 3. Duplicate Tab uses it now, so a duplicate keeps its history and filters as a browser's does.
- No cross-window code is in phase 1.

## Considered and dropped: moving tabs between processes
The first design kept a process per window, so a tab had to cross processes:
- **Linux:** a GTK drag carrying the tab as JSON.
- **Windows:** `WM_COPYDATA` to the window under the cursor.
- **Tear-off:** a new `glasshouse --tab` process given the tab on stdin, which acked with "ready". Stdin rather than the command line, because `/proc/<pid>/cmdline` is world-readable and a private tab's folder shouldn't show in `ps`.

It was dropped with the move to one process. The frontend as it stood then is on the local branch `claude/split-and-tear-off-xproc-wip`, never pushed. From it, phase 3 can take the drag controller's "hand off at the window's edge" and "release outside" modes.

**What still holds in one process: the Wayland pointer grab.** On Wayland, during a drag the pointer stays grabbed by the window where the button went down. The app gets no motion events for its other windows, and it can't learn their positions. Only the drag-and-drop protocol tells another window that something is over it, even another window of the same process. So phase 3 still needs an OS drag on Linux:
- a GTK drag with one custom target, `application/x-glasshouse-tab`, with no folder URI next to it, so no other app takes it;
- every window's WebKitWebView handles `drag-motion`, `drag-drop` and `drag-data-received` for that target only, and leaves file drops to wry;
- the tab-bar rectangles are registered with the backend, so `drag-motion` can answer at once;
- `drag-failed` with `NO_TARGET` means a new window; `USER_CANCELLED` means nothing happens. Whether Wayland compositors report these two apart still has to be checked in nested niri.

The drag's data becomes a window id and a tab id, and the tab itself moves in memory. GTK speaks XDND on X11 through the same calls.

On Windows the source can find the target itself: `WindowFromPoint`, then its root window, checked against the app's own windows, then an in-process move. No message crosses processes.
