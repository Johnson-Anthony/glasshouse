# Linux checklist

For a release package on a real login, not a nested or headless session. [README.md](README.md) says how to set up and report. Each item: what to do → what should happen.

**Where to run it.** Cover at least:
- **Packages (L1–L2, L12):** Ubuntu 22.04 and Debian 12, the oldest releases the packages support, on x86-64 and, if you can, arm64.
- **Desktops (L3–L11, L13, L14):** GNOME on Wayland, KDE Plasma on Wayland, and one X11 session (Xfce, Cinnamon or MATE, or GNOME's or Plasma's X11 session where the release still has one).
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
- [ ] **L3.8** Several windows (File → New Window) → each works; File → Quit and a restart restore all of them (L13).

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
- [ ] **L8.2** Turn on "Show files for other apps" → with the desktop's file manager not running, a browser's downloads "Show in folder" (Firefox and Chromium) opens glasshouse with the file selected, in front. With glasshouse already running behind another window → the file opens in a new window of the running glasshouse, in front (one glasshouse window process: `pgrep -a glasshouse` shows it and the `--dbus` one).
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
- [ ] **L9.9** **Tabs and split view:** View → Split → Split Side by Side, then drag a tab within its tab bar, onto the other pane's tab bar, and onto the other pane's files → it reorders or moves there, and a line or a shaded pane shows where it will go. Unsplit with two tabs, drag one to the left, right, top or bottom quarter of the file list → the view splits that way with the tab in the new pane. Escape during a drag cancels it.
- [ ] **L9.10** With one tab open, drag the tab → the window moves, as dragging the title bar does (Wayland and X11).
- [ ] **L9.11** **Tab to another window:** two windows, each with a few tabs. Sort a tab's folder by size, go into a subfolder and type a filter, then drag that tab out of its window over the other window's tab bar → a line shows where it will go, and the tab's name follows the pointer. Let go → the tab is there with its folder, sort, filter and Back history, that window has the focus, and the tab is gone from the first one. Over the other window's file list, the outer quarter splits the view and the middle adds the tab to it (a shaded half or pane shows which). Over its sidebar or toolbar → a new window.
- [ ] **L9.12** **Tab to a new window:** drag a tab out and let go over the desktop, then over another app's window → each time a new window opens with that tab, the size of the first. On X11 the pointer is over its tab and the window is inside the screen, even near an edge or a panel; on Wayland the desktop places it. Drag the only tab of a split view's pane out → the view unsplits.
- [ ] **L9.13** **Escape:** drag a tab out of the window and press Escape while it's outside → the name and the mark go, and the tab stays where it was. Drag it out and back into its own window before letting go → it's a move inside the window, as in L9.9, never a new window.
- [ ] **L9.14** **On GNOME Wayland and on KDE Wayland,** run L9.11–L9.13 with the mouse. Be sure that a drop on the desktop opens a window and that Escape doesn't. If either goes the other way, attach the lines with `tab_drag` from the log (Help → Open Log Folder): they say what the desktop reported.
- [ ] **L9.15** After any tab drag out of a window, drag a file in that window at once → the drag starts the first time. No text is selected by the drag (in the preview pane or a field), and files from Nautilus or Dolphin still drop into every window (L9.5).
- [ ] **L9.16** **Move to New Window** on a tab's right-click menu → a new window opens in front with that tab, and the tab leaves the first window. The item isn't there for a window's only tab. A private tab (File → New Private Session) moved by the menu or by a drag stays private.
- [ ] **L9.17** **Files to another window:** two windows. Drag a file from one window's list onto a folder in the other's, then another file onto the empty part of its list → the label at the pointer says "move …", the files move, and the first window's list drops them by itself. Ctrl+Z in the second window puts the last one back. Hold Ctrl as the drag leaves the first window → "copy …", and the original stays. Drag a folder to a window showing another drive or filesystem → it moves. A file from Nautilus or Dolphin still copies (L9.5).
- [ ] **L9.18** Right after a drag of files out of a window (into Nautilus, Dolphin or another glasshouse window), drag a file in that window → the drag starts the first time, and nothing is clicked where the drag ended.

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
- [ ] **L12.3** **AppImage** of the older release, in a folder you own, with a second window open: Install and restart → progress, then both windows come back at the new version (Help → About) with their tabs; the file keeps its name and its `sha256sum` matches the new AppImage's line in `SHA256SUMS`.
- [ ] **L12.4** An AppImage in a folder you can't write to (copy it to `/opt` as root) → the dialog offers the download, not Install.
- [ ] **L12.5** The older release with the automatic check turned on: start it → within a minute, a "glasshouse X is out." toast. Start it again the same day → no toast.

