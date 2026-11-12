// Builds the project site's browser demo (site/demo) into docs/demo, which
// GitHub Pages serves. Run with `pnpm site:build`.
import { execFileSync } from "node:child_process";
import { copyFileSync, cpSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string };

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// The demo's About date is the date of the newest commit that changed what the
// demo is built from, not today, so rebuilding unchanged sources gives the
// same docs/demo (CI checks the committed copy is current; it needs the full
// history). Uncommitted changes to those sources, or no git, mean today.
const DEMO_SOURCES = ["src", "site", "package.json", "pnpm-lock.yaml", "vite.site.config.ts", "tsconfig.site.json"];
function demoBuildDate(): string {
  const today = new Date().toISOString().slice(0, 10);
  const git = (...args: string[]) => execFileSync("git", args, { cwd: here("."), encoding: "utf8" }).trim();
  try {
    if (git("status", "--porcelain", "--", ...DEMO_SOURCES)) return today;
    return git("log", "-1", "--format=%cs", "--", ...DEMO_SOURCES) || today;
  } catch {
    return today;
  }
}

// The app ships four ~920 KB Nerd Font woff2 files; the demo uses subsets of
// them (site/subset-fonts.sh) with only the characters the UI shows.
const subsetFonts: Plugin = {
  name: "glasshouse-demo-fonts",
  enforce: "pre",
  transform(code, id) {
    if (!id.endsWith("/src/styles/app.css")) return null;
    return code.replace(
      /url\("\.\.\/assets\/fonts\/(JetBrainsMonoNerdFont-\w+)\.(?:ttf|woff2)"\) format\("(?:truetype|woff2)"\)/g,
      'url("../../site/demo/fonts/$1.woff2") format("woff2")',
    );
  },
};

// After the build: the landing page (docs/index.html) uses the app's theme
// tokens directly, and the demo's fonts are served publicly, so their license
// texts (everything in src/assets/fonts that isn't a font) go alongside them.
const copyThemes: Plugin = {
  name: "glasshouse-site-themes",
  apply: "build",
  closeBundle() {
    mkdirSync(here("./docs/assets"), { recursive: true });
    copyFileSync(here("./src/styles/themes.css"), here("./docs/assets/themes.css"));
    const fonts = here("./src/assets/fonts");
    const licenses = here("./docs/demo/licenses");
    mkdirSync(licenses, { recursive: true });
    const texts = readdirSync(fonts).filter(f => !/\.(ttf|otf|woff2?)$/i.test(f));
    for (const f of texts) cpSync(`${fonts}/${f}`, `${licenses}/${f}`, { recursive: true });
    writeFileSync(`${licenses}/README.txt`, [
      "Fonts in this demo (assets/*.woff2) and their licenses:",
      "",
      "- JetBrainsMonoNerdFont-*.woff2: subsets of JetBrains Mono Nerd Font, keeping only",
      "  the characters the demo's interface shows (made by site/subset-fonts.sh in the",
      "  glasshouse repository). JetBrains Mono is under the SIL Open Font License 1.1",
      "  (OFL-JetBrainsMono.txt); Nerd Fonts patched in additional glyphs, whose license",
      "  and glyph-set notices are in nerd-fonts/ (LICENSES.md says which covers what).",
      "- JetBrainsMono-*, IBMPlexMono-*, FiraCode-*.woff2: the app's bundled copies of",
      "  these fonts, each under the SIL Open Font License 1.1 (OFL-*.txt).",
      "",
      `License texts in this folder: ${texts.join(", ")}.`,
      "",
    ].join("\n"));
  },
};

// GitHub Pages runs Jekyll, which skips files whose names start with "_" or ".".
const safe = (name: string) => name.replace(/^[_.#~]+/, "");

export default defineConfig({
  root: "site/demo",
  base: "./",
  plugins: [react(), subsetFonts, copyThemes],
  resolve: {
    alias: [
      // No PDFs in the demo's files, so pdf.js (about 1.7 MB) stays out.
      { find: /^pdfjs-dist(\/.*)?$/, replacement: here("./site/demo/stubs/pdfjs.ts") },
    ],
  },
  define: {
    __BUILD_DATE__: JSON.stringify(demoBuildDate()),
    __DEMO_VERSION__: JSON.stringify(pkg.version),
  },
  server: { port: 5182, strictPort: true },
  preview: { port: 5183, strictPort: true },
  build: {
    outDir: "../../docs/demo",
    emptyOutDir: true,
    target: "es2020",
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        entryFileNames: chunk => `assets/${safe(chunk.name)}-[hash].js`,
        chunkFileNames: chunk => `assets/${safe(chunk.name)}-[hash].js`,
        assetFileNames: asset => `assets/${safe((asset.names?.[0] ?? asset.name ?? "asset").replace(/\.[^.]+$/, ""))}-[hash][extname]`,
      },
    },
  },
});
