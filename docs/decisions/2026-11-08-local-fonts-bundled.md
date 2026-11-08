# Font picker fonts: bundled upstream woff2, no Google Fonts

Date: 2026-11-08 · Task: `local-fonts` · Picked by the task session (the lead said to choose and record), on the plan in `docs/plans/completed/local-fonts.md`.

## The problem
`index.html` loaded JetBrains Mono (400/500/600), IBM Plex Mono (400/500/600) and Fira Code (400/500) from Google Fonts for the tweaks font picker. That meant:
- a request to Google at every start, even though only the picker uses these fonts (the default, JetBrainsMono Nerd Font, was already bundled);
- `fonts.googleapis.com` and `fonts.gstatic.com` in the CSP.

## Decision: bundle the projects' own woff2 files, unmodified
The same eight weights Google served are now in `src/assets/fonts/`, each family with its OFL text (`OFL-*.txt`):

| Font | Release | Files taken | zip sha256 |
|---|---|---|---|
| JetBrains Mono | v2.304, `JetBrainsMono-2.304.zip` | `fonts/webfonts/JetBrainsMono-{Regular,Medium,SemiBold}.woff2` | `6f6376c6…bbf` |
| IBM Plex Mono | `@ibm/plex-mono@2.5.0`, `ibm-plex-mono.zip` | `fonts/complete/woff2/IBMPlexMono-{Regular,Medium,SemiBold}.woff2` | `6d23f012…81c` |
| Fira Code | 6.2, `Fira_Code_v6.2.zip` | `woff2/FiraCode-{Regular,Medium}.woff2` | `0949915b…e79` |

All come from the projects' GitHub releases: 636 KB in total, against 9 MB for the Nerd Font TTFs already bundled. Fira Code's zip has no license file, so `OFL-FiraCode.txt` is the repo's `LICENSE`.

- **`@font-face` in `src/styles/app.css`** declares each face with `font-display: swap`, as Google's `display=swap` did.
- **Loading on demand comes free.** A browser fetches an `@font-face` file only when text is rendered in that family, so a picker font is read from the bundle the first time the picker selects it, and never otherwise. One exception: if text contains a character the Nerd Font lacks, the browser may also read the bundled JetBrains Mono, since the default stack lists it as the fallback. That's a local read, not a network request.
- **Removed:**
  - the Google `<link>` and `preconnect` tags from `index.html`;
  - `https://fonts.googleapis.com` from `style-src` and `https://fonts.gstatic.com` from `font-src` in `src-tauri/tauri.conf.json`.

  The CSP's only http(s) origins are now Tauri's own `asset.localhost` and `ipc.localhost`.
- **Guard:** `src/offline.test.ts` fails if `index.html` gains an http(s) URL, if the CSP gains a non-`*.localhost` origin, if a stylesheet `url()` points off-box or at a missing file, or if a picker family loses one of its faces.

## Rejected
- **woff2 subsets built with pyftsubset** (what pages-site does for its demo's Nerd Font):
  - Measured, subsetting to the scripts Google served (Latin, Latin Extended, Greek, Cyrillic, Vietnamese, plus symbols) saved only about 10% (JetBrains Mono Regular 85 → 73 KB, Fira Code 96 → 84 KB, Plex 45 → 42 KB). It would also drop symbols a terminal and file-name font should keep.
  - Under the OFL a subset is a Modified Version, and IBM Plex has the Reserved Font Name "Plex", so a subset couldn't be shipped as "IBM Plex Mono".
  - The upstream woff2 files need no tooling and keep each font's license and copyright in its name table.
- **Loading from Google only when the picker selects a font:** that still contacts Google, and still needs the CSP origins.
- **The `@fontsource/*` npm packages:** three dependencies whose CSS also ships `.woff` fallbacks, so the bundle would carry both formats. Committing the upstream files is just as reproducible, given the table above.

## Not checked here
The lead checks the CSP in the release build at merge. This session ran no cargo or `tauri dev`, because Rust builds were busy elsewhere. `pnpm build` shows the eight woff2 files in `dist/assets/` and no Google reference left anywhere in `dist/`.
