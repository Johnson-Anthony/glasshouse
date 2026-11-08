# copy-undo-guard: fingerprint copies by size + mtime, refuse the whole step

Date: 2026-11-08. Task: `copy-undo-guard`. Status: for review by the lead.

## What's recorded
**Chosen:** right after a copy is made, and again after every redo, `copyUndo` records each copy's fingerprint:
- for a file or symlink: `kind:size:mtime` (symlinks aren't followed);
- for a folder: the same for every entry under it, keyed by relative path, read with `readDir` (hidden entries included).

Undo takes the fingerprints again and compares them before deleting anything.
- Folders' own mtimes are left out. The listing already shows adds, removes and renames, and a folder's mtime also moves when an editor creates and deletes a swap file, which would refuse undos for no reason.
- `mtime` catches same-size edits; `size` covers file systems with coarse timestamps.

**Rejected: content hashes (`hash_sha256`).** That would read every copied byte again. Until `async-commands` lands, commands run synchronously on the main thread, so hashing a large paste would freeze the UI twice, once after the copy and again on undo. Every way of editing a file changes its size or mtime, editor atomic saves included; only a deliberate `touch -d` with an equal size gets past this.

## When the fingerprint is taken
**Chosen:** the entry starts fingerprinting when it's built, as a promise, and undo awaits it. `pushUndo` stays synchronous, so a Ctrl+Z straight after a paste still undoes the paste.

**Known gap:** an edit made while the walk is still running gets recorded as the baseline. For a normal paste the walk takes milliseconds. Only an edit inside a huge copied tree in the first second or so could slip through.

## What undo does when something changed
**Chosen: refuse the whole step.** If any copy changed, is gone, can't be read, or is too large to check, nothing is deleted. The alert lists up to five reasons, and the runner drops the entry as it does for any failed step.

**Rejected: skip the changed copies and delete the rest.** The undo would then be half done:
- redo would have to remember which copies it removed, or fail on the ones kept;
- the runner would need a "done, with notes" outcome to report what was kept.

Refusing matches `createUndo`, and the user can delete the unchanged copies by hand.

## Size cap
Trees with more than 20,000 entries (`FINGERPRINT_LIMIT`) aren't walked, and their undo refuses with "too large to check". The walk is one synchronous `list_dir` per folder. Raise the cap once listing is async.
