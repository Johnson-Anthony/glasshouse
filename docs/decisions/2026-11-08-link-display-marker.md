# Symlink rows: a `↪` marker, and git labels keyed by the link's own path

Date: 2026-11-08 · Task: `link-display` · Picked by the task session under the lead session's go-ahead; listed under "For review" in `docs/plans/completed/link-display.md`.

## The marker: `↪` after the name, in `--cyan`
A symlink row in the file list and in Miller columns ends with a small `↪`, at the extension chip's size, with a "symbolic link" tooltip and aria-label.
- **Glyph:** `↪` is in all three bundled fonts (JetBrains Mono and its Nerd Font build, IBM Plex Mono, Fira Code), so it renders the same whichever font the user picks. The row icons are plain Unicode for the same reason.
- **Color:** cyan is the long-standing link color in `ls` / `LS_COLORS`, and every theme defines `--cyan`.
- **Placement:** after the name and extension, so names stay left-aligned with their neighbours. Like the extension chip, the marker is excluded from the name-ellipsis rule, so it stays visible when a long name is truncated.

Rejected:
- **A Nerd Font link icon:** private-use codepoints exist only in the Nerd Font build, and would show as tofu with IBM Plex Mono or Fira Code.
- **Replacing or overlaying the kind icon:** a linked folder still has to look like a folder, since it opens like one.
- **Showing `→ target`, as `ls -l` does:** `list_dir` doesn't read link targets, and adding a `readlink` per row costs time on large folders. The Inspector already shows the target.

## Git labels: canonicalize only the workdir
`scan_repo_statuses` keys each status entry by the canonical workdir joined with the entry's repo-relative path, split on `/` and pushed part by part. `list_dir` looks each row up by its own path, which is the canonical listing folder plus the raw name.
- The old code canonicalized the full path on both sides. That resolves a symlink to its target, so a link showed its target's status, and a target could pick up a link's status.
- Canonicalizing only the workdir is enough, because git never descends through a symlink: every folder inside a status path is a real directory.
- Pushing the parts one at a time keeps Windows keys on `\`, like the FileEntry paths.

Known limit: on Windows, a file whose on-disk case differs from the case in git's index no longer gets a label. The old full-path canonicalization fixed the case up as a side effect. Git itself reports such a file oddly, so this wasn't worth a per-row filesystem call.
