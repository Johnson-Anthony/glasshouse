# Linux checklist

For a release package on a real login, not a nested or headless session. [README.md](README.md) says how to set up and report. Each item: what to do → what should happen.

**Where to run it.** Cover at least:
- **Packages (L1–L2, L12):** Ubuntu 22.04 and Debian 12, the oldest releases the packages support, on x86-64 and, if you can, arm64.
- **Desktops (L3–L11):** GNOME on Wayland, KDE Plasma on Wayland, and one X11 session (Xfce, Cinnamon or MATE, or GNOME's or Plasma's X11 session where the release still has one).
- **Open and save dialogs (L7):** a release with xdg-desktop-portal 1.17 or newer, such as Ubuntu 24.04, Debian 13 or a current Fedora, plus Debian 12 or Ubuntu 22.04 to check that the switch stays off there.

Note before you start: the distribution and release, the processor (`uname -m`), the desktop and session (`echo $XDG_CURRENT_DESKTOP $XDG_SESSION_TYPE`), the display scale, the portal's version (`/usr/libexec/xdg-desktop-portal --version`; the path varies), and for the .deb the WebKitGTK version (`dpkg -s libwebkit2gtk-4.1-0 | grep Version`).

## L1. The .deb

- [ ] **L1.1** `sha256sum -c SHA256SUMS --ignore-missing` → `OK` for the .deb. `gh attestation verify <file> --repo Johnson-Anthony/glasshouse` → "Verification succeeded".
- [ ] **L1.2** `sudo apt install ./glasshouse_<version>_amd64.deb` → installs, with WebKitGTK 4.1, and also git, a 7-Zip package and xdg-utils (unless your apt skips Recommends).
- [ ] **L1.3** The app menu has glasshouse (GNOME's overview, KDE's launcher, the X11 desktop's menu), with its icon. Starting it opens the window, and the dock or task manager groups it with the menu entry, with the same icon.
- [ ] **L1.4** Installing changes nothing else: `xdg-mime query default inode/directory` names the same app as before, and "Show in folder" in a browser opens the same file manager as before.
- [ ] **L1.5** **Upgrade:** install the previous release's .deb, change the theme, pin a folder, tag a file and open a few tabs; then install the new .deb → Help → About shows the new version, and the theme, pins, tags and tabs are kept.
- [ ] **L1.6** **From 0.2.0:** with 0.2.0's data in `~/.config/sh.glasshouse.viles`, `~/.local/share/sh.glasshouse.viles` and `~/.glasshouse/remotes.json`, start the new version → they're moved to the `io.github.johnson-anthony.glasshouse` folders (remotes into `~/.config/io.github.johnson-anthony.glasshouse/remotes.json`), and nothing is lost.
- [ ] **L1.7** **Remove:** turn the integration settings off, then `sudo apt remove glasshouse` → the menu entry, `/usr/bin/glasshouse` and `/usr/share/xdg-desktop-portal/portals/glasshouse.portal` are gone, and `dpkg -s glasshouse` says it isn't installed. `~/.config/io.github.johnson-anthony.glasshouse` and `~/.local/share/io.github.johnson-anthony.glasshouse` stay.
- [ ] **L1.8** Remove it with an integration setting still on → nothing breaks: folders open in the previous app, and with the dialogs switch on, apps get the desktop's dialog again by the next login ([docs/INTEGRATION.md](../INTEGRATION.md#uninstalling)).

## L2. The AppImage

- [ ] **L2.1** `chmod +x`, then run it → the window opens. On a release without FUSE 2 → an error that names FUSE; with `--appimage-extract-and-run` → it starts.
- [ ] **L2.2** After installing FUSE 2 (`libfuse2`, or `libfuse2t64` on Ubuntu 24.04 and Debian 13) → it starts normally.
- [ ] **L2.3** It adds no menu entry of its own (expected for now). The window's icon in the dock or task manager is glasshouse's.
- [ ] **L2.4** Turn on "Open folders with glasshouse" → it points at the AppImage file, not at `/tmp/.mount_…`: `cat ~/.local/share/applications/glasshouse-folders.desktop`.
- [ ] **L2.5** Move or rename the AppImage and start it from the new place → Preferences → Integration warns that the settings point at another copy. Turning them off and on fixes it.
- [ ] **L2.6** On a portal older than 1.20.1 (Ubuntu 24.04 has 1.18): Preferences shows the one `sudo tee` command for `glasshouse.portal`, and the dialog switch works after it's run.

## L3. First run and the window

Move `~/.config/io.github.johnson-anthony.glasshouse` and `~/.local/share/io.github.johnson-anthony.glasshouse` aside first, so it's a first run.

- [ ] **L3.1** First start → the window fits the screen, centered, with the status bar visible above any panel. Try a 1366×768 screen if you can.
- [ ] **L3.2** The sidebar pins Home and the XDG folders that exist (Desktop, Documents, Downloads, Music, Pictures, Videos), with localized names when the session's language isn't English. Then the desktop's bookmarks: Nautilus's on GNOME (`~/.config/gtk-3.0/bookmarks`), Dolphin's Places on KDE.
- [ ] **L3.3** The status bar shows the item count, the selection, the size and the drive's free space, and nothing else.
- [ ] **L3.4** The window buttons are GNOME style, on the right. Minimize, maximize and close work. Dragging the title bar moves the window; double-clicking it maximizes. Edges and corners resize it.
- [ ] **L3.5** Close and restart → the same size and maximized state, the same tabs. (Wayland compositors don't let apps set their position, so only X11 restores it.)
- [ ] **L3.6** **Theme:** with the System theme, switch the desktop between light and dark (GNOME Settings → Appearance; KDE System Settings → Colors & Themes) → glasshouse follows while running. GTK-drawn parts (the native pickers, any popup menu) match.
- [ ] **L3.7** GNOME's High Contrast (Settings → Accessibility) → glasshouse switches to its high-contrast theme.
- [ ] **L3.8** Several windows (File → New Window) → each works; restarting restores the first one's tabs.

## L4. Scaling

GNOME: Settings → Displays → Scale (if 125% and 150% aren't offered, fractional scaling is behind mutter's `scale-monitor-framebuffer` experimental feature). KDE: System Settings → Display & Monitor → Scale. X11: the desktop's scale setting, or `GDK_SCALE=2`.

- [ ] **L4.1** At 125%, 150% and 200%: text, icons and the file list are sharp (not blurry, as an upscaled window would be), and nothing is cut off.
- [ ] **L4.2** Menus, context menus and dialogs open where they should (at the pointer, under the menubar), at the same scale.
- [ ] **L4.3** Drag a file inside the window at 150% → it drops on the row under the pointer. The same with glasshouse's own zoom at 125% (Ctrl+=), and with both.
- [ ] **L4.4** Drop a file from another app at 150% → it lands on the folder under the pointer.
- [ ] **L4.5** With two monitors at different scales: move the window across → it re-scales.

## L5. Keyboard and menus

- [ ] **L5.1** Press and release Alt → the menubar opens with the first menu highlighted. Esc closes it and focus goes back to the file list. (Some desktops use Alt for themselves; note it if the desktop takes it.)
- [ ] **L5.2** F10 → the same. ← and → move between menus.
- [ ] **L5.3** Alt+F, Alt+E, Alt+V, Alt+G, Alt+I (Git), Alt+R (Terminal) → open their menus.
- [ ] **L5.4** With files selected, Shift+F10 and the Menu key → the selection's context menu. With nothing selected → the New/Paste menu.
- [ ] **L5.5** Ctrl+P, Ctrl+, Ctrl+L, F2, Ctrl+Z and Ctrl+Y work, and none is taken by WebKitGTK or the desktop.

## L6. Native pickers: GTK and the portal

glasshouse's own Open and Save dialogs are GTK's (GtkFileChooserNative). GTK shows its own dialog, or the portal's when `GTK_USE_PORTAL=1` is set or glasshouse runs in a sandbox. The portal's dialog is the desktop's (GNOME's, KDE's, xdg-desktop-portal-gtk), or glasshouse's own with the switch in L7 on.

- [ ] **L6.1** Open With → Choose App… → "Choose a program…" → an Open dialog; picking a program opens the file with it.
- [ ] **L6.2** Preferences → Appearance → "import a file…" → an Open dialog filtered to `.json`. A custom theme's "export…" → a Save dialog with a suggested name; saving over a file asks first.
- [ ] **L6.3** Run L6.1–L6.2 started normally (GTK's own dialog), and started with `GTK_USE_PORTAL=1 glasshouse` (the desktop portal's: on KDE, KDE's dialog) → both work, open in front of glasshouse, and Cancel does nothing.
- [ ] **L6.4** On Wayland, each dialog stays on top of glasshouse's window and moves with it.

## L7. glasshouse as the open and save dialog

On a release with portal 1.17 or newer. See [docs/INTEGRATION.md](../INTEGRATION.md#open-and-save-dialogs) for what the switch changes.

- [ ] **L7.1** On Debian 12 or Ubuntu 22.04 → Preferences → Integration says the portal is too old, and the switch stays off.
- [ ] **L7.2** Turn on "Use glasshouse for open and save dialogs" → Preferences says which dialog apps get now. A screen share in progress ends (expected).
- [ ] **L7.3** At once, with no restart: Chromium or Chrome (Upload, Save As), an Electron app such as VS Code (Open Folder), a Flatpak app, and a GTK 4.18 or newer app → glasshouse's dialog.
- [ ] **L7.4** After logging out and back in: a GTK 3 app (such as gedit, Mousepad or Pluma) and a Qt app (on KDE, Kate or Okular) → glasshouse's dialog. Before the re-login they still show their old one.
- [ ] **L7.5** Firefox and Thunderbird → glasshouse's dialog: recent releases at once, ESR releases after the re-login. Note the version and which it was.
- [ ] **L7.6** **Open:** several files, a folder, a file-type filter, Enter and double-click accept, Esc cancels, a typed path (`~/Documents/notes.txt`, `../`) goes there. The app gets what you picked.
- [ ] **L7.7** **Save:** the suggested name and folder, changing the file type swaps the extension, saving over a file asks first, and the app's extra options (an encoding, for example) show and work.
- [ ] **L7.8** The dialog opens over the app's window and stays on top of it (X11, and Wayland compositors with xdg-foreign); it opens in the folder you last picked for that app.
- [ ] **L7.9** glasshouse's own pickers (L6) after the re-login → glasshouse's dialog, which works.
- [ ] **L7.10** Turn it off → the apps from L7.3 get the desktop's dialog at once, the rest after the next login. `~/.config/environment.d/60-glasshouse-dialogs.conf` and `~/.local/share/xdg-desktop-portal/portals/glasshouse.portal` are gone.
- [ ] **L7.11** Note the time from the app's request to glasshouse's dialog appearing.

## L8. Opening folders and "Show in folder"

- [ ] **L8.1** Turn on "Open folders with glasshouse" → `xdg-open ~/Documents`, `gio open ~/Documents` (GNOME, Cinnamon, MATE) or `kde-open ~/Documents` (KDE) opens it in glasshouse, and so does a folder opened from another app (a terminal's or an editor's "Open containing folder").
- [ ] **L8.2** Turn on "Show files for other apps" → with the desktop's file manager not running, a browser's downloads "Show in folder" (Firefox and Chromium) opens glasshouse with the file selected, in front.
- [ ] **L8.3** With Nautilus (or Dolphin) running → Preferences says which program holds the name, and "Show in folder" still goes to it (expected). After quitting it, or logging out and in → glasshouse.
- [ ] **L8.4** On the X11 desktop, follow the [per-desktop table](../INTEGRATION.md#per-desktop) for its file manager and xdg-open. Note anything the table doesn't say.
- [ ] **L8.5** Turn both off → the previous folder app is back (`xdg-mime query default inode/directory`), and "Show in folder" goes to the desktop's file manager.

## L9. Drag and drop with other apps

Run on GNOME Wayland (Nautilus), KDE Wayland (Dolphin) and the X11 desktop (its file manager).

- [ ] **L9.1** **Out:** drag a file from glasshouse past the window's edge into Nautilus or Dolphin → it's copied; the original stays.
- [ ] **L9.2** Drag several files, a folder, and a file whose name has spaces and accents → all copied, names intact.
- [ ] **L9.3** Drag into a browser's upload field (Firefox and Chromium) → it uploads. Into a terminal → it types the path.
- [ ] **L9.4** Drag out, then back into glasshouse before dropping → it behaves as a drag inside glasshouse (a move, unless Ctrl is held).
- [ ] **L9.5** **In:** drag files from Nautilus or Dolphin onto a folder row, the empty part of the list, a tab, a breadcrumb and a sidebar folder → copied there, and the target lights up while you hover.
- [ ] **L9.6** A drop onto a name that exists → asked whether to replace, keep both or skip. Ctrl+Z undoes the drop.
- [ ] **L9.7** Drag a download from the browser's downloads list into glasshouse → copied.
- [ ] **L9.8** Inside glasshouse: a plain drag moves, Ctrl+drag copies, and the label at the pointer changes as you press Ctrl.

## L10. Reveal, default apps and the trash

- [ ] **L10.1** Right-click a file → Reveal in File Manager, with glasshouse not the file manager → the desktop's file manager opens its folder with the file selected. With "Show files for other apps" on and no other file manager holding the name → the file is selected in glasshouse's current window.
- [ ] **L10.2** Enter on a file → it opens in the app `xdg-mime query default <type>` names. A type with no app → glasshouse says so and offers Choose App….
- [ ] **L10.3** Open With lists the apps installed for the type, Flatpak apps included, default first; choosing one opens the file in it.
- [ ] **L10.4** Move to Trash a file and a folder → `gio trash --list` lists them, and Nautilus's or Dolphin's Trash shows them with their original location.
- [ ] **L10.5** Restore one in glasshouse's Go → Trash → it's back, and gone from `gio trash --list`. Restore one from Nautilus or Dolphin → glasshouse's Trash view drops it.
- [ ] **L10.6** Move to Trash, then Ctrl+Z → restored. Empty Trash → `gio trash --list` prints nothing.
- [ ] **L10.7** Move to Trash on a USB stick → it goes to that drive's own trash, and the desktop's Trash shows it.

## L11. Terminal, git and archives

- [ ] **L11.1** The terminal drawer lists your login shell first, then the other shells installed, then one profile per host in `~/.ssh/config`. Each opens in the current folder and follows it.
- [ ] **L11.2** Open in Terminal on a folder → `$TERMINAL` if set, else the first of kitty, alacritty, foot, wezterm, konsole, gnome-terminal, xfce4-terminal, x-terminal-emulator and xterm that's installed, in that folder.
- [ ] **L11.3** Git Pull and Push with an ssh remote whose key is in the agent → work. With a key that needs a passphrase and no agent → fails at once with a hint; nothing hangs.
- [ ] **L11.4** Create and extract `.zip`, `.tar.gz`, `.tar.zst` and `.7z` → they work and the desktop's archive manager opens them. Without a 7-Zip installed, `.7z` → glasshouse says one is needed.

## L12. Updates

Needs two releases with the update check (any after 0.2.0): install the older one, while the newer one is the latest on GitHub.

- [ ] **L12.1** Edit → Preferences → Updates → "check for updates automatically" is off on a first run, and Preferences says what a check sends. Help → Check for Updates on the newest release → "glasshouse X is the newest version." With the network off → "Couldn't reach the update server…".
- [ ] **L12.2** **.deb** of the older release: Help → Check for Updates → "X is out" with the release notes, the .deb notice and its `sudo apt install ./…` line, and no Install button. Download opens the new .deb's link in the browser.
- [ ] **L12.3** **AppImage** of the older release, in a folder you own, with a second window open: Install and restart → progress, then this window comes back at the new version (Help → About) with its tabs; the file keeps its name and its `sha256sum` matches the new AppImage's line in `SHA256SUMS`. The other window keeps the old version until closed.
- [ ] **L12.4** An AppImage in a folder you can't write to (copy it to `/opt` as root) → the dialog offers the download, not Install.
- [ ] **L12.5** The older release with the automatic check turned on: start it → within a minute, a "glasshouse X is out." toast. Start it again the same day → no toast.
