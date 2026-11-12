import { describe, expect, it } from "vitest";
import { checksumsFor } from "./checksums";

/** A hash that finishes when the test says so. */
function slowHash() {
  let finish: () => void = () => {};
  const hash = (_path: string) =>
    new Promise<[string, string, string]>(resolve => { finish = () => resolve(["sha", "md5", "crc"]); });
  return { hash, finish: () => finish() };
}

describe("checksumsFor", () => {
  it("keeps the digests while the file is still the inspected one", async () => {
    const { hash, finish } = slowHash();
    const got = checksumsFor("/w/big.iso", () => "/w/big.iso", hash);
    finish();
    expect(await got).toEqual({ path: "/w/big.iso", sha256: "sha", md5: "md5", crc32: "crc" });
  });

  it("drops them when the Inspector moved to another file meanwhile", async () => {
    const { hash, finish } = slowHash();
    let inspecting = "/w/big.iso";
    const got = checksumsFor("/w/big.iso", () => inspecting, hash);
    inspecting = "/w/notes.md";
    finish();
    expect(await got).toBeNull();
  });
});
