# unsent-labels

Branch: `claude/intelligent-turing-9d8036` (the dead-code session, started by the lead while dead-code's Rust part waits for a build slot).
Backlog section: `## unsent-labels` in `docs/plans/active/survey-fixes.md`.

## Status
Started 2026-11-08.

## What "never sent" covers
`pnpm check:wiring --all` lists handled labels that no menu, palette entry, chord, inline menu item or `dispatch("…")` literal sends. Checked by hand that nothing else sends them either:
- Submenu parents (`kind: "sub"`) never dispatch: `MenuItem` returns early on click (`components.tsx`, `if (isSub) return;`). So "New", "Compress", "Sort By", "Tag →" and the rest can't arrive.
- Dynamic items carry a payload (`handleMenuPayload`) or a built action (`git-branch:<name>`), not these labels.
- The cheatsheet rows ("Previous Tab" and others) are text, not buttons.
- The palette runs only `PALETTE` labels; typed text isn't dispatched.
- The pinned-folder context menu App.tsx builds inline ("Move pin up/down", "Unpin") was the one blind spot; the audit now counts inline `{ kind: "item" }` objects as senders (`7981e6f`).

## Approach
- Delete the dead case labels. Where a label is stacked with live ones, only its `case` line goes; where every label of a case is dead, the case and its body go. Edits stay line-local in App.tsx's switches.
- **Exception: "Miller Columns (ranger)".** The miller view is implemented (`Miller.tsx`, July) and in the spec, but its menu item was dropped from View in April and never came back, so nothing can turn it on. Add it to View → Display Mode instead of deleting the case.
- Commits by area: App.tsx right-click-target switches, global switch, `doFileOp`, handler aliases, handler submenu-parent no-ops, the Miller item.
- After: `pnpm check:wiring --all` should list nothing, so the note line can become a failure too (decide once the list is empty).

## Checks
`pnpm build`, `pnpm test`, `pnpm check:wiring`.

## For review
- (filled in at the end)
