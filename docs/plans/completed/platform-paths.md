# platform-paths

Branch: `claude/youthful-shtern-2ac1c5` (worktree `youthful-shtern-2ac1c5`). Frontend only.

## Problem
`src/paths.ts` guesses Windows vs POSIX from the string itself, so on Linux:
- `normalizePath` lowercases, so `/home/me/Foo` and `/home/me/foo` compare equal (`fs-changed` matching in `state.ts`, the Properties lookup in `App.tsx`, Miller highlighting).
- Any `\` is treated as a separator, but it's a legal filename character. `basename("/home/me/a\b")` is `b`, and `splitBreadcrumb("/home/me/a\b")` switches the whole breadcrumb to Windows shape (`\home`, `\home\me`, …), so every crumb is broken.

On Windows, UNC breadcrumbs drop the leading `\\`. **Confirmed** by running the current `splitBreadcrumb`: `\\server\share\dir` gives `\server`, `\server\share`, `\server\share\dir`. `parentPath` also climbs out of a UNC share root (`\\server\share` → `\\server`).

"Go to WSL Distro…" opens `/mnt/wsl/<name>`. The backend's distro paths are `\\wsl$\<name>\`, which the sidebar already uses.

About a dozen copies of these helpers live outside `paths.ts`, each with the same `\` heuristic.

## Approach
1. **`paths.ts` takes the platform from `IS_WINDOWS`.** The helpers are built by `pathOps(win: boolean)`, and the module's exports are `pathOps(IS_WINDOWS)`, so callers don't change and tests can run both flavors without mocking `platform.ts`.
   - **Windows:** `\` and `/` are both separators. Comparison is case-insensitive and treats `/` as `\`. Roots are `C:\`, a bare `C:`, and UNC `\\server\share\`; `parentPath` stops at each of them.
   - **POSIX:** only `/` is a separator, comparison is case-sensitive, and `\` is part of a name.
2. **New exports in `paths.ts`:**
   - `splitBreadcrumb` and `Crumb`, moved from `components.tsx`. On a UNC path the first crumb is `\\server\share`, pointing at `\\server\share\`.
   - `pathSegments(p)`, for the sidebar's follow-active walk.
3. **Replace the copies with the `paths.ts` versions:**
   - `components.tsx`:
     - `splitBreadcrumb` (Toolbar);
     - `pathBasename` (sidebar tree and pins);
     - the follow-active split and separator guess;
     - the inspector's git parent regex;
     - bulk rename's `sep`/`dirOf`;
     - `baseOf` (paste special);
     - the three inline `shortName`/`base` copies in the blame, hex and diff dialogs;
     - FolderPicker's `fpSepOf`, `fpDirname` and crumbs. As a side effect, this fixes FolderPicker "Up" at `/home`, which currently gets `""` and doesn't move.
   - `App.tsx` drop handler (~L2058): the inline join becomes `joinPath(dstDir, basename(src))`. Also drop a redundant trailing-separator strip after `basename` (~L1643).
   - `handlers/tools.ts`: `joinToolPath` → `joinPath`.
   - `handlers/misc.ts` (~L423, rename from clipboard): the inline dirname → `parentPath`.
   - Line-local edits only, since `components.tsx` and `App.tsx` are shared with other branches.
4. **WSL:** "Go to WSL Distro…" uses the matching detected distro's `path`, matched case-insensitively. An undetected name gets `\\wsl$\<name>\`.
5. **Tests** (`paths.test.ts`):
   - `basename`, `splitBreadcrumb` and `parentPath` on both flavors, including UNC;
   - Linux names containing `\`;
   - case handling on each platform;
   - `joinPath` on POSIX with a `\`-ending name.

**Left alone:**
- `HexDialog`'s inline basename. The dialog is unused and the `dead-code` task deletes it, so editing it would only cause a merge conflict.
- FolderPicker's drive-highlight prefix match (~L5870). It compares mount roots, not names.
- `App.tsx` `relOf` (~L187).
- The drive-letter regexes in `shellCd.ts`, `tools.ts` `winToUnc` and `nav.ts`. These recognise Windows shapes on purpose.

**Decision record:** `docs/decisions/2026-11-08-platform-paths-separators.md`, covering the platform source and the factory used for testing.

## Status
**Done 2026-11-08.** Ready to merge.
- [x] Plan approved
- [x] `paths.ts` rewrite: `pathOps(win)`, plus `splitBreadcrumb` and `pathSegments`. `paths.test.ts` went from 6 tests to 22.
- [x] Call-site replacements: `components.tsx`, `App.tsx`, `handlers/tools.ts`, `handlers/misc.ts`
- [x] WSL fix (`handlers/nav.ts`)
- [x] `pnpm build` passes (tsc + vite); `pnpm test` passes 40/40
- [x] Decision recorded: `docs/decisions/2026-11-08-platform-paths-separators.md`

**Not verified:** the Windows-only paths (UNC breadcrumbs, "Go to WSL Distro…") are covered by unit tests only. Nobody has clicked through them on a Windows machine.

**When merging:** `ui-fixes` and `tab-state` touch `App.tsx`; this branch's edits there are two single-line changes (~L1643, ~L2058). `dead-code` deletes `HexDialog`, which this branch left untouched.
