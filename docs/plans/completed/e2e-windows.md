# e2e-windows (follow-up to task 32)

The e2e workflow's first run on main (run 44721411336, `50e1454`) passed on ubuntu-22.04 and failed on windows-latest: every test failed with `POST /session: session not created: DevToolsActivePort file doesn't exist`, after msedgedriver's 60 s wait. The driver matched the WebView2 Runtime (both 156.0.4314.58). `driver-and-app.log` was empty, and after the failure only msedgedriver and tauri-driver were running. No glasshouse window has been seen on Windows yet.

## Status
Done 2026-11-20. Root cause: GitHub's Windows runners run steps elevated, and an elevated WebView2 app ignores the `WEBVIEW2_*` environment variables, which is how msedgedriver turns on remote debugging and picks the user data folder. The app wasn't at fault for the session failure. Fix: the harness starts tauri-driver through `e2e/unelevated.ps1` (Basic User SAFER token, medium integrity). The first green Windows runs then showed an app bug: the CSP blocked Tauri's IPC on Windows (`https://` where Windows serves `http://ipc.localhost`). That's fixed with a regression test. Decision: `docs/decisions/2026-11-20-e2e-windows-elevation.md`.

| Step | State |
|---|---|
| Plan | done |
| Diagnostics on the Windows leg (`e2e/windows-diagnose.ps1`, `804be70`): runs 44723314668, 44725404253 | done, then removed |
| Root cause: elevation (the HKLM policy switch is honored elevated; the env switch is ignored elevated and honored unelevated) | done |
| Fix in the harness (`e2e/unelevated.ps1`, `startDriver`) | done |
| Listener race (msedgedriver attaching at `about:blank`) and the browser log read once; the check fails on CSP violations | done |
| CSP fix (`http://ipc.localhost`) with `src/offline.test.ts` | done |
| Windows and Linux legs green on the branch | done: 44725404253 (with the diagnostics) and 44729226342 (final code, `fa84540`) |
| Decision doc, ARCHITECTURE, smoke test hint, checks | done |

### Results
- Windows, flow 1: 5/5, no page errors, no startup notice, and an empty browser log on the final code. The first test, from launch to the first listing, took 18.6 s on a cold runner, 13.4 s on another, and 2.4 s once the diagnostics had warmed the machine. The webview screenshots are the first pictures of glasshouse running on Windows. They're kept in this worktree's `e2e/artifacts/windows-run-44729226342/` (git-ignored) and in the run's `e2e-windows-latest` artifact.
- Found along the way, for follow-up tasks (not fixed here):
  - At 1024x768 (work area 1024x720) the window asks for 1400x900 and gets 1044x788 at 0,0. The status bar is under the taskbar and the right edge of the preview column is off screen. The first window should fit the monitor's work area.
  - The cold start of 13–19 s to the first listing is unexplained. It may be Defender's first scan of the 37 MB debug exe plus a new WebView2 profile. Task 45's release-binary run would show whether users see it.
  - `driver-and-app.log` is empty on Windows: tauri-driver discards msedgedriver's stdout, and the debug app prints nothing.
  - The seeded tags include "school" (already noted for task 40).
- Checks: `pnpm build`, `pnpm test` (902 passed, 2 skipped), `pnpm check:wiring` (0/0/0/0), `pnpm notices --check`, `actionlint` (all workflows): pass. No Rust code and no lockfile changes. The `tauri.conf.json` change compiled in both CI legs. All `.ps1` files parse with pwsh 7.7.

## Plan
1. **Diagnose on CI**, in one batch, from a step before the smoke test (`continue-on-error`, its own artifact):
   - run the debug exe on its own for about 15 s with stdout and stderr captured, then report whether it's alive, its exit code, its main window's title and rect, and its msedgewebview2 children with their command lines, plus a desktop screenshot;
   - the same with `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=…`: does DevTools answer, and where does `DevToolsActivePort` appear;
   - msedgedriver on its own, with `--verbose --log-path`, sent the capabilities tauri-driver makes (`browserName: webview2`, `ms:edgeChromium`, `ms:edgeOptions.binary`), with process snapshots while it waits;
   - crash records (Application log ids 1000, 1001, 1026) and WER reports, the WebView2 and Edge policy keys, and `WEBVIEW2_*` variables.
2. **Root cause and fix**: in the app if it crashes or never makes its webview (with a regression test where one can catch it), or in the harness or workflow if it's the driver setup. Compare with Tauri's WebDriver docs and its CI page.
3. **Green**: the Windows leg passes flow 1's five tests; its webview screenshot goes in the report. Trim the diagnostics to what's worth keeping.

Branch runs: `gh workflow run e2e.yml --ref <branch>` (approved by the lead for this task only); delete the remote branch afterwards.
