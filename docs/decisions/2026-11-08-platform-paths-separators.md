# Path rules follow the platform, not the string

Date: 2026-11-08 · Task: `platform-paths`

## Decision
- `src/paths.ts` picks its separator and case rules from `IS_WINDOWS`. It no longer guesses from whether the string contains a `\` or a drive letter.
  - **Windows:** `\` and `/` are both separators, and comparison is case-insensitive with `/` folded to `\`. Roots are `C:\`, a bare `C:`, a leading `\`, and UNC `\\server\share\`. `parentPath` stops at a share root rather than climbing to `\\server`, which `list_dir` can't open.
  - **Everywhere else:** `/` is the only separator, comparison is case-sensitive, and `\` is part of a filename.
- The helpers come from `pathOps(win: boolean)`. The module exports `pathOps(IS_WINDOWS)` under the old names, so callers are unchanged, and tests build both flavors directly.
- On Windows, a UNC breadcrumb's first crumb is the whole share (`\\server\share`, pointing at `\\server\share\`). Separate `server` and `share` crumbs would point at a server, which can't be listed.

## Why
- **Guessing from the string can't be right on Linux.** `\` is a legal filename character there, so `/home/me/a\b` was split into `a` and `b`, and the breadcrumb switched the whole path to Windows shape.
- **Only Windows compares paths case-insensitively.** Lowercasing on Linux made `Foo` and `foo` look like the same directory.
- **The factory keeps tests honest.** Vitest runs under Node, where `IS_WINDOWS` is false, so the Windows rules could otherwise only be tested by mocking `platform.ts` and re-importing the module.
- **Why not an optional `win` parameter:** a trailing `win = IS_WINDOWS` argument would break silently in `paths.map(basename)`, where the array index would arrive as `win`.

## Not changed
- **The app never sees Windows-shaped paths on Linux** (remote browsing doesn't exist; see the open questions in `docs/SPEC.md`). If that changes, a remote path needs its own `pathOps` flavor rather than a return to string sniffing.
- **Drive-letter regexes stay where they are** (`shellCd.ts`, `winToUnc` in `handlers/tools.ts`, the `nav.ts` drive check). They detect Windows paths on purpose.
- **`HexDialog` keeps its inline basename copy.** It's unused, and the `dead-code` task deletes it.
