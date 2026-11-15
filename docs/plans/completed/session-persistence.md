# session-persistence (task 18, survey-2)

Nothing survives a restart: window size and position, the tabs, each tab's
sort, and the sidebar, Inspector and status-bar visibility. The Sort menu's
✓ is fixed on Name.

## Status
- 2026-11-15: done. Source `b2321c6`, demo rebuild `c1bf874`; plan moved to completed.
  - Checks: `pnpm build`, `pnpm test` (829 passed, 3 skipped; 32 new), `pnpm check:wiring`
    (0 issues), `pnpm notices --check`, clippy `-D warnings` and `cargo test`
    (217 passed, 3 new), `pnpm site:build` and `pnpm site:capture check`
    (25/25), release binary.
  - Checked in the browser pane (Vite dev server, no backend): two tabs, a
    size-descending sort and a hidden sidebar come back after a reload, with
    the second tab active; a new tab takes the active tab's sort; a junk
    record starts fresh; the View → Sort By ✓ follows the tab.
  - Not checked by hand: the window's size and place, the gone-folder
    fallback against the real backend, two windows, WebView2 / Windows (the
    lock, the plugin and the command are plain std and Tauri code, built
    only on Linux here).
  - As planned, except the demo: the plan had it not own the session, but
    its storage is in memory anyway, so it owns it and the capture checks
    run the saving code.
  - Found, not changed: New Tab (Ctrl+T, the + button) adds a tab without
    switching to it (so on `main` too).

## Plan
1. **Who saves when several windows are open.** File → New Window starts a
   second glasshouse process. The first process running owns the session: it
   restores and saves the window's size and place and the tabs. A later
   process (New Window, or a second launch) opens one tab at home at the
   default size, and saves neither. Decision:
   `docs/decisions/2026-11-15-session-persistence-windows.md`.
   - New `src-tauri/src/session.rs`: `claim(dir)` takes an exclusive,
     non-blocking lock on `session.lock` in the app config dir
     (`File::try_lock`, std since 1.89; the OS drops it when the process
     ends, crash included). `session_owner` command for the frontend
     (permission group `settings` in `permissions/app.toml`). If the lock
     file can't be made, the process counts as the owner.
   - `lib.rs`: `build()` then `run()`, so the lock is claimed before the
     main window exists (Tauri creates it at Ready); only the owner
     registers the window-state plugin.
2. **Window size and position**: `tauri-plugin-window-state` 2.5, registered
   from Rust with size, position and maximized (not visibility, decorations
   or full screen). The frontend never calls it, so `capabilities/` grants
   none of its commands (flag this to the lead). `pnpm notices` for the new
   crate.
3. **Tabs** (`src/session.ts`, new): `localStorage["glasshouse.session.v1"]`
   holds `{ tabs: [{ path, sort, dir }], active }`.
   - Parsing checks every field; a bad tab is dropped, a bad record is
     ignored, so startup never breaks on it. Private tabs aren't saved.
   - On start the owner restores the tabs; a saved folder that's gone opens
     its nearest existing parent, or home (`path_kind`, a stat each, all
     tabs at once, given up after 1.5 s per tab, which keeps the path).
   - App writes the record whenever the tab list, the active tab, or a tab's
     folder or sort changes, after the restore, and only in the owner.
   - Export Layout leaves the session out, and Import Layout ignores it (a
     `.glasshouserc` is meant to be shared; it shouldn't carry open paths).
4. **Sort per tab**, saved with the tab. A new tab (Ctrl+T, Open in New Tab,
   Duplicate) starts with the sort of the tab it came from; a fresh window
   with Name ascending. Decision: `docs/decisions/2026-11-15-session-persistence-sort.md`.
   - `TabRecord.initialSort`; `useTabState(path, private, active, sort)`.
5. **Panel visibility** joins the settings: `showSidebar`, `showInspector`,
   `showStatusBar` in `TweakState` (`glasshouse.tweaks`), checked as
   booleans on load (default on). App's `showSidebar` etc. read the tweaks,
   so every call site stays as it is.
6. **Sort ✓**: `MenuToggleState` gets the active tab's `sortKey`/`sortDir`;
   `resolveChecked` marks the Sort By item for the key and Descending for
   `desc`. The context menus get the toggles too, so the empty-area Sort By
   shows the ✓ (and its other toggles stop showing stale ones).
   `SORT_KEY_OF` (label → key) next to the Sort cases in `handlers/view.ts`.
7. **Demo**: the mock answers `session_owner` with true, so the capture
   checks run the saving code. Its storage lives in memory (`install.ts`),
   so no visit reopens another's tabs.
8. Tests: `session.test.ts` (parse, serialize, fallback walk, timeout,
   private tabs, active index), the ✓ in `menus.dom.test.tsx`, the tweak
   checks, `session.rs` lock tests.
9. Docs: ARCHITECTURE.md (session.ts, session.rs, the plugin); CHANGELOG
   lines go to the lead.

## Checks
`pnpm build`, `pnpm test`, `pnpm check:wiring`, `pnpm notices --check`,
clippy and cargo test (4G scope), `pnpm site:build` and
`pnpm site:capture check` (3G scope), release binary (5G scope).
