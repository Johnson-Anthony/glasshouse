# Task 47: themes-and-cosmetics

Scope: §47 of `docs/plans/active/survey-3.md` (owner decision D4). Frontend only.

## Status
| Step | What | Status |
|---|---|---|
| 1 | Theme data: `themes.ts` metadata, 31 new themes in `themes.css` (light, dark, high contrast), `contrast.ts`, WCAG test | done |
| 2 | `look.ts`: the look settings, defaults, the classic look for saved settings, presets, sanitizing, applying to `<html>` | done |
| 3 | `userThemes.ts`: custom themes store, validation, CSS, import/export JSON | done |
| 4 | App: load/migrate, System theme (OS light/dark), accent, window theme, maximized flag; Switch Theme | done |
| 5 | CSS: tokens for radius, shadows, fonts, text size; window controls, frame, tabs, borders, sidebar, toolbar; icon sets, list options; effects; forced-colors; reduced motion | done |
| 6 | Preferences → Appearance: categories, filter, presets, reset, live preview, theme picker, accent, typography, chrome, file list, effects; theme editor | done |
| 7 | Tests, demo (`?look=`), capture screenshots, docs, decisions | done |

Done on 2026-11-20, on branch `claude/elegant-euler-fb95a5`. Checks: `pnpm build`, `pnpm test` (70 files, 1036 tests), `pnpm check:wiring` (0/0/0), `pnpm notices --check`, `pnpm site:build` (demo rebuilt; the demo's font subsets now include the Nerd Font icon set's glyphs), `pnpm site:capture check`. No Rust change, no new dependency.

Not verified here: Windows (forced-colors, the Windows window buttons and `setTheme(null)` in a real window) and the System switch inside the Linux app (WebKitGTK's live `prefers-color-scheme` was checked on its own, not in glasshouse).

Follow-ups:
- The landing page offers the original eight themes only; light chips and hero images in the new default look would show the new range.
- A "transparent window" setting (Mica on Windows 11), and Snap Layouts on the maximize button: both need Rust (`2026-11-20-themes-transparency.md`).
- Task 38 (a11y): the new window buttons are real `<button>`s out of the Tab order; Preferences' nav and filter may want its review.

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
