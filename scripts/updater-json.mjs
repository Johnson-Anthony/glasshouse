#!/usr/bin/env node
// updater-json.mjs
//
// The release workflow's update manifest (.github/workflows/release.yml).
// The app's updater (src-tauri/src/update.rs) reads latest.json from the
// latest release, finds the package for its install, and installs it only
// if the package's minisign signature checks out against the public key in
// tauri.conf.json (plugins.updater.pubkey) and names the version announced.
// This checks the same things before a release is published, so a missing
// or wrong signing key fails the release instead of every user's update.
//
//   node scripts/updater-json.mjs files 0.3.0
//       the release's package names, one a line
//   node scripts/updater-json.mjs verify <file> <file.sig> [version]
//       checks one signature (the workflow's probe of the signing key)
//   node scripts/updater-json.mjs write v0.3.0 <dir> <notes.md> <latest.json>
//       checks every package in <dir> against its .sig, then writes
//       latest.json, with <notes.md> (the CHANGELOG section) as its notes
//
// Exits 1 with the problems on stderr. Signatures are Tauri's .sig files:
// base64 of a minisign signature file, made by `tauri build` with
// createUpdaterArtifacts (src-tauri/release.conf.json).

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");

/** Each package the release has, with the latest.json keys that point at
 *  it. The updater looks for `<os>-<arch>-<installer>` first (installer: how
 *  the running copy was installed), then `<os>-<arch>`, which goes to the
 *  setup.exe and the AppImage, the packages most people have. */
export function packages(version) {
  const v = version;
  return [
    { name: `glasshouse_${v}_x64-setup.exe`, keys: ["windows-x86_64-nsis", "windows-x86_64"] },
    { name: `glasshouse_${v}_x64_en-US.msi`, keys: ["windows-x86_64-msi"] },
    { name: `glasshouse_${v}_arm64-setup.exe`, keys: ["windows-aarch64-nsis", "windows-aarch64"] },
    { name: `glasshouse_${v}_arm64_en-US.msi`, keys: ["windows-aarch64-msi"] },
    { name: `glasshouse_${v}_amd64.AppImage`, keys: ["linux-x86_64-appimage", "linux-x86_64"] },
    { name: `glasshouse_${v}_amd64.deb`, keys: ["linux-x86_64-deb"] },
    { name: `glasshouse_${v}_aarch64.AppImage`, keys: ["linux-aarch64-appimage", "linux-aarch64"] },
    { name: `glasshouse_${v}_arm64.deb`, keys: ["linux-aarch64-deb"] },
  ];
}

/** base64 text → its lines, for Tauri's keys and signatures, which are
 *  base64 of a minisign file. A bare minisign key line ("RW…") is taken as
 *  it is. */
function minisignLines(b64) {
  const text = Buffer.from(b64.trim(), "base64").toString("utf8");
  return text.split(/\r?\n/).filter(l => l.length > 0);
}

/** A minisign public key: its 8-byte id and 32-byte Ed25519 key. */
export function decodePublicKey(pubkey) {
  const t = pubkey.trim();
  const line = t.startsWith("RW") ? t : minisignLines(t).find(l => !l.startsWith("untrusted comment:"));
  const raw = line ? Buffer.from(line, "base64") : Buffer.alloc(0);
  if (raw.length !== 42 || raw.subarray(0, 2).toString("latin1") !== "Ed") {
    throw new Error("the public key isn't a minisign Ed25519 key");
  }
  return { keyId: raw.subarray(2, 10), key: raw.subarray(10) };
}

/** A minisign signature file, from Tauri's base64 .sig text. */
export function decodeSignature(sig) {
  const lines = minisignLines(sig);
  const at = lines.findIndex(l => l.startsWith("untrusted comment:"));
  const [sigLine, trustedLine, globalLine] = lines.slice(at + 1);
  const raw = sigLine ? Buffer.from(sigLine, "base64") : Buffer.alloc(0);
  const alg = raw.subarray(0, 2).toString("latin1");
  if (at < 0 || raw.length !== 74 || (alg !== "ED" && alg !== "Ed")) {
    throw new Error("not a minisign signature");
  }
  if (!trustedLine?.startsWith("trusted comment: ") || !globalLine) {
    throw new Error("the signature has no trusted comment");
  }
  const global = Buffer.from(globalLine, "base64");
  if (global.length !== 64) throw new Error("the signature's trusted comment isn't signed");
  return {
    prehashed: alg === "ED",
    keyId: raw.subarray(2, 10),
    signature: raw.subarray(10),
    trusted: trustedLine.slice("trusted comment: ".length),
    global,
  };
}

function ed25519(key) {
  return crypto.createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: key.toString("base64url") }, format: "jwk" });
}

/** The version a signature was made for (`tauri build` writes it into the
 *  trusted comment as `version:<v>`), or null. */
export function signedVersion(trusted) {
  for (const field of trusted.split("\t")) {
    if (field.startsWith("version:")) return field.slice("version:".length);
  }
  return null;
}

/** Checks `data` against a Tauri .sig with `pubkey` (tauri.conf.json's
 *  form). Returns the trusted comment's fields; throws saying what's wrong. */
