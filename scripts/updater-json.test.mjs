import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  build, decodePublicKey, downloadBase, manifest, packages, signedVersion, updaterConfig, verify,
} from "./updater-json.mjs";

// Made with `tauri signer sign --app-version 0.2.1` (CLI 2.12.4) and a
// throwaway key whose private half was never kept: the public key and the
// signature of PROBE, to check this verifier against the real signer.
const CLI_PUB = "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDQ2MTgxRjI4NDk4QkY2NDcKUldSSDlvdEpLQjhZUnFBZlU1ZVBCR281V0RCZE1KS21NSEJVVENDVmNaa1BQT2phQmhEQ1ByaGMK";
const CLI_SIG = "dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIHRhdXJpIHNlY3JldCBrZXkKUlVSSDlvdEpLQjhZUmo1SDhlR0V4VzRkMlZha1NOcjVVM3ZMbDNJMmVUY0pRaWFHd2NBb3FDS3BSVVRLVVZaVjFFei8wcGRlWDQ4TTNYdmRLZDF1NnNFM2FNRGoxN2l3ekFJPQp0cnVzdGVkIGNvbW1lbnQ6IHRpbWVzdGFtcDoxNzk1MjAxMTUxCWZpbGU6cHJvYmUudHh0CXZlcnNpb246MC4yLjEKY2JMekFhMEExQUUxTExUSlNNK3NZb2Q0UExIMDBnZ202SFNzdGllTnpkZFNaYnE5eW9ZeENSOHp1VlQxTENQblBWamhDbi9nallMdXBVdncwSnBCRHc9PQo=";
const PROBE = Buffer.from("glasshouse updater test\n");

/** A key pair in Tauri's form (base64 of minisign's files), for signing in
 *  the tests the way `tauri signer sign` does: prehashed with BLAKE2b. */
function keyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const keyId = crypto.randomBytes(8);
  const raw = Buffer.from(publicKey.export({ format: "jwk" }).x, "base64url");
  const line = Buffer.concat([Buffer.from("Ed"), keyId, raw]).toString("base64");
  const pubkey = Buffer.from(`untrusted comment: minisign public key: X\n${line}\n`).toString("base64");
  const sign = (data, trusted) => {
    const sig = crypto.sign(null, crypto.createHash("blake2b512").update(data).digest(), privateKey);
    const global = crypto.sign(null, Buffer.concat([sig, Buffer.from(trusted)]), privateKey);
    const text = [
      "untrusted comment: signature from tauri secret key",
      Buffer.concat([Buffer.from("ED"), keyId, sig]).toString("base64"),
      `trusted comment: ${trusted}`,
      global.toString("base64"),
      "",
    ].join("\n");
    return Buffer.from(text).toString("base64");
  };
  return { pubkey, sign };
}

const ENDPOINT = "https://github.com/Johnson-Anthony/glasshouse/releases/latest/download/latest.json";

const dirs = [];
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

/** A folder with every package of `version`, each signed by `sign`. */
function release(version, sign, { skip = [], signedAs = version } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "updater-json-"));
  dirs.push(dir);
  for (const p of packages(version)) {
    const body = Buffer.from(`package ${p.name}`);
    fs.writeFileSync(path.join(dir, p.name), body);
    if (!skip.includes(p.name)) {
      fs.writeFileSync(path.join(dir, `${p.name}.sig`), sign(body, `timestamp:1\tfile:${p.name}\tversion:${signedAs}`));
    }
  }
  return dir;
}

describe("verify", () => {
  it("accepts a signature from the Tauri CLI and reads its version", () => {
    expect(verify(PROBE, CLI_SIG, CLI_PUB)).toEqual({
      trusted: "timestamp:1795201151\tfile:probe.txt\tversion:0.2.1",
      version: "0.2.1",
    });
  });

  it("rejects a changed file, another key, and a changed trusted comment", () => {
    expect(() => verify(Buffer.from("glasshouse updater test!\n"), CLI_SIG, CLI_PUB)).toThrow("doesn't match the file");
    expect(() => verify(PROBE, CLI_SIG, keyPair().pubkey)).toThrow(/signed with key 46181F28498BF647, but/);
    const text = Buffer.from(CLI_SIG, "base64").toString().replace("version:0.2.1", "version:9.9.9");
    expect(() => verify(PROBE, Buffer.from(text).toString("base64"), CLI_PUB)).toThrow("trusted comment was changed");
    expect(() => verify(PROBE, "bm90IGEgc2lnbmF0dXJl", CLI_PUB)).toThrow("not a minisign signature");
  });

  it("checks against the key in tauri.conf.json", () => {
    const { pubkey, endpoint } = updaterConfig();
    expect(decodePublicKey(pubkey).keyId).toHaveLength(8);
    expect(endpoint).toBe(ENDPOINT);
    expect(() => verify(PROBE, CLI_SIG, pubkey)).toThrow("tauri.conf.json's public key is 20119D523AED79E2");
  });

  it("reads the version field of a trusted comment", () => {
    expect(signedVersion("timestamp:1\tfile:a\tversion:0.3.0")).toBe("0.3.0");
    expect(signedVersion("timestamp:1\tfile:a")).toBeNull();
  });
});

