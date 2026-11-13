# paths-and-search: typed paths, known folders, search results

Task 17 of `docs/plans/active/survey-2.md`. The choices made, and why.

## One reading of a typed path, in `typedPath.ts`
Go to Path… (Ctrl+L), Open… (Ctrl+O) and the palette's "Go to <path>" row all go through `parseTyped` and then `openTyped` (`handlers/helpers.ts`). Before this, each handed the text to `goTo` in its own way.
- **Links:** `http://`, `https://` and `mailto:` go to `open_url`, the same three schemes the backend allows. Any other `scheme://` is refused in the prompt, rather than listed as a folder name. A `file://` URL is read as its path; on Windows one with a host is a UNC path.
- **`~`** is expanded only as `~`, `~/…` or, on Windows, `~\…`. `~name` is a name in the current folder, not another user's home, since the app has no way to look that up on Windows.
- **Relative paths** are found in the current folder, which is what Go to Path's prefilled text invites. A drive path (`C:\…`) counts as absolute on Linux too, matching `looksLikePath`.
- **`.` and `..`** are worked out as text, as `cd` does (`collapsePath` in `paths.ts`), so the breadcrumb and history never show them. On Windows the separators become `\`, which matches the paths the backend lists.
- **Quotes:** one pair of quotes around the whole input is dropped, because Windows Explorer's "Copy as path" adds them.

## Stat first, and keep the prompt open on a mistake
`openTyped` asks `path_kind` (one stat) before navigating. A folder opens, a file opens in its folder with the file selected, and a missing path is reported. Go to Path… and Open… run `openTyped` as the prompt's `submit`, so a typo shows under the field with the text still there to fix, where before it opened an error pane. The palette's row has no field to return to, so it shows an alert. When the stat itself fails ("unknown"), the folder opens anyway and the listing reports why.

## `reveal` belongs to the tab
"Open the file's folder with the file selected" is a tab action, `reveal(path)` in `state.ts`, not something callers do after `goTo`:
- The selection can only be set once that folder's listing arrives, and only the tab knows when that is. The pending reveal is checked in `list` and applied in the same `setListing` update as the rows, so no render shows the rows without the selection.
- It is satisfied only by a listing that began after it (`after`, a fetch sequence number). A watcher listing already in flight can't answer it with rows from before the file existed.
- Revealing a file in the folder already shown re-lists it quietly (no blank rows), because a search hit may be newer than the rows on screen.
- Any other navigation (or a failed listing) drops a pending reveal, so a late listing can't select something in a folder the user has left.
- It clears the filter box and the tag filter. Either could hide the file, and FilePane drops hidden rows from the selection. The reason for a reveal is to see that file.

It resolves `"selected"`, `"not-listed"` or `"dropped"`. `revealPath` then focuses the file pane on success, because FilePane scrolls to the focused row only while it has focus. On `"not-listed"` it shows a toast: usually hidden files are off (the backend search skips hidden files, but a typed path doesn't), otherwise the file has gone.

## Known folders from Tauri, with the old rule as the fallback
`knownFolder` in `api.ts` asks `@tauri-apps/api/path` (`desktopDir`, `documentDir`, `downloadDir`, `pictureDir`). On Windows these are the Known Folder API, so they follow OneDrive redirection. On Linux they read `user-dirs.dirs`, so they follow localised names. `core:default` already grants `core:path:default`, so the capability needs no change.

When the OS has no such folder set (Linux without `user-dirs.dirs`, where the `dirs` crate returns None and Tauri rejects with "unknown path"), it falls back to home plus the English name. That is the XDG default and the old behaviour. The demo's mock answers `plugin:path|resolve_directory` by Tauri's `BaseDirectory` numbers.

## Find File by Name lists its matches in a pick list
The matches go into a new `dialogs.showPick` list (↑/↓, Page Up and Down, Home, End, Enter or a click; Esc cancels), shown relative to the folder searched. The search keeps its prompt and its progress and Cancel in the ops tray. A live search dialog like Find in Files would have needed new App state and a second copy of that modal. `showPick` is a small generic addition to the promise-based dialog API, and the handler stays self-contained in `tools.ts`. Picking a match reveals it in its folder: a folder match is selected in its parent, not opened, so every result is shown "in place".

A Find in Files hit now reveals its file the same way. The modal closes first, so focus can move to the pane.
