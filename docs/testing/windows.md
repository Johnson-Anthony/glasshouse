# Windows checklist

For a release build on Windows 10 or 11. Run it on x64, and the installer and first-run sections on Windows on Arm too. [README.md](README.md) says how to set up and report. Each item: what to do → what should happen.

Note before you start: Windows version (`winver`), x64 or Arm, display scale (Settings → System → Display), whether WSL, Git for Windows, PowerShell 7, Windows Terminal and 7-Zip are installed, and whether the account is an administrator.

## W1. Download and SmartScreen

- [ ] **W1.1** Download the setup.exe, the MSI and `SHA256SUMS`. `Get-FileHash <file>` in PowerShell → the same hash as the file's line in `SHA256SUMS`.
- [ ] **W1.2** With the GitHub CLI: `gh attestation verify <file> --repo Johnson-Anthony/glasshouse` → "Verification succeeded".
- [ ] **W1.3** Run the downloaded setup.exe → SmartScreen's "Windows protected your PC"; More info shows "Unknown publisher"; Run anyway starts the installer.
- [ ] **W1.4** The README's [Windows install notes](../../README.md#windows) match what you saw, word for word where they quote Windows.

## W2. The setup.exe (per user)

Use a standard (non-administrator) account if you can.

- [ ] **W2.1** Install with the defaults → no admin prompt; glasshouse is in `%LOCALAPPDATA%\glasshouse`, in the Start menu, and in Settings → Apps with publisher Anthony Johnson and the right version.
- [ ] **W2.2** On a PC or VM without the WebView2 Runtime (if you have one): install → it downloads and installs WebView2, then glasshouse starts. Without a network connection → the installer says it couldn't download WebView2.
- [ ] **W2.3** Start it from the Start menu → the window opens; its taskbar icon is glasshouse's.
- [ ] **W2.4** Silent: `glasshouse_<version>_x64-setup.exe /S` → installs with no window.
- [ ] **W2.5** Install the same version again → the "Already Installed" page offers "Add/Reinstall components" and "Uninstall".
- [ ] **W2.6** **Upgrade:** install the previous release, change the theme, pin a folder, tag a file and open a few tabs; then install the new one → one glasshouse in Settings → Apps, the new version in Help → About, and the theme, pins, tags and tabs kept.
- [ ] **W2.7** **Upgrade over 0.2.0:** with 0.2.0's setup.exe installed, run the new setup and choose "Uninstall before installing" → note what happens ("Unable to uninstall!" is possible). Then "Do not uninstall" → it installs over 0.2.0. Your data moved from `%APPDATA%\sh.glasshouse.viles` and `%LOCALAPPDATA%\sh.glasshouse.viles` to the `io.github.johnson-anthony.glasshouse` folders, and saved remotes from `%USERPROFILE%\.glasshouse` into the first.
- [ ] **W2.8** **Uninstall** (Settings → Apps) with "Delete the application data" unticked → the program is gone; `%APPDATA%\io.github.johnson-anthony.glasshouse` and `%LOCALAPPDATA%\io.github.johnson-anthony.glasshouse` stay; `HKCU\Software\Anthony Johnson\glasshouse` is gone (regedit).
- [ ] **W2.9** Reinstall, then uninstall with "Delete the application data" ticked → both folders are gone.
- [ ] **W2.10** With "Open folders with glasshouse" on, uninstall → double-clicking a folder in Explorer opens Explorer again.

## W3. The MSI (per machine)

- [ ] **W3.1** Install → the admin prompt (UAC) says "Unknown publisher"; glasshouse is in `C:\Program Files\glasshouse` and in the Start menu; Settings → Apps shows publisher Anthony Johnson.
- [ ] **W3.2** Another user account on the same PC → glasshouse is in its Start menu and starts, with its own settings.
- [ ] **W3.3** Silent: `msiexec /i glasshouse_<version>_x64_en-US.msi /qn` from an admin prompt → installs with no window.
- [ ] **W3.4** **Upgrade** from the previous release's MSI (0.2.0 included) → an in-place upgrade: one entry in Settings → Apps, settings kept.
- [ ] **W3.5** **Uninstall** → the program is gone and the data folders stay. With "Open folders with glasshouse" on for the uninstalling user, folders open in Explorer again.
- [ ] **W3.6** **Switching:** install the setup.exe, uninstall it, then install the MSI → the MSI installs in `Program Files\glasshouse`, not in `%LOCALAPPDATA%`.
- [ ] **W3.7** On Windows on Arm: the arm64 MSI and setup.exe install and start. Task Manager → Details, with the Architecture column added → glasshouse.exe is ARM64.

## W4. First run and the window

Delete (or rename) both data folders first, so it's a first run.

