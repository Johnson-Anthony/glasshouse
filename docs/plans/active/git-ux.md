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
**In progress.**
- [x] Plan
- [ ] Backend: allow list, runner, progress, `ops.rs` detail, branch list remotes, `git_commit_info`
- [ ] Frontend: `gitUx.ts`, GitDialogs, handler, opStore/tray, api, demo mock
- [ ] Tests
- [ ] Checks: build, test, check:wiring, clippy, cargo test, site:build, site:capture check
- [ ] Decision record, ARCHITECTURE line, handoff