describe("latest.json", () => {
  it("points each install type at its own package, and os-arch at the setup and the AppImage", () => {
    const base = downloadBase(ENDPOINT, "v0.3.0");
    expect(base).toBe("https://github.com/Johnson-Anthony/glasshouse/releases/download/v0.3.0");
    const sigs = Object.fromEntries(packages("0.3.0").map(p => [p.name, `sig of ${p.name}\n`]));
    const json = manifest({ version: "0.3.0", notes: "n", pubDate: "2026-12-01T00:00:00.000Z", base, sigs });
    expect(Object.keys(json.platforms).sort()).toEqual([
      "linux-aarch64", "linux-aarch64-appimage", "linux-aarch64-deb",
      "linux-x86_64", "linux-x86_64-appimage", "linux-x86_64-deb",
      "windows-aarch64", "windows-aarch64-msi", "windows-aarch64-nsis",
      "windows-x86_64", "windows-x86_64-msi", "windows-x86_64-nsis",
    ]);
    expect(json.platforms["windows-x86_64-msi"].url).toBe(`${base}/glasshouse_0.3.0_x64_en-US.msi`);
    expect(json.platforms["windows-x86_64"].url).toBe(`${base}/glasshouse_0.3.0_x64-setup.exe`);
    expect(json.platforms["linux-x86_64"].url).toBe(`${base}/glasshouse_0.3.0_amd64.AppImage`);
    expect(json.platforms["linux-aarch64-deb"]).toEqual({ signature: "sig of glasshouse_0.3.0_arm64.deb", url: `${base}/glasshouse_0.3.0_arm64.deb` });
    expect(json).toMatchObject({ version: "0.3.0", notes: "n", pub_date: "2026-12-01T00:00:00.000Z" });
  });

  it("is written only when every package is there and signed for the version", () => {
    const k = keyPair();
    const config = { pubkey: k.pubkey, endpoint: ENDPOINT };
    const ok = build({ tag: "v0.3.0", dir: release("0.3.0", k.sign), notes: "notes", config });
    expect(ok.problems).toEqual([]);
    expect(Object.keys(ok.json.platforms)).toHaveLength(12);
    for (const p of packages("0.3.0")) {
      expect(verify(Buffer.from(`package ${p.name}`), ok.json.platforms[p.keys[0]].signature, k.pubkey).version).toBe("0.3.0");
    }

    const unsigned = build({ tag: "v0.3.0", dir: release("0.3.0", k.sign, { skip: ["glasshouse_0.3.0_amd64.deb"] }), notes: "", config });
    expect(unsigned.problems).toEqual(["glasshouse_0.3.0_amd64.deb.sig is missing: was the build signed?"]);
    expect(unsigned.json).toBeUndefined();

    const old = build({ tag: "v0.3.0", dir: release("0.3.0", k.sign, { signedAs: "0.2.0" }), notes: "", config });
    expect(old.problems).toHaveLength(8);
    expect(old.problems[0]).toBe("glasshouse_0.3.0_x64-setup.exe is signed for version 0.2.0, not 0.3.0");

    const other = build({ tag: "v0.3.0", dir: release("0.3.0", keyPair().sign), notes: "", config });
    expect(other.problems[0]).toMatch(/^glasshouse_0.3.0_x64-setup.exe: signed with key [0-9A-F]{16}, but/);

    expect(build({ tag: "0.3", dir: "/nonexistent", notes: "", config }).problems).toEqual(["0.3 isn't a v<major>.<minor>.<patch> tag"]);
    expect(build({ tag: "v0.3.0", dir: release("0.3.0", k.sign), notes: "", config: { pubkey: k.pubkey, endpoint: "http://x.test/latest.json" } }).problems)
      .toEqual(["the updater endpoint isn't a GitHub latest-release latest.json: http://x.test/latest.json"]);
  });

  it("lists the same packages as the release workflow publishes", () => {
    const yml = fs.readFileSync(new URL("../.github/workflows/release.yml", import.meta.url), "utf8");
    expect(yml).toContain("node scripts/updater-json.mjs files");
    expect(packages("1.2.3").map(p => p.name)).toEqual([
      "glasshouse_1.2.3_x64-setup.exe", "glasshouse_1.2.3_x64_en-US.msi",
      "glasshouse_1.2.3_arm64-setup.exe", "glasshouse_1.2.3_arm64_en-US.msi",
      "glasshouse_1.2.3_amd64.AppImage", "glasshouse_1.2.3_amd64.deb",
      "glasshouse_1.2.3_aarch64.AppImage", "glasshouse_1.2.3_arm64.deb",
    ]);
  });
});
