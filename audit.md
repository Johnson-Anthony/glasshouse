# glasshouse UI wiring audit

Generated: 2026-04-22
Source: commit b2a9480

## Summary
- Total clickable surfaces: 309
- WIRED: 57
- STUB: 4
- UNWIRED: 236
- MOCK: 12

## Status legend
- **WIRED** — onClick handler reaches a real API call or state mutation with observable effect.
- **STUB** — handler runs but does nothing useful (console.log only, empty body, window.alert("not implemented")).
- **UNWIRED** — element looks clickable (has onClick / cursor:pointer / is a <button>) but the handler is missing, the dispatcher has no matching case, or the declared label isn't in any dispatcher.
- **MOCK** — element renders from hardcoded data in src/data.ts with no backend binding (the data itself is fake, even if the click would navigate correctly).

## Backend inventory (what `api.ts` + `commands.rs` currently expose)

`ping`, `home_dir`, `list_dir`, `drives`, `system_info`, `make_dir`, `rename_entry`, `copy_entry`, `move_entry`, `delete_entry`, `read_text`, `write_text`, `git_status`, `open_with_default`, `reveal_in_explorer`, `win_to_wsl`, `wsl_to_win`, `watch_dir`, `unwatch_dir`; plus window: `winClose`, `winMinimize`, `winToggleMaximize`. Anything requiring terminal spawn, VS Code launch, compression, hashing, permissions, git plumbing, bookmarks, sessions, screenshots, signatures, diff, hex viewer, bulk rename, trash, recent history, fullscreen, zoom, extraction, SSH, chown — NOT available.

## Unwired / stub / mock (do these first)

