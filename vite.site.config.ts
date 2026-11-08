// Builds the project site's browser demo (site/demo) into docs/demo, which
// GitHub Pages serves. Run with `pnpm site:build`.
import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string };

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// The app ships four 2.2 MB Nerd Font TTFs; the demo uses woff2 subsets of
// them (site/subset-fonts.sh) with only the characters the UI shows.
const subsetFonts: Plugin = {
  name: "glasshouse-demo-fonts",
  enforce: "pre",
  transform(code, id) {
    if (!id.endsWith("/src/styles/app.css")) return null;
    return code.replace(
      /url\("\.\.\/assets\/fonts\/(JetBrainsMonoNerdFont-\w+)\.ttf"\) format\("truetype"\)/g,
      'url("../../site/demo/fonts/$1.woff2") format("woff2")',
    );
  },
};

// The landing page (docs/index.html) uses the app's theme tokens directly.
const copyThemes: Plugin = {
  name: "glasshouse-site-themes",
  apply: "build",
  closeBundle() {
    mkdirSync(here("./docs/assets"), { recursive: true });
    copyFileSync(here("./src/styles/themes.css"), here("./docs/assets/themes.css"));
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
    __BUILD_DATE__: JSON.stringify(new Date().toISOString().slice(0, 10)),
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
