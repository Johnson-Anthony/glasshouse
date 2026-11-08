# command-security

Branch: `claude/silly-hertz-cfba21` · Task: `command-security` in `docs/plans/active/survey-fixes.md`.
The lead approved implementing straight after the plan (2026-11-08); the user reviews the "For review" items at merge.

## Threat model
The webview is the user's agent. If someone gets script execution in it, the app is lost no matter what: `pty_write` drives a real shell and `write_text` can rewrite `~/.bashrc`. That makes two jobs:
1. **Keep foreign code out of the webview** and away from IPC: CSP, no devtools in release builds, and an ACL so that only our own bundled pages in the `main` window can call commands.
2. **Keep untrusted data from turning into commands.** Filenames, URLs, ssh hosts and a repo's `.git/config` reach `cmd.exe`, PowerShell, tar and git. Any downloaded file or cloned repo can supply them, with no XSS needed.

Checked against tauri 2.10.3 source (`webview/mod.rs`, `on_message`): app commands are ACL-checked **only if the app has an app manifest**. Today any page loaded in any webview, remote origins included, can call all 71 commands.

## Scope and approach
1. **ACL for app commands.**
   - `src-tauri/permissions/app.toml` defines grouped permissions (`commands.allow`): read, write, git, config, launch, exec, window.
   - `capabilities/default.json` grants them to the `main` window for local origins only. Remote origins get nothing.
   - `build.rs` uses `Attributes::app_manifest` and **fails the build** if a command registered in `lib.rs` `generate_handler!` isn't in a permission, or if a permission names a command that doesn't exist. Other branches add commands, and a command missing from the ACL would otherwise fail silently at runtime, because `safe()` swallows the error.
2. **Argument validation** (pure functions, with unit tests):
   - `pty_spawn` and `spawn_terminal_profile` share a profile validator:
     - `shell`: exec must be one of the shells `list_shell_profiles` detects, with no args.
     - `wsl`: exactly `-d <distro>`, with a safe distro name.
     - `ssh`: `[host]` or `-p <port> <host>`; the host can't start with `-`, so `-oProxyCommand=` is impossible, and can't contain whitespace or shell metacharacters.
     - Unknown kinds are rejected.
   - `git_run` gets a per-subcommand allowlist built from the shapes `handlers/git.ts` sends: the subcommand must come first (so no `-c`, `-C` or `--exec-path`), only listed flags are allowed, a flag's value is taken as-is (so `-m "-fix"` still works), and positionals can't start with `-`.
   - `open_url` accepts only `http`, `https` and `mailto`.
3. **`run_script`:**
   - 60 s timeout, then kill.
   - stdout and stderr are drained on threads and capped at 1 MiB each.
   - Output is returned even if a grandchild keeps the pipe open.
   - Windows `.bat`/`.cmd` scripts are spawned directly (std escapes batch arguments), not via `cmd /C`, which let filenames inject.
4. **Windows shell injection:**
   - `open_with_default` and `open_url` use `tauri_plugin_opener::open_path` / `open_url` (ShellExecuteExW) instead of `cmd /C start`.
   - `spawn_vscode` spawns `code.cmd` directly.
   - `spawn_terminal`'s pwsh and powershell fallbacks get the folder through an environment variable plus `Set-Location -LiteralPath`, so no user string reaches `cmd`. This also fixes powershell 5.1, which has no `-WorkingDirectory`.
   - `spawn_terminal_profile`'s `cmd /C start` fallback refuses values containing cmd metacharacters; they're validated anyway.
   - `wt.exe -d`: escape `;`, which wt treats as a command separator.
   - **Found while surveying:** `verify_signature` and `create_shortcut` paste paths into PowerShell code, escaping only ASCII `'`, but PowerShell also treats ‘ ’ ‚ ‛ as quotes. Pass the paths through environment variables instead.
