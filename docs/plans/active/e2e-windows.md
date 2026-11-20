# e2e-windows (follow-up to task 32)

The e2e workflow's first run on main (run 44721411336, `50e1454`) passed on ubuntu-22.04 and failed on windows-latest: every test failed with `POST /session: session not created: DevToolsActivePort file doesn't exist`, after msedgedriver's 60 s wait. The driver matched the WebView2 Runtime (both 156.0.4314.58). `driver-and-app.log` was empty, and after the failure only msedgedriver and tauri-driver were running. No glasshouse window has been seen on Windows yet.

## Status
| Step | State |
|---|---|
| Plan | done |
| Diagnostics on the Windows leg (`e2e/windows-diagnose.ps1`) | in progress |
| Root cause | |
| Fix (app or harness), with a regression test where possible | |
| Windows and Linux legs green on the branch | |
| Decision doc, docs, checks, handoff | |

## Plan
1. **Diagnose on CI**, in one batch, from a step before the smoke test (`continue-on-error`, its own artifact):
   - run the debug exe on its own for about 15 s with stdout and stderr captured, then report whether it's alive, its exit code, its main window's title and rect, and its msedgewebview2 children with their command lines, plus a desktop screenshot;
   - the same with `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=…`: does DevTools answer, and where does `DevToolsActivePort` appear;
   - msedgedriver on its own, with `--verbose --log-path`, sent the capabilities tauri-driver makes (`browserName: webview2`, `ms:edgeChromium`, `ms:edgeOptions.binary`), with process snapshots while it waits;
   - crash records (Application log ids 1000, 1001, 1026) and WER reports, the WebView2 and Edge policy keys, and `WEBVIEW2_*` variables.
2. **Root cause and fix**: in the app if it crashes or never makes its webview (with a regression test where one can catch it), or in the harness or workflow if it's the driver setup. Compare with Tauri's WebDriver docs and its CI page.
3. **Green**: the Windows leg passes flow 1's five tests; its webview screenshot goes in the report. Trim the diagnostics to what's worth keeping.

Branch runs: `gh workflow run e2e.yml --ref <branch>` (approved by the lead for this task only); delete the remote branch afterwards.
