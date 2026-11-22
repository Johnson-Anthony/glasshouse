# cross-window-file-drag

Branch: `claude/cross-window-file-drag`, from `main` at 1df894b.
The owner reported on 2026-11-22: a file dragged from one glasshouse window to another is copied, while the same drag inside one window moves it. This also fixes the stuck button after a drag-out, the follow-up from task 50 phase 3.

## Status
Done 2026-11-22. Everything in the plan, plus two problems the hand tests found in the same path (see Findings).
- **Checks:**
  - `pnpm build`;
  - `pnpm test`: 87 files, 1221 passed, 2 skipped;
  - `pnpm check:wiring`;
  - `pnpm notices --check`;
  - clippy with `-D warnings`;
  - `cargo test`: 419 passed, 5 ignored;
  - `pnpm site:build` (docs/demo rebuilt) and `pnpm site:capture check`;
  - `pnpm e2e`: 11 of 11 passed.
- **By hand under Xvfb with xdotool** (two windows in one debug process on a private bus; a PyGObject window as the other app):
  - A to B moves, onto B's folder row and onto its pane, with the hint "move …". Both lists update.
  - Ctrl held at the handoff copies ("copy …"; the original stays).
  - Out of A's top edge and back onto A's folder moves.
  - The other app's file dropped on B copies. That includes the lead's case: A to B dropped on B's sidebar heading (nothing), then the same file from the other app onto B copies.
  - Ctrl+Z in B undoes the move ("undid: move 1 item(s)"), and A's list shows the file again.
  - After a drag out, the next drag in A starts and drops on the first try.
  - Escape and a drop on nothing each let the record go once.
  - The page asks after the end: the backend log showed the drop kept for B, then the end, then B's question answered from what was kept.
