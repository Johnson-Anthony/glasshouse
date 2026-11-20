# Third survey: consumer readiness (2026-11-20)

The user wants glasshouse to be a production app for anyone, not a tool tuned to the one machine it's built on (arm64 Debian 13, niri, WebKitGTK 4.1). On Windows, CI compiles it and runs the Rust unit tests, but no window has ever opened there. Three read-only agents surveyed it on 2026-11-20:
- assumptions tied to the platform, desktop, filesystem or locale (18 findings);
- consumer readiness, from install to uninstall (14 findings);
- what end-to-end testing on Windows and other Linux desktops would take.

Nothing here repeats `survey-2.md` or its tasks 30–31 (folder handler, file chooser), which stay in that file. File references are as of `07e7f03`. The agents read code but ran nothing; claims about Windows behavior are unverified until task 32's CI job runs.

The scan for the user's own paths and names found none in app code. The gaps are tools, environment, filesystems, defaults and polish.

## Status
| # | Task | Area | Size | Status |
|---|---|---|---|---|
| **Wave 7a: see it run, and make failures reportable** |||||
| 32 | e2e-smoke | CI + test code | S–M | merged (`gifted-bun-817ccd`, 11-20) |
| 33 | diagnostics-and-errors | both | M | queued |
| 34 | windows-paths | Rust + a little frontend | M | queued |
| 35 | release-identity | Rust + config + CI | M | merged 11-20 (`claude/stoic-hermann-165fd0`; Tauri rejects `_`, so the id is `io.github.johnson-anthony.glasshouse`, with `johnson_anthony` only in D-Bus interface names and paths; `docs/decisions/2026-11-20-release-identity-id-form.md`) |
| **Wave 7b: works like other file managers** |||||
| 36 | os-clipboard | both | M–L | queued |
| 37 | linux-launch-env | Rust + CI | M | queued (coordinate with task 30's activation token) |
| 38 | a11y | frontend | M–L | queued |
| 39 | locale-and-names | frontend (+ a little Rust) | S–M | queued |
| 40 | first-run-defaults | frontend | S–M | merged 11-20 (`claude/nice-ishizaka-1d4fec`; plan in `docs/plans/completed/first-run-defaults.md`) |
| 47 | themes-and-cosmetics | frontend | L | merged 11-20 (`claude/elegant-euler-fb95a5`; plan in `docs/plans/completed/themes-and-cosmetics.md`) |
| 48 | updater | both + CI | M | queued (after 35; D2) |
| **Wave 7c: devices, transfers, docs** |||||
| 41 | devices | both | M–L | queued |
| 42 | transfers-and-cloud | both | M | queued (tell task 25 folder-size about the cloud flag) |
| 43 | docs-and-community | docs + repo files | S–M | queued |
| **Wave 7d: more testing** |||||
| 44 | e2e-core-flows | test code | M | after 32 |
| 45 | e2e-nightly-matrix | CI | S–M | after 32 |
| 46 | release-smoke | CI + docs | M | after 32 and task 30 |
| 49 | appimage-menu-entry | both | M | queued (split from 35 on 11-20) |

Run at most two Rust tasks at once (RAM). Tasks 33, 34, 36 and 37 all touch `src-tauri/src/commands/`, so keep diffs narrow.

## Owner decisions
- **D1. Windows code signing.** *Decided 11-20: skip for now.* The README explains the SmartScreen warning (task 43). Unsigned installers trip SmartScreen, and the MSI's UAC prompt says "Unknown publisher". Options:
  - SignPath Foundation: free for open source, needs an application.
  - Azure Artifact Signing: paid; sign-up for individuals is limited to some countries (unverified).
  - A standard OV certificate.
- **D2. Updates.** *Decided 11-20: add it* (task 48), off until the user turns it on; Check for Updates is a manual check. There's no updater, and `release.yml:134` has `includeUpdaterJson: false`. Check for Updates only opens the Releases page (`handlers/misc.ts:243-247`). Adding `tauri-plugin-updater` (with a free minisign key) means the app's first network call. Choose between opt-in, ask on first run, or none.
- **D3. App identity.** *Decided 11-20: fix it now, while the owner is the only user* (task 35). New identifier `io.github.johnson_anthony.glasshouse`: the user's GitHub Pages domain reversed, with `_` for the hyphen, because D-Bus interface names can't contain `-`. The name is lowercase "glasshouse" everywhere, with a migration of the old data.
  - **Identifier:** `sh.glasshouse.viles` is left over from the scaffold (`8abaa0c`). Changing it later abandons everyone's settings, tags and pins unless the data is migrated.
  - **Name:** the product is called "glasshouse" in tauri.conf.json but "Glasshouse" in About. Pick one.
  - **Pin the MSI upgrade code now** whatever is chosen (task 35). Tauri derives it from the name, so a rename means duplicate installs.
- **D4. Look and defaults.** *Decided 11-20: one agent expands the themes and cosmetic options massively* (task 47). The remaining defaults are task 40.
  - Add a light theme and make "System" the default (today every theme is dark, and the default is gruvbox-dark in a monospace Nerd Font).
  - Windows-style window controls on the right, which also brings Snap Layouts, or keep the macOS-style dots.
  - How lean the status bar is by default.
- **D5. Translation.** *Decided 11-20: skip.* Labels route commands (ARCHITECTURE.md), so translating needs stable command IDs plus a string table: an L task. Is it a goal?
- **D6. macOS** *Decided 11-20: skip; not a goal for now.* (already an open question in the SPEC). Cheap fixes exist, but are they wanted?
- **D7. Repo settings.** *Done 11-20: private vulnerability reporting is on.* Dependabot alerts are still open. Private vulnerability reporting, plus the Dependabot alerts that are still open.

## 32. e2e-smoke (CI + test code, S–M)
The first look at the real app on Windows. Use Tauri's `tauri-driver` 2.1.0 (pin it; it needs Rust 1.90+) with a small W3C WebDriver client of our own in `e2e/` (`node:test`, no new dependencies, like `capture.mjs`'s CDP client). It drives WebKitWebDriver on Linux and msedgedriver on Windows. The app needs no changes: `tauri-driver` sets `TAURI_WEBVIEW_AUTOMATION=true`, which wry reads at runtime.
- **The job:** `e2e.yml`, run on pushes to main and `workflow_dispatch`, not blocking at first. It doesn't run on PRs from task branches; the lead watches the first runs after the merge.
  - **Linux:** `ubuntu-22.04` with `webkit2gtk-driver`, under `xvfb-run -s "-screen 0 1920x1080x24"`, with a scratch HOME and XDG dirs.
  - **Windows:** `windows-latest`. Run `tauri-driver --native-driver "$env:EDGEWEBDRIVER\msedgedriver.exe"`, but first compare that driver's version with the WebView2 runtime's (registry `pv`); a mismatch hangs the suite.
  - **Build:** `pnpm tauri build --debug --no-bundle`.
  - **Limits:** `timeout-minutes: 25` and a deadline on session creation.
