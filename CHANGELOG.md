# Changelog

What changed in each release, for people using glasshouse. Downloads are on the [Releases page](https://github.com/Johnson-Anthony/glasshouse/releases).

## [0.2.0] - unreleased

<!-- TODO(release): before tagging v0.2.0,
  1. add the rest of wave 1 as it merges (docs/plans/active/survey-2.md:
     inspector-perms, find-replace-safety, fs-robustness, watcher-fixes)
     under the headings below; selection-integrity is in;
  2. replace "unreleased" in the heading with the release date (YYYY-MM-DD);
  3. delete this comment.
  The release workflow (scripts/release-check.mjs) refuses the tag until all three are done. -->

This release is mostly about safety: several ways to lose files are fixed, and the app is harder to misuse. Linux packages now also come for arm64 and run on older distributions.

### Upgrading from 0.1.0

- **Your settings reset once.** Theme, font and the other Tweaks are saved under a new key, so 0.2.0 starts with the defaults. Set them again once.
- **Layout files are now `.glasshouserc`.** File → Export/Import Layout uses that name. To import a layout exported by 0.1.0, rename the file to `.glasshouserc`.
- **Three menu items are gone,** because they did nothing: View → Show Ignored (.gitignore), View → Show Checksums, and Extract → Browse archive in place. The git column's "!" (ignored) badge went with them.

### Fixed: ways to lose data

- **Pasting a copy into the same folder** emptied the file (every file, for a folder), and undoing that paste deleted the original. Pasting onto an existing name silently replaced it. Paste, drag and drop, and Move to… now never copy or move onto an existing name or onto the item itself. They ask whether to replace, keep both or skip.
- **New File, New Folder and Rename** replaced an existing item with the same name, and undoing a New Folder could delete a folder that was already there. They now refuse a name that's taken, and the backend refuses it too, so a file created at the same moment isn't replaced either.
- **Extracting an archive** overwrote existing files, and a failed extraction left half the files behind. Extraction now asks the same replace / keep both / skip question, and a failure or cancel leaves nothing behind.
- **Creating an archive** replaced an existing file of that name. A failed archive is now removed instead of being left incomplete. Zip files over 4 GiB work, and an archive that leaves something out (a link, an unreadable file) says what it skipped. So does an extraction.
- **Git → Discard Changes** deleted untracked folders outright, along with ignored files and staged files that were never committed, and it followed links. It now restores tracked files from the last commit and moves untracked ones to the trash. It leaves ignored, staged-only and nested-repository files alone and lists what it skipped.
- **Git → Checkout…** with a folder name (such as `docs` or `.`) restored those files from git, discarding your changes. It now only switches branches.
- **Shred** followed symbolic links: it overwrote the file a link pointed to, then deleted only the link. It now removes the link and never touches its target.
- **Copying a folder that contains symbolic links** copied what they pointed to, and failed partway on a link to a folder. Links are now copied as links. Copying or moving a folder into itself is refused.
- **A move that failed for any reason** fell back to copy and delete. Only a move to another drive does that now.
- **Undoing a copy** deleted the copies even if you had edited them since. It now refuses when they've changed.
- **Redo** (Ctrl+Y) failed after any undo. It now redoes the action.
- **The selection moved to a different file** when the folder changed while you worked: if another program added or removed a file, the highlight shifted to its neighbour, and Delete, Rename or a drag acted on that file. The selection, the keyboard focus and a drag in progress now follow their files.
- **Commands acted on hidden or stale files.** Select All, Invert and Select by… also picked files a search filter was hiding, and while a slow folder loaded, the previous folder's files stayed on screen and could be opened or deleted. Selection commands now only see the files shown, the filter belongs to its tab and clears when you change folder, and the old folder's files go away as soon as you leave it.
- **Tabs:** closing a tab in the middle mixed up the other tabs' folders and history, and closing the last tab left none. Each tab now keeps its own state, and there's always at least one.

### Fixed: security

- **Commands from the window are limited.** The app's interface can only call the app's own commands, with their arguments checked, and release builds have no developer tools.
- **Windows:** file names and URLs containing `&`, `|` or `^` could run commands, because they went through `cmd`. Programs are now started directly.
- **Linux:** a crafted `wsl` terminal profile could run any program.
- **Terminal:** the `cd` the terminal sends to follow the current folder is quoted for each shell, so a folder name can't run commands. It's only typed at an empty prompt, and Terminal → Follow Folder turns it off.
- **Archives:**
  - a file name starting with `-` can't be read as a `tar` option;
  - a link inside a zip can't point outside the folder it's extracted to;
  - extracted files lose setuid and setgid bits;
  - on Windows, files extracted from a downloaded archive keep its "downloaded from the internet" mark.
- **Scripts:** a script that times out is stopped together with every program it started.
- **No requests to Google:** the font picker's fonts are bundled, so the app makes no Google Fonts request at startup.

### New

- **Miller columns** (View → Display Mode, Ctrl+7): a column view in the style of ranger.
- **Previews:**
  - the Inspector previews text, images, PDF pages, audio and binary files by type;
  - Space opens a selected file in Quick Look.
- **Progress and Cancel** for hashing, copying and Find in Files. Long operations no longer freeze the window.
- **Extract** in the file's right-click menu. Zip extraction is built in.
- **Symbolic links** are marked in the file list, and on Linux a link to a folder opens as a folder.
- **Help → Third-party Notices** lists the licenses of the bundled fonts and of every npm and Rust dependency.
- **Linux:**
  - Reveal in File Manager selects the file;
  - the terminal starts your `$SHELL`;
  - VSCodium and `7zz` are found as well as `code` and `7z`;
  - the trash follows `XDG_DATA_HOME`.
- **Linux arm64** packages (`.AppImage` and `.deb`). The Linux packages now run on Ubuntu 22.04, Debian 12 and newer.

### Changed

- **Keys and menus act on what has focus:**
  - Enter in a dialog no longer also opens the selected file behind it;
  - Delete, F2 and the copy and paste keys act only while the file list has focus;
  - Ctrl+C copies selected text, such as text in a preview, instead of the selected files.
- **Dialogs:** Tab to Cancel, then Enter, now cancels (it used to confirm), and a dialog gives focus back when it closes.
- **Find in Files:** Ctrl+Shift+F no longer closes it; Esc does.
- **Sidebar:** a file in the sidebar (a pinned file, or the folder tree with Show files on) opens with its default app and has its own right-click menu. A right-click on empty space in the file list shows the New / Paste menu, even when something is selected.
- **Git → Stage** works on folders, as `git add` does.
- **Every shortcut shown in a menu now works,** including the Ctrl+G git chords and Ctrl+Shift+C (Copy Path).
- **Copy as Command** on Windows gives PowerShell syntax.
- **Moving a folder onto an existing empty folder** fails. On Linux it used to replace the empty folder.
- **Other fixes:**
  - the file list shows an error for a folder it can't read, instead of an empty list;
  - a folder with a dot in its name (`foo.d`) shows its whole name;
  - Miller columns no longer show `README.md.md`;
  - Bulk Rename's digits field pads `{n}`;
  - chmod rejects partial octal input;
  - Git Blame and Diff refuse files over 16 MiB instead of reading them whole;
  - About shows the real version and build date;
  - pasting a lot of text into a busy terminal no longer freezes the app;
  - context menus stay inside the window;
  - narrow panes drop columns before they cut off names.

### Known issues

- The installers are not signed. Windows SmartScreen warns the first time you run one: choose More info → Run anyway.
- Esc doesn't clear the selection in Miller columns.
- The Back and Forward buttons look enabled when there's nowhere to go.
- With the file list focused, it can scroll back to the focused row when the window updates.
- On Windows:
  - copy progress counts whole files, so one big file shows no progress until it's done;
  - a file whose name differs only in case from git's index has no git status;
  - New Symlink with a relative target can pick the wrong link type.
- On network file systems (NFS) and some FUSE mounts, a rename made at the same moment by another program can still be replaced.
- Saved ssh remotes need ASCII host names.
- macOS isn't built or tested.

## [0.1.0] - 2026-07-16

First release: Windows installers (`.msi`, `.exe`) and Linux x64 packages (`.AppImage`, `.deb`).
