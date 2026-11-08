# .tar.zst: zstd in-process, tar on a pipe

Date: 2026-11-08 · Task: `backend-bugs` · Picked by the task session (the lead said to choose and record), on the plan in `docs/plans/completed/backend-bugs.md`.

## The problem
`archive_can_handle("tar.zst")` said yes whenever `tar` was on PATH, and its comment promised that extraction "falls back to a separate zstd binary". There was no fallback: both create and extract just ran `tar --zstd`. GNU tar implements `--zstd` by running an external `zstd` program, so on a Linux machine without `zstd` installed, every `.tar.zst` create or extract failed with "zstd: not found" (reproduced with `PATH` holding only `tar`). Whether Windows' `tar.exe` (bsdtar) has zstd built in varies by build.

## Decision: implement it, without depending on tar's zstd support
For `.tar.zst` / `.tzst`, tar only ever sees a plain tar stream on a pipe: `tar -cf - -C <parent> <members>` for create, `tar -xf - -C <dest>` for extract. The `zstd` crate does the compression in-process. It was already compiled into the app as a dependency of `zip`, and the direct dependency uses the same features (`default-features = false`), so nothing new is built. With this, "tar alone suffices" is true, and the comment now says why.

Details:
- tar's stderr is read on a thread from the start, so a chatty tar can't fill the pipe and stall the stream.
- Errors: if the in-process side fails (corrupt zstd data, disk full), its error is shown. A broken pipe means tar quit first, so tar's exit code and stderr are shown instead.
- A failed create removes the partial `.tar.zst`. Before, `tar -cf` left it behind.
- Compression level is zstd's default (3), the same as `tar --zstd` with the `zstd` binary.

Rejected:
- **Only correct the comment** and make `archive_can_handle` check for `zstd` or bsdtar. The feature would stay broken on the machines where it fails today, and detecting tar's zstd support means spawning `tar --version` and parsing the output.
- **Try `tar --zstd` first and fall back on failure.** A failed first attempt can leave partial output behind. Telling "tar can't do zstd" apart from "the archive is corrupt" means parsing tar's stderr, which is localized. It also keeps two code paths.

## Checked
- Round-trip test through `archive_create` / `archive_extract`. It also checks the zstd frame magic, corrupt input, and that a failed create leaves no file.
- Manually: the round-trip passes with `PATH` holding only `tar`. Our archives extract with the system `tar --zstd`, and the system's `tar --zstd` archives extract with ours (GNU tar 1.35).
- Not checked locally: Windows `tar.exe` reading from and writing to pipes. The Windows CI `cargo test` job runs the round-trip test.