- **Flow 1:** the window renders with no uncaught errors, a fixture folder lists, and the sidebar shows drives and known folders.
- **Artifacts, always:** a webview screenshot, a full-desktop screenshot, the app's stderr, and on Windows `query user` and the screen resolution.
- **Locally:** it needs `webkit2gtk-driver` (apt) and `tauri-driver` (`cargo install`). Both are installs the user approves. Xvfb is already installed.
- **Watch for:**
  - the windows-latest D: drive turning ReFS on 2026-11-30;
  - the repo's Actions cache, already 11.75 GB against the 10 GB limit (`save-if: main`, one shared key per OS);
  - WebKitGTK drawing blank without a GPU (`WEBKIT_DISABLE_DMABUF_RENDERER=1`; unverified).
- Refs: https://v2.tauri.app/develop/tests/webdriver/ and its `ci/` page.

## 33. diagnostics-and-errors (both, M)
- **Silent failures:**
  - `src/main.tsx:7-11` has no error boundary, so one render exception blanks the window.
  - `Cargo.toml:102` sets `panic = "abort"` with no panic hook.
  - On Windows, `windows_subsystem = "windows"` sends stderr nowhere. All backend logging is 13 `eprintln!` calls.
  - `lib.rs:120` ends startup with `.expect(…)`, so a missing WebView2 just closes the app.
- **Add:**
  - an error boundary with Reload and Open Log Folder;
  - `tauri-plugin-log` writing to the app's log folder (a lockfile change, so run `pnpm notices`);
  - a panic hook that logs before the abort;
  - a native message box when startup fails;
  - Help → Open Log Folder.
