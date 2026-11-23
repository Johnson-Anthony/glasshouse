# os-clipboard

Branch: `claude/os-clipboard`, from `main` at 1689eca. Survey-3 task 36.
Copy, Cut and Paste use the OS clipboard, so files go between glasshouse and other apps, and between glasshouse windows. Text copies (Copy Path and the rest) go through one helper that reports a failure.

## Status
In progress (2026-11-23).

## Design
The OS clipboard is the only clipboard. The page keeps no copy of it (`cmdState.clipboard` goes); every Paste reads the OS clipboard through the backend, whichever app or window wrote it.

**Backend** (`src-tauri/src/commands/clipboard.rs` and `clipboard/`):
- `formats.rs`, pure and tested on every platform: `x-special/gnome-copied-files`, `text/uri-list`, `application/x-kde-cutselection`, Nautilus 3.30–42's text form (read only), `file://` URIs to local paths; Windows' `DROPFILES` block and the Preferred DropEffect value.
- `gtk.rs` (Linux, X11 and Wayland): `gtk::Clipboard::set_with_data` for the write, `request_contents` for the read (no nested main loop), on the main thread.
- `win32.rs` (Windows): `OpenClipboard`, `SetClipboardData` (CF_HDROP, Preferred DropEffect, CF_UNICODETEXT), `DragQueryFileW` for the read, `GetClipboardSequenceNumber` to know when another app took the clipboard. New `windows` features only, no new crate.
- Commands: `clipboard_write_files(paths, cut)`, `clipboard_read_files()`, `clipboard_cut_paths()`, `clipboard_cut_settle()`, `clipboard_write_text(text)`, `clipboard_read_text()`; a new `clipboard` permission group.
- The cut state (which rows are dimmed) is held in the backend for every window: the paths of glasshouse's own cut while it is still on the clipboard. It ends when the clipboard changes hands (GTK drops the offer; on Windows the sequence number moves) and every window hears `clipboard-cut`.

**Frontend**:
- `src/clipboard.ts`: `copyText` (the one helper for text; an alert on failure), `readText`, `copyFiles`, `readFiles`, `settleCut`, the cut-paths subscription.
- `handlers/fileOps.ts`: Copy and Cut write; Paste reads, then runs the same `runTransfer` path as before (conflict question, undo, tags). `handlers/misc.ts`, `tools.ts`, `target.ts`, `helpers.ts`, `App.tsx`, the previews: clipboard paths and text through `clipboard.ts`.
- `site/demo/mock/backend.ts`: an in-memory clipboard for the demo.

## Steps
1. `formats.rs` with tests; the held-cut state with tests.
2. Linux GTK module; commands; permissions; lib.rs.
3. Windows module; scratch-crate type-check against `x86_64-pc-windows-msvc`.
4. Frontend: `clipboard.ts`, handlers, App; vitest for the new module and the routing tests.
5. Demo mock; `pnpm site:build`.
6. e2e flow (xclip under Xvfb): Copy offers the formats; a file copied by another app pastes; Cut in one window, Paste in another moves.
7. Hand checks under Xvfb; `docs/testing/windows.md` and `linux.md`; ARCHITECTURE; decision record.

## Tests
- cargo: the format builders and parsers, URI to path, DROPFILES, the cut state's generations.
- vitest: `clipboard.test.ts` (the helper's failure report, Paste's plan from a read), routing and undo-coverage tests updated.
- e2e: flow 5, with xclip on Linux and Windows PowerShell's clipboard on Windows.
