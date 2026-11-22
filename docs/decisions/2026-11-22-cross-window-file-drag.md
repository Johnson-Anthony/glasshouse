# cross-window-file-drag: the drag out held by the backend, for every window

Date: 2026-11-22. Task: `cross-window-file-drag`. Plan: `docs/plans/completed/cross-window-file-drag.md`. Code: `src-tauri/src/commands/drag_out.rs`, `src-tauri/src/app_windows.rs` (the drop hook), `src/OsDrop.tsx`, `src/dragDrop.ts`. A successor to `2026-11-13-os-drag-drop-design.md` for a drag that comes back to glasshouse; what other apps get is unchanged.

## Context
The owner reported that a file dragged from one folder to another inside a window moves, but the same drag from one window to another copies.
- A pane's drag that crosses the window's edge is handed to the OS (`start_drag_out`): a GTK drag offering COPY on Linux, OLE `DoDragDrop` on Windows.
- So that the drag could be recognized when it came back, the source page kept a record of it (`recordHandOff`), and `osDropPlan` treated a drop of exactly those paths as the pane's own: a move, or a copy with Ctrl held at the handoff.
- That record was a module variable in one page. Since task 50 phase 2 every window is in one process, but each has its own page. The other window took the drop as one from another app, which always copies.

## Chosen
**The backend holds the drag for exactly as long as the OS has it, for every window.**
- **Start:** `start_drag_out(paths, copy)` stores the record before the OS drag begins. That's the paths (canonicalized and sorted), the Ctrl state, the source window and an id.
- **End:** it's cleared when the drag ends: GTK's `drag-end` or `drag-failed` on the source on Linux, and `DoDragDrop` returning on Windows.
  - A drag that doesn't start is cleared at once.
  - A new drag replaces one whose end never came, and a late end of an older id is ignored.
  - The source window closing or reloading clears it too.
- **Matching:** a drop whose paths are exactly the record's set (any order) is the pane's drag. It goes through `osDropPlan` and `performDrop` as before, so these all work as inside a window:
  - the hint ("move …" or "copy …");
  - undo in the window that took the drop;
  - the keep both / replace / skip question;
  - tags following the files;
  - a Ctrl drop into the files' own folder making duplicates.
- **Paths are compared canonicalized** (`dunce::canonicalize`), because the `drag` crate offers canonical paths on Windows.

**The drop's answer is noted when the drop reaches the backend, before the page asks.** The page hears of a drop through an event and asks afterwards, and by then the drag has ended. A plain lookup would race the clear.
- The run loop's `WindowEvent::DragDrop(Drop)` reaches `app_windows::on_window_event` before the page's event. Through `drag_out::dropped`, it keeps "window L got the drag, copy or move" for that window.
- The end lets the record go through `run_on_main_thread`, called from a worker thread. That puts it in the event loop's queue, behind the drop's message.
  - wry finishes the drop (GTK's `drop_finish`, the target's `IDropTarget::Drop`) and then posts it, all before the source can hear the end.
  - So the drop is always noted first, on X11, Wayland and Windows.
- **The page asks `drag_out_own(paths, drop)`:**
  - as the drag comes in, for the hint, against the live record;
  - at the drop, which takes what was kept for its window.
  - A drop from another app gets null and copies, as before.
- **A kept answer can never turn a later drop from another app into a move.** The page asks at every drop, including one that lands on nothing or that it refuses, which takes the answer whether or not it's used. A kept answer is used only if its paths equal the drop's. A new drag clears every window's, and so does the window closing or reloading.
- **The page-side record is gone:** `recordHandOff`, its one-second grace timer, and the clearing on blur and on a press. With an exact end, focus moving to the target window can't clear anything, and nothing outlives the drag. The same-window overshoot uses the same path as another window.
- **Rejected: the backend emitting the verdict to the page.** That would depend on Tauri delivering two events in order. The page's question has no ordering to depend on.
- **Rejected: keeping the record a while after the end.** That's the grace-timer problem again: a later drop of the same files from another app inside the window would count as the drag.

**Rules as inside a window.** A plain drag moves and Ctrl copies, whichever window or drive the drop is on. Folders on another drive or filesystem move too, as `performDrop` does inside a window (`runTransfer`, the backend's copy-then-delete across devices). The window that takes the drop refreshes its panes. The source window's watcher sees the files go. Ctrl+Z in the target window undoes the move.

**The stuck button after a drag out (Linux).** Tear-off found this, and the file drag-out had it too.
- **The problem:** the press that began the OS drag went to WebKit, but its release went to the drag. So the next drag in that window didn't start. Under Xvfb, two drags in a row failed after a drag-out, until a plain click.
- **The fix:** `drag-end` now hands the source webview a synthetic button-1 release. It's `tab_drag::release`, the tear-off helper, shared and not copied. `begin` gets the webview through `with_webview`, as tear-off does.
- **The stray click:** the source window hears `drag-out-end`, and its page swallows clicks from the handoff until then, or until the next press (`swallowHandOffClicks`, as `tabMoves.ts` does for tabs).
- **The release alone wasn't enough.** With it in place, the next drag started but never ended: its release never reached the page.
  - The drag out had left a text selection, which had grown from the press to the inspector's "no selection" as the pointer left the window. Tear-off found the same for tabs.
  - A press on that selection started WebKit's own drag of the text, which took the release.
  - The tab drag's `keepSelection` (no selection starts from the press until it ends, and one the drag made is dropped at the release) moved to `dragDrop.ts`, and the pane's row press calls it too.
- **Windows:** `DoDragDrop` takes the mouse capture, and WebView2 hears it go (`WM_CAPTURECHANGED`), so a stuck button isn't expected there. It's checklist item W8.17; it wasn't built here.

**Ctrl at the handoff.** Under Xvfb, a drag that left the window with Ctrl held still moved. That was the old record's behavior too; the overshoot with Ctrl had never been hand-tested.
- **The cause:** in WebKit, the `pointermove` that crosses the window's edge comes from the pointer leaving, and has `ctrlKey` false. A real move with Ctrl follows it, but the handoff had already happened.
- **The fix:** the pane's drag keeps Ctrl as the ghost last showed it, from moves inside the window and from key presses. The handoff counts Ctrl if either that state or the crossing event has it.

**Unchanged:** other apps are offered COPY only, so none can delete the originals by accepting a move.

## Not built here
- The Windows module (`DoDragDrop` returning, then the deferred end) is first compiled by CI's windows-latest job. Its new lines are the Tauri calls the Linux module compiles with (`app_handle`, `run_on_main_thread`).
- The Wayland ordering follows from the protocol: the source hears `dnd_finished` only after the target's `finish`. It wasn't run, because the nested niri can't complete a drag between two clients (see the tear-off decision).
