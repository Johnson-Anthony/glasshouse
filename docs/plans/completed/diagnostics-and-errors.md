# diagnostics-and-errors (survey-3 task 33)

Branch `claude/unruffled-pascal-d0c30d`. Scope: "## 33" in `survey-3.md`, plus its "for 33" note (WebDriver reports wry's version, not WebKitGTK's, so the app has to report it itself).

## Status
- [x] Plan (this file)
- [x] Backend: log file, panic hook, fatal-error box, startup without `.expect`
- [x] Backend: structured errors on the paths users hit
- [x] Frontend: error boundary, error dialog with "Show details", global error logging
- [x] Help → Open Log Folder; Report Bug… with a preview
- [x] Tests, the full checks, e2e, handoff (2026-11-20)

Changes from the design below, made while building it:
- The folder pane's "can't read this folder" shows the sentence but no Show details: its state is a string shared by several modules, and the sentence is enough there.
- Report Bug… has no display-scale field: the issue form (task 43) asks for the scale in its desktop field, so it goes there ("GNOME (wayland), 125% scale"), and a field with nothing in it is left out. The scale is the window's `scaleFactor()`, not `devicePixelRatio`, which counts View → Zoom on WebView2.
- `showError` lives in `src/errorDialog.ts`, not on `dialogs`: tests mock `dialogs` with a fixed set of methods.
- Windows' 7-Zip is also looked for in its default install folders, because its installer doesn't add it to PATH (the docs-and-community follow-up for 34).
- The decision record is `docs/decisions/2026-11-20-diagnostics-and-errors-design.md`.

## Design

