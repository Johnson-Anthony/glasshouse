# themes-and-cosmetics: custom themes and their file format

Date: 2026-11-20. Task: `themes-and-cosmetics` (survey-3 task 47).

## The problem
Users should be able to make their own themes, keep them, and share them as small files. A shared file comes from anyone, so nothing in it may reach the page except colors.

## Chosen
- **The editor** (Preferences → theme → your themes) starts from the theme on screen ("customize the current theme…") or a saved custom theme. It edits the 22 color tokens (`THEME_TOKENS`), with a color picker and a hex field each, a name and a scheme. The app shows the draft live under the id `user-draft` until it's saved or the editor closes. A contrast report runs the same checks as `themes.test.ts` and warns about each pair under WCAG AA; it doesn't refuse, since it's the user's theme.
- **Storage:** `localStorage["glasshouse.themes.v1"]`, `{ themes: [{ id, name, scheme, colors }] }`, at most 50. Ids are `user-` and a slug of the name. Each entry is checked again when loaded; a bad one is dropped.
- **On the page:** one `<style id="glasshouse-user-themes">` with a `[data-theme="user-…"] { color-scheme; --token: #rrggbb; … }` block per theme. Only the known tokens are written, each normalized to `#rrggbb`, so a value can't close the block or add a rule.
- **The file:** JSON, a few hundred bytes, named `<name>.glasshouse-theme.json`:
  ```json
  { "glasshouse-theme": 1, "name": "Night Shift", "scheme": "dark",
    "colors": { "bg-0": "#101418", "fg-0": "#e8eaed", "accent": "#4c9aff", … } }
  ```
  The `"glasshouse-theme": 1` key marks it and versions it. Import (`parseThemeFile`) refuses: not JSON, over 64 KB, no marker, no name, no colors, a missing token, or any value that isn't `#rgb`/`#rrggbb`. `on-accent` and `scheme` may be left out and are worked out from the colors. Unknown keys are dropped with a warning. The name loses control characters and is capped at 60.
- **Export** is a native Save dialog in the app (`pickSavePath`, then `write_text`); in the browser demo it copies the text. **Import** is a native Open dialog in the app, or pasting the text (both). Neither needed a new permission: `dialog:default` has save and `write_text`/`read_text` are already app commands.
- **A deleted theme that was in use** falls back to the default for the OS's scheme (`resolveTheme`).

## Rejected
- **Free-form CSS themes** (any property, gradients, fonts): a shared file could then restyle or hide anything, and the contrast check couldn't see what it does.
- **Theme files in the config folder** (a Rust command to list and watch them): a Rust change while other tasks were building, for little gain; settings already live in localStorage, and a file is one export away.
- **Named CSS colors and `rgb()`** in files: hex is what every palette site and editor gives, and one format keeps the check simple.
