# shortcut-hints

Branch: `claude/exciting-davinci-df48b1` (worktree `exciting-davinci-df48b1`), reset to main bdd0682. Frontend only.

## Status
- [ ] The seven `KNOWN_GAPS` resolved; `KNOWN_GAPS` removed
- [ ] The hint check also covers the palette's hints
- [ ] Decisions recorded
- [ ] Checks: `pnpm build`, `pnpm test`, `pnpm check:wiring`, `pnpm site:build`

## Per gap
| Hint | Resolution |
|---|---|
| Ctrl+Q Quit | Binding. Not while typing, so Ctrl+Q stays with the terminal drawer (emacs `C-q`, XON) and text fields |
| Ctrl+Shift+C Copy Path | Binding. Needs a selection (Copy Path copies the selected item's path) and not while typing, so terminal copy keeps Ctrl+Shift+C |
| Esc Deselect | Already works: the file pane's own key handler clears the selection on Escape. The test was wrong to list it; it moves to "handled elsewhere", like Ctrl+A |
| `*` Select by Pattern… | Binding. Shift ignored, so Shift+8 and the keypad `*` both work. Not while typing |
| Ctrl+Shift+` New Terminal Tab | Binding (also `~`, which is Shift+` on US layouts), works while typing like Ctrl+`. Ctrl+` no longer ignores Shift |
| Ctrl+` on File → Open in Terminal (and in the palette) | Hint removed. Ctrl+` is the drawer; the external terminal keeps no key |
| Ctrl+Shift+F on Tools → Find & Replace in Files | Hint and binding changed to Ctrl+Shift+H (VS Code's "Replace in Files"). Not while typing |

## Also (separate commit)
A context menu's target (`cmdState.contextTarget`, set by a right-click on a sidebar row, breadcrumb or tab) survived a dismissed menu. A later key or menu command with a matching label then acted on that stale target; for example, Delete with a file selected trashed the right-clicked sidebar folder. The target is now cleared when the menu closes (outside click or Escape). The menu runs its command before closing, and the router takes the target synchronously within that command, so a chosen command still gets it.
