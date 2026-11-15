# session-persistence: the sort is per tab

Date: 2026-11-15. Task 18 of `docs/plans/active/survey-2.md`. Code: `src/session.ts`, `TabRecord.initialSort` (`tabs.ts`), `useTabState`'s `initialSort`, `sortOf` in `App.tsx`; the ✓ in `resolveChecked` (`menus.tsx`) with `SORT_KEY_OF` (`handlers/view.ts`).

## Context
Each tab already had its own sort column and direction (`useTabState`), reset to Name ascending on every start and in every new tab. The task asked for it to persist, per tab or globally, and for the Sort By ✓ (fixed on Name in `data.ts`) to show the real sort.

## Decision
**Per tab, saved with the tab.** A restored tab comes back as it was: its folder and its sort. Two tabs can show the same kind of folder differently (Downloads by date, a project by name), which a single global sort can't. It also keeps what each tab already did, so the change is in where a tab's sort starts, not in how sorting works.

**A new tab starts with the sort of the tab it came from.** Ctrl+T, the + button, Open in New Tab and New Private Session take the active tab's sort; Duplicate takes the duplicated tab's. Without this, a per-tab sort would reset to Name in every new tab, which is what made it feel unsaved. A fresh start with nothing saved, a second window, and the tab that replaces the last one closed start with Name ascending.

Global was the other option, as a tweak next to Folders First. It's simpler to explain (one sort everywhere), but changing it in one tab would re-sort every other tab, and it would have meant moving the sort out of `useTabState` and every caller that reads it there.

**The ✓ follows the active tab.** The menubar and the context menus get the active tab's `sortKey` and `sortDir` with their other toggles. Under Sort By, the item for that key is ticked (`Type` and `Type / Extension` both mean `type`), and Descending when the direction is descending. Folders First stays the setting it was. The static `check: true` on Name in `data.ts` is now only the fallback for a menu shown without toggles, as Sidebar's is. The context menus now get the toggles too, so the empty-area Sort By shows the sort and their other toggles stop showing static marks.
