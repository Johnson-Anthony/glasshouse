# git-ux: the branch picker and the commit dialog

Date: 2026-11-20. Task: `git-ux` (survey-2 task 20).

## Branch picker (Checkout…, Merge…, Rebase onto…, the palette's Checkout Branch →)
- **A filter field over a list**, in `dialogs/GitDialogs.tsx`:
  - it matches fuzzily (`fuzzy.ts`);
  - ↑/↓ and Page keys move, Enter or a click picks, Esc cancels;
  - Home and End stay with the text field.
  - The keys are read at window level while it's open, as in DialogHost, so a click on the dialog's text doesn't take them away. Enter on a focused button stays that button's.
- **What it lists** (`branchChoices` in `gitUx.ts`):
  - the local branches, without the current one (nothing to switch to, merge or rebase onto);
  - remote branches, from `git_branch_list(cwd, remotes: true)`, which now also lists `refs/remotes/` without symbolic refs such as `origin/HEAD`. The Branches submenu doesn't ask for them, so it's unchanged:
    - checkout: only remote branches that have no local branch of the same name, sent as that name. `git checkout feature --` then creates `feature` tracking `origin/feature` (a Rust test checks this with `--`). Sending `origin/feature` would detach HEAD instead.
    - merge and rebase: every remote branch, as `origin/x`, because `rebase onto origin/main` is the common case.
- **Typed fallback:** when nothing matches the filter, Enter sends the text as typed. The old prompts could check out a tag, a commit or `-`, and still can. The text goes through `check_git_args`, so it can't be an option, and a checkout still ends with `--`.
- **The palette's "Git: Checkout Branch →"** used a numbered prompt. It now opens the same picker, and `SAME_COMMAND` folds it into Checkout…'s palette row.

## Commit dialog (Commit… and Commit Amend)
- **What it shows** comes from a new libgit2 command, `git_commit_info`:
  - the branch;
  - the staged files (the index against HEAD with rename detection), each with its code and the old path of a rename; at most 500 are listed, with the total;
  - how many changes aren't staged;
  - HEAD's message.
- **The message is multi-line:** Enter is a new line, and Ctrl+Enter (or ⌘+Enter) commits. It's sent as one `-m`, trimmed; git's own whitespace cleanup does the rest.
- **When it won't commit:**
  - Commit is disabled when nothing is staged, and the dialog says to stage first. Before, git refused with "nothing to commit".
  - Amend is disabled on a branch with no commits.
- **Amend starts from HEAD's message.** Unchanged or emptied, it sends `commit --amend --no-edit`, so the old message is kept exactly (trailers, wrapping). Changed, it sends `--amend -m <new>`. That fixes the old prompt's "(leave empty to reuse)", which did nothing when left empty.
- **No staging from the dialog.** Stage and Unstage stay on the selection (Git → Stage Selected), which already has its safety rules (git-safety).

## Rejected
- **Extending `dialogs.showPick` with a filter.** The typed fallback and the per-row hints are git's, and DialogHost stays generic. The host pattern (`gitDialogs`, mounted once in App.tsx) keeps App's state untouched.
- **Listing remote branches in the Branches submenu.** A repo with many remotes would make the menu long; the picker filters.
