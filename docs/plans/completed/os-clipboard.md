# os-clipboard

Branch: `claude/os-clipboard`, from `main` at 1689eca. Survey-3 task 36.
Copy, Cut and Paste use the OS clipboard, so files go between glasshouse and other apps, and between glasshouse windows. Text copies (Copy Path and the rest) go through one helper that reports a failure.

## Status
Done (2026-11-23), on `claude/os-clipboard`. The choices are in `docs/decisions/2026-11-23-os-clipboard-design.md`.

**Built**
- Backend: `commands/clipboard.rs` (the six `clipboard_*` commands, the cut state, `clipboard-cut`), `clipboard/formats.rs` (pure: builds and reads every format, sanitizes what's read), `clipboard/linux.rs` (GTK, callbacks answered through a channel with a 5 s deadline), `clipboard/win32.rs` (`CF_HDROP`, `Preferred DropEffect`, `Paste Succeeded`). A drag out builds its URIs with the same function. No new crate; five more `windows` features.
- Frontend: `src/clipboard.ts` (`copyText`, `copyFiles`, `filesToPaste`, `afterPaste`, `useCutPaths`). `cmdState.clipboard` and `setCutPaths` are gone. Copy, Cut, Paste, Paste Special…, Copy Path and every other text copy go through it.
- The site demo's mock backend keeps a clipboard of its own.
- e2e flow 5, with xclip (Linux) or `e2e/windows-clipboard.ps1` (Windows) as the other app; `xclip` added to the workflow's apt line.
- Hand checks: `docs/testing/windows.md` W16, `docs/testing/linux.md` L14.

**Checks (Linux arm64, the final tree)**
- `pnpm build`: clean. `pnpm test`: 1244 passed, 2 skipped (88 files). `pnpm check:wiring`: 0 problems. `pnpm notices --check`: up to date (no lockfile change).
- `RUSTFLAGS="-D warnings" cargo clippy --all-targets`: clean. `cargo test`: 434 passed, 5 ignored (15 of them the clipboard's).
- `pnpm tauri build --debug --no-bundle`, then `pnpm e2e`: 12 of 12, flow 5 included.
- `pnpm site:build` (`docs/demo` rebuilt and committed), `pnpm site:capture check`: 25 PASS, 0 FAIL.
- Windows module: `formats.rs` and `win32.rs` pass `cargo clippy --target x86_64-pc-windows-msvc` with `-D warnings` in a scratch crate that stands in for the parent module and for tauri.
- `e2e/windows-clipboard.ps1` parses (pwsh 7.7); `actionlint`: clean.

**Hand tests (X11 under Xvfb, debug build, scratch home, private bus)**
- e2e flow 5 is the hand test, kept: every target with its exact bytes (a name with a space and an accent), Copy Path, the cut row dimming and un-dimming when xclip takes the clipboard, a cut pasted in a second window (the file moves, the clipboard empties, no row stays dimmed), xclip's `text/uri-list` copy and `x-special/gnome-copied-files` cut pasted in glasshouse.
- Copy, then Ctrl+Q (xdotool): `SAVE_TARGETS` is offered, the app exits with code 0 at once, and with no clipboard manager running nothing stays on the clipboard.

**Not built or run**
- **Windows:** nothing ran. `win32.rs` is type-checked only; `clipboard.rs` itself (shared code) was compiled for Linux only. e2e flow 5's Windows side (`windows-clipboard.ps1`, the `focus` event the flow sends) has never run: the lead watches its first CI run.
- **Wayland:** not run. Only niri is installed, and a nested niri opens on the owner's screen. The GTK calls are the same as on X11. Unchecked there: that a Copy by key always carries a serial the compositor accepts, a paste in a second window of the same process, the cut ending when another client copies (GTK's clear function on `wl_data_source.cancelled`), and what stays after exit (`gtk_clipboard_store` does nothing on Wayland).
- **A real file manager** (Nautilus, Dolphin, Thunar) on either side: none is installed here. xclip stood in for them, writing and reading the formats they use.
- **A clipboard manager at exit** (`gtk_clipboard_store` with a manager running): none is installed; L14.11 is the hand check.

**For review**
- `clipboard::at_exit()` runs `gtk_clipboard_store` in `RunEvent::Exit`. With a clipboard manager it waits in a nested main loop (GTK's own, at most 10 s) after the windows are gone. Not seen with a manager.
- On Windows the cut state is refreshed when a window opens or gets the focus and at every Paste, not by a format listener.
- Paste stays enabled everywhere and says "nothing to paste…" on use: no menu item can be disabled today.
- `scripts/audit-wiring.mjs` counts `if (await f()) toast` as theater, so Copy and Cut keep the call in its own statement.

**Follow-ups found, not done**
- A Wayland leg for `pnpm e2e` (a headless compositor such as sway with `WLR_BACKENDS=headless`, and wl-clipboard as the other app). It would cover this task's and the drag tasks' "Wayland not run".
- A disabled state for menu, palette and context-menu items, then Paste greyed out when the clipboard holds no files.
- Nautilus 3.30 to 42 can't paste glasshouse's copies (it reads only its own text form).
- Explorer pasting glasshouse's cut isn't signalled back; offering the files as an OLE data object (as the `drag` crate does for a drag) would let Explorer report it.
- Copy Path with several files selected copies one path.
- CLAUDE.md's e2e line could say the suite needs xclip (ARCHITECTURE.md does).

## Design
The OS clipboard is the only clipboard. The page keeps no copy of it (`cmdState.clipboard` goes); every Paste reads the OS clipboard through the backend, whichever app or window wrote it.

**Backend** (`src-tauri/src/commands/clipboard.rs` and `clipboard/`):
- `formats.rs`, pure and tested on every platform: `x-special/gnome-copied-files`, `text/uri-list`, `application/x-kde-cutselection`, Nautilus 3.30–42's text form (read only), `file://` URIs to local paths; Windows' `DROPFILES` block and the Preferred DropEffect value.
- `linux.rs` (Linux, X11 and Wayland): `gtk::Clipboard::set_with_data` for the write, `request_contents` for the read (no nested main loop), on the main thread.
- `win32.rs` (Windows): `OpenClipboard`, `SetClipboardData` (CF_HDROP, Preferred DropEffect, CF_UNICODETEXT), `DragQueryFileW` for the read, `GetClipboardSequenceNumber` to know when another app took the clipboard. New `windows` features only, no new crate.
- Commands: `clipboard_write_files(paths, cut)`, `clipboard_read_files()`, `clipboard_cut_paths()`, `clipboard_cut_pasted(stamp, done)`, `clipboard_write_text(text)`, `clipboard_read_text()`; a new `clipboard` permission group.
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
