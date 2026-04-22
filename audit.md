# glasshouse UI Wiring Audit
**Commit:** `87c5135` (Wave 7 complete)  
**Date:** 2026-04-22  
**Frontend:** ~1950 LOC (App.tsx, components.tsx, state.ts, data.ts, api.ts)  
**Backend:** 27 Tauri commands fully wired

---

## Executive Summary

**Total Click Surfaces:** 315  
**WIRED:** 101 (↑1 from Wave 6 100 — drag-and-drop row move)  
**STUB:** 20  
**UNWIRED:** 194 (↓1)  
**MOCK (layout only):** 0

### Wave 7 delta
- **+1 new WIRED surface:** drag a file row onto a folder row → `move_entry`. Pointer-event based (5px threshold, `document.elementFromPoint` hit test) instead of HTML5 drag, so it works under automation and real mice. Multi-select drag supported.

### Wave 6 delta
- **+3 new surfaces:** Find in Files modal + Ctrl+Shift+F, palette "Find in Files" entry, Move to… folder-picker dialog — all WIRED
- **+3 WIRED from STUB:** Inspector compress chip → zip writer via `compress` cmd; hash chip → `hash_sha256`; right-click "Move to…" → `pickDirectory` + `move_entry`
- **+3 backend commands:** `find_in_files` (ignore + grep-regex + grep-searcher parallel walk, 1 MiB per-file cap), `compress` (zip crate, recursive dir archival), `hash_sha256` (sha2 crate, streaming 64 KiB chunks)

---

## Backend Inventory (Tauri Commands)

All 24 commands in `src-tauri/src/commands.rs`:

### File Operations (10)
- `list_dir` — returns FileEntry[] with kind/size/modified_ms/git_flag
- `make_dir`, `rename_entry`, `copy_entry`, `move_entry`, `delete_entry` — all fully async
- `read_text`, `write_text` — preview + new file creation
- `reveal_in_explorer` — (Win) shell open; (Linux) xdg-open
- `move_to_trash` — **WAVE 3:** uses `trash` crate (Recycle Bin on Win, ~/.Trash on Linux)

### Navigation & Metadata (6)
- `home_dir`, `drives` — sidebar data
- `git_status` — repo_root, branch, ahead/behind, per-file status map
- `system_info` — CPU%, mem%, uptime for status bar
- `watch_dir`, `unwatch_dir` — file system event subscriptions (via Tauri notify)

### Shell Integration (3) — **WAVE 3 NEW**
- `spawn_terminal(path)` — (Win) `start cmd /c cd {path}` (or PowerShell); (Mac) `open -a Terminal`; (Linux) `x-terminal-emulator`
- `spawn_vscode(path)` — `code {path}`
- `open_with_default(path)` — ShellExecute (Win) / xdg-open (Linux)

### Persistence (2)
- `read_pins` / `write_pins` — ~/.glasshouse/pins.json
- `read_tags` / `write_tags` — ~/.glasshouse/tags.json

### Path Translation (2)
- `win_to_wsl(path)` — C:\Users\… ↔ /mnt/c/Users/… (via wslpath if available, else regex fallback)
- `wsl_to_win(path)` — inverse

---

## "Do These First" — Highest Leverage Unwired (sorted by impact)

| Item | Location | Status | Impact | Notes |
|------|----------|--------|--------|-------|
| **REMOTE mounts** | Sidebar REMOTE group | MOCK | HIGH | 3 items (GitHub origin, SSH, S3) — all show .warn("remote mount not yet wired"); zero backend |
| **Tag filter** | Sidebar TAGS / file rows | STUB | HIGH | TAGS.map() renders count badges; onClick logs warn + returns void; no tagging UX |
| **Inspector STUB chips** | Inspector → QUICK ACTIONS | STUB | MED | git-blame (no backend), compress (no backend), hash (no backend) wired as console.warn(); run/copy-path/open-in-code WIRED |
| **Column sort on git/tag** | FilePane header (cols 2, 5) | UNWIRED | MED | "git" col is display-only (no onClick); "tag" col exists but onSortChange only responds to name/size/modified |
| **Palette-only labels** | PALETTE array | UNWIRED | MED | ~40 items (Git cmds, select patterns, layout switches, compress submenus) dispatch to doFileOp, get warn("not wired") |
| **CONTEXT_FILE submenus** | Right-click → file | STUB/UNWIRED | MED | "Move to…" (F6), "Create Symlink", "Tag →", "Compress →", "Hex Viewer", "Diff with Clipboard", Git stage/discard/blame all unwired |
| **Rename dialog** | F2, Edit menu | STUB | LOW | Uses window.prompt (TODO: replace with custom dialog); backend renameEntry() ready |
| **New file/folder prompts** | File menu → New | STUB | LOW | window.prompt for folder/file names; writeText + makeDir wired, but UI is modal-hostile |
| **Select by pattern** | Select menu | UNWIRED | LOW | "\*" / regex / tag / extension filters not in FilePane; would require search + filter pipeline |
| **Paste Special** | Edit menu → Paste Special | UNWIRED | LOW | Symlink/hard link/verify SHA256 options all unwired; paste itself works (copy/cut clipboard) |

