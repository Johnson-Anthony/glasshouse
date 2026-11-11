# Extraction: staged, then moved in through the paste planner

Date: 2026-11-11 · Task: `archive-safety` (survey-2 §1) · Picked by the task session; the lead delegated the choice.

## Name conflicts: ask, as Paste does
`archive_extract` now extracts into a new staging folder inside the destination (`.glasshouse-extract-<pid>-<n>`) and writes nothing else. The frontend lists that folder and moves its top-level entries in with `runTransfer`, the same planner as Paste. A taken name gets Paste's one question (skip / replace / keep both, with Replace sending the old item to the trash), and moves never replace (`RENAME_NOREPLACE`). Then `archive_discard_staging` deletes the staging folder with whatever was skipped. It deletes only folders this process staged.

Rejected:
- **Automatic `name (2)`, decided in the backend** (as GNOME's file-roller does). This is simpler, but extraction would then behave differently from Paste, and from Explorer and 7-Zip, which both ask. It also couldn't offer Replace.
- **Listing the archive first and asking before extracting.** That needs a lister per format (zip, `tar -t`, `7z l`), each with its own parsing and failure modes, and the result could still differ from what extraction produces.

Consequences:
- The staging folder sits in the destination while extraction runs. It's hidden on unix by its leading dot, but visible on Windows. If the app dies mid-extract, the folder is left behind.
- Extract to Folder into an existing folder merges with the same question, instead of overwriting.
- A failed extraction removes the staging folder, and the destination too if the call created it and it's still empty. A half-extracted archive never reaches the user's folder.

## Zip extraction is our own loop
`ZipArchive::extract` creates archived symlinks with any target (absolute, `../..`), and on Windows it stops at the first link it can't create (error 1314). The new loop:
- creates links last, so nothing is ever written through one;
- keeps a link only if its target is relative and uses `..` only as leading components that don't climb above the extraction root, measured from the link's own folder. The link's own folders must be real folders, not other links. A `..` after a name (`a/../x`) is refused even when it looks harmless, because `a` could be an archived link to `.`;
- skips refused links, and links Windows won't create without the privilege, and reports them. The rest of the archive still extracts. (Copying a folder, by contrast, fails on such a link: `2026-11-08-symlink-safety-link-handling.md`. Extraction skips instead because one link in a downloaded archive shouldn't block the rest, and the user is told.)
- masks unix modes to `0o777`, dropping setuid, setgid and sticky, and keeps folders owner-writable (`| 0o700`). Linux needs write permission on a folder to move it to another parent, and the staged entries are moved.

tar and 7z extraction are unchanged apart from staging. They rely on the tools' own guards against writing through archived links: GNU tar delays links with absolute or `..` targets until the end, and bsdtar refuses to extract through links. The links' targets aren't checked, which is a possible follow-up.

## Mark-of-the-Web: copied by the app, not by `7z -snz`
On Windows, after any extraction, the archive's `Zone.Identifier` stream is copied onto every extracted regular file. This one path covers zip, tar and 7z. `-snz` would only cover 7z, and only with versions that accept it. It's best effort: an archive without the mark, a file system without streams, or a read-only file is skipped silently, as Explorer does.

## Zip creation leaves links out but says so
Links are still not stored. A selected link is now left out too, where before it was followed. `archive_create` returns `{ skipped: [{ path, reason }] }` for links and for entries that couldn't be listed or stat'ed, and the frontend shows them in a warning. Storing links as zip symlink entries was rejected: it would only work for unix readers, and those links would hit the same Windows privilege problem when extracted.
