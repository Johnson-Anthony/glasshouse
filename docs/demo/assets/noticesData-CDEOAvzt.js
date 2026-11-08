import{c as t}from"./index-pK4X_DBw.js";const o=`# Bundled fonts: sources and licenses

Every font file in this folder, where it came from, and the license texts that cover it. \`src/offline.test.ts\` checks that each font file is listed here and that every linked file exists.

## JetBrainsMono Nerd Font (the default UI and terminal font)
Files:
- \`JetBrainsMonoNerdFont-Regular.woff2\`
- \`JetBrainsMonoNerdFont-Bold.woff2\`
- \`JetBrainsMonoNerdFont-Italic.woff2\`
- \`JetBrainsMonoNerdFont-BoldItalic.woff2\`

Source: Nerd Fonts [v3.2.1](https://github.com/ryanoasis/nerd-fonts/releases/tag/v3.2.1), \`JetBrainsMono.tar.xz\` (sha256 \`6cf8822b…4006\`). That is JetBrains Mono 2.304 patched with the Nerd Fonts glyph sets.
- The repo used to carry that release's \`JetBrainsMonoNerdFont-*.ttf\` byte for byte.
- They are now converted to woff2 with \`fonttools ttLib.woff2 compress\`. The conversion is lossless: every glyph's outline and hinting and every other table are unchanged.

Licenses:
- **The font**, JetBrains Mono and the patched result: SIL OFL 1.1.
  - [OFL-JetBrainsMono.txt](OFL-JetBrainsMono.txt), identical to the \`OFL.txt\` in the release archive. JetBrains Mono has no Reserved Font Name.
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

- **Glyph sets the Nerd Fonts repo ships no notice for.** \`license-audit.md\` gives the license; the text comes from each project's own repository:

  | Set | License | Notice |
  |---|---|---|
  | Devicons | MIT | [devicons-LICENSE](nerd-fonts/upstream/devicons-LICENSE) (vorillaz/devicons) |
  | Font Awesome Extension | MIT | [font-awesome-extension-LICENCE](nerd-fonts/upstream/font-awesome-extension-LICENCE) (AndreLZGava/font-awesome-extension) |
  | Font Logos | Unlicense | [font-logos-LICENSE](nerd-fonts/upstream/font-logos-LICENSE) (Lukas-W/font-logos) |
  | IEC Power Symbols | MIT | [iec-power-symbols-LICENSE.txt](nerd-fonts/upstream/iec-power-symbols-LICENSE.txt) (jloughry/Unicode) |
  | Seti-UI ("original source" set) | MIT | [seti-ui-LICENSE.md](nerd-fonts/upstream/seti-ui-LICENSE.md) (jesseweed/seti-ui) |

## Font picker fonts
Each family is the woff2 its project publishes, unmodified. See \`docs/decisions/2026-11-08-local-fonts-bundled.md\`.

| Files | Source | License |
|---|---|---|
| \`JetBrainsMono-Regular.woff2\`, \`JetBrainsMono-Medium.woff2\`, \`JetBrainsMono-SemiBold.woff2\` | JetBrains Mono v2.304, \`fonts/webfonts/\` | SIL OFL 1.1: [OFL-JetBrainsMono.txt](OFL-JetBrainsMono.txt) |
| \`IBMPlexMono-Regular.woff2\`, \`IBMPlexMono-Medium.woff2\`, \`IBMPlexMono-SemiBold.woff2\` | IBM Plex Mono \`@ibm/plex-mono@2.5.0\`, \`fonts/complete/woff2/\` | SIL OFL 1.1, Reserved Font Name "Plex": [OFL-IBMPlexMono.txt](OFL-IBMPlexMono.txt) |
| \`FiraCode-Regular.woff2\`, \`FiraCode-Medium.woff2\` | Fira Code 6.2, \`woff2/\` | SIL OFL 1.1: [OFL-FiraCode.txt](OFL-FiraCode.txt) |
`,i=`Copyright (c) 2014, The Fira Code Project Authors (https://github.com/tonsky/FiraCode)

This Font Software is licensed under the SIL Open Font License, Version 1.1.
This license is copied below, and is also available with a FAQ at:
http://scripts.sil.org/OFL


-----------------------------------------------------------
SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007
-----------------------------------------------------------

PREAMBLE
The goals of the Open Font License (OFL) are to stimulate worldwide
development of collaborative font projects, to support the font creation
efforts of academic and linguistic communities, and to provide a free and
open framework in which fonts may be shared and improved in partnership
with others.

The OFL allows the licensed fonts to be used, studied, modified and
redistributed freely as long as they are not sold by themselves. The
fonts, including any derivative works, can be bundled, embedded,
redistributed and/or sold with any software provided that any reserved
names are not used by derivative works. The fonts and derivatives,
however, cannot be released under any other type of license. The
requirement for fonts to remain under this license does not apply
to any document created using the fonts or their derivatives.

DEFINITIONS
"Font Software" refers to the set of files released by the Copyright
Holder(s) under this license and clearly marked as such. This may
include source files, build scripts and documentation.

"Reserved Font Name" refers to any names specified as such after the
copyright statement(s).

"Original Version" refers to the collection of Font Software components as
distributed by the Copyright Holder(s).

"Modified Version" refers to any derivative made by adding to, deleting,
or substituting -- in part or in whole -- any of the components of the
Original Version, by changing formats or by porting the Font Software to a
new environment.

"Author" refers to any designer, engineer, programmer, technical
writer or other person who contributed to the Font Software.

PERMISSION & CONDITIONS
Permission is hereby granted, free of charge, to any person obtaining
a copy of the Font Software, to use, study, copy, merge, embed, modify,
redistribute, and sell modified and unmodified copies of the Font
Software, subject to the following conditions:

1) Neither the Font Software nor any of its individual components,
in Original or Modified Versions, may be sold by itself.

2) Original or Modified Versions of the Font Software may be bundled,
redistributed and/or sold with any software, provided that each copy
contains the above copyright notice and this license. These can be
included either as stand-alone text files, human-readable headers or
in the appropriate machine-readable metadata fields within text or
binary files as long as those fields can be easily viewed by the user.

3) No Modified Version of the Font Software may use the Reserved Font
Name(s) unless explicit written permission is granted by the corresponding
Copyright Holder. This restriction only applies to the primary font name as
presented to the users.

4) The name(s) of the Copyright Holder(s) or the Author(s) of the Font
Software shall not be used to promote, endorse or advertise any
Modified Version, except to acknowledge the contribution(s) of the
Copyright Holder(s) and the Author(s) or with their explicit written
permission.

5) The Font Software, modified or unmodified, in part or in whole,
must be distributed entirely under this license, and must not be
distributed under any other license. The requirement for fonts to
remain under this license does not apply to any document created
using the Font Software.

TERMINATION
This license becomes null and void if any of the above conditions are
not met.

DISCLAIMER
THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT
OF COPYRIGHT, PATENT, TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL THE
COPYRIGHT HOLDER BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
INCLUDING ANY GENERAL, SPECIAL, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL
DAMAGES, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM
OTHER DEALINGS IN THE FONT SOFTWARE.
`,r=`Copyright © 2017 IBM Corp. with Reserved Font Name "Plex"\r
\r
This Font Software is licensed under the SIL Open Font License, Version 1.1.\r
\r
This license is copied below, and is also available with a FAQ at: http://scripts.sil.org/OFL\r
\r
\r
-----------------------------------------------------------\r
SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007\r
-----------------------------------------------------------\r
\r
PREAMBLE\r
The goals of the Open Font License (OFL) are to stimulate worldwide\r
development of collaborative font projects, to support the font creation\r
efforts of academic and linguistic communities, and to provide a free and\r
open framework in which fonts may be shared and improved in partnership\r
with others.\r
\r
The OFL allows the licensed fonts to be used, studied, modified and\r
redistributed freely as long as they are not sold by themselves. The\r
fonts, including any derivative works, can be bundled, embedded, \r
redistributed and/or sold with any software provided that any reserved\r
names are not used by derivative works. The fonts and derivatives,\r
however, cannot be released under any other type of license. The\r
requirement for fonts to remain under this license does not apply\r
to any document created using the fonts or their derivatives.\r
\r
DEFINITIONS\r
"Font Software" refers to the set of files released by the Copyright\r
Holder(s) under this license and clearly marked as such. This may\r
include source files, build scripts and documentation.\r
\r
"Reserved Font Name" refers to any names specified as such after the\r
copyright statement(s).\r
\r
"Original Version" refers to the collection of Font Software components as\r
distributed by the Copyright Holder(s).\r
\r
"Modified Version" refers to any derivative made by adding to, deleting,\r
or substituting -- in part or in whole -- any of the components of the\r
Original Version, by changing formats or by porting the Font Software to a\r
new environment.\r
\r
"Author" refers to any designer, engineer, programmer, technical\r
writer or other person who contributed to the Font Software.\r
\r
PERMISSION & CONDITIONS\r
Permission is hereby granted, free of charge, to any person obtaining\r
a copy of the Font Software, to use, study, copy, merge, embed, modify,\r
redistribute, and sell modified and unmodified copies of the Font\r
Software, subject to the following conditions:\r
\r
1) Neither the Font Software nor any of its individual components,\r
in Original or Modified Versions, may be sold by itself.\r
\r
2) Original or Modified Versions of the Font Software may be bundled,\r
redistributed and/or sold with any software, provided that each copy\r
contains the above copyright notice and this license. These can be\r
included either as stand-alone text files, human-readable headers or\r
in the appropriate machine-readable metadata fields within text or\r
binary files as long as those fields can be easily viewed by the user.\r
\r
3) No Modified Version of the Font Software may use the Reserved Font\r
Name(s) unless explicit written permission is granted by the corresponding\r
Copyright Holder. This restriction only applies to the primary font name as\r
presented to the users.\r
\r
4) The name(s) of the Copyright Holder(s) or the Author(s) of the Font\r
Software shall not be used to promote, endorse or advertise any\r
Modified Version, except to acknowledge the contribution(s) of the\r
Copyright Holder(s) and the Author(s) or with their explicit written\r
permission.\r
\r
5) The Font Software, modified or unmodified, in part or in whole,\r
must be distributed entirely under this license, and must not be\r
distributed under any other license. The requirement for fonts to\r
remain under this license does not apply to any document created\r
using the Font Software.\r
\r
TERMINATION\r
This license becomes null and void if any of the above conditions are\r
not met.\r
\r
DISCLAIMER\r
THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,\r
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF\r
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT\r
OF COPYRIGHT, PATENT, TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL THE\r
COPYRIGHT HOLDER BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,\r
INCLUDING ANY GENERAL, SPECIAL, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL\r
DAMAGES, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING\r
FROM, OUT OF THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM\r
OTHER DEALINGS IN THE FONT SOFTWARE.\r
`,s=`Copyright 2020 The JetBrains Mono Project Authors (https://github.com/JetBrains/JetBrainsMono)

This Font Software is licensed under the SIL Open Font License, Version 1.1.
This license is copied below, and is also available with a FAQ at:
https://scripts.sil.org/OFL


-----------------------------------------------------------
SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007
-----------------------------------------------------------

PREAMBLE
The goals of the Open Font License (OFL) are to stimulate worldwide
development of collaborative font projects, to support the font creation
efforts of academic and linguistic communities, and to provide a free and
open framework in which fonts may be shared and improved in partnership
with others.

The OFL allows the licensed fonts to be used, studied, modified and
redistributed freely as long as they are not sold by themselves. The
fonts, including any derivative works, can be bundled, embedded, 
redistributed and/or sold with any software provided that any reserved
names are not used by derivative works. The fonts and derivatives,
however, cannot be released under any other type of license. The
requirement for fonts to remain under this license does not apply
to any document created using the fonts or their derivatives.

DEFINITIONS
"Font Software" refers to the set of files released by the Copyright
Holder(s) under this license and clearly marked as such. This may
include source files, build scripts and documentation.

"Reserved Font Name" refers to any names specified as such after the
copyright statement(s).

"Original Version" refers to the collection of Font Software components as
distributed by the Copyright Holder(s).

"Modified Version" refers to any derivative made by adding to, deleting,
or substituting -- in part or in whole -- any of the components of the
Original Version, by changing formats or by porting the Font Software to a
new environment.

"Author" refers to any designer, engineer, programmer, technical
writer or other person who contributed to the Font Software.

PERMISSION & CONDITIONS
Permission is hereby granted, free of charge, to any person obtaining
a copy of the Font Software, to use, study, copy, merge, embed, modify,
redistribute, and sell modified and unmodified copies of the Font
Software, subject to the following conditions:

1) Neither the Font Software nor any of its individual components,
in Original or Modified Versions, may be sold by itself.

2) Original or Modified Versions of the Font Software may be bundled,
redistributed and/or sold with any software, provided that each copy
contains the above copyright notice and this license. These can be
included either as stand-alone text files, human-readable headers or
in the appropriate machine-readable metadata fields within text or
binary files as long as those fields can be easily viewed by the user.

3) No Modified Version of the Font Software may use the Reserved Font
Name(s) unless explicit written permission is granted by the corresponding
Copyright Holder. This restriction only applies to the primary font name as
presented to the users.

4) The name(s) of the Copyright Holder(s) or the Author(s) of the Font
Software shall not be used to promote, endorse or advertise any
Modified Version, except to acknowledge the contribution(s) of the
Copyright Holder(s) and the Author(s) or with their explicit written
permission.

5) The Font Software, modified or unmodified, in part or in whole,
must be distributed entirely under this license, and must not be
distributed under any other license. The requirement for fonts to
remain under this license does not apply to any document created
using the Font Software.

TERMINATION
This license becomes null and void if any of the above conditions are
not met.

DISCLAIMER
THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT
OF COPYRIGHT, PATENT, TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL THE
COPYRIGHT HOLDER BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
INCLUDING ANY GENERAL, SPECIAL, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL
DAMAGES, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM
OTHER DEALINGS IN THE FONT SOFTWARE.
`,a=`# Nerd Fonts Licensing

There are various sources used under various licenses:

* Nerd Fonts source fonts, patched fonts, and folders with explict OFL SIL files are licensed under SIL OPEN FONT LICENSE Version 1.1 (see below).
* Nerd Fonts original source code files (such as \`.sh\`, \`.py\`, \`font-patcher\` and others) are licensed under the MIT License (MIT) (see below).
* Many other licenses are present in this project for even more detailed breakdown see: [License Audit](https://github.com/ryanoasis/nerd-fonts/blob/-/license-audit.md).

## Source files not in folders containing an explicit license are using the MIT License (MIT)

The MIT License (MIT)

Copyright (c) 2014 Ryan L McIntyre

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Various Fonts, Patched Fonts, SVGs, Glyph Fonts, and any files in a folder with explicit SIL OFL 1.1 License

Copyright (c) 2014, Ryan L McIntyre (https://ryanlmcintyre.com).

This Font Software is licensed under the SIL Open Font License, Version 1.1.
This license is copied below, and is also available with a FAQ at:
http://scripts.sil.org/OFL

-----------------------------------------------------------
SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007
-----------------------------------------------------------

PREAMBLE
The goals of the Open Font License (OFL) are to stimulate worldwide
development of collaborative font projects, to support the font creation
efforts of academic and linguistic communities, and to provide a free and
open framework in which fonts may be shared and improved in partnership
with others.

The OFL allows the licensed fonts to be used, studied, modified and
redistributed freely as long as they are not sold by themselves. The
fonts, including any derivative works, can be bundled, embedded, 
redistributed and/or sold with any software provided that any reserved
names are not used by derivative works. The fonts and derivatives,
however, cannot be released under any other type of license. The
requirement for fonts to remain under this license does not apply
to any document created using the fonts or their derivatives.

DEFINITIONS
"Font Software" refers to the set of files released by the Copyright
Holder(s) under this license and clearly marked as such. This may
include source files, build scripts and documentation.

"Reserved Font Name" refers to any names specified as such after the
copyright statement(s).

"Original Version" refers to the collection of Font Software components as
distributed by the Copyright Holder(s).

"Modified Version" refers to any derivative made by adding to, deleting,
or substituting -- in part or in whole -- any of the components of the
Original Version, by changing formats or by porting the Font Software to a
new environment.

"Author" refers to any designer, engineer, programmer, technical
writer or other person who contributed to the Font Software.

PERMISSION & CONDITIONS
Permission is hereby granted, free of charge, to any person obtaining
a copy of the Font Software, to use, study, copy, merge, embed, modify,
redistribute, and sell modified and unmodified copies of the Font
Software, subject to the following conditions:

1) Neither the Font Software nor any of its individual components,
in Original or Modified Versions, may be sold by itself.

2) Original or Modified Versions of the Font Software may be bundled,
redistributed and/or sold with any software, provided that each copy
contains the above copyright notice and this license. These can be
included either as stand-alone text files, human-readable headers or
in the appropriate machine-readable metadata fields within text or
binary files as long as those fields can be easily viewed by the user.

3) No Modified Version of the Font Software may use the Reserved Font
Name(s) unless explicit written permission is granted by the corresponding
Copyright Holder. This restriction only applies to the primary font name as
presented to the users.

4) The name(s) of the Copyright Holder(s) or the Author(s) of the Font
Software shall not be used to promote, endorse or advertise any
Modified Version, except to acknowledge the contribution(s) of the
Copyright Holder(s) and the Author(s) or with their explicit written
permission.

5) The Font Software, modified or unmodified, in part or in whole,
must be distributed entirely under this license, and must not be
distributed under any other license. The requirement for fonts to
remain under this license does not apply to any document created
using the Font Software.

TERMINATION
This license becomes null and void if any of the above conditions are
not met.

DISCLAIMER
THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT
OF COPYRIGHT, PATENT, TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL THE
COPYRIGHT HOLDER BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
INCLUDING ANY GENERAL, SPECIAL, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL
DAMAGES, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM
OTHER DEALINGS IN THE FONT SOFTWARE.
`,d=`# Nerd Fonts

This is an archived font from the Nerd Fonts release v3.2.1.

For more information see:
* https://github.com/ryanoasis/nerd-fonts/
* https://github.com/ryanoasis/nerd-fonts/releases/latest/

# JetBrains Mono

JetBrains Mono: a typeface made for developers

For more information have a look at the upstream website: https://github.com/JetBrains/JetBrainsMono

Version: 2.304

## Which font?

### TL;DR

* Pick your font family:
  * If you are limited to monospaced fonts (because of your terminal, etc) then pick a font with \`Nerd Font Mono\` (or \`NFM\`).
  * If you want to have bigger icons (usually around 1.5 normal letters wide) pick a font without \`Mono\` i.e. \`Nerd Font\` (or \`NF\`). Most terminals support this, but ymmv.
  * If you work in a proportional context (GUI elements or edit a presentation etc) pick a font with \`Nerd Font Propo\` (or \`NFP\`).

### Ligatures

Ligatures are generally preserved in the patched fonts.
Nerd Fonts \`v2.0.0\` had no ligatures in the \`Nerd Font Mono\` fonts, this has been dropped with \`v2.1.0\`.
If you have a ligature-aware terminal and don't want ligatures you can (usually) disable them in the terminal settings.

### Explanation

Once you narrow down your font choice of family (\`Droid Sans\`, \`Inconsolata\`, etc) and style (\`bold\`, \`italic\`, etc) you have 2 main choices:

#### \`Option 1: Download already patched font\`

 * For a stable version download a font package from the [release page](https://github.com/ryanoasis/nerd-fonts/releases)
 * Or download the development version from the folders here

#### \`Option 2: Patch your own font\`

 * Patch your own variations with the various options provided by the font patcher (i.e. not include all symbols for smaller font size)

For more information see: [The FAQ](https://github.com/ryanoasis/nerd-fonts/wiki/FAQ-and-Troubleshooting#which-font)

[SIL-RFN]:http://scripts.sil.org/cms/scripts/page.php?item_id=OFL_web_fonts_and_RFNs#14cbfd4a

`,h=`\uFEFFAttribution 4.0 International\r
\r
=======================================================================\r
\r
Creative Commons Corporation ("Creative Commons") is not a law firm and\r
does not provide legal services or legal advice. Distribution of\r
Creative Commons public licenses does not create a lawyer-client or\r
other relationship. Creative Commons makes its licenses and related\r
information available on an "as-is" basis. Creative Commons gives no\r
warranties regarding its licenses, any material licensed under their\r
terms and conditions, or any related information. Creative Commons\r
disclaims all liability for damages resulting from their use to the\r
fullest extent possible.\r
\r
Using Creative Commons Public Licenses\r
\r
Creative Commons public licenses provide a standard set of terms and\r
conditions that creators and other rights holders may use to share\r
original works of authorship and other material subject to copyright\r
and certain other rights specified in the public license below. The\r
following considerations are for informational purposes only, are not\r
exhaustive, and do not form part of our licenses.\r
\r
     Considerations for licensors: Our public licenses are\r
     intended for use by those authorized to give the public\r
     permission to use material in ways otherwise restricted by\r
     copyright and certain other rights. Our licenses are\r
     irrevocable. Licensors should read and understand the terms\r
     and conditions of the license they choose before applying it.\r
     Licensors should also secure all rights necessary before\r
     applying our licenses so that the public can reuse the\r
     material as expected. Licensors should clearly mark any\r
     material not subject to the license. This includes other CC-\r
     licensed material, or material used under an exception or\r
     limitation to copyright. More considerations for licensors:\r
	wiki.creativecommons.org/Considerations_for_licensors\r
\r
     Considerations for the public: By using one of our public\r
     licenses, a licensor grants the public permission to use the\r
     licensed material under specified terms and conditions. If\r
     the licensor's permission is not necessary for any reason--for\r
     example, because of any applicable exception or limitation to\r
     copyright--then that use is not regulated by the license. Our\r
     licenses grant only permissions under copyright and certain\r
     other rights that a licensor has authority to grant. Use of\r
     the licensed material may still be restricted for other\r
     reasons, including because others have copyright or other\r
     rights in the material. A licensor may make special requests,\r
     such as asking that all changes be marked or described.\r
     Although not required by our licenses, you are encouraged to\r
     respect those requests where reasonable. More_considerations\r
     for the public: \r
	wiki.creativecommons.org/Considerations_for_licensees\r
\r
=======================================================================\r
\r
Creative Commons Attribution 4.0 International Public License\r
\r
By exercising the Licensed Rights (defined below), You accept and agree\r
to be bound by the terms and conditions of this Creative Commons\r
Attribution 4.0 International Public License ("Public License"). To the\r
extent this Public License may be interpreted as a contract, You are\r
granted the Licensed Rights in consideration of Your acceptance of\r
these terms and conditions, and the Licensor grants You such rights in\r
consideration of benefits the Licensor receives from making the\r
Licensed Material available under these terms and conditions.\r
\r
\r
Section 1 -- Definitions.\r
\r
  a. Adapted Material means material subject to Copyright and Similar\r
     Rights that is derived from or based upon the Licensed Material\r
     and in which the Licensed Material is translated, altered,\r
     arranged, transformed, or otherwise modified in a manner requiring\r
     permission under the Copyright and Similar Rights held by the\r
     Licensor. For purposes of this Public License, where the Licensed\r
     Material is a musical work, performance, or sound recording,\r
     Adapted Material is always produced where the Licensed Material is\r
     synched in timed relation with a moving image.\r
\r
  b. Adapter's License means the license You apply to Your Copyright\r
     and Similar Rights in Your contributions to Adapted Material in\r
     accordance with the terms and conditions of this Public License.\r
\r
  c. Copyright and Similar Rights means copyright and/or similar rights\r
     closely related to copyright including, without limitation,\r
     performance, broadcast, sound recording, and Sui Generis Database\r
     Rights, without regard to how the rights are labeled or\r
     categorized. For purposes of this Public License, the rights\r
     specified in Section 2(b)(1)-(2) are not Copyright and Similar\r
     Rights.\r
\r
  d. Effective Technological Measures means those measures that, in the\r
     absence of proper authority, may not be circumvented under laws\r
     fulfilling obligations under Article 11 of the WIPO Copyright\r
     Treaty adopted on December 20, 1996, and/or similar international\r
     agreements.\r
\r
  e. Exceptions and Limitations means fair use, fair dealing, and/or\r
     any other exception or limitation to Copyright and Similar Rights\r
     that applies to Your use of the Licensed Material.\r
\r
  f. Licensed Material means the artistic or literary work, database,\r
     or other material to which the Licensor applied this Public\r
     License.\r
\r
  g. Licensed Rights means the rights granted to You subject to the\r
     terms and conditions of this Public License, which are limited to\r
     all Copyright and Similar Rights that apply to Your use of the\r
     Licensed Material and that the Licensor has authority to license.\r
\r
  h. Licensor means the individual(s) or entity(ies) granting rights\r
     under this Public License.\r
\r
  i. Share means to provide material to the public by any means or\r
     process that requires permission under the Licensed Rights, such\r
     as reproduction, public display, public performance, distribution,\r
     dissemination, communication, or importation, and to make material\r
     available to the public including in ways that members of the\r
     public may access the material from a place and at a time\r
     individually chosen by them.\r
\r
  j. Sui Generis Database Rights means rights other than copyright\r
     resulting from Directive 96/9/EC of the European Parliament and of\r
     the Council of 11 March 1996 on the legal protection of databases,\r
     as amended and/or succeeded, as well as other essentially\r
     equivalent rights anywhere in the world.\r
\r
  k. You means the individual or entity exercising the Licensed Rights\r
     under this Public License. Your has a corresponding meaning.\r
\r
\r
Section 2 -- Scope.\r
\r
  a. License grant.\r
\r
       1. Subject to the terms and conditions of this Public License,\r
          the Licensor hereby grants You a worldwide, royalty-free,\r
          non-sublicensable, non-exclusive, irrevocable license to\r
          exercise the Licensed Rights in the Licensed Material to:\r
\r
            a. reproduce and Share the Licensed Material, in whole or\r
               in part; and\r
\r
            b. produce, reproduce, and Share Adapted Material.\r
\r
       2. Exceptions and Limitations. For the avoidance of doubt, where\r
          Exceptions and Limitations apply to Your use, this Public\r
          License does not apply, and You do not need to comply with\r
          its terms and conditions.\r
\r
       3. Term. The term of this Public License is specified in Section\r
          6(a).\r
\r
       4. Media and formats; technical modifications allowed. The\r
          Licensor authorizes You to exercise the Licensed Rights in\r
          all media and formats whether now known or hereafter created,\r
          and to make technical modifications necessary to do so. The\r
          Licensor waives and/or agrees not to assert any right or\r
          authority to forbid You from making technical modifications\r
          necessary to exercise the Licensed Rights, including\r
          technical modifications necessary to circumvent Effective\r
          Technological Measures. For purposes of this Public License,\r
          simply making modifications authorized by this Section 2(a)\r
          (4) never produces Adapted Material.\r
\r
       5. Downstream recipients.\r
\r
            a. Offer from the Licensor -- Licensed Material. Every\r
               recipient of the Licensed Material automatically\r
               receives an offer from the Licensor to exercise the\r
               Licensed Rights under the terms and conditions of this\r
               Public License.\r
\r
            b. No downstream restrictions. You may not offer or impose\r
               any additional or different terms or conditions on, or\r
               apply any Effective Technological Measures to, the\r
               Licensed Material if doing so restricts exercise of the\r
               Licensed Rights by any recipient of the Licensed\r
               Material.\r
\r
       6. No endorsement. Nothing in this Public License constitutes or\r
          may be construed as permission to assert or imply that You\r
          are, or that Your use of the Licensed Material is, connected\r
          with, or sponsored, endorsed, or granted official status by,\r
          the Licensor or others designated to receive attribution as\r
          provided in Section 3(a)(1)(A)(i).\r
\r
  b. Other rights.\r
\r
       1. Moral rights, such as the right of integrity, are not\r
          licensed under this Public License, nor are publicity,\r
          privacy, and/or other similar personality rights; however, to\r
          the extent possible, the Licensor waives and/or agrees not to\r
          assert any such rights held by the Licensor to the limited\r
          extent necessary to allow You to exercise the Licensed\r
          Rights, but not otherwise.\r
\r
       2. Patent and trademark rights are not licensed under this\r
          Public License.\r
\r
       3. To the extent possible, the Licensor waives any right to\r
          collect royalties from You for the exercise of the Licensed\r
          Rights, whether directly or through a collecting society\r
          under any voluntary or waivable statutory or compulsory\r
          licensing scheme. In all other cases the Licensor expressly\r
          reserves any right to collect such royalties.\r
\r
\r
Section 3 -- License Conditions.\r
\r
Your exercise of the Licensed Rights is expressly made subject to the\r
following conditions.\r
\r
  a. Attribution.\r
\r
       1. If You Share the Licensed Material (including in modified\r
          form), You must:\r
\r
            a. retain the following if it is supplied by the Licensor\r
               with the Licensed Material:\r
\r
                 i. identification of the creator(s) of the Licensed\r
                    Material and any others designated to receive\r
                    attribution, in any reasonable manner requested by\r
                    the Licensor (including by pseudonym if\r
                    designated);\r
\r
                ii. a copyright notice;\r
\r
               iii. a notice that refers to this Public License;\r
\r
                iv. a notice that refers to the disclaimer of\r
                    warranties;\r
\r
                 v. a URI or hyperlink to the Licensed Material to the\r
                    extent reasonably practicable;\r
\r
            b. indicate if You modified the Licensed Material and\r
               retain an indication of any previous modifications; and\r
\r
            c. indicate the Licensed Material is licensed under this\r
               Public License, and include the text of, or the URI or\r
               hyperlink to, this Public License.\r
\r
       2. You may satisfy the conditions in Section 3(a)(1) in any\r
          reasonable manner based on the medium, means, and context in\r
          which You Share the Licensed Material. For example, it may be\r
          reasonable to satisfy the conditions by providing a URI or\r
          hyperlink to a resource that includes the required\r
          information.\r
\r
       3. If requested by the Licensor, You must remove any of the\r
          information required by Section 3(a)(1)(A) to the extent\r
          reasonably practicable.\r
\r
       4. If You Share Adapted Material You produce, the Adapter's\r
          License You apply must not prevent recipients of the Adapted\r
          Material from complying with this Public License.\r
\r
\r
Section 4 -- Sui Generis Database Rights.\r
\r
Where the Licensed Rights include Sui Generis Database Rights that\r
apply to Your use of the Licensed Material:\r
\r
  a. for the avoidance of doubt, Section 2(a)(1) grants You the right\r
     to extract, reuse, reproduce, and Share all or a substantial\r
     portion of the contents of the database;\r
\r
  b. if You include all or a substantial portion of the database\r
     contents in a database in which You have Sui Generis Database\r
     Rights, then the database in which You have Sui Generis Database\r
     Rights (but not its individual contents) is Adapted Material; and\r
\r
  c. You must comply with the conditions in Section 3(a) if You Share\r
     all or a substantial portion of the contents of the database.\r
\r
For the avoidance of doubt, this Section 4 supplements and does not\r
replace Your obligations under this Public License where the Licensed\r
Rights include other Copyright and Similar Rights.\r
\r
\r
Section 5 -- Disclaimer of Warranties and Limitation of Liability.\r
\r
  a. UNLESS OTHERWISE SEPARATELY UNDERTAKEN BY THE LICENSOR, TO THE\r
     EXTENT POSSIBLE, THE LICENSOR OFFERS THE LICENSED MATERIAL AS-IS\r
     AND AS-AVAILABLE, AND MAKES NO REPRESENTATIONS OR WARRANTIES OF\r
     ANY KIND CONCERNING THE LICENSED MATERIAL, WHETHER EXPRESS,\r
     IMPLIED, STATUTORY, OR OTHER. THIS INCLUDES, WITHOUT LIMITATION,\r
     WARRANTIES OF TITLE, MERCHANTABILITY, FITNESS FOR A PARTICULAR\r
     PURPOSE, NON-INFRINGEMENT, ABSENCE OF LATENT OR OTHER DEFECTS,\r
     ACCURACY, OR THE PRESENCE OR ABSENCE OF ERRORS, WHETHER OR NOT\r
     KNOWN OR DISCOVERABLE. WHERE DISCLAIMERS OF WARRANTIES ARE NOT\r
     ALLOWED IN FULL OR IN PART, THIS DISCLAIMER MAY NOT APPLY TO YOU.\r
\r
  b. TO THE EXTENT POSSIBLE, IN NO EVENT WILL THE LICENSOR BE LIABLE\r
     TO YOU ON ANY LEGAL THEORY (INCLUDING, WITHOUT LIMITATION,\r
     NEGLIGENCE) OR OTHERWISE FOR ANY DIRECT, SPECIAL, INDIRECT,\r
     INCIDENTAL, CONSEQUENTIAL, PUNITIVE, EXEMPLARY, OR OTHER LOSSES,\r
     COSTS, EXPENSES, OR DAMAGES ARISING OUT OF THIS PUBLIC LICENSE OR\r
     USE OF THE LICENSED MATERIAL, EVEN IF THE LICENSOR HAS BEEN\r
     ADVISED OF THE POSSIBILITY OF SUCH LOSSES, COSTS, EXPENSES, OR\r
     DAMAGES. WHERE A LIMITATION OF LIABILITY IS NOT ALLOWED IN FULL OR\r
     IN PART, THIS LIMITATION MAY NOT APPLY TO YOU.\r
\r
  c. The disclaimer of warranties and limitation of liability provided\r
     above shall be interpreted in a manner that, to the extent\r
     possible, most closely approximates an absolute disclaimer and\r
     waiver of all liability.\r
\r
\r
Section 6 -- Term and Termination.\r
\r
  a. This Public License applies for the term of the Copyright and\r
     Similar Rights licensed here. However, if You fail to comply with\r
     this Public License, then Your rights under this Public License\r
     terminate automatically.\r
\r
  b. Where Your right to use the Licensed Material has terminated under\r
     Section 6(a), it reinstates:\r
\r
       1. automatically as of the date the violation is cured, provided\r
          it is cured within 30 days of Your discovery of the\r
          violation; or\r
\r
       2. upon express reinstatement by the Licensor.\r
\r
     For the avoidance of doubt, this Section 6(b) does not affect any\r
     right the Licensor may have to seek remedies for Your violations\r
     of this Public License.\r
\r
  c. For the avoidance of doubt, the Licensor may also offer the\r
     Licensed Material under separate terms or conditions or stop\r
     distributing the Licensed Material at any time; however, doing so\r
     will not terminate this Public License.\r
\r
  d. Sections 1, 5, 6, 7, and 8 survive termination of this Public\r
     License.\r
\r
\r
Section 7 -- Other Terms and Conditions.\r
\r
  a. The Licensor shall not be bound by any additional or different\r
     terms or conditions communicated by You unless expressly agreed.\r
\r
  b. Any arrangements, understandings, or agreements regarding the\r
     Licensed Material not stated herein are separate from and\r
     independent of the terms and conditions of this Public License.\r
\r
\r
Section 8 -- Interpretation.\r
\r
  a. For the avoidance of doubt, this Public License does not, and\r
     shall not be interpreted to, reduce, limit, restrict, or impose\r
     conditions on any use of the Licensed Material that could lawfully\r
     be made without permission under this Public License.\r
\r
  b. To the extent possible, if any provision of this Public License is\r
     deemed unenforceable, it shall be automatically reformed to the\r
     minimum extent necessary to make it enforceable. If the provision\r
     cannot be reformed, it shall be severed from this Public License\r
     without affecting the enforceability of the remaining terms and\r
     conditions.\r
\r
  c. No term or condition of this Public License will be waived and no\r
     failure to comply consented to unless expressly agreed to by the\r
     Licensor.\r
\r
  d. Nothing in this Public License constitutes or may be interpreted\r
     as a limitation upon, or waiver of, any privileges and immunities\r
     that apply to the Licensor or You, including from the legal\r
     processes of any jurisdiction or authority.\r
\r
\r
=======================================================================\r
\r
Creative Commons is not a party to its public\r
licenses. Notwithstanding, Creative Commons may elect to apply one of\r
its public licenses to material it publishes and in those instances\r
will be considered the “Licensor.” The text of the Creative Commons\r
public licenses is dedicated to the public domain under the CC0 Public\r
Domain Dedication. Except for the limited purpose of indicating that\r
material is shared under a Creative Commons public license or as\r
otherwise permitted by the Creative Commons policies published at\r
creativecommons.org/policies, Creative Commons does not authorize the\r
use of the trademark "Creative Commons" or any other trademark or logo\r
of Creative Commons without its prior written consent including,\r
without limitation, in connection with any unauthorized modifications\r
to any of its public licenses or any other arrangements,\r
understandings, or agreements concerning use of licensed material. For\r
the avoidance of doubt, this paragraph does not form part of the\r
public licenses.\r
\r
Creative Commons may be contacted at creativecommons.org.`,c=`Fonticons, Inc. (https://fontawesome.com)

--------------------------------------------------------------------------------

Font Awesome Free License

Font Awesome Free is free, open source, and GPL friendly. You can use it for
commercial projects, open source projects, or really almost whatever you want.
Full Font Awesome Free license: https://fontawesome.com/license/free.

--------------------------------------------------------------------------------

# Icons: CC BY 4.0 License (https://creativecommons.org/licenses/by/4.0/)

The Font Awesome Free download is licensed under a Creative Commons
Attribution 4.0 International License and applies to all icons packaged
as SVG and JS file types.

--------------------------------------------------------------------------------

# Fonts: SIL OFL 1.1 License

In the Font Awesome Free download, the SIL OFL license applies to all icons
packaged as web and desktop font files.

Copyright (c) 2022 Fonticons, Inc. (https://fontawesome.com)
with Reserved Font Name: "Font Awesome".

This Font Software is licensed under the SIL Open Font License, Version 1.1.
This license is copied below, and is also available with a FAQ at:
http://scripts.sil.org/OFL

SIL OPEN FONT LICENSE
Version 1.1 - 26 February 2007

PREAMBLE
The goals of the Open Font License (OFL) are to stimulate worldwide
development of collaborative font projects, to support the font creation
efforts of academic and linguistic communities, and to provide a free and
open framework in which fonts may be shared and improved in partnership
with others.

The OFL allows the licensed fonts to be used, studied, modified and
redistributed freely as long as they are not sold by themselves. The
fonts, including any derivative works, can be bundled, embedded,
redistributed and/or sold with any software provided that any reserved
names are not used by derivative works. The fonts and derivatives,
however, cannot be released under any other type of license. The
requirement for fonts to remain under this license does not apply
to any document created using the fonts or their derivatives.

DEFINITIONS
"Font Software" refers to the set of files released by the Copyright
Holder(s) under this license and clearly marked as such. This may
include source files, build scripts and documentation.

"Reserved Font Name" refers to any names specified as such after the
copyright statement(s).

"Original Version" refers to the collection of Font Software components as
distributed by the Copyright Holder(s).

"Modified Version" refers to any derivative made by adding to, deleting,
or substituting — in part or in whole — any of the components of the
Original Version, by changing formats or by porting the Font Software to a
new environment.

"Author" refers to any designer, engineer, programmer, technical
writer or other person who contributed to the Font Software.

PERMISSION & CONDITIONS
Permission is hereby granted, free of charge, to any person obtaining
a copy of the Font Software, to use, study, copy, merge, embed, modify,
redistribute, and sell modified and unmodified copies of the Font
Software, subject to the following conditions:

1) Neither the Font Software nor any of its individual components,
in Original or Modified Versions, may be sold by itself.

2) Original or Modified Versions of the Font Software may be bundled,
redistributed and/or sold with any software, provided that each copy
contains the above copyright notice and this license. These can be
included either as stand-alone text files, human-readable headers or
in the appropriate machine-readable metadata fields within text or
binary files as long as those fields can be easily viewed by the user.

3) No Modified Version of the Font Software may use the Reserved Font
Name(s) unless explicit written permission is granted by the corresponding
Copyright Holder. This restriction only applies to the primary font name as
presented to the users.

4) The name(s) of the Copyright Holder(s) or the Author(s) of the Font
Software shall not be used to promote, endorse or advertise any
Modified Version, except to acknowledge the contribution(s) of the
Copyright Holder(s) and the Author(s) or with their explicit written
permission.

5) The Font Software, modified or unmodified, in part or in whole,
must be distributed entirely under this license, and must not be
distributed under any other license. The requirement for fonts to
remain under this license does not apply to any document created
using the Font Software.

TERMINATION
This license becomes null and void if any of the above conditions are
not met.

DISCLAIMER
THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT
OF COPYRIGHT, PATENT, TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL THE
COPYRIGHT HOLDER BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
INCLUDING ANY GENERAL, SPECIAL, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL
DAMAGES, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM
OTHER DEALINGS IN THE FONT SOFTWARE.

--------------------------------------------------------------------------------

# Code: MIT License (https://opensource.org/licenses/MIT)

In the Font Awesome Free download, the MIT license applies to all non-font and
non-icon files.

Copyright 2022 Fonticons, Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in the
Software without restriction, including without limitation the rights to use, copy,
modify, merge, publish, distribute, sublicense, and/or sell copies of the Software,
and to permit persons to whom the Software is furnished to do so, subject to the
following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED,
INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT
HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

--------------------------------------------------------------------------------

# Attribution

Attribution is required by MIT, SIL OFL, and CC BY licenses. Downloaded Font
Awesome Free files already contain embedded comments with sufficient
attribution, so you shouldn't need to do anything additional when using these
files normally.

We've kept attribution comments terse, so we ask that you do not actively work
to remove them from files, especially code. They're a great way for folks to
learn about Font Awesome.

--------------------------------------------------------------------------------

# Brand Icons

All brand icons are trademarks of their respective owners. The use of these
trademarks does not indicate endorsement of the trademark holder by Font
Awesome, nor vice versa. **Please do not use brand logos for any purpose except
to represent the company, product, or service to which they refer.**
`,l=`Pictogrammers Free License
--------------------------

This icon collection is released as free, open source, and GPL friendly by
the [Pictogrammers](http://pictogrammers.com/) icon group. You may use it
for commercial projects, open source projects, or anything really.

# Icons: Apache 2.0 (https://www.apache.org/licenses/LICENSE-2.0)
Some of the icons are redistributed under the Apache 2.0 license. All other
icons are either redistributed under their respective licenses or are
distributed under the Apache 2.0 license.

# Fonts: Apache 2.0 (https://www.apache.org/licenses/LICENSE-2.0)
All web and desktop fonts are distributed under the Apache 2.0 license. Web
and desktop fonts contain some icons that are redistributed under the Apache
2.0 license. All other icons are either redistributed under their respective
licenses or are distributed under the Apache 2.0 license.

# Code: MIT (https://opensource.org/licenses/MIT)
The MIT license applies to all non-font and non-icon files.
`,u=`MIT License

Copyright (c) 2023 GitHub Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`,f=`Copyright (c) 2021, Gabriele Lana gabriele.lana@gmail.com
with Reserved Font Name Pomicons.

This Font Software is licensed under the SIL Open Font License, Version 1.1.
This license is copied below, and is also available with a FAQ at:
http://scripts.sil.org/OFL


-----------------------------------------------------------
SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007
-----------------------------------------------------------

PREAMBLE
The goals of the Open Font License (OFL) are to stimulate worldwide
development of collaborative font projects, to support the font creation
efforts of academic and linguistic communities, and to provide a free and
open framework in which fonts may be shared and improved in partnership
with others.

The OFL allows the licensed fonts to be used, studied, modified and
redistributed freely as long as they are not sold by themselves. The
fonts, including any derivative works, can be bundled, embedded, 
redistributed and/or sold with any software provided that any reserved
names are not used by derivative works. The fonts and derivatives,
however, cannot be released under any other type of license. The
requirement for fonts to remain under this license does not apply
to any document created using the fonts or their derivatives.

DEFINITIONS
"Font Software" refers to the set of files released by the Copyright
Holder(s) under this license and clearly marked as such. This may
include source files, build scripts and documentation.

"Reserved Font Name" refers to any names specified as such after the
copyright statement(s).

"Original Version" refers to the collection of Font Software components as
distributed by the Copyright Holder(s).

"Modified Version" refers to any derivative made by adding to, deleting,
or substituting -- in part or in whole -- any of the components of the
Original Version, by changing formats or by porting the Font Software to a
new environment.

"Author" refers to any designer, engineer, programmer, technical
writer or other person who contributed to the Font Software.

PERMISSION & CONDITIONS
Permission is hereby granted, free of charge, to any person obtaining
a copy of the Font Software, to use, study, copy, merge, embed, modify,
redistribute, and sell modified and unmodified copies of the Font
Software, subject to the following conditions:

1) Neither the Font Software nor any of its individual components,
in Original or Modified Versions, may be sold by itself.

2) Original or Modified Versions of the Font Software may be bundled,
redistributed and/or sold with any software, provided that each copy
contains the above copyright notice and this license. These can be
included either as stand-alone text files, human-readable headers or
in the appropriate machine-readable metadata fields within text or
binary files as long as those fields can be easily viewed by the user.

3) No Modified Version of the Font Software may use the Reserved Font
Name(s) unless explicit written permission is granted by the corresponding
Copyright Holder. This restriction only applies to the primary font name as
presented to the users.

4) The name(s) of the Copyright Holder(s) or the Author(s) of the Font
Software shall not be used to promote, endorse or advertise any
Modified Version, except to acknowledge the contribution(s) of the
Copyright Holder(s) and the Author(s) or with their explicit written
permission.

5) The Font Software, modified or unmodified, in part or in whole,
must be distributed entirely under this license, and must not be
distributed under any other license. The requirement for fonts to
remain under this license does not apply to any document created
using the Font Software.

TERMINATION
This license becomes null and void if any of the above conditions are
not met.

DISCLAIMER
THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT
OF COPYRIGHT, PATENT, TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL THE
COPYRIGHT HOLDER BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
INCLUDING ANY GENERAL, SPECIAL, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL
DAMAGES, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM
OTHER DEALINGS IN THE FONT SOFTWARE.
`,m=`MIT License

Copyright (c) 2016 Ryan L McIntyre

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`,p=`Copyright 2013 Kim Silkebækken and other contributors
https://github.com/powerline/powerline

Permission is hereby granted, free of charge, to any person obtaining 
a copy of this software and associated documentation files (the 
"Software"), to deal in the Software without restriction, including 
without limitation the rights to use, copy, modify, merge, publish, 
distribute, sublicense, and/or sell copies of the Software, and to 
permit persons to whom the Software is furnished to do so, subject to 
the following conditions:

The above copyright notice and this permission notice shall be 
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, 
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF 
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.  
IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY 
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, 
TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE 
SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
`,I=`Copyright (c) <dates>, <Erik Flowers> (<URL|email>),\r
with Reserved Font Name <Reserved Font Name>.\r
Copyright (c) <dates>, <additional Copyright Holder> (<URL|email>),\r
with Reserved Font Name <additional Reserved Font Name>.\r
Copyright (c) <dates>, <additional Copyright Holder> (<URL|email>).\r
\r
This Font Software is licensed under the SIL Open Font License, Version 1.1.\r
This license is copied below, and is also available with a FAQ at:\r
http://scripts.sil.org/OFL\r
\r
\r
-----------------------------------------------------------\r
SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007\r
-----------------------------------------------------------\r
\r
PREAMBLE\r
The goals of the Open Font License (OFL) are to stimulate worldwide\r
development of collaborative font projects, to support the font creation\r
efforts of academic and linguistic communities, and to provide a free and\r
open framework in which fonts may be shared and improved in partnership\r
with others.\r
\r
The OFL allows the licensed fonts to be used, studied, modified and\r
redistributed freely as long as they are not sold by themselves. The\r
fonts, including any derivative works, can be bundled, embedded, \r
redistributed and/or sold with any software provided that any reserved\r
names are not used by derivative works. The fonts and derivatives,\r
however, cannot be released under any other type of license. The\r
requirement for fonts to remain under this license does not apply\r
to any document created using the fonts or their derivatives.\r
\r
DEFINITIONS\r
"Font Software" refers to the set of files released by the Copyright\r
Holder(s) under this license and clearly marked as such. This may\r
include source files, build scripts and documentation.\r
\r
"Reserved Font Name" refers to any names specified as such after the\r
copyright statement(s).\r
\r
"Original Version" refers to the collection of Font Software components as\r
distributed by the Copyright Holder(s).\r
\r
"Modified Version" refers to any derivative made by adding to, deleting,\r
or substituting -- in part or in whole -- any of the components of the\r
Original Version, by changing formats or by porting the Font Software to a\r
new environment.\r
\r
"Author" refers to any designer, engineer, programmer, technical\r
writer or other person who contributed to the Font Software.\r
\r
PERMISSION & CONDITIONS\r
Permission is hereby granted, free of charge, to any person obtaining\r
a copy of the Font Software, to use, study, copy, merge, embed, modify,\r
redistribute, and sell modified and unmodified copies of the Font\r
Software, subject to the following conditions:\r
\r
1) Neither the Font Software nor any of its individual components,\r
in Original or Modified Versions, may be sold by itself.\r
\r
2) Original or Modified Versions of the Font Software may be bundled,\r
redistributed and/or sold with any software, provided that each copy\r
contains the above copyright notice and this license. These can be\r
included either as stand-alone text files, human-readable headers or\r
in the appropriate machine-readable metadata fields within text or\r
binary files as long as those fields can be easily viewed by the user.\r
\r
3) No Modified Version of the Font Software may use the Reserved Font\r
Name(s) unless explicit written permission is granted by the corresponding\r
Copyright Holder. This restriction only applies to the primary font name as\r
presented to the users.\r
\r
4) The name(s) of the Copyright Holder(s) or the Author(s) of the Font\r
Software shall not be used to promote, endorse or advertise any\r
Modified Version, except to acknowledge the contribution(s) of the\r
Copyright Holder(s) and the Author(s) or with their explicit written\r
permission.\r
\r
5) The Font Software, modified or unmodified, in part or in whole,\r
must be distributed entirely under this license, and must not be\r
distributed under any other license. The requirement for fonts to\r
remain under this license does not apply to any document created\r
using the Font Software.\r
\r
TERMINATION\r
This license becomes null and void if any of the above conditions are\r
not met.\r
\r
DISCLAIMER\r
THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,\r
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF\r
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT\r
OF COPYRIGHT, PATENT, TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL THE\r
COPYRIGHT HOLDER BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,\r
INCLUDING ANY GENERAL, SPECIAL, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL\r
DAMAGES, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING\r
FROM, OUT OF THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM\r
OTHER DEALINGS IN THE FONT SOFTWARE.\r
`,T=`# License audit

## Licenses found and basic summary of each

* MIT - all good do what you want basically
* CC 4 - share, adapt and change in any format is okay
* SIL OFL 1.1 - free to use, copy, merge, modify, redistribute with conditions: no selling, must contain this original license, must comply to the RFN (Reserved Font Names)
* Apache 2.0 - Basically permissive like MIT but a few things to note. Must include original copyright, note any significant changes to original code, copy of NOTICE file. Modified code does not need to remain under Apache 2.0.
* Creative Commons Attribution-ShareAlike 4.0 (CC BY-SA 4.0) - free to share and change. Must give proper attribution. Must distribute under same license. The font itself once patched indeed is.
* Bitstream Vera License v1.00 - do what want, no selling, must rename font.
* Do What The Fuck You Want To - the name summarizes the rules.
* Go License - Redistribution and everything is allowed. Only limitation is use of Google Inc. to endorse/promote.
* Vic Fieger License - free to do whatever you want
* Monofur Free License - free do what you want just require license file
* Bitstream License - do what you want, attribution required
* Ubuntu Font License 1.0 - do what you want, attribution and license must be included. There may be some ambiguity on the naming, but I believe we comply with it:
  * > (c) Modified Versions which are not Substantially Changed must be
renamed to both (i) retain the name of the Original Version and (ii) add
additional naming elements to distinguish the Modified Version from the
Original Version. The name of such Modified Versions must be the name of
the Original Version, with "derivative X" where X represents the name of
the new work, appended to that name.

## Original source works under Nerd Fonts repository

All files created such as \`font-patcher\` and any \`ph\` or \`sh\` script/source files are released under an MIT license.

## Glyph/icon sources

| Project                                          | License         |
| ------------------------------------------------ | ----------------|
| Codicons                                         | CC BY 4.0       |
| Devicons                                         | MIT             |
| Font Awesome                                     | CC BY 4.0       |
| Font Awesome Extension                           | MIT             |
| Font Logos                                       | Unlicensed      |
| IEC Power Symbols                                | MIT             |
| Material Design Icons                            | Apache 2.0      |
| Original Source (Seti-UI but modified)           | MIT             |
| Octicons                                         | MIT             |
| Pomicons                                         | SIL OFL 1.1     |
| Powerline Extra Symbols                          | MIT             |
| Powerline Symbols                                | Free License    |
| Weather Icons                                    | SIL OFL 1.1     |

### Additional notes

* font awesome - we use the icons which are CC 4.0.
* weather icons - project is unfortunately dead, but added the OFL license files to comply.

## Fonts

* any/all SIL OFL 1.1 licensed fonts have their appropriate license and/or release note information provided in the original unpatched version folders _and_ the patched version folders.

| Font                          | License                      |
| ----------------------------- | ---------------------------- |
| 0xProto                       | SIL OFL 1.1                  |
| 3270                          | BSD-3-Clause                 |
| Agave                         | MIT                          |
| AnonymousPro                  | SIL OFL 1.1                  |
| Arimo                         | Apache 2.0                   |
| AurulentSansMono              | SIL OFL 1.1                  |
| BigBlueTerminal               | CC BY-SA 4.0                 |
| BitstreamVeraSansMono         | Bitstream Vera License v1.00 |
| Cascadia Code                 | SIL OFL 1.1                  |
| CodeNewRoman                  | SIL OFL 1.1                  |
| ComicShannsMono               | MIT                          |
| CommitMono                    | SIL OFL 1.1                  |
| Cousine                       | Apache 2.0                   |
| D2Coding                      | SIL OFL 1.1                  |
| DaddyTimeMono                 | SIL OFL 1.1                  |
| DejaVuSansMono                | Bitstream Vera License v1.00 |
| DroidSansMono                 | Apache 2.0                   |
| EnvyCodeR                     | SIL OFL 1.1                  |
| FantasqueSansMono             | SIL OFL 1.1                  |
| FiraCode                      | SIL OFL 1.1                  |
| FiraMono                      | SIL OFL 1.1                  |
| GeistMono                     | SIL OFL 1.1                  |
| Go-Mono                       | BSD-3-Clause-Clear           |
| Gohu                          | Do What The Fuck You Want To |
| Hack                          | Bitstream-Vera               |
| Hasklig                       | SIL OFL 1.1                  |
| HeavyData                     | Vic Fieger License           |
| Hermit                        | SIL OFL 1.1                  |
| iA Writer                     | SIL OFL 1.1                  |
| IBM Plex Mono                 | SIL OFL 1.1                  |
| Inconsolata                   | SIL OFL 1.1                  |
| InconsolataGo                 | SIL OFL 1.1                  |
| InconsolataLGC                | SIL OFL 1.1                  |
| IntelOneMono                  | SIL OFL 1.1                  |
| Iosevka                       | SIL OFL 1.1                  |
| JetBrainsMono                 | SIL OFL 1.1                  |
| Lekton                        | SIL OFL 1.1                  |
| LiberationMono                | SIL OFL 1.1                  |
| Lilex                         | SIL OFL 1.1                  |
| MartianMono                   | SIL OFL 1.1                  |
| Meslo                         | Apache 2.0                   |
| Monaspace                     | SIL OFL 1.1                  |
| Monofur                       | Monofur Free License         |
| Monoid                        | MIT                          |
| Mononoki                      | SIL OFL 1.1                  |
| MPlus                         | SIL OFL 1.1                  |
| Noto                          | SIL OFL 1.1                  |
| OpenDyslexic                  | Bitstream License            |
| Overpass                      | SIL OFL 1.1                  |
| ProFont                       | MIT                          |
| ProggyClean                   | MIT                          |
| Recursive                     | SIL OFL 1.1                  |
| RobotoMono                    | Apache 2.0                   |
| ShareTechMono                 | SIL OFL 1.1                  |
| SourceCodePro                 | SIL OFL 1.1                  |
| SpaceMono                     | SIL OFL 1.1                  |
| Terminus                      | SIL OFL 1.1                  |
| Tinos                         | Apache 2.0                   |
| Ubuntu                        | Ubuntu Font License 1.0      |
| UbuntuMono                    | Ubuntu Font License 1.0      |
| VictorMono                    | SIL OFL 1.1                  |
| Zed                           | SIL OFL 1.1                  |
`,E=`MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`,O=`MIT License

Copyright (c) 2017 André Luiz Gava

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`,y=`This is free and unencumbered software released into the public domain.

Anyone is free to copy, modify, publish, use, compile, sell, or
distribute this software, either in source code form or as a compiled
binary, for any purpose, commercial or non-commercial, and by any
means.

In jurisdictions that recognize copyright laws, the author or authors
of this software dedicate any and all copyright interest in the
software to the public domain. We make this dedication for the benefit
of the public at large and to the detriment of our heirs and
successors. We intend this dedication to be an overt act of
relinquishment in perpetuity of all present and future rights to this
software under copyright law.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
IN NO EVENT SHALL THE AUTHORS BE LIABLE FOR ANY CLAIM, DAMAGES OR
OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE,
ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR
OTHER DEALINGS IN THE SOFTWARE.

For more information, please refer to <http://unlicense.org>
`,b=`The MIT License (MIT)

Copyright (c) 2013 Joe Loughry

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
`,N=`                                 Apache License
                           Version 2.0, January 2004
                        http://www.apache.org/licenses/

   TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

   1. Definitions.

      "License" shall mean the terms and conditions for use, reproduction,
      and distribution as defined by Sections 1 through 9 of this document.

      "Licensor" shall mean the copyright owner or entity authorized by
      the copyright owner that is granting the License.

      "Legal Entity" shall mean the union of the acting entity and all
      other entities that control, are controlled by, or are under common
      control with that entity. For the purposes of this definition,
      "control" means (i) the power, direct or indirect, to cause the
      direction or management of such entity, whether by contract or
      otherwise, or (ii) ownership of fifty percent (50%) or more of the
      outstanding shares, or (iii) beneficial ownership of such entity.

      "You" (or "Your") shall mean an individual or Legal Entity
      exercising permissions granted by this License.

      "Source" form shall mean the preferred form for making modifications,
      including but not limited to software source code, documentation
      source, and configuration files.

      "Object" form shall mean any form resulting from mechanical
      transformation or translation of a Source form, including but
      not limited to compiled object code, generated documentation,
      and conversions to other media types.

      "Work" shall mean the work of authorship, whether in Source or
      Object form, made available under the License, as indicated by a
      copyright notice that is included in or attached to the work
      (an example is provided in the Appendix below).

      "Derivative Works" shall mean any work, whether in Source or Object
      form, that is based on (or derived from) the Work and for which the
      editorial revisions, annotations, elaborations, or other modifications
      represent, as a whole, an original work of authorship. For the purposes
      of this License, Derivative Works shall not include works that remain
      separable from, or merely link (or bind by name) to the interfaces of,
      the Work and Derivative Works thereof.

      "Contribution" shall mean any work of authorship, including
      the original version of the Work and any modifications or additions
      to that Work or Derivative Works thereof, that is intentionally
      submitted to Licensor for inclusion in the Work by the copyright owner
      or by an individual or Legal Entity authorized to submit on behalf of
      the copyright owner. For the purposes of this definition, "submitted"
      means any form of electronic, verbal, or written communication sent
      to the Licensor or its representatives, including but not limited to
      communication on electronic mailing lists, source code control systems,
      and issue tracking systems that are managed by, or on behalf of, the
      Licensor for the purpose of discussing and improving the Work, but
      excluding communication that is conspicuously marked or otherwise
      designated in writing by the copyright owner as "Not a Contribution."

      "Contributor" shall mean Licensor and any individual or Legal Entity
      on behalf of whom a Contribution has been received by Licensor and
      subsequently incorporated within the Work.

   2. Grant of Copyright License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      copyright license to reproduce, prepare Derivative Works of,
      publicly display, publicly perform, sublicense, and distribute the
      Work and such Derivative Works in Source or Object form.

   3. Grant of Patent License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      (except as stated in this section) patent license to make, have made,
      use, offer to sell, sell, import, and otherwise transfer the Work,
      where such license applies only to those patent claims licensable
      by such Contributor that are necessarily infringed by their
      Contribution(s) alone or by combination of their Contribution(s)
      with the Work to which such Contribution(s) was submitted. If You
      institute patent litigation against any entity (including a
      cross-claim or counterclaim in a lawsuit) alleging that the Work
      or a Contribution incorporated within the Work constitutes direct
      or contributory patent infringement, then any patent licenses
      granted to You under this License for that Work shall terminate
      as of the date such litigation is filed.

   4. Redistribution. You may reproduce and distribute copies of the
      Work or Derivative Works thereof in any medium, with or without
      modifications, and in Source or Object form, provided that You
      meet the following conditions:

      (a) You must give any other recipients of the Work or
          Derivative Works a copy of this License; and

      (b) You must cause any modified files to carry prominent notices
          stating that You changed the files; and

      (c) You must retain, in the Source form of any Derivative Works
          that You distribute, all copyright, patent, trademark, and
          attribution notices from the Source form of the Work,
          excluding those notices that do not pertain to any part of
          the Derivative Works; and

      (d) If the Work includes a "NOTICE" text file as part of its
          distribution, then any Derivative Works that You distribute must
          include a readable copy of the attribution notices contained
          within such NOTICE file, excluding those notices that do not
          pertain to any part of the Derivative Works, in at least one
          of the following places: within a NOTICE text file distributed
          as part of the Derivative Works; within the Source form or
          documentation, if provided along with the Derivative Works; or,
          within a display generated by the Derivative Works, if and
          wherever such third-party notices normally appear. The contents
          of the NOTICE file are for informational purposes only and
          do not modify the License. You may add Your own attribution
          notices within Derivative Works that You distribute, alongside
          or as an addendum to the NOTICE text from the Work, provided
          that such additional attribution notices cannot be construed
          as modifying the License.

      You may add Your own copyright statement to Your modifications and
      may provide additional or different license terms and conditions
      for use, reproduction, or distribution of Your modifications, or
      for any such Derivative Works as a whole, provided Your use,
      reproduction, and distribution of the Work otherwise complies with
      the conditions stated in this License.

   5. Submission of Contributions. Unless You explicitly state otherwise,
      any Contribution intentionally submitted for inclusion in the Work
      by You to the Licensor shall be under the terms and conditions of
      this License, without any additional terms or conditions.
      Notwithstanding the above, nothing herein shall supersede or modify
      the terms of any separate license agreement you may have executed
      with Licensor regarding such Contributions.

   6. Trademarks. This License does not grant permission to use the trade
      names, trademarks, service marks, or product names of the Licensor,
      except as required for reasonable and customary use in describing the
      origin of the Work and reproducing the content of the NOTICE file.

   7. Disclaimer of Warranty. Unless required by applicable law or
      agreed to in writing, Licensor provides the Work (and each
      Contributor provides its Contributions) on an "AS IS" BASIS,
      WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
      implied, including, without limitation, any warranties or conditions
      of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A
      PARTICULAR PURPOSE. You are solely responsible for determining the
      appropriateness of using or redistributing the Work and assume any
      risks associated with Your exercise of permissions under this License.

   8. Limitation of Liability. In no event and under no legal theory,
      whether in tort (including negligence), contract, or otherwise,
      unless required by applicable law (such as deliberate and grossly
      negligent acts) or agreed to in writing, shall any Contributor be
      liable to You for damages, including any direct, indirect, special,
      incidental, or consequential damages of any character arising as a
      result of this License or out of the use or inability to use the
      Work (including but not limited to damages for loss of goodwill,
      work stoppage, computer failure or malfunction, or any and all
      other commercial damages or losses), even if such Contributor
      has been advised of the possibility of such damages.

   9. Accepting Warranty or Additional Liability. While redistributing
      the Work or Derivative Works thereof, You may choose to offer,
      and charge a fee for, acceptance of support, warranty, indemnity,
      or other liability obligations and/or rights consistent with this
      License. However, in accepting such obligations, You may act only
      on Your own behalf and on Your sole responsibility, not on behalf
      of any other Contributor, and only if You agree to indemnify,
      defend, and hold each Contributor harmless for any liability
      incurred by, or claims asserted against, such Contributor by reason
      of your accepting any such warranty or additional liability.

   END OF TERMS AND CONDITIONS

   APPENDIX: How to apply the Apache License to your work.

      To apply the Apache License to your work, attach the following
      boilerplate notice, with the fields enclosed by brackets "[]"
      replaced with your own identifying information. (Don't include
      the brackets!)  The text should be enclosed in the appropriate
      comment syntax for the file format. We also recommend that a
      file or class name and description of purpose be included on the
      same "printed page" as the copyright notice for easier
      identification within third-party archives.

   Copyright [yyyy] [name of copyright owner]

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.

`,S=`Copyright (c) 2014 Jesse Weed

Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
"Software"), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE
LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
`,R="./assets/fonts/",L=Object.assign({"./assets/fonts/LICENSES.md":o,"./assets/fonts/OFL-FiraCode.txt":i,"./assets/fonts/OFL-IBMPlexMono.txt":r,"./assets/fonts/OFL-JetBrainsMono.txt":s,"./assets/fonts/nerd-fonts/LICENSE.md":a,"./assets/fonts/nerd-fonts/README.md":d,"./assets/fonts/nerd-fonts/glyphs/codicons-LICENSE.txt":h,"./assets/fonts/nerd-fonts/glyphs/font-awesome-LICENSE.txt":c,"./assets/fonts/nerd-fonts/glyphs/materialdesign-LICENSE":l,"./assets/fonts/nerd-fonts/glyphs/octicons-LICENSE":u,"./assets/fonts/nerd-fonts/glyphs/pomicons-LICENSE":f,"./assets/fonts/nerd-fonts/glyphs/powerline-extra-LICENSE":m,"./assets/fonts/nerd-fonts/glyphs/powerline-symbols-LICENSE.txt":p,"./assets/fonts/nerd-fonts/glyphs/weather-icons-OFL.txt":I,"./assets/fonts/nerd-fonts/license-audit.md":T,"./assets/fonts/nerd-fonts/upstream/devicons-LICENSE":E,"./assets/fonts/nerd-fonts/upstream/font-awesome-extension-LICENCE":O,"./assets/fonts/nerd-fonts/upstream/font-logos-LICENSE":y,"./assets/fonts/nerd-fonts/upstream/iec-power-symbols-LICENSE.txt":b,"./assets/fonts/nerd-fonts/upstream/materialdesign-Apache-2.0.txt":N,"./assets/fonts/nerd-fonts/upstream/seti-ui-LICENSE.md":S}),A=Object.entries(L).map(([e,n])=>({path:e.slice(R.length),text:n})).sort(t);export{A as NOTICES};
