# Glasshouse bug report — 2026-04-22

Compiled from a demo-driver run against `src-tauri/target/release/glasshouse.exe` (commit `831e885`, rebuilt on 2026-04-22 17:16 with the `system_info()` cache fix). App launches, navigates, renders correctly. Perf at rest looks fine (CPU ~6%, mem ~51%, grid paints instantly on cd). User-reported sluggishness was not reproduced in a 30-step walk, but was also not stressed — see §5.

## Broken flows (reproduced)

| # | Flow | Observed | Expected |
|---|------|----------|----------|
| 1 | Right-click file → **Tag → Add Tag…** | Menu closes. No tag-picker dialog opens. | `TagPickerDialog` appears. |
| 2 | Right-click empty → **New → Text File** | Menu closes. No prompt. No file written. | `window.prompt` for filename, file created. |
| 3 | Right-click file → **Open With → VS Code** | Menu closes. VS Code never spawned (checked via `Get-Process code*`). | VS Code opens the file, or alert if `code` not on PATH. |
| 4 | Right-click file → **Open With → Default App** | Menu closes. Nothing launches. | Windows default handler opens the file. |
| 5 | Right-click file → **Rename** (top-level ctx item) | Menu closes. No prompt. | Same prompt as F2. |

## Works (for contrast)

| Flow | Result |
|------|--------|
| **F2** keyboard → Rename | Native `tauri.localhost says` prompt appears, rename succeeds. |
| Menubar **Git → Commit…** | Prompt appears, dispatch works. |
| Menubar dropdowns in general | Fine. |
| Folder navigation, breadcrumb, status bar | Fine. |

## Root cause

**All five broken flows share one trait: they are triggered from the right-click context menu.** The menubar uses the same `handleMenuCommand` dispatcher and works. The keyboard (F2) uses the same dispatcher via `handleMenuCommandRef.current` and works. `window.prompt()` in this WebView2 build is not globally broken — menubar Commit… proves it renders fine.

So the bug is **specifically in `ContextMenu` click dispatch**, not in:
- `window.prompt` / WebView2
- `handleMenuCommand` switch
- `doFileOp` handler cases
- Selection state (F2 + ctx menu both rely on the right-clicked row being selected, and F2 works)

`src/components.tsx:1737` `ContextMenu` sets up `document.addEventListener("mousedown", onClose, { once: true })` via `setTimeout(0)`. The surrounding `<div className="ctx-menu">` stops **click** propagation but **not** `mousedown`. Strongly suspected sequence:

1. User mousedown on `.mi` → bubbles to `document` (not stopped)
2. document listener fires → `onClose()` → `setCtx(null)` queued
3. React re-renders — possibly before `click` fires on the now-unmounted `.mi`
4. `MenuItem` `onClick` never runs → `onAction` never called → no dispatch

This matches every observation: submenu flyout renders (hover-driven, no state update), click does nothing (the re-render preempts click), menubar works (different close logic), F2 works (no context menu involved).

**One-line fix candidate** — add `onMouseDown={(e) => e.stopPropagation()}` to the `.ctx-menu` wrapping div at `src/components.tsx:1746`. Not yet verified by rebuilding and re-running.

## Secondary issue (still TODO)

110 call sites across `src/` use `window.prompt` / `window.alert` / `window.confirm`. These currently work in WebView2 (per the menubar-Commit evidence), but render as browser-chrome `tauri.localhost says` dialogs instead of themed app dialogs. Ugly but functional. Can be migrated to `tauri-plugin-dialog` or a custom React modal later — not blocking.

## Perf change shipped this rebuild

`src-tauri/src/commands.rs` — `system_info()` was calling `sysinfo::System::new_all()` every 2s from the StatusBar poll. `new_all()` enumerates every process, disk, and network adapter; very expensive on Windows. Replaced with a process-lifetime `OnceLock<Mutex<System>>` that refreshes only CPU + memory. This may or may not be the sluggishness the user reported — demo-driver did not reproduce sluggishness on the new build, but also did not stress it.

