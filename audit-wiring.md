# Wiring Audit — Glasshouse

_Generated: 2026-04-22T23:49:33.904Z_

Source: `design/project/src/data.jsx` + `components.jsx` vs `src/data.ts` + `src/handlers/*.ts`

## Summary

- total distinct labels: **293**
- design-only (never exposed in app): **11**
- app menu items with no handler case (stubs): **0**
- design labels missing everywhere (unrouted): **6**
- handler cases with no menu entry (orphan): **30**
- theater handlers (returns true but no real work): **1**
- raw UI elements (buttons/chips) not wired: **20**

## Missing everywhere (design says this exists; we don't route it) (6)

| label | kb | design | app | handler |
|---|---|---|---|---|
| `  feat/command-palette` |  | design:MENUS.Git |  |  |
| `  wip/theme-switcher` |  | design:MENUS.Git |  |  |
| `* main` |  | design:MENUS.Git |  |  |
| `Focus Pane ↑` |  | design:MENUS.Window |  |  |
| `Focus Pane ↓` |  | design:MENUS.Window |  |  |
| `Snap Left / Right` |  | design:MENUS.Window |  |  |

## Unwired stubs (menu item in app, no handler case) (0)

_none_

## Theater (handler returns true but body is only console.log / alert / no-op) (1)

| label | kb | design | app | handler |
|---|---|---|---|---|
| `Open Terminal Here` | Ctrl+` |  | app:MENUS.View | src/App.tsx |

## Design-only (present in design, absent in current menu tree) (11)

| label | kb | design | app | handler |
|---|---|---|---|---|
| `  feat/command-palette` |  | design:MENUS.Git |  |  |
| `  wip/theme-switcher` |  | design:MENUS.Git |  |  |
| `* main` |  | design:MENUS.Git |  |  |
| `About rice://` |  | design:MENUS.Help |  | misc.ts |
| `Focus Pane ↑` |  | design:MENUS.Window |  |  |
| `Focus Pane ↓` |  | design:MENUS.Window |  |  |
| `Git Status` |  | design:MENUS.View, design:CONTEXT_EMPTY |  | git.ts |
| `Keybindings…` |  | design:MENUS.Edit |  | misc.ts |
| `Reveal in Tree` |  | design:CONTEXT_FILE |  | src/App.tsx |
| `Snap Left / Right` |  | design:MENUS.Window |  |  |
| `Terminal Drawer` | Ctrl+` | design:MENUS.View |  | src/App.tsx |

## Dynamically covered (design label supplied by a runtime-resolved submenu) (21)

| label | kb | design | app | handler |
|---|---|---|---|---|
| `/etc/nginx` |  | design:MENUS.Bookmarks |  |  |
| `/mnt/c/Users/you/Desktop` |  | design:MENUS.File, design:MENUS.Bookmarks |  |  |
| `~/.config/nvim` |  | design:MENUS.Bookmarks |  |  |
| `~/Downloads` |  | design:MENUS.File, design:MENUS.Bookmarks |  |  |
| `~/Pictures/screens` |  | design:MENUS.Bookmarks |  |  |
| `~/projects/glasshouse` |  | design:MENUS.File, design:MENUS.Bookmarks |  |  |
| `~/school/cs3410` |  | design:MENUS.Bookmarks |  |  |
| `~/school/cs3410/lab07` |  | design:MENUS.File |  |  |
| `bash` |  | design:MENUS.Terminal |  |  |
| `fish` |  | design:MENUS.Terminal |  |  |
| `PowerShell` |  | design:MENUS.Terminal |  |  |
| `Show Checksums` |  | design:MENUS.View | app:MENUS.View | view.ts, src/App.tsx |
| `Show File Extensions` |  | design:MENUS.View | app:MENUS.View | view.ts |
| `Show Git Gutters` |  | design:MENUS.View | app:MENUS.View | view.ts |
| `Show Hidden Files` | Ctrl+H | design:MENUS.View | app:MENUS.View | src/App.tsx |
| `Show Ignored (.gitignore)` |  | design:MENUS.View | app:MENUS.View | view.ts |
| `Shred (srm)` |  | design:MENUS.Edit | app:MENUS.Edit | misc.ts |
| `SSH: void@server` |  | design:MENUS.Go, design:MENUS.Terminal |  |  |
| `WSL · Debian` |  | design:MENUS.Terminal |  |  |
| `WSL · Ubuntu` |  | design:MENUS.Terminal |  |  |
| `zsh` |  | design:MENUS.Terminal |  |  |

## Raw UI (buttons / chips / status clicks not wired) (20)

| label | kb | design | app | handler |
|---|---|---|---|---|
| `# hash` |  |  |  | chip[clickable] |
| `⌘ copy path` |  |  |  | chip[clickable] |
| `⌨ open in code` |  |  |  | chip[clickable] |
| `⌨ term` |  |  |  | status-seg[click] |
| `⎇ git blame` |  |  |  | chip[clickable] |
| `▶ run` |  |  |  | chip[clickable] |
| `◫ compress` |  |  |  | chip[clickable] |
| `Back (Alt+←)` |  |  |  | button[title] |
| `close` |  |  |  | span[title] |
| `Details view` |  |  |  | button[title] |
| `Forward (Alt+→)` |  |  |  | button[title] |
| `Grid view` |  |  |  | button[title] |
| `maximize` |  |  |  | span[title] |
| `Refresh (F5)` |  |  |  | button[title] |
| `split H` |  |  |  | span[title] |
| `split V` |  |  |  | span[title] |
| `Tab menu` |  |  |  | button[title], tab-btn |
| `Toggle hidden (Ctrl+H)` |  |  |  | button[title] |
| `Up (Alt+↑)` |  |  |  | button[title] |
| `zoom` |  |  |  | span[title] |

## Orphan handlers (case string matches nothing in design or menu) (30)

| label | kb | design | app | handler |
|---|---|---|---|---|
| `About Glasshouse` |  |  |  | misc.ts |
| `archive` |  |  |  | src/App.tsx |
| `Bookmarks →` |  |  |  | nav.ts |
| `Change Owner` |  |  |  | tools.ts |
| `Cheatsheet` |  |  |  | misc.ts |
| `code` |  |  |  | src/App.tsx |
| `copy-path` |  |  |  | src/App.tsx |
| `Delete` |  |  |  | src/App.tsx |
| `exec` |  |  |  | src/App.tsx |
| `Export Session` |  |  |  | misc.ts |
| `Find File by Name` |  |  |  | tools.ts |
| `git-blame` |  |  |  | src/App.tsx |
| `Go →` |  |  |  | nav.ts |
| `img` |  |  |  | src/App.tsx |
| `Move Tab Left` |  |  |  | nav.ts |
| `Move Tab Right` |  |  |  | nav.ts |
| `New File` |  |  |  | src/App.tsx |
| `open-in-code` |  |  |  | src/App.tsx |
| `Palette` |  |  |  | src/App.tsx |
| `Previous Tab` |  |  |  | nav.ts |
| `Reload` |  |  |  | misc.ts, src/App.tsx |
| `run` |  |  |  | src/App.tsx |
| `Settings` |  |  |  | src/App.tsx |
| `Shortcuts` |  |  |  | misc.ts |
| `Show Hidden` |  |  |  | src/App.tsx |
| `Shred` |  |  |  | misc.ts |
| `Template` |  |  |  | misc.ts |
| `text` |  |  |  | src/App.tsx |
| `Toggle Inspector` |  |  |  | src/App.tsx |
| `Up` |  |  |  | src/App.tsx, src/App.tsx (dispatch) |
