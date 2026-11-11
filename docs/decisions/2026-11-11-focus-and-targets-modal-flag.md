# Modal dialogs own the keyboard: a held flag with a deferred release

Date: 2026-11-11 · Task: focus-and-targets

## Context
Neither App's window keydown listener nor the file pane's key handler knew when a dialog was open. Enter in a confirm, or in the Folder Picker, also ran the keymap's "Open" on the pane's selection; in Move to…, Enter moved the item and then navigated the pane. Delete, F2 and the rest acted behind any dialog that left focus on the pane.

## Decision
- `src/dialogs/modal.ts`: `useModal(active)` holds a module-level count, and `isModalOpen()` reads it.
  - Every overlay dialog calls it: DialogHost while a dialog shows, the 13 dialogs in `src/dialogs/`, Notices, and App's FindInFilesModal.
  - The palette, Quick Look, the context menu and Tweaks don't. Their own shortcuts toggle them, and the palette's text field already blocks file keys.
- The keymap (`findBinding`'s `modal`), App's pane cycling and git chord, and the FilePane, Miller and Sidebar key handlers all do nothing while it's set.
- **The release is deferred to a later task** (`setTimeout(0)`).
  - The key that closes a dialog makes React flush the close in a microtask. That microtask runs between two window listeners of the same keypress, and with discrete events it includes the effect cleanup.
  - A synchronous release would let App's listener, if it runs after the dialog's, see no modal and act on that same Enter.
- DialogHost autofocuses the primary button of an alert, confirm or choice, which takes focus off the pane. Focus goes back to its previous owner on close.
  - Enter on a focused button in the dialog activates that button, so Tab to "cancel" then Enter now cancels. It used to confirm.
- **Keybindings cheatsheet:** it closes itself on F1 / Ctrl+?, since App's toggle no longer runs over it.
- **Find in Files:** Ctrl+Shift+F no longer closes it; Esc does.

## Rejected
- **Capture-phase key ownership**, where each dialog stops propagation at window capture. This needs every dialog's key code rewritten, and still needs a flag for keys a dialog doesn't handle (Delete behind a confirm).
- **A DOM query for an `[aria-modal]` element.** It has the same microtask race, because the DOM updates in that flush too, and it can't be tested without a DOM.
- **Checking `e.defaultPrevented` for every binding.** That depends on listener order, which changes whenever App's listener re-registers.
