# Commands handled twice: App.tsx keeps them, the handler side goes

Date: 2026-11-08 · Task: dead-code

## Context
19 labels had a case both in App.tsx (the global switch in `handleMenuCommand`, or `doFileOp`) and in a `src/handlers/*.ts` file. App.tsx runs first, so the handler cases never ran: nav New Tab, Home, Open in Terminal, Open in VS Code; misc Preferences/Preferences…, Refresh/Reload, Clear All Tags, Text File, Markdown Note, Script (.sh), Open With →; tools Checksum (SHA256)/Checksum SHA256, Copy as WSL Path, Compress →, Open With →; view Tag →.

## Decision
The App.tsx case is the owner and the handler case is deleted.
- It's what users get today, so nothing changes in behavior. Several App.tsx versions are also the better ones: Copy as WSL Path converts the path where the handler copied it unchanged, Clear All Tags covers the whole selection and asks first, and the New-file items push undo entries.
- Moving them the other way, into the handlers, would rewrite App.tsx code that other branches are editing (create-rename-conflicts is in the New File code), and split-big-files will reorganize App.tsx anyway.
- Two `HandlerCtx` fields lost their last users and went too: `openTweaks`, and `openPalette`, which nothing used before either.

## Consequences
- `pnpm check:wiring` fails on any new shadowed case, so this can't quietly come back.
- Where a command lives is still split between App.tsx and the handlers. split-big-files can decide whether App.tsx's cases move out.
