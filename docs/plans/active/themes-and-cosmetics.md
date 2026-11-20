# Task 47: themes-and-cosmetics

Scope: §47 of `docs/plans/active/survey-3.md` (owner decision D4). Frontend only.

## Status
| Step | What | Status |
|---|---|---|
| 1 | Theme data: `themes.ts` metadata, ~30 new themes in `themes.css` (light, dark, high contrast), `contrast.ts`, WCAG test | todo |
| 2 | `look.ts`: the look settings, defaults, the classic look for saved settings, presets, sanitizing, applying to `<html>` | todo |
| 3 | `userThemes.ts`: custom themes store, validation, CSS, import/export JSON | todo |
| 4 | App: load/migrate, System theme (OS light/dark), accent, window theme, maximized flag; Switch Theme | todo |
| 5 | CSS: tokens for radius, shadows, fonts, text size; window controls, frame, tabs, borders, sidebar, toolbar; icon sets, list options; effects; forced-colors; reduced motion | todo |
| 6 | Preferences → Appearance: categories, filter, presets, reset, live preview, theme picker, accent, typography, chrome, file list, effects; theme editor | todo |
| 7 | Tests, demo (`?look=`), capture screenshots, docs, decisions | todo |

## Design
- **Everything cosmetic is CSS on `<html>`** (data attributes and custom properties), set by one effect in App. The file list's rows get no new props; they only gain static attributes (`data-ft` file type, `data-git`), so a theme or look change re-renders no row.
- **Themes stay CSS blocks** in `themes.css` (the landing page and the demo use them); `themes.ts` lists id, label, scheme and group. `data-theme` always holds the concrete theme, also in System mode, so the site's checks keep working.
- **System** (`theme: "system"`, the new default) picks `lightTheme` or `darkTheme` from `prefers-color-scheme`. The window follows the OS: on Windows `setTheme(null)`; on Linux tao already follows the portal's color-scheme, and after an explicit theme the app resets with `setTheme(null)` then sets what `theme()` reports. `prefers-contrast: more` picks the high-contrast pair.
- **Saved settings from before** (no `lookVersion`) get the classic look for every new key, so nothing changes for existing users; new users get the new defaults. Old theme ids all still exist.
- **Custom themes** live in `localStorage["glasshouse.themes.v1"]`, applied as `[data-theme="user-…"]` blocks in one injected `<style>`. Imports accept only hex colors and known tokens (nothing else reaches CSS).
- **No window transparency** (needs `transparent: true` at window creation and native blur; see the decision). Snap Layouts on hover need native hit-testing; Win+Z still works.
- No Rust changes, no new dependencies.

## Decisions
- `docs/decisions/2026-11-20-themes-system-and-defaults.md`
- `docs/decisions/2026-11-20-themes-custom-format.md`
- `docs/decisions/2026-11-20-themes-transparency.md`
