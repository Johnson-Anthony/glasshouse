# Sidebar rows: their own targets, and file keys stay in the pane

Date: 2026-11-11 · Task: focus-and-targets

## Context
- Sidebar file rows (tree "Show files", pinned files) were treated as folders. A click said "can't read this folder".
- A tree file's context menu was `CONTEXT_FILE`. Most of its items had no case in `targetHandler`, so they fell through to `fileOpsHandler` and ran on the pane's selection. Git: Discard on a tree file discarded the pane's files.
- The sidebar folder menu's Remove Tag… and Clear All Tags did the same.
- Delete, F2 and Ctrl+C/X/V acted on the pane's selection while the sidebar had keyboard focus.

## Decision
- **A file menu of its own.** `CONTEXT_SIDEBAR_FILE` (tree files and pinned files) lists only what `targetHandler` runs on a path:
  - Open, Open in VS Code, Reveal, Copy Path / WSL Path, Rename, Move to…, Tags, Pin, Properties, Move to Trash.
  - Pinned files get Unpin and the reorder items in place of Pin.
  - Git, compress, extract and clipboard items aren't offered there. They act on a selection, and the pane has them.
- **Open on a file target** opens it with the default app. Click and Enter on a file row do the same.
  - Pin kinds come from one listing per parent folder when the pins change (`pinnedFiles`). A pin that can't be classified counts as a folder, as before.
- **Refuse instead of falling through.** With a sidebar, breadcrumb, remote or tab target set, a label `targetHandler` has no case for is consumed with an "isn't available here" toast.
  - A test runs every item of every target menu and checks that `targetHandler` takes it.
- **Keyboard commands clear the target.** A keymap command closes an open context menu and clears its target first, so a shortcut pressed while a sidebar menu is open acts on the pane as usual and isn't refused.
- **File keys don't fire from the sidebar.** Keymap bindings that act on the pane's selection are flagged `pane` and skipped while the key event's target is in the sidebar:
  - Enter, Space, Delete, F2, Ctrl+C/X/V, Ctrl+Shift+C/V/R/P/E, Ctrl+I/U, Alt+Enter, `*`.
  - App-wide keys (Ctrl+B, Ctrl+T, F5…) still work there.

## Rejected
- **Routing file keys to the sidebar's row.** Delete on a keyboard-focused tree folder would trash a whole folder from one keypress, with no selection the user built on purpose. The row's context menu has the commands.
- **Feeding the right-clicked path into the `HandlerCtx` selection,** so that `CONTEXT_FILE` items run on it. `fileOpsHandler` and the git handlers read `activeHandle.state.selected`/`entries` as well as `ctx.selectedPaths`. Faking a selection would be fragile while selection-integrity re-keys it.
