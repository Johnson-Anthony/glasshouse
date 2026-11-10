# Shortcut hints: bind them, or drop them

**Decision (shortcut-hints, 2026-11-10).** Every shortcut a menu or the palette shows now runs that item's command. `keymap.test.ts` checks all of them, the palette's included, so `KNOWN_GAPS` is gone.

## Bound
- **Ctrl+Q → Quit, not while typing.** The terminal drawer counts as a text field, and Ctrl+Q belongs to the program running there (XON, emacs quoted-insert). Quitting from a text field takes Escape first; that's the cost of not closing the app from a shell.
- **Ctrl+Shift+C → Copy Path, with a selection, not while typing.**
  - "Copy Path" copies the selected item's path and does nothing without one, so without a selection the key goes to the browser.
  - Not while typing, so Ctrl+Shift+C stays copy in the terminal.
- **`*` → Select by Pattern…, not while typing.** Shift is ignored, so Shift+8 (where `*` usually is) and the keypad `*` both work.
- **Ctrl+Shift+` → New Terminal Tab, also while typing** (like Ctrl+`, which toggles the drawer). It also matches `~`, which is what Shift+` produces on US layouts. Ctrl+` no longer ignores Shift, so the two keys don't overlap.
- **Ctrl+Shift+H → Find & Replace in Files, not while typing.** The hint used to say Ctrl+Shift+F, which is Find in Files. Ctrl+Shift+H is free here and is VS Code's "Replace in Files".

## Not bound
- **Esc → Deselect already worked.** The file pane's own key handler clears the selection on Escape when the list has focus. It was a false gap, listed under "handled elsewhere" in the test like Ctrl+A.
- **"Open in Terminal" lost its Ctrl+` hint** (File menu and palette). Ctrl+` is the built-in terminal drawer. The external terminal gets no key: the common candidates are taken (Ctrl+Alt+T opens a terminal at the desktop level on many Linux desktops) or would be arbitrary.

## Rejected
- **Ctrl+Q while typing:** it would close the app from inside the terminal drawer.
- **Esc → Deselect in the window keymap:** Escape there would also clear the selection when it closes Quick Look, the palette or a dialog. Keeping it in the focused file pane limits it to the list.
