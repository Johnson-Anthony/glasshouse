# palette-commands

Branch: `claude/laughing-shirley-d547ce` (worktree `laughing-shirley-d547ce`), started 2026-11-13 from `main` (`5c51a91`).
Backlog entry: section 15 of `docs/plans/active/survey-2.md`. Frontend only.

## Status
**Done** 2026-11-13. Commits: `4843b1f` (the change), `4e6efc4` (demo rebuild), `4faa734` (palette tour clip re-recorded; optional, drop it to batch media changes).
- The palette has 155 rows on Linux (16 of them merge two names), up from 19. All four placeholder promises but paths are gone; path entry works through navHandler's fallback.
- Found while testing: Enter in the palette also reached a dialog the command opened. In the demo, New Folder from the palette created `new-folder` without asking; the old palette had the same code. Fixed (the palette stops its Enter) and tested.
- A test found that Terminal › Open in New Window shares File › New Window's case, so they are one row. Task 16 (menu-honesty) may give it, or "Text Editor (.txt)", its own behavior: it should then drop that entry from `SAME_COMMAND` in `palette.ts`. No test catches a stale fold (the test checks that shared cases are folded, not the reverse).
- Checks: `pnpm build`; `pnpm test` 597 passed, 3 skipped (46 files); `pnpm check:wiring` clean (315 sent labels, 212 cases); `pnpm site:build` (rebuild reproducible); `pnpm site:capture check` 23/23 under a 3 GB cap. Checked in the demo in the browser pane: browse view, search, shortcut keys, Enter → New Folder prompt waits, `~/projects` opens the folder, and the site's palette scene runs.
- Not done (possible follow-ups): the palette doesn't list the dynamic lists (recent folders, pins, branches, terminal profiles, ssh hosts) as rows; the "→" stand-ins still prompt with a numbered list. Right-click-only commands that could act on the selection (Reveal in File Manager, Open in New Tab, Duplicate Tab on the active tab) aren't on the palette. Toggles show no ✓. No path completion.

## Problems
1. **The palette lists 19 commands** (`PALETTE` in `data.ts`) out of about 220 menu items, while the site says Ctrl+P "finds any command from a few letters". Typing "new folder", "git push" or "zoom in" finds nothing.
2. **The placeholder and footer promise things that don't exist:** "type a command, path, or :mode", Tab autocomplete, Ctrl+` run in terminal, `:go`, `/find`, `?help`, `!shell`, and "try :help" when nothing matches.
3. **Arrow keys skip around.** Results are rendered grouped, but ↑/↓ walk the score order, so with results from two groups the highlight jumps between them. The active row is never scrolled into view, which matters once the list is longer than the box.
4. Six of the 19 are other names for menu commands (`New Folder` = File › New › Folder, `Git: Commit…` = Commit…, `Git: Stage Selected`, `Toggle Hidden Files`, ...) and `Change Layout →` cycles the two layouts the View › Layout submenu lists.

## Approach
**Entries (`src/palette.ts`, new):**
- Built once from `MENUS`, `CONTEXT_FILE` and `CONTEXT_EMPTY` (after `stripWinOnly`), plus `PALETTE_ONLY` in `data.ts`: the commands no menu holds (Find in Files, Find File by Name, Paste Special…, Hash SHA256 of Selection, Switch Theme, Next/Previous Tab, and the numbered-list stand-ins for the Open Recent, Bookmarks and Branches lists).
- Each entry sends what a click on its item sends (`action ?? label`) to `handleMenuCommand`, so routing, the lossy-name guard (`MUTATING_LABELS`) and `pnpm check:wiring` stay as they are. `PALETTE_ONLY` is a menu tree, so the audit and `MUTATING_LABELS` read it like the others.
- Left out: separators, group labels, submenu headers (their children are listed instead, with the submenu as context), dynamic nodes (recents, pins, branches, terminal profiles), and Command Palette itself.
- The sidebar, tab, breadcrumb and remote menus are left out: every item there acts on the right-clicked row (`cmdState.contextTarget`), which the palette doesn't have. The file and empty-area menus act on the active tab's selection and folder, as the menubar does.
- **One row per command.** Items with the same dispatch label merge, and so do labels that run the same command (`SAME_COMMAND`: e.g. Checksum SHA256 / Checksum (SHA256), Tweaks / Preferences…, Git: Stage / Stage Selected, Open With › VS Code / Open in VS Code). A merged row keeps every name: a search matches any of them and the row shows the name that matched best, with its menu path.
- Each row shows its menu path ("File › New") and its shortcut: the item's `kb` hint (which `keymap.test.ts` already checks against `KEYMAP`), else a hint from another name of the same command.

**Search:** fuzzy (`fuzzy.ts`) over each name alone and with its menu path ("New Folder", "Git Commit…"), best score wins.

**Paths:** a query that looks like a path (`/…`, `~…`, `C:\…`) gets a first row "Go to <path>" that sends the path itself, which `navHandler`'s path fallback already opens (with `~` expanded). The rule moves to `paths.ts` (`looksLikePath`) so the palette and the router agree. Everything else the placeholder and footer promise goes. Decision: `docs/decisions/2026-11-13-palette-commands-path-entry.md`.

**Component (`Palette` in `components.tsx`, changed in place):** rows in one list in display order (group headers only while the query is empty), the active row scrolled into view, Tab kept in the box, danger items in red, an honest placeholder and footer.

**Cleanup the audit forces:** the old aliases nothing sends any more lose their case labels (`New Folder`, `Git: Stage Selected`, `Git: Commit…`, `Change Layout →`).

## Tests
- `src/palette.test.ts`: every dispatchable item of the read trees has a row; no label is listed twice and no two rows run one command (including every stacked `case` pair in `src/handlers/`); no separators, submenu headers or target-only labels; shortcuts match the items' hints and every `KEYMAP` command shows one; searches ("new folder", "git commit", "hidden", "find in", "tweaks"); path rows.
- `src/Palette.dom.test.tsx` (happy-dom): typing and Enter send the right label and close; ↓ follows the display order; a typed path is sent as is.
- `data.test.ts` and `keymap.test.ts` follow `PALETTE` → `PALETTE_ONLY`.

## Checks
`pnpm build`, `pnpm test`, `pnpm check:wiring`, `pnpm site:build`, `pnpm site:capture check` (under a 3 GB cap). The demo scene types "hidden" and "find in", which must still pick Show Hidden Files and Find in Files.
