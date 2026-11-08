# git_dirty_count / git_ahead_behind: "nothing to show" vs real errors

Date: 2026-11-08 · Task: `backend-bugs` · Picked by the task session (the lead said to choose and record), on the plan in `docs/plans/completed/backend-bugs.md`.

## The problem
Both commands turned every failure into `Ok(0)` / `Ok((0, 0))`, so a broken repo looked clean and in sync. Neither has a frontend caller yet: `git_dirty_count` has no `api.ts` wrapper, and nothing calls `gitAheadBehind`. So the signatures could change freely.

## Decision: `Ok(None)` for "nothing to show", `Err` for failures
- `git_dirty_count(path) -> Result<Option<u32>, String>`
- `git_ahead_behind(cwd) -> Result<Option<(u32, u32)>, String>`; in TS, `Promise<[number, number] | null>`

`Ok(None)` covers the states that aren't failures: not inside a repo (libgit2 treats a path that doesn't exist the same way), a bare repo (no working tree to count), detached or unborn HEAD, no upstream configured, or an upstream ref that's gone. A caller hides the badge for these. `Err` carries the libgit2 message for real failures: an unreadable repo, dubious ownership (`safe.directory`), a failing status walk, a missing object. A caller can show it.

"Upstream gone" is `None`, not an error, matching git, which reports it as a branch state (`[gone]`) rather than a failure.

## git_ahead_behind moves from `git rev-list` to libgit2
Telling "no upstream" apart from "git failed" through the CLI means one of two things:
- parse stderr from `rev-list HEAD...@{upstream}`, which is localized, so the text depends on the user's `LANG`;
- spawn two or three processes (`symbolic-ref`, `for-each-ref --format=%(upstream)`, then `rev-list`), each costing several milliseconds to tens of milliseconds on Windows.

libgit2 returns typed error codes (`NotFound`, `UnbornBranch`) and needs no spawn. `git_status` already computed ahead/behind with libgit2 inline, swallowing every error. That code is now the shared `upstream_ahead_behind` helper. `git_status` still maps errors to zero counts, because the toolbar hides zeros anyway.

Rejected: keep the CLI and compare stderr against English strings. That breaks under non-English locales.

## Related: one set of status codes
`list_dir`, `git_status` and `git_dirty_count` now share `git_status_code`, so `GitInfo.status` uses the same single-char codes as `FileEntry.git` ("M", "A", "D", "U", "?"), and `dirty` equals `git_dirty_count`. Before, `git_status` labelled untracked files "add" and conflicts "untracked". Nothing on the frontend reads `GitInfo.status`, so no UI changes. The "ignored" / "!" code was dropped from `git_status` and from the docs, because no status walk asks libgit2 for ignored entries. Listing them would mean walking `node_modules`, `target/` and the like.
