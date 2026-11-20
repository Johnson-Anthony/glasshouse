# git-ux

Branch: `claude/busy-mclean-ba5038` (worktree `busy-mclean-ba5038`), started 2026-11-18 from `main` (`3e83a35`).
Backlog entry: section 20 of `docs/plans/active/survey-2.md`. Builds on git-safety (task 2): every branch switch sends `checkout <name> --`.

## Problems
1. **Commit Amend** says "(leave empty to reuse)", but an empty message does nothing.
2. **Checkout…, Merge… and Rebase onto…** ask for a typed branch name, though `git_branch_list` exists. The palette's Checkout Branch → numbers the branches in a prompt.
3. **Pull, Push and Fetch All** show nothing while they run, can't be cancelled and have no timeout. A remote that wants a password or passphrase can hang them for good: git or ssh waits on a terminal the app doesn't have.
4. **Commit…** is a one-line prompt that doesn't show what's staged.

## Approach

### Backend (`commands/git.rs`)
- **`GIT_RUN_ALLOWED`:**
  - `commit` also takes `--no-edit`. A new rule: a commit needs a message, so it takes either `-m <msg>`, or `--amend --no-edit`. A bare `commit` or `commit --amend` would open an editor, and `--no-edit` without `--amend` is refused.
  - `pull`, `push` and `fetch` take `--progress`.
  - Nothing else changes.
- **`git_run(cwd, args, op_id)`** runs git through a new runner, `run_git`, instead of `output()`:
  - stdin is closed, and `GIT_TERMINAL_PROMPT=0` is set, so a credential git can't get from a helper fails at once ("terminal prompts disabled").
  - On unix, git starts in a new session (`setsid`), so it and its ssh have no controlling terminal and can't prompt on the one `pnpm tauri:dev` ran in. ssh then fails ("Permission denied", "Host key verification failed"), or uses a GUI `SSH_ASKPASS` if one is set up. The session's group is also what a kill reaches (git, ssh, `git-remote-https`, hooks). This is a new `proc_tree::spawn_detached`. On Windows it's the same job object as `spawn`, with `CREATE_NO_WINDOW`.
  - **Cancel:** `op_id` registers an `Op`. Cancel kills the tree and the call fails with `"cancelled"`.
  - **Timeout:** pull, push and fetch are stopped after **120 s without any output**. That's an idle timeout, not a total one, so a long fetch that's still sending progress keeps going. Other subcommands have none, because a commit hook may run quietly for a long time; they can still be cancelled. The error names the cause: network, or a prompt the app can't show.
  - **Progress:** a stderr reader splits on `\r` and `\n`. Each line becomes the op's `detail`. A line like `Receiving objects:  45% (450/1000)` also sets done/total.
  - The output `git_run` returns keeps only each line's last `\r` segment, as a terminal shows it, with ANSI escapes removed.
  - After git exits, the readers get a 2 s drain grace, as `run_capped` has, for a background process that holds the pipes open.
- **`ops.rs`:** `OpProgress` gets `detail: Option<String>`, and `Op` gets `set_step(detail, Option<(done, total)>)`. Hash, copy and find send `detail: null`, as before.
- **`git_branch_list(cwd, remotes)`:** with `remotes: true`, remote-tracking branches come too (`refs/remotes/`, symrefs like `origin/HEAD` skipped), with `remote: true`. The Branches submenu doesn't pass it, and is unchanged.
- **New `git_commit_info(cwd)`** (libgit2, `git` permission group): the branch, the staged files (index vs HEAD with renames: code, path, old path; at most 500, plus the total), how many changes aren't staged, and HEAD's message (none on an unborn branch).

### Frontend
- **`src/gitUx.ts`** (pure, tested):
  - `branchChoices(branches, action)`:
    - checkout: local branches but the current one, plus remote branches that have no local branch of the same name. Picking `origin/feature` sends `checkout feature --`, which git turns into a tracking branch.
    - merge and rebase: local branches but the current one, plus every remote branch.
  - `filterChoices(choices, query)` uses `fuzzy.ts`.
  - `commitArgs(message, amend, headMessage)`:
    - `commit -m <msg>`;
    - amend with an empty or unchanged message: `commit --amend --no-edit`;
    - amend otherwise: `commit --amend -m <msg>`.
  - `remoteFailureHint(stderr)`: one plain sentence for credential and ssh failures.
