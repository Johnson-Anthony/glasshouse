# Cases for labels nothing sends: deleted, and now a CI failure

Date: 2026-11-08 · Task: unsent-labels (run by the dead-code session)

## Context
After dead-code, `pnpm check:wiring --all` listed 77 labels that App.tsx or a handler handled but nothing sent. Before deleting them, the other ways a label could arrive were checked by hand:
- Submenu parents (`kind: "sub"`) never dispatch: `MenuItem` returns early on click. That rules out "New", "Compress", "Sort By", "Tag →", "Open With →" and the other parents, and the palette sends only its own `PALETTE` labels.
- Dynamic items dispatch a payload or a built action (`git-branch:<name>`).
- Cheatsheet rows are text, not buttons, and typed palette text isn't dispatched.
- One real blind spot: App.tsx builds the pinned-folder context menu inline ("Move pin up", "Move pin down", "Unpin"). The audit now counts `{ kind: "item", label }` objects anywhere in `src/` as senders, which took the list to 75.

## Decision
- **Delete every remaining case except one.** Aliases stacked with a live label lose only their `case` line; cases whose labels are all dead go with their bodies (the "open from the menubar" toasts and the silent `return true` for submenu parents, Open Terminal Here, Open With → / Open With…, Pin to Workspace, Jump to Bookmark…).
- **Restore "Miller Columns (ranger)" instead of deleting it.** `Miller.tsx` has been a working view since July, but its menu item was dropped in April and never re-added, so no one could turn it on. It's back in View → Display Mode, on Ctrl+7 next to Ctrl+1–6.
- **Unsent cases now fail the audit.** There's no allowlist: if something the audit can't see sends a label, the fix is to teach the audit about that sender, as was done for inline menu items.

## Consequences
- App.tsx's switches and the handlers carry 212 cases instead of 292, and every one is reachable.
- A renamed menu label now fails CI twice over: the new label is unwired, and the old case is unsent.
- A label built at runtime (a template string, or a variable other than `GIT_CHORDS` and in-file array literals) still can't be seen. A case for one would fail as unsent and need the audit extended first.
