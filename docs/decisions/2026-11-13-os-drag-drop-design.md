# os-drag-drop: a GTK drag source of our own, a handoff at the window's edge, copies from other apps

Date: 2026-11-13. Task: `os-drag-drop` (survey-2 task 22). Status: for review by the lead; the drag out waits on the user's test on niri.

## Drag out: which code starts the native drag
**Chosen: on Linux, a GTK drag source of our own (`commands/drag_out.rs`); on Windows, the `drag` crate.**
- The `drag` crate (CrabNebula, behind `tauri-plugin-drag`) does the right thing on Windows: OLE `DoDragDrop` with `CF_HDROP`, the data Explorer offers.
- Its GTK path has two problems for us. It builds URIs as `"file://" + path` with no percent-encoding, so a name with a space, `#`, `%` or non-ASCII characters gives a broken URI. And it unwraps the cursor position inside a signal callback; the release profile has `panic = "abort"`, so a failure there would close the app.
- Ours is about 60 lines: `gtk_drag_begin_with_coordinates` on the window, offering `text/uri-list` (encoded through `url::Url::from_file_path`) and the plain paths as text, as Nautilus does. Browsers take the URIs as files; terminals type the paths.
- **Rejected: the plugin and its JS package.** It would bring the same GTK code, plus a plugin permission and an npm dependency, for one call.
- **Rejected: an HTML5 drag from the webview.** The pane's drag moved off HTML5 drag in `c7cfdba` (the harness can't drive it), and a pointer drag can't turn into an HTML5 one partway.

## When the native drag starts
**Chosen: the moment the pane's drag reaches the window's edge, with the button still down.** Under Wayland a client can only start a drag with the serial of a button press that's still held, so it can't start on release, and starting it at the press would take every drag inside the app away from the pointer-event code (and the demo).
- The edge counts as a pixel inside it (`leftWindow`), in case the webview stops reporting positions outside, and a `mouseout` with no related element counts too.
- Once handed off, the pane's drag is over: ghost and highlight go, and the drop is up to the app under the pointer.
- **Limit:** a window floating over glasshouse can't take the drag before it crosses glasshouse's edge, because the pointer is still inside glasshouse's bounds.
- **Copy only.** The drag offers no move, so no other app can delete the originals by accepting a move.

## Drops from other apps
**Chosen: always a copy, into the folder under the pointer.** Tauri's drop event carries the paths and the position, but not the keys held or the action the source offered, and a copy can't lose anything.
- Targets: a folder row, the pane outside a folder row (its folder), a tab (its folder), a breadcrumb segment, a sidebar folder. They all carry `data-drop-path`, and one resolver (`dropTargetOf`) takes the nearest.
- It goes through `performDrop`: `runTransfer`, the keep both / replace / skip question, and undo, as Paste does.
- Items already in the target folder are skipped, as in Explorer; a drop that would change nothing shows no hint.
- A drag out that comes back into the window is a drop from another app, so it copies.

## Modifiers inside the app
**Chosen: a drag moves, Ctrl (Cmd) copies, Shift moves,** as in Explorer and Nautilus. It was Shift to copy. The ghost says "move" or "copy" and follows Ctrl as it's pressed and released before the pointer moves. The cheatsheet lists the gestures.
- **Not done:** Explorer's "copy by default to another drive". A plain drag always moves, as it did before.

## Not built here
The Windows drag out is first compiled by CI's windows-latest job. Its `drag` calls were type-checked here against `x86_64-pc-windows-msvc` in a scratch crate; the Tauri calls around them are the same cross-platform API the Linux build uses.