- **Not built or run:**
  - the Windows module (CI's windows-latest is its first compile; its new lines are Tauri calls the Linux build compiles);
  - Wayland (the nested niri can't complete a drag between clients);
  - WebView2's Ctrl state at the edge and the stuck-button question there (W8.16, W8.17).
- **Decision:** `docs/decisions/2026-11-22-cross-window-file-drag.md`. The 2026-11-13 os-drag-drop decision is marked superseded in part.

## Findings from the hand tests
- **Stuck button, confirmed under Xvfb** with the old build. After a drag from A to B, two drags in a row in A did nothing, until a plain click.
- **The release alone wasn't enough.** With it, the next drag started but never got its release.
  - The drag out had left a text selection (the inspector's "no selection"). A press on it started WebKit's own drag of the text.
  - Fixed with tear-off's `keepSelection`, moved from `tabDrag.ts` to `dragDrop.ts` and called on the pane's row press too (`components.tsx`).
- **Ctrl at the handoff never counted** (old and new). WebKit's `pointermove` that crosses the edge comes from the pointer leaving, and has no keys.
  - The pane's drag now keeps Ctrl as the ghost last showed it (`components.tsx`), and the handoff counts it.
  - FilePane test added.
- **Not fixed (pre-existing; for the lead):** under Xvfb with no window manager, a window flush against the screen's edge didn't hand off past that edge. A pointer at x=0 or y=0 never reached the page's handoff. It's likely tao's resize border on undecorated windows. A maximized window's top edge may behave the same on a real desktop; that wasn't checked.

## Cause (confirmed by reading the code)
- At the window's edge the pane's drag goes to the OS (`commands/drag_out.rs`): a GTK drag offering COPY on Linux, OLE `DoDragDrop` through the `drag` crate on Windows.
- `recordHandOff` in `src/dragDrop.ts` remembers the paths and the Ctrl state, and `osDropPlan` in `OsDrop.tsx` treats an OS drop of exactly those paths as the pane's own drag. That record is a module variable in the source window's page. Every window is in one process, but each has its own page, so the other window sees a drop from another app, which always copies.

## Design
- **The record goes to the backend** (`drag_out.rs`, managed state `DragOuts`): set by `start_drag_out(paths, copy)` before the OS drag begins, and cleared when it ends. On Linux that's `drag-end` (and `drag-failed`) on the source; on Windows it's `DoDragDrop` returning. If the drag doesn't start, the record is cleared at once. A new drag replaces a record whose end never came. A record belongs to one drag, by id.
- **Ordering.** The page hears the drop through an event, so its question comes after the drag has ended, and a plain lookup would race the clear. So the backend notes the verdict when the drop reaches Rust: `WindowEvent::DragDrop(Drop)` in the run loop (`app_windows::on_window_event`) puts "window L got these paths, copy or move" in a per-window slot while the record is live. The end clears the record through `run_on_main_thread` from a worker thread. That goes through the event loop's queue after the drop's message, which wry posted before the source could hear the end (it finishes the drop first, then posts the event). So the verdict is always noted first.
- **The page asks** `drag_out_own(paths, drop)`:
  - on `enter`, for the hint: whether the live record has these paths and copies;
  - on `drop`, it takes the window's slot.
  - The answer is `null` for anything else: a drop from another app copies as before.
  - Paths are compared in Rust. On Windows they're canonicalized too, because the `drag` crate offers `dunce::canonicalize`d paths.
- The drop still goes through `osDropPlan` and `performDrop`, so the hint, undo, conflict questions, tags and Ctrl's duplicates work as they do now. The target window's `performDrop` refreshes its own panes, and the source window's watcher sees the change.
- **Page-side record removed:** `recordHandOff`, `clearHandOff`, `handOffCopies`, `HANDOFF_GRACE_MS`, and the blur, pointerdown and grace-timer clearing. The backend has exact begin and end, so focus moving to the target window can't clear anything. The same-window overshoot goes through the same slot.
- **Stuck button (Linux):**
  - First, confirm under Xvfb that a file drag-out leaves the next drag in that window not starting.
  - `gtk_dnd::release` becomes `pub(crate)`, and `drag_out` calls it on the source webview at `drag-end`. `begin` gets the webview through `with_webview`, as tear-off does.
  - The source page swallows clicks from the handoff until `drag-out-end`, a new event to the source window, or the next press, as `tabMoves.ts` does.
- **Windows:** the clear runs after `DoDragDrop` returns, through the same deferred path. WebView2 hears `WM_CAPTURECHANGED` when OLE takes the mouse, so a stuck button isn't expected there; that goes in the checklist and isn't built.
- Other apps still get COPY only.

## Files
- `src-tauri/src/commands/drag_out.rs`: the state, `copy` arg, verdict, deferred end, release, `drag-out-end`, tests.
- `src-tauri/src/tab_drag.rs`, `tab_drag/gtk_dnd.rs`: `release` shared (`pub(crate)`).
- `src-tauri/src/app_windows.rs`: the drop goes to `drag_out::dropped`; `forget` clears the slot.
- `src-tauri/src/lib.rs`: manage the state, register `drag_out_own`. `permissions/app.toml`: the `launch` group.
- `src/api.ts`: `startDragOut(paths, copy)`, `dragOutOwn`.
- `src/dragDrop.ts`: the page record goes.
- `src/OsDrop.tsx`: ask the backend on enter and drop.
- `src/App.tsx`: `onDragOut` passes `copy`, and swallows clicks until `drag-out-end`.
- `src/components.tsx`, `src/tabDrag.ts` (added after the hand tests): `keepSelection` shared, and Ctrl at the handoff.
- Tests: `src/dragDrop.test.ts` and an OsDrop DOM test; `drag_out.rs` tests.
- Docs: `docs/decisions/2026-11-22-cross-window-file-drag.md`, a successor note to the 2026-11-13 os-drag-drop decision; `docs/testing/windows.md` (W8) and `linux.md` (L9); `docs/ARCHITECTURE.md` rows.

## Tests
- vitest: the drop plan with a backend answer from the same window, from another window (a move, or a copy with Ctrl at the handoff), and with none (another app copies). OsDrop asks on enter and on drop, and shows the hint from the answer.
- cargo: the record is set by start and cleared on every ending: dropped on a glasshouse window, on another app, on nothing (`drag-failed`), Escape, a drag that didn't start, a new drag first, the source window gone. The verdict is taken once, and a slot left from an earlier drag doesn't answer for a later drop from another app.
- By hand under Xvfb (xdotool):
  - A to B moves;
  - Ctrl at the handoff copies;
  - out and back into the same window moves;
  - a drop from a non-glasshouse app copies;
  - Ctrl+Z in B undoes the move;
  - both windows refresh;
  - after a drag-out, the next drag starts on the first try.
- The usual checks, `pnpm e2e` included.