## What was not tested

- Drag and drop
- Sidebar tag filter click behavior
- Large directory (>1k entries)
- Tag column rendering after a successful tag save (blocked by §1)
- Palette (Ctrl+P) dispatch — not reproduced but uses different component, likely fine
- Every other right-click submenu leaf (Compress, Git: Stage, Hex Viewer, Diff with Clipboard, etc.) — blocked by the same root cause as §1-5.

## Next action

Verify the one-line fix: add `onMouseDown={(e) => e.stopPropagation()}` to `.ctx-menu` wrapper, rebuild, confirm all five flows pass. If the fix works, it unblocks every ctx-menu handler in one change.

---

## Fixes shipped on 2026-04-23 (team batch)

Parallel fixes dispatched across four agents. tsc --noEmit clean.

### Tags / sidebar (sidebar-tags)
- **Sidebar TAGS aggregation** — was iterating `Object.keys(tags)` which is the *path* list, not the tag-name list; tagging one file caused the sidebar to show that file's path in place of the seed tags. Rewritten to invert the store (walk values, count per tag name) and always render SEED_TAGS first, then user tags alphabetically.
- **TagPickerDialog seeds** — `allTags`/`shownTags` now seeded from `SEED_TAGS` + store, so the 5 premade tags always show as chips with their colors even when nothing has been tagged yet.
- **Unified sidebar right-click** — Sidebar row handlers now pass a `kind` (pinned / tree-folder / tree-file / drive / remote / wsl) to `onRowContext`; App picks CONTEXT_FILE for files, CONTEXT_SIDEBAR_FOLDER for folders, CONTEXT_SIDEBAR_DRIVE for drives, CONTEXT_SIDEBAR_PINNED for pins. Expanded the sidebar/breadcrumb dispatch branch to handle Open, Open in New Tab/Window, Open in Terminal/VS Code, Copy Path, Copy as WSL Path, Copy as Command, Reveal, Rename, Move to…, Move to Trash, Pin/Unpin, Add Tag against `ctxT.path`.
- **Tree section controls** — the ⋯ button in TREE is now a popover: Show hidden, Show files, Follow active tab, Collapse all, Refresh, Change root… Prefs persisted under `glasshouse.tree.prefs`. Follow-active auto-expands ancestors of the active path.
- **WSL in Devices** — new `list_wsl_distros` Tauri command (CREATE_NO_WINDOW, UTF-16LE decode, BOM/NUL strip). Sidebar DEVICES group now renders each distro below the drive list; click navigates to `\\wsl$\<name>\`.

### Terminal drawer (terminal)
- Restored the original design chrome (`.term-drawer.open` / `.term-head .ttab` / `.term-body` from design mockups) and wired a **real PTY** beneath it via `portable-pty = "0.9"`.
- New `src-tauri/src/pty.rs`: `PtyRegistry` + `pty_spawn` / `pty_write` / `pty_resize` / `pty_kill`. Uses `clone_killer()` to avoid kill/wait deadlocks. Emits `pty-data` + `pty-exit` events. ConPTY backend on Windows → no visible console flash.
- New `src/Terminal.tsx`: renders the original drawer chrome, mounts xterm.js + FitAddon. Each shell profile gets a `.ttab` with the green ✓ for active. Tab switch respawns PTY; cwd change sends `cd "<new path>"` to the live session.
- App.tsx: `termOpen` state, Ctrl+\` toggles drawer (was: `spawnTerminal`), status bar `⌨ term` click toggles drawer, menu "run-profile" payload opens drawer with that profile. Drawer stays mounted (slides via `.open` class) so xterm state persists across toggles. Menubar "Open External Terminal" unchanged.

### Branding / View menu / jitter (branding-view)
- **rice:// removed** from src/components.tsx (5 sites), src/data.ts, src/styles/{app,themes}.css, src/handlers/misc.ts, src-tauri/Cargo.toml description, src-tauri/tauri.conf.json productName + window title. `grep -rn "rice://"` across source now returns zero.
- **Display Mode** (`html[data-display-mode=…]`) — compact-list (smaller rows), details-rows (baseline), grid-thumbs (card grid on `.pane .rows`), icons (flex-wrap 90x90 tiles), tiles (2-col grid with 32px icons), miller-columns-ranger (stub banner), tree-flat (denser rows + green top border).
- **Layout** (`html[data-layout=…]`) — tree-pane-inspector (baseline), single-pane (hides sidebar + inspector), other modes show a "preview" banner so unsupported layouts are visibly acknowledged rather than silent.
- **Persistence** — App.tsx mount useEffect reads `glasshouse.displayMode` / `glasshouse.layout` from localStorage and sets the attrs so the choice survives relaunch.
- **Status bar jitter** — each numeric segment is now wrapped with `inline-block` + `minWidth: Xch` + `textAlign: "right"` via a `numStyle(ch)` helper; `.statusbar` pinned to 22px fixed height with `overflow: hidden; white-space: nowrap`. `font-variant-numeric: tabular-nums` applied to `.sb-seg .val` for safety.

### Dialogs / palette / preview (dialogs-palette)
- **Themed modal** — `DialogHost` + `dialogs.showPrompt` / `showAlert` / `showConfirm` / `showToast` singleton. Enter submits, Esc cancels, click-out dismisses, validation errors render inline. Migrated Rename (F2 + sidebar + file-op), Delete Permanently, Move to Trash multi, New Folder / New Text File / Markdown Note / Script(.sh), Remove Tag, Compress to ZIP, Git: Commit / Amend / Checkout / New Branch / Merge / Rebase / Clean Untracked / Discard, Select by Pattern / Regex / Extension, Go to Path, Find File by Name, Batch Permissions, final catch-all alert. ~71 low-value callsites left on `window.prompt` for a later pass.
- **Move to… in-app picker** — new `FolderPickerDialog`: drive list left, folder list right, breadcrumb + up button, "move here" / "cancel" footer. Both sidebar and file-op `Move to…` route here instead of Tauri's native dialog. `pickDirectory` import removed from App.tsx.
- **Palette defaults** — the `default:` case in handleMenuCommand now shows `dialogs.showToast({ message: '"<label>" — not yet wired', variant: 'warning' })` so palette commands can never be silent no-ops again. Submenu-parents ("Open Recent →", "Jump to Bookmark →", "Git: Checkout Branch →", "Change Layout →") now actually do something useful.
- **Preview** — loading state ("reading…" / "loading image…"), binary detection (NUL byte + non-printable ratio heuristic) → "binary — no preview", explicit read-error state ("can't preview: <reason>"), empty-file state distinguished from "no selection", 10 MB image guard with "render anyway" button, image dimensions chip, scroll position persisted per-path via module-level `previewScrollOffsets`, extended text-like detection via `TEXT_EXT_FALLBACK`.

### Verification
- `pnpm tsc --noEmit` passes clean across all touched files.
- Final win-build kicked off 2026-04-23 after all tasks merged; exe at `src-tauri/target/release/glasshouse.exe`.

---

## Polish batch 2 shipped on 2026-04-23

Second parallel dispatch — 5 agents, 18 scoped tasks + final build. All tasks tsc-clean.

### Menu cleanup (menu-cleanup)
- **Dead commands removed** — Run Last Command, Send Path to Shell, cd Here, Hex Viewer gone from `src/data.ts` menus, their handler cases in `handlers/misc.ts` / `nav.ts` / `tools.ts`, the `lastCommandRef` singleton in `state.ts`, the `lastCommandInterceptor` in `handlers/index.ts`, and the HexDialog wiring in `App.tsx`. HexDialog component export left in place (unused, harmless).
- **Dead chevron removed** — no-op `⌄` "Tab menu" button next to duplicate-tab was deleted from Titlebar tab-actions.
- **Window menu trimmed** — down to 7 working items (Next/Prev Tab, Move Tab →/←, Always on Top, Minimize, Close Window). Removed Split Right/Down (redundant with View > Layout) and Pin to Workspace. Wired Ctrl+Tab / Ctrl+Shift+Tab / Ctrl+M so displayed keybinds actually fire.
- **Bookmark context item** — "Add Bookmark" added between Open With and Cut in CONTEXT_FILE; reuses the existing pin infrastructure, toasts "pinned <name>" / "already pinned".
- **Redundant ctx items** — Open in Terminal / Open in VS Code / Reveal in Explorer stripped from CONTEXT_FILE, CONTEXT_EMPTY, and all sidebar ctx menus. Kept in File menubar + palette TOOLS + breadcrumb menu.
- **Compress consolidation** — top-level "Compress to ZIP…" removed from CONTEXT_FILE; accessible only via Compress → submenu now. Handler still reachable from empty-area shortcut.
- **Keybindings Cheatsheet modal** — new `KeybindingsDialog` component walks MENUS + a global-binds list, groups by category, scrollable, Esc/click-outside closes. Dispatched from Help → Keybindings Cheatsheet, bound to F1 and Ctrl+?.

### Sidebar / tags / check marks (sidebar-tags2)
- **Menu check marks reactive** — removed hardcoded `check: true` from Layout/Display Mode entries in `data.ts`. `resolveChecked(item, parentLabel)` reads localStorage at render; `SubDropdown` forwards `parentLabel` so the ✓ follows the saved selection.
- **Change root uses FolderPicker** — `Sidebar` has a new optional `onPickTreeRoot` prop wired to App's existing `folderPicker` state, so TREE "Change root…" now opens the themed picker instead of the native dialog.
- **Collapse all fixed** — `collapseAll` rebuilds `expanded` as `{ [rootPath]: true }` (was a merge that didn't actually collapse), pre-fetches root kids async so the tree doesn't flash empty.
- **Pinned right-click expanded** — `onSidebarContext` now builds the pinned menu dynamically: Unpin on top, Move pin up/down when applicable, separator, then the full CONTEXT_SIDEBAR_FOLDER menu with the inner "Pin" stripped. Move-pin-up/down handlers added.
- **Tag icon + filename overlap fix** — `.row .name` converted to `display: flex; min-width: 0; overflow: hidden` with inner ellipsis on the filename span. `.row .tag` gets `overflow: hidden; min-width: 0` plus `flex: 0 0 7px` on `.dot` so the tag column can't bleed into the name column. Folder tag counts already worked — confirmed `Object.values` iteration is kind-agnostic.

### Terminal polish (terminal-polish)
- **xterm theme follows CSS vars** — reads `--bg-1`/`--fg-1`/`--accent`/`--green`/`--red`/`--yellow`/`--blue`/`--magenta`/`--cyan`/`--bg-sel`/`--fg-3` via `getComputedStyle`. MutationObserver on `<html data-theme>` live-updates xterm when theme swaps.
- **Tab labels match design** — `prefix · label` format (sh · pwsh, wsl · Ubuntu, ssh · void@server) per mockup; active tab keeps the green ✓; decorative `+` new-tab placeholder restored.
- **X close wired** — `onClick` now calls `handleClose` → `onClose` → `setTermOpen(false)` with stopPropagation to prevent bubble.
- **Export profile-aware** — `spawnTerminalProfile(active, cwd)` replaces the old hardcoded `spawnTerminal(cwd)`, so the ↗ button opens the currently-active shell profile (pwsh / cmd / bash / wsl) externally, not the Windows default.
- **CSS tidy** — `.term-drawer` gets `font-family: var(--font-mono)` (so header tabs render in JetBrains Mono), `.term-body` padding restored to `8px 12px` per design, xterm viewport scrollbar styled 8px with `--border-strong` thumb.

### Themed dialogs (themed-dialogs)
- **Remove All Tags** — new case in App.tsx `doFileOp` uses `dialogs.showConfirm({ danger: true })`, then deletes from tagStore and persists via writeTags.
- **Go to WSL** — `handlers/nav.ts` now calls `listWslDistros()` and uses `dialogs.showPrompt` with the list in the message + first distro as placeholder.
- **Connect to Server** — `handlers/tools.ts` replaces the prompt chain with two sequential `showPrompt`s (host + label), saves via existing logic, toasts success.
- **Clipboard Stack** — empty case toasts "Clipboard stack is empty" (variant: info); non-empty uses `showAlert` with the listing.
- **Git Blame failure** — Inspector quick-action chip uses `dialogs.showAlert({ variant: "error" })` instead of `window.alert`.

### Features (features)
- **Real split layouts** — `split-horizontal` and `split-right` now render two FilePanes via a `panes` semantic (pane1Path/pane1Handle/activePaneIdx), seeded to the active cwd when the layout flips. Preview banner removed from these two. `dual-pane-top-bottom`, `split-vertical`, `tmux-quad-4-pane` still stubbed with banners (deferred).
- **Drag-and-drop** — file-pane → folder row (move; Shift = copy); file-pane → sidebar tree-folder / pinned row via new `onExternalDrag` callback walking to `[data-sidebar-drop-path]`. Floating `.drag-ghost` shows item count + mode ("move 3 items"). Undo pushed per drop. Breadcrumb drops + sidebar-to-pane drags deferred.
- **Marquee box-select** — pointer rectangle on empty pane area, row intersection via `getBoundingClientRect`. Plain drag replaces, Shift adds, Ctrl XORs. Auto-scroll near edges; Esc cancels. Skips when mousedown hits an existing row or the pane header.
- **Keyboard nav** — Tab/Shift+Tab/F6/Shift+F6 cycles sidebar → files → (terminal if open). `html[data-focused-pane]` attribute + CSS outline on active pane. xterm captures keys when its pane is active (no preventDefault). Inspector skipped (read-only); old F6=Move to… binding removed.

### Verification
- `pnpm tsc --noEmit` clean across all touched files.
- Final win-build 2026-04-23 after second merge — exe at `src-tauri/target/release/glasshouse.exe`.

---

## Polish batch 3 shipped on 2026-04-23

Third parallel dispatch — 4 agents, 20 scoped tasks + final build. All tsc-clean.

### Menu reductions (menu-reducer)
- **Session system gone** — Save/Import/Export Session items removed from File menu; `sessionDir` / `sessionPath` / `writeSession` helpers + all "Session" cases in handlers/misc.ts deleted. Kept "New Private Session" (unrelated private-tab concept) and "Export Layout (.ricerc)".
- **Back / Forward / Up stripped from Go** — keybinds Alt+←/→ still active in App.tsx keydown; handler cases kept for dispatch.
- **Window menu deleted entirely** — removed Always on Top / Move Tab Left/Right / Minimize / Close Window handlers + unused imports (winMinimize, setAlwaysOnTop). Added Next Tab + Previous Tab to GLOBAL_BINDS so they appear in the Keybindings Cheatsheet modal.
- **"Open Terminal Here" removed from View** — Ctrl+` embedded terminal covers it; File > "Open in Terminal" kept for the external-terminal path.
- **Edit menu dedupe** — "Edit .ricerc" removed (duplicate of "Preferences…", both dispatched ctx.openTweaks); Ctrl+, binding kept on Preferences.
- **Pane-splitting rolled back** — View > Layout now only "Tree + Pane + Inspector" + "Single Pane". Deleted `layoutSlug` / `splitActive` / `pane1Path` / `pane1Handle` / `activePaneIdx` / `pane1RootRef` state + the MutationObserver + pane1 seed/teardown effect. Dropped panes-wrap and pane1 TabShell. Removed split-horizontal / split-right / split-vertical / tmux-quad / dual-pane-top-bottom blocks + `.pane-host` + `.pane-active` flex rules from app.css.
- **Zoom root-cause fixed** — both `html` and `body` had `font-size: var(--fs-base, 13px)` which beat the inline `html.style.fontSize = Xpx`. Rewrote `adjustZoom` to set the `--fs-base` custom property on html + persist to `glasshouse.zoom`. Reset clears the inline var. Mount-time effect restores on launch. Added Ctrl+= / Ctrl+- / Ctrl+0 global bindings.

