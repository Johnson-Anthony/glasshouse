# Keyboard menus and type-ahead: the choices

Task: keyboard-menus (survey-2 §19), 2026-11-13.

## Context
`menus.tsx` had no key handling: highlight was CSS `:hover`, a click on a menubar title moved focus to `<body>` (so the pane lost its arrow keys after a menu command), and nothing opened a menu from the keyboard. The menubar underlined each title's first letter, but nothing used them, and Go/Git and Tools/Terminal shared letters. The file list had no type-ahead.

## Decisions
**One highlight, moved by keys and pointer.** A menu's state is a path of highlighted indexes, one per open level (`menuNav.ts`, pure and tested). Hover sets the same path, so the keys carry on from where the pointer was, and `:hover` styles became `.hover`. A side effect: the last item the pointer crossed stays highlighted when the pointer leaves the menu, as in GTK.
- ↑/↓ wrap and skip separators and headings; Home/End; a letter jumps to the next item starting with it (a branch's `*` mark is ignored).
- → or Enter/Space on a submenu opens it on its first item; ← or Esc closes it. A submenu the pointer opened has nothing highlighted, and until → or Enter goes in, keys move in the menu it hangs from (Windows and GTK do this).
- At the top level, ← and → on a command move to the neighbouring menubar menu, open on its first item; Esc goes back to the title, and a second Esc leaves.

**The menubar.** Alt pressed and released alone, or F10, highlights the first title without opening it (the Windows convention); pressed again, it leaves. ← and → move between titles; ↓, Enter or Space open one (↑ opens it on its last item); a mnemonic letter opens its menu, and Alt+mnemonic does so from anywhere.
- An Alt press doesn't count as a tap if another key, a click, the wheel or a window switch came between (Alt+Shift layout switching, Alt+click, Alt+Tab).
- **Mnemonics are unique:** each title gets its first letter no earlier title took, so Git is G*i*t and Terminal Te*r*minal (`mnemonics()`); the underline follows.
- None of this fires behind a modal dialog, in the palette, in an open context menu, or in the terminal, whose shell owns F10 (Midnight Commander quits with it) and Alt+letters (readline's word motions). Text fields aren't excluded: Alt or F10 there opens the menubar, and Esc returns to the field, as on Windows.

**Menus own the keyboard while open.** The context menu and the active menubar take focus and stop every key from reaching the pane and App's shortcuts (Delete, Ctrl+C…), like a native menu. Tab closes them.

**Focus goes back where it was.**
- Each menu notes what had focus when it opened and gives it back when it closes, unless focus has already moved out of the menu: a command that focuses a field (Find) or opens a dialog (Rename's prompt) keeps it.
- A press on the menubar no longer takes focus from the pane (`preventDefault` on mousedown); the menubar takes focus itself and gives it back.
- The context menu gives focus back in a passive effect's cleanup, after the commit that removes it. React ignores focus events during a commit, so a layout-effect cleanup moved DOM focus without running the pane's `onFocus`, and the pane didn't draw its focused row (found in the demo).

**Menu key / Shift+F10 in the file list.**
- With a selection, it opens the file menu for the selection, under the focused row, which is scrolled into view first (when the focused row isn't selected, the menu still acts on the selection).
- With nothing selected, Esc having cleared it, it opens the empty-pane menu (New, Paste…) at the top of the list. A focused but deselected row doesn't select itself the way a right-click does, because the keyboard has no other way to reach the empty-pane menu in a folder with files.
- `onContext` now takes a point (`MenuAnchor`) rather than a mouse event, with a `keyboard` flag that starts the menu on its first item. The context menu swallows a `contextmenu` event inside itself, in case the platform sends the Menu key's own one after the menu has focus (Windows does so on key up).

**Type-ahead in the file list.**
- Printable keys build a prefix, which resets after 1 s without a key, as in Explorer. Focus and selection go to the next name starting with it: whole names with their extension, ignoring case and accents (`Intl.Collator`, base sensitivity).
- One letter typed again and again cycles through the names starting with it, as in Explorer, so `aa` can't reach "aardvark".
- **Keys left to the keymap:** whatever `KEYMAP` binds without Ctrl or Alt, computed (`BOUND_CHARS` = `/`, `*`, Space), so a future single-key binding stays safe. Space only continues a prefix already started, and is Quick Look otherwise. Ctrl, Alt and ⌘ combinations are skipped, except AltGr (Ctrl+Alt+AltGraph on Windows), which types characters.
- It runs in the pane's own key handler, so it never sees text fields, dialogs (also checked with `isModalOpen`) or the terminal. Miller is left alone: its h/j/k/l move the cursor.

**The git chord.** Ctrl+G's pending state moved from App's ref to `keymap.ts` (`gitChord`, `chordPending()`). The pane's handler runs before App's window listener, and it now leaves every key to App while a chord waits. Without that, Ctrl+G then S would have jumped to an "s…" file and staged it. It also fixes an older case: Ctrl+G then Delete trashed the selection from a focused pane, although the chord is meant to swallow a wrong second key.

## Limits
- The Menu key works in the file list only, not in the sidebar, tabs, breadcrumbs or Miller (Miller has no context menu at all). The sidebar has a row cursor, so it's the natural next step.
- ↑ on a closed title opens its menu on the last *static* item: dynamic entries (Bookmarks' recent folders) load after it opens.
- Checked in the site demo (Chromium, in the browser pane) and in happy-dom tests, not in the desktop app. Not tried on Windows (WebView2): whether a bare Alt tap also reaches the native window menu, and whether F10 reaches the page. Both handlers call `preventDefault`. On Linux, WebKitGTK gives a key to the page before GTK's own bindings (F10, the Menu key).
