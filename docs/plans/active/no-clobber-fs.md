# no-clobber-fs

Branch: `claude/bold-haibt-91d29a` (worktree `bold-haibt-91d29a`, the backend-bugs session). Backlog entry: `## no-clobber-fs` in `survey-fixes.md`. Assigned by the lead on 2026-11-08, starting from `main` at `eaa5e44`.

## Scope
The frontend checks a name (create-rename-conflicts) and then writes, and a few milliseconds pass in between. This task makes the backend refuse an existing target atomically, so nothing that appears in that gap gets emptied, replaced or reused:
- `write_text`: `File::create_new` for new files, plus a separate overwrite mode for real saves.
- `make_dir`: `create_dir` for New Folder.
- `rename_entry`: never replaces.
  - Linux: `renameat2(RENAME_NOREPLACE)`.
  - Windows: `MoveFileExW` without `MOVEFILE_REPLACE_EXISTING`.
  - Fallback (non-Linux unix, `EINVAL`/`ENOSYS`): check, then rename.
- The frontend shows the backend's "already exists" inline in the name prompt, as the create-rename-conflicts checks do.

## Callers (every one checked)
| Caller | Command | Mode |
|---|---|---|
| `App.tsx` New Folder / Folder | `make_dir` | create (refuse existing) |
| `App.tsx` New File / Text File, Markdown Note, Script (.sh) | `write_text` | create |
| `handlers/misc.ts` From Template… (`promptAndCreate` → `createFileAt`) | `write_text` | create |
| `handlers/misc.ts` Python Module | `make_dir` + `write_text` `__init__.py` | create, create |
| `undoActions.ts` `realFs.mkdir` / `realFs.write` (only used by a create's redo) | `make_dir` / `write_text` | create |
| `App.tsx` `persistRemotes` (`~/.glasshouse` + `remotes.json`) | `make_dir` / `write_text` | ensure dir (exists is fine) / overwrite |
| `handlers/tools.ts` Screenshot Auto-sort month folders | `make_dir` | ensure dir: an existing month folder is the normal case |
| `handlers/tools.ts` Find & Replace in Files | `write_text` | overwrite (editing files in place) |
| `handlers/misc.ts` Export Layout (.glasshouserc) | `write_text` | overwrite (re-export replaces its own file, as intended) |
| `App.tsx` Rename (selection, context target); `misc.ts` Paste Text into Filename; `undoActions` `moveUndo` via rename; BulkRenameDialog `renameOne` | `rename_entry` | never replace (the only mode) |

`components.tsx` imports `writeText` but only uses `navigator.clipboard.writeText`, so it needs no change. Its import line is left alone.

## Approach
1. **Commands keep their names, and the safe behavior is the default.**
   - `write_text(path, content, overwrite: Option<bool>)`: `overwrite: true` is `fs::write`. Leaving it out is `File::create_new`. If the write fails after the create, the half-written new file is removed.
   - `make_dir(path, all: Option<bool>)`: `all: true` is `create_dir_all`. Leaving it out is `create_dir`.
   - `rename_entry`: body only.

   No new commands, because command-security is building a command allowlist. The two signature lines gain a parameter, which is the only signature edit. Any caller that doesn't say which mode it wants (an older frontend, another branch) gets the no-clobber behavior.
2. **One error format for a taken target:** `"<name>" already exists in <folder>`, the same wording undo's `ensureFree` uses. `api.ts` `isAlreadyExists(err)` recognizes it.
3. **`rename_no_replace`:**
   - Platform primitive: Linux `renameat2` through `libc::syscall` (works with any libc; `libc` is already in the lock file, so nothing new to build). Windows `MoveFileExW(…, 0)`. Elsewhere it reports unsupported.
   - Unsupported (`EINVAL` from a file system without the flag, `ENOSYS` from a kernel older than 3.15, other unix): check with `symlink_metadata`, then `fs::rename`. Only these paths keep the small race.
   - **Case-only renames** (`Foo` → `foo`) on case-insensitive file systems (NTFS, SMB, vfat, ext4 casefold): the target "exists" because it *is* the source. When the primitive says "exists", the parent is the same, the names differ only in case, and both paths are the same entry by identity, fall back to `fs::rename`. Identity uses dev + inode on unix, and volume serial + file index on Windows, opened without following links. So two different entries in a case-sensitive folder never count as the same.
4. **api.ts:**
   - `createTextFile` (create) next to `writeText` (now explicitly an overwrite);
   - `makeDir` (create) next to `ensureDir` (`all: true`);
   - `isAlreadyExists`.
5. **Inline error:**
   - `PromptOptions.submit?: (value) => Promise<string | null>` runs the write while the prompt is still open. A returned string keeps it open with that error. A throw closes it and rejects `showPrompt`, so the caller's existing error alert still runs.
   - The prompt can't be submitted twice or cancelled while `submit` runs.
   - `transferUi.ts` `unlessTaken(name, op)` maps the backend's "already exists" to `nameProblem`'s own message (`"x" already exists here`).
   - The prompt sites move their write into `submit`. Their `assertFree` re-listing just before the write goes away, since the backend check replaces it.
   - Paste Text into Filename has no prompt. It shows its existing "can't rename" alert for the backend's refusal too.
6. **Comments:** the stale "the backend overwrites" headers in `names.ts` and `undoActions.ts` get corrected.

## Tests
- Rust (temp dirs):
  - `write_text` create refuses an existing file and leaves its content; overwrite replaces it.
  - `make_dir` refuses an existing folder; `all` accepts it.
  - `rename_entry` refuses an existing file and an existing folder with both intact, still renames to a free name, and allows a case-only rename. That last one exercises `MoveFileExW` on Windows CI, which is case-insensitive.
  - Error text matches what `isAlreadyExists` expects.
- vitest: `isAlreadyExists`, `unlessTaken`.

## Status
- 2026-11-08: plan written; implementing (no OK needed, per the lead).
