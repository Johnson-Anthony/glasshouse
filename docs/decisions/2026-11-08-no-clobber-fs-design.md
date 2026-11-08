# No-clobber create and rename in the backend

Date: 2026-11-08 · Task: `no-clobber-fs` · Picked by the task session (the lead said to choose and record), on the plan in `docs/plans/completed/no-clobber-fs.md`.

## Modes on the existing commands, with the safe one as the default
- `write_text(path, content, overwrite?)`: leaving `overwrite` out is `File::create_new`; `overwrite: true` is `fs::write`.
- `make_dir(path, all?)`: leaving `all` out is `create_dir`; `all: true` is `create_dir_all`.
- `rename_entry` has one mode, never replace.
- api.ts: `createTextFile` / `writeText` (overwrite), and `makeDir` / `ensureDir`.

Rejected: new commands (`create_text`, `save_text`, …). command-security is building an allowlist of commands, so a new one would have to be added there too or it would stop working after both branches merge. A parameter keeps the command set unchanged and touches one signature line per command.

Why the default is the no-clobber mode: a caller that doesn't say what it wants gets a visible "already exists" error, not silent data loss. That covers an older frontend, a raw `invoke`, or another branch's new call site. `writeText` keeps its name and becomes the explicit overwrite, so existing save callers didn't change. Its doc says new files use `createTextFile`.

## Rename: renameat2 / MoveFileExW, with a fallback
- Linux: `renameat2(RENAME_NOREPLACE)` through `libc::syscall(SYS_renameat2, …)`. The `libc` wrapper exists only for glibc 2.28+, and the raw syscall works with any libc. `libc` was already in the lock file.
- Windows: `MoveFileExW(from, to, 0)`, so there's no `MOVEFILE_REPLACE_EXISTING` and no `MOVEFILE_COPY_ALLOWED`. That's the same no-cross-volume behavior `fs::rename` had.
- Fallback: `EINVAL` (a file system without the flag: NFS, older FUSE, some network mounts), `ENOSYS` (kernel < 3.15), and non-Linux unix check with `symlink_metadata` and then `fs::rename`. Only these keep a race, and it's the same one the frontend check already had.

Rejected for the fallback: `link()` + `unlink()`, which is atomic for files. It doesn't work for folders or on file systems without hard links (vfat), which are exactly where the fallback runs.

## Case-only renames
On a case-insensitive file system (NTFS, SMB, vfat, ext4 casefold), `Foo` → `foo` finds `foo` "taken", because it's the same entry. When the primitive or the fallback says "taken", the rename still goes through `fs::rename` if all of these hold:
- the parent is the same;
- the names differ only in case;
- both paths are the same entry by identity (dev + inode on unix; volume serial + file index on Windows, opened without following links).

So two different entries in a case-sensitive folder (`Bar` and `bar` on ext4, or a per-folder case-sensitive directory on Windows) never count as the same. A test renames `Readme.md` → `README.md` on every platform. On Windows CI (NTFS) it covers whichever path `MoveFileExW` takes for a case-only rename; on Linux the name is simply free.

## Inline errors: the prompt runs the write
`PromptOptions.submit` runs the create or rename while the name prompt is still open. A refusal shows on the prompt's error line, the same place `validate` puts "already exists here", and the user can pick another name. `unlessTaken` maps the backend's `"x" already exists in <folder>` to `nameProblem`'s own `"x" already exists here`, so a name taken at the last moment reads the same as one taken all along.

Other errors from `submit` (permission denied, a missing folder) also show inline, instead of in an error alert after the prompt closed. Cancelling is blocked while `submit` runs, so a write can't finish after the prompt has resolved as cancelled, which would leave no undo entry.

The `assertFree` re-listing just before each prompt site's write is gone: the backend refusal replaces it, and `validate` still checks the name itself (separators, `.`, `..`). Paste Text into Filename has no prompt, so it keeps `assertFree`, which also rejects a pasted `/`. It shows the backend's refusal in the same "can't rename" alert.

Rejected: re-opening the prompt after a failed write, with the error preset. That's more code at each of the eight prompt sites, and the prompt flickers.
