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
Done 2026-11-13. Commits: 94d9cff (the task), 1d10b70 (merge of main at
3abc775), 4c12081 (focus stays on the control used), 8bdd4dc (demo rebuild). Decisions: `docs/decisions/2026-11-13-settings-dialog-zoom.md`,
`docs/decisions/2026-11-13-settings-dialog-controls.md`.
- [x] Zoom: webview zoom, 50–200%, saved as `zoom` in `glasshouse.tweaks`;
  OsDrop divides by scale factor × zoom; the demo answers with a notice.
- [x] Preferences dialog (Edit → Preferences…, Ctrl+,); the Tweaks panel,
  its ◉ button, View → Tweaks and the `tweaks` key action are gone. The View
  menu's toggles show their state (test in `menus.dom.test.tsx`).
- [x] `color-scheme` on each theme, passed to the window (`setTheme`); no
  native `<select>` left in the app; a base `select` style for later ones.
- [x] Checks: `pnpm build`, `pnpm test` (776 passed, 3 skipped),
  `pnpm check:wiring`, clippy `-D warnings` and `cargo test` (214 passed;
  only `capabilities/default.json` changed under `src-tauri/`),
  `pnpm site:build` and `pnpm site:capture check` (24/24), release binary.

Not checked here:
- WebKitGTK and WebView2 by hand: the zoom, the window theme, and drops
  from other apps at a zoom other than 100%. The demo runs in Chromium.
- `docs/media` (hero images and tour clips) still shows the old ◉ button;
  re-recording them (`pnpm site:capture`) is left to the lead.