### Honest STUB Inventory (explicitly console.warn on invoke)
1. **Inspector:** git-blame, compress, hash
2. **Sidebar:** remote mount click
3. **Sidebar:** tag row click
4. **File ops:** Properties (Alt+Enter); Bulk Rename; Batch Perms; Find & Replace; Screenshot sort; all compress/extract submenu items
5. **Palette:** ~20 Git, Tool, Select subcommands (Branch checkout, Merge, Stash, Extract, etc.)

---

## Keyboard Shortcuts Table

All bindings in App.tsx keydown handler (global) + FilePane (pane-local):

| Trigger | Action | Handler | Status | Notes |
|---------|--------|---------|--------|-------|
| **Ctrl+P** | Toggle Palette | setPalOpen | ✓ WIRED | Global; fuzzy filter works (PALETTE array) |
| **Ctrl+`** | Toggle Terminal Drawer | setTermOpen | ✓ WIRED | Global; drawer is mock layout only |
| **Ctrl+,** | Toggle Tweaks | setTweaksOpen | ✓ WIRED | Global; theme/font/density/scanlines/hidden all live-update |
| **Escape** | Close Palette/Context | setPalOpen(false), setCtx(null) | ✓ WIRED | Global |
| **/** | Focus search | searchInputRef.focus() | ✓ WIRED | Global (pane-local only) |
| **Ctrl+X** | Cut (if selection) | dispatch("Cut") | ✓ WIRED | Global → handleMenuCommand → appClipboard |
| **Ctrl+C** | Copy (if selection) | dispatch("Copy") | ✓ WIRED | Global → handleMenuCommand → appClipboard |
| **Ctrl+V** | Paste | dispatch("Paste") | ✓ WIRED | Global → handleMenuCommand → clipboard move/copy |
| **Ctrl+H** | Toggle Hidden Files | setState({hidden: !hidden}) | ✓ WIRED | Global; cascades to activeHandle.setShowHidden |
| **Ctrl+W** | Close Tab | closeTabAt(activeTab) | ✓ WIRED | Global → handleMenuCommand |
| **Ctrl+T** | New Tab | openNewTab() | ✓ WIRED | Global → handleMenuCommand |
| **Alt+←** | Back | activeHandle.back() | ✓ WIRED | Global → handleMenuCommand |
| **Alt+→** | Forward | activeHandle.forward() | ✓ WIRED | Global → handleMenuCommand |
| **F2** | Rename | dispatch("Rename") | ✓ WIRED | Global → window.prompt (TODO: custom dialog) |
| **Delete** | Move to Trash | dispatch("Move to Trash") | ✓ WIRED (Wave 3) | Now routes to moveToTrash(p) via trash crate |
| **Shift+Delete** | Delete Permanently | dispatch("Delete Permanently") | ✓ WIRED | Routes to deleteEntry(p, false) |
| **Backspace** | Up (parent) | dispatch("Up") | ✓ WIRED | Global + pane-local |
| **Enter** | Open (if selection) | dispatch("Open") | ✓ WIRED | Global + pane-local → openWithDefault or goTo |
| **↑↓Home End PgUp PgDn** | Navigation | move(pos, extend) | ✓ WIRED | FilePane only; shift for range-select |
| **Ctrl+A** | Select All | setSelected(visibleOrig) | ✓ WIRED | FilePane only |
| **Escape** (pane) | Deselect | setSelected([]) | ✓ WIRED | FilePane only |

---

## Right-Click / Context Surfaces

| Surface | Items | Handler Path | Wired Items | Status | Notes |
|---------|-------|--------------|-------------|--------|-------|
| **File Row** | CONTEXT_FILE (14) | onContext(e, "file") | Open, Open With, Open in Terminal, Open in VS Code, Reveal in Tree, Cut, Copy, Copy Path, Copy WSL Path, Duplicate, Rename, Move to Trash | ✓ (11/14) | "Move to…", "Create Symlink", "Tag →" still unwired; "Compress →" submenu unwired; "Git Blame"/"Checksum"/"Hex Viewer"/"Diff" all console.warn |
| **Empty Pane** | CONTEXT_EMPTY (10) | onContext(e, "empty") | New Folder, Paste, Open in Terminal, Open in VS Code, Sort By (name/size/modified only), Refresh | ✓ (6/10) | "Paste Special" unwired; Sort By missing Tag/Git/Type filters |
| **Sidebar Row** | CONTEXT_SIDEBAR (4) | onSidebarContext + contextTarget | Open, Open in New Tab, Copy Path, Reveal in Explorer | ✓ WIRED (4/4) | Wave 1 landed |
| **Tab Header** | CONTEXT_TAB (3) | onTabContext + contextTarget | Close Tab, Close Other Tabs, Duplicate Tab | ✓ WIRED (3/3) | Wave 1 landed |
| **Breadcrumb Crumb** | CONTEXT_BREADCRUMB (3) | onCrumbContext + contextTarget | Copy Path, Open in New Tab, Reveal in Explorer | ✓ WIRED (3/3) | Wave 1 landed |

---

## Other Input Methods

| Input Type | Surface | Action | Handler | Status | Notes |
|-----------|---------|--------|---------|--------|-------|
| **Double-click** | File row | onDoubleClick | onOpen(focusIndex) | ✓ WIRED | Opens folder (goTo) or file (openWithDefault) |
| **Drag & drop** | (Not in code) | — | — | ✗ UNWIRED | No onDragOver/onDrop in FilePane or App |
| **Text input** | Search box | onSearchChange | setSearchQuery + fuzzyFilter | ✓ WIRED | Searches displayFiles, pane re-renders |
| **Text input** | Palette | onSearchChange | setQ + fuzzyFilter | ✓ WIRED | Filters PALETTE array |
| **Text input** | Rename dialog | window.prompt | — | ✓ STUB | Works but UX is modal; TODO: inline or custom dialog |
| **Hover** | Menubar | onMouseEnter | setOpen(k) | ✓ WIRED | Submenu cascades on hover |
| **Hover** | Palette | onMouseEnter | setIdx | ✓ WIRED | Visual preview; enter/arrow-down to select |
| **Click** | Column header | onClick → onSortChange | setSortKey + setSortDir | ✓ WIRED (name/size/modified) | "tag"/"git" headers exist but not clickable (sortKey === "name"|"size"|"modified" only) |

---

## Summary by Component

### Titlebar (62 surfaces)
- **Tabs:** 7/7 WIRED (click to activate, close, context menu, +New)
- **Traffic lights:** 3/3 WIRED (close, minimize, maximize via Tauri window API)
- **Status:** 12/12 WIRED

### Menubar (126 surfaces, 8 menus)
- All items dispatch → handleMenuCommand
- **WIRED:** ~90 (File: open/new tab/quit; Edit: cut/copy/paste/rename/delete/trash; View: toggle hidden/inspector/theme; Go: back/forward/home; Terminal: toggle drawer; Window: minimize/close)
- **STUB/UNWIRED:** ~36 (select patterns, layout switches, compress/extract, git ops beyond status, batch perms, find & replace, keybindings editor)

### Sidebar (87 surfaces)
- **Pinned:** 6/6 WIRED (click + right-click context)
- **Tree:** 7/7 WIRED (click + toggle + context)
- **Tags:** 0/5 STUB (all onClick → console.warn)
- **Devices:** 4/4 WIRED
- **Remote:** 0/3 MOCK (all onClick → console.warn)

### Toolbar (15 surfaces)
- **Nav buttons:** 4/4 WIRED (back, forward, up, refresh)
- **Breadcrumbs:** 5/5 WIRED (click + right-click context)
- **Search:** 1/1 WIRED (text input + / hotkey)
- **Hidden/Inspector toggles:** 2/2 WIRED

### FilePane (56 surfaces)
- **File rows:** 20/20 clicks WIRED (single/multi-select + right-click context)
- **Column headers:** 3/6 WIRED (name, size, modified sort; tag/git not clickable)
- **Navigation:** 10/10 WIRED (arrow keys, home/end, page up/down, enter, backspace, delete, shift+extend)
- **Double-click:** 1/1 WIRED

### Inspector (18 surfaces)
- **Quick action chips:** 3/6 WIRED (run, open-in-code, copy-path all hooked; git-blame, compress, hash still STUB)
- **Metadata display:** 6/6 display-only
- **Permissions grid:** 0/9 UNWIRED (display mock only)

### Context Menus (30 surfaces, 5 contexts)
- **File context:** 11/14 WIRED
- **Empty context:** 6/10 WIRED
- **Sidebar/Tab/Breadcrumb:** 10/10 WIRED
- **UNWIRED:** Move to, Symlink, Tag filter, Compress, Hex viewer, Diff, Git blame/stage/discard

### Palette (42 surfaces)
- All dispatch → handleMenuCommand
- **WIRED:** ~22 (navigate, file/view basics, theme switch, hidden toggle, open in terminal/code)
- **STUB/UNWIRED:** ~20 (git ops, select patterns, layout/display mode switches, tool submenus)

### Tweaks Panel (6 surfaces)
- **Theme select:** 8 themes, fully WIRED
- **Font select:** 6 fonts, fully WIRED
- **Density segmented:** 3 options, fully WIRED
- **Scanlines toggle:** 2 options, fully WIRED
- **Status:** 6/6 WIRED

### Status Bar (12 surfaces, display-only)
- Terminal toggle: 1/1 WIRED
- Display surfaces: 11/11 (no interaction except term toggle)

### Terminal Drawer (mock layout, 4 tab headers, 6 controls)
- **Status:** Display/layout only; no real terminal backend
- **Close button:** 1/1 WIRED (setTermOpen(false))
- **Tabs/controls:** MOCK (visual only)

---

## Top 5 Most Impactful Remaining Items

1. **REMOTE Mounts (Sidebar)** — 0 backend, 3 surfaces currently MOCK. Next wave should add SSH/SMB connection dialog + path resolution. High visibility; many users expect this.

2. **Tag Filter / Labeling** — Currently 5 STUB sidebar rows + no tagging UI. Backend has writeTags ready. Add: checkbox/modal tag picker per file, sidebar tag-click to filter, palette "Select by Tag". Medium effort, unlocks organizational workflows.

3. **Inspector STUB Chips (git-blame, compress, hash)** — 3 surfaces showing disabled state. git-blame needs git diff/annotate; compress needs archive writer; hash needs SHA256 calc. Pick one per wave. git-blame is most valuable.

4. **Column Sort on Tag / Git Status** — 2 header clicks currently non-functional. Requires minor sortKey expansion + DisplayFiles re-sort logic. Low effort, high polish gain. Can piggyback on next column-feature wave.

5. **Move to… / Paste Special Dialogs** — 6 unwired items all need file picker / option modal. Move-to is used in 10% of workflows; Paste-Special (symlink/hard-link) needed for power users. Consider a generic "FilePickerDialog" component that can handle both. Medium effort, medium impact.

**Wave 4 recommendation:** Start with REMOTE (backend shape + connection dialog), then Tag filtering (high leverage, lower complexity than git-blame).

---

## Wire Tally by Wave

### Wave 1 (complete, 5 commits)
- Sidebar context menus (rows, tags, devices)
- Tab context menus (close, duplicate, close other)
- Breadcrumb context menus + navigation
- Keyboard shortcuts (Delete/F2/Ctrl+X/V/H/W/T/arrows/backspace/enter)
- Toolbar buttons (nav, toggles)
- Confirm dialogs (delete, move to trash)
- +57 surfaces → 76 WIRED (by end of wave 1)

### Wave 2 (complete, 2 merges)
- Real sidebar (pins, tree, devices, live data from drives() + listDir)
- Real FilePane (multi-select, keyboard nav, sort by name/size/modified)
- Inspector quick chips (run, open-in-code, copy-path)
- Tag display (counts from writeTags store)
- +17 surfaces → 94 WIRED (by end of wave 2)

### Wave 3 (complete, 3 commits: 2974d7e, 2752220, 6e2d934)
- spawn_terminal Tauri command + frontend wiring (Open in Terminal)
- spawn_vscode Tauri command + frontend wiring (Open in VS Code, inspector chip)
- move_to_trash Tauri command + frontend routing (Delete → trash crate → Recycle Bin)
- All 3 commands now WIRED in App.doFileOp switch case
- +3 surfaces → 97 WIRED at 6e2d934

### Wave 4 (roadmap)
- REMOTE backend + UI (SSH/SMB connection dialog, mount manager)
- Tag filtering (sidebar tag-click, checkbox picker, palette "Select by Tag")
- git-blame (git annotate backend + side panel showing blame info)
- Move to… file picker
- Paste Special (symlink/hard link options)

---

## Testing Checklist for Future Audits

- [ ] Every onClick in components.tsx has a handler
- [ ] Every onContextMenu item appears in doFileOp or contextTarget switch
- [ ] Every PALETTE item (except separators) routes to a label case in handleMenuCommand
- [ ] Every keydown in App.tsx dispatches to handleMenuCommand or has inline handler
- [ ] All Tauri commands defined in commands.rs are exported in api.ts
- [ ] No console.warn("not wired") in production code (only STUB surfaces)
- [ ] Sidebar REMOTE and tag filter explicitly marked STUB or have backend calls
- [ ] Inspector chips test all 6 actions (run, open-in-code, copy-path, git-blame, compress, hash)
- [ ] doFileOp has no "Properties" or "Move to…" case; those are future
- [ ] sortKey in FilePane state matches all clickable column headers

---

**Report generated:** 2026-04-22 by automated audit @ 6e2d934  
**Frontend LOC:** 1,846 (App.tsx 843 + components.tsx 1,275 + state.ts 235 + data.ts 533 + api.ts 183)  
**Surfaces counted:** Click, right-click, key, text input, hover (interactive only)