### Themed popups + pin (dialog-polish)
- **Open → themed prompt** — `nav.ts` "Open…" / "Open Path…" cases now use `dialogs.showPrompt` with validate.
- **BookmarkManagerDialog** — new modal: list with ↑↓ reorder, × remove, click-to-jump, cancel/save. Mounted next to TagPickerDialog via `bookmarkManagerOpen` state; onSave writes pins + toasts success. "Manage Bookmarks" and "Manage Bookmarks…" cases both routed here.
- **Screenshot Stack / File Queue** — both paths migrated: empty/error → `dialogs.showAlert({variant:"error"})`, success listings → `showAlert({variant:"info"})`.
- **Go to Trash stub** — `Trash` / `Go to Trash` / `Go to Trash…` now show a themed toast ("trash view coming in v2"). `openUrl` import removed; Explorer is never spawned. The COM route (FOLDERID_RecycleBinFolder) was ruled out as too heavy this pass.
- **+ on Pinned title fixed** — `onAddPin` in App.tsx now toasts all three paths (no active folder, already pinned, pinned). Added `e.stopPropagation()` to the + span so it won't toggle the collapsible PINNED group.

### Keyboard + clipboard + undo + tabs (keyboard-clipboard)
- **Sidebar arrow nav** — new `selectedIdx` state + flat `navRows` (pins → tree → tags → drives → wsl → remotes). `onKeyDown` on `<aside>`: ↑/↓ moves, Enter activates (goTo / tagFilter / onRemoteClick), ← collapses or hops to parent, → expands or hops to first child, Home/End jump. Skips `.sb-title` (collapse toggle) and form inputs. `stopImmediatePropagation` on Enter prevents double-dispatch. `data-sb-nav-idx` + `.sb-item-focused` class; accent outline + tint CSS.
- **Clipboard** — `cutPaths` React state mirrors the clipboard's cut paths; `<FilePane cutPaths={cutPaths} />` applies `.row.clip-cut { opacity: 0.5 }`. Toasts on Copy/Cut/Paste (count, "clipboard is empty").
- **Undo/Redo** — Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z globally bound; dispatch "Undo" / "Redo" through misc.ts → ctx.undo?.() / ctx.redo?.(). Toasts (undid: X / redone: X / nothing to undo) and error alerts on inverse failure.
- **Next/Prev Tab root-cause** — Tab/F6 pane-cycle handler was matching `e.key === "Tab"` without modifier check, swallowing Ctrl+Tab before tab-cycle could run. Fix: moved Ctrl+Tab dispatch above the pane-cycle block and added `!e.ctrlKey && !e.metaKey` guard. Removed the unreachable duplicate block.