- **Developer-style errors:**
  - Function-name prefixes: `read_dir({}): {}` (`listing.rs:71`, shown as is at `components.tsx:980`), `move_to_trash(` (`fs_ops.rs:591`), `set_permissions(` (`:787`) and `openpty:` (`pty.rs:148`).
  - 52 bare `map_err(|e| e.to_string())`, and 28 alerts that show the raw error.
  - An alert titled "error" (`App.tsx:907-910`) and a `— not yet wired` toast (`:902`).
  - "…not found on PATH (tried 7z, 7zz…)" (`launch.rs:302`).
- **Fix:** a structured backend error (kind, path, detail), shown as a plain sentence with the raw detail under "Show details".
- **Report Bug…** opens a blank issue (`misc.ts:250`). Pre-fill the version, OS and desktop.

## 34. windows-paths (Rust + a little frontend, M)
- **Listings return canonical paths.** `listing.rs:69` runs every path through `dunce::canonicalize`, and `paths.ts` has no `\\?\` handling.
  - On Windows, a mapped `Z:` drive turns into `\\?\UNC\server\share\…` (breadcrumbs show `?` and `UNC`, and tags, pins and recents get keyed differently), and subst drives and junctions jump to their targets.
  - On Linux, Fedora Atomic's `/home` → `/var/home` makes child folders open as `/var/home/…`, and the tree stops following (`Sidebar.tsx:330`).
  - Fix: build entry paths from the requested path, canonicalize only for the git lookup, and add a frontend guard that strips `\\?\`.
- **Long paths:** plain wide strings go to `MoveFileExW` (`fs_ops.rs:109`), `CopyFileW` (`:390`) and `ReplaceFileW` (`replace.rs:505`), and there's no `longPathAware` manifest. Add a `to_verbatim()` helper for every raw Win32 call, plus a custom manifest (`longPathAware`, `supportedOS`) through `WindowsAttributes::app_manifest`.
- **Name rules:** `names.ts:42-44` refuses only `/` and `\`.
  - On Windows: `a:b` creates an alternate data stream, `notes.` loses its dot, and CON or NUL give cryptic errors.
  - Fix: per-platform rules in `nameProblem` and Bulk Rename. On Linux, also apply them for FAT, exFAT and SMB targets, using `path_fs_type`.
- **Tool lookup and defaults:**
  - 7-Zip is found on PATH only (`archive.rs:354-359`), and its installer doesn't add itself there. Also check `HKLM\SOFTWARE\7-Zip` → `Path` and `%ProgramFiles%\7-Zip`.
  - The default shell probes bash.exe first (`profiles.rs:155-161`), which is WSL's launcher. Put PowerShell first and offer cmd.
  - Dotfiles are hidden on Windows (`listing.rs:153`); show them, as Explorer does.
  - `explorer /select,` (`launch.rs:39`) breaks on commas. Use SHOpenFolderAndSelectItems.
- **Tests:** tool-dependent Rust tests return early and pass (`archive_tests.rs:47-48`, `:91-92`; `git_tests.rs:162`); make them fail on CI when the tool is missing. Add Windows tests for verbatim and UNC listing paths, long-path rename and copy, and reserved names.

## 35. release-identity (config + CI, S–M; coordinate with task 30's bundle edits)
- **Pin the MSI upgrade code** now (`tauri inspect wix-upgrade-code`).
- **Fill in the bundle metadata** (`tauri.conf.json:31-44`): publisher, copyright, homepage, category, short description and the NSIS `installMode`.
- **The two Windows installers:** the README should recommend the setup.exe (per user) to consumers and label the MSI (per machine) for IT.
- **NSIS leaves its install-folder key behind:** a silent NSIS uninstall without "Delete application data" keeps `HKCU\Software\glasshouse\glasshouse`. Tauri's MSI then reads that key for its own INSTALLDIR (main.wxs `PrevInstallDirNoName`), so someone who switches from the setup.exe to the MSI gets a per-machine install in `%LOCALAPPDATA%` (seen in CI's installers job on 11-20; clearing the key fixed the MSI round in 3d70a30). Decide whether the NSIS uninstaller should always clear that key (an uninstaller hook) and list what each uninstaller leaves.
- **Linux packaging:**
  - With no `category`, the desktop entry gets an empty `Categories=` (unverified).
  - The .deb should Recommend `git`, `7zip` and `xdg-utils`.
  - The AppImage has no desktop integration or update information.
- **Release assets:** add a SHA256SUMS file and `actions/attest-build-provenance`, and a Windows ARM64 build (`windows-11-arm` runners are free for public repos).
- **User data in three places:** remotes are in `~/.glasshouse/remotes.json` (`App.tsx:526,549`), pins and tags in the config folder, and settings and tabs in localStorage. Move remotes into the config folder, with migration.
- **Unused plugins:** `lib.rs:28-30` registers the fs, os and shell plugins, and `capabilities/default.json:19-22` grants them, but the frontend uses only the dialog plugin. Drop them, then run `pnpm notices`.
- **The identity change (D3):**
  - **Rename:** `identifier` becomes `io.github.johnson_anthony.glasshouse` everywhere it's used: tauri.conf.json, `APP_ID` in `commands/integration_xdg.rs`, `CONTROL_IFACE` and the `#[zbus::interface]` name in `resident.rs`, and anything task 31 adds, plus docs/INTEGRATION.md and ARCHITECTURE.md. Keep the product name lowercase "glasshouse" everywhere, About included.
  - **Publisher:** set `publisher` explicitly (the LICENSE holder, Anthony Johnson), because Tauri otherwise takes the identifier's second part ("github") as the manufacturer. Update `scripts/installers-check.ps1`'s `HKCU:\Software\<manufacturer>\<product>` path to match.
  - **Migration:** on first start, if the new config and data folders don't exist but the old `sh.glasshouse.viles` ones do, move or copy them. That covers pins, tags, recents, window state, `integration.json`, and the webview's localStorage (settings, tabs; on Linux under `~/.local/share/<identifier>`, on Windows under EBWebView in `%LOCALAPPDATA%\<identifier>`). Unit-test it on scratch folders. The owner's own session runs the integration from the old binary path, so `glasshouse --integration-off` then `--integration-on` after the switch (the lead does this).
  - **Upgrade code:** pin the MSI upgrade code to the one the current name derives, so existing MSI installs upgrade in place.

