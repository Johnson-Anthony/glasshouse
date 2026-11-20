// A file's type for its icon: a key the icon sets in app.css draw from
// (`.ic[data-ft=…]`: a Nerd Font glyph, a color, a shape). Computed once per
// row render from what the row already has; switching icon sets is CSS only.

import type { FileKind } from "./data";

const BY_EXT: Record<string, string> = {};
const add = (type: string, exts: string) => { for (const e of exts.split(" ")) BY_EXT[e] = type; };

add("ts", "ts mts cts");
add("react", "tsx jsx");
add("js", "js mjs cjs");
add("json", "json jsonc json5 webmanifest");
add("html", "html htm xhtml");
add("css", "css");
add("sass", "scss sass less styl");
add("vue", "vue svelte astro");
add("py", "py pyw pyi ipynb");
add("rs", "rs");
add("go", "go");
add("c", "c h");
add("cpp", "cpp cc cxx hpp hh hxx");
add("cs", "cs csx");
add("java", "java jar class");
add("kt", "kt kts");
add("swift", "swift");
add("rb", "rb gemspec");
add("php", "php");
add("lua", "lua");
add("dart", "dart");
add("hs", "hs lhs");
add("scala", "scala sc");
add("pl", "pl pm");
add("zig", "zig");
add("nix", "nix");
add("vim", "vim");
add("shell", "sh bash zsh fish ksh");
add("ps", "ps1 psm1 psd1 bat cmd");
add("sql", "sql sqlite db sqlite3");
add("yaml", "yml yaml");
add("toml", "toml");
add("xml", "xml xsl plist");
add("config", "ini cfg conf config properties editorconfig env");
add("lock", "lock");
add("md", "md markdown mdx rst");
add("tex", "tex bib sty");
add("text", "txt log nfo me");
add("csv", "csv tsv");
add("pdf", "pdf");
add("doc", "doc docx odt rtf pages");
add("sheet", "xls xlsx ods numbers");
add("slides", "ppt pptx odp key");
add("svg", "svg");
add("image", "png jpg jpeg gif webp bmp ico tif tiff heic heif avif psd xcf raw cr2 nef");
add("audio", "mp3 flac wav ogg oga opus m4a aac wma mid midi");
add("video", "mp4 mkv webm mov avi wmv flv m4v mpg mpeg");
add("archive", "zip 7z rar tar gz tgz bz2 xz zst lz lzma cab");
add("package", "deb rpm apk msi pkg dmg appimage flatpak snap whl crate");
add("disk", "iso img vhd vhdx vmdk qcow2");
add("exe", "exe dll so dylib bin elf app com");
add("font", "ttf otf woff woff2 fon");
add("key", "pem crt cer key pub gpg asc p12 pfx sig");

const BY_NAME: Record<string, string> = {
  "dockerfile": "docker", "containerfile": "docker", "docker-compose.yml": "docker", "compose.yaml": "docker",
  "makefile": "make", "gnumakefile": "make", "cmakelists.txt": "make", "justfile": "make",
  ".gitignore": "git", ".gitattributes": "git", ".gitmodules": "git",
  "license": "license", "license.md": "license", "license.txt": "license", "copying": "license",
  "package.json": "npm", "package-lock.json": "lock", "pnpm-lock.yaml": "lock", "yarn.lock": "lock", "cargo.lock": "lock",
  "readme": "md", "readme.md": "md",
};

/** The icon type of a row. `ext` is the extension without its dot, `name`
 *  the whole name; the backend's `kind` covers what neither names. */
export function fileType(kind: FileKind, ext: string | null | undefined, name?: string): string {
  if (kind === "folder") return "folder";
  const n = name?.toLowerCase();
  if (n && BY_NAME[n]) return BY_NAME[n];
  const e = ext?.toLowerCase();
  if (e && BY_EXT[e]) return BY_EXT[e];
  switch (kind) {
    case "code": return "code";
    case "img": return "image";
    case "archive": return "archive";
    case "exec": return "exe";
    default: return "file";
  }
}
