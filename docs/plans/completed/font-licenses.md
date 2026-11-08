# font-licenses

Branch: `claude/silly-hertz-cfba21` (same worktree). Task: `font-licenses` in `docs/plans/active/survey-fixes.md`. The lead said to implement and to record the woff2 choice in docs/decisions/.

## Findings
- The four `JetBrainsMonoNerdFont-*.ttf` files are **byte-identical to Nerd Fonts v3.2.1 `JetBrainsMono.tar.xz`** (sha256 of all four match). Their name table says JetBrains Mono 2.304 + Nerd Fonts 3.2.1.
- That archive ships `OFL.txt`, identical to the JetBrains Mono OFL already in the repo, and a `README.md`.
- The Nerd Fonts repo at tag v3.2.1 has:
  - `LICENSE`: patched fonts under OFL, the project's own code under MIT;
  - `license-audit.md`: the license of each glyph set;
  - license files in 8 of the glyph-set folders.
- Five glyph sets have no license file in Nerd Fonts: Devicons, Font Awesome Extension, Font Logos, IEC Power Symbols and Seti-UI (the "original source" set). Their upstream repos have one: MIT for four, Unlicense for Font Logos.
- **woff2 measured:** 9.15 MB of TTF becomes 3.70 MB, lossless. Outlines and hinting are identical for every glyph, and every other table is byte-identical. Tauri already brotli-compresses embedded assets, so the release binary saves less: about 4.5 MB → 3.7 MB.

## Approach
- **Licenses in `src/assets/fonts/nerd-fonts/`:**
  - the release's `README.md`;
  - the repo's `LICENSE.md` and `license-audit.md`;
  - `glyphs/` with the 8 glyph-set license files from the tag;
  - `upstream/` with the 5 licenses from the glyph sets' own repos.
- **`src/assets/fonts/LICENSES.md`:** an index of every bundled font file, with its source release and the license files that cover it.
- **Convert the four TTFs to woff2** (`fonttools ttLib.woff2 compress`) and point the `@font-face` rules at them. JetBrains Mono has no Reserved Font Name, and the primary name "JetBrainsMono NF" doesn't use Pomicons' RFN, so the conversion is allowed even though the OFL counts a format change as a Modified Version.
- **`offline.test.ts`:** every font file in `src/assets/fonts` is listed in `LICENSES.md`, and every file `LICENSES.md` links to exists.
- **Cross-branch note for the lead:** pages-site's `site/subset-fonts.sh` reads `src/assets/fonts/JetBrainsMonoNerdFont-$v.ttf`. After this merges it needs `.woff2` (pyftsubset reads woff2, given brotli, which the script already loads).

## Status
Done 2026-11-08. Decision: `docs/decisions/2026-11-08-font-licenses-nerd-font.md`.
- [x] License files and `src/assets/fonts/LICENSES.md`. Beyond the plan: the Apache 2.0 text for Material Design Icons, whose notice only links to it.
- [x] woff2 conversion, verified lossless with fontTools. app.css now points at the woff2 files.
- [x] Tests: 2 new in `offline.test.ts`. Checked that both fail on an unlisted font file and on a stray license file.
- [x] Decision note.
- [x] Checks:
  - `pnpm build`: OK; dist/ is 6.7 MB with no TTF.
  - `pnpm test`: 157 passed.
  - `pnpm check:wiring`: 0 issues.
  - The built-in browser, against `vite preview` of dist/, loaded all 12 faces with only localhost requests.
  - No cargo or tauri dev.

## For review
- **The default font file changed format.** In the release build, check that the UI, the icons in the sidebar, tree and status bar, and the terminal's Nerd Font glyphs render as before. WebKitGTK and WebView2 both read woff2, but only Chromium was tried here.
- **pages-site:** `site/subset-fonts.sh` needs `.ttf` → `.woff2` once both branches are merged.
- **The installed app has no notices screen.** Licenses are in the source tree, plus the fonts' embedded copyright and license-URL metadata. An About → third-party notices view could be a follow-up.
