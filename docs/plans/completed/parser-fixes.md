# parser-fixes

Branch: `claude/exciting-davinci-df48b1` (worktree `exciting-davinci-df48b1`), from main e730069. Rust only, in `commands.rs`, with tests in `commands/parser_tests.rs`.

## Status
**Done 2026-11-10.** `pnpm build`, `pnpm test` (234), `pnpm check:wiring`, clippy `-D warnings` and `cargo test` (122 passed, 1 ignored; 4 new) pass on Linux arm64.
- [x] `parse_ssh_hosts` accepts `Host=name` and `Host = name`
- [x] `fs_type_for` picks the last of several mounts on one mount point
- [x] Tests extended, and shown to fail on the old code: 3 of the 4 new tests failed before the fix. The fourth, deepest-mount-listed-first, passes on both, and guards against a naive "last line wins" fix.
- [x] Checks

The old code was worse than the backlog said: `Host = beta` gave a host named `=`, and `HOST =delta` gave `=delta`. Those would have appeared as ssh profiles in the terminal menu, and `check_profile` would have refused them at spawn.

## ssh config
ssh_config(5) separates a keyword from its arguments by whitespace, or by optional whitespace and exactly one `=`, and keywords are case-insensitive. `parse_ssh_hosts` only knew `Host<space|tab>`, so `Host=alpha` and `Host = alpha` were skipped.

Fix: the keyword is the line's first run up to whitespace or `=`. It must equal `host` (any case). Then skip whitespace and at most one `=`; the rest are the patterns. A second `=` makes the line invalid (ssh rejects it), so it's skipped. `Hostname`, `HostKeyAlias` and `Match host …` still don't match.

Not handled (unchanged): quoted patterns (`Host "a b"`) and `Include`d files.

## Stacked mounts
`/proc/self/mounts` lists mounts in the order they were added to the namespace, so a later mount on the same mount point hides the earlier one. `fs_type_for` kept the first. This machine has a real case: `/proc/sys/fs/binfmt_misc` is autofs (line 13), then binfmt_misc on top (line 23).

Fix: on a tie in mount-point length, the later line wins (`>=` instead of `>`). The longest prefix still decides first: here `/sys`, `/proc`, `/dev` and `/run` are listed **before** `/` (they were moved into the new root at boot), so a plain "last matching line wins" rule would call `/proc` ext4.

Not handled (unchanged): a mount on a parent that hides an earlier mount below it (`/mnt/data`, then a new `/mnt` over it). Telling that apart from a moved mount needs the parent IDs in `/proc/self/mountinfo`.
