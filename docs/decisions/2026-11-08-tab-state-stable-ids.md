# tab-state: stable tab ids, pure history, in-pane errors

Date: 2026-11-08. Task: `tab-state`. Status: for review by the lead.

## Tab identity
**Chosen:** one `TabRecord[]` in App (`TabDef` plus `id`, `initialPath`, `private`), replacing the three parallel arrays `tabs`, `initialPaths` and `privateTabs`.
- Ids come from a module counter in `src/tabs.ts` and are never reused.
- `<TabShell key={t.id}>`, and `tabHandles` is keyed by id. A TabShell removes its own handle when it unmounts.
- `activeTab` stays an index.
- List edits are pure functions (`closeTab`, `closeOtherTabs`, `moveTab`) that return `{tabs, active}`.

**Rejected:**
- *A parallel `tabIds` array next to the existing three.* It's a smaller diff, but it keeps four arrays that every edit has to splice in step. That duplication is what made `moveTab` long and easy to get wrong.
- *Tracking the active tab by id.* It's cleaner in principle, but the titlebar, the context-menu tab index and the next/prev-tab handlers (`handlers/nav.ts`) all work with positions. The pure helpers keep the active tab's identity through closes and moves, which gives the same result.
- *`crypto.randomUUID()` ids.* Not needed inside one process, and a counter keeps tests readable.

## History updates
**Chosen:** path and history are one `NavState` changed by pure `navGoTo` / `navBack` / `navForward` (`src/history.ts`).
- A ref holds the latest value and is updated synchronously in the action, and `setState` receives a plain value.
- `resetNav()` and `appendRecent()` run in the action, never inside an updater.

**Why the ref rather than functional updaters:** the action needs to know whether navigation happened before it fires side effects, e.g. no recent-list entry for `goTo` to the current folder. Reading a synchronously updated ref answers that without an impure updater. It also fixes two calls in the same tick: before, the second `back()` read a stale `pathRef`.

## Showing listing errors
**Chosen:** a new `readDir()` that rejects on error, used only by `useTabState`. FilePane and the Miller centre column show the message where the rows would be. FilePane also shows "loading…" (only while there are no rows) and "empty folder".
- `listDir()` keeps its swallow-and-fallback behaviour for the sidebar tree and Miller side columns, where a blank column is fine.
- **Rejected: a toast.** It would fire again on every 30 s poll and fs event for an unreadable folder.
- **Rejected: the status bar.** It's too far from the empty pane to explain it.
- `loading` stays hidden while rows exist, so periodic refreshes don't flicker.
