# linux-parity

Branch: `claude/elastic-heisenberg-27fb3b` · Backlog entry: `## linux-parity` in `survey-fixes.md`
Started 2026-11-08 from `main` at `ee1dd9b`, which includes symlink-safety, ui-fixes and platform-paths.

## Status
**Done 2026-11-08.** All seven items are implemented, with 10 new Rust unit tests (32 in total). The choices are recorded in `docs/decisions/2026-11-08-linux-parity-choices.md`. The lead session approved going ahead without a separate OK.

Verified live on this machine (niri, Parrot arm64), through the real commands and `pnpm tauri:dev`:
- **Drives:** the sidebar shows `/ parrot-root`, where it used to show `/ /dev/nvme0n1p6`, and `drives()` gives `/boot/efi` the label `SYSTEM`.
- **Linked folders:** `~/sl7/{deep-sleep,ir-camera,touchpad}` (links to sibling folders) list and sort as folders in the app.
- **Reveal:** revealing a symlink opened Caja on the link's own folder with the link selected ("link-to-zeta selected" in the status bar). With the session bus unavailable, it fell back to `xdg-open <parent>`.
- **Shells:** `$SHELL=/bin/dash` puts `shell:dash` first, ahead of bash.
- **Trash:** with `XDG_DATA_HOME=/srv/xdg-test` it returns `/srv/xdg-test/Trash/files`; by default it returns `~/.local/share/Trash/files`.
- **Tools:** VS Code resolves to `/bin/codium` (`code` isn't installed here), and 7-Zip resolves to `/bin/7z`.
- **Not clicked live:** "Go to Trash" in the Go menu. There's no pointer-input tool for native Wayland windows here, and no keyboard path to that menu. The command and the handler's types are checked.

## Scope and approach

### 1. Symlinked folders are listed as files (`list_dir`)
`DirEntry::metadata` doesn't follow links. For a link, take kind, size and mtime from `fs::metadata` (which follows it), and keep `is_symlink: true`. A dangling link keeps its own metadata and stays a non-folder. The hidden check still uses the link's own metadata, because a Windows hidden attribute belongs to the link.
This is safe now that symlink-safety is merged: copy, move, delete and shred all `lstat` the path themselves and never follow a link, so a link that lists as a folder can't make them recurse into its target.
Test: a tempdir holding a dir link, a file link and a dangling link (unix only).

### 2. Reveal doesn't select the file on Linux (`reveal_in_explorer`)
Call `org.freedesktop.FileManager1.ShowItems` over the session bus with `zbus`, falling back to the old `xdg-open <parent>` when the call fails (no file manager owns the name). This runs on a background thread, because D-Bus activation of the file manager can take seconds and commands run on the main thread. The frontend's `safe()` wrapper drops the error anyway. Windows is unchanged.
I chose not to use the opener plugin's `reveal_item_in_dir`, because it canonicalizes the path, so revealing a symlink would select the link's target in the target's folder. `zbus` 5 and `url` 2 are already in the lock file through the opener plugin, so adding them as direct Linux deps adds no new crates.

### 3. `home_dir` prefers USERPROFILE
Use one helper, `home_dir_path`, for both `home_dir` and the ssh-config lookup. It reads USERPROFILE then HOME on Windows, and only HOME elsewhere. On WSL, a USERPROFILE passed in through WSLENV is a Windows path. Empty values count as unset. Tested through a pure `home_from(lookup)` helper.

### 4. Drive label is the device name
`origin/feature` `ddb5466` only changes the Sidebar row to `label === letter ? letter : letter + " " + label`. That hides "C: C:" for unlabeled Windows volumes, and it doesn't touch the backend. The rest of that commit is unrelated (terminal probe, menubar, polish).
- **Backend (Linux):** read `/dev/disk/by-label`, unescape udev's `\x20` escapes, and map each canonical device to its label. A mount's label is its device's label, or empty when it has none. Other non-Windows targets keep `Disk::name()`.
- **Frontend:** port only the one-line dedup, so an unlabeled mount shows `/home` and not `/home /home`.
- Tests: the unescape function, and the label map built over a fake by-label dir.

### 5. Tool lookup and the shell list
- **VS Code:** try `code` (plus `code.cmd`/`code.exe` on Windows), then `codium`, then `code-oss`. Return a clear error when none is found, instead of spawning a bare `code` that fails.
- **7-Zip:** one `find_7z()` helper used by `archive_can_handle`, `archive_create` and `archive_extract`. It tries `7z`, `7zz` (7-Zip's own Linux build, Debian's `7zip` package), `7za` and `7z.exe`.
- **Shells:** on unix, put the `$SHELL` login shell first, so the terminal drawer's default (`profiles[0]`) is the user's shell. Then add the probe list, skipping any probe that resolves to the same binary. A `$SHELL` that isn't in the probe list (e.g. `nu`) gets its own `shell:<name>` profile.
- Tests: tool lookup through `which::which_in` over a tempdir PATH, and shell ordering and dedup over fake executables.

### 6. Always-on-top on Wayland *(was inferred, now confirmed)*
- **Confirmed:** tao forwards `set_always_on_top` to GTK `set_keep_above`. A GTK3 probe on niri never gets the `ABOVE` window state, either on native Wayland or through xwayland-satellite. Wayland has no protocol for a client to keep itself on top.
- **No UI to hide:** `setAlwaysOnTop` in `api.ts` has no callers, so there is no action to hide.
- **Change:** `set_always_on_top` returns an error when GTK is on its Wayland backend, worked out from `GDK_BACKEND` and `WAYLAND_DISPLAY`, instead of reporting a fake success. Removing the unused wrapper is left to `dead-code`.

### 7. Trash path hardcoded in the frontend
Add a new `trash_dir` command, which returns `$XDG_DATA_HOME/Trash/files`. XDG_DATA_HOME must be absolute, as the spec says, and defaults to `~/.local/share`. The command returns `None` on Windows. `nav.ts` "Go to Trash" uses it. Tested through a pure helper.

## Files
`src-tauri/src/commands.rs`, `src-tauri/src/lib.rs` (register `trash_dir`), `src-tauri/Cargo.toml` and `Cargo.lock` (Linux `zbus`, `url`), `src/api.ts`, `src/handlers/nav.ts`, `src/components.tsx` (one line). Docs: this plan and `docs/decisions/2026-11-08-linux-parity-choices.md`.

## Checks
`pnpm build`, `pnpm test`, `RUSTFLAGS="-D warnings" cargo clippy --all-targets`, `cargo test`, and a live run of `pnpm tauri:dev` on niri: a symlinked folder, Reveal, the drive labels, and the default terminal shell.

## For review
- Reveal uses a hand-rolled D-Bus call, not the opener plugin, so links are revealed as links.
- A symlink row shows its target's size and mtime, as Nautilus and Dolphin do, not the link's own.
- `set_always_on_top` now errors on Wayland. The unused `setAlwaysOnTop` wrapper is left for `dead-code`.
- `trash_dir` creates the trash folder when it's missing, so a fresh account opens an empty trash instead of an error.
- `origin/feature` `ddb5466`: only its one-line drive-label dedup was ported. The rest of that commit (terminal probe, menubar, polish) is still unreviewed.
