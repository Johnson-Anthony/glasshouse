# inspector-perms

Branch: `claude/cool-gauss-d234ca` (worktree `cool-gauss-d234ca`), started 2026-11-12 from `main` (`71e6ab9`).
Backlog entry: section 6 of `docs/plans/active/survey-2.md`.

## Problems
1. **The permission grid is fake.** The Inspector's grid (`preview/Inspector.tsx` `PermissionsGrid`) starts at a hard-coded `rwxr----- 0740` and never reads the file.
   - Each click runs chmod from that made-up value. Owner-exec on a 0600 ssh key makes it 0640, and any click on a 0755 folder clears group and world x.
   - The grid also keeps its state across files, and errors only go to the console.
2. **A slow hash lands on the wrong file.** "# hash" results land on whatever file is inspected when they finish.

## Approach
**Backend.**
- `file_stat_extended` returns `mode: Option<u32>`:
  - on unix, `st_mode & 0o7777` from the followed metadata, because chmod follows a symlink. A dangling link gives `None`;
  - on Windows, always `None` (only `readonly` means anything there).
- `set_permissions` refuses a mode above `0o7777`.

**Pure helpers (`src/octal.ts`).**
- `permBit(who, perm)` and `toggleBit`.
- `modeString`: `ls -l` style, with `s`/`S`/`t`/`T` for setuid, setgid and sticky.
- `modeOctal`: four digits.
- A toggle flips one bit and keeps everything else, including the special bits.

**The grid (unix).**
- It shows the real mode: "…" while it loads, "—" when it can't be read.
- "edit" starts a draft of the current mode. Clicks toggle bits in the draft only. "cancel" drops the draft; "apply" asks for confirmation, showing the old and new mode (rwx and octal), then runs chmod.
- After apply (or a failure, shown in an alert), the Inspector reads the mode again, so the grid shows what's really on disk.
- The grid is keyed by path, so a draft never carries over to another file.

**Windows:** a read-only line with "make read-only" / "make writable". It confirms, then calls `set_permissions` with the owner-write bit (what the command already reads on Windows).

**Hash (`src/preview/checksums.ts`).**
- `checksumsFor(path, inspecting, hash)` runs the three hashes as one op. It returns `null` when the Inspector has moved to another file by the time they're back.
- The Inspector keeps `{path, sha256, md5, crc32}` and the path being hashed, and shows each only for its own path.

**Demo:** the `file_stat_extended` mock returns a mode, and `set_permissions` remembers it, so the demo grid works.

## Tests
- Rust: `file_stat_extended` reads 0600 and 0755 (with a setgid bit kept), a link reports its target's mode, a dangling link gives `None`; `set_permissions` refuses `0o10000`.
- vitest:
  - `modeString`, `modeOctal` and `toggleBit` (special bits kept);
  - `checksumsFor` drops a result after the path changed and keeps it otherwise;
  - the Inspector renders the real mode from props (server render).

## Status
**Done** (2026-11-12).
- [x] Plan
- [x] Backend mode and range check
- [x] Helpers and grid; Windows read-only
- [x] Hash guard
- [x] Demo mock
- [x] Checks: build, test (358 passed, 3 skipped), check:wiring (0 issues), clippy `-D warnings`, cargo test (159 passed, 2 ignored), site:build, site:capture check (18/18)
- [x] Decision record `docs/decisions/2026-11-12-inspector-perms-design.md`
- [x] Handoff

## Results
- **Tests:**
  - Rust: `file_stat_extended_reads_the_real_mode` (0600, setgid 2755, a link reads its target, a dangling link gives `None`) and `set_permissions_applies_the_mode_and_refuses_anything_bigger`;
  - vitest: `src/octal.test.ts` (bits, toggles that keep special bits, `ls`-style strings), `src/preview/checksums.test.ts` (a result is dropped after the path changed), and `src/preview/Inspector.test.tsx` (the grid renders the real mode, offers nothing before it's known, the Inspector never shows 0740, and the Windows line).
- **Driven end to end** in the built site demo with headless Chromium (a scratch script reusing `site/capture`'s helpers, not committed), with 12 checks:
  - the grid shows 0644; cells do nothing until edit;
  - owner-exec in the draft gives 0744; the confirm reads "now rw-r--r-- 0644 / new rwxr--r-- 0744";
  - after apply the grid reads 0744 back; cancel drops a draft;
  - a draft doesn't follow to the next file.

  The screenshots looked right; the header's apply/cancel were then grouped on the right, and a "· now 0644" hint was added to the draft line.
- **The hash race** is covered by the unit test only. The demo's hashes finish at once.
- **Not compiled:** nothing Windows-specific changed. `mode` stays `None` on Windows through `Default`.

## For review
- **The edit flow:** "edit" → toggle → "apply" with one confirm, instead of chmod per click.
- **Symlinks:** the grid shows and changes the link's target (as chmod does). The confirm says so.
- **Special bits** are kept and shown (`s`/`S`, `t`/`T`). The old grid dropped them on any click.
