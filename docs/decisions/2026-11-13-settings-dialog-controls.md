# Preferences uses no native dropdowns (settings-dialog, 2026-11-13)

## Problem
The Tweaks panel's `<select>`s opened a white list on the dark themes.
WebKitGTK draws an open `<select>` list with GTK, in the UI process, so
page CSS can't color it. Only the GTK theme can, and the app's dark or
light preference reaches it only through the window.

## Decision
- The Preferences dialog draws every control in the app's colors:
  - theme is a grid of swatches, each button carrying its own `data-theme`
    so it shows that theme's colors;
  - font family is a list of buttons, each in its own font;
  - density and the on/off settings are segmented buttons;
  - zoom is −, +, reset.
- Each theme in `themes.css` sets `color-scheme`. App passes it to the
  window (`setTheme`, `core:window:allow-set-theme`), which on Linux sets
  GTK's dark preference, so GTK popups such as a text field's context menu
  follow the theme. WebView2 takes `color-scheme` for its own controls.
- A base `select`/`option` style in `app.css` covers any `<select>` added
  later. The Tweaks panel's two were the app's only ones.

## Rejected
- **Restyled `<select>`s with `color-scheme`:** the list WebKitGTK opens
  would still follow the GTK theme, so it stays light wherever that theme
  is light.
- **A custom dropdown component:** more code to get right for keyboard
  use and positioning. With 6–8 choices, showing all of them reads better
  in a settings dialog anyway.
