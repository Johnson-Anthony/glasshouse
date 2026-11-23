# os-clipboard: one clipboard, the OS's

Date: 2026-11-23. Task: `os-clipboard` (survey-3 task 36). Plan: `docs/plans/completed/os-clipboard.md`. Code: `src-tauri/src/commands/clipboard.rs` with `clipboard/formats.rs` (pure), `clipboard/linux.rs` (GTK) and `clipboard/win32.rs`; `src/clipboard.ts`. The formats agree with a drag out (`2026-11-13-os-drag-drop-design.md`), and a paste runs the transfer the paste-conflicts policy describes (`2026-11-08-paste-conflicts-policy.md`), unchanged.

## Context
- Copy and Cut put the selection in a variable of one page (`cmdState.clipboard`). Nothing reached the OS, so a Paste in Explorer, Nautilus, Dolphin, a mail or a chat app did nothing, and files copied there couldn't be pasted in glasshouse.
- Since task 50 every window is one process, but each has its own page: a Copy in one window couldn't be pasted in another.
- Copy Path and the other text copies used the webview's `navigator.clipboard`, each with its own try/catch. When the webview refused (no focus, no permission), most only logged it.

## Chosen
**The page keeps no clipboard. Copy and Cut write the OS clipboard; Paste reads it, every time.** A paste from another window or another app is then the same thing as a paste in the window that copied, through the same code: `runTransfer`, the undo entry, the keep both / replace / skip question, tags following a move.

