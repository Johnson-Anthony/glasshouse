# git-safety

Branch: `claude/cool-gauss-d234ca` (worktree `cool-gauss-d234ca`), started 2026-11-11 from `main` (`3aec1a4`).
Backlog entry: section 2 of `docs/plans/active/survey-2.md`.

## Problems
1. **Discard deletes for good.** `git_discard` (`commands/git.rs`) `remove_dir_all`s any selected path that has no index entry and isn't in HEAD. For a folder, "no index entry" is always true, because the index lists files. So Discard on an ignored folder (`node_modules`, `target`) or on a folder of staged, never-committed files deletes it permanently. Git → Discard Changes sends the selection unfiltered, so a clean ignored file goes too.
2. **Checkout… can discard work.** The prompt sends `git checkout <typed>`. Typing a folder name (`docs`, `.`) restores those paths from the index.
3. **Staging an untracked folder always fails**, because libgit2's `add_path` takes files only.
4. **No read cap.** `git_blame` and `diff_files` (`commands/file_info.rs`) read whole files.

## Approach
**Discard (`git.rs`).** The rule: Discard makes the selection match HEAD, but never destroys what git can't give back.
- The backend classifies every file under each selected path with one libgit2 status scan:
  - **Restore from HEAD:** files in HEAD with a change (modified, deleted, type change, conflict), via `checkout_head` with exact paths. This is what it did before for tracked files.
  - **Move to the trash:** work-tree-only items (`WT_NEW` with no index flags). An untracked folder goes whole, as libgit2 reports it (`dir/`), but only when nothing under it is in the index. Inside a selected tracked folder, untracked items go to the trash too.
  - **Leave alone and report:**
    - staged, never-committed files (`INDEX_NEW`): unstage them first;
    - ignored paths;
    - a nested git repository;
    - paths with no changes.
- It returns `{ restored, trashed, skipped: [{path, reason}] }` instead of `()`.
- The trash call is passed in, so tests don't touch the real trash.
- A trash failure becomes a skipped entry, so the rest still happens and the report says why.

**Stage (`git.rs`).**
- A folder goes through `index.add_all` (which skips ignored files), plus `remove_path` for tracked files under it that are gone from disk. That matches `git add <dir>`.
- Folder names with glob characters must still match only that folder (done with escaped pathspecs; see Results).
- Existence checks use `symlink_metadata`, so a symlink to a folder is staged as a link and a dangling link isn't read as deleted.
- Unstage gets a test for folders and is fixed if it fails.

**Shared frontend filter.**
- New pure module `src/gitTargets.ts`: `gitTargets(action, paths, entries)`. It looks entries up by path, not by selection index, so it doesn't depend on how selection-integrity (task 3) stores the selection.
  - Files: no git label means clean or ignored, so they're dropped. Unstage also drops `?`.
  - Folders: kept, since a folder's label doesn't say what's inside, and the backend checks. Unstage drops `?` folders.
- `handlers/git.ts` (menu) and `handlers/fileOps.ts` (context menu) both call one shared runner, `runGitAction`, in a new `handlers/gitActions.ts`. It filters, confirms Discard with what will happen (restore, trash), calls the backend and reports the result.

**Checkout.**
- Every branch switch sends `git checkout <name> --`: Checkout…, the Branches submenu and the palette's Checkout Branch →. Checked with git 2.47 here:
  - a folder name fails with "invalid reference";
  - branches, `-`, tags and the remote-tracking guess still work.
- `GIT_RUN_ALLOWED`:
  - `--` is allowed for `checkout`;
  - `check_git_args` accepts `--` only as the last argument, so no path can follow it, for any subcommand;
  - `checkout` with a branch argument must end with `--`.

**Read caps.** A shared `read_capped(path, cap)` in `file_info.rs` refuses files over 16 MiB from the metadata, and reads at most the cap plus one byte in case the file grows. `git_blame` checks the size before running the blame itself.

**Site demo.** The `git_discard` mock returns the new result shape.

