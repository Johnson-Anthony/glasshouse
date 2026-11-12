# focus-and-targets

Branch: `claude/exciting-rubin-44f4c0` (worktree `exciting-rubin-44f4c0`). Frontend only.
Scope: section 5 of `docs/plans/active/survey-2.md`.

## Status
Done 2026-11-11.
- **Checks:** all pass. `pnpm build`, `pnpm test` (299 tests in 25 files), `pnpm check:wiring` (0 unwired, shadowed, theater or unsent), `pnpm site:build`, `pnpm site:capture check` (12/12).
- **Checked by hand in the rebuilt demo:**
  - Tab to cancel, then Enter, cancels a delete-permanently confirm, and the pane doesn't open the selection behind it.
  - The confirm's primary button has focus on open: Enter deletes, the pane stays, and focus goes back to the pane.
  - Right-click on empty space with a row selected shows New / Paste….
  - With focus in the sidebar and a row selected in the pane, Delete and F2 do nothing.
  - A tree file row's menu is the new file menu. Open there, or a click on the row, opens the file with the default app instead of navigating to it as a folder.
  - No console errors.
- **Behavior changes for review:**
  - Ctrl+Shift+F no longer closes Find in Files (Esc does).
  - F1 / Ctrl+? still close the cheatsheet; the dialog handles them now.
  - DialogHost gives focus back to its previous owner on close.
  - Pinned files keep the folder icon (only their click, Enter and menu changed).
- **Shared files:** App.tsx (keydown listener, onSidebarContext, FindInFilesModal, the Sidebar prop) and components.tsx (FilePane key and context-menu handlers). The edits are small and in place.
- Decisions: `docs/decisions/2026-11-11-focus-and-targets-modal-flag.md`, `docs/decisions/2026-11-11-focus-and-targets-sidebar-targets.md`.

## Approach

### 1. Modal dialogs own the keyboard
- **`src/dialogs/modal.ts`:** `useModal(active)` keeps a count of open modals, and `isModalOpen()` reads it.
  - When a modal closes, the count drops in a later task (a `setTimeout(0)`), not synchronously. The keypress that closes a dialog (Enter in a confirm or in the Folder Picker) still counts as "in a modal" for every listener of that same event.
  - Without the delay, React flushes the close and its effect cleanup in a microtask between two window listeners, and App's listener would then see no modal.
- **Who calls `useModal`:** every overlay dialog:
  - DialogHost, while a prompt, alert, confirm or choice is showing;
  - FolderPicker, BulkRename, PasteSpecial, Properties, TagPicker, About, ConnectServer, ManageRemotes, BookmarkManager, Blame, Diff, GitOutput and Keybindings;
  - Notices, and App's FindInFilesModal.
  - Not the palette, Quick Look, the context menu or Tweaks: their own shortcuts toggle them, and the palette's text field already blocks file keys.
- **Who checks it:**
  - App's keydown listener: no keymap binding, pane cycling or git chord runs while a modal is open (`findBinding` takes `modal`);
  - the FilePane, Miller and Sidebar key handlers return early.
- **DialogHost:**
  - alert, confirm and choice autofocus their primary button;
  - Enter on a focused button activates that button, so Tab to "cancel" then Enter cancels instead of confirming.
- **Keybindings cheatsheet:** it now closes on F1 / Ctrl+? itself, because App's toggle no longer runs over a modal.

### 2. File keys don't act from the sidebar
- Keymap bindings that act on the pane's selection, or paste into the pane, get `pane: true`:
  - Enter, Space, Delete, Shift+Delete, F2;
  - Ctrl+C / X / V, Ctrl+Shift+C / V / R / P / E;
  - Ctrl+I, Ctrl+U, Alt+Enter, `*`.
- `findBinding` skips them while the key event's target is inside the sidebar (`sidebar` state).
- They are **not** routed to the sidebar's row. Delete on a keyboard-focused tree folder trashing that folder is a riskier default; the row's context menu has the commands.

### 3. Ctrl+C / Ctrl+X leave selected text alone
- These two get `unlessText: true`, and `findBinding` skips them while the document has a text selection (`textSelected`).
- So copying text in the Inspector preview, Properties or Blame copies the text, not the files.

### 4. Sidebar file rows are files
- **Click and Enter:**
  - a tree file row, or a pinned file, opens with the default app (a new Sidebar prop, `onOpenFile`);
  - Sidebar looks up pin kinds in the background when the pins change, with one listing per parent folder; a pin it can't classify counts as a folder.
- **Context menu:**
  - tree files and pinned files get a new `CONTEXT_SIDEBAR_FILE`: Open, Open in VS Code, Copy Path, Copy as WSL Path, Reveal, Rename, Move to…, Tag →, Pin, Properties, Move to Trash;
  - pinned files get Unpin and the reorder items instead of Pin;
  - new row kind: `pinned-file`.
- **`targetHandler`:**
  - "Open" on a file target opens it with the default app;
  - it now runs Remove Tag… and Clear All Tags on the target path. Both are in the sidebar folder menu too, where they fell through to the pane's selection.
  - **Safety net:** a label it doesn't handle while a sidebar or breadcrumb target is set is consumed with an "isn't available here" toast, instead of falling through to the pane's selection.
- **App:**
  - a keyboard command closes an open context menu and clears its target, because keys act on the pane, not on a menu's target;
  - that also keeps the safety net from swallowing a shortcut pressed while a sidebar menu is open.
- The tag logic shared with `fileOps.ts` moves into `handlers/helpers.ts`.

### 5. Smaller ones
- **Miller Enter:** the keymap's Enter binding gets `unlessHandled` (as Space has). Miller already `preventDefault`s the keys it handles, so the window keymap no longer opens the file a second time.
- **Right-click on empty pane space:** shows the empty-space menu (New, Paste…). The pane decides by whether the click hit a row (`paneContextKind`), not by whether something is selected.

## Tests
- `src/dialogs/modal.test.ts`: count and deferred release.
- `keymap.test.ts`:
  - nothing fires over a modal;
  - pane bindings are skipped in the sidebar;
  - Ctrl+C/X are skipped with text selected;
  - Enter is skipped once handled.
- `focusTargets.test.ts`: DialogHost's Enter rule (a pure helper), `paneContextKind`, and `pinnedFiles`.
- `appRouting.test.ts`:
  - every label in every sidebar, breadcrumb and tab menu routes to `targetHandler`;
  - Open on a file target opens it;
  - Git: Discard with a tree-file target doesn't touch the pane's selection;
  - Remove Tag… / Clear All Tags act on the target.

## Checks
`pnpm build`, `pnpm test`, `pnpm check:wiring`, `pnpm site:build`, `pnpm site:capture check`.
