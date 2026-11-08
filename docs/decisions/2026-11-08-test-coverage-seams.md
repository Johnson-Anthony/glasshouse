# Testing Rust code that needs an AppHandle, the environment or /proc

**Decision (test-coverage, 2026-11-08):** split such code at the point where it touches the outside world, and test the inner part. Don't add tauri's `test` feature, and don't set environment variables in the test process.

## Choices
- **Callbacks instead of `AppHandle`.** `watch_dir` now calls `watch(state, path, on_change)`, and `unwatch_dir` calls `unwatch(state, path)`. That's the same shape as `pty::spawn_session`, which the pty tests already use.
  - The alternative was tauri's `test` feature (`MockRuntime`). It also needs every command that takes an `AppHandle` made generic over `R: Runtime`, which is a signature change in shared files and a new dev-dependency feature, only for tests.
- **Text in, value out, for parsers.** `parse_ssh_hosts`, `fs_type_for` and `parse_net_dev` take the file's text. `terminal_command_for` takes the emulator that `linux_terminal_command` found on PATH. Each body is unchanged, only split from its caller, so tests don't depend on this machine's ssh config, mounts, network or installed terminals.
- **The trash test runs in a child process.** The `trash` crate reads `XDG_DATA_HOME`. Setting it inside the test binary would race the other test threads, and libgit2 reads the environment from C with no lock. Without it, the test would use the real trash. Instead, `move_to_trash_moves_into_the_xdg_trash` reruns the test binary on one `#[ignore]`d test, with `XDG_DATA_HOME` set to a scratch folder. That child test does nothing unless its parent set `GLASSHOUSE_TRASH_TEST_ROOT`, so `cargo test -- --ignored` stays safe.

## Consequences
- `watch`'s `on_change` is used only by the call that creates the debouncer (the first). That was already how `watch_dir` behaved with its `AppHandle`, and a test now pins it.
- Code that reads the environment directly (`home_dir_path`, `linux_terminal_command`'s `$TERMINAL` and `which` probing) stays untested except through these seams. Prefer the same split if one of them needs a test.
