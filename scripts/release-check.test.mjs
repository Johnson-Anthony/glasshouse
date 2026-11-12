import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { describe, expect, it } from "vitest";
import { changelogSection, check, manifestVersions, tagVersion } from "./release-check.mjs";

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
const repoRead = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");

/** A repo whose manifests are all at `version`, with these changelog lines. */
function repo(version, changelog, over = {}) {
  const files = {
    "package.json": JSON.stringify({ name: "glasshouse", version }),
    "src-tauri/tauri.conf.json": JSON.stringify({ productName: "glasshouse", version }),
    "src-tauri/Cargo.toml": `[package]\nname = "glasshouse"\nversion = "${version}"\n\n[build-dependencies]\ntauri-build = { version = "2.0" }\n`,
    "src-tauri/Cargo.lock": `[[package]]\nname = "gio"\nversion = "0.18.4"\n\n[[package]]\nname = "glasshouse"\nversion = "${version}"\n`,
    "CHANGELOG.md": changelog.join("\n"),
    ...over,
  };
  return (file) => files[file];
}

const GOOD = ["# Changelog", "", "## [0.2.0] - 2026-11-20", "", "### Fixed", "- Paste no longer empties files.", "", "## [0.1.0] - 2026-07-16", "- First release."];

describe("release-check", () => {
  it("passes a tag whose version, manifests and dated changelog section agree", () => {
    const { problems, notes } = check("v0.2.0", repo("0.2.0", GOOD));
    expect(problems).toEqual([]);
    expect(notes).toBe("### Fixed\n- Paste no longer empties files.");
  });

  it("refuses anything but a v<x.y.z> tag (a manual run from a branch)", () => {
    for (const ref of ["main", "0.2.0", "v0.2", "v0.2.0-rc.1", "", undefined]) {
      expect(tagVersion(ref)).toBeNull();
      expect(check(ref, repo("0.2.0", GOOD)).problems).toHaveLength(1);
    }
  });

  it("names each manifest that doesn't match the tag", () => {
    const read = repo("0.2.0", GOOD, { "src-tauri/Cargo.lock": `[[package]]\nname = "glasshouse"\nversion = "0.1.0"\n` });
    const { problems } = check("v0.2.0", read);
    expect(problems).toEqual(["src-tauri/Cargo.lock has version 0.1.0, but the tag is v0.2.0"]);
    expect(check("v0.2.1", repo("0.2.0", GOOD)).problems).toHaveLength(5);
  });

  it("reads Cargo.toml's [package] version, not a dependency's", () => {
    const read = repo("0.2.0", GOOD, {
      "src-tauri/Cargo.toml": `[lib]\nname = "x"\n\n[dependencies]\nserde = { version = "1" }\n\n[package]\nname = "glasshouse"\nversion = "0.2.0"\n`,
    });
    expect(manifestVersions(read)["src-tauri/Cargo.toml"]).toBe("0.2.0");
  });

  it("needs a dated section with no TODO(release) marker", () => {
    const missing = check("v0.3.0", repo("0.3.0", GOOD)).problems;
    expect(missing).toEqual(['CHANGELOG.md has no "## [0.3.0] - <date>" section']);

    const undated = ["## [0.2.0] - unreleased", "- Fix."];
    expect(check("v0.2.0", repo("0.2.0", undated)).problems[0]).toMatch(/needs the release date/);

    const todo = ["## [0.2.0] - 2026-11-20", "- Fix.", "<!-- TODO(release): wave 1 -->"];
    expect(check("v0.2.0", repo("0.2.0", todo)).problems[0]).toMatch(/TODO\(release\)/);
  });

  it("stops a section at the next version heading", () => {
    expect(changelogSection(GOOD.join("\n"), "0.1.0")).toEqual({ heading: "## [0.1.0] - 2026-07-16", body: "- First release." });
    expect(changelogSection(GOOD.join("\n"), "0.2")).toBeNull();
  });

  it("finds the same version in every manifest of this repo", () => {
    const versions = Object.values(manifestVersions(repoRead));
    expect(versions[0]).toMatch(/^\d+\.\d+\.\d+$/);
    expect(new Set(versions).size).toBe(1);
  });
});