## Tests
- Rust, `git.rs`:
  - discard: a modified file is restored; untracked file and folder are trashed (fake trash); ignored folder and file, a staged-new file, a folder of staged-new files, and a nested repo are untouched and reported; a tracked folder restores its changes and trashes its untracked file but keeps its staged-new one;
  - stage: an untracked folder (ignored files inside stay out), a deleted file inside a folder, a folder named `a[b]`, a symlink to a folder;
  - unstage of a folder;
  - `check_git_args`: `checkout x --` and `checkout -b x` pass; `checkout docs`, `checkout -- docs` and `--` before other arguments fail;
  - real git: `checkout docs --` on a modified `docs/` leaves the edit and fails;
  - blame and diff refuse a sparse 17 MiB file.
- vitest:
  - `gitTargets` per action;
  - routing: Discard sends only filtered paths and reports skips;
  - Checkout… sends `--`.

## Status
**Done** (2026-11-11).
- [x] Plan
- [x] Discard: classify, trash, report (`discard_paths`, `DiscardResult`)
- [x] Stage folders (`stage_folder`); unstage of a folder without a commit
- [x] Checkout `--` and `GIT_RUN_ALLOWED`
- [x] Read caps (`read_capped`, 16 MiB)
- [x] Frontend: `gitTargets`, `runGitAction`, api types, demo mock
- [x] Checks: build, test (282), check:wiring (0 issues), clippy `-D warnings`, cargo test (148 passed, 1 ignored), site:build, site:capture check (18/18)
- [x] Decision record `docs/decisions/2026-11-11-git-safety-design.md`; ARCHITECTURE's git convention points at it
- [x] Handoff

## Results
- **Changed from the plan:**
  - pathspecs: unusual names are escaped (`exact_pathspecs`), because libgit2 reads every path as a pattern. Without the escaping, restoring `a[1].txt` also restored `a1.txt` (negative check);
  - `stage_folder` uses those pathspecs instead of an add_all callback, because git2 0.19's callback trampoline segfaults when the pathspec is empty;
  - symlinks: selected paths resolve their folders but not the last part, so a link is acted on as the link. Before, Discard followed it: an untracked link to `src/` restored `src/`, and a link to an untracked folder deleted the folder.
- **Tests:**
  - Rust (`commands/git.rs`): `discard_restores_tracked_files_and_trashes_untracked_ones`, `discard_leaves_ignored_staged_and_nested_repos_alone`, `a_failed_trash_is_reported_and_the_rest_goes_on`, `discard_and_unstage_take_odd_names_literally`, `discard_of_a_link_acts_on_the_link_not_its_target`, `stage_takes_folders_like_git_add`, `stage_adds_a_link_to_a_folder_as_the_link`, `unstage_takes_folders`, `menu_checkout_never_restores_a_folder` (real git), `blame_refuses_a_file_over_the_read_cap`, and new cases in the two `git_args` tests;
  - `commands/file_info.rs`: `diff_files_refuses_a_file_over_the_read_cap`;
  - vitest: `src/gitTargets.test.ts`, plus routing tests for Stage, Unstage, Discard and every branch switch.
- **Flaky, not this branch:** in the first full `cargo test` run, `launch::tests::run_capped_kills_the_whole_tree_at_the_timeout` failed once ("background child outlived the timeout"), with the machine's load average at about 7. It passed alone and in three more full runs.
- **Not compiled:** nothing Windows-specific changed. The trash call is the `trash` crate's, as in Move to Trash.
- **Not checked visually:** the browser pane refused to open the local demo. The confirm and report text are covered by the routing tests.

## For review
- **Discard semantics:** staged-but-never-committed files are left alone (unstage first), and untracked items inside a selected tracked folder go to the trash along with it. The confirm says both.
- **The report:** an alert when anything was left alone (up to five paths with reasons), otherwise a toast. Selecting only clean files now shows "nothing to stage in the selection", where it used to do nothing silently.
- `check_git_args` now refuses `checkout <branch>` without a trailing `--`, and refuses `--` anywhere but last for every subcommand. Task 20 (git-ux) builds the branch picker on top of this.
