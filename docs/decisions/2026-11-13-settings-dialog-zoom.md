# Zoom is the webview's page zoom (settings-dialog, 2026-11-13)

## Problem
Zoom In/Out/Reset set `--fs-base` on `<html>`. `[data-density]` sets it
again, about 80 rules use fixed `px` font sizes, every dialog sizes its text
inline in `px`, row heights (`--row-h`), icon sizes and the terminal's font
are `px` too, so only the Inspector followed.

## Options
1. **rem sizes everywhere**: convert the CSS, the dialogs' inline styles, the
   row heights the file list's windowing reads, and the terminal's font size
   to follow one root size. A large diff across files other branches share,
   and anything added later in `px` stops scaling.
2. **CSS `zoom` on `<html>`**: scales everything, but event coordinates
   (`clientX`) aren't zoomed while `left: Npx` is, so context menus, drag
   ghosts and the marquee land in the wrong place.
3. **The webview's page zoom** (`getCurrentWebview().setZoom`, WebKitGTK's
   zoom level, WebView2's zoom factor): a browser's Ctrl+=. Layout, events
   and measurements all stay in CSS pixels, which just get bigger.

## Decision
Option 3.
- `src/zoom.ts` holds the steps: 50, 67, 75, 80, 90, 100, 110, 125, 150, 175
  and 200%.
- The factor is `zoom` in the saved tweaks (`glasshouse.tweaks`), so it lasts
  across restarts and moves with Export/Import Layout. App applies it when it
  changes, then fires `resize` so the terminal refits.
- The capability needs `core:webview:allow-set-webview-zoom`.
- Density keeps `--fs-base` and `--row-h`, and zoom multiplies whatever
  density sets.
- The old `glasshouse.zoom` key held a font size that only the Inspector
  followed. It's removed on start, not migrated: turning it into a
  whole-window zoom would surprise anyone who pressed Ctrl+= and saw almost
  nothing change.

## Consequences
- **Drops from other apps.** Tauri reports their position in physical
  pixels. WebView2's `devicePixelRatio` includes the page zoom, but WebKit's
  doesn't. `OsDrop` now divides by the window's scale factor times the zoom.
  That works on both engines, where dividing by `devicePixelRatio` alone
  would be wrong on Linux at any zoom other than 100%.
- **The browser demo** can't zoom its own page that way. Its mock answers
  the zoom call with a notice that points to the browser's zoom, and the
  setting is still saved in the demo's memory storage. CSS `zoom` was left
  out for the reason under option 2.
- **PDF previews.** They render at `devicePixelRatio`, so on WebKit at a zoom
  above 100% they're drawn at screen resolution and scaled up, and look
  slightly soft. Not changed.