| Component | Label / Element | Location | Handler | Status | Notes |
|---|---|---|---|---|---|
| Titlebar | tab menu "⌄" button | components.tsx:52 | (none) | UNWIRED | No onClick; would need tab list dropdown |
| Toolbar | "·h" hidden toggle button | components.tsx:247 | (none) | UNWIRED | Button renders; no onClick. Use Tweaks or Ctrl+H menu instead |
| Toolbar | "≡" details view button | components.tsx:248 | (none) | UNWIRED | No onClick; view modes not implemented |
| Toolbar | "▦" grid view button | components.tsx:249 | (none) | UNWIRED | No onClick; view modes not implemented |
| Toolbar | "◨" inspector toggle button | components.tsx:250 | (none) | UNWIRED | No onClick; inspector always visible |
| FilePane | pane-head col "name" sort | components.tsx:425 | (none) | UNWIRED | cursor:pointer via CSS, no onClick |
| FilePane | pane-head col "tag" sort | components.tsx:426 | (none) | UNWIRED | cursor:pointer via CSS, no onClick |
| FilePane | pane-head col "size" sort | components.tsx:427 | (none) | UNWIRED | cursor:pointer via CSS, no onClick |
| FilePane | pane-head col "modified" sort | components.tsx:428 | (none) | UNWIRED | cursor:pointer via CSS, no onClick |
| FilePane | pane-head col "git" sort | components.tsx:429 | (none) | UNWIRED | cursor:pointer via CSS, no onClick |
| Sidebar | PINNED group "+" add button | components.tsx:299 | (none) | UNWIRED | Static text, no onClick |
| Sidebar | TREE group "⋯" button | components.tsx:317 | (none) | UNWIRED | Static text, no onClick |
| Sidebar | TREE rows (16 nodes) | components.tsx:318-327 | (none) | MOCK | Static TREE[] array, rows don't navigate; would need real dir tree |
| Sidebar | TAGS rows (5) | components.tsx:332-338 | (none) | MOCK | Hardcoded SIDEBAR.tags, no click, no backend |
| Sidebar | DEVICES rows (5) | components.tsx:343-351 | (none) | MOCK | Hardcoded SIDEBAR.devices, no click, no backend |
| Sidebar | REMOTE rows (3) | components.tsx:356-364 | (none) | MOCK | Hardcoded SIDEBAR.remote, no click, no backend |
| Inspector | PERMISSIONS "edit" link | components.tsx:569 | (none) | UNWIRED | cursor:pointer span, no onClick |
| Inspector | CHECKSUMS "copy" link | components.tsx:585 | (none) | UNWIRED | cursor:pointer span, no onClick |
| Inspector | QUICK "▶ run" chip | components.tsx:606 | (none) | UNWIRED | cursor:pointer, no onClick |
| Inspector | QUICK "⌨ open in code" chip | components.tsx:607 | (none) | UNWIRED | cursor:pointer, no onClick |
| Inspector | QUICK "⎇ git blame" chip | components.tsx:608 | (none) | UNWIRED | cursor:pointer, no onClick |
| Inspector | QUICK "⌘ copy path" chip | components.tsx:609 | (none) | UNWIRED | cursor:pointer, no onClick |
| Inspector | QUICK "◫ compress" chip | components.tsx:610 | (none) | UNWIRED | cursor:pointer, no onClick |
| Inspector | QUICK "# hash" chip | components.tsx:611 | (none) | UNWIRED | cursor:pointer, no onClick |
| TerminalDrawer | tab "zsh · glasshouse" | components.tsx:696 | (none) | UNWIRED | Static tab, no onClick |
| TerminalDrawer | tab close "×" on zsh | components.tsx:696 | (none) | UNWIRED | No onClick |
| TerminalDrawer | tab "ssh · void@server" | components.tsx:697 | (none) | UNWIRED | Static, no onClick |
| TerminalDrawer | tab "wsl · Ubuntu" | components.tsx:698 | (none) | UNWIRED | Static, no onClick |
| TerminalDrawer | tab "+" new terminal | components.tsx:699 | (none) | UNWIRED | No onClick |
| TerminalDrawer | split H "⊟" | components.tsx:701 | (none) | UNWIRED | No onClick |
| TerminalDrawer | split V "⊟" | components.tsx:702 | (none) | UNWIRED | No onClick |
| TerminalDrawer | zoom "⤢" | components.tsx:703 | (none) | UNWIRED | No onClick |
| TerminalDrawer | term body / input | components.tsx:707-719 | (none) | MOCK | Hardcoded fake shell output; no PTY |
| Menubar | "· NORMAL mode" | components.tsx:144 | (none) | UNWIRED | Non-interactive text |
| Menubar | "· rice://v0.4.2-dev" | components.tsx:145 | (none) | UNWIRED | Non-interactive text |
| StatusBar | "fs" segment | components.tsx:673 | (none) | UNWIRED | No onClick, value hardcoded "—" |
| StatusBar | "net" segment | components.tsx:678 | (none) | UNWIRED | No onClick, value hardcoded "—" |
| StatusBar | i/o spark segment | components.tsx:677 | (none) | MOCK | Hardcoded "▁▂▃▅▂▁" bars |
| Menubar.File | New Window | data.ts:163 | handleMenuCommand | UNWIRED | No case; no multi-window support |
| Menubar.File | New Private Session | data.ts:164 | handleMenuCommand | UNWIRED | No case |
| Menubar.File | New > Folder | data.ts:167 | doFileOp "Folder" | WIRED | prompt + makeDir |
| Menubar.File | New > Text File | data.ts:168 | doFileOp "Text File" | WIRED | prompt + writeText |
| Menubar.File | New > Markdown Note | data.ts:169 | doFileOp "Markdown Note" | WIRED | prompt + writeText |
| Menubar.File | New > Script (.sh) | data.ts:170 | doFileOp "Script (.sh)" | WIRED | prompt + writeText |
| Menubar.File | New > Python Module | data.ts:171 | doFileOp "Python Module" | UNWIRED | No case in doFileOp |
| Menubar.File | New > From Template… | data.ts:172 | doFileOp | UNWIRED | No case |
| Menubar.File | Open… | data.ts:175 | doFileOp "Open…" | UNWIRED | No case; case is "Open" not "Open…" |
| Menubar.File | Open in Terminal | data.ts:176 | doFileOp | STUB | console.log only |
| Menubar.File | Open in VS Code | data.ts:177 | doFileOp | STUB | console.log only |
| Menubar.File | Open Recent > ~/projects/glasshouse | data.ts:181 | doFileOp | UNWIRED | Mock label, no case |
| Menubar.File | Open Recent > ~/school/cs3410/lab07 | data.ts:182 | doFileOp | UNWIRED | Mock label |
| Menubar.File | Open Recent > /mnt/c/Users/you/Desktop | data.ts:183 | doFileOp | UNWIRED | Mock label |
| Menubar.File | Open Recent > ~/Downloads | data.ts:184 | doFileOp | UNWIRED | Mock label |
| Menubar.File | Open Recent > Clear History | data.ts:186 | doFileOp | UNWIRED | No case; no history store |
| Menubar.File | Save Session | data.ts:189 | doFileOp | UNWIRED | No case |
| Menubar.File | Import Session… | data.ts:190 | doFileOp | UNWIRED | No case |
| Menubar.File | Export Layout (.ricerc) | data.ts:191 | doFileOp | UNWIRED | No case |
| Menubar.File | Close Other Tabs | data.ts:194 | doFileOp | UNWIRED | No case |
| Menubar.File | Quit | data.ts:195 | doFileOp | UNWIRED | No case; should call winClose |
| Menubar.Edit | Undo | data.ts:198 | doFileOp | UNWIRED | No case; no op history |
| Menubar.Edit | Redo | data.ts:199 | doFileOp | UNWIRED | No case |
| Menubar.Edit | Copy Path (WSL) | data.ts:204 | doFileOp | WIRED | writes WSL path via winToWsl |
| Menubar.Edit | Copy as UNC | data.ts:205 | doFileOp | UNWIRED | No case |
| Menubar.Edit | Paste Special > Paste as Link | data.ts:209 | doFileOp | UNWIRED | No case; symlink backend missing |
| Menubar.Edit | Paste Special > Paste as Hard Link | data.ts:210 | doFileOp | UNWIRED | No case |
| Menubar.Edit | Paste Special > Paste as Copy (verify) | data.ts:211 | doFileOp | UNWIRED | No case; no checksum verify |
| Menubar.Edit | Paste Special > Paste Text into Filename | data.ts:212 | doFileOp | UNWIRED | No case |
| Menubar.Edit | Bulk Rename… | data.ts:216 | doFileOp | UNWIRED | No case; no bulk-rename UI |
| Menubar.Edit | Shred (srm) | data.ts:219 | doFileOp | UNWIRED | No case; no secure-delete backend |
| Menubar.Edit | Keybindings… | data.ts:222 | doFileOp | UNWIRED | No case |
| Menubar.Edit | Edit .ricerc | data.ts:223 | doFileOp | UNWIRED | No case |
| Menubar.Select | Select All | data.ts:226 | doFileOp | UNWIRED | No case; would need selection action |
| Menubar.Select | Invert Selection | data.ts:227 | doFileOp | UNWIRED | No case |
| Menubar.Select | Deselect | data.ts:228 | doFileOp | UNWIRED | No case |
| Menubar.Select | Select by Pattern… | data.ts:230 | doFileOp | UNWIRED | No case |
| Menubar.Select | Select by Regex… | data.ts:231 | doFileOp | UNWIRED | No case |
| Menubar.Select | Select by Tag → | data.ts:232 | doFileOp | UNWIRED | No case |
| Menubar.Select | Select by Extension → | data.ts:233 | doFileOp | UNWIRED | No case |
| Menubar.Select | Select Modified (Git) | data.ts:234 | doFileOp | UNWIRED | No case |
| Menubar.Select | Select Untracked | data.ts:235 | doFileOp | UNWIRED | No case |
| Menubar.Select | Expand Selection to Folder | data.ts:237 | doFileOp | UNWIRED | No case |
| Menubar.Select | Extend to Line End (Visual) | data.ts:238 | doFileOp | UNWIRED | No case |
| Menubar.Select | Add Next Match | data.ts:239 | doFileOp | UNWIRED | No case |
| Menubar.View | Layout > Tree + Pane + Inspector | data.ts:244 | doFileOp | UNWIRED | No case; only one layout rendered |
| Menubar.View | Layout > Miller Columns | data.ts:245 | doFileOp | UNWIRED | No case |
| Menubar.View | Layout > Dual Pane | data.ts:246 | doFileOp | UNWIRED | No case |
| Menubar.View | Layout > Tmux Quad | data.ts:247 | doFileOp | UNWIRED | No case |
| Menubar.View | Layout > Single Pane | data.ts:248 | doFileOp | UNWIRED | No case |
| Menubar.View | Display Mode > Details (rows) | data.ts:252 | doFileOp | UNWIRED | No case; only rows rendered |
| Menubar.View | Display Mode > Compact List | data.ts:253 | doFileOp | UNWIRED | No case |
| Menubar.View | Display Mode > Icons | data.ts:254 | doFileOp | UNWIRED | No case |
| Menubar.View | Display Mode > Tiles | data.ts:255 | doFileOp | UNWIRED | No case |
| Menubar.View | Display Mode > Grid (thumbs) | data.ts:256 | doFileOp | UNWIRED | No case |
| Menubar.View | Display Mode > Tree Flat | data.ts:257 | doFileOp | UNWIRED | No case |
| Menubar.View | Sort By > Name | data.ts:261 | doFileOp | UNWIRED | No case |
| Menubar.View | Sort By > Size | data.ts:262 | doFileOp | UNWIRED | No case |
| Menubar.View | Sort By > Modified | data.ts:263 | doFileOp | UNWIRED | No case |
| Menubar.View | Sort By > Type / Extension | data.ts:264 | doFileOp | UNWIRED | No case |
| Menubar.View | Sort By > Git Status | data.ts:265 | doFileOp | UNWIRED | No case |
| Menubar.View | Sort By > Tag / Color | data.ts:266 | doFileOp | UNWIRED | No case |
| Menubar.View | Sort By > Descending | data.ts:268 | doFileOp | UNWIRED | No case |
| Menubar.View | Sort By > Folders First | data.ts:269 | doFileOp | UNWIRED | No case |
| Menubar.View | Show Ignored (.gitignore) | data.ts:273 | doFileOp | UNWIRED | No case |
| Menubar.View | Show File Extensions | data.ts:274 | doFileOp | UNWIRED | No case |
| Menubar.View | Show Git Gutters | data.ts:275 | doFileOp | UNWIRED | No case |
| Menubar.View | Show Checksums | data.ts:276 | doFileOp | UNWIRED | No case |
| Menubar.View | Sidebar | data.ts:278 | doFileOp | UNWIRED | No case; sidebar is always visible |
| Menubar.View | Inspector | data.ts:279 | doFileOp | UNWIRED | No case |
| Menubar.View | Status Bar | data.ts:281 | doFileOp | UNWIRED | No case |
| Menubar.View | Zoom In | data.ts:284 | doFileOp | UNWIRED | No case |
| Menubar.View | Zoom Out | data.ts:285 | doFileOp | UNWIRED | No case |
| Menubar.View | Reset Zoom | data.ts:286 | doFileOp | UNWIRED | No case |
| Menubar.View | Full Screen | data.ts:287 | doFileOp | UNWIRED | No case; no fullscreen backend |
| Menubar.Go | Home | data.ts:295 | doFileOp | UNWIRED | No case; should goTo(homeDir) |
| Menubar.Go | Root  / | data.ts:296 | doFileOp | UNWIRED | No case |
| Menubar.Go | Desktop | data.ts:297 | doFileOp | UNWIRED | No case |
| Menubar.Go | Documents | data.ts:298 | doFileOp | UNWIRED | No case |
| Menubar.Go | Downloads | data.ts:299 | doFileOp | UNWIRED | No case |
| Menubar.Go | Pictures | data.ts:300 | doFileOp | UNWIRED | No case |
| Menubar.Go | Go to Path… | data.ts:302 | doFileOp | UNWIRED | No case; no path-entry dialog |
| Menubar.Go | Go to WSL Distro… | data.ts:303 | doFileOp | UNWIRED | No case |
| Menubar.Go | Connect to Server… | data.ts:304 | doFileOp | UNWIRED | No case; no SSH/SFTP |
| Menubar.Go | SSH: void@server | data.ts:305 | doFileOp | UNWIRED | No case |
| Menubar.Go | Trash | data.ts:307 | doFileOp | UNWIRED | No case; no trash location resolver |
| Menubar.Go | Previous Location | data.ts:308 | doFileOp | UNWIRED | No case; Back case takes different label |
| Menubar.Go | Next Location | data.ts:309 | doFileOp | UNWIRED | No case |
| Menubar.Bookmarks | Bookmark This Folder | data.ts:312 | doFileOp | UNWIRED | No case; no bookmark store |
| Menubar.Bookmarks | Manage Bookmarks… | data.ts:313 | doFileOp | UNWIRED | No case |
| Menubar.Bookmarks | ~/projects/glasshouse | data.ts:316 | doFileOp | UNWIRED | Mock pinned, no case |
| Menubar.Bookmarks | ~/school/cs3410 | data.ts:317 | doFileOp | UNWIRED | Mock |
| Menubar.Bookmarks | /mnt/c/Users/you/Desktop | data.ts:318 | doFileOp | UNWIRED | Mock |
| Menubar.Bookmarks | ~/Pictures/screens | data.ts:319 | doFileOp | UNWIRED | Mock |
| Menubar.Bookmarks | ~/Downloads | data.ts:321 | doFileOp | UNWIRED | Mock recent, no case |
| Menubar.Bookmarks | ~/.config/nvim | data.ts:322 | doFileOp | UNWIRED | Mock |
| Menubar.Bookmarks | /etc/nginx | data.ts:323 | doFileOp | UNWIRED | Mock |
| Menubar.Tools | Bulk Rename… | data.ts:326 | doFileOp | UNWIRED | No case |
| Menubar.Tools | Batch Permissions… | data.ts:327 | doFileOp | UNWIRED | No case; no chmod backend |
| Menubar.Tools | Change Owner (chown)… | data.ts:328 | doFileOp | UNWIRED | No case; no chown backend |
| Menubar.Tools | Find & Replace in Files | data.ts:329 | doFileOp | UNWIRED | No case |
| Menubar.Tools | Compress > Zip (.zip) | data.ts:333 | doFileOp | UNWIRED | No case; no compression backend |
| Menubar.Tools | Compress > Tar + gzip | data.ts:334 | doFileOp | UNWIRED | No case |
| Menubar.Tools | Compress > Tar + zstd | data.ts:335 | doFileOp | UNWIRED | No case |
| Menubar.Tools | Compress > 7-zip | data.ts:336 | doFileOp | UNWIRED | No case |
| Menubar.Tools | Extract > Extract Here | data.ts:340 | doFileOp | UNWIRED | No case |
| Menubar.Tools | Extract > Extract to Folder… | data.ts:341 | doFileOp | UNWIRED | No case |
| Menubar.Tools | Extract > Browse archive in place | data.ts:342 | doFileOp | UNWIRED | No case |
| Menubar.Tools | Checksum (SHA256) | data.ts:345 | doFileOp | UNWIRED | No case; no hash backend |
| Menubar.Tools | Verify Signature… | data.ts:346 | doFileOp | UNWIRED | No case |
| Menubar.Tools | Compare Files (diff) | data.ts:347 | doFileOp | UNWIRED | No case |
| Menubar.Tools | Hex Viewer | data.ts:348 | doFileOp | UNWIRED | No case |
| Menubar.Tools | Screenshot → Auto-sort | data.ts:350 | doFileOp | UNWIRED | No case |
| Menubar.Tools | Clipboard Stack | data.ts:351 | doFileOp | UNWIRED | No case |
| Menubar.Tools | File Queue | data.ts:352 | doFileOp | UNWIRED | No case |
| Menubar.Tools | Run Script on Selection… | data.ts:353 | doFileOp | UNWIRED | No case; no shell exec |
| Menubar.Git | Status | data.ts:356 | doFileOp | UNWIRED | No case; gitStatus is polled silently |
| Menubar.Git | Stage Selected | data.ts:357 | doFileOp | UNWIRED | No case; no git add backend |
| Menubar.Git | Unstage Selected | data.ts:358 | doFileOp | UNWIRED | No case |
| Menubar.Git | Commit… | data.ts:359 | doFileOp | UNWIRED | No case |
| Menubar.Git | Commit Amend | data.ts:360 | doFileOp | UNWIRED | No case |
| Menubar.Git | Pull | data.ts:362 | doFileOp | UNWIRED | No case |
| Menubar.Git | Push | data.ts:363 | doFileOp | UNWIRED | No case |
| Menubar.Git | Fetch All | data.ts:364 | doFileOp | UNWIRED | No case |
| Menubar.Git | Branches > * main | data.ts:367 | doFileOp | UNWIRED | Mock |
| Menubar.Git | Branches > feat/command-palette | data.ts:368 | doFileOp | UNWIRED | Mock |
| Menubar.Git | Branches > wip/theme-switcher | data.ts:369 | doFileOp | UNWIRED | Mock |
| Menubar.Git | Branches > New Branch… | data.ts:371 | doFileOp | UNWIRED | No case |
| Menubar.Git | Branches > Checkout… | data.ts:372 | doFileOp | UNWIRED | No case |
| Menubar.Git | Branches > Merge… | data.ts:373 | doFileOp | UNWIRED | No case |
| Menubar.Git | Branches > Rebase onto… | data.ts:374 | doFileOp | UNWIRED | No case |
| Menubar.Git | Log (graph) | data.ts:376 | doFileOp | UNWIRED | No case |
| Menubar.Git | Blame Selected | data.ts:377 | doFileOp | UNWIRED | No case |
| Menubar.Git | Stash | data.ts:378 | doFileOp | UNWIRED | No case |
| Menubar.Git | Discard Changes | data.ts:380 | doFileOp | UNWIRED | No case |
| Menubar.Git | Clean Untracked… | data.ts:381 | doFileOp | UNWIRED | No case |
| Menubar.Terminal | Open in New Window | data.ts:385 | doFileOp | UNWIRED | No case |
| Menubar.Terminal | New Tab (terminal) | data.ts:386 | handleMenuCommand "New Tab" | WIRED | collides with File>New Tab — opens file tab, not term tab |
| Menubar.Terminal | Profile > bash | data.ts:389 | doFileOp | UNWIRED | No case |
| Menubar.Terminal | Profile > zsh | data.ts:390 | doFileOp | UNWIRED | No case |
| Menubar.Terminal | Profile > fish | data.ts:391 | doFileOp | UNWIRED | No case |
| Menubar.Terminal | Profile > PowerShell | data.ts:392 | doFileOp | UNWIRED | No case |
| Menubar.Terminal | Profile > WSL · Ubuntu | data.ts:393 | doFileOp | UNWIRED | No case |
| Menubar.Terminal | Profile > WSL · Debian | data.ts:394 | doFileOp | UNWIRED | No case |
| Menubar.Terminal | Profile > SSH: void@server | data.ts:395 | doFileOp | UNWIRED | No case |
| Menubar.Terminal | Split Horizontal | data.ts:398 | doFileOp | UNWIRED | No case |
| Menubar.Terminal | Split Vertical | data.ts:399 | doFileOp | UNWIRED | No case |
| Menubar.Terminal | Zoom Pane | data.ts:400 | doFileOp | UNWIRED | No case |
| Menubar.Terminal | Run Last Command | data.ts:402 | doFileOp | UNWIRED | No case |
| Menubar.Terminal | Send Path to Shell | data.ts:403 | doFileOp | UNWIRED | No case |
| Menubar.Terminal | cd Here | data.ts:404 | doFileOp | UNWIRED | No case |
| Menubar.Window | Next Tab | data.ts:407 | doFileOp | UNWIRED | No case |
| Menubar.Window | Prev Tab | data.ts:408 | doFileOp | UNWIRED | No case |
| Menubar.Window | Move Tab → | data.ts:409 | doFileOp | UNWIRED | No case |
| Menubar.Window | Move Tab ← | data.ts:410 | doFileOp | UNWIRED | No case |
| Menubar.Window | Split Right | data.ts:412 | doFileOp | UNWIRED | No case |
| Menubar.Window | Split Down | data.ts:413 | doFileOp | UNWIRED | No case |
| Menubar.Window | Focus Pane ↑ | data.ts:414 | doFileOp | UNWIRED | No case |
| Menubar.Window | Focus Pane ↓ | data.ts:415 | doFileOp | UNWIRED | No case |
| Menubar.Window | Always on Top | data.ts:417 | doFileOp | UNWIRED | No case |
| Menubar.Window | Pin to Workspace | data.ts:418 | doFileOp | UNWIRED | No case |
| Menubar.Window | Snap Left / Right | data.ts:419 | doFileOp | UNWIRED | No case |
| Menubar.Window | Minimize | data.ts:420 | doFileOp | UNWIRED | No case; should call winMinimize |
| Menubar.Window | Close Window | data.ts:421 | doFileOp | UNWIRED | No case; should call winClose |
| Menubar.Help | Keybinding Cheatsheet | data.ts:425 | doFileOp | UNWIRED | No case |
| Menubar.Help | Documentation | data.ts:426 | doFileOp | UNWIRED | No case |
| Menubar.Help | Release Notes | data.ts:427 | doFileOp | UNWIRED | No case |
| Menubar.Help | Report Bug… | data.ts:429 | doFileOp | UNWIRED | No case |
| Menubar.Help | Check for Updates | data.ts:430 | doFileOp | UNWIRED | No case |
| Menubar.Help | About rice:// | data.ts:431 | doFileOp | UNWIRED | No case |
| Palette | Go to Path… | data.ts:436 | doFileOp | UNWIRED | No case |
| Palette | Find File by Name (fuzzy) | data.ts:437 | doFileOp | UNWIRED | No case; palette itself is fuzzy but this label unhandled |
| Palette | Find in Files | data.ts:438 | doFileOp | UNWIRED | No case |
| Palette | Jump to Bookmark → | data.ts:439 | doFileOp | UNWIRED | No case |
| Palette | Open Recent → | data.ts:440 | doFileOp | UNWIRED | No case |
| Palette | Bulk Rename… | data.ts:442 | doFileOp | UNWIRED | No case |
| Palette | Batch Permissions… | data.ts:443 | doFileOp | UNWIRED | No case |
| Palette | Hash SHA256 of Selection | data.ts:444 | doFileOp | UNWIRED | No case |
| Palette | Git: Stage Selected | data.ts:445 | doFileOp | UNWIRED | No case |
| Palette | Git: Commit… | data.ts:446 | doFileOp | UNWIRED | No case |
| Palette | Git: Checkout Branch → | data.ts:447 | doFileOp | UNWIRED | No case |
| Palette | Change Layout → | data.ts:450 | doFileOp | UNWIRED | No case |
| Palette | Open in Terminal | data.ts:451 | doFileOp | STUB | console.log only (shared branch) |
| Palette | Open in VS Code | data.ts:452 | doFileOp | STUB | console.log only (shared branch) |
| Palette | Run Script on Selection… | data.ts:453 | doFileOp | UNWIRED | No case |
| ContextMenu (file) | Open in Terminal | data.ts:459 | doFileOp | STUB | console.log only |
| ContextMenu (file) | Open in VS Code | data.ts:460 | doFileOp | STUB | console.log only |
| ContextMenu (file) | Move to… | data.ts:470 | doFileOp | UNWIRED | No case |
| ContextMenu (file) | Create Symlink… | data.ts:471 | doFileOp | UNWIRED | No case; no symlink backend |
| ContextMenu (file) | Tag → | data.ts:472 | doFileOp | UNWIRED | No case; no tag store |
| ContextMenu (file) | Compress → | data.ts:474 | doFileOp | UNWIRED | No case |
| ContextMenu (file) | Checksum SHA256 | data.ts:475 | doFileOp | UNWIRED | No case |
| ContextMenu (file) | Hex Viewer | data.ts:476 | doFileOp | UNWIRED | No case |
| ContextMenu (file) | Diff with Clipboard | data.ts:477 | doFileOp | UNWIRED | No case |
| ContextMenu (file) | Git: Stage | data.ts:479 | doFileOp | UNWIRED | No case |
| ContextMenu (file) | Git: Discard changes | data.ts:480 | doFileOp | UNWIRED | No case |
| ContextMenu (file) | Git: Blame | data.ts:481 | doFileOp | UNWIRED | No case |
| ContextMenu (file) | Properties | data.ts:483 | doFileOp | STUB | console.log only |
| ContextMenu (empty) | New > From Template… | data.ts:494 | doFileOp | UNWIRED | No case |
| ContextMenu (empty) | Paste Special → | data.ts:497 | doFileOp | UNWIRED | No case |
| ContextMenu (empty) | Open in Terminal | data.ts:499 | doFileOp | STUB | console.log only |
| ContextMenu (empty) | Open in VS Code | data.ts:500 | doFileOp | STUB | console.log only |
| ContextMenu (empty) | Bookmark Folder | data.ts:501 | doFileOp | UNWIRED | No case |
| ContextMenu (empty) | Sort By > Name | data.ts:505 | doFileOp | UNWIRED | No case |
| ContextMenu (empty) | Sort By > Size | data.ts:506 | doFileOp | UNWIRED | No case |
| ContextMenu (empty) | Sort By > Modified | data.ts:507 | doFileOp | UNWIRED | No case |
| ContextMenu (empty) | Sort By > Type | data.ts:508 | doFileOp | UNWIRED | No case |
| ContextMenu (empty) | Sort By > Git Status | data.ts:509 | doFileOp | UNWIRED | No case |

