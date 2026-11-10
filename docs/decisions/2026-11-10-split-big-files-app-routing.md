# App.tsx: a keymap table, and command routing as one handler chain

**Decision (split-big-files phase 2, 2026-11-10).** App.tsx's keydown handler becomes a table in `src/keymap.ts`. `handleMenuCommand` and `doFileOp` move into handler files at the front of one chain, and App.tsx keeps only a small router.

## Keymap (`src/keymap.ts`)
- `KEYMAP` is an ordered list of bindings: a combo (`"Ctrl+Shift+R"`), what it does, and when. What it does is either `send: "<label>"`, which dispatches a command like a menu click, or `run: "<action>"` for the few App-local actions that aren't commands (toggle the palette, the find modal, the terminal, tweaks, the cheatsheet, Quick Look, focus search, start a git chord).
- Conditions are data:
  - `inText: true` lets a binding fire while a text field has focus. Bindings without it are skipped while typing, as before.
  - `when: "selection"` / `"multi"` depend on the active tab's selection.
- The first matching binding wins and calls `preventDefault`, as the if-chain did, in the same order.
- Three flows stay as code in App, because they're stateful or DOM-bound rather than a key → command:
  - the second key of a Ctrl+G git chord;
  - Tab/F6 pane cycling;
  - Escape, which closes overlays without consuming the key.
- **It feeds the Keybindings dialog:** bindings with a `cheat` label replace the dialog's hand-written `GLOBAL_BINDS`, so the cheatsheet shows keys that exist.
- **Tests (`keymap.test.ts`):**
  - combo parsing and matching;
  - the typing and selection conditions;
  - every menu shortcut hint is bound to that menu item's command, and every `send` label is something the app handles.
- `audit-wiring.mjs` reads `send:` labels from `KEYMAP` as senders, as it already reads `dispatch("…")` calls.

## Routing (`src/handlers/`)
App.tsx used to route a label through its own switches, then hand it to the `HANDLERS` chain:
1. the right-click target switch;
2. a global switch;
3. `doFileOp` (no tab → stop; lossy-name guard; its switch).

The first three are now handlers, and `COMMAND_CHAIN` in `handlers/index.ts` is:
`targetHandler`, `appHandler`, `fileOpsHandler`, then `...HANDLERS` (the seven feature handlers, unchanged).

- **Bodies are moved verbatim.** They used about 40 names from App's scope (state values and setters, tab operations, `runUndoStep`…). App passes these as `ctx.app`, typed by `AppCommands` in `handlers/types.ts`. Each moved handler starts with `const { … } = ctx.app;` using the same names, so the case bodies don't change.
  - Narrowing these into intent-level methods (`openAbout()`, `toggleInspector()`) would read better, but it would rewrite every case. That's left for later, one handler at a time.
- **`return` means "handled".** In the moved bodies, a `return;` that ended the old function becomes `return true;`. Falling out of a switch, or the old `default:`, becomes `return false`, so the next handler gets the label.
- **Same order and timing.** The router calls each handler and awaits only when it returns a promise. So the target and global handlers still run synchronously in the click or keypress, and `fileOpsHandler` starts synchronously as `void doFileOp(label)` did.
- **Same stops:**
  - with no active tab, `fileOpsHandler` consumes the label silently, so nothing after it runs and no "not yet wired" toast appears, as before;
  - the lossy-name guard still runs before `doFileOp`'s cases and before every feature handler.
- **Module state:** `contextTarget` and `appClipboard` were module-level `let`s in App.tsx, assigned by the moved code. An import can't be assigned, so they move to `src/commandState.ts` as fields of one exported object (`cmdState.contextTarget`, `cmdState.clipboard`).
- **Errors:** the router wraps the whole chain in the try/catch that used to wrap only `doFileOp`. An exception in the right-click or global cases now shows the error dialog instead of only reaching the console. This is the one intended behaviour change.
- **check:wiring** reads `COMMAND_CHAIN` (expanding `...HANDLERS`) instead of App.tsx's two functions. The right-click cases are still `if`-guarded, so they're still conditional and don't count as shadowing. The audit's totals (sent labels, switch cases) stay the same, and a planted duplicate case is still reported.
- `routing.test.ts` is unchanged: `HANDLERS` keeps its seven handlers. `appRouting.test.ts` covers the new handlers with `ctx.app` mocked.
