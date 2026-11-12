# Find & Replace in Files: what it changes, how it writes, and its undo

Date: 2026-11-12 · Task: `find-replace-safety` (survey-2 §7) · Picked by the task session; the lead delegated the choices.

## The work moved to the backend
The handler used to run Find in Files (case-insensitive, 500 matches), then read each file with `read_text` (lossy UTF-8) and split and join a case-sensitive needle. It wrote the result back with a truncating `std::fs::write`. Latin-1 or cp1252 bytes came back as U+FFFD, the count it showed wasn't what it replaced, and a crash mid-write could leave a file half written.

Now `commands/replace.rs` does the reading, matching and writing on bytes. The frontend doesn't move file text over IPC except what undo keeps. It has three commands:
- `replace_preview` (files-read) lists the files with matches and their match counts. It also lists the files with a match it won't change, and why.
- `replace_apply` (files-write) changes only the files the preview listed. It re-reads each one, because it may have changed since the preview.
- `rewrite_text` (files-write) replaces an existing file's text the same way. Undo and redo use it.

## One case rule: exact case
The preview's counts and the replace use one matcher. It's built from the escaped literal with the same `case_insensitive` flag twice: `grep_regex` to spot candidate files, and `regex::bytes` to count and replace. The handler asks for exact case, and the first prompt says so ("text to find (case-sensitive)").
- **Why exact:** a case-insensitive replace writes one spelling over `Foo`, `foo` and `FOO` alike, which is rarely what a literal replace means. The preview lists each file's count, so the user can see what will change.
- **Rejected:** a match-case toggle. It would need a new dialog kind, and the backend already takes the flag if one is added later.

## What's left alone
A file with a match isn't changed, and is listed with its reason, if it is:
- not valid UTF-8 (`not UTF-8 text`); UTF-16 with a BOM (`UTF-16 text, not UTF-8`), which grep's BOM sniffing finds; or binary, with a NUL byte;
- over 16 MiB. It's read whole, and its replaced copy is built next to it;
- `read-only`, or can't be opened for writing (`can't be written (…)`, such as a file another program has locked on Windows);
- on unix, a file with other hard links. The rename would leave the other names on the old text. Windows doesn't expose the link count without more API, so there a hard-linked file is split silently.

Files Find in Files wouldn't search aren't listed either: hidden and gitignored files, links, unreadable files, and binaries whose NUL comes before any match. The walk doesn't follow links.

**Why skip rather than convert:** decoding another encoding means guessing it. Writing back the decoded text in that encoding still risks changing bytes around the matches. Byte-for-byte safety was the point.

## The cap counts files, not matches
The preview stops after 500 files with matches, changed or skipped. `capped` is set only once a 501st has been found, so a run of exactly 500 isn't reported as capped. The walk is sequential, in name order, so a capped preview lists the same files each time. The confirm and the final report both say that files past the cap weren't searched or changed. Each file is replaced whole, so the old 500-match cut, which could stop part way through a file's matches, is gone.

## How a file is written
`write_replacing`:
1. creates `.glasshouse-replace-<pid>-<n>` in the file's own folder, so the rename stays on one volume (`create_new`; mode 0600 on unix until the real mode is set);
2. writes the new text;
3. on unix, gives it the old owner and group if they differ. If that fails (someone else's file, writable through its group), the file isn't changed: it would otherwise change hands;
4. sets the old permissions (after the chown, which clears setuid and setgid);
5. fsyncs the temp file;
6. checks that the old file is still the one read: same size, modification time and (unix) inode;
7. renames the temp file over the old one, then fsyncs the folder on unix.

On any failure before the rename, the temp file is removed and the old file is untouched.

**Windows uses `ReplaceFileW`** instead of the rename. It moves the old file's attributes, ACLs and alternate streams onto the new one, so a replace doesn't unhide a hidden file or drop a download's Mark-of-the-Web. Merge errors are ignored (`REPLACEFILE_IGNORE_MERGE_ERRORS`), as on a share that won't take the ACLs. With no backup name, `ERROR_UNABLE_TO_MOVE_REPLACEMENT` means the old file is already gone. Then the temp file is renamed into place, and if that fails too, the error names the temp file holding the new text instead of deleting it.

**Links and the root:** `replace_apply` resolves each path's folder and refuses one that isn't inside the canonical search root. It opens the file itself with `O_NOFOLLOW` after an `lstat` check, so neither a link in the folder part nor a link as the file leads anywhere else. FIFOs, sockets and devices are refused before any open, as `open_regular` does, and the open uses `O_NONBLOCK` in case one is swapped in.

Lost, as with any temp-file-and-rename editor: extended attributes and POSIX ACLs on Linux, and the file's inode (a process holding the old file open keeps reading the old text).

## Undo: one step that checks every file first
- **`replace_apply` returns each file's old and new text** while their total stays under 8 MiB. The preview works out whether the planned files fit (`undoable`). The confirm says up front when they don't, and the replace is then `markIrreversible`. The same happens if a file grew between the preview and the replace so the text no longer fits.
- **`contentsUndo(label, changes)`, not `groupUndo` of `contentUndo`s.** `groupUndo` stops at the first part that fails, and the undo stack then drops the entry. So one file edited since the replace would leave the step half undone, with no way to finish. `contentsUndo` reads every file first and writes nothing unless all of them still hold what the other direction left. If a write still fails part way, it puts back the files it had already written. `contentUndo` shares its read-and-compare, and its messages are unchanged.
- **Undo and redo write through `rewrite_text`**, so they're atomic and keep permissions like the replace itself. The compare reads with `read_text`. That's exact for these files, which were valid UTF-8 when the replace wrote them. Something written since that isn't UTF-8 reads differently and refuses.
- **Accepted:** the gap between the compare and the write, two IPC calls long. An edit landing in it is overwritten. Closing it would mean a compare-and-swap command, more than this needed.
- A cancelled replace keeps the files it finished, and undo covers those.
