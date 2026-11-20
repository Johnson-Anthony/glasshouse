# e2e-smoke (task 32)

This is the first end-to-end test of the running app, on Linux and Windows. It drives the real window through `tauri-driver` and the platform's WebDriver, using a small W3C client of our own. It also adds a CI workflow, which will be the first time the app opens on Windows. Scope: survey-3.md §32.

## Status
Done 2026-11-20. Flow 1 passes on Linux here. The Windows leg and both CI legs are written but have never run: the first run is the lead's after the merge.

| Step | State |
|---|---|
| Plan, decision (`docs/decisions/2026-11-20-e2e-smoke-design.md`) | done |
| `e2e/webdriver.mjs`: W3C client (fetch, a deadline per request) | done |
| `e2e/harness.mjs`: scratch env, private session bus, fixture, tauri-driver start/stop, artifacts | done |
| `e2e/smoke.test.mjs`: flow 1 (5 tests) | done, green on Linux |
| `e2e/edgedriver.ps1` (msedgedriver ↔ WebView2 Runtime), `e2e/windows-desktop.ps1` (desktop shot, `query user`, screens) | done; parsed with pwsh 7.7, version helpers exercised, never run on Windows |
| `.github/workflows/e2e.yml` | done; actionlint 1.7.12 + shellcheck clean, never run |
| `pnpm e2e`, docs (ARCHITECTURE "End-to-end tests", CLAUDE.md command) | done |
| Local green run on Linux (Xvfb, MemoryMax=2G, nothing left running) | done |
| Checks | done |

### Results
- `pnpm e2e` (Xvfb, private bus, debug build): 5/5 pass in about 3 s; the window renders in about 1 s. The screenshots and the desktop shot show the real UI with the fixture listed. A process diff before and after found nothing left running.
- Found by the first run: with the standard session-bus config, the app's start activated xdg-desktop-portal, which pulled gvfs, a11y and keyring services in the user's real runtime dir and held the window for 25 s. Fixed with a restricted bus config (decision doc).
- The app's stderr reaches `driver-and-app.log` (checked with a wrapper that printed HOME and the bus address: scratch HOME, private bus).
- `pnpm build`, `pnpm test` (901 passed, 2 skipped), `pnpm check:wiring` (0/0/0), `pnpm notices --check`: pass. `actionlint` (all workflows): clean. No Rust and no lockfile changes.
- Installed (approved through the lead), and recorded in `~/.claude/environment.md`: `webkit2gtk-driver` (apt), tauri-driver 2.1.0 (`cargo install`), PowerShell 7.7.0 and actionlint 1.7.12 (official release tarballs, checksums checked). All eight `.ps1` files in the repo parse.

## Design
- **Driver chain.** The test talks W3C WebDriver to `tauri-driver` 2.1.0, which rewrites `tauri:options.application` into the native driver's capabilities and proxies the rest. On Linux that's WebKitWebDriver (apt `webkit2gtk-driver`); on Windows, msedgedriver. The app needs no changes: tauri-driver sets `TAURI_WEBVIEW_AUTOMATION=true` for the native driver and the app it launches, and tauri-runtime-wry reads it to allow automation on the first web context.
- **Client.** `e2e/webdriver.mjs` uses `fetch` with `AbortSignal.timeout` on every request and has no dependencies, like `site/capture/capture.mjs`'s CDP client. It covers only the commands the suite needs: new/delete session, execute script, find, click, send keys, actions, screenshot, and (Windows, best effort) the browser log.
- **Isolation (Linux).** The harness builds a minimal environment: a scratch HOME, XDG config/data/cache/state/runtime dirs with `user-dirs.dirs` and the known folders, `GDK_BACKEND=x11` with no `WAYLAND_DISPLAY` (so a local run never opens on the user's Wayland desktop), `NO_AT_BRIDGE=1`, `WEBKIT_DISABLE_DMABUF_RENDERER=1`. `pnpm e2e` wraps the run in `xvfb-run` for its own display. The harness starts tauri-driver under `dbus-run-session` with a config of its own, so the run gets its own session bus, on which no system service can be started on demand. tauri-driver runs in its own process group, which is killed at the end, so the native driver and the app go with it.
- **Windows.** This leg uses the runner's real profile: Windows has no HOME redirect for known folders. `e2e/edgedriver.ps1` reads the WebView2 Runtime's `pv`, compares it with `$EDGEWEBDRIVER\msedgedriver.exe` on the first three version parts, and downloads the matching driver from `msedgedriver.microsoft.com` when they differ (Authenticode-checked). It then sets `E2E_NATIVE_DRIVER`.
- **Flow 1.**
  - The window renders: the titlebar, sidebar, pane and status bar are present, and the first listing has finished.
  - There's no startup notice (a launch-arguments toast, a pane error, an open dialog).
  - Ctrl+L, a typed fixture path and Enter list exactly the fixture's entries, and the breadcrumb ends at the fixture folder.
  - The sidebar's DEVICES group lists a drive (`/` or `C:\`), and the tree shows home with Documents and Downloads.
  - No uncaught errors: `error` and `unhandledrejection` listeners are installed at session start. On Windows, the browser log (`ms:loggingPrefs`) also catches what happened before that.
- **Artifacts, always** (`e2e/artifacts/`): a webview screenshot after each test, a full-desktop screenshot taken while the app is open (`import -window root` on Xvfb; CopyFromScreen on Windows), the driver and app output, session capabilities (versions), the errors and console errors seen, and on Windows `query user`, the screens and the app's process session and window rect.
- **CI.** `e2e.yml` runs on pushes to main and `workflow_dispatch`, and isn't a required check. The legs are ubuntu-22.04 (Xvfb 1920x1080x24) and windows-latest. Both do `pnpm tauri build --debug --no-bundle` and `cargo install tauri-driver --version 2.1.0 --locked`, with `timeout-minutes: 25`, a 10-minute cap on the test step so the artifacts still upload, and a 120 s deadline on session creation.
- **Cache.** Windows reuses the `installers` job's rust-cache entry: `shared-key: installers` gives the same key, since both run the same debug `tauri build`. That leg never saves. Linux gets one `e2e` key, saved only on main.

## Not in scope
- Flows 2–8 (task 44), the nightly matrix (task 45), installed-package smoke (task 46).
