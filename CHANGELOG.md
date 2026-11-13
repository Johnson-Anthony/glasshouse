# Changelog

What changed in each release, for people using glasshouse. Downloads are on the [Releases page](https://github.com/Johnson-Anthony/glasshouse/releases).

## [Unreleased]

### New

- **Drag files out into other apps.** Drag files past the edge of the window and drop them into a browser's upload field, a terminal (which types the path) or another file manager. They're always copied.
- **Drop files in from other apps.** Files dragged from a file manager or a browser's downloads onto a folder, the file list, a tab, a breadcrumb or a sidebar folder are copied there. You're asked before anything is replaced, and Ctrl+Z undoes it.
- **Tabs and breadcrumbs take drops,** and the folder under the pointer lights up while you drag.
- **The command palette (Ctrl+P) finds every menu command** (about 155, up from 19), each once, with where it lives in the menus and its shortcut. Typing a path such as `/etc` or `~/src` offers to go there.
- **Typed paths work:** Go to Path…, Open… and the palette's "Go to" row expand `~`, resolve relative paths and `..`, open http(s) and mailto links in the browser, and open a file's folder with the file selected. A path that doesn't exist is reported in the prompt instead of opening an error pane.
- **Search results open in place.** A Find in Files result opens its folder with the file selected. Find File by Name lists its matches to pick from, instead of in an alert.
- **Menus work from the keyboard:** arrow keys, Home/End, Enter and Esc, → and ← into and out of submenus, and a letter jumps to the next item starting with it. Alt alone or F10 opens the menubar, and ← → move between menus. Each menu has its own underlined letter for Alt+letter (Git is now G*i*t, Terminal Te*r*minal). The Menu key or Shift+F10 opens the context menu of the selection, or the New/Paste menu when nothing is selected. Focus goes back where it was when a menu closes.
- **Type-ahead in the file list:** typing a name's first letters jumps to it, and repeating a letter cycles through the names starting with it.
- **Big folders are fast.** In Details, Compact List and Tree the file list only draws the rows on screen, so a 10,000-file folder opens in about 0.1 s instead of 0.7 s. Arrow keys, End, box selection and filtering stay instant at any size, and sorting a large folder is about 4× faster.
- **The app starts with less to load:** the terminal loads the first time you open it.
- **Move to Trash can be undone:** Ctrl+Z restores the items, and Ctrl+Y trashes them again. Undo refuses, saying why, if a name is taken again or an item has left the trash.
- **Go → Trash** shows what's in the Trash (the Recycle Bin on Windows): each item's name, original folder, deletion time and size, with Restore, Delete Permanently and Empty Trash. Restore can be undone. A taken name is refused, never replaced.

### Changed

- **Ctrl+drag copies, as in Explorer and Nautilus.** A plain drag still moves. Shift used to copy; now it moves. The label next to the pointer says which, and changes as you press Ctrl. Ctrl+drag into the folder the files are already in makes copies of them ("name (copy)"), as Copy then Paste does.
- The palette no longer advertises things it can't do (`:mode`, `:go`, `/find`, `?help`, `!shell`, Tab autocomplete, Ctrl+` to run in the terminal).
- **Refreshing in a large git repo is faster.** At the repo's root a refresh scans the repo once instead of twice, and moving between folders reuses the last change count (up to 30 s old) unless HEAD or the index moved.
- **Folders with tens of thousands of files list about 3× faster.**
- A big paste or another burst of changes re-lists the folder about twice a second, plus once at the end, instead of on every change. Tabs in the background wait until they're shown.
- The sidebar loads drives and WSL distros alongside the home folder. The WSL list has a 5 s time limit and is kept for 5 minutes.

### Fixed

- Ctrl+G then Delete (or an arrow key) acted on the file list instead of cancelling the git chord. A click on the menubar no longer leaves the file list without keyboard focus.
- Go → Desktop, Documents, Downloads and Pictures open the folders the OS names: OneDrive-redirected folders on Windows, localised folders on Linux.
- Running a command from the palette with Enter could also confirm the dialog it opened (New Folder created "new-folder" without asking). The palette's arrow keys now follow its rows as shown, and the highlighted row stays in view.
- **The sidebar tree follows changes on disk.** A deleted, renamed or new folder shows up in the tree without a manual Refresh, and clicking a folder that no longer exists removes its row instead of opening an error.
- On Windows, an empty card reader or CD drive no longer shows a "no disk" dialog, and a disconnected network drive no longer stalls the drive list. A drive that takes over 2 s to answer is left out.
- The file list no longer jumps back to the focused file when something else in the window updates.
- A folder check that finds nothing new no longer redraws the window, in any tab.
- A box selection with Shift or Ctrl held keeps the files it started with if the folder changes mid-drag.
- On Windows, Move to Trash on a network or removable drive, which has no Recycle Bin, now asks before deleting permanently instead of deleting with no warning.

## [0.2.0] - 2026-11-12

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
- **A failed folder copy** left a half-made folder behind. It's now removed, read-only subfolders included, and the error names the item that failed. When a move to another drive copies a folder but can't remove all of the original, it keeps the complete copy and says what was left behind, so nothing is lost.
- **A move that failed for any reason** fell back to copy and delete. Only a move to another drive does that now.
- **Undoing a copy** deleted the copies even if you had edited them since. It now refuses when they've changed.
- **Redo** (Ctrl+Y) failed after any undo. It now redoes the action.
- **The selection moved to a different file** when the folder changed while you worked: if another program added or removed a file, the highlight shifted to its neighbour, and Delete, Rename or a drag acted on that file. The selection, the keyboard focus and a drag in progress now follow their files.
- **Commands acted on hidden or stale files.** Select All, Invert and Select by… also picked files a search filter was hiding, and while a slow folder loaded, the previous folder's files stayed on screen and could be opened or deleted. Selection commands now only see the files shown, the filter belongs to its tab and clears when you change folder, and the old folder's files go away as soon as you leave it.
- **Find & Replace in Files** could permanently garble files in other encodings (Latin-1, cp1252) and overwrote them in place. It now changes only UTF-8 text, byte for byte around the matches, and replaces each file atomically, keeping its permissions (and on Windows its attributes and downloaded-file mark). It never writes through a link or outside the searched folder, and lists the files it left alone and why: another encoding, binary, over 16 MiB, read-only or hard-linked.
- **Tabs:** closing a tab in the middle mixed up the other tabs' folders and history, and closing the last tab left none. Each tab now keeps its own state, and there's always at least one.

### Fixed: security

- **Commands from the window are limited.** The app's interface can only call the app's own commands, with their arguments checked, and release builds have no developer tools.
- **Windows:** file names and URLs containing `&`, `|` or `^` could run commands, because they went through `cmd`. Programs are now started directly.
- **Linux:** a crafted `wsl` terminal profile could run any program.
- **Terminal:** the `cd` the terminal sends to follow the current folder is quoted for each shell, so a folder name can't run commands. It's only typed at an empty prompt, and Terminal → Follow Folder turns it off.
- **Archives:**
  - a file name starting with `-` can't be read as a `tar` option;
  - a link inside a zip, tar or 7z archive can't point outside the folder it's extracted to (such links are skipped and listed);
  - extracted files lose setuid and setgid bits;
  - on Windows, files extracted from a downloaded archive keep its "downloaded from the internet" mark.
- **Permissions in the Inspector:** the permission grid showed a made-up `rwxr----- 0740` for every file, and one click ran chmod from that value (owner-exec on a private key made it group-readable). It now shows the file's real mode, including setuid, setgid and sticky, and changes it only after you edit, apply and confirm the old and new modes. On Windows it shows read-only.
- **Scripts:** a script that times out is stopped together with every program it started.
- **Security updates:** the zip library (2.4 → 9.5) and Tauri (2.10 → 2.12), plus zstd, quick-xml, crossbeam-epoch, libz-sys and serde_with, are updated past their published advisories, among them a critical one where a crafted zip looks different to different readers. Building from source now needs Rust 1.90.
- **No requests to Google:** the font picker's fonts are bundled, so the app makes no Google Fonts request at startup.

### New

- **Undo covers more:** Find & Replace in Files (as one step, and only if no file was edited since), Bulk Rename, New from Template, Paste as Symlink / Hard Link / Shortcut, Paste Special, Compress, Extract, Export Layout, Screenshot Auto-sort, Batch Permissions and the Inspector's permission changes can be undone with Ctrl+Z and redone with Ctrl+Y. Actions that can't be undone (Delete Permanently, Shred, git commands, Change Owner, scripts) clear the undo history, and Ctrl+Z then says so instead of undoing something from before them.
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
- **Delete Permanently** deletes folders that aren't empty (it used to fail on them), and its confirmation says the contents go too. Delete Permanently and Move to Trash carry on past an item that fails, then list what couldn't be removed.
- **Copies keep modification times** on Linux, and folders keep their permissions.
- **Screenshot Auto-sort:** Cancel stops the whole sort instead of skipping to the next month.
- **Export Layout** asks before replacing an existing `.glasshouserc`.
- **Find & Replace in Files** matches case exactly, in the counts and in the replace (the search used to ignore case while the replace didn't). It lists each file with its match count before replacing, and its report covers skipped files, a cancel and the 500-file cap. A replace too large to undo (over 8 MiB of text) says so before it starts.
- **Every shortcut shown in a menu now works,** including the Ctrl+G git chords and Ctrl+Shift+C (Copy Path).
- **Copy as Command** on Windows gives PowerShell syntax.
- **Moving a folder onto an existing empty folder** fails. On Linux it used to replace the empty folder.
- **Other fixes:**
  - the file list shows an error for a folder it can't read, instead of an empty list;
  - named pipes, sockets and devices no longer freeze the app when previewed, hashed, copied or compressed; they're refused, or left out of a zip with a note;
  - settings are flushed to disk before they replace the old file, so a crash while saving can't empty them;
  - a cancelled Extract to Folder no longer leaves an empty folder;
  - read-only folders from a tar archive can be extracted;
  - with two tabs open on the same folder, leaving one no longer stops the other from updating when files change;
  - on Windows, opening a folder with tens of thousands of files, or one on a network share, no longer freezes the window while it starts watching for changes;
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
