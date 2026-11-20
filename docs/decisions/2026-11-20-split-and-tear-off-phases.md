# split-and-tear-off: this branch is phase 1 (split view); tear-off waits for one process

Date: 2026-11-20. Task: `split-and-tear-off` (survey-3 task 50).

## What changed
The task was planned with each window as its own process, so a tab moving between windows had to cross processes. The plan sent to the lead chose:
- **Linux:** the OS drag, with a custom type (`application/x-glasshouse-tab`) and no folder URI.
- **Windows:** `WindowFromPoint` and `WM_COPYDATA`.
- **Tear-off:** a new process that gets the tab on stdin and acks with "ready".

After that, the owner asked why glasshouse does it that way when browsers don't. The backlog (survey-3, commit `93c7069`) now splits task 50 into three phases, each merged on its own:
1. split view;
2. one process with many windows;
3. tear-off, with tabs moving between windows in memory.

## Chosen
- **This branch delivers phase 1 only:**
  - split view: two panes, row or column, a tab bar on each, the focus driving the menus, toolbar, status bar and Inspector, and a draggable divider;
  - View → Split (Ctrl+\\, Ctrl+F6), Swap Panes and Close Split;
  - Copy and Move to Other Pane;
  - the tab drag inside the window: reorder, to the other pane, or to the file area's edge to split;
  - Move to Other Pane on the tab menu;
  - the split saved in the session.
- **The cross-process pieces are out,** because phase 3 does without them. Out are the `tab_*` commands, the tab transfer record (`src/tabTransfer.ts`), the history seed on a new tab, the Linux hand-off at the window's edge, "Move to New Window", and the demo's mocks for them.
- **They aren't lost.** The local branch `claude/split-and-tear-off-xproc-wip` has the full frontend as it was before the cut. It was never pushed. Phase 3 can take from it:
  - the transfer record: folder, sort, back and forward history, filter text, tag filter, private;
  - the seed that starts a tab with that history;
  - the drag controller's "hand off at the edge" and "release outside" modes.
- **Dragging a window's only tab moves the window** (`startDragging()`), as in Chrome. With nowhere else for it to go in phase 1, this is the only thing that drag can do.
- **A tab dragged out of the window and let go there stays where it was** until phase 3.

## What phase 3 still needs from the transport analysis
One process doesn't remove the need to find the window under the pointer. On Wayland, during a drag the pointer stays grabbed by the window where the press happened, and only the drag-and-drop protocol tells another window that something is over it, even another window of the same process. So on Linux the drag out of the window is still a GTK drag, but its data can be a tab id that the process looks up in memory. On Windows, `WindowFromPoint` finds the window, and no message needs to cross processes. The handlers on each WebKitWebView should act only on the app's own target and leave file drops to wry. That part of the plan still applies.
