# Symlinks in shred, copy and move

Date: 2026-11-08 · Task: `symlink-safety` · Decided by the user, on the plan in `docs/plans/completed/symlink-safety.md`.

## Shredding a symlink: refuse
`shred` on a symlink returns an error naming the link's target and removes nothing. The target is never opened.

Rejected: unlink the link only. The confirm dialog says the file will be overwritten, and the frontend toasts "shredded" on success, so removing just the link would make it look as if the data had been destroyed when it hadn't.

## Copying links: always as links, and fail if the OS won't create one
`copy_entry` and `copy_dir_recursive` recreate every symlink as a link with the same target text, whether the user selected it directly or it sits inside a copied folder. On Windows without the symlink privilege (no Developer Mode, not admin), the copy fails with an error that names the link and says why.

Rejected: on Windows, fall back to copying a file link's target contents (Explorer's behavior). Then a copy could silently differ from its source, and that code path can't be run outside Windows CI.

Consequences:
- Windows junctions are recreated as directory symlinks, because std can't create junctions, so they need the same privilege.
- Following links is never an option: a link to an ancestor (common with junctions, e.g. `AppData\Local\Application Data`) would recurse forever.

## Not a choice, recorded for context
- Move falls back to copy + delete only on a cross-volume rename error (`EXDEV` 18 / `ERROR_NOT_SAME_DEVICE` 17), matched by raw code because `io::ErrorKind::CrossesDevices` is newer than the crate's `rust-version`. Once `dead-code` raises `rust-version` to 1.88, `is_cross_device` can use `ErrorKind::CrossesDevices`.
- A move onto an existing non-empty folder now fails instead of merging into it.
