# Manual test checklists

CI checks a lot, but not everything. These lists are the rest: what needs a real desktop, a real installer, another app or a person looking.

- [windows.md](windows.md): both installers, the native pickers, drag and drop with Explorer, keyboard menus, Snap at 150%, terminal profiles including WSL, Reveal, the Recycle Bin, the folder setting.
- [linux.md](linux.md): the .deb and the AppImage on Ubuntu 22.04 and Debian 12, GNOME and KDE on Wayland and one X11 desktop, the portal and GTK pickers, the open and save dialog switch, drag and drop with Nautilus and Dolphin, fractional scaling, Reveal, default apps, the trash.

## What CI already covers

- **Unit tests:** `pnpm test` (the frontend) and `cargo test` (the backend) on Linux, Windows x64 and Windows on Arm.
- **End-to-end smoke test** (`e2e/`, on ubuntu-22.04 under Xvfb and on windows-latest, with debug builds): the window opens with no error and fits the screen, a path typed into Go to Path lists, the sidebar shows the drives and known folders, a first run pins the known folders (Linux only), and nothing throws.
- **Installers job** (windows-latest, debug builds): installs the setup.exe and the MSI silently, turns "Open folders with glasshouse" on, uninstalls, and checks that the registry is clean.
- **Integration and dialogs** were run on a private D-Bus with scratch home folders, never in a real login ([docs/INTEGRATION.md](../INTEGRATION.md#what-was-tested)).

So nothing in CI uses a real desktop session, a display scale other than 100%, another app's drag and drop, an interactive installer, an upgrade from an older release or a release build on Windows.

## How to run a checklist

1. **Use a test machine or account.** A virtual machine, or a separate user account, is best: the integration settings change your desktop's defaults (turning them off puts them back, but a failed test might not).
2. **Make a test folder** and work in it, never in folders that matter. It's useful to have in it:
   - a few files of each preview type: text, an image, a PDF, an audio file;
   - a folder with a few thousand files;
   - a git repository with a changed, a staged and an untracked file;
   - names with spaces, accents, an emoji, and on Linux a leading dot;
   - a `.zip` and a `.7z`, and a symbolic link (on Windows, a shortcut and a junction too).
3. **Note what you're testing:** the glasshouse version (Help → About), which package, the OS and its version, the processor (x64 or Arm), the display scale, and on Linux the desktop and session (`echo $XDG_CURRENT_DESKTOP $XDG_SESSION_TYPE`).
4. **Work through the list.** Each item says what to do and, after the →, what should happen. Mark it pass, fail, or skipped (and why).
5. **Report the results.** A failure is worth a [bug report](https://github.com/Johnson-Anthony/glasshouse/issues/new/choose) of its own; give its number from the checklist (such as "W4.2"). A full run can go in one issue: copy the list, tick what passed, and note the rest.

Items marked *(planned)* are for features still being built. Skip them until the release notes list the feature.

## Keeping the lists current

When a change adds something only a person can check, add it here in the same pull request. New items come from `CHANGELOG.md`'s Unreleased section and from what a change's notes say wasn't run.