export function verify(data, sig, pubkey) {
  const pk = decodePublicKey(pubkey);
  const s = decodeSignature(sig);
  if (!s.keyId.equals(pk.keyId)) {
    const id = b => Buffer.from(b).reverse().toString("hex").toUpperCase();
    throw new Error(`signed with key ${id(s.keyId)}, but tauri.conf.json's public key is ${id(pk.keyId)}`);
  }
  const key = ed25519(pk.key);
  const message = s.prehashed ? crypto.createHash("blake2b512").update(data).digest() : data;
  if (!crypto.verify(null, message, key, s.signature)) throw new Error("the signature doesn't match the file");
  if (!crypto.verify(null, Buffer.concat([s.signature, Buffer.from(s.trusted, "utf8")]), key, s.global)) {
    throw new Error("the signature's trusted comment was changed");
  }
  return { trusted: s.trusted, version: signedVersion(s.trusted) };
}

/** tauri.conf.json's updater public key and endpoint. */
export function updaterConfig(read = file => fs.readFileSync(path.join(ROOT, file), "utf8")) {
  const conf = JSON.parse(read("src-tauri/tauri.conf.json"));
  const u = conf.plugins?.updater ?? {};
  return { pubkey: u.pubkey ?? "", endpoint: (u.endpoints ?? [])[0] ?? "" };
}

/** Where a release's files download from, from the app's endpoint
 *  (https://github.com/<owner>/<repo>/releases/latest/download/latest.json),
 *  so the manifest points at the repo the app asks. */
export function downloadBase(endpoint, tag) {
  const m = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/releases\/latest\/download\/latest\.json$/.exec(endpoint);
  if (!m) throw new Error(`the updater endpoint isn't a GitHub latest-release latest.json: ${endpoint || "(none)"}`);
  return `https://github.com/${m[1]}/${m[2]}/releases/download/${encodeURIComponent(tag)}`;
}

/** latest.json for `version`: each package's URL and signature under its
 *  keys. `sigs` maps package names to their .sig text. */
export function manifest({ version, notes, pubDate, base, sigs }) {
  const platforms = {};
  for (const p of packages(version)) {
    const signature = sigs[p.name];
    if (signature === undefined) throw new Error(`no signature for ${p.name}`);
    for (const key of p.keys) {
      platforms[key] = { signature: signature.trim(), url: `${base}/${encodeURIComponent(p.name)}` };
    }
  }
  return { version, notes, pub_date: pubDate, platforms };
}

/** Checks every package in `dir` and returns latest.json and the problems. */
export function build({ tag, dir, notes, pubDate = new Date().toISOString(), config = updaterConfig() }) {
  const problems = [];
  const version = /^v(\d+\.\d+\.\d+)$/.exec(tag)?.[1];
  if (!version) return { problems: [`${tag} isn't a v<major>.<minor>.<patch> tag`] };
  if (!config.pubkey) problems.push("tauri.conf.json has no plugins.updater.pubkey");
  let base = "";
  try { base = downloadBase(config.endpoint, tag); } catch (e) { problems.push(e.message); }
  const sigs = {};
  for (const p of packages(version)) {
    const file = path.join(dir, p.name);
    if (!fs.existsSync(file)) { problems.push(`${p.name} is missing`); continue; }
    if (!fs.existsSync(`${file}.sig`)) { problems.push(`${p.name}.sig is missing: was the build signed?`); continue; }
    const sig = fs.readFileSync(`${file}.sig`, "utf8");
    try {
      const { version: signed } = verify(fs.readFileSync(file), sig, config.pubkey);
      if (signed !== version) problems.push(`${p.name} is signed for version ${signed ?? "(none)"}, not ${version}`);
      else sigs[p.name] = sig;
    } catch (e) {
      problems.push(`${p.name}: ${e.message}`);
    }
  }
  if (problems.length) return { problems };
  return { problems, json: manifest({ version, notes, pubDate, base, sigs }) };
}

function main(argv) {
  const [cmd, ...args] = argv;
  const fail = msg => { console.error(msg); return 1; };
  if (cmd === "files" && args.length === 1) {
    for (const p of packages(args[0])) console.log(p.name);
    return 0;
  }
  if (cmd === "verify" && (args.length === 2 || args.length === 3)) {
    const [file, sigFile, want] = args;
    const { pubkey } = updaterConfig();
    try {
      const { version } = verify(fs.readFileSync(file), fs.readFileSync(sigFile, "utf8"), pubkey);
      if (want && version !== want) return fail(`signed for version ${version ?? "(none)"}, not ${want}`);
      console.log(`${path.basename(file)}: signature OK${version ? ` (version ${version})` : ""}`);
      return 0;
    } catch (e) {
      return fail(`${path.basename(file)}: ${e.message}`);
    }
  }
  if (cmd === "write" && args.length === 4) {
    const [tag, dir, notesFile, out] = args;
    const { problems, json } = build({ tag, dir, notes: fs.readFileSync(notesFile, "utf8").trim() });
    if (problems.length) return fail(problems.map(p => `updater-json: ${p}`).join("\n"));
    fs.writeFileSync(out, `${JSON.stringify(json, null, 2)}\n`);
    console.log(`${out}: ${Object.keys(json.platforms).length} platform entries for ${json.version}`);
    return 0;
  }
  return fail("usage: updater-json.mjs files <version> | verify <file> <file.sig> [version] | write <tag> <dir> <notes.md> <latest.json>");
}

if (process.argv[1] && path.resolve(process.argv[1]) === url.fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
