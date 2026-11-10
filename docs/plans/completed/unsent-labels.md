# unsent-labels

Branch: `claude/intelligent-turing-9d8036` (the dead-code session, started by the lead while dead-code's Rust part waits for a build slot).
Backlog section: `## unsent-labels` in `docs/plans/active/survey-fixes.md`.

## Status
**Done 2026-11-08.** Commits `c0bbbc7`..`e45680b` on top of main `cfc68ae`. All 75 unsent cases are gone except Miller, which got its menu item back; 292 switch cases became 212. The audit now fails on unsent cases. `pnpm build` OK, `pnpm test` 151/151, `pnpm check:wiring` clean (0 in every category). Not checked in the running app: Display Mode → Miller and Ctrl+7 (tsc and the audit cover the wiring; the view itself is unchanged since July).

Decision record: `docs/decisions/2026-11-08-unsent-labels-cleanup.md`.

## What "never sent" covers
`pnpm check:wiring --all` lists handled labels that no menu, palette entry, chord, inline menu item or `dispatch("…")` literal sends. Checked by hand that nothing else sends them either:
- Submenu parents (`kind: "sub"`) never dispatch: `MenuItem` returns early on click (`components.tsx`, `if (isSub) return;`). So "New", "Compress", "Sort By", "Tag →" and the rest can't arrive.
- Dynamic items carry a payload (`handleMenuPayload`) or a built action (`git-branch:<name>`), not these labels.
- The cheatsheet rows ("Previous Tab" and others) are text, not buttons.
- The palette runs only `PALETTE` labels; typed text isn't dispatched.
- The pinned-folder context menu App.tsx builds inline ("Move pin up/down", "Unpin") was the one blind spot; the audit now counts inline `{ kind: "item" }` objects as senders (`c0bbbc7`).

## Approach
- Delete the dead case labels. Where a label is stacked with live ones, only its `case` line goes; where every label of a case is dead, the case and its body go. Edits stay line-local in App.tsx's switches.
- **Exception: "Miller Columns (ranger)".** The miller view is implemented (`Miller.tsx`, July) and in the spec, but its menu item was dropped from View in April and never came back, so nothing can turn it on. Add it to View → Display Mode instead of deleting the case.
- Commits by area: App.tsx right-click-target switches, global switch, `doFileOp`, handler aliases, handler submenu-parent no-ops, the Miller item.
- After: the list is empty, so unsent cases became a failure (`f852870`), with no allowlist.

## Checks
`pnpm build`, `pnpm test`, `pnpm check:wiring`.

## For review
- **Miller Columns restored, not deleted**, with a new Ctrl+7 shortcut. If the miller view was hidden on purpose, revert `cc6a9f3` and delete the view.ts case instead.
- **Unsent cases fail CI with no allowlist.** A case kept for a sender the audit can't see means extending the audit first.
- The commits are grouped by switch rather than one per label, since most are single `case` lines.
