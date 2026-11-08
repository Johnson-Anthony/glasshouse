# Bundled fonts: sources and licenses

Every font file in this folder, where it came from, and the license texts that cover it. `src/offline.test.ts` checks that each font file is listed here and that every linked file exists.

## JetBrainsMono Nerd Font (the default UI and terminal font)
Files:
- `JetBrainsMonoNerdFont-Regular.woff2`
- `JetBrainsMonoNerdFont-Bold.woff2`
- `JetBrainsMonoNerdFont-Italic.woff2`
- `JetBrainsMonoNerdFont-BoldItalic.woff2`

Source: Nerd Fonts [v3.2.1](https://github.com/ryanoasis/nerd-fonts/releases/tag/v3.2.1), `JetBrainsMono.tar.xz` (sha256 `6cf8822b…4006`). That is JetBrains Mono 2.304 patched with the Nerd Fonts glyph sets.
- The repo used to carry that release's `JetBrainsMonoNerdFont-*.ttf` byte for byte.
- They are now converted to woff2 with `fonttools ttLib.woff2 compress`. The conversion is lossless: every glyph's outline and hinting and every other table are unchanged.

Licenses:
- **The font**, JetBrains Mono and the patched result: SIL OFL 1.1.
  - [OFL-JetBrainsMono.txt](OFL-JetBrainsMono.txt), identical to the `OFL.txt` in the release archive. JetBrains Mono has no Reserved Font Name.
  - The release's own [README.md](nerd-fonts/README.md).
- **Nerd Fonts:** [nerd-fonts/LICENSE.md](nerd-fonts/LICENSE.md) (patched fonts under OFL, its own code under MIT) and [nerd-fonts/license-audit.md](nerd-fonts/license-audit.md) (the license of each glyph set). Both are from the repo at tag v3.2.1.
- **Glyph sets, as shipped in the Nerd Fonts repo at v3.2.1:**

  | Set | License | Notice |
  |---|---|---|
  | Codicons | CC BY 4.0 | [codicons-LICENSE.txt](nerd-fonts/glyphs/codicons-LICENSE.txt) |
  | Font Awesome | CC BY 4.0 (icons) | [font-awesome-LICENSE.txt](nerd-fonts/glyphs/font-awesome-LICENSE.txt) |
  | Material Design Icons | Apache 2.0 | [materialdesign-LICENSE](nerd-fonts/glyphs/materialdesign-LICENSE) (Pictogrammers notice), plus the Apache 2.0 text it points to: [materialdesign-Apache-2.0.txt](nerd-fonts/upstream/materialdesign-Apache-2.0.txt) |
  | Octicons | MIT | [octicons-LICENSE](nerd-fonts/glyphs/octicons-LICENSE) |
  | Pomicons | SIL OFL 1.1 | [pomicons-LICENSE](nerd-fonts/glyphs/pomicons-LICENSE) |
  | Powerline Extra Symbols | MIT | [powerline-extra-LICENSE](nerd-fonts/glyphs/powerline-extra-LICENSE) |
  | Powerline Symbols | MIT-style | [powerline-symbols-LICENSE.txt](nerd-fonts/glyphs/powerline-symbols-LICENSE.txt) |
  | Weather Icons | SIL OFL 1.1 | [weather-icons-OFL.txt](nerd-fonts/glyphs/weather-icons-OFL.txt) |

- **Glyph sets the Nerd Fonts repo ships no notice for.** `license-audit.md` gives the license; the text comes from each project's own repository:

  | Set | License | Notice |
  |---|---|---|
  | Devicons | MIT | [devicons-LICENSE](nerd-fonts/upstream/devicons-LICENSE) (vorillaz/devicons) |
  | Font Awesome Extension | MIT | [font-awesome-extension-LICENCE](nerd-fonts/upstream/font-awesome-extension-LICENCE) (AndreLZGava/font-awesome-extension) |
  | Font Logos | Unlicense | [font-logos-LICENSE](nerd-fonts/upstream/font-logos-LICENSE) (Lukas-W/font-logos) |
  | IEC Power Symbols | MIT | [iec-power-symbols-LICENSE.txt](nerd-fonts/upstream/iec-power-symbols-LICENSE.txt) (jloughry/Unicode) |
  | Seti-UI ("original source" set) | MIT | [seti-ui-LICENSE.md](nerd-fonts/upstream/seti-ui-LICENSE.md) (jesseweed/seti-ui) |

## Font picker fonts
Each family is the woff2 its project publishes, unmodified. See `docs/decisions/2026-11-08-local-fonts-bundled.md`.

| Files | Source | License |
|---|---|---|
| `JetBrainsMono-Regular.woff2`, `JetBrainsMono-Medium.woff2`, `JetBrainsMono-SemiBold.woff2` | JetBrains Mono v2.304, `fonts/webfonts/` | SIL OFL 1.1: [OFL-JetBrainsMono.txt](OFL-JetBrainsMono.txt) |
| `IBMPlexMono-Regular.woff2`, `IBMPlexMono-Medium.woff2`, `IBMPlexMono-SemiBold.woff2` | IBM Plex Mono `@ibm/plex-mono@2.5.0`, `fonts/complete/woff2/` | SIL OFL 1.1, Reserved Font Name "Plex": [OFL-IBMPlexMono.txt](OFL-IBMPlexMono.txt) |
| `FiraCode-Regular.woff2`, `FiraCode-Medium.woff2` | Fira Code 6.2, `woff2/` | SIL OFL 1.1: [OFL-FiraCode.txt](OFL-FiraCode.txt) |
