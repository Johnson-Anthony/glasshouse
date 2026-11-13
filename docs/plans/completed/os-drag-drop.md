# os-drag-drop

Branch: `claude/cool-satoshi-4102fc`. Task 22 of the second survey: drag and drop with other apps. Both frontend and Rust.
Scope: `## 22. os-drag-drop` in `docs/plans/active/survey-2.md`, plus the lead's notes (2026-11-13). What the user wants most is dragging files out into a browser upload field (LibreWolf) and a terminal, on niri (Wayland).

## Problems
- The pane's drag uses pointer events, so it never leaves the window, and there's no native drag source.
- Nothing listens for OS drops (`dragDropEnabled` is on), so files dragged in from other apps do nothing.
- Shift+drag copies; Explorer and Nautilus use Ctrl to copy and Shift to move.
- Only folder rows and sidebar rows take drops; tabs and breadcrumbs don't.

## Approach
1. **Drag out (spike first).** The internal drag hands off to a native one when the pointer leaves the window with the button still held. Under Wayland that's when a drag can still start: the compositor checks the serial of the button press that's still down.
   - New command `start_drag_out(paths)` in `commands/drag_out.rs`, in the `launch` permission group. It checks that every path is absolute and exists.
   - Linux: our own GTK drag source on the window (`gtk_drag_begin_with_coordinates`, run on the main thread), offering `text/uri-list` (percent-encoded `file://` URIs) and plain-text paths, copy only. Not the `drag` crate: its GTK code builds URIs without percent-encoding (a space or `#` breaks them), and unwraps inside a callback, which aborts a release build.
   - Windows: the `drag` crate's OLE `DoDragDrop` with `CF_HDROP`, the same path `tauri-plugin-drag` uses.
   - The frontend tears down the internal drag (ghost, highlight) at the handoff.
2. **Drag in.** `onDragDropEvent` on the webview: while a drag is over the window, highlight the target under the pointer and show "copy to <folder>"; on drop, copy into it through `performDrop` (`runTransfer`, the conflict dialog, undo), as Paste does. Targets: a folder row, the pane's background (the current folder), a tab (its folder), a breadcrumb segment, a sidebar row. Items already in the target folder are skipped.
3. **Modifiers.** Inside the app: plain drag moves, Ctrl copies, Shift moves. The ghost shows the operation and follows Ctrl as it's pressed and released mid-drag. Drops from other apps always copy: Tauri's drop event doesn't carry the keys or the source's action, and copy can't lose anything.
4. **Drop targets.** Tabs and breadcrumbs take internal drops too, through one `data-drop-path` resolver shared with the sidebar.

## Tests
- vitest: the drop-target resolver, the modifier → operation mapping, the "already there" filter, the handoff decision (pointer outside the window).
- Rust: `start_drag_out`'s argument checks; the URI and text payloads for odd names (space, `#`, `%`, non-ASCII).
- By hand (the user, on the release build): drag out into LibreWolf's upload field and a terminal; drag in from LibreWolf's downloads or another file manager.
- The demo can't do OS drags; its internal drag checks must still pass.

## Status
Done; handed to the lead to merge.
- [x] Spike: drag out on Linux, release build (d79d022), test steps to the lead.
- [x] Drag in
- [x] Modifiers, ghost label, cheatsheet
- [x] Tabs and breadcrumbs as drop targets
- [x] Windows drag out (`drag` crate): its calls type-check against `x86_64-pc-windows-msvc` in a scratch crate; the full build is CI's
- [x] Checks at d79d022: `pnpm build`, `pnpm test` (547 passed), `pnpm check:wiring`, `pnpm notices --check` (regenerated: 423 crates), clippy `-D warnings`, `cargo test` (206 passed, 5 ignored), `pnpm site:build`, `pnpm site:capture check` (23 of 23, capped)
- [x] The lead's review: a drag that overshoots to the titlebar's edge and comes back now moves, as the in-app drag would (`recordHandOff`, dbabe65). Checks after it: `pnpm build`, `pnpm test` (553 passed), `pnpm check:wiring`, `pnpm notices --check`, `pnpm site:build`, `pnpm site:capture check` (23 of 23). Release binary rebuilt at 01:55.
- [x] **Drag out confirmed by the user on niri (Wayland)** with the 01:55 build: "it seemed to be working". The test steps covered LibreWolf's upload field and kitty; which targets they used isn't reported yet. The lead's stderr log: 8 drags started, 7 ended cleanly, 1 logged `drag-failed` (GTK3 on Wayland reports a refused drop that way, most likely a drop on something that doesn't take files).
- [x] The `drag-end` log line no longer prints the action: it was always COPY, the only one offered, even after a failed drop. Now the lines are `started with N item(s)`, `failed (…)` and `ended`; only a `failed` line before `ended` means the drop didn't take. Clippy `-D warnings` and `cargo test` (206 passed, 5 ignored) after it.
- [x] The user's second round: drag in from LibreWolf works. A Ctrl+drag into the rows' own folder (the pane, its tab or breadcrumb) said "copy" and did nothing; it now makes duplicates, as Copy then Paste there does (`dropPaths`). The click after a drop no longer flips the selection of the row it started from. Checks after it are in the commit message and the report to the lead.
- [ ] **Not yet tested by hand:** drops on tabs and breadcrumbs from another folder, and the overshoot return. The vitest tests cover their logic.

Decisions: `docs/decisions/2026-11-13-os-drag-drop-design.md`.