5. **tar / 7z:** add `--` before member names (tar.gz create; tar.zst create on the new pipe path) and before the archive and paths for 7z.
6. **`read_image_b64`:** server-side ceiling of 64 MiB, the frontend's largest request, matching `read_text`. Read with `take(cap + 1)` so a file growing after the size check can't get past it.
7. **devtools:** remove the feature from the `tauri` dependency and add an opt-in cargo feature, `devtools = ["tauri/devtools"]`. Debug builds keep devtools either way.
8. **CSP:** add `media-src 'self' data:` (the audio preview's `data:` URL is blocked today), `object-src 'none'` and `base-uri 'self'`. **Keep** the Google Fonts origins: the bundled Nerd Font is only the default, and the font picker's JetBrains Mono, IBM Plex Mono and Fira Code still come from Google (`index.html`).
9. **Found while surveying:** `git_file_info` runs whenever the selection changes, and its `git diff --numstat` executes a repo's `core.fsmonitor` and `filter.*.clean` commands. Its `git log` runs `gpg.program` on a forged signature when the repo sets `log.showSignature`. All three are reproduced in scratch. Fix: numstat through git2, which runs no external commands, and `-c log.showSignature=false` on the log call.

Out of scope: user-triggered `git_run` commands keep git's normal trust model (hooks, LFS filters). Making commands async is the `async-commands` task.

## Status
Done 2026-11-08. Design and reasons: `docs/decisions/2026-11-08-command-security-design.md`.
- [x] ACL + build check. Verified: `gen/schemas/acl-manifests.json` has `__app-acl__` with the 7 permissions. Removing `ping` from app.toml, or adding an unknown command, fails `cargo check` with the fix-it message.
- [x] Validators + tests: `check_profile`, `check_git_args`, `check_open_url`, `is_cmd_inert`, `wt_escape`.
- [x] run_script timeout, output cap and drain grace (tests: timeout, 3 MB past the cap, a background child holding the pipe).
- [x] Windows spawn fixes, including the two PowerShell commands and `wt` `;` escaping.
- [x] tar/7z `--`. Test: members named `--checkpoint-action=exec=…` and `-v` round-trip through tar.gz and tar.zst. 7z checked by hand.
- [x] read_image_b64 ceiling (test with a sparse 64 MiB + 1 file).
- [x] devtools cargo feature.
- [x] CSP.
- [x] git_file_info hardening. Test: a hostile repo that fires fsmonitor, a clean filter and gpg.program under the plain CLI fires none under `git_file_info`.
- [x] Checks: `pnpm build`, `pnpm test` (108), `cargo test` (42), `RUSTFLAGS="-D warnings" cargo clippy --all-targets`. `pnpm tauri dev` (on port 1430, because another worktree holds 1420) showed the file list, tree, devices, tags and status bar all loading under the ACL.

## For review
- **Windows code was never compiled here.** Linux arm64 can't build the Windows target, so `windows-latest` CI is the first compile of:
  - `open_with_default` / `open_url` (opener),
  - `spawn_vscode`,
  - the `spawn_terminal` and `spawn_terminal_profile` fallbacks,
  - `wt_escape` use,
  - the `run_script` batch path,
  - `verify_signature` and `create_shortcut`.

  Worth a manual try on Windows:
  - Open a file and a URL with `&` in its query string.
  - Open in Terminal, both with and without Windows Terminal, on a folder named `a&b;c`.
  - Verify Signature and Create Shortcut on a file named `Tom’s.exe`.
- **`git_run` allowlist:** only the git menu's current commands and flags are accepted. A new git menu item needs an entry in `GIT_RUN_ALLOWED`. A user who types a branch name starting with `-` into Checkout/Merge/Rebase now gets an error (git branch names can't start with `-`, except `-` itself, which is allowed).
- **Terminal profiles:**
  - A `shell` profile must match a detected shell exactly. Nothing persists profiles today, so nothing stale can hit this.
  - Saved-remote ssh hosts are limited to ASCII `[A-Za-z0-9._@:%[]/-]`, so a host with non-ASCII characters (IDN) would be refused.
  - Without Windows Terminal, a profile whose shell path contains `&|<>^%!"` is refused instead of launched.
- **`run_script`:**
  - It's killed after 60 s, and the output says so.
  - Children the script started in the background aren't killed: no process groups or job objects.
  - Output over 1 MiB per stream is dropped.
- **`open_url`:** only http, https and mailto. Every current caller passes https.
- **Opening a folder** through `open_with_default` on Windows now goes through the `open` crate (SHOpenFolderAndSelectItems) instead of `start`. The frontend only sends folders here from "Open With…".
- **`git_file_info` numstat now comes from libgit2.** For LFS-tracked or filter-converted text files, the added/removed counts can differ from `git diff --numstat`, because the clean filter no longer runs. That's the point of the change.
- **CSP:** audio preview should now play (`media-src data:`); not tried by hand. Google Fonts are kept for the font picker.
- **Release builds have no devtools.** Use `--features devtools` to get them.

## Suggested follow-ups (sent to the lead)
- Bundle or lazy-load the font picker's three Google fonts, so startup makes no request to Google, then drop those CSP origins.
- `run_script`: kill the whole process tree on timeout (Unix process group / Windows job object), once `async-commands` makes long runs possible.