### Collapsible/draggable sidebar + reactive check marks + terminal cd (sidebar-terminal)
- **Collapsible groups** — `sbCollapsed: Record<string, boolean>` persisted to `glasshouse.sb.collapsed`. Each `.sb-title` is `tabIndex=0 role="button" aria-expanded`, click or Enter/Space toggles. `▸/▾` chevron per title. Body unrendered when collapsed; navRows + navStart skip collapsed groups so arrow nav stays consistent.
- **Draggable groups** — `sbOrder: SbGroupKey[]` persisted to `glasshouse.sb.order`. Group render split into per-key functions iterated in order. Pointer drag on `.sb-title` tracks y-position, computes drop index via title rects, commits on release (4px threshold). `Alt+↑` / `Alt+↓` on focused title moves the group. Visual: `.sb-group-dragging` (opacity 0.55) + `.sb-drop-indicator` line.
- **Reactive View check marks** — new `MenuToggleContext` + `toggles` prop on Menubar. Extended `resolveChecked` for: Show Hidden Files, Show File Extensions, Show Git Gutters, Show Ignored (.gitignore), Folders First, Show Checksums (tweaks), Sidebar, Status Bar (context flags). Added `showChecksums?: boolean` to TweakState. Added `showStatusBar` state + `toggleStatusBar` handler in App/view.ts. Added `html.no-status .statusbar { display: none }` CSS rule (was missing — toggle was a no-op before).
- **Terminal fs-aware cd** — new `makeCdCommand(profile, path)` with `flavorOf` classifier (kind=="ssh"|"wsl" first, then id/exec pattern → pwsh or posix). pwsh: `Set-Location "<path>"`. posix: `cd "<path>"` with `winPathToWsl` translation (`C:\...` → `/mnt/c/...`, `\\wsl$\Ubuntu\home\user` → `/home/user`, bare `C:` → `/mnt/c`). ssh: returns null — no cd sent (remote cwd is independent). cwd effect now also depends on `active` so profile switches re-apply cd with the right syntax.

