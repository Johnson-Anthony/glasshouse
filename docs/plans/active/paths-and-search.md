# paths-and-search (survey-2 task 17)

Branch `claude/blissful-pare-68a0fc`. Frontend only.

## Status
Done; see "Result" below.

## The problems
- **Typed paths.** Go to Path… (Ctrl+L), Open… (Ctrl+O) and the palette's "Go to <path>" row hand the typed text to `goTo` as it is. `~` is expanded only by the palette's row, a URL is listed as a folder, a relative path or `..` isn't resolved, and a file's path gives "can't read this folder". (The toolbar's path bar has no text entry; Ctrl+L, which the path bar answers to elsewhere, is Go to Path….)
- **Known folders.** Go → Desktop, Documents, Downloads and Pictures are `home + "Documents"`, which is wrong with OneDrive folder redirection on Windows and with localised XDG folders on Linux.
- **Search results.** A Find in Files hit opens the file's folder with nothing selected. Find File by Name lists its matches as alert text, which you can't act on.

## Plan
1. **`src/typedPath.ts`** (pure, both platforms tested): `parseTyped(input, cwd, home, win)` → a URL to open, a path, or an error.
   - Trim; drop one pair of quotes around the whole thing (Windows' "Copy as path" adds them).
   - `http://`, `https://` and `mailto:` → a URL. `file://` URLs → their path. Any other `scheme://` → "can't open" error (the backend's `open_url` allows only those three).
   - `~`, `~/…` (and `~\…` on Windows) → home.
   - A relative path joins the current folder.
   - `.`, `..` and repeated separators collapse (`collapsePath` in `paths.ts`, per platform).
2. **`openTyped(text, ctx)`** in `handlers/helpers.ts`: parse, then a URL goes to `openUrl`; a path is stat'ed (`path_kind`): a folder is opened, a file's folder is opened with the file selected, and a missing path is an error. Go to Path… and Open… run it as the prompt's `submit`, so a typo shows inline and the prompt stays open. The palette's row (navHandler's fallback) shows the error in an alert.
3. **`reveal(path)` tab action** (`state.ts`): goes to the parent folder (or re-lists it when it's the folder shown), clears the filter box and tag filter, and when that folder's listing arrives selects, focuses and anchors the file (`selectOnly` in `listing.ts`). It resolves `"selected"`, `"not-listed"` (hidden files off, or gone) or `"dropped"` (another navigation came first, or the listing failed). `revealPath` (helpers) focuses the file pane on success, so the row scrolls into view, and toasts on `"not-listed"`.
4. **Known folders:** `knownFolder(name)` in `api.ts` asks Tauri's `desktopDir`, `documentDir`, `downloadDir`, `pictureDir` (`core:default` already grants `core:path:default`), falling back to home + the English name when the platform has none set (XDG's own default). The demo's mock answers `plugin:path|resolve_directory`.
5. **Search results:**
   - Find in Files: a hit reveals the file (App.tsx's `onPick`).
   - Find File by Name: the matches go into a pick list, a new `dialogs.showPick` in DialogHost (↑/↓, Enter, click; Esc cancels). Picking one reveals it in its folder.

## Tests
- `typedPath.test.ts`: URLs, `file://`, quotes, `~`, relative, `..`, errors, both platforms. `paths.test.ts`: `collapsePath`.
- `listing.test.ts`: `selectOnly`.
- `useTabState.test.tsx`: reveal selects the file after the listing, in another folder and in the shown one; a navigation drops it; a missing file gives `"not-listed"`.
- Routing tests: Go to Path…, Open… and the palette's row with a file, a folder, a URL and a missing path; Desktop and the rest use `knownFolder`; Find File by Name reveals the picked match.
- Demo check (`site:capture check`): Go to Path with a file path opens the folder with the file selected.

## Result
- Done as planned. The choices are in `docs/decisions/2026-11-13-paths-and-search-design.md`.
- Dropped: letting the palette offer "Go to" for a UNC path. It needs `looksLikePath` to know the platform, and the backlog didn't ask for it.
- Checked by hand in the demo: Find File by Name's list (arrows, Enter) opened `Pictures/wallpapers` with `aurora.jpg` selected and the pane focused; a Find in Files hit opened `recipes` with `bread.md` selected; Go → Documents went through the path API; a misspelled Go to Path stayed open with the error under the field.
- Not built or run here: the Windows side of Tauri's known-folder lookups (OneDrive redirection). The frontend only calls `documentDir()` and the rest, so there's no Windows-only code in this change.

## Out of scope
- Find File by Name's "(fuzzy)" label (it's a substring match): task 16, menu-honesty.
- Keyboard navigation inside the Find in Files dialog.
