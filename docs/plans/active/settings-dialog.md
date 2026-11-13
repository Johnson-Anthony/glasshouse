# settings-dialog (task 29, survey-2)

User request 2026-11-13: zoom only scales the Inspector; replace the floating
Tweaks panel with real settings; dropdowns render white on dark themes.

## Plan
1. **Zoom scales the whole window** through Tauri's webview zoom
   (`getCurrentWebview().setZoom`), not rem sizes. Decision:
   `docs/decisions/2026-11-13-settings-dialog-zoom.md`.
   - New `src/zoom.ts`: the steps (50–200%), next/previous step, a check
     for saved values, and `applyZoom` (calls the webview, remembers the
     factor, fires `resize` so the terminal and lists refit).
   - The zoom becomes `zoom` in `TweakState` (saved in `glasshouse.tweaks`);
     Zoom In/Out/Reset (`handlers/view.ts`) step it. The old
     `glasshouse.zoom` key (a font size that only reached the Inspector) is
     dropped, not migrated, and `--fs-base` is no longer touched by zoom.
   - Capability `core:webview:allow-set-webview-zoom`.
   - `OsDrop.tsx`: physical → CSS pixels divides by scale factor × zoom
     (WebKit's `devicePixelRatio` leaves page zoom out; Chromium's has it).
   - Demo: the mock answers `set_webview_zoom` with a notice (CSS `zoom` on
     the page would misplace menus and drags); everything else unchanged.
2. **Preferences dialog replaces the Tweaks panel.**
   - New `src/dialogs/Preferences.tsx`, built like the other dialogs (modal
     flag, Esc / click outside / Ctrl+, close). Sections: Appearance (theme,
     font family, density, scanlines, zoom), Files (hidden files, file
     extensions, folders first, git gutters), Terminal (follow folder).
     Changes apply live through App's `setState`; nothing new in storage.
   - Edit → Preferences… and Ctrl+, open it. The View → Tweaks item, the
     `Tweaks` component, `tweaksOpen`, the ◉ button and the `tweaks` key
     action go. The View menu's toggles stay; check that their ✓ follows
     the dialog.
   - Wording: site comments that say "tweaks panel"; ARCHITECTURE.md.
3. **Dropdowns follow the theme.**
   - `color-scheme` on each theme in `themes.css` (all eight are dark), so
     native controls and scrollbars are dark; the window's theme is set to
     match (`setTheme`, capability `core:window:allow-set-theme`), so GTK
     popups (WebKitGTK draws a `<select>`'s list with GTK) follow too.
   - The dialog uses no native `<select>`: theme and font are lists of
     buttons drawn in the app's colors (the native popup can't be styled
     from CSS in WebKitGTK). A base `select`/`option` style covers any
     future one. The Tweaks panel's two were the app's only `<select>`s.

## Tests
- `zoom.test.ts`: steps, clamping, saved-value check.
- `Preferences.dom.test.tsx` (happy-dom): sections, each control updates
  state, Esc and Ctrl+, close.
- Routing/keymap/palette tests updated for the removed Tweaks label.
- View handler: Zoom In/Out/Reset step `zoom`.

## Status
- [ ] zoom
- [ ] Preferences dialog, Tweaks removed
- [ ] color-scheme, selects
- [ ] checks: build, test, wiring, clippy/test (capabilities), site build + capture check, release binary
