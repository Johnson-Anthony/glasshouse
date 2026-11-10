# link-display

Branch: `claude/elastic-heisenberg-27fb3b` · Backlog entry: `## link-display` in `survey-fixes.md`
Started 2026-11-08 from `main` at `e79b362`. It's a follow-up found by linux-parity.

## Status
**Done 2026-11-08.** Checks: `pnpm build` OK, `pnpm test` 183/183, `check:wiring` clean, clippy `-D warnings` clean, `cargo test` 67/67. In `pnpm tauri:dev` (stopped afterwards), a fixture repo showed `↪` on every link, kept it visible on a truncated long name, and put git dots only on the modified target and the untracked links. Miller columns weren't checked live.

## Scope and approach

### 1. A symlink row shows its target's git status *(confirmed)*
**Confirmed** with a failing test on `e79b362`: a clean link to a modified file was labeled "M". Both sides of the lookup canonicalized the leaf path, which resolves a link to its target:
- `list_dir` looked rows up by `canonicalize_soft(&fe.path)`;
- `scan_repo_statuses` keyed entries by `dunce::canonicalize(workdir.join(rel))`.

The same cause also gave a clean target the "?" of an untracked link pointing at it, and gave a clean link to an untracked folder that folder's "?".

**Fix:**
- `scan_repo_statuses` canonicalizes only the workdir and appends the `/`-separated repo-relative parts. Git never descends through a symlink, so the folders inside a status path are always real directories.
- `list_dir` looks a row up by its own path. That path is already canonical, because it is the canonicalized listing folder joined with the raw name.

The async-commands pathspec scoping is unchanged.

**Test** (unix): `list_dir_git_labels_belong_to_the_link_not_its_target` covers:
- a clean link to a modified file;
- an untracked link to a clean file;
- a clean link to an untracked folder;
- the same listing reached through a symlinked alias of the repo.

### 2. A link marker in the file list
- A small `↪` after the name, in `var(--cyan)` at the extension's size, with a "symbolic link" tooltip and aria-label.
- `↪` is in all three bundled fonts (JetBrains Mono / Nerd Font, IBM Plex Mono, Fira Code); I checked with fontTools.
- Cyan is the usual link color in `ls`/`LS_COLORS`, and every theme defines `--cyan`.
- **Main list:** `FileRow` gains `link: boolean`, set in `entryToRow`, and `PaneRow` renders the marker. The name-ellipsis CSS rule excludes `.link`, so the marker stays visible when a long name is cut off, like the extension chip does.
- **Miller columns:** the same marker on rows in all three columns.
- **Not included:** the sidebar folder tree.

### 3. Miller double extension
Found here and fixed as its own task, `miller-names`; see `docs/plans/completed/miller-names.md`.

## Files
`src-tauri/src/commands.rs` (list_dir, scan_repo_statuses, one test), `src/data.ts`, `src/App.tsx` (entryToRow), `src/components.tsx` (PaneRow), `src/Miller.tsx`, `src/styles/app.css`. Docs: this plan and `docs/decisions/2026-11-08-link-display-marker.md`.

## Checks
`pnpm build`, `pnpm test`, `pnpm check:wiring`, `RUSTFLAGS="-D warnings" cargo clippy --all-targets`, `cargo test` (4 jobs). A short `pnpm tauri:dev` run to look at the marker in the list and Miller views, stopped afterwards.

## For review
- Marker glyph and color: `↪` in `--cyan`, after the name.
- The Miller double-extension bug, found here, became the `miller-names` task.
