# git-ux: remote commands that never hang

Date: 2026-11-20. Task: `git-ux` (survey-2 task 20). Builds on op-progress (`docs/decisions/2026-11-10-op-progress-design.md`) and git-safety (`docs/decisions/2026-11-11-git-safety-design.md`).

## The problem
Pull, Push and Fetch ran `git` through `Command::output()`. Nothing showed while they ran, and nothing could stop them. A remote that wanted a password or an ssh passphrase could block them for good:
- git prompts on `/dev/tty`;
- ssh prompts on `/dev/tty` too, for a passphrase or a new host key.

Started from the launcher, the app has no terminal, so the prompts failed with an unclear message. Started from a terminal (`pnpm tauri:dev`), they waited on that terminal, where nobody was looking.

## Chosen
- **Every `git_run` goes through one runner, `run_git` (`commands/git.rs`):**
  - stdin is closed;
  - `GIT_TERMINAL_PROMPT=0`: a credential no helper can supply fails at once ("terminal prompts disabled") instead of prompting;
  - on Unix the child starts a new session (`setsid`, through the new `proc_tree::spawn_detached`). Neither git nor the ssh it starts has a controlling terminal, so ssh fails ("Permission denied (publickey)", "Host key verification failed"), or uses a GUI `SSH_ASKPASS` if the user has set one up. The new session is also a process group, so a kill reaches git, ssh, `git-remote-https` and hooks. On Windows it's the existing job object, with `CREATE_NO_WINDOW`; Git Credential Manager's own window still works there.
- **Every git menu command is an op.** The frontend passes an `op_id` from `runOp`, so anything that takes over 400 ms shows in the tray with a Cancel. A commit hook or a rebase can take long too, not just a remote. Cancel kills the tree, and the call fails with `"cancelled"`. The handler then shows a toast and still drops the undo history and refreshes, because a cancelled pull may already have changed things.
- **Progress:**
  - Pull, Push and Fetch All send `--progress`, since git prints progress to a pipe only when asked. The allow list takes `--progress` for those three subcommands only.
  - A reader splits stderr at `\r` and `\n`. Each line becomes the op's new `detail` (`Op::set_step`). A line like `Receiving objects: 45% (450/1000)` also sets done/total, so the bar follows the current step and restarts with the next one.
  - The tray shows the line itself, which already holds the percentage. `OpProgress` gained `detail` for this; hash, copy and find send none.
- **Timeout: 120 s without any output, for pull, push and fetch only.**
  - It's a limit on silence, not on time: a long fetch that's still printing progress runs to the end, and a hang (unreachable host, a server that never answers) is stopped. 120 s is a little under Linux's default TCP connect timeout.
  - Other subcommands get none, since a commit hook may run quietly for minutes; Cancel still stops them.
  - The error says what happened and names the likely causes, with what git printed so far.
- **The output** keeps only each line's last `\r` segment, as a terminal shows it, without ANSI escapes. Otherwise a fetch's output would be hundreds of progress updates.
- **The 2 s drain grace** after git exits is the same as `run_capped`'s, because a background process (a hook's, an ssh master's) can hold the pipes open.
- **A failed run gets a plain hint** (`remoteFailureHint` in `gitUx.ts`) when its stderr shows a credential or ssh prompt that couldn't be shown: set up a credential helper, `ssh-add` the key, or run the command once in the terminal drawer. "Could not read from remote repository" alone gets no hint: GitHub prints it for a missing repo too.
- **Commits never open an editor.** `check_git_args` now requires `-m <msg>`, or `--amend --no-edit`, for `commit`. Options are tracked while parsing, so a message that reads `--amend` is still a message.

## Rejected
- **A total timeout.** It would kill a big first fetch on a slow link, and progress plus Cancel already cover a slow one.
- **`GIT_SSH_COMMAND="ssh -o BatchMode=yes"`.** It would override the user's `core.sshCommand` (a chosen key, a proxy). Without a terminal, ssh already can't prompt.
- **`SSH_ASKPASS_REQUIRE=force`.** It would change how the user's ssh asks, and it's OpenSSH 8.4+ only.
- **Reusing `launch.rs`'s `run_capped`.** It has no cancel, no progress callback and no idle timeout, and changing its signature would touch `run_script`. The two runners share the pattern: reader threads, a poll loop, kill the tree, drain grace. A later cleanup could merge them.
- **Parsing `git status --short` for the commit dialog.** libgit2 gives the index against HEAD with renames, needs no quoting rules, and runs nothing from the repo's config (`git_commit_info`).

## Not covered
- **Windows:** Git Credential Manager may show its sign-in window. That's wanted: the user can answer it, and the idle timeout still applies to pull, push and fetch. Not checked on Windows; the runner's Windows path is the same job object `run_script` uses.
- **GPG-signed commits** with a terminal pinentry fail without a terminal; a GUI pinentry works.
