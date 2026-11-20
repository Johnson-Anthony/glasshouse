# themes-and-cosmetics: no window transparency, frosted menus instead

Date: 2026-11-20. Task: `themes-and-cosmetics` (survey-3 task 47). The task said to offer transparency only where the platform supports it, after checking.

## What was checked
- **A see-through window** needs `transparent: true` when the window is created (`tauri.conf.json` or the window builder). It can't be turned on later, so a setting would need a restart, and with it on, every opaque pixel must be painted by the page.
- **Blur behind it** (Mica or Acrylic on Windows 11) needs the `window-vibrancy` crate or `set_effects` on the Rust side, with a transparent window. On Windows 10 Acrylic lags when the window moves. On Linux nothing blurs: whether the desktop shows through depends on the compositor (GNOME's doesn't blur; KDE's can, per window rule), and WebKitGTK only composites alpha when the GTK window has an RGBA visual.
- **WebKitGTK** supports `backdrop-filter`, `color-mix()` and `oklch()` (checked in a WebKitGTK 2.54 window under Xvfb), so blur inside the page works on both platforms. (The same check found its `prefers-color-scheme` follows GTK's dark preference live, which System relies on.)

## Chosen
- **No window transparency** in this task: it's a Rust and config change while other Rust tasks were running, it needs a restart to apply, and on Linux the result varies by desktop.
- **"Frosted menus"** (Preferences → effects, off by default): menus, the palette and dialogs get `backdrop-filter: blur()` over a translucent background, so the app shows through them. Same on both platforms, no Rust.
- **Snap Layouts** (the Windows 11 flyout on hovering Maximize) needs the window's maximize button to answer `WM_NCHITTEST` with `HTMAXBUTTON`, which a webview button can't. Win+Z and dragging to the screen's edges still work. Not done here.

## Follow-up, if wanted
A "transparent window" setting: `transparent: true` behind a setting read at startup, `window-vibrancy` for Mica on Windows 11, the app's backgrounds through `color-mix(… transparent)` while it's on, and a note that it applies after a restart.