## Wired (reference)

| Component | Label / Element | Location | Handler | Status | Notes |
|---|---|---|---|---|---|
| Titlebar | close traffic light | components.tsx:34 | winClose() | WIRED | |
| Titlebar | minimize traffic light | components.tsx:35 | winMinimize() | WIRED | |
| Titlebar | maximize traffic light | components.tsx:36 | winToggleMaximize() | WIRED | |
| Titlebar | tab row (select tab) | components.tsx:40-44 | onSelectTab | WIRED | |
| Titlebar | tab close "×" | components.tsx:47 | onCloseTab | WIRED | |
| Titlebar | "+" new tab button | components.tsx:51 | onNewTab | WIRED | |
| Menubar | "File/Edit/..." top items (11) | components.tsx:117-123 | setOpen | WIRED | opens dropdown |
| Menubar | "Ctrl P palette" chip | components.tsx:141 | onOpenPalette | WIRED | |
| Toolbar | Back "←" | components.tsx:208 | actions.back | WIRED | |
| Toolbar | Forward "→" | components.tsx:209 | actions.forward | WIRED | |
| Toolbar | Up "↑" | components.tsx:210 | actions.up | WIRED | |
| Toolbar | Refresh "↻" | components.tsx:211 | actions.refresh | WIRED | |
| Toolbar | breadcrumb crumb | components.tsx:217-221 | onGoTo | WIRED | per-segment |
| Toolbar | search input | components.tsx:231 | onSearchChange | WIRED | filters FilePane |
| Sidebar | PINNED pinned rows (home/Desktop/Documents/Downloads/Pictures) | components.tsx:300-306 | onGoTo | WIRED | paths built from homeDir |
| Sidebar | DRIVES rows | components.tsx:307-313 | onGoTo(letter) | WIRED | Live from drives() |
| FilePane | row click (select) | components.tsx:439 | handleRowClick | WIRED | |
| FilePane | row double-click (open) | components.tsx:440 | onOpen | WIRED | folder navigate |
| FilePane | row context menu | components.tsx:441 | onContext | WIRED | |
| FilePane | pane empty-area context menu | components.tsx:422 | onContext | WIRED | |
| StatusBar | "⌨ term" toggle | components.tsx:679 | onToggleTerm | WIRED | |
| TerminalDrawer | close "×" | components.tsx:704 | onClose | WIRED | |
| Tweaks | close "×" | components.tsx:862 | onClose | WIRED | |
| Tweaks | theme <select> | components.tsx:867 | setState.theme | WIRED | |
| Tweaks | font <select> | components.tsx:873 | setState.font | WIRED | |
| Tweaks | density compact | components.tsx:880 | setState.density | WIRED | |
| Tweaks | density default | components.tsx:880 | setState.density | WIRED | |
| Tweaks | density comfy | components.tsx:880 | setState.density | WIRED | |
| Tweaks | scanlines off | components.tsx:888 | setState.scanlines=false | WIRED | |
| Tweaks | scanlines on | components.tsx:889 | setState.scanlines=true | WIRED | |
| Tweaks | hidden hide | components.tsx:895 | setState.hidden=false | WIRED | |
| Tweaks | hidden show | components.tsx:896 | setState.hidden=true | WIRED | |
| App | floating "◉" tweaks launcher | App.tsx:572 | setTweaksOpen(true) | WIRED | |
| Palette | search input | components.tsx:764 | setQ | WIRED | |
| Palette | row click | components.tsx:772 | run(label) | WIRED | routes via handleMenuCommand |
| ContextMenu | item click | components.tsx:818 | onCommand | WIRED | routes via handleMenuCommand |
| Menubar.File | New Tab | data.ts:162 | handleMenuCommand | WIRED | openNewTab |
| Menubar.File | Close Tab | data.ts:193 | handleMenuCommand | WIRED | closeTabAt(activeTab) |
| Menubar.Edit | Cut | data.ts:201 | doFileOp | WIRED | clipboard state |
| Menubar.Edit | Copy | data.ts:202 | doFileOp | WIRED | clipboard state |
| Menubar.Edit | Copy Path | data.ts:203 | doFileOp | WIRED | navigator.clipboard |
| Menubar.Edit | Paste | data.ts:206 | doFileOp | WIRED | copy/move from clipboard |
| Menubar.Edit | Rename | data.ts:215 | doFileOp | WIRED | prompt + renameEntry |
| Menubar.Edit | Move to Trash | data.ts:217 | doFileOp | WIRED | deleteEntry(trash=true) |
| Menubar.Edit | Delete Permanently | data.ts:218 | doFileOp | WIRED | confirm + deleteEntry |
| Menubar.Edit | Preferences… | data.ts:221 | handleMenuCommand | WIRED | toggles Tweaks |
| Menubar.View | Show Hidden Files | data.ts:272 | handleMenuCommand | WIRED | toggles state.hidden |
| Menubar.View | Terminal Drawer | data.ts:280 | handleMenuCommand | WIRED | toggles termOpen |
| Menubar.View | Tweaks | data.ts:282 | handleMenuCommand | WIRED | toggles tweaksOpen |
| Menubar.Go | Back | data.ts:290 | handleMenuCommand | WIRED | |
| Menubar.Go | Forward | data.ts:291 | handleMenuCommand | WIRED | |
| Menubar.Go | Up one level | data.ts:292 | handleMenuCommand | WIRED | |
| Menubar.Go | Refresh | data.ts:293 | handleMenuCommand | WIRED | |
| Menubar.Terminal | Toggle Drawer | data.ts:384 | handleMenuCommand | WIRED | |
| Menubar.Help | Command Palette | data.ts:424 | handleMenuCommand | WIRED | opens palette |
| Palette | Toggle Hidden Files | data.ts:449 | handleMenuCommand | WIRED | |
| Palette | Switch Theme → | data.ts:448 | handleMenuCommand | WIRED | cycles THEMES array |
| Palette | New Folder | data.ts:441 | doFileOp | WIRED | prompt + makeDir |
| ContextMenu (file) | Open | data.ts:457 | doFileOp | WIRED | openWithDefault or goTo |
| ContextMenu (file) | Open With → | data.ts:458 | doFileOp "Open With →" | WIRED | openWithDefault |
| ContextMenu (file) | Reveal in Tree | data.ts:461 | doFileOp | WIRED | revealInExplorer |
| ContextMenu (file) | Cut | data.ts:463 | doFileOp | WIRED | |
| ContextMenu (file) | Copy | data.ts:464 | doFileOp | WIRED | |
| ContextMenu (file) | Copy Path | data.ts:465 | doFileOp | WIRED | |
| ContextMenu (file) | Copy as WSL Path | data.ts:466 | doFileOp | WIRED | |
| ContextMenu (file) | Duplicate | data.ts:467 | doFileOp | WIRED | copyEntry with " (copy)" |
| ContextMenu (file) | Rename | data.ts:469 | doFileOp | WIRED | |
| ContextMenu (file) | Move to Trash | data.ts:484 | doFileOp | WIRED | |
| ContextMenu (empty) | New > Folder | data.ts:490 | doFileOp | WIRED | |
| ContextMenu (empty) | New > Text File | data.ts:491 | doFileOp | WIRED | |
| ContextMenu (empty) | New > Markdown Note | data.ts:492 | doFileOp | WIRED | |
| ContextMenu (empty) | New > Script (.sh) | data.ts:493 | doFileOp | WIRED | |
| ContextMenu (empty) | Paste | data.ts:496 | doFileOp | WIRED | |
| ContextMenu (empty) | Refresh | data.ts:511 | handleMenuCommand | WIRED | |

