# Linux parity: reveal, symlink rows, always-on-top, labels, shells

Date: 2026-11-08 · Task: `linux-parity` · Picked by the task session under the lead session's go-ahead; listed under "For review" in `docs/plans/completed/linux-parity.md`.

## Reveal: our own `FileManager1.ShowItems` call, not the opener plugin
`reveal_in_explorer` on Linux sends `org.freedesktop.FileManager1.ShowItems` over the session bus with `zbus`. That opens the folder with the item selected in Nautilus, Dolphin, Caja, Nemo, Thunar and others. If the call fails (nothing owns or activates the name), it falls back to the old `xdg-open <parent>`.
- It runs on a background thread. D-Bus activation of a cold file manager can take seconds, and every command runs on the main thread (see `async-commands`). `revealInExplorer` in the frontend goes through `safe()`, which drops errors anyway, so nothing that was visible is lost.
- `zbus` 5 and `url` 2 were already in the lock file through `tauri-plugin-opener`, so they add no new crates.

Rejected: `tauri_plugin_opener::reveal_item_in_dir`. It canonicalizes the path first, so revealing a symlink would select the link's target in the target's folder, not the link where the user saw it. Its fallback, the `OpenURI.OpenDirectory` portal, also passes a URI where the method expects a file descriptor.

## Symlink rows describe the target, not the link
`list_dir` takes kind, size and mtime from the link's target, and keeps `is_symlink: true`. Nautilus and Dolphin show the same. A dangling link keeps its own metadata, so it is never a folder. Hidden-ness still comes from the link itself, because on Windows that's the link's own attribute.
This is safe only because `symlink-safety` made copy, move, delete and shred `lstat` the path themselves. A link that lists as a folder never makes them recurse into or delete the target.

## Always-on-top: an error on Wayland, nothing to hide
- **Verified:** tao sends `set_always_on_top` to GTK's `set_keep_above`. A GTK3 probe on niri never gets the `ABOVE` window state, either on native Wayland or under xwayland-satellite. Wayland has no protocol for a client to keep itself on top.
- **Change:** `set_always_on_top` now returns "always-on-top isn't supported on Wayland" when GTK uses its Wayland backend. `GDK_BACKEND` decides this (first entry; unset or `*` means Wayland whenever `WAYLAND_DISPLAY` is set). Before, it returned a success that did nothing.
- **No UI was hidden:** nothing in the UI calls `setAlwaysOnTop` (`src/api.ts`). Under XWayland on niri the request is still a silent no-op. That can't be told apart from a real X11 window manager, so it isn't special-cased.
- **Left for `dead-code`:** deleting the unused wrapper and the command.

## Drive labels come from udev, and an unlabeled mount shows only its path
- **Backend:** on Linux the label is read from `/dev/disk/by-label`. Udev's `\xNN` escapes are decoded, and devices are matched by canonical path, so `/dev/mapper/*` resolves too. A filesystem without a label gets `""`.
- **Frontend:** the Sidebar takes the one-line dedup from `origin/feature` `ddb5466` (`label === letter ? letter : letter + " " + label`). That is the only drive change in that commit; the rest is unrelated and stays for whoever reviews `origin/feature`.

## Shells: `$SHELL` first, matched to a probe by name
On unix, the login shell from `$SHELL` is the first profile, so the terminal drawer, which opens `profiles[0]`, starts the user's shell.
- If `$SHELL` names one of the probed shells (`bash`, `zsh`, `fish`, `pwsh`, `powershell`), it reuses that probe's id and label, and the probe is skipped. Any other shell gets `shell:<name>`.
- `nologin`, `false`, relative paths and missing files are ignored.

Rejected: matching duplicates by canonical binary path. `rbash -> bash` would then hide the plain `bash` entry. Matching by id covers the real case, `$SHELL=/usr/bin/zsh`.

## Not a choice, recorded for context
- **`home_dir`:** Unix reads only `HOME`. Windows keeps `USERPROFILE` then `HOME`. Under WSL a `USERPROFILE` forwarded through WSLENV is a Windows path. The ssh-config lookup shares the same helper.
- **Trash:** the frontend asks a new `trash_dir` command for the path: `$XDG_DATA_HOME/Trash/files` when that variable is absolute (the spec ignores relative values), otherwise `~/.local/share/Trash/files`. That matches where the `trash` crate puts files. The command creates the folder if it's missing. The trash only appears on first use, and this machine had none, so "Go to Trash" failed with a read error. Now it opens an empty folder.
- **Tool names:**
  - VS Code: `code`, `codium`, `code-oss`, plus the `.cmd`/`.exe` forms on Windows.
  - 7-Zip: `7z`, `7zz` (7-Zip's own Linux build, Debian's `7zip`), `7za`, `7z.exe`.
  - A missing VS Code is now an error naming what was tried, not a failed spawn of `code`.
