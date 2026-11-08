# Toggles that did nothing: removed, not implemented

Date: 2026-11-08 · Task: dead-code

## Context
Three menu items looked like features but weren't:
- **View → Show Ignored (.gitignore)**, with a matching Tweaks row, flipped `showIgnored`, which nothing read. Since backend-bugs, the backend doesn't detect ignored files at all, and the "!" badge the git column kept for them could no longer appear.
- **View → Show Checksums** flipped `showChecksums`, which nothing read.
- **Tools → Extract → Browse archive in place** opened the archive in the default app.

## Decision
Remove all three, and the "!" badge with them.
- **Show Ignored:** doing it properly means `list_dir` reporting ignored entries again plus a filter in the pane, and a default that doesn't suddenly hide `node_modules` or `target` from people who never touched the switch. That's a feature, and async-commands is about to rework the backend commands it would touch.
- **Show Checksums:** the Inspector's CHECKSUMS section already computes sha256, md5 and crc32 on request. Hashing every selected file automatically would block the UI on big files while commands still run on the main thread.
- **Browse archive in place:** an in-app archive browser is a feature of its own, and Open With → Default App already does what the item did.

## Consequences
- Saved tweaks in `localStorage["glasshouse.tweaks"]` may still carry `showIgnored` or `showChecksums`. They're ignored, and harmless; no migration.
- If ignored-file handling comes back, it needs the backend status, the "!" code in `GitStatus`, `normalizeGit`, `gitDotClass` and the git column, and a menu item. It's worth its own task.
