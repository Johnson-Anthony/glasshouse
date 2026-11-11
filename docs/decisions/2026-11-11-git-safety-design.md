# git-safety: what Discard, Stage and Checkout may touch

Date: 2026-11-11. Task: `git-safety` (section 2 of `docs/plans/active/survey-2.md`).

## Discard
**Rule:** Discard makes the selection match HEAD, but never destroys what git can't give back. `discard_paths` in `commands/git.rs` sorts every file under each selected path, from one libgit2 status scan, into one of three groups.
- **Restored from HEAD:** files in HEAD with a change (modified, deleted, type change, conflict), via `checkout_head` with an exact path for each file. This is what Discard did before for tracked files, but it now covers exactly those files, not a folder prefix.
- **Moved to the trash:** work-tree-only items (`WT_NEW` and nothing else).
  - A selected folder goes whole, as one trash entry, when nothing under it is in HEAD or the index.
  - Inside a selected tracked folder, untracked items go to the trash as well. An untracked subfolder goes as one entry, the way libgit2 reports it (`sub/`).
- **Left alone and reported** (`skipped`, with a reason):
  - files staged but never committed (`INDEX_NEW`);
  - ignored paths, including an untracked folder that holds only ignored files;
  - a nested git repository;
  - paths with no changes;
  - anything else not in HEAD.

The command now returns `{restored, trashed, skipped}`. The frontend toasts the counts, or shows an alert listing up to five skipped paths with their reasons.

**Why trash, not delete:** untracked content exists nowhere else. The other paths that remove things already use the trash: Move to Trash, and Replace in paste.

**Why staged-new files are left alone:** the staged copy lives only in the index, as a blob that's lost once unstaged or reset. Making them match HEAD would mean deleting them. Unstaging first turns them into untracked files, which Discard then trashes. That's two steps, but each one can be undone.

**A failed trash** becomes a skipped entry ("couldn't move it to the trash: …"), so the restores and the other trashes still happen, and the report says which item stayed.

**Symlinks:** a selected path now has its folders resolved but not its last part (`resolve_folders`), so a symlink stands for itself, which is how git tracks it.
- Before, `canonicalize_soft` followed the link. Discard on an untracked link to `src/` restored `src/`'s files, and on a link to an untracked folder it `remove_dir_all`ed the target.
- Blame still follows the link, as it did before: it blames the file the link shows.

## Pathspecs
libgit2 reads every path passed to `checkout_head`, `reset_default` and `add_all` as a pattern. git2 0.19 doesn't expose checkout's `DISABLE_PATHSPEC_MATCH`.
- **The problem:** restoring `a[1].txt` also restored a modified `a1.txt`. A negative test (escaping turned off) confirmed this.
- **The fix:** `exact_pathspecs` passes a plain name through unchanged, so a plain folder name still matches what's under it. Any other name gets a backslash before each ASCII punctuation character, and a folder also gets `<escaped>/*`.
- The status scans keep the old approach: they narrow the scan only with a literal pathspec, and otherwise scan everything and filter by prefix.
- **A leading `#`:** a pathspec that starts with `#` is a comment to libgit2's parser. A probe showed it doesn't widen what checkout or reset touches, because both are also limited by the path's prefix. It's escaped anyway.

## Stage and Unstage
- **Stage of a folder:** `add_all` with the exact pathspecs (it skips ignored files), plus `remove_path` for tracked files under the folder that are gone from disk. That's what `git add <dir>` does.
  - The first version passed an empty pathspec and filtered in a callback. That segfaults in git2 0.19: its callback trampoline calls `CStr::from_ptr` on the null `matched_pathspec` that libgit2 passes when there's no pathspec.
- Existence checks use `symlink_metadata`, so a link to a folder is staged as a link.
- **Unstage of a folder** already worked with a HEAD. Without a commit yet, it now also removes the folder's entries (`remove_dir`).

## The frontend filter
`gitTargets` (`src/gitTargets.ts`) is shared by the Git menu (`handlers/git.ts`) and the context menu (`handlers/fileOps.ts`), through `runGitAction` in `handlers/helpers.ts`.
- **Files:** a file with no git label is clean or ignored, so it's dropped. Unstage also drops `?`.
- **Folders always stay:** a tracked folder with changes inside has no label, and the backend checks.
- It looks entries up by path, not by selection index, so it doesn't depend on how the selection is stored (selection-integrity is changing that).
- An empty result after filtering shows "nothing to stage in the selection".

## Checkout
- Every branch switch sends `git checkout <name> --`: Checkout…, the Branches submenu and the palette's Checkout Branch →.
- With git 2.47, `checkout docs --` fails with "invalid reference: docs" when no branch has that name. Branches, tags, `-` and the remote-tracking guess (`feature` → `origin/feature`) all still work.
- **`GIT_RUN_ALLOWED`:** `checkout` takes `--`, and `check_git_args` accepts `--` only as the last argument, for any subcommand. A `checkout` with a branch argument must end with `--`, so a future caller can't bring the path form back.

**Rejected: `git switch`.** It refuses tags and commits without `--detach`, which would change what Checkout… accepts. `checkout <name> --` only removes the path form.

## Read caps
`read_capped` (`commands/file_info.rs`) refuses a file over 16 MiB, judged from its metadata, and reads at most one byte past the cap in case the file grows meanwhile. `diff_files` and `git_blame` use it, and blame now reads and checks the file before running the blame itself.

## Not covered
- **Case-insensitive repos:** the prefix filter in `statuses_under` compares case-sensitively, but paths come from the listing in on-disk case.
- **Windows:** the trash goes through the `trash` crate's recycle-bin call, untested here. On a network share it may delete permanently (survey-2 task 12 checks that).
- **Submodules:** excluded from the discard scan, so Discard on one reports "no changes".