### What Copy and Cut offer
- **Linux** (GTK's clipboard, the same call on X11 and Wayland):
  - `text/uri-list`: percent-encoded `file://` URIs, CRLF-ended, built by the function a drag out uses (`formats::uris_and_text`).
  - `x-special/gnome-copied-files`: `cut` or `copy`, then the URIs, one a line. Nautilus (43 on), Nemo, Caja, Thunar and PCManFM read it.
  - `application/x-kde-cutselection`: `1` for a cut, `0` for a copy. Dolphin and Krusader read it beside the URI list.
  - The plain paths, one a line, under the five text targets, so a paste into a terminal, an editor or a chat gives the path, as a drag out does.
- **Windows:** `CF_HDROP` (a `DROPFILES` block of wide paths) and `Preferred DropEffect` (move for a cut, copy-or-link for a copy), which is what Explorer writes. No text beside files, as in Explorer: a file path pasted into an editor is what Copy Path is for.
- Paths are checked before they're offered (`checked`): absolute, no NUL, at most 100 000.

### What Paste takes
What's on the clipboard is another app's data, so it's read narrowly.
- **Linux:** GNOME's format when it's offered (it says cut or copy itself), else the URI list with KDE's flag, else text, but only when the text is the form Nautilus 3.30 to 42 writes (`x-special/nautilus-clipboard`, then `cut` or `copy`, then URIs). Any other text is not files.
- **Windows:** `CF_HDROP` through `DragQueryFileW`, and `Preferred DropEffect`'s move bit.
- Only local files: a `file://` URI with no host or `localhost`, percent-decoded once, giving an absolute path. Anything else (`sftp://`, `trash://`, a relative path) is counted and named in a toast ("not on this computer"), never pasted.
- Caps: 32 MiB read from a target, 100 000 files, 64 KiB for a text read. Past the file cap Paste refuses with a message instead of pasting part of a selection.
- A file that's no longer there is left out and counted ("no longer there"). The backend says whether each path is a folder, so the page doesn't trust a guess.
- **The GTK main loop is never blocked or re-entered.** Each read is GTK's callback form (`request_contents`) started on the main thread; the command waits on a channel on its worker thread, for at most 5 s, then fails with "the clipboard didn't answer". On Windows `OpenClipboard` is retried 10 times, 25 ms apart, since another app may hold it; then the failure is shown ("another app is using the clipboard").

### An honest Cut
A cut moves nothing until it's pasted. The rows of a cut are dimmed in every window, and only while the cut can still be pasted: **the dimmed rows mirror glasshouse's own cut for exactly as long as the OS clipboard holds it.** It ends when:
1. **Anything else is copied or cut, in any app or any glasshouse window.**
   - Linux: GTK drops the offer's closure when the clipboard gets another owner (its clear function, on X11 and Wayland alike). The closure's `Drop` ends the cut. No owner-change signal and no polling are needed.
   - Windows: the clipboard's sequence number is kept when glasshouse writes. A different number means someone else wrote. It's checked when a window opens or gets the focus (which is when the user comes back from the app they copied in), and at every Paste.
2. **It's pasted in glasshouse and none of its files is where it was.** The backend then clears the clipboard, which it owns, so no other app can paste a cut whose files have moved. Files that stayed (a name skipped at the conflict question, a failure) stay cut and can be pasted again.
3. **Another app pasted it.** No desktop tells the source reliably (Explorer doesn't for a `CF_HDROP` that isn't an OLE data object; Linux file managers clear only their own clipboard). So the next Paste in glasshouse finds every cut file gone, says "nothing to paste: N items no longer there", and the backend clears the dead cut. Until then the rows that were dimmed are gone from the listing anyway, because the files moved.
- The backend holds the cut (`Held`, with a generation id so a late end of an older offer can't end a newer one) and sends `clipboard-cut` with the paths to every window on each change. A window also asks (`clipboard_cut_paths`) when it opens and when it gets the focus.
- **Another app's cut pasted in glasshouse moves the files.** Afterwards, when every item moved:
  - Windows: glasshouse sets `Paste Succeeded` (move) on the clipboard's data object, which is how Explorer learns to drop its cut marks. It doesn't set `Performed DropEffect`: the files were moved by glasshouse, and that value would ask the source to delete originals that are already gone.
  - Linux: nothing. The clipboard is the other app's to clear; glasshouse clears only a clipboard it owns. A second Paste finds the files gone and says so.

### Paste stays enabled
The menus, the palette and the context menu have no disabled state at all (no item anywhere is greyed out), and knowing whether the clipboard holds files would take a read of another app's data each time a menu opens. So Paste is always enabled and says why when there's nothing to paste: "the clipboard holds no files", "N items no longer there" or "N items not on this computer". A disabled state for menu items would be its own task.

### Text
`copyText` in `src/clipboard.ts` is the one helper for Copy Path, Copy as Command, Copy as UNC, the WSL path, a checksum, the preview's and the inspector's copies. It writes through the backend (`clipboard_write_text`), which doesn't depend on the webview's focus or permission, and shows a "copy failed" dialog when the write fails. A page outside the app (the site demo, a browser) falls back to `navigator.clipboard`. Paste Text into Filename and Diff with Clipboard read through the backend too.

### At exit
On exit glasshouse asks the desktop's clipboard manager to keep what it offered (`gtk_clipboard_store`, with every target marked storable), so a copy outlives the last window where a manager runs. On Windows nothing is needed: the data was handed to the system when it was written.

## Not chosen
- **Keeping the page's clipboard beside the OS's**, as a fast path for a paste in the same window. Two clipboards can disagree (the user copies in another app, then pastes in glasshouse), and the cut state would have two sources.
- **A clipboard crate** (`arboard`, `clipboard-rs`, the Tauri clipboard plugin). None writes `x-special/gnome-copied-files` or KDE's flag, and none reports the loss of ownership. GTK and the `windows` crate are already dependencies; the lockfile is unchanged (five more `windows` features).
- **`wait_for_contents`.** It spins a nested main loop, in which window events, a drag or a tab handoff can arrive in the middle of a command.
- **Polling the clipboard**, or reading it when a menu opens, to enable Paste. See "Paste stays enabled".
- **A clipboard format listener on Windows** (`AddClipboardFormatListener`). It needs a message-only window and its own thread to un-dim rows a moment sooner while glasshouse is in the background. The check at focus covers what the user can see.
- **Ending the cut when a paste starts.** A paste that's skipped or fails would leave files that are neither moved nor cut.

## Limits
- **Nautilus 3.30 to 42** (Ubuntu 20.04 and 22.04) reads only its own text form, which can't be offered together with plain paths as text. Those versions can't paste files copied in glasshouse; glasshouse pastes theirs. Dragging works in both directions.
- **Explorer pasting glasshouse's cut isn't heard.** The rows are gone from the listing (the files moved), and the cut ends at the next Paste or the next copy anywhere (rule 3).
- **Wayland.** GTK's clipboard calls are the same, but a window can read the clipboard only while it has the focus, which a Paste by key or menu always has. `gtk_clipboard_store` does nothing on Wayland: whether a copy outlives the app is up to the compositor or its clipboard manager. This task's runs were on X11 (Xvfb); see the plan for what wasn't run.
- **Copy Path with several files selected** still copies one path, as before.
- The Clipboard Stack and File Queue items are untouched; task 16 removes them.