- [ ] **W4.1** First start → the window fits the screen, centered, with the status bar above the taskbar. Try at 1366×768 if you can.
- [ ] **W4.2** The sidebar pins Home, Desktop, Documents, Downloads, Music, Pictures and Videos, then your Quick Access folders. With Desktop or Documents in OneDrive → the pins and Go → Desktop/Documents open the OneDrive folders.
- [ ] **W4.3** The status bar shows the item count, the selection, the size and the drive's free space, and nothing else.
- [ ] **W4.4** The window buttons are on the right, Windows style. Minimize, maximize, restore and close work; double-clicking the title bar maximizes.
- [ ] **W4.5** Close and restart → the same size, position and maximized state, the same tabs.
- [ ] **W4.6** **Theme:** with the System theme, switch Windows between light and dark (Settings → Personalization → Colors) → glasshouse follows while running, title bar and menus included.
- [ ] **W4.7** Turn on a contrast theme (Settings → Accessibility → Contrast themes) → glasshouse switches to its high-contrast theme and stays readable; turning it off goes back.
- [ ] **W4.8** Cold start after a reboot, then a second start → note both times from the click to the first listing.

## W5. Snap and scaling at 150%

Set the display to 150% (and try 125% and 175% if you can).

- [ ] **W5.1** Text, icons and the file list are sharp, and nothing is cut off at the edges.
- [ ] **W5.2** Drag the window to the left and right edges, and to a corner → it snaps to half or quarter. Win+← and Win+→ do the same; Win+↑ maximizes.
- [ ] **W5.3** Win+Z → note whether Snap Layouts appears (hovering the maximize button isn't expected to show it).
- [ ] **W5.4** With two monitors at different scales: move the window across → it re-scales, and menus and dialogs open on the right monitor at the right size.
- [ ] **W5.5** Drag a file inside the window at 150% → it drops on the row under the pointer, not beside it. Same with Zoom at 125% (Ctrl+=).

## W6. Keyboard and menus

- [ ] **W6.1** Press and release Alt → the menubar opens with the first menu highlighted, and no system window menu appears. Esc closes it and focus goes back to the file list.
- [ ] **W6.2** F10 → the same. ← and → move between menus; ↓ opens one.
- [ ] **W6.3** Alt+F, Alt+E, Alt+V, Alt+G, Alt+I (Git), Alt+R (Terminal) → open their menus.
- [ ] **W6.4** In a menu: ↑ ↓ Home End move; a letter jumps to the next item starting with it; → and ← enter and leave submenus; Enter runs the item.
- [ ] **W6.5** With files selected, Shift+F10 and the Menu key → the selection's context menu. With nothing selected → the New/Paste menu.
- [ ] **W6.6** Ctrl+P (palette), Ctrl+, (Preferences), Ctrl+L (Go to Path), F2 (rename), Ctrl+Z and Ctrl+Y work, and none of them is taken by WebView2 (no browser find bar, no print dialog, no reload).
- [ ] **W6.7** Type a file's first letters in the file list → it jumps there.

## W7. Native pickers

These use Windows' own dialogs.

- [ ] **W7.1** Open With → Choose App… → "Choose a program…" → the Windows Open dialog; pick an .exe → the file opens with it.
- [ ] **W7.2** Preferences → Appearance → "import a file…" → the Open dialog filtered to `.json`; importing an exported theme works.
- [ ] **W7.3** A custom theme's "export…" → the Save As dialog with a suggested name; saving over a file asks first (Windows' prompt).
- [ ] **W7.4** Each dialog opens in front of glasshouse and at the right scale, and Cancel does nothing.

## W8. Drag and drop with other apps

- [ ] **W8.1** **Out:** drag a file from glasshouse into an Explorer window and onto the desktop → it's copied; the original stays.
- [ ] **W8.2** Drag a file into a browser's upload field (Edge, Chrome or Firefox) → it uploads. Into Windows Terminal → note what happens (the path typed, or nothing).
- [ ] **W8.3** Drag several files, and a folder → all copied.
- [ ] **W8.4** **In:** drag files from Explorer onto a folder in the file list, onto the empty part of the list, onto a tab, a breadcrumb and a sidebar folder → copied there, and the target lights up while you hover.
- [ ] **W8.5** Drop onto a folder that has a file of the same name → asked whether to replace, keep both or skip. Ctrl+Z undoes the drop.
- [ ] **W8.6** Drag a download from the browser's downloads list into glasshouse → copied.
- [ ] **W8.7** Inside glasshouse: a plain drag moves, Ctrl+drag copies, and the label at the pointer changes as you press Ctrl.

## W9. Terminal

- [ ] **W9.1** Open the terminal drawer → note the profiles listed. Expected: PowerShell (7 if installed, else Windows PowerShell), bash, zsh or fish if they're on PATH, one per WSL distro, one per host in `%USERPROFILE%\.ssh\config`. For bash, note which one runs: `C:\Windows\System32\bash.exe` starts WSL, not Git Bash.
- [ ] **W9.2** PowerShell opens in the folder you're browsing, and follows it when you change folders (with "follow folder" on).
- [ ] **W9.3** **WSL:** each distro's profile opens a shell in the same folder under `/mnt/c/…`. A WSL distro that's stopped starts. With WSL not installed → no WSL profiles, and the sidebar doesn't stall.
- [ ] **W9.4** An ssh profile connects (with a key in ssh-agent) or asks for the password in the terminal.
- [ ] **W9.5** Several shell tabs; closing one leaves the others; typing `exit` closes its tab.
- [ ] **W9.6** Open in Terminal on a folder → Windows Terminal if installed, else PowerShell, in that folder. Repeat on a folder named `a&b;c` → it opens in that folder, and nothing else runs.

