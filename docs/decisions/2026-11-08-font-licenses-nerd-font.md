# JetBrainsMono Nerd Font: license notices, and woff2 instead of TTF

Date: 2026-11-08 · Task: `font-licenses` · Picked by the task session (the lead said to choose and record), on the plan in `docs/plans/completed/font-licenses.md`.

## What the files are
- The four `JetBrainsMonoNerdFont-*.ttf` files bundled since April were byte-identical to the Nerd Fonts **v3.2.1** release `JetBrainsMono.tar.xz` (sha256 `6cf8822b…4006`). All four file hashes match.
- Their name table says JetBrains Mono 2.304, patched by Nerd Fonts 3.2.1. JetBrains Mono has no Reserved Font Name.

## Licenses added
`src/assets/fonts/LICENSES.md` indexes every bundled font file, with its source and the license texts that cover it. For the Nerd Font:
- **The font** (JetBrains Mono and the patched font) is under OFL 1.1, covered by `OFL-JetBrainsMono.txt`, which is identical to the archive's `OFL.txt`. The archive's `README.md` is in `nerd-fonts/`.
- **The Nerd Fonts project**, from the repo at tag v3.2.1: `nerd-fonts/LICENSE.md` (patched fonts under OFL, its own code under MIT) and `nerd-fonts/license-audit.md` (the license of each glyph set).
- **Glyph sets with a license file in the Nerd Fonts repo** are copied from the tag into `nerd-fonts/glyphs/`: Codicons (CC BY 4.0), Font Awesome (CC BY 4.0 icons), Material Design Icons (Apache 2.0), Octicons (MIT), Pomicons (OFL), Powerline Extra (MIT), Powerline Symbols (MIT-style) and Weather Icons (OFL).
- **Glyph sets with no notice in the Nerd Fonts repo:** `license-audit.md` names the license, and the text is taken from each project's own repo into `nerd-fonts/upstream/`: Devicons, Font Awesome Extension, IEC Power Symbols and Seti-UI (all MIT), and Font Logos (Unlicense). MIT requires the notice to travel with copies, and Nerd Fonts doesn't ship these.
- **Apache 2.0 text for Material Design Icons:** `nerd-fonts/upstream/materialdesign-Apache-2.0.txt`. The Pictogrammers notice only links to the license, and Apache 2.0 §4(a) asks redistributors to include a copy.
- **Guard:** `src/offline.test.ts` now fails if a font file in `src/assets/fonts` isn't listed in `LICENSES.md`, if a linked license file is missing, or if a license file in the folder isn't linked.

## Decision: ship woff2, converted losslessly
The four TTFs (9.15 MB) are replaced by `fonttools ttLib.woff2 compress` output (3.70 MB). Checked with fontTools:
- every glyph's outline, composite structure and hinting instructions are identical;
- the 15 other tables are byte-identical;
- `glyf`, `loca` and `head` are rebuilt, as the woff2 format requires.

A Chromium engine (the built-in browser, against `vite preview` of the build) loaded all 12 bundled faces, and the Nerd Font's icon glyph U+F07B checks as present.

Why convert:
- `dist/` shrinks by 5.4 MB, to 6.7 MB in all, and so does the working tree.
- The release binary saves less, about 0.8 MB. Tauri already brotli-compresses embedded assets (brotli on the TTFs: 4.50 MB at quality 9), but woff2's glyph transforms still beat that.
- Both webviews read woff2: WebView2 (Chromium) and WebKitGTK. The frontend build already targets safari13 / chrome105.

Why it's allowed: the OFL counts a format change as a Modified Version, and the only restriction on a Modified Version is the Reserved Font Name. JetBrains Mono has none. The font's primary name, "JetBrainsMono NF", doesn't use Pomicons' RFN, which binds only the primary font name.

Rejected:
- **Keep the TTFs:** 5.4 MB of `dist/` for nothing.
- **Subset the Nerd Font** (what pages-site does for its web demo): unlike a web page, the app can't know which icons terminal output or file names will need.

## Consequences
- **pages-site's `site/subset-fonts.sh`** (on its branch) reads `src/assets/fonts/JetBrainsMonoNerdFont-$v.ttf`. Once both are merged, it needs `.woff2` there. pyftsubset reads woff2 input, given brotli, which the script already installs.
- **Updating the font** means taking the new Nerd Fonts release's TTFs, running `fonttools ttLib.woff2 compress` on each, and refreshing `nerd-fonts/` and `LICENSES.md` from that release's tag.
- **Not covered:** the license texts live in the source tree. The installed app carries only the fonts' embedded copyright and license-URL metadata, not a notices screen. An About → third-party notices view would close that, if wanted.
