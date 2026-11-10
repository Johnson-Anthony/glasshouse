# Reword one unpushed commit message before the first full push

Date: 2026-11-10 · Lead session

## Context
The user wants the old nickname gone from the code, the docs and GitHub. Commit `ee1dd9b` ("Backlog: add presentation task…") had it in its message. It was unpushed, but 185 commits deep by the time of the push, and the docs cite many commit ids.

## Decision
- Reword only that message, with `git filter-branch --msg-filter` over `origin/main..main`, once no task branch held unmerged work. Trees were unchanged; that was checked pair by pair.
- Build the old→new commit map from `git rev-list --topo-order` before and after, and rewrite the 7–12 character ids the Markdown files cite (97 ids in 21 files) in a follow-up commit.
- Rehearse the whole thing in a scratch clone first.
- Keep the old history as local branch `pre-reword-backup`. Task worktrees reset to the new `main` instead of merging it.

## Rejected
- **Leaving the message as is:** it would have put the word on GitHub in a new commit.
- **Force-pushing the older, already-public history** to scrub it there too: the user didn't ask for that, and it rewrites public history.
- **git filter-repo:** not installed, and it would rewrite every ref by default.

## Consequences
- Commit ids cited in commit *messages* from before the reword still point to the old ids; only the Markdown docs were updated.
- The word still appears in history from before 2026-11-08, and inside third-party text (font glyph names, xterm's license notice naming Fabrice Bellard, "price" in the GPL).
