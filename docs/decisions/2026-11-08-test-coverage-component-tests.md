# No jsdom or Testing Library for now

**Decision (test-coverage, 2026-11-08):** don't add jsdom and `@testing-library/react`. Keep testing frontend logic as pure functions under vitest's node environment, and lift logic out of components when it needs a test.

## Why
- **The pattern already works.** The merged survey tasks tested the risky frontend logic by pulling it out of components: `names.ts`, `tabs.ts`, `history.ts`, `transfer.ts`, `undoActions.ts`, `octal.ts`. This task did the same for the bulk-rename preview (`bulkRenamePreview` in `components.tsx`) and routes real labels through the real handler chain with only `api` and `dialogs` mocked. Both found bugs without rendering anything.
- **`components.tsx` already imports under node.** Exported helpers can be tested without a DOM, so jsdom isn't needed to reach them.
- **jsdom would test the wrong things here.** Much of the UI depends on layout, which jsdom doesn't do: the context menu measures and clamps itself, panes shed columns by width, large lists use `content-visibility`, the terminal is xterm, previews use pdf.js. Tests of those in jsdom would either mock the interesting part away or be brittle.
- **Cost.** Two more dev dependencies (jsdom is large), a second test environment to keep working, and slower runs, for components that `split-big-files` is about to move.
- **A real browser is closer to hand.** The Pages demo renders the real React UI over a mocked backend in Chrome (`site/demo`, `pnpm site:capture`). Its checks cover the landing page today, but that harness is the better base if the app ever needs UI-level checks.

## Revisit when
- a regression happens in component wiring that a pure-logic test couldn't have caught (a dialog's keyboard flow, focus handling, or state passed between components); or
- `split-big-files` has broken the dialogs out, so a component can be rendered without pulling in the whole 6k-line module.

Then prefer a few browser checks on the demo harness, or jsdom scoped with a per-file `// @vitest-environment jsdom` comment so the rest of the suite stays on node.
