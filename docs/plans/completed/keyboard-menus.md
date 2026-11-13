# keyboard-menus

Branch: `claude/peaceful-shamir-c528aa` (worktree `peaceful-shamir-c528aa`), started 2026-11-13 from `main` (`d2a3756`).
Backlog entry: section 19 of `docs/plans/active/survey-2.md`. Frontend only.

## Status
**Done** 2026-11-13. Commits: `7c6034e` (the change), `fc3c5c3` (demo rebuild).
- Everything in the approach below is in, plus one rule found while testing: a submenu the pointer opened keeps the keys in its parent menu until → or Enter goes in (Windows and GTK do this).
- Found in the demo and fixed: the context menu gave focus back from a layout-effect cleanup, which runs inside React's commit, when React ignores focus events. DOM focus went back to the pane, but its `onFocus` didn't run, so the focused row wasn't drawn. Focus now goes back in a passive cleanup, and a test covers it.
- Checks: `pnpm build`; `pnpm test` 675 passed, 3 skipped (50 files); `pnpm check:wiring` clean (315 sent labels, 212 cases); `pnpm site:build` (reproducible); `pnpm site:capture check` 23/23 under a 3 GB cap. In the site demo (browser pane, real key events): type-ahead (prefix, cycling, pause), Shift+F10 menu with ↓ → ← Esc and focus back on the pane, letter jump to Rename and its prompt keeping focus, Alt → ← ↓ between menus, Esc twice, Alt+I opening Git, hover-opened submenu then ↓, mouse click on a menubar item.
- Not checked: the desktop app itself (WebKitGTK), and Windows (WebView2): whether a bare Alt tap also opens the native window menu there, and whether F10 reaches the page.
- Not done (possible follow-ups): the Menu key in the sidebar (it has a row cursor), tabs and breadcrumbs; Miller has no context menu at all. ↑ on a closed title opens on its last static item, before dynamic entries load.
- Media: no clip shows menus being driven from the keyboard; the tour clips weren't re-recorded.

## Problems
1. `menus.tsx` has no key handling. A menu opened with the mouse can't be driven by keys, and nothing opens the menubar or a context menu from the keyboard.
2. Menu highlight is CSS `:hover`, so there is no "current item" a key could move.
3. Focus isn't given back when a menu closes: a click on a menubar title moves focus to `<body>`, so after a menu command the file pane no longer takes arrow keys until clicked.
4. The menubar underlines each title's first letter, but nothing uses them, and they aren't unique (Go/Git, Tools/Terminal).
5. The file list has no type-ahead.

## Approach
**Navigation, pure (`src/menuNav.ts`, new):** a menu's state is a *path*: the highlighted index at each open level (`[3, -1]` = item 3's submenu open, nothing highlighted in it). `menuKey(items, path, key)` returns a new path, an item to run, or an exit (`prev` / `next` / `close`) for the owner:
- ↑/↓ move between items (skipping separators and headings, wrapping), Home/End jump to the ends;
- → or Enter/Space on a submenu opens it on its first item; → on a plain item exits `next`;
- ← or Esc in a submenu closes it; ← at the top exits `prev`, Esc at the top exits `close`;
- Enter/Space on an item runs it; a letter jumps to the next item starting with it.
Also the menubar's mnemonics (`mnemonics(titles)`: each title's first letter not already taken, so Git gets *i* and Terminal *r*) and the type-ahead matcher.

**Menus (`menus.tsx`):** one renderer for every level (the menubar's dropdowns, submenus and the context menu), highlighted from the path; the mouse moves the same path (hover), so keys continue from where the mouse was. `:hover` styles for menu items become `.hover`.
- **Context menu:** takes focus when it opens (its first item highlighted when the keyboard opened it), drives the path from its keys, and owns the keyboard while open (keys don't reach App's shortcuts). Esc or Tab closes it.
- **Menubar:** Alt pressed and released alone, or F10, highlights the first title (or leaves the menubar if it's active). Then ←/→ move between titles, ↓/Enter/Space open one, a mnemonic letter opens its menu. In an open menu ←/→ at the top level move to the neighbouring menu, open on its first item; Esc goes back to the title, a second Esc leaves. Alt+mnemonic opens a menu directly. None of this fires while a modal dialog, the palette or the terminal has focus (the terminal keeps F10 and Alt+letters for the shell); an Alt press cancelled by another key, a click or the window losing focus doesn't count.
- **Focus return:** each menu remembers what had focus when it opened and gives it back when it closes, unless focus has already moved on (a command that focuses a field or opens a dialog keeps it). Mouse presses on the menubar no longer take focus from the pane.

**File pane (`components.tsx`, FilePane's key handler):**
- **Menu key / Shift+F10:** with a selection, the file menu for it, anchored under the focused row (scrolled into view); with nothing selected (Esc deselects), the empty-pane menu (New, Paste…). Works in an empty folder too. App's `onContext` takes a point (`MenuAnchor`) instead of a mouse event, with a `keyboard` flag that the context menu uses.
- **Type-ahead:** printable keys without Ctrl/Alt build a prefix (reset after 1 s without a key) and move focus and selection to the next row whose name starts with it, case- and accent-insensitive; repeating one letter cycles through the names starting with it. Space only joins a prefix already started (alone it stays Quick Look). Characters that `KEYMAP` binds without Ctrl or Alt (`/`, `*`, Space) are left to it, computed from `KEYMAP` so a new binding stays safe. Only fires with focus in the pane, so not in text fields, dialogs or the terminal; not in Miller (its h/j/k/l are taken).
- **Git chord:** the Ctrl+G chord's pending state moves from App's ref to `keymap.ts` (`gitChord`, `chordPending()`), and the pane leaves every key to App while one is pending. Without it, Ctrl+G then S would jump to an "s…" file and stage it, and Ctrl+G then Delete already trashes the selection from a focused pane.

**Cheatsheet:** `CODE_CHEATS` lists the new keys.

Decisions: `docs/decisions/2026-11-13-keyboard-menus-design.md`.

## Tests
- `src/menuNav.test.ts`: path moves, wrapping over separators and headings, submenu in/out, exits, letters, mnemonics unique and stable, type-ahead matching and cycling, `BOUND_CHARS` from `KEYMAP`.
- `src/menus.dom.test.tsx` (happy-dom): context menu takes focus, ↓/→/←/Enter/Esc, runs the right label, gives focus back; menubar Alt tap and F10 open, ←/→ between titles and menus, mnemonics, Esc twice, focus back, Alt not counted after another key, nothing in the terminal or a modal.
- `src/FilePane.dom.test.tsx`: type-ahead jumps, accumulates, cycles, resets after the timeout, ignores `/`, `*`, Ctrl/Alt keys and inputs; Space joins a prefix; Menu key / Shift+F10 call `onContext` with the right kind and a keyboard anchor; nothing while a git chord is pending.
- `keymap.test.ts`: the cheatsheet list.
