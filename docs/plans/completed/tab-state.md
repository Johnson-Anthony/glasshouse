# tab-state

Branch: `claude/cool-satoshi-4102fc` (worktree `cool-satoshi-4102fc`). Frontend only.
Scope: the `## tab-state` section of `docs/plans/active/survey-fixes.md`.

## Confirmed (Vite dev server, `?mockRows=40`, before any change)
- **Index-keyed tabs.** Tabs `[/, /mock/10, /mock/20, …]`. Close index 1, then select index 1:
  - it shows `/mock/20`, but opening a folder and pressing Back do nothing (the handle belongs to the unmounted tab);
  - after the 30 s poll, it switches to `/mock/10`, the closed tab's folder (that tab's state is still mounted in slot 1).
- **StrictMode history duplication.** Normal clicks don't trigger it, because React runs the first updater eagerly. When the tab already has a pending update in the same tick (`setSelected([3]); goTo('/mock/0')`), the updater runs twice:
  - `historyBack` becomes `["/","/"]`, then `["/","/","/mock/0","/mock/0"]`;
  - `back()` after `setFocusIndex` pushes the forward entry twice.
- **Errors are swallowed** (from reading the code; the browser has no backend). `listDir` → `safe()` catches the error, so `fetchAll`'s catch never runs and `error` stays null. FilePane has no empty state at all, so an unreadable folder looks the same as an empty one.

## Approach
1. **Stable tab ids** (`src/tabs.ts`, new; `App.tsx`)
   - Merge the parallel `tabs` / `initialPaths` / `privateTabs` arrays into one `TabRecord[]` (`TabDef` plus `id`, `initialPath`, `private`).
   - Ids come from a module counter and are never reused.
   - `<TabShell key={t.id}>`; `tabHandles` is keyed by id; a TabShell removes its handle when it unmounts.
   - `activeTab` stays an index, because Titlebar and the next/prev handlers do index arithmetic.
   - Pure `closeTab` / `closeOtherTabs` / `moveTab` return the new list and the new active index, which keeps the active tab when a move passes over it. App calls these.
   - Rendering TabShells from the reordered array makes `moveTab` reorder them, with state kept.
2. **Pure history** (`src/history.ts`, new; `state.ts`)
   - `NavState {path, back, forward}` with pure `navGoTo`, `navBack`, `navForward`.
   - `useTabState` keeps the nav state in one `useState`, plus a ref that is updated synchronously in the action, so two calls in the same tick see each other's result.
   - `resetNav()` and `appendRecent()` run in the action callbacks, never inside updaters. `appendRecent` still fires only on `goTo`.
3. **Error state**
   - `readDir()` in `api.ts` rejects on failure (browser mode still returns mock rows). `useTabState` uses it; the other `listDir` callers (tree, Miller side columns, …) keep their swallow-and-fallback behaviour.
   - A fetch sequence number drops results from a superseded fetch, so an old folder's error can't land on the new one.
   - Re-reads of the same folder (30 s poll, fs events, Refresh) are quiet: they keep the current rows or error on screen until the result arrives. Otherwise every poll would blink an error to "loading…" and back.
   - FilePane gets optional `error` / `loading` props and shows, in the rows area:
     - the error message when the folder can't be read;
     - "loading…" while the first listing is still empty;
     - "empty folder" when it is empty.
   - The Miller centre column shows the error in place of "empty".
4. **Tests**
   - `history.test.ts`: goTo, back and forward, no-ops, and that functions don't mutate their input.
   - `tabs.test.ts`: close, close-others and move, with the active index.
   - `undo.test.ts`: push, pop, redo, the 20-entry limit, and that a push clears redo.

Files: `src/tabs.ts`, `src/history.ts`, three test files, `src/state.ts`, `src/api.ts`, `src/App.tsx` (tab code only), `src/components.tsx` (FilePane props and notice only), `src/Miller.tsx`, `src/styles/app.css`.

## Out of scope / flagged
- **Redo is broken.** `UndoEntry` only stores `inverse`, and redo calls that same `inverse` again (e.g. after undoing a rename, redo tries to rename back a second time). The fix needs a forward action at all ~13 `pushUndo` sites in App.tsx. Suggested to the lead as a separate task.
- `closeTabAt` lets you close the last tab, which leaves no tab at all. Not changed here.
- The label-sync effect overwrites a private tab's `(private) …` label with the plain path once you navigate. Not changed here.

## For review
- Tab id design: `docs/decisions/2026-11-08-tab-state-stable-ids.md`.
- Error display: FilePane notice vs. status bar or toast (same decision file).
- Small behaviour change: Duplicate Tab on a private tab now keeps the `(private)` label and magenta colour. Before, the copy was private but looked like a normal tab.
- `readDir` is used only by the tab listing. Tree and Miller side columns still swallow errors through `listDir`.

## Status
Done, 2026-11-08.
- [x] Bugs reproduced
- [x] Implementation
- [x] Tests: 24 new; `pnpm test` 55/55, `pnpm build` passes (only the existing chunk-size warning).
- [x] Re-checked in the dev server (StrictMode on):
  - closing a middle tab leaves the right tab in each slot, still responsive, through the 30 s poll;
  - same-tick `setSelected` + `goTo` and double `back()` give single history entries;
  - with a temporary failing `readDir`, the error shows and stays steady through Refresh and the poll, and Back clears it;
  - "empty folder" shows when a folder has no entries.
- [x] Handoff