### Verification
- `pnpm tsc --noEmit` clean on every touched file.
- Final win-build 2026-04-23 — exe at `src-tauri/target/release/glasshouse.exe`.

---

## Polish batch 4 shipped on 2026-04-22

Fourth parallel dispatch — 5 agents, scoped to remaining `window.prompt` / `window.alert` / `window.confirm` callsites + the still-stubby Remote story. All tasks tsc-clean.

### Archive handler (archive-polish)
- **Compress / Extract themed dialogs** — archive operations previously chained `window.prompt` for target name and `window.confirm` for overwrite; now use `dialogs.showPrompt` with inline validation (non-empty, no path separators) and `dialogs.showConfirm({ danger: true })` for overwrite-existing. Success emits a toast with the output path; failures render `dialogs.showAlert({ variant: "error" })` so errors are no longer hidden in devtools.

### Tools handler (tools-polish)
- **Verify Signature / Compare / Find & Replace / etc.** — Tools-menu handlers migrated to the themed modal system. Verify Signature prompts for the signature file, displays pass/fail in a themed `showAlert`. Compare prompts for the second path and routes to the existing diff flow. Find & Replace uses two sequential `showPrompt`s (pattern, replacement) with a final confirm before apply. Remaining catch-all tool cases toast "not yet wired" via the palette-default fallback instead of silent no-op.