## L13. Several windows and a second launch

Every glasshouse window is in one process, as a browser's are. `pgrep -a glasshouse` lists it (plus a `--dbus` process if L7 or L8 is on); WebKit's own processes are `WebKitWebProcess` and `WebKitNetworkProcess`.

- [ ] **L13.1** File → New Window (Ctrl+N) → a second window opens in front, at home. One glasshouse window process.
- [ ] **L13.2** **Focus, on each desktop (GNOME Wayland, KDE Wayland, X11):** with glasshouse open behind another window, start it again from the dock, the app grid or the launcher → a new window opens in front with the keyboard focus (type a letter: the file list jumps to it). Not expected: a "glasshouse is ready" notification, a window behind the others, or only a highlighted dock icon. Still one window process.
- [ ] **L13.3** From a terminal, with glasshouse running: `glasshouse ~/Documents` → the prompt comes back at once, and a window on Documents opens in the running app. Note whether it takes the focus (a terminal gives no startup ID, so on Wayland it may only ask for attention).
- [ ] **L13.4** **Restore:** three windows with different tabs, one of them split, each sized differently; focus the middle one, then File → Quit (Ctrl+Q) → all three close. Start glasshouse → all three come back with their tabs, split and size (and place on X11), and the one you focused last is in front.
- [ ] **L13.5** Close one of three windows with its close button, then Ctrl+Q, then start → the two that were left come back. Close the last window with its button and start → that window comes back.
- [ ] **L13.6** Private tabs (File → New Private Session) aren't brought back; a window with only private tabs doesn't come back.
- [ ] **L13.7** With no glasshouse running, `glasshouse ~/Downloads` → one window on Downloads, and your saved windows don't open. Then start glasshouse from the launcher → the saved windows open beside it. Ctrl+Q and start → all of them come back, the Downloads window too.
- [ ] **L13.8** **Shared settings:** two windows. Change the theme and the zoom in one → the other follows at once. Pin a folder, tag a file and add a remote in one → the other's sidebar shows them.
- [ ] **L13.9** A terminal open in each of two windows. Close one window → its shell ends (`pgrep -a bash` or your shell), and the other window's terminal keeps working. A long copy with the progress tray in one window → the other window's tray doesn't show it.
- [ ] **L13.10** Move tabs between three windows (L9.11, L9.12), then Ctrl+Q and start → every tab comes back in the window it was moved to, once, and the private ones don't come back.

## L14. Copy, Cut and Paste with other apps

Copy, Cut and Paste use the desktop's clipboard, so they work with the file manager, with other apps and between glasshouse windows. Run on each desktop: the automated run covers X11 only (xclip under Xvfb), so **on Wayland every line is a first check**.