### Log file
- **Plugin:** `tauri-plugin-log` 2.10 (Rust) and `@tauri-apps/plugin-log` (JS), registered in `builder()`, so it covers the main window and the chooser.
- **Targets:** stderr, plus `glasshouse.log` in the app's log folder: `<data_local_dir>/<APP_ID>/logs`, the folder Tauri's `app_log_dir` picks on Linux and Windows.
- **Path:** `logs::dir()` computes the folder without an `AppHandle`, so the panic hook and the fatal box can find it before the app is built.
- **Size:** 1 MB per file, keep 2 rotated files, append across sessions. Every line carries the pid, because New Window starts another process that writes the same file.
- **Level:** Info, with noisy crates turned down.
- **When the folder can't be made:** log to stderr only. A read-only data folder must not stop the app.
- **First line of each run:** version, OS, arch, desktop and session type, and the WebKitGTK or WebView2 version (`tauri::webview_version()`).
- **eprintln! calls** in the GUI process become `log::` calls (window state, window fit, watcher, drag out, reveal, terminal fallbacks, integration's runtime warnings, the chooser). They still reach stderr through the stderr target.
- **Calls that stay on stderr:**
  - the CLI modes' output (`--integration-on`/`-off`), which is meant for a terminal;
  - the resident D-Bus service (`--dbus`): it has no Tauri app, and its stderr goes to the journal.
- **Migration:** `migrate.rs` keeps its stderr lines and returns them. The window then logs them once the logger is up.

### Panic hook and fatal errors
- **The panic hook** is installed first thing in `run()`. It logs the message, its location and the thread, then flushes. Before the logger is up, it appends to the log file directly. Then it calls the default hook.
- **Release builds** (`panic = "abort"`): every panic is fatal, so the hook also starts `glasshouse --fatal-dialog crash`, a fresh process that shows a native box: "glasshouse ran into a problem and has to close", the log's location, and Open Log Folder.
  - It's a separate process so the box never runs inside a panicking thread, or inside the GTK or Win32 loop that panicked.
  - Linux uses a GTK3 MessageDialog: GTK3 is already a dependency, and every desktop that runs glasshouse has it. Windows uses MessageBoxW.
- **Startup:** `.expect` on `build()` becomes a log line plus the same box. Tauri creates the window inside `run()` and panics if it can't, which lands in the hook.
- **WebView2 missing (Windows):** before building, `webview_version()` is checked. When WebView2 isn't there, the box says so, and its button opens Microsoft's WebView2 page. Today the app just closes.

### Structured backend errors
- **`crate::error::AppError`** is serialized as `{ kind, path, message, detail }`:
  - `kind` is a short camelCase tag: notFound, permission, exists, notEmpty, readOnly, full, inUse, notAFolder, isAFolder, badName, tooLarge, otherDisk, missingTool, cancelled, other;
  - `message` is a plain sentence ("Couldn't open “secret” because you don't have permission.");
  - `detail` is the raw text (what the error said before, with the full path and the OS error).
- **Where the sentence comes from:** `AppError::io(Action, path, &io::Error)` classifies the error from its `io::ErrorKind`, plus Windows' sharing and lock violations. `Action` gives the verb ("open", "move … to the trash", "change the permissions of …").
- **Gradual conversion:** `From<String>` keeps unconverted helpers working through `?`, with kind `other` and the message equal to the old text.
- **Converted:** the paths users actually hit.
  - listing, make_dir, rename, copy, move, delete, trash, read/write text, permissions, links;
  - the missing-tool errors (7-Zip, VS Code, tar);
  - open_url, open with default, and starting the built-in terminal.
- **Left as strings:** git, find/replace, integration and config, listed in the report.
- **Frontend:** `api.ts` routes every `invoke` through one wrapper that turns `{kind, message, detail}` into a `BackendError` (an `Error` whose `.message` is the sentence). So every existing `errText(e)` shows the sentence with no change at the call site.
  - `isAlreadyExists` and `isCancelled` read `kind` instead of matching text.
  - `errDetail(e)` gives the raw detail.
- **Dialogs:** `showAlert` takes an optional `detail`, shown under a "Show details" disclosure. The menu-command catch in App.tsx is no longer titled "error": it uses the command's label as the title and passes the detail. That covers every handler that has no catch of its own. The busiest alerts pass `detail` too.
- **The folder pane's "can't read this folder"** shows the sentence, with the detail under Show details.
- **Smaller fixes:**
  - the "not yet wired" toast becomes a plain "isn't available" message, logged as a warning;
  - `String(e)` alerts move to `errText`;
  - the terminal's "pty spawn failed" becomes "Couldn't start the terminal: …".

### Frontend crashes
- **`ErrorBoundary`** wraps `<App/>` in `main.tsx`, and the chooser's root too.
  - On a render error it logs the error and the component stack to the log file.
  - It shows a full-window screen with plain styles: what happened, Show details, then Reload, Open Log Folder and Report Bug….
  - Open Log Folder there uses the system opener, because the app's own UI is gone.
- **`window` error and `unhandledrejection` events** are logged to the log file. They show no UI. The e2e listeners still see them.

### Help menu
- **Open Log Folder** (new item, after Report Bug…) opens the log folder in a new glasshouse tab. The folder is created if it's missing.
- **Report Bug…**
  - It collects the app version, OS name and version, arch, desktop and session type, the WebKitGTK or WebView2 version, and the display scale. Nothing else: no paths, user name, host name or kernel string.
  - It shows exactly that text in a dialog before anything opens, and says that nothing is sent until the user submits the issue on GitHub.
  - It also notes that the log, if the user attaches it, can contain file names.
  - Then it opens `issues/new` pre-filled: `template=bug_report.yml` with field ids (coordinated with task 43 through the lead), plus `title` and `body`, so the link works with or without the form.
  - Backend: a new `bug_report_info` command (files-read group) and `log_dir` (settings group). Both are listed in `permissions/app.toml`.

### Touches shared with other sessions
- `src/data.ts` Help list: one new item. The updater adds its own.
- `src/handlers/misc.ts`: Report Bug… and Open Log Folder.
- Preferences: not touched.
- `lib.rs`: the builder gets the log plugin, the startup changes, and the panic hook.

### Tests
- **cargo:**
  - error classification and wording;
  - the serialized shape;
  - `--fatal-dialog` parsing;
  - the log dir path;
  - bug-report info contains no home path or user name;
  - the updated error assertions in fs_ops, listing and archive tests.
- **vitest:**
  - `BackendError` and `errText`;
  - `isAlreadyExists` and `isCancelled` by kind;
  - the bug-report URL (encoding, fields, no paths);
  - ErrorBoundary renders its screen on a throw;
  - alert "Show details".
- **e2e:** the "no notice, error or dialog" test also checks that the crash screen isn't shown.

### Not buildable here
- `cfg(windows)` code: MessageBoxW, the WebView2 check, the sharing-violation codes. These get type-checked through a scratch crate where they're pure Rust.

## Left as plain-text errors
These commands still reject with a string. The frontend shows it as before, now under a title instead of "error", and logs it. Each converts the same way when it's next touched (`AppError::io` / `AppError::other`, then `?`).
- git (blame, branches, commit info, discard, stage, unstage, file info); `git_run`'s output goes to the git panel, which shows git's own text on purpose.
- Find and replace (`rewrite_text`, the find and replace previews), and search.
- config (pins, recent, remotes, tags), integration and integration_win.
- file_info (`diff_files`, `read_hex_dump`, `verify_signature`, `file_stat_extended`), `read_image_b64`, `shred`, `change_owner`, `create_shortcut`.
- open_with (`open_with_default`, `open_with_app`, `open_with_apps`, `open_with_program`): its texts were already sentences from the open-with task ("Couldn't open "x": …"), so they stay.
- launch (`run_script`, `spawn_terminal`, `spawn_terminal_profile`, `reveal_in_explorer`, `spawn_new_window`), trash list/restore/purge, `start_drag_out`, `pty_kill`, the chooser's commands, `net_rate`, `path_fs_type`.
- stderr only, on purpose: the resident D-Bus service and the portal backend (no Tauri app; the journal has their stderr), the CLI's `--integration-on/off` output, and `chooser.rs`'s error for a request that arrives before its app exists.

## Checks (2026-11-20, Linux arm64)
- `pnpm build`, `pnpm test` (76 files, 1076 tests), `pnpm check:wiring`, `pnpm notices --check`: pass.
- `RUSTFLAGS="-D warnings" cargo clippy --all-targets`, `cargo test` (356 passed, 5 ignored): pass.
- `pnpm site:build`, `pnpm site:capture check` (25 checks): pass.
- `pnpm tauri build --debug --no-bundle`, then `pnpm e2e`: 8/8. The run's log: `glasshouse 0.2.0 started: Parrot Security 7.4, aarch64, unknown desktop (x11), WebKitGTK 2.54.0`.
- `glasshouse --fatal-dialog crash|startup|webview` under Xvfb (`GDK_BACKEND=x11`): each box shows its text and two buttons; a bad argument exits 2.
- Windows type-check (`cargo clippy --target x86_64-pc-windows-msvc`, `-D warnings`, a scratch crate): `error.rs` and `fatal.rs` through `#[path]`, plus verbatim copies of `trash_error` and `seven_zip_installed`. It caught a redundant closure that Windows CI's clippy would have failed on.

## Not verified
- Nothing on Windows ran: the MessageBoxW box, the WebView2 check before building, 7-Zip found in Program Files, the trash HRESULT mapping and the sharing-violation kind (errors 32 and 33). `lib.rs`'s Windows branch and `launch.rs`'s Windows spawns weren't type-checked (they need tauri). Windows CI is their first compile.
- A real panic in a release build (the hook starts the box only with `panic = "abort"`) and a failed `build()`: neither was triggered. The box was checked by its argument, and the log's write path by the e2e run.
- The crash screen in the running app (it's covered by a DOM test), and Report Bug…'s GitHub page with the form filled in (the URL is unit-tested against the form's ids).
