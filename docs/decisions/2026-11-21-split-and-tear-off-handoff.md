# split-and-tear-off: a second launch hands its window to the running app

Date: 2026-11-21. Task: `split-and-tear-off` (survey-3 task 50, phase 2). Code: `src-tauri/src/handoff.rs`, `handoff/dbus.rs` (Linux), `handoff/pipe.rs` (Windows), `app_windows::handed_off`, and `resident.rs`'s FileManager1.

## Context
With every window in one process (`2026-11-21-split-and-tear-off-one-process.md`), a second launch (the launcher, a taskbar's New Window, "Show in folder" from another app) should open a window in the app that's running and then exit, as a browser does. Before, it started a process of its own, which restored nothing, and only its windows' events reached it.

The new window should also take the focus. On Linux a launcher gives the process a startup ID (X11's `DESKTOP_STARTUP_ID`, Wayland's `XDG_ACTIVATION_TOKEN`), and the compositor gives the focus to the window that shows it; a window that opens without it is left behind the one in front, or only flashes. So the ID has to go with the request. On Windows only a process the foreground one allows can take the foreground.

## Options
- **tauri-plugin-single-instance.** It sends the second process's arguments and working folder to a callback. It can't carry the startup ID (GTK has read and unset it by the time the callback could, and there's no field for it), and on Linux it unwraps the session bus connection, so a desktop with no session bus (a bare X session, some containers) would abort the app at start. On Windows it does no user check of its own.
- **Our own handoff.** The lead picked it (11-21): D-Bus on Linux, a named pipe on Windows, each a few hundred lines with no new dependency (zbus and the windows crate were already in).

## Chosen
- **Linux:** the running app owns `io.github.johnson_anthony.glasshouse.App` on the session bus, with `Open(mode, paths, skipped, startup_id)` and `NewWindow(startup_id)` on `/io/github/johnson_anthony/glasshouse/App`, interface `…glasshouse.App1`, and a `Version` property. The session bus is per user, so only the user's own programs can call it.
- **Windows:** a named pipe per user and logon session, `\\.\pipe\io.github.johnson-anthony.glasshouse.App-<user SID>-<session id>`.
  - The app makes the first instance with `FILE_FLAG_FIRST_PIPE_INSTANCE`, so a program that made the pipe first is noticed rather than quietly served, and with `PIPE_REJECT_REMOTE_CLIENTS`.
  - A launch opens it with `SECURITY_IDENTIFICATION`, so the app can't act as the launch, and it checks that the server process runs as the same user (`GetNamedPipeServerProcessId`, its token's user SID). The app checks the client the same way. A pipe someone else serves is never written to.
  - The launch calls `AllowSetForegroundWindow` for the app, then writes one line of JSON (`{"version":1,"launch":…}`). The app answers one byte, `1` taken and `0` not.
- **Debug builds use other names** (`…glasshouse.AppDebug`, and the pipe's `AppDebug`), so `tauri dev` and the end-to-end tests never hand a window to the user's installed glasshouse, nor take one from it. The e2e harness also runs the app on a private D-Bus session of its own (task 32), so even a debug build the user runs alongside isn't reached.
- **What's sent** is checked by the app as anything from another process is: absolute paths or URIs only (the launch resolved its own relative ones), at most 256 paths, each under 32 KiB, a startup ID under 512 bytes with no control characters (anything else is dropped, and the window asks for the focus the usual way). A request that fails these gets an error, and the launch starts on its own.
- **What a plain launch opens:** a new window at home. In a guest process (one started with paths, which restored nothing) it's the saved session instead, and the guest becomes the session's owner (`2026-11-21-split-and-tear-off-session.md`).

## Never worse than before
Every way the handoff can fail leaves the launch running on its own, as it did before phase 2, with a warning in the log (target `handoff`) once the log is up. It never aborts.
- No session bus, or one that won't connect: "no session bus (…): this window runs on its own, and a second launch opens a process of its own".
- The name can't be claimed, or the pipe can't be made or named: the same, with the error.
- The running app doesn't answer within **1.5 s** (`ANSWER_WITHIN`, the D-Bus method timeout and the pipe client's wait): "the running glasshouse didn't take the window (…)". A hung app holds a launch up for that long and no longer. Checked under Xvfb with a stopped (SIGSTOP) app: the launch started on its own after about 1.66 s.
- The app is quitting: it releases the name, and its inbox refuses requests, so an update's restart starts on its own.
- The owner ended between the claim and the call: claimed again, once.

Inside the app a request is taken only when the main thread has picked it up within **800 ms** (`MAIN_THREAD_WITHIN`, under the launch's 1.5 s so the launch hears the answer); an app whose main thread is stuck says no rather than taking a window it can't make. Requests that arrive while the app is still starting wait (32 at most) and open once it's ready.

## The resident
`--dbus` (the FileManager1 service that "Show in folder" from other apps calls) asks the running app first, through the same name. Only when no app takes it does it start a window process, as before.

## `--chooser`
The file chooser (`--chooser`, the portal backend's dialog) stays a process per dialog: it never claims the name and never hands off, and it saves no session.

## Not done, and known edge cases
- If the running app takes a request after the launch has given up waiting (an app that was slow, not hung), the launch also opens its own window: two windows for one launch. Rare, and better than none.
- macOS and other Unixes run on their own, as before (no handoff).
- The Windows side is type-checked here through a scratch crate (clippy, `-D warnings`), but the windows-latest CI job is its first real build, and the handoff's focus on Windows is a hand check (docs/testing).
