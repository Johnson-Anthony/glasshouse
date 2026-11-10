# notices-screen

Branch: `claude/bold-haibt-91d29a` (worktree `bold-haibt-91d29a`, same session as backend-bugs and no-clobber-fs). Backlog entry: `## notices-screen` in `survey-fixes.md`. Assigned by the lead on 2026-11-08, starting from `main` at `bc5a919`. Frontend only: no cargo, no tauri dev.

## Scope
- An About → Third-party notices view that shows the bundled font licenses in `src/assets/fonts`, with `LICENSES.md` as the index.
- Decide whether to generate the npm and Rust dependency license lists at build time, and record the trade-off. The generation itself is a later task if it needs a new tool.

## Approach
1. **Data:** `src/noticesData.ts` loads every text file under `src/assets/fonts` with `import.meta.glob(…, { query: "?raw", eager: true })`, skipping the font files themselves. It's only reached through a dynamic `import()`, so the roughly 100 KB of license text is a separate chunk, loaded when the view first opens rather than at startup. It exports the notices in display order, `LICENSES.md` first. A pure helper resolves a relative link from one notice to another.
2. **View:** `src/Notices.tsx`. A modal with the file list on the left, grouped by folder, and the selected text on the right in a `<pre>`. There's no Markdown renderer in the dependencies, and adding one for this isn't worth it, so the files show as plain text. The one extra: `[text](relative-link)` links that point at another bundled notice become buttons, so the tables in `LICENSES.md` work as an index. Other links stay plain text, since the app makes no third-party requests. Esc or clicking outside closes it, as with About.
   - It opens through `openNotices()`, a module-level function like the `dialogs` API, with `<NoticesHost />` mounted once. In `App.tsx` that's one import and one mount line, and no new state or props.
3. **Entry points:** a Help menu item "Third-party Notices" right after About, handled in `handlers/misc.ts` (which keeps `check:wiring` satisfied), and a "notices" button in the About dialog's footer that closes About and opens the view.
4. **npm / Rust lists:** decided and recorded in `docs/decisions/2026-11-08-notices-screen-dependency-licenses.md`. The generation is not done here; it's suggested to the lead as a follow-up task.

## Tests
- vitest:
  - every non-font file under `src/assets/fonts` is a notice, and no font file is;
  - `LICENSES.md` comes first;
  - every relative link in `LICENSES.md` resolves to a notice;
  - link resolution from a subfolder (`../`) and for unknown targets.
- Visual check in the Vite dev server (`?mockRows`): open from Help and from About, follow a link, and close.

## For review
- **Dependency license lists aren't generated here.** The recommendation is a follow-up task: `pnpm licenses list` for npm (no new tool), and `cargo-about` for Rust (a new tool, plus a release-time step), feeding two more groups in this view. See `docs/decisions/2026-11-08-notices-screen-dependency-licenses.md`.
- **Entry points:** Help → Third-party Notices, and a "third-party notices" button in About's footer. Each open starts at `LICENSES.md`.
- **Plain text, no Markdown rendering:** only links to other bundled notices are clickable; web links stay text (the app makes no third-party requests).

## Status
Done 2026-11-08, on `main` `bc5a919`, then `c8c52d2` (script-kill-tree, Rust only) merged before the final checks.
- **New files:**
  - `src/notices.ts`: ordering, folder groups, link resolution;
  - `src/noticesData.ts`: the `?raw` glob, a lazy chunk of 92 KB (19 KB gzipped) that the main bundle doesn't contain;
  - `src/Notices.tsx`: `NoticesHost` and `openNotices`;
  - `src/notices.test.ts`: 8 tests.
- **Edits to existing files:** `App.tsx` +2 lines (import, mount), `components.tsx` +1 import and the About footer button, `data.ts` +1 menu item, `handlers/misc.ts` +1 case.
- **Checks:** `pnpm build` ok · `pnpm test` 191 passed · `pnpm check:wiring` 308 sent / 213 cases, 0 unwired, 0 unsent. No cargo, per the lead.
- **Seen in the Vite dev server (`?mockRows`):**
  - Help → Third-party Notices opens with 21 notices in 4 folder groups, `LICENSES.md` first, its 21 links live;
  - following the codicons link shows that license from the top;
  - Esc closes;
  - About → "third-party notices" closes About and opens the view;
  - reopening after picking another notice starts at the index again.
