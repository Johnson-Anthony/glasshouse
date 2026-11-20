# diagnostics-and-errors: errors users can read, and a log for bug reports

Task 33 of survey 3. Before it, a failure either showed the backend's raw text ("read_dir(/srv/x): Permission denied (os error 13)", an alert titled "error") or nothing at all: a panic in a release build aborted the process, a failed start closed the window, and nothing was written anywhere.

## Backend errors carry a sentence and the raw text

Commands users hit return `crate::error::AppError`, serialized as `{ kind, path, message, detail }`:
- `message` is a sentence for the user: "Couldn't move “a.txt” to the trash because it isn't there anymore."
- `detail` is what the error used to say, with the full path and the OS's text. The alert shows it under "Show details", and the log gets it.
- `kind` (notFound, permission, exists, cancelled …) is what code tests. `isAlreadyExists` and `isCancelled` read it instead of matching text.

`AppError::io(Action, path, &io::Error)` builds the sentence from the `io::ErrorKind`. The verb comes from `Action`, so the wording lives in one place (`error.rs`).

**Conversion is gradual.** `impl From<String> for AppError` lets a converted command call helpers that still return `String` through `?`: the result has kind `other` and the old text as both message and detail. On the frontend, `api.ts` routes every `invoke` through one wrapper that turns the shape into a `BackendError`, an `Error` whose `.message` is the sentence. So the existing `errText(e)` calls show the sentence with no change, and commands not yet converted reject with plain text as before. The commands still returning strings are listed in `docs/plans/completed/diagnostics-and-errors.md`.

Rejected: a full `thiserror` enum per module. It would have touched every command at once, against the survey's "keep the diff reviewable", and the frontend needs only the kind and two strings.

## The log

`glasshouse.log` is in the folder Tauri's `app_log_dir` names: `~/.local/share/<APP_ID>/logs` and `%LOCALAPPDATA%\<APP_ID>\logs`. `diagnostics::dir()` computes it without an `AppHandle`, so the panic hook can write there before the app is built. It's written through tauri-plugin-log at Info: 1 MB per file, two old files kept. Each line carries the pid, because New Window starts another process that appends to the same file.

What goes in: each start's line (version, OS, desktop, web view, all without names), the identifier migration's lines, warnings the backend used to print to stderr, panics, and on the page's side the errors shown in alerts, uncaught errors and unhandled rejections. File paths do appear (an error's detail names its file), which is why Report Bug… doesn't attach the log and its preview asks the user to look through it first.

The CLI modes (`--integration-on/off`) and the resident D-Bus service have no Tauri app and keep writing to stderr only.

## Fatal errors show a box, from a new process

`panic = "abort"` in release builds means any panic ends the process. The panic hook logs it, then starts `glasshouse --fatal-dialog crash` (or `startup`), which shows a native box with the log's location and an Open Log Folder button: GTK's MessageDialog on Linux (GTK 3 is already linked), MessageBoxW on Windows.

The box runs in a new process because the panicking one may be inside GTK's or Win32's event loop, or holding a lock the UI needs; showing a dialog there could hang instead of telling the user anything. The child starts from `startup::self_exe()`, which prefers `$APPIMAGE`, because an AppImage's mount goes away when the parent exits. The `--fatal-dialog` mode installs the panic hook without the box, so a panic there can't start another box.

A failed `build()` (formerly `.expect`) goes the same way. On Windows the window code first checks `tauri::webview_version()`; without the WebView2 Runtime the box says so, and its button opens Microsoft's download page. Before, the app just closed.

## Report Bug… shows what it sends

The issue is pre-filled through the issue form's query parameters (`template=bug_report.yml` and the field ids `version`, `os`, `desktop`, `webview`), with a `body` that says the same for a repo without the form. The facts come from `diagnostics::report()`: the version, OS name and version, arch, `XDG_CURRENT_DESKTOP` and session type, and the WebKitGTK or WebView2 version, which WebDriver can't report (it gives wry's). The display scale goes in the desktop field, as the form asks. No paths, user, host or kernel string; a cargo test checks the report for `HOME`, `USER` and the host name. The user sees exactly those lines in a confirm dialog before the browser opens.
