# Wiring audit: kept, rebuilt on the TypeScript AST, run in CI

Date: 2026-11-08 · Task: dead-code

## Context
`scripts/audit-wiring.mjs` compared the app's menus against the deleted design bundle (`design/project/src/*.jsx`), so it crashed on start. Its other checks were still the kind of thing that goes wrong here: commands are routed by label string through App.tsx's switches and then the `HANDLERS` chain, and nothing checks that a label reaches real code. The survey found 19 handler cases that never ran because App.tsx took the label first, which is exactly what a check could have caught.

## Decision
Keep the script and rework it; don't delete it.
- It reads the live sources only. `src/data.ts` runs in a `vm` sandbox with `IS_WINDOWS` on, so Windows-only items are audited too. App.tsx and the handler files are parsed with the TypeScript compiler API, which is already a dependency, instead of regexes and line ranges.
- **Senders:** every item in `MENUS`, the palette, every exported menu tree, the `GIT_CHORDS` values, and string literals passed to `dispatch`, `handleMenuCommand`, `handleMenuCommandRef.current` or `onCommand`, including both arms of a `?:` and `list[i]` for an array literal in the same file.
- **Receivers:** `switch (label)` cases in `handleMenuCommand` and `doFileOp`, then in each handler in `HANDLERS` order. A switch under an `if` (the right-click target switches) counts as conditional.
- **Failures** (exit 1): a sent label no case handles; a case shadowed by an earlier unconditional case for the same label; a sent label whose case only logs, alerts, toasts or returns ("theater").
- Handled labels that nothing sends are only counted; `--all` lists them, `--json` dumps everything.
- `pnpm check:wiring` runs it, and CI's frontend job runs it after the tests.

## Consequences
- A new menu item without a case, or a handler case that App.tsx already takes, fails CI.
- The audit found one real theater item on its first run: Edit → "Select by Tag →" was a plain menu item whose case toasted "open from the menubar to browse submenu". It now selects entries by tag.
- Labels built at runtime (template strings, variables other than `GIT_CHORDS`) aren't seen as senders. Dynamic menu items carry a payload and don't go through label routing, so this only matters for code that builds a label string.
- 77 handled labels are never sent. Some are aliases, others dead submenu-parent no-ops. Clearing them touches App.tsx's switches, so it's left for a follow-up task.
