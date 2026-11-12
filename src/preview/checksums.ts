// The Inspector's "# hash": SHA-256, MD5 and CRC-32 of one file, as one op
// in the tray (one row, one Cancel).
import { hashCrc32, hashMd5, hashSha256 } from "../api";
import { runOp } from "../ops";
import { basename } from "../paths";

export interface Checksums {
  path: string;
  sha256: string;
  md5: string;
  crc32: string;
}

type Hasher = (path: string) => Promise<[string, string, string]>;

const hashAll: Hasher = path =>
  runOp(`hashing ${basename(path)}`, track =>
    Promise.all([hashSha256(path, track()), hashMd5(path, track()), hashCrc32(path, track())]));

/** Hash `path`. Resolves null when `inspecting()` is another path by the
 *  time the digests are back: the user moved on, and showing them would
 *  put one file's hashes on another. Rejects as the hashes do (a Cancel
 *  rejects with "cancelled"). */
export async function checksumsFor(
  path: string,
  inspecting: () => string | undefined,
  hash: Hasher = hashAll,
): Promise<Checksums | null> {
  const [sha256, md5, crc32] = await hash(path);
  return inspecting() === path ? { path, sha256, md5, crc32 } : null;
}
