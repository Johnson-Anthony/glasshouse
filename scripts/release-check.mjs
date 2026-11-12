#!/usr/bin/env node
// release-check.mjs
//
// The release workflow's first check (.github/workflows/release.yml). For a
// tag such as v0.2.0 it checks that the tag can be released:
//
//   - the tag is v<major>.<minor>.<patch>;
//   - package.json, src-tauri/Cargo.toml, src-tauri/tauri.conf.json and the
//     glasshouse entry in src-tauri/Cargo.lock all have that version;
//   - CHANGELOG.md has a section for it, dated (## [0.2.0] - 2026-11-20),
//     with no TODO(release) marker left in it.
//
// Then it prints that section's text, which becomes the release notes.
//
//   node scripts/release-check.mjs v0.2.0 > notes.md   # exits 1, problems on stderr

import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");

/** The version a release tag names, or null if it isn't v<x.y.z>. */
export function tagVersion(tag) {
  const m = /^v(\d+\.\d+\.\d+)$/.exec(tag ?? "");
  return m ? m[1] : null;
}

/** The app version in each manifest, keyed by path (null if not found). */
export function manifestVersions(read) {
  const json = (file) => {
    try { return JSON.parse(read(file)).version ?? null; } catch { return null; }
  };
  // The version line of Cargo.toml's [package] table, not a dependency's.
  const cargoToml = (() => {
    let inPackage = false;
    for (const line of read("src-tauri/Cargo.toml").split(/\r?\n/)) {
      const table = /^\s*\[([^\]]+)\]/.exec(line);
      if (table) inPackage = table[1].trim() === "package";
      const v = inPackage && /^\s*version\s*=\s*"([^"]+)"/.exec(line);
      if (v) return v[1];
    }
    return null;
  })();
  const lock = /\[\[package\]\]\r?\nname = "glasshouse"\r?\nversion = "([^"]+)"/.exec(read("src-tauri/Cargo.lock"));
  return {
    "package.json": json("package.json"),
    "src-tauri/Cargo.toml": cargoToml,
    "src-tauri/tauri.conf.json": json("src-tauri/tauri.conf.json"),
    "src-tauri/Cargo.lock": lock ? lock[1] : null,
  };
}

/** CHANGELOG.md's section for a version: its heading line and the text under it. */
export function changelogSection(text, version) {
  const lines = text.split(/\r?\n/);
  const esc = version.replace(/\./g, "\\.");
  const start = lines.findIndex((l) => new RegExp(`^## \\[?${esc}\\]?(\\s|$)`).test(l));
  if (start < 0) return null;
  let end = lines.findIndex((l, i) => i > start && /^## /.test(l));
  if (end < 0) end = lines.length;
  return { heading: lines[start], body: lines.slice(start + 1, end).join("\n").trim() };
}

/** Everything wrong with releasing `tag`, and the release notes. */
export function check(tag, read) {
  const problems = [];
  const version = tagVersion(tag);
  if (!version) {
    return { problems: [`"${tag}" isn't a release tag; tag the release v<major>.<minor>.<patch>, such as v0.2.0`], notes: "" };
  }
  for (const [file, v] of Object.entries(manifestVersions(read))) {
    if (v !== version) problems.push(`${file} has version ${v ?? "(none found)"}, but the tag is ${tag}`);
  }
  let notes = "";
  const section = changelogSection(read("CHANGELOG.md"), version);
  if (!section) {
    problems.push(`CHANGELOG.md has no "## [${version}] - <date>" section`);
  } else {
    if (!/ - \d{4}-\d{2}-\d{2}\s*$/.test(section.heading)) {
      problems.push(`CHANGELOG.md's heading "${section.heading}" needs the release date: "## [${version}] - YYYY-MM-DD"`);
    }
    if (section.body.includes("TODO(release)")) {
      problems.push(`CHANGELOG.md's ${version} section still has a TODO(release) marker; finish that section and delete the marker`);
    }
    if (!section.body) problems.push(`CHANGELOG.md's ${version} section is empty`);
    notes = section.body;
  }
  return { problems, notes };
}

if (process.argv[1] && path.resolve(process.argv[1]) === url.fileURLToPath(import.meta.url)) {
  const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");
  const { problems, notes } = check(process.argv[2], read);
  if (problems.length) {
    for (const p of problems) console.error(`release-check: ${p}`);
    process.exit(1);
  }
  process.stdout.write(notes + "\n");
}