- [ ] **L14.1** **Out:** select two files and a folder (one name with spaces and accents), Ctrl+C, then Ctrl+V in Nautilus (GNOME 43 or later), Dolphin, and one of Thunar, Nemo or Caja → all copied, names intact; the originals stay.
- [ ] **L14.2** Ctrl+X on a file → its row dims. Ctrl+V in the file manager → the file moves. Back in glasshouse the file is gone from the list; Ctrl+V in another folder says "nothing to paste: 1 item no longer there".
- [ ] **L14.3** Copy a file in glasshouse and paste into a terminal and a text editor → its path. Into a mail or a chat app (Thunderbird, a browser's upload field with Ctrl+V) → it's attached where the app takes files.
- [ ] **L14.4** **In:** Ctrl+C on files in the file manager, Ctrl+V in glasshouse → copied. A name that exists → asked whether to replace, keep both or skip. Ctrl+Z undoes the paste.
- [ ] **L14.5** Ctrl+X in the file manager, Ctrl+V in glasshouse → the files move. Ctrl+V a second time → "nothing to paste: … no longer there".
- [ ] **L14.6** **Honest cut:** Ctrl+X on a file in glasshouse, then copy some text in another app → the row is no longer dimmed (on Wayland: at the latest when glasshouse has the focus again), and the file is where it was.
- [ ] **L14.7** **Between windows:** two glasshouse windows. Ctrl+X in one (the row dims in both, when both show the folder), Ctrl+V in the other → the file moves, no row is dimmed, and Ctrl+Z in the window that pasted moves it back. The same with Ctrl+C → a copy.
- [ ] **L14.8** Cut two files and paste where one of the names exists, then choose Skip → one moves; the skipped one is still dimmed and can be pasted elsewhere.
- [ ] **L14.9** **Text:** Copy Path (Ctrl+Shift+C), then paste in an editor → the path. The same for the right-click menu's Copy as Command, a checksum from Properties, and the preview pane's copy button.
- [ ] **L14.10** Copy files in a remote folder of the file manager (`sftp://`, `smb://`) or in its Trash, Ctrl+V in glasshouse → a note that the items aren't on this computer; nothing is pasted.
- [ ] **L14.11** **After closing:** copy files in glasshouse, close every glasshouse window, then Ctrl+V in the file manager. With a clipboard manager running (GNOME and KDE have one built in; on X11 xfce4-clipman, Klipper, clipit) the files should still paste: note the desktop where they don't.
- [ ] **L14.12** **Nautilus 42 or earlier** (Ubuntu 22.04): files copied there paste in glasshouse. Files copied in glasshouse don't paste there (a known limit: that Nautilus reads only its own text form); dragging works.

## L15. Linked folders and FAT drives

- [ ] **L15.1** `ln -s ~/Documents ~/docs-link`, then Go to Path `~/docs-link` and open a subfolder → the breadcrumb and the tab stay under `docs-link` (before, the subfolder opened under `Documents`). Back, Up and a new tab from there agree.
- [ ] **L15.2** In that linked folder: tag a file, pin a subfolder, rename a file, cut and paste one into a subfolder, Move to Trash; Ctrl+Z and Ctrl+Y after each → each works as in any folder, and the tag follows the file each time. A file made there from a terminal shows up without a refresh. In a linked git repository the status column fills in.
- [ ] **L15.3** Reveal in File Manager on a file in the linked folder → the file manager opens with the file selected.
- [ ] **L15.4** A file tagged in the linked folder by an earlier build → its tag shows when the folder is opened by its real path, and under TAGS in the sidebar; note that it does not show through the link.
- [ ] **L15.5** On a FAT or exFAT USB stick, and on an SMB share: New File, Rename and Bulk Rename to `a:b`, `what?`, `x.` and `CON` → each is refused with a reason ending "on this drive". The same names in the home folder → accepted.
- [ ] **L15.6** Split the view with one pane on `~/docs-link` and the other on `~/Documents`. Drag a file from one pane to the other → a toast says it is already there; no "already exists" question, and nothing goes to the trash. With Ctrl held → a copy named `… (copy)`.

## L16. Screen reader (Orca) and keyboard only

Orca on GNOME (Super+Alt+S turns it on and off) or `orca` in a terminal elsewhere; note Orca's and WebKitGTK's versions. WebKitGTK builds its own accessibility tree, and no automated check reads it: CI checks Chromium's tree for the same pages (`pnpm site:capture a11y`), and WebKitGTK's was read once by a script (`docs/plans/completed/a11y.md`), with no screen reader. So what's read here is the first real test on Linux. Use a folder of a few thousand files for L16.3.

- [ ] **L16.1** Start glasshouse with the screen reader running → it says the window, then the file list ("Files in <folder>", a grid or table) and the first row. No click is needed first.
- [ ] **L16.2** ↓ and ↑ in the file list → each row is read: its kind for a folder, name, size and date, and "selected". Shift+↓ → the added row is read as selected. Ctrl+A → no long silence or freeze in a folder of a few thousand files.
- [ ] **L16.3** A folder of a few thousand files: End, Home, Page Down → the row landed on is read each time, with its place ("row 3,000 of 3,001" or the like), not a wrong row or nothing.
- [ ] **L16.4** Enter on a folder → "<folder>: N items" is said, then rows read as before. Backspace or Alt+↑ → the parent is said the same way.
- [ ] **L16.5** Home, then ↑ → the focus goes to a column header, read with its sort ("name, sorted ascending"). ← and → read the other headers. Enter → "sorted by …, descending" and the header's sort changes. ↓ → back in the rows.
- [ ] **L16.6** Ctrl+3 (Icons), Ctrl+4 (Tiles), Ctrl+5 (Grid) → the list is read as a list of items; each item's name, ", folder" for a folder, and "selected". Ctrl+1 goes back.
- [ ] **L16.7** Ctrl+T twice, then Ctrl+Tab → the tab shown is said. Ctrl+\\ (split) → the focus is still in a file list, named "…, pane 1" or "pane 2"; Ctrl+F6 moves to the other and says its name.
- [ ] **L16.8** F2 → "rename" dialog, its question and the field are read; typing works; Esc closes it and the focus is back on the same row. An empty name and Enter → the error is read at once.
- [ ] **L16.9** Shift+Delete → the question is read without moving ("Permanently delete 1 item?"), the focus is on a button, Tab stays inside the dialog (it never reaches the file list behind), Esc cancels.
- [ ] **L16.10** Ctrl+P → "Command palette", an edit field; ↓ reads each command with its shortcut; typing filters and the number of results is said; Esc gives the focus back to the file list.
- [ ] **L16.11** Ctrl+, → "preferences" dialog. Tab reaches the filter, the categories and the settings; a category reads as current; a filter with no match says "No settings match …". Help → About and Help → Keybindings Cheatsheet read as dialogs with names.
- [ ] **L16.12** Copy a file (Ctrl+C, Ctrl+V in another folder), then delete it → each toast (what was copied, what went to the trash) is read once, without the focus moving.
- [ ] **L16.13** With the screen reader's own navigation (Orca's flat review, or structural navigation where it's on): the tab bar reads as tabs with "Close tab <name>" buttons and a "New tab" button; the window buttons read "Minimize", "Maximize" or "Restore", "Close"; the toolbar's buttons and the breadcrumb ("Folder path") have names in words; no control is read as a lone symbol. Note any that is.
- [ ] **L16.14** The same way, in the Inspector (View → Inspector, a file selected): "edit permissions" is a button; after it, each permission is a checkbox that Space toggles; "apply" and "cancel" are buttons.
- [ ] **L16.15** Keyboard only, no screen reader: after any dialog, the palette, a menu (Alt, Esc) or a split, ↓ moves in the file list at once. Note any step after which the arrow keys do nothing until a click.
- [ ] **L16.16** Known gaps, to note but not report: Tab moves between the sidebar, the file lists and the terminal, so the toolbar, the Inspector and the status bar are reached with the screen reader's own navigation, not Tab; the sidebar's rows have no tree roles yet; Miller Columns' side columns and the terminal's text aren't read.
- [ ] **L16.17** A German or Nordic keyboard layout (Settings → Keyboard): Ctrl+# (German: the key left of Enter) or Ctrl+' (Nordic) → the view splits, as Ctrl+\\ does on a US layout. Ctrl+AltGr+ß or Ctrl+AltGr++ may or may not; the menu item always does.
- [ ] **L16.18** Settings → Accessibility → High Contrast, with glasshouse's theme on System → a high-contrast theme is used; the focused row, the selected rows and the focused tab are each clearly marked.
- [ ] **L16.19** Settings → Accessibility → Reduce Animation, with Preferences → effects → motion on "system" → menus and dialogs appear at once, with no fade or slide.