## W10. Reveal, open and Open With

- [ ] **W10.1** Right-click a file → Reveal in Explorer → Explorer opens its folder with the file selected.
- [ ] **W10.2** Enter on a file → it opens in its default app. A file type with no app → glasshouse says so and offers Choose App….
- [ ] **W10.3** Open With lists the apps Explorer recommends for the type, default first; choosing one opens the file in it.
- [ ] **W10.4** Open a link with `&` in it (from the palette or Go to Path, such as `https://example.com/?a=1&b=2`) → the browser gets the whole URL.
- [ ] **W10.5** Tools → Verify Signature… on a signed .exe, and on one named `Tom’s.exe` (with a curly apostrophe) → a result, not an error.

## W11. Recycle Bin

- [ ] **W11.1** Move to Trash a file and a folder → both are in Explorer's Recycle Bin, with the right original location and date deleted.
- [ ] **W11.2** Go → Trash in glasshouse → lists the same items, with original folder, deletion time and size.
- [ ] **W11.3** Restore one in glasshouse → it's back where it was, and gone from Explorer's Recycle Bin.
- [ ] **W11.4** Restore one from Explorer's Recycle Bin → glasshouse's Trash view no longer lists it (after a refresh).
- [ ] **W11.5** Move to Trash, then Ctrl+Z → restored. Ctrl+Y → trashed again.
- [ ] **W11.6** Empty Trash in glasshouse → Explorer's Recycle Bin is empty too.
- [ ] **W11.7** Move to Trash on a USB stick or a network drive (no Recycle Bin there) → glasshouse asks before deleting permanently.

## W12. Open folders with glasshouse

- [ ] **W12.1** Edit → Preferences → Integration → turn on "Open folders with glasshouse" → double-clicking a folder in Explorer, and a drive in This PC, opens glasshouse. Explorer's right-click menu (Show more options on Windows 11) has "Open in glasshouse".
- [ ] **W12.2** A folder opened by another app (an editor's "Open containing folder", `start .` in a terminal) → glasshouse.
- [ ] **W12.3** Expected to stay Explorer: a browser's "Show in folder", Win+E, This PC, the Recycle Bin, Control Panel.
- [ ] **W12.4** Turn it off → folders open in Explorer again.
- [ ] **W12.5** `glasshouse.exe --integration-on folders`, then `--integration-off` from a terminal → the same as the switch.

## W13. Drives, paths and archives

- [ ] **W13.1** An empty card reader or CD drive → no "no disk" dialog, and the drive list appears. A disconnected network drive → the drive list doesn't stall.
- [ ] **W13.2** A folder path over 260 characters, and names with accents and emoji → listed, opened, copied and renamed.
- [ ] **W13.3** Go to Path with a UNC path (`\\server\share`) → it lists, or says why not.
- [ ] **W13.4** Create and extract `.zip`, `.tar.gz` and `.tar.zst` (Windows' own tar) → they work, and Explorer opens the zip. `.7z` with 7-Zip's folder on PATH works. With 7-Zip installed but not on PATH (its installer's default) → note what glasshouse says.
- [ ] **W13.5** Git: Pull and Push on a repository with an HTTPS remote (Git Credential Manager) and an ssh remote → they work, or fail with a hint; none hangs.

## W14. Updates

Needs two releases with the update check (any after 0.2.0): install the older one, while the newer one is the latest on GitHub. Nothing here runs in CI.

- [ ] **W14.1** A new install, and one upgraded by W2.6 → Edit → Preferences → Updates → "check for updates automatically" is off, and Preferences says what a check sends.
- [ ] **W14.2** Help → Check for Updates on the newest release → "glasshouse X is the newest version." With the network off → "Couldn't reach the update server…", and Try again works once it's back.
- [ ] **W14.3** **setup.exe:** the older release installed, with a second glasshouse window open. Help → Check for Updates → "X is out" with the release notes; Install and restart → progress, then both windows close, no admin prompt, and glasshouse starts again at the new version (Help → About). Still in `%LOCALAPPDATA%\glasshouse`, one entry in Settings → Apps, settings and tabs kept.
- [ ] **W14.4** **MSI:** the older release installed. Install and restart → an admin (UAC) prompt, Windows Installer's progress, and glasshouse starts again at the new version, still in `Program Files\glasshouse`, one entry in Settings → Apps. Note what happens to a second open window.
- [ ] **W14.5** MSI as a standard user: Install, then cancel the admin prompt → note what the dialog says; the old version keeps running and stays installed.
- [ ] **W14.6** The older release with the automatic check turned on: start it → within a minute, a "glasshouse X is out." toast whose "what's new" opens the dialog. Start it again the same day → no toast.
