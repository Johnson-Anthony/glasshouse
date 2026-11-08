# local-fonts

Branch: `claude/silly-hertz-cfba21` (same worktree as command-security). Task: `local-fonts` in `docs/plans/active/survey-fixes.md`. The lead said to implement without waiting for an OK and to record the choice in docs/decisions/.

## Problem
`index.html` loads JetBrains Mono (400/500/600), IBM Plex Mono (400/500/600) and Fira Code (400/500) from Google Fonts for the tweaks font picker. So every app start sends a request to Google, and the CSP must allow `fonts.googleapis.com` and `fonts.gstatic.com`. The default font, JetBrainsMono Nerd Font, is already bundled.

## Approach
- **Bundle the upstream woff2 files unmodified**, the same eight weights Google served:
  - JetBrains Mono v2.304, from `fonts/webfonts/`;
  - IBM Plex Mono 2.5.0 (`@ibm/plex-mono@2.5.0`), from `fonts/complete/woff2/`;
  - Fira Code 6.2, from `woff2/`.
  - All are from the projects' GitHub releases, 636 KB in total, under `src/assets/fonts/`, each with its OFL text.
- **Not subsets, after measuring.** Subsetting to the scripts Google served saved only about 10% (JetBrains Mono 85 → 73 KB). It would drop symbols a terminal font should keep. And a subset is a Modified Version under the OFL, which IBM Plex's Reserved Font Name "Plex" forbids shipping under that name.
- **`@font-face` rules in `src/styles/app.css`, next to the Nerd Font's.** A browser fetches an `@font-face` file only when text actually uses that family, so each font loads (from the bundle) only once the picker selects it. No JS is needed. `font-display: swap`, as Google's `display=swap` did.
- **Remove the Google `<link>`s from `index.html`** and the Google origins from the CSP in `tauri.conf.json`.
- **Add a vitest guard:** no third-party origin in `index.html` or the CSP, and every font file `app.css` references exists.

## Status
Done 2026-11-08. Decision: `docs/decisions/2026-11-08-local-fonts-bundled.md`.
- [x] Fonts and licenses in src/assets/fonts: 8 upstream woff2 files (636 KB) and 3 OFL texts.
- [x] @font-face rules in app.css; Google links removed from index.html; Google origins removed from the CSP.
- [x] Test: `src/offline.test.ts` (4 tests).
- [x] Decision note. The command-security note's Google Fonts line now points to it.
- [x] Checks:
  - `pnpm build`: OK. dist/ has the 8 woff2 files and no Google reference.
  - `pnpm test`: 155 passed.
  - `pnpm check:wiring`: 0 issues.
  - No cargo or tauri dev, as the lead asked.

## For review
- The CSP change only shows in a Tauri build. Check at merge that the picker's JetBrains Mono, IBM Plex Mono and Fira Code still render, from the bundle, in the release build.
- Picker fonts now use exactly the upstream release files. Google may have served slightly different builds; for example, IBM Plex Mono is now 2.005 from the 2.5.0 release.
- The bundled Nerd Font TTFs still have no license file in the repo. That gap predates this task; a follow-up could add the Nerd Fonts / OFL texts, or swap the 9 MB of TTFs for woff2.