## Keyboard shortcuts

Two sources of key handling exist: the global `window.addEventListener("keydown")` inside `App.tsx:228-254` (5 triggers total) and local `onKeyDown` handlers on the toolbar search input (`components.tsx:236`) and the palette (`components.tsx:761`). Everything else — including every shortcut label shown in the menus (F2, Del, Ctrl+W, Ctrl+C/X/V, Ctrl+A, F5, Alt+←, etc.) — is purely decorative: the string is printed in the menu row but no key binding dispatches the labelled action. The file pane itself has no focus handling, so arrow-key navigation / Enter-to-open / Backspace-to-up do not exist.

### Unwired / stub shortcuts (do these first)

| Trigger | Action | Handler location | Status |
|---|---|---|---|
| Arrow Up / Down (file rows) | move selection | — | UNWIRED |
| Arrow Left / Right (file rows) | collapse/expand or navigate | — | UNWIRED |
| Enter (file rows) | open selected | — | UNWIRED (double-click works) |
| Backspace (file rows) | go up one level | — | UNWIRED |
| Space (file rows) | toggle selection / quicklook | — | UNWIRED |
| Delete | Move to Trash | — | UNWIRED (shown in Edit menu) |
| Shift+Delete | Delete Permanently | — | UNWIRED |
| F2 | Rename | — | UNWIRED |
| F3 / F4 / F5-F7 | layout switchers | — | UNWIRED |
| F5 | Refresh | — | UNWIRED (shown in Go/context menus) |
| F11 | Full Screen | — | UNWIRED |
| Ctrl+T | New Tab | — | UNWIRED (shown in File menu) |
| Ctrl+W | Close Tab | — | UNWIRED |
| Ctrl+N | New Window | — | UNWIRED |
| Ctrl+Shift+N | New Private Session | — | UNWIRED |
| Ctrl+O | Open… | — | UNWIRED |
| Ctrl+Q | Quit | — | UNWIRED |
| Ctrl+A | Select All | — | UNWIRED |
| Ctrl+I | Invert Selection | — | UNWIRED |
| Ctrl+C | Copy | — | UNWIRED (menu label only; no OS binding) |
| Ctrl+X | Cut | — | UNWIRED |
| Ctrl+V | Paste | — | UNWIRED |
| Ctrl+Shift+C | Copy Path | — | UNWIRED |
| Ctrl+Alt+C | Copy Path (WSL) | — | UNWIRED |
| Ctrl+Z / Ctrl+Shift+Z | Undo / Redo | — | UNWIRED |
| Ctrl+D | Bookmark / Add Next Match | — | UNWIRED |
| Ctrl+L | Go to Path… | — | UNWIRED |
| Ctrl+B | Toggle Sidebar | — | UNWIRED |
| Ctrl+J | Toggle Inspector | — | UNWIRED |
| Ctrl+Shift+R | Bulk Rename | — | UNWIRED |
| Ctrl+Shift+F | Find in Files | — | UNWIRED |
| Ctrl+Shift+P | Batch Permissions | — | UNWIRED |
| Ctrl+Shift+E | Open in VS Code | — | UNWIRED |
| Ctrl+Shift+G | Connect to Server | — | UNWIRED |
| Ctrl+Shift+T | New Terminal Tab | — | UNWIRED |
| Ctrl+Shift+H / V | Split H / V (terminal) | — | UNWIRED |
| Ctrl+Tab / Ctrl+Shift+Tab | Next/Prev Tab | — | UNWIRED |
| Ctrl+1..6 | Display mode | — | UNWIRED |
| Ctrl+= / Ctrl+- / Ctrl+0 | Zoom in/out/reset | — | UNWIRED |
| Ctrl+[ / Ctrl+] | Previous/Next Location | — | UNWIRED |
| Ctrl+M | Minimize | — | UNWIRED |
| Ctrl+Home | Home | — | UNWIRED |
| Ctrl+G S / A / C / P | Git status/stage/commit/pull | — | UNWIRED |
| Alt+← | Back | — | UNWIRED (shown in Go menu) |
| Alt+→ | Forward | — | UNWIRED |
| Alt+↑ | Up | — | UNWIRED |
| Alt+Enter | Properties | — | UNWIRED |
| `*` | Select by Pattern | — | UNWIRED |
| Ctrl+? | Keybinding Cheatsheet | — | UNWIRED |
| Tab (palette) | autocomplete | — | UNWIRED (shown in palette foot) |
| Ctrl+` (in palette) | run in terminal | — | UNWIRED (shown in palette foot) |

### Wired shortcuts

| Trigger | Action | Handler location | Status |
|---|---|---|---|
| Ctrl+P / Cmd+P | Toggle command palette | App.tsx:230 | WIRED |
| Ctrl+` / Cmd+` | Toggle terminal drawer | App.tsx:233 | WIRED |
| Ctrl+, / Cmd+, | Toggle Tweaks panel | App.tsx:236 | WIRED |
| Escape (global) | Close palette + context menu | App.tsx:239 | WIRED |
| `/` (when not typing) | Focus toolbar search | App.tsx:242 | WIRED |
| Escape (in search input) | Clear search + blur | components.tsx:236 | WIRED |
| ArrowUp / ArrowDown (in palette) | Move palette selection | components.tsx:746 | WIRED |
| Enter (in palette) | Run selected palette item | components.tsx:748 | WIRED |
| Escape (in palette) | Close palette | components.tsx:745 | WIRED |

Notes:
- `Ctrl+H` (Toggle Hidden) is printed on the View menu but **not** bound as a keydown. Clicking the menu item works; pressing Ctrl+H does not. UNWIRED as a shortcut.
- There is no `preventDefault` on Ctrl+H/O/N/S/A etc., so those keys fall through to the webview (browser) defaults.

## Right-click / context-menu surfaces

The app calls `document.addEventListener("contextmenu", e => e.preventDefault())` globally (App.tsx:256-260). That suppresses the webview's native menu on every element, so any region **without its own `onContextMenu` handler becomes dead to right-click** — no menu at all appears.

| Region | Handler | Status | Notes |
|---|---|---|---|
| Titlebar traffic lights | — | UNWIRED | right-click dead |
| Titlebar tabs | — | UNWIRED | should offer close/duplicate/move |
| Titlebar tab "+" / "⌄" | — | UNWIRED | |
| Menubar top items | — | UNWIRED | |
| Toolbar nav buttons (back/forward/up/refresh) | — | UNWIRED | back/forward commonly have history context menu |
| Toolbar breadcrumb crumbs | — | UNWIRED | typical target for "copy path" context menu |
| Toolbar search input | — | UNWIRED | native input context menu suppressed |
| Toolbar view-toggle buttons | — | UNWIRED | |
| Sidebar PINNED rows | — | UNWIRED | should offer unpin/rename |
| Sidebar drive rows | — | UNWIRED | |
| Sidebar TREE rows | — | UNWIRED | |
| Sidebar TAGS rows | — | UNWIRED | |
| Sidebar DEVICES / REMOTE rows | — | UNWIRED | |
| FilePane empty area | onContext → CONTEXT_EMPTY | WIRED | components.tsx:422 |
| FilePane row | onContext → CONTEXT_FILE | WIRED | components.tsx:441 |
| FilePane column headers | — | UNWIRED | typical target for "columns to show" menu |
| Inspector hero / metadata / chips | — | UNWIRED | |
| Inspector QUICK ACTIONS chips | — | UNWIRED | |
| StatusBar segments | — | UNWIRED | |
| TerminalDrawer tabs | — | UNWIRED | |
| TerminalDrawer body | — | UNWIRED | also no text-copy context menu |
| Tweaks panel controls | — | UNWIRED | |
| Palette overlay / rows | — | UNWIRED | |

## Other input methods

### Double-click

| Target | Action | Location | Status | Notes |
|---|---|---|---|---|
| FilePane row | Open (goTo folder / openWithDefault) | components.tsx:440 | WIRED | Only folders navigate; files pass through but the onOpen only handles folder case at App.tsx:548-552 |
| Titlebar tab | — | — | UNWIRED | No handler; common UX is rename-tab on dblclick |
| Titlebar empty area | — | — | UNWIRED | Common UX is toggleMaximize |
| Toolbar breadcrumb | — | — | UNWIRED | |
| Sidebar row | — | — | UNWIRED | |
| Inspector fields | — | — | UNWIRED | editable metadata? not present |
| TerminalDrawer tab | — | — | UNWIRED | |

### Drag / drop

| Surface | Handler | Status | Notes |
|---|---|---|---|
| Titlebar (`data-tauri-drag-region`) | Tauri window drag | components.tsx:32 | WIRED | native window drag |
| Titlebar tabs row (`data-tauri-drag-region`) | Tauri window drag | components.tsx:38 | WIRED | same |
| Tab reordering (drag tab to new index) | — | UNWIRED | tabs do not reorder |
| File row drag (to move/copy) | — | UNWIRED | no `draggable`/`onDragStart` on rows |
| File drop onto sidebar pinned row | — | UNWIRED | no `onDrop`/`onDragOver` |
| File drop onto breadcrumb crumb | — | UNWIRED | |
| External file drop into pane (OS → app) | — | UNWIRED | no Tauri drag-drop listener registered |
| FilePane column resize / reorder | — | UNWIRED | columns are fixed grid |
| Sidebar width resize | — | UNWIRED | no splitter |
| Inspector width resize | — | UNWIRED | no splitter |
| TerminalDrawer height resize | — | UNWIRED | fixed height in CSS |
| Tweaks panel drag-to-move | — | UNWIRED | fixed position |

### Text input fields

| Input | Handler | Status | Notes |
|---|---|---|---|
| Toolbar fuzzy search | onSearchChange → setSearchQuery → fuzzyFilter of rows | components.tsx:231 | WIRED | |
| Palette command input | setQ → fuzzyFilter(PALETTE) | components.tsx:764 | WIRED | |
| Tweaks theme `<select>` | setState.theme | components.tsx:867 | WIRED | |
| Tweaks font `<select>` | setState.font | components.tsx:873 | WIRED | |
| Rename prompt | window.prompt (browser) → renameEntry | App.tsx:357 | WIRED | Uses browser prompt — no in-app dialog |
| New Folder prompt | window.prompt → makeDir | App.tsx:405 | WIRED | browser prompt |
| New File prompt | window.prompt → writeText | App.tsx:414 | WIRED | browser prompt |
| Markdown Note prompt | window.prompt → writeText | App.tsx:422 | WIRED | browser prompt |
| Script (.sh) prompt | window.prompt → writeText | App.tsx:430 | WIRED | browser prompt |
| Delete Permanently confirm | window.confirm → deleteEntry | App.tsx:368 | WIRED | browser confirm |
| Inline rename on file row | — | — | UNWIRED | No in-row editing |
| Breadcrumb path editor | — | — | UNWIRED | Breadcrumbs are read-only |
| Terminal input line | — | — | UNWIRED | Fake shell; no keystroke capture |

### Hover interactions

| Target | Behaviour | Status | Notes |
|---|---|---|---|
| Menubar top item | open dropdown when another is already open | components.tsx:122 | WIRED | rolls across menus |
| Submenu parent (.mi with kind:"sub") | expands nested dropdown | components.tsx:78-91 | WIRED | subHover state |
| Palette row | highlights (sets idx) | components.tsx:772 | WIRED | |
| Tab / button `title=` tooltips | native HTML tooltips | throughout | WIRED | title attr used for most toolbar buttons, traffic lights, drawer controls |
| File row hover preview | — | UNWIRED | no quicklook/preview on hover |
| Sidebar row hover tooltip | — | UNWIRED | no title attr on most rows |
| StatusBar segment hover details | — | UNWIRED | no tooltips on cpu/mem segments |

