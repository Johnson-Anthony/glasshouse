# inspector-perms: a permission grid that shows the file and asks first

Date: 2026-11-12. Task: `inspector-perms` (section 6 of `docs/plans/active/survey-2.md`).

## Chosen
- **The real mode comes from the backend.**
  - `file_stat_extended` returns `mode`: `st_mode & 0o7777`, unix only.
  - A symlink reports its target's mode, because `set_permissions` (std's chmod) follows the link. A dangling link reports `None`, shown as "—".
  - On Windows `mode` is always `None`, and the Inspector shows only the read-only attribute.
- **Edit is a draft with one confirm.**
  - "edit" copies the current mode into a draft. Clicks flip one bit of the draft.
  - "apply" shows the old and new mode (rwx and octal) in a confirm, then runs chmod once. "cancel" drops the draft.
  - While a draft differs, the line reads "rwxr--r-- 0744 · now 0644".
- **Toggles keep the special bits.** A toggle XORs one bit of the real mode, so setuid, setgid and sticky survive, and the grid shows them `ls`-style (`s`/`S`, `t`/`T`). Before, every click wrote a 0o777-only mode built from the made-up starting grid, which also dropped setgid on shared folders.
- **Read back after every change.** After apply, or after a failure (shown in an alert, not just logged), the Inspector stats the file again. The grid then shows what's on disk, which may differ from the request, for example on a filesystem that ignores chmod.
- **No state carries over to another file.** The grid is keyed by the inspected path. The stat result and the checksums each remember their path and show only while it's the one inspected.
- **Hash results:** `checksumsFor` (`src/preview/checksums.ts`) drops the digests if the Inspector has moved to another file by the time they arrive. The "…" state follows the path being hashed, so another file's hash finishing doesn't clear it.
- **Windows:** "make read-only" / "make writable", confirmed, through `set_permissions` with the owner-write bit, which is all that command reads on Windows.
- **The backend** refuses a mode above `0o7777`.

## Rejected
- **One confirm per click.** Going from 0644 to 0755 would take three dialogs, and each would chmod an intermediate mode.
- **Cancelling a running hash when the user moves on.** The tray already shows it with its own Cancel, and the user may come back. The result is just not shown on the wrong file.
- **Hiding the grid for symlinks.** chmod on a link changes its target, which is a common thing to want. The confirm names it: "the file the link X points to".

## Not covered
- **Windows:** read-only on a symlink reads the link's own attribute. `set_permissions` changes whatever std's `set_permissions` touches there. Untested; nothing Windows-specific changed in this task.
- **Ownership** (`change_owner`) and ACLs are out of scope.