### Misc handler (misc-polish)
- **Shred / Create Symlink / Paste Special variants** — Shred dialog uses `dialogs.showConfirm({ danger: true })` with the file count in the message; iterates with a per-file toast on completion. Create Symlink routes through `showPrompt` for the link name + destination, validates the target exists server-side, toasts failure if the fs call rejects. Paste Special variants (Paste as Shortcut / Paste Path / Paste as Text) all now surface success toasts instead of unacknowledged completion.

### Remote click + Manage Remotes dialog (remote-click / remote-manage)
- **Remote row click launches terminal** — sidebar Remote rows previously wrote `ssh user@host` to the clipboard and alerted. Now dispatches `spawnTerminalProfile` with a synthesized `ssh` profile (`kind: "ssh"`, `exec: "ssh"`, `args: ["user@host"]`) so the embedded terminal drawer opens a live session. Clipboard-copy kept as a right-click option.
- **Manage Remotes dialog** — new `ManageRemotesDialog` modal: list of saved remotes, per-row edit (opens prompt chain for label/host/user) and delete (confirm with danger styling), "add remote" footer button. Persists via the existing `remotes` store in localStorage. "Manage Remotes…" menu item + right-click "Edit Remote" / "Delete Remote" on sidebar rows both route here. Keyboard: Esc closes, Enter on a row activates edit.

### Verification
- `pnpm tsc --noEmit` clean across all touched files.
- Final win-build 2026-04-22 — exe at `src-tauri/target/release/glasshouse.exe` (14,029,824 bytes, 2m 8s build).
