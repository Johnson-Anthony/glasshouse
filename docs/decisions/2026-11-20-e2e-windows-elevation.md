# e2e-windows: the Windows leg runs the app without admin rights (2026-11-20)

The e2e workflow's first run on main (run 44721411336, `50e1454`) failed every Windows test with `POST /session: session not created: DevToolsActivePort file doesn't exist`, after msedgedriver's 60 s wait. The driver matched the WebView2 Runtime (both 156.0.4314.58).

## What the diagnostics showed
Two rounds of a diagnostic step on the Windows leg (`e2e/windows-diagnose.ps1`, in `804be70`; removed once the cause was known): runs 44723314668 and 44725404253.
- **The app is fine.** Run on its own, the debug `glasshouse.exe` stays up, opens its window ("glasshouse") and starts its WebView2 browser and five helpers. Nothing reaches its stdout or stderr. The Application log and WER have no crash records.
- **How msedgedriver attaches.** It doesn't put switches on the app's command line. It sets `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` (`--remote-debugging-port=0 --enable-automation …`), and a user data folder of its own through the environment (`scoped_dir…\EBWebView` in `%TEMP%`). Then it waits for `DevToolsActivePort` in that folder. Only `ms:edgeOptions.args` go on the app's command line, so a `--user-data-dir` there would reach `startup.rs` and show the "couldn't open" toast.
- **The runner is elevated.** Steps on windows-latest run as `runneradmin` in the Administrators role, at High integrity. UAC is on (`EnableLUA=1`, `ConsentPromptBehaviorAdmin=0`).
- **An elevated WebView2 ignores `WEBVIEW2_*` variables.** Microsoft's WebView2 security notes say so, along with HKCU overrides. HKLM policy and the app's own options still apply. The runner showed all three sides:

  | The app run… | Switch from | Browser got `--remote-debugging-port` | DevTools answered |
  |---|---|---|---|
  | elevated | HKLM `Policies\…\WebView2\AdditionalBrowserArguments` | yes | yes |
  | elevated | `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` | no | no |
  | without admin rights | `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` | yes | yes |

  msedgedriver started without admin rights got a session at once. The browser then ran on msedgedriver's own user data folder.

So the root cause was neither glasshouse nor tauri-driver. Our Windows leg ran the app elevated, which no real user does by default. Tauri's guide says the driver works with stock settings on a developer's machine, where a terminal isn't elevated. Older WebView2 Runtimes may not have ignored the variables when elevated, which would explain Tauri's CI example working on windows-latest.

## The fix: start tauri-driver without admin rights
`e2e/unelevated.ps1` runs a command as the same user with the Basic User SAFER level, the token `runas /trustlevel:0x20000` makes. The Administrators group becomes deny-only, admin privileges are dropped, and the integrity is set to Medium explicitly. The child gets the script's environment, working folder and standard handles, and the script waits for it and passes on its exit code. On Windows the harness always starts tauri-driver through it. The command line comes in an environment variable, already quoted by the harness, so PowerShell's argument parsing never touches it. msedgedriver and the app inherit the token. `taskkill /T` on the script's process still ends the whole tree.

Alternatives:
- **Read the variables in the app** when `TAURI_WEBVIEW_AUTOMATION` is set, and pass them through `additional_browser_args` and `data_directory`. Rejected: it reopens, for an elevated glasshouse, the hole Microsoft closed on purpose (`HKCU\Environment` is writable without admin rights). It's also test code in the app, which the e2e design avoids.
- **The HKLM policy key** for `glasshouse.exe`. Rejected: it can turn on remote debugging but can't point the browser at msedgedriver's per-session folder, so the session still can't find `DevToolsActivePort`. It's also a machine-wide change.
- **A scheduled task at Limited run level**, or `explorer.exe` as the launcher. Rejected: both are asynchronous, so the output and exit code are hard to get back, and both depend on how the runner is set up.

Running without admin rights also makes the test closer to how people use the app.

## Facts from the first green run (44725404253)
- Flow 1: 5/5 in about 4 s, with no page errors. msedgedriver's browser log was empty.
- The screen is 1024x768 with a 1024x720 work area. The window asks for 1400x900 and gets 1044x788 at 0,0, so it's larger than the work area. The status bar is hidden under the taskbar and the right edge of the preview column is off screen. That's an app follow-up (fit the first window to the work area), not part of this fix.
- `driver-and-app.log` stays empty on Windows. tauri-driver discards msedgedriver's stdout. The debug app printed nothing even when run on its own, so whether msedgedriver passes the app's output on is unchecked.
- The WebView2 profile (localStorage, so tabs and settings) is msedgedriver's scratch folder, new each session. The app's config folder (`%APPDATA%\sh.glasshouse.viles`: the session lock, window state, pins and tags) is the runner's real one.
