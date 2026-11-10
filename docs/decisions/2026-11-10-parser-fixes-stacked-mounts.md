# Stacked mounts: the deepest mount point first, then the last line

**Decision (parser-fixes, 2026-11-10):** `fs_type_for` still picks the deepest mount point that holds the path. Only among mounts on that same point does the later line in `/proc/self/mounts` win.

## Rejected
- **The last matching line wins outright.** Simpler, and it would also handle a mount on a parent that hides an earlier mount below it. But on this machine `/sys`, `/proc`, `/dev` and `/run` are listed *before* `/`, because they were moved into the new root at boot. The last matching line for `/proc/self` would be `/`, so it would report ext4. A test (`fs_type_prefers_the_deepest_mount_even_when_it_is_listed_first`) keeps that from coming back.
- **Reading `/proc/self/mountinfo` and walking parent IDs.** That is exact, and handles a parent over-mount too, but it's a rewrite for a status-bar label. Worth it only if a wrong fs label is ever reported in practice.

## Evidence
On this machine, `/proc/sys/fs/binfmt_misc` is listed twice: autofs on line 13, then binfmt_misc on line 23. The old code reported autofs.
