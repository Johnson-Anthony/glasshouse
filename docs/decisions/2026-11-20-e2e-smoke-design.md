# e2e-smoke: how the end-to-end test drives the app (2026-11-20)

Task 32 (survey-3.md §32). This is the first test that opens the real app, on Linux and Windows.

## tauri-driver and a client of our own
- **Driver.** `tauri-driver` 2.1.0, pinned in CI (`cargo install tauri-driver --version 2.1.0 --locked`). It's a small proxy: it turns `tauri:options.application` into WebKitWebDriver's or msedgedriver's capabilities, starts that driver with `TAURI_WEBVIEW_AUTOMATION=true`, and passes every other request through. tauri-runtime-wry reads that variable to allow automation on the first web context, so the app has no test code and no test plugin.
- **Not WebdriverIO.** Tauri's docs now recommend WebdriverIO with `@wdio/tauri-service`. Its default route puts a WebDriver server inside the app (`tauri-plugin-wdio-webdriver`), which would change the app and add a plugin to the lockfiles and notices. Its tauri-driver route still brings WebdriverIO's dependency tree. `e2e/webdriver.mjs` is about 150 lines over `fetch`, like `site/capture/capture.mjs`'s CDP client, and has what this needs: a deadline on every request, and errors that name the command.
- **Real input.** Typing goes through `sendKeys` and Perform Actions, so it's real key events through the app's own keymap (Ctrl+L, then Ctrl+A and the path in the prompt). Assertions read the DOM with `execute`.

## Windows: matching msedgedriver to the WebView2 Runtime
- **The rule.** Microsoft says the driver must match the WebView2 Runtime "in the first three parts of the version". Tauri's docs say a mismatch hangs the suite while it connects. The windows-latest image (Server 2025) ships a driver for its Edge browser in `$EDGEWEBDRIVER`. The WebView2 Runtime updates on its own, so the two can differ.
- **The script.** `e2e/edgedriver.ps1` reads the Runtime's `pv` from the EdgeUpdate client key (both registry views and HKCU, taking the newest) and compares the first three parts. If they differ, it downloads `https://msedgedriver.microsoft.com/<pv>/edgedriver_<arch>.zip`, checks the Authenticode signature is Microsoft's, and checks the version again.
- **Not msedgedriver-tool.** Tauri's CI example uses it, but it installs from a git branch (`cargo install --git`), so it's unpinned.
- **Session deadline.** New Session has a 120 s deadline. The error says what usually causes a hang there.

## Linux: a scratch session that touches nothing of the user's
- **Environment.** The app gets a minimal environment, not the developer's:
  - a scratch HOME and XDG config/data/state/cache/runtime dirs, with `user-dirs.dirs` and the four known folders;
  - `GDK_BACKEND=x11` and no `WAYLAND_DISPLAY`, so a local run can't open on the user's Wayland desktop;
  - `NO_AT_BRIDGE=1`, `WEBKIT_DISABLE_DMABUF_RENDERER=1` and `LIBGL_ALWAYS_SOFTWARE=1`. With these, WebKitGTK 2.54 draws normally under Xvfb, as the screenshots show. It also drew normally here with the DMA-BUF renderer on (`WEBKIT_DISABLE_DMABUF_RENDERER=0`), but this machine has a GPU. The setting stays as a guard for the GPU-less runner, where its effect is unchecked.
- **Bus.** The first local run used `dbus-run-session` around the whole suite with the standard session config. That bus had been started in the developer's real environment, and services started on demand inherit the bus's environment, not the caller's. The app's start activated `org.freedesktop.portal.Desktop`, which pulled in gvfs, the a11y bus, xdg-desktop-portal-gtk and a keyring lookup, all seeing the real `/run/user/1000`. The portal then waited 25 s on `org.freedesktop.secrets`, which held the window for 26 s.
- **The fix.** The harness now starts tauri-driver under `dbus-run-session --config-file=<scratch>/session-bus.conf`. That config's only service folder is the scratch home's `dbus-1/services`, empty unless a test adds a service (as tasks 31 and 44 may). A name nothing provides now fails at once. The window renders in about 1 s, and the suite takes about 3 s.
- **Cleanup.** tauri-driver runs in its own process group, which the harness ends with SIGTERM and then SIGKILL, so the bus, WebKitWebDriver and the app go with it. A check of processes before and after the run found nothing left.

## What "no uncaught errors" covers
- `error` and `unhandledrejection` listeners go in as soon as the session can run scripts, and the last test asserts none fired. `console.error` calls are recorded in `page-errors.json` but don't fail the run.
- WebDriver Classic can't run a script before the page's own scripts, so an error during the first load is caught only by its visible effects (the shell and first listing must render).
- On Windows, the session also asks for `ms:loggingPrefs` and reads the browser log, which covers the first load too. If msedgedriver refuses that capability, the session is retried without it and the refusal goes in `notes.txt`. On Linux, WebKitWebDriver has no log endpoint.

## Notices the test treats as failures
A window started with arguments it can't use shows a "couldn't open …" toast (`launch.ts`). If a driver ever passed its own switches on the app's command line, the second test would fail and quote the toast. The docs say msedgedriver passes only `ms:edgeOptions.args` (none here) to a WebView2 app's argv, and WebKitWebDriver passes only `webkitgtk:browserOptions.args`. Linux has been checked. Windows is unverified until CI runs.

## CI cache
The repo's Actions cache is over its 10 GB limit, so this workflow adds at most one entry:
- **Windows:** rust-cache's key is `v0-rust-<shared-key or job id>-<OS>-<arch>-<env hash>-<lockfile hash>`, so `shared-key: installers` gives exactly the key of ci.yml's `installers` job. That job makes the same debug `tauri build`. This leg only reads (`save-if: false`), and tauri-driver is built each run (about 1–2 min).
- **Linux:** one `e2e` key, saved only from main. The cached `~/.cargo/bin` keeps tauri-driver, so `cargo install` is a no-op after the first run.

## Known limits and dates
- **Debug build.** On Windows the debug exe is a console program, so its child processes behave differently from a release build's. Task 45 adds the release binary.
- **The windows-latest D: drive becomes ReFS from 2026-11-30** (actions/runner-images#15315). The checkout and the build are on D:. The fixture is in `%TEMP%` on C:, so flow 1 lists NTFS either way.
- **ubuntu-22.04 is deprecated.** It retires on 2027-04-17, with brownouts on four days before that (runner-images#14254). release.yml builds the Linux packages there too, so both move together (task 45).
