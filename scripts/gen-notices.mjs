#!/usr/bin/env node
// Writes src/assets/third-party.json: the licenses of the npm packages and
// Rust crates that ship in the app, for Help → Third-party Notices.
//
//   pnpm notices           regenerate the file
//   pnpm notices --check   exit 1 if the committed file is out of date (CI)
//
// Needs cargo-about 0.9 (`cargo install cargo-about --locked --features cli`)
// and the crates already fetched (`cargo fetch --locked` in src-tauri): it
// runs offline, so the output depends only on the lockfiles.
//
// npm: the packages Vite actually bundles, read from a build that writes
// nothing, with each package's own license files. Rust: cargo-about, once per
// release target, which skips build and dev dependencies and picks one
// license of a dual-licensed crate (the first in about.toml's `accepted`).
// Each license text is stored once and referenced by index.
// docs/decisions/2026-11-10-dependency-notices-generated.md

import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "src/assets/third-party.json");
const TAURI = join(ROOT, "src-tauri");

/** Release targets, by the platform the view filters on. Both Linux
 *  architectures are listed because the user builds arm64 locally. */
const TARGETS = {
  linux: ["x86_64-unknown-linux-gnu", "aarch64-unknown-linux-gnu"],
  windows: ["x86_64-pc-windows-msvc"],
};

const LICENSE_FILE = /^(licen[cs]e|copying|notice)/i;

/** C libraries that -sys crates can compile from bundled source into the
 *  app, with their license files inside the crate, where cargo-about's
 *  crate-level detection doesn't look. A missing file fails the run, so a
 *  crate update that moves one gets noticed rather than dropped. */
const BUNDLED_C = {
  "libgit2-sys": [["libgit2", "libgit2/COPYING"]],
  "zstd-sys": [["zstd", "zstd/LICENSE"]],
  "libz-sys": [["zlib", "src/zlib/LICENSE"]],
  "bzip2-sys": [["bzip2", "bzip2-1.0.8/LICENSE"]],
  "lzma-sys": [["liblzma (xz)", "xz-5.2/COPYING"]],
};

/** Package roots of every node_modules module in the production bundle. */
async function bundledPackageDirs() {
  const dirs = new Set();
  await build({
    root: ROOT,
    configFile: join(ROOT, "vite.config.ts"),
    logLevel: "warn",
    build: { write: false },
    plugins: [{
      name: "collect-bundled-packages",
      generateBundle(_, bundle) {
        for (const out of Object.values(bundle)) {
          if (out.type !== "chunk") continue;
          for (const id of Object.keys(out.modules)) {
            // Plugin helpers have virtual ids: "\0" in front, a "?query" behind.
            const file = id.replace(/^\0/, "").replace(/\?.*$/, "").replace(/\\/g, "/");
            const m = /^(.*\/node_modules\/(?:@[^/]+\/)?[^/]+)\//.exec(file);
            if (m) dirs.add(m[1]);
          }
        }
      },
    }],
  });
  return [...dirs];
}

function npmPackages() {
  return bundledPackageDirs().then((dirs) =>
    dirs.map((dir) => {
      const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
      const files = readdirSync(dir).filter((f) => LICENSE_FILE.test(f)).sort();
      if (files.length === 0) throw new Error(`${pkg.name}: no license file in ${dir}`);
      return {
        name: pkg.name,
        version: pkg.version,
        license: typeof pkg.license === "string" ? pkg.license : "see license file",
        // Titled by file name: npm packages don't say which SPDX license a file holds.
        licenses: files.map((f) => ({ id: f, text: readFileSync(join(dir, f), "utf8") })),
      };
    }),
  );
}

/** Crates cargo-about lists for `target`, with the license texts it chose. */
function rustCrates(target) {
  const json = execFileSync(
    "cargo",
    ["about", "generate", "--format", "json", "--offline", "--locked", "--fail", "--target", target],
    { cwd: TAURI, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "inherit"] },
  );
  const data = JSON.parse(json);
  const crates = new Map();
  const dirs = new Map();
  for (const c of data.crates) {
    const { name, version, manifest_path } = c.package;
    if (name === "glasshouse") continue; // the app itself
    crates.set(`${name}@${version}`, { name, version, license: c.license, licenses: [] });
    dirs.set(`${name}@${version}`, dirname(manifest_path));
  }
  for (const lic of data.licenses) {
    for (const { crate } of lic.used_by) {
      crates.get(`${crate.name}@${crate.version}`)?.licenses.push({ id: lic.id, text: lic.text });
    }
  }
  for (const [key, c] of crates) {
    for (const [lib, file] of BUNDLED_C[c.name] ?? []) {
      const text = readFileSync(join(dirs.get(key), file), "utf8");
      c.licenses.push({ id: `${lib} (bundled C source)`, text });
    }
  }
  return [...crates.values()];
}

/** Store each distinct text once; entries point at it by index. */
function dedupe(npm, rust) {
  const texts = [];
  const index = new Map();
  const ref = ({ id, text }) => {
    if (!index.has(text)) {
      index.set(text, texts.length);
      texts.push(text);
    }
    return { id, text: index.get(text) };
  };
  const pack = ({ licenses, ...rest }) => ({ ...rest, licenses: licenses.map(ref) });
  return { npm: npm.map(pack), rust: rust.map(pack), texts };
}

const byName = (a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version);

async function generate() {
  const npm = (await npmPackages()).sort(byName);

  const rust = new Map();
  for (const [platform, targets] of Object.entries(TARGETS)) {
    for (const target of targets) {
      for (const c of rustCrates(target)) {
        const key = `${c.name}@${c.version}`;
        const seen = rust.get(key) ?? { ...c, platforms: [] };
        if (!seen.platforms.includes(platform)) seen.platforms.push(platform);
        rust.set(key, seen);
      }
    }
  }
  for (const c of rust.values()) {
    if (c.licenses.length === 0) throw new Error(`${c.name} ${c.version}: no license text`);
    c.platforms.sort();
  }

  const { texts, ...lists } = dedupe(npm, [...rust.values()].sort(byName));
  const data = {
    note: "Generated by scripts/gen-notices.mjs; don't edit. Run `pnpm notices` after changing a lockfile.",
    ...lists,
    texts,
  };
  return JSON.stringify(data, null, 1) + "\n";
}

const fresh = await generate();
if (process.argv.includes("--check")) {
  let committed = "";
  try { committed = readFileSync(OUT, "utf8"); } catch { /* missing counts as stale */ }
  if (committed !== fresh) {
    console.error("src/assets/third-party.json is out of date: run `pnpm notices` and commit it.");
    process.exit(1);
  }
  console.log("third-party.json is up to date");
} else {
  writeFileSync(OUT, fresh);
  const data = JSON.parse(fresh);
  console.log(
    `wrote ${OUT}: ${data.npm.length} npm packages, ${data.rust.length} crates, ` +
    `${data.texts.length} license texts, ${(fresh.length / 1024).toFixed(0)} KB`,
  );
}