- **`src/dialogs/GitDialogs.tsx`**: `GitDialogHost`, mounted once in App.tsx next to DialogHost, and a `gitDialogs` API like `dialogs`:
  - `pickBranch({ cwd, action })`:
    - a filter field over a list (↑/↓, Enter, click, Esc);
    - when nothing matches, Enter uses the typed text, so tags, `-` and SHAs still work;
    - it resolves with the name to send.
  - `commit({ cwd, amend })`:
    - the branch, the staged files (a scrolling list with codes), and a note when nothing is staged (Commit is disabled then; Amend still works) or when changes aren't staged;
    - a multi-line message, prefilled with HEAD's message for amend;
    - Ctrl+Enter commits, Esc cancels;
    - it resolves with the args to run.
- **`handlers/git.ts`:**
  - `runAndShow` runs every `git_run` as a tray op labelled with its title (unit `status`: the tray shows git's latest line). A cancel shows a toast, still drops the undo history and refreshes, because a cancelled pull may have changed things.
  - A failed run gets `remoteFailureHint` added to its output.
  - Pull, Push and Fetch All send `--progress`.
  - Checkout…, Merge…, Rebase onto… and the palette's Checkout Branch → use `pickBranch`.
  - Commit… and Commit Amend use `commit`.
- **`opStore.ts` / `OpsTray.tsx`:** `detail` is carried, from the latest event of any id. The tray shows it when there is one; unit `status` shows "starting…" until there is.
- **Site demo mock:**
  - `git_run`: amend with `--no-edit`, and `--progress` is accepted;
  - `git_branch_list` with remotes;
  - a new `git_commit_info`.

## Tests
- **Rust:**
  - `check_git_args`: the new shapes pass; `commit`, `commit --amend` and `commit --no-edit` are refused;
  - progress parsing and output collapsing;
  - real git against a local bare remote: a fetch and a push with `--progress` send `op-progress` with a detail and done/total;
  - a fetch from a local HTTP server that answers 401 fails fast with "terminal prompts disabled";
  - a fetch from one that never answers: the idle timeout kills it (the server sees the connection close), and a cancel does too;
  - `git_branch_list` with remotes skips `origin/HEAD`;
  - `checkout feature --` from a remote-only branch makes a tracking branch;
  - `git_commit_info`: added, modified, deleted and renamed files, the unstaged count, HEAD's message, and an unborn repo.
- **vitest:**
  - `gitUx` functions;
  - `opStore` detail;
  - GitDialogs dom tests (picker filter, keys and typed fallback; commit list, disabled state and Ctrl+Enter);
  - routing: Commit, Amend `--no-edit`, the pickers sending `--`, Pull with `--progress` and an op id, and a cancel.

## Status
**Done** (2026-11-20). Commits `7422769` (code, tests, docs) and `78e6feb` (demo rebuild).
- [x] Plan
- [x] Backend: allow list (`--no-edit`, `--progress`, the commit rule), `run_git`, `proc_tree::spawn_detached`, `ops.rs` detail, `git_branch_list` remotes, `git_commit_info`
- [x] Frontend: `gitUx.ts`, `dialogs/GitDialogs.tsx`, the handler, opStore and tray, api, demo mock
- [x] Tests
- [x] Checks: build, test (861 passed, 3 skipped), check:wiring (0 issues), clippy `-D warnings`, cargo test (232 passed, 5 ignored), site:build, site:capture check (25/25)
- [x] Decision records `docs/decisions/2026-11-20-git-ux-remote-commands.md` and `2026-11-20-git-ux-dialogs.md`; ARCHITECTURE updated; handoff

## Results
- **Changed from the plan:**
  - the dialogs read their keys at window level, as DialogHost does, and the panel takes focus. In the browser check, a click on the commit dialog's text left the focus on `<body>`, so Ctrl+Enter did nothing;
  - the palette's "Git: Checkout Branch →" now runs the same picker as Checkout…, so `SAME_COMMAND` folds the two into one palette row (palette.test requires that);
  - the commit rule tracks the options while parsing, so a message that reads `--amend` or `--no-edit` is still a message.
- **Tests:**
  - Rust, in the new `commands/git_tests.rs`:
    - `parse_progress_reads_counts`, `terminal_text_keeps_each_lines_last_update`, `cut_keeps_short_lines_and_ends_long_ones`;
    - `only_remote_commands_get_the_idle_timeout`, `a_cancel_before_the_start_runs_nothing`;
    - `push_and_fetch_report_their_progress_lines` (a local bare remote);
    - `a_remote_that_wants_a_password_fails_at_once` (a local HTTP server answering 401: "terminal prompts disabled");
    - `a_silent_remote_is_stopped_at_the_idle_timeout` and `a_cancel_stops_a_running_fetch` (a server that never answers: it sees the connection close, so the kill reached `git-remote-http`);
    - `branch_list_adds_remote_branches_when_asked`, `checkout_of_a_remote_only_branch_makes_a_tracking_branch`;
    - `commit_info_lists_whats_staged`, `commit_info_on_a_branch_with_no_commits`.
  - Rust, elsewhere:
    - new cases in the two `git_args` tests;
    - `ops.rs`: `a_step_sets_the_detail_and_replaces_the_count`;
    - `proc_tree.rs`: `a_detached_tree_has_its_own_session_and_still_dies_whole`.
  - vitest:
    - `src/gitUx.test.ts`;
    - `src/dialogs/GitDialogs.dom.test.tsx` (15);
    - an opStore detail case;
    - routing tests for every branch prompt, Commit, Amend, Pull, Push and Fetch with `--progress` and an op id, and cancel and the credential hint;
    - an undo case for a cancelled pull;
    - a demo-mock case.
- **Checked in the Browser pane** (the built demo):
  - the commit dialog (staged list, unstaged note, multi-line message, Ctrl+Enter with the focus on the panel);
  - the branch picker (filter, the remote-only `origin/release-0.3` checked out as `release-0.3`);
  - the not-a-repo error state.

  The tray's git rows were checked against the demo's Vite dev server by driving `opStore` by hand: a bar with git's line cut off by an ellipsis, and "starting…" before the first line. No console errors.
- **Not built on Windows:** `proc_tree.rs` (with `spawn_detached`) passes clippy for `x86_64-pc-windows-msvc` in a scratch crate. git.rs's runner has no Windows-only code, but its first Windows build and test run is CI's. The HTTP tests set `GIT_CONFIG_NOSYSTEM`, so Git Credential Manager stays out of them.
- **Not checked in the real app** (`pnpm tauri:dev`): a pull or push against a real remote, and ssh without an agent. The Rust tests cover the runner against real git.

## For review
- **Every git menu command is an op now,** not just the remote ones. The tray shows one that takes over 400 ms (a slow commit hook, say) with a Cancel.
- **No timeout on non-remote commands.** Pull, push and fetch stop after 120 s without output; everything else runs until it ends or is cancelled.
- **`check_git_args` refuses a bare `commit` or `commit --amend`** (an editor would open). Nothing in the app sent those.
- **On Unix, git now runs without a controlling terminal.** ssh can't ask for a passphrase or confirm a host key: it fails (with a hint), or uses a GUI `SSH_ASKPASS` if one is set up. A terminal pinentry for signed commits fails the same way.
- **A cancel toasts and still drops the undo history,** as a failed git command already did.
- **The menu label "Commit Amend" has no "…"** though it now opens a dialog. It's left as is, because `data.ts` is shared and the label is routed by name.
- **`run_git` and `launch.rs`'s `run_capped` share a pattern** (reader threads, a poll loop, kill the tree, drain grace). A cleanup pass could merge them; see the decision record.