## 36. os-clipboard (both, M–L)
Copy in glasshouse then Paste in Explorer, Nautilus, Dolphin, a mail or chat app does nothing, nor does the reverse, nor does it work between two glasshouse windows (one process each). The clipboard lives only in the app (`commandState.ts:26`), and Copy Path just logs when the webview refuses the write (`handlers/tools.ts:35-44`).
- **Write the native formats:**
  - Windows: CF_HDROP plus Preferred DropEffect.
  - Linux: `text/uri-list`, `x-special/gnome-copied-files` (GNOME, Caja, Nemo, Thunar) and `application/x-kde-cutselection`, through gtk.
- **On Paste,** read the same formats, so files copied in other apps paste in glasshouse.
- **Copy Path** uses the native clipboard too.

## 37. linux-launch-env (Rust + CI, M)
- **The AppImage forces X11 and leaks its environment.**
  - Tauri's linuxdeploy-plugin-gtk hook exports `GDK_BACKEND=x11`. It also sets `GTK_THEME`, `GTK_PATH`, `GTK_EXE_PREFIX`, `GTK_IM_MODULE_FILE`, `GDK_PIXBUF_MODULE_FILE`, `GIO_EXTRA_MODULES` and `GSETTINGS_SCHEMA_DIR`, and prepends `$APPDIR` to `XDG_DATA_DIRS`.
  - Every child inherits them: Open With apps, xdg-open, terminals, git, the drawer's shells.
  - Fix: patch the hook in `release.yml` (Tauri's documented cached-script workaround), plus one `child_env()` used by every spawn and by the pty, which drops these variables when `$APPIMAGE` is set.
- **Terminal detection misses current defaults.** The probe list (`launch.rs:115-125`) has no ptyxis (Fedora 41+, Ubuntu 25.10+), kgx, xdg-terminal-exec, mate-terminal, qterminal, lxterminal, tilix or cosmic-term. A `$TERMINAL` with arguments is skipped silently.
  - Fix, in order: xdg-terminal-exec, then `$TERMINAL` split into words, then a default for `XDG_CURRENT_DESKTOP`, then x-terminal-emulator, then the rest. Add a Preferences choice.
- **The embedded terminal has no TERM** when the app is launched from a menu (`pty.rs:102`). Set `TERM=xterm-256color`, `COLORTERM=truecolor` and `TERM_PROGRAM`.
- **Open With** ignores `OnlyShowIn`/`NotShowIn` (`xdg_apps.rs` `parse_entry`).
- **Activation:** apps glasshouse launches get no `XDG_ACTIVATION_TOKEN`, so they may open unfocused on GNOME or KDE Wayland. Task 30 handles activation in the other direction; reuse its code.
- **macOS (D6):** if wanted, `open`, `open -R` and `open -a Terminal` instead of xdg-open (`launch.rs:27,89`, `open_with.rs:58`).

## 38. a11y (frontend, M–L)
- **File list:** rows are bare `<div>`s with no role or `aria-selected` (`components.tsx:336-343`). DOM focus stays on the `<section>`, with no `aria-activedescendant`. Use listbox or grid semantics.
- **Column headers:** `<div onClick>`, not focusable and without `aria-sort` (`:951-958`).
- **Controls that aren't buttons:**
  - tabs and their close buttons are `div`/`span` (`:46-61`);
  - the window controls are 12px `<span>`s with only a `title` (`:40-42`);
  - the Inspector's edit/apply links are `<span role="button">` with no `tabIndex` (`Inspector.tsx:116-120,178`).
- **Dialogs and toasts:** DialogHost and About have no `role="dialog"` or `aria-modal`. Use one shared dialog wrapper, and a polite live region for toasts.
- **Contrast and motion:** `--fg-3` is 2.7–3.4:1 in every theme (WCAG AA needs 4.5:1). Add `prefers-reduced-motion` and `forced-colors` (Windows High Contrast) support.

## 39. locale-and-names (frontend, S–M)
- **Sorting:** names sort neither naturally nor by locale (`viewRows.ts:76,95,106`; `listing.rs:132` uses `to_ascii_lowercase`). Use one `Intl.Collator(undefined, {numeric: true, sensitivity: "base"})` (`menuNav.ts:79` already builds one), benchmarked with `viewRows.bench.ts` at 100k rows.
- **Formatting:**
  - There are four size formatters; `App.tsx:340-349` gives "5.2 K" but "52.0K". Use one `Intl` formatter.
  - The file list shows dates as fixed `YYYY-MM-DD HH:MM`; use locale dates.
  - Use `PluralRules` for the 47 "item(s)" strings.
- **Shortcuts on other keyboard layouts:** `keymap.ts:55,64-65` match `e.key`, so Ctrl+` (a dead key on German, French and Nordic layouts) and Ctrl+[ / Ctrl+] (AltGr there) fail. Match punctuation on `e.code`.
- **Bidi spoofing:** U+202E makes `invoice‮txt.exe` show as `invoiceexe.txt`. Isolate name cells (`<bdi>` or `unicode-bidi: isolate`) and make bidi controls visible.
- **Shred:** "random bytes" (`misc.ts:329`) is wrong, since `fs_ops.rs:907` writes fixed patterns, and overwriting doesn't reach old data on SSDs, btrfs, ZFS or NTFS with shadow copies. Fix the wording, or hide Shred on copy-on-write filesystems. This also belongs to task 16's honesty list; do it here.
- **D5** (a string table) is out of scope.

## 40. first-run-defaults (frontend, S–M; after 47)
The theme, font and window-control items moved to task 47.
- **Status bar:** a lean default (items, selection, free space), with cpu, mem, net, uptime and the clock opt-in. Remove the fake `i/o ▁▂▃▅▂▁` graph (`components.tsx:1110`), and stop the 2 s polling while it's hidden (`:1057`).
- **First run:**
  - Seed the pins with the known folders. Today the sidebar says "no pins yet" (`Sidebar.tsx:747`).
  - Read GTK bookmarks, KDE places and Quick Access.
  - The 1400×900 window (`tauri.conf.json:15-18`) runs off-screen at 1920×1080 with 150% scaling: size it from the monitor's work area and center it.

## 41. devices (both, M–L)
- **The Devices list never refreshes** (`Sidebar.tsx:307`), on either platform. Re-list on window focus plus a slow poll, or use udisks2 signals on Linux and WM_DEVICECHANGE on Windows.
- **sysinfo's filter** drops iso9660, cifs, nfs and everything under `/run` except `/run/media`, so GVfs (smb, MTP phones) never shows. Docker overlays probably do show (unverified). Filter overlay, loop and bind mounts.
- **Mount and eject:** add Eject/Unmount, plus Mount for unmounted drives through udisks2 (needed on sway, Hyprland and niri, which have no automounter), and CM_Request_Device_Eject on Windows.

## 42. transfers-and-cloud (both, M)
- **One unsupported item aborts a whole folder copy,** and the partial copy is deleted: a `?` in the walk (`fs_ops.rs:321`), and links recreated as links (`:434`). It fails on:
  - symlinks and names with `: ? * " < > |` or a trailing dot when copying to FAT, exFAT or SMB from Linux;
  - any symlink on Windows without Developer Mode (error 1314).
  - Cross-drive moves fail the same way.
  - Fix: Skip, Skip all or Cancel per item through the existing conflict dialog, plus "copy the link's target".
- **Cloud placeholders download when browsed.** Only HIDDEN and SYSTEM are read (`listing.rs:152-158`). Previews read the file on selection (`FilePreview.tsx:448`), and Find in Files reads everything. OneDrive backs up Desktop, Documents and Pictures by default on Windows 11; rclone, onedriver and GVfs mounts on Linux behave the same.
  - Fix: return a `cloud` flag (attributes 0x400000 | 0x40000 | 0x1000) and badge it. Skip those files in previews, search, hash and folder size (task 25) unless the user asks.

## 43. docs-and-community (docs + repo files, S–M)
- **README:** write it for users first: install per platform, which installer to pick, system requirements, known limitations, where data lives and how to remove it, and privacy (no network calls; the CSP is `connect-src 'self' ipc:`). Build-from-source goes lower down or into CONTRIBUTING.
- **Repo files:** SECURITY.md (private reporting is D7), CONTRIBUTING and issue forms. GitHub's community profile scores 42% today.
- **Manual checklists** in `docs/testing/` for what CI can't drive:
  - **Windows:** install, upgrade and uninstall of both installers; the native pickers; drag out and in; Alt, F10 and Shift+F10; Snap at 150%; terminal profiles including WSL; Reveal; Recycle Bin restore as Explorer sees it.
  - **Linux:** GNOME Wayland, KDE Wayland and one X11 desktop; portal and GTK pickers; drag to and from Nautilus and Dolphin; Reveal; default apps; fractional scaling; `gio trash --list`; the .deb and AppImage on Ubuntu 22.04 and Debian 12.

## 44. e2e-core-flows (test code, M; after 32)
Flows 2–8 from the testing survey:
- file ops with undo, checked on disk, including a cross-volume move on Windows (C: and D:);
- Trash and Restore, with a scratch `XDG_DATA_HOME` on Linux and the Recycle Bin on Windows;
- the terminal: ConPTY with pwsh, and bash;
- git on a fixture repo;
- menus, the palette, Preferences and zoom;
- session restore across a relaunch;
- Open With: Notepad on Windows, a scratch `.desktop` on Linux.

Poll; don't sleep (watcher refreshes are asynchronous). Use unique names, because runner state carries over between tests in a job.

## 45. e2e-nightly-matrix (CI, S–M; after 32)
- **Linux compositors:** headless mutter (`--headless --virtual-monitor`), `kwin_wayland --virtual` and weston (whether `tauri-driver` works under them is unverified).
- **Other runners:** `ubuntu-24.04-arm`, `ubuntu-26.04` and `windows-11-arm`; the Windows release binary (the debug exe is a console program, so child processes behave differently); debian:12 and Fedora containers.
- **CI hygiene:** cache `save-if`. Make e2e blocking after about two green weeks.

## 46. release-smoke (CI + docs, M; after 32 and task 30)
In `release.yml`, before publishing:
- install the MSI and the NSIS setup silently, run the smoke flow, uninstall, and check nothing is left behind, task 30's registry keys included;
- smoke-test the .deb and the AppImage.

## 47. themes-and-cosmetics (frontend, L; user request 2026-11-20)
The owner wants the themes and cosmetic options expanded massively. Today there are 8 themes in `src/styles/themes.css`, every one `color-scheme: dark`; the default is gruvbox-dark (`App.tsx:95`) in a monospace Nerd Font. Preferences → Appearance (`src/dialogs/Preferences.tsx`) offers theme, font, density, scanlines and zoom, saved under `glasshouse.tweaks`.
- **Themes:**
  - Many more, light and dark, covering the well-known editor and terminal palettes and high-contrast ones.
  - "System" follows the OS light/dark setting (`prefers-color-scheme`, plus the window's `setTheme`), as the default for new users, with separate light and dark picks.
  - An accent color picker, with live preview in Preferences.
  - Forced-colors (Windows High Contrast) support.
  - Keep the existing theme names working.
- **Custom themes:** a theme editor for the color tokens, saved as user themes, with import/export as a small JSON file. Validate imports, and check contrast (warn under WCAG AA).
- **Typography:** a system-UI font option next to the monospace ones, with a separate UI font and file-list font, size and line height. The bundled fonts work offline; Iosevka and Berkeley Mono get "if installed" labels or go.
- **Chrome:**
  - Window-control style: native-looking on Windows (right side, so Snap Layouts works on hover if the WebView allows), GNOME-style, macOS-style dots, or hidden.
  - Corner radius, borders and shadows; the tab style; the sidebar width and icon size; the toolbar, breadcrumb and status-bar visibility and layout; transparency where the platform supports it (unverified on WebKitGTK; check before offering).
- **File list:** icon sets (Nerd Font glyphs, colored file-type icons, minimal), row density beyond the three current steps, zebra rows, grid lines, a selection style, git-badge style, and colors by file type or tag.
- **Effects:** scanlines and similar effects stay opt-in. Respect `prefers-reduced-motion`.
- **Coordination:** task 38 (a11y) owns contrast of the shipped themes and ARIA, so every new theme must pass WCAG AA for body text. Task 40 (first-run defaults) follows this task. The demo (`pnpm site:build`) and the landing page's theme screenshots must keep working; re-capture as needed.

## 48. updater (both + CI, M; after 35; D2)
- **Plugin:** `tauri-plugin-updater` for the NSIS, MSI and AppImage builds (the .deb updates through the package manager, so it gets a "download the new .deb" notice instead). Set `includeUpdaterJson: true` in `release.yml`, and have it sign the builds with `TAURI_SIGNING_PRIVATE_KEY`.
- **The signing key:** the lead generates the key pair (`pnpm tauri signer generate`). The private key goes only into a GitHub Actions secret and the owner's password manager, never into the repo or a log; the public key goes into tauri.conf.json.
- **Off by default:** Preferences → "Check for updates automatically" (daily at most). Help → Check for Updates checks once when clicked. Both say what they contact (the GitHub release's latest.json) and send nothing else. Show what's new from the release notes, and install only when the user says so.
- **Docs:** a privacy line in the README (task 43).
- **AppImage updates** are this task's too (split from 35): the Tauri updater covers the AppImage, so no zsync update information is embedded.

## 49. appimage-menu-entry (both, M; split from 35 on 2026-11-20)
- An AppImage that isn't installed has no menu entry or icon. Add a Preferences → Integration switch, "Add glasshouse to the app menu", shown only when running from an AppImage (`$APPIMAGE`): it writes a desktop entry pointing at `$APPIMAGE`, plus the icon, under `~/.local/share`, and removes them when turned off. Follow how `integration.rs` keeps and restores what it changes, with tests and the UI.
- Handle the AppImage moving or being deleted (the entry should not point at nothing), and keep it consistent with the folder-default and file-manager entries, which today start the binary path.
- *(found by 35)* tauri-bundler's AppImage carries glasshouse.desktop and the icons inside the image only. The integration files already record `$APPIMAGE` (the image's real path) rather than the `/tmp/.mount_*` copy, through `startup.rs`'s `self_exe()`; the menu entry should start the same path. Keep `StartupWMClass=glasshouse` so docks match the window. Moving or deleting the image leaves every one of those entries (the existing ones and the new one) pointing at nothing.

## Found by tasks
- *(from e2e-smoke, for 44)* Reuse `e2e/harness.mjs` and its `waitFor`, not sleeps. Fixtures are made per run in a scratch dir, but on Windows the run uses the runner's real profile, so use unique names. Put the Trash fixture under the scratch `XDG_DATA_HOME`. A task that needs a D-Bus service in the test drops its `.service` file into the scratch `$XDG_DATA_HOME/dbus-1/services`.
- *(from e2e-smoke, for 45)* ubuntu-22.04 retires on 2027-04-17, with brownouts before that (runner-images#14254). release.yml builds Linux there too, so move both together. The windows-latest D: drive becomes ReFS from 2026-11-30 (#15315); the checkout and build are on D:, the fixture on C:. Add the release exe (the debug exe is a console program). Make e2e blocking after about two green weeks.
- *(from e2e-smoke, for 46)* `E2E_APP` in `e2e/harness.mjs` can point the suite at an installed binary.
- *(from e2e-smoke, for 40)* The seeded tags are project/school/secret/review/archive (`SEED_TAGS`, `src/Sidebar.tsx:31`); "school" reads as one user's. Use a generic set.
- *(from e2e-smoke, for 33)* WebKitWebDriver reports wry's version (0.57.2) as `browserVersion`, not WebKitGTK's. If bug reports want the WebKitGTK version, About or the log has to supply it.
- *(from themes-and-cosmetics)* The landing page offers only the original eight themes; light chips and hero shots in the new default look would show the range.
- *(from themes-and-cosmetics)* A "transparent window" setting (Mica on Windows 11) and Snap Layouts on the maximize button both need Rust (`docs/decisions/2026-11-20-themes-transparency.md`).
- *(from themes-and-cosmetics, for 38)* The new window buttons are real `<button>`s kept out of the Tab order; Preferences' category nav and filter want the a11y review too.
- *(from themes-and-cosmetics)* Not checked on Windows: forced-colors, the Windows-style window buttons, and the window following the OS theme (`setTheme(null)`). On Linux the System switch was checked in WebKitGTK alone, not inside glasshouse.
- *(from e2e-windows)* Fixed and merged: the Windows leg now runs (GitHub's runner runs steps elevated, and an elevated WebView2 ignores msedgedriver's `WEBVIEW2_*` variables, so `e2e/unelevated.ps1` starts tauri-driver unelevated; `docs/decisions/2026-11-20-e2e-windows-elevation.md`), and the CSP's `https://ipc.localhost` became `http://` (Windows serves Tauri's IPC there).
- *(from e2e-windows, for 40)* The first window doesn't fit a small screen: on the runner's 1024x768 (work area 1024x720) it asks for 1400x900 and gets 1044x788, so the status bar is under the taskbar and the preview column is cut off. The first window should fit the monitor's work area.
- *(from e2e-windows, for 45)* Cold start on the Windows runner took 13–19 s from launch to the first listing (2.4 s warm), possibly Defender scanning the 37 MB debug exe and a new WebView2 profile. The release exe would show whether users see it.
- *(from e2e-windows, for 45)* `driver-and-app.log` is empty on Windows: tauri-driver discards msedgedriver's output, and the debug app prints nothing.
- *(for 45)* On 11-20 the Linux e2e leg's `apt-get update`/install step took 13 min (run 44731257806; the tests themselves took 11 s). Consider caching the apt packages or a step timeout.
- *(from release-identity, for 46)* Upgrading over 0.2.0's setup.exe is untested: the publisher change means the new installer can't find 0.2.0's install-folder key, so its "uninstall first" may fail (installing over it works). See `docs/decisions/2026-11-20-release-identity-installers.md`.
- *(from release-identity, for 45/46)* Not run yet: the release workflow's Windows arm64 build, SHA256SUMS and `attest-build-provenance`, and CI's new `windows-11-arm` leg.
- *(from release-identity)* The Tauri `opener` plugin is no longer registered (Rust still calls its functions), and fs, os and shell are gone. The theme names are "glasshouse Light/Dark".
- *(from first-run-defaults)* The site's hero images and tour clips in `docs/media` still show the old status bar (READY, the i/o graph); `pnpm site:capture` re-records them.
- *(from first-run-defaults)* A window restored maximized whose saved normal size doesn't fit the screen still un-maximizes too big.
- *(from first-run-defaults, for 45)* Not run: Windows (Quick Access, `GetDiskFreeSpaceExW`, the window fit), a second window's fit on Linux, and the fit under a real window manager or Wayland compositor (positions are ignored there). KDE's and GNOME's bookmark files were tested as files.
