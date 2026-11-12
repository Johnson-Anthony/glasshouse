use tauri::{AppHandle, State};

use crate::ops::{Op, OpRegistry};

// ---------- sha256 hash ----------

/// Stream the file at `path` through `update` in 64 KB chunks, reporting
/// progress to `op` and stopping if it's cancelled. Shared by the hash_*
/// commands.
fn read_chunks(path: &str, op: &Op, mut update: impl FnMut(&[u8])) -> Result<(), String> {
    use std::io::Read;

    let mut f = super::fs_ops::open_regular(std::path::Path::new(path))
        .map_err(|e| format!("open {}: {}", path, e))?;
    if let Ok(meta) = f.metadata() {
        op.set_total(meta.len());
    }
    let mut buf = [0u8; 64 * 1024];
    loop {
        op.check()?;
        let n = f.read(&mut buf).map_err(|e| e.to_string())?;
        if n == 0 {
            return Ok(());
        }
        update(&buf[..n]);
        op.advance(n as u64);
    }
}

/// Lowercase hex digest of the file at `path` with hasher `D`.
fn digest_file<D: sha2::Digest>(path: &str, op: &Op) -> Result<String, String> {
    use std::fmt::Write;

    let mut hasher = D::new();
    read_chunks(path, op, |chunk| hasher.update(chunk))?;
    let digest = hasher.finalize();
    let mut hex = String::with_capacity(digest.len() * 2);
    for byte in digest {
        let _ = write!(&mut hex, "{:02x}", byte);
    }
    Ok(hex)
}

fn crc32_file(path: &str, op: &Op) -> Result<String, String> {
    let mut hasher = crc32fast::Hasher::new();
    read_chunks(path, op, |chunk| hasher.update(chunk))?;
    Ok(format!("{:08x}", hasher.finalize()))
}

/// Lowercase hex SHA-256 digest of the file at `path`. With `op_id`, it
/// reports progress and can be cancelled (see ops.rs).
#[tauri::command(async)]
pub fn hash_sha256(
    app: AppHandle,
    ops: State<'_, OpRegistry>,
    path: String,
    op_id: Option<String>,
) -> Result<String, String> {
    digest_file::<sha2::Sha256>(&path, &ops.start(op_id, &app))
}

// ---------- additional checksums ----------

#[tauri::command(async)]
pub fn hash_md5(
    app: AppHandle,
    ops: State<'_, OpRegistry>,
    path: String,
    op_id: Option<String>,
) -> Result<String, String> {
    digest_file::<md5::Md5>(&path, &ops.start(op_id, &app))
}

#[tauri::command(async)]
pub fn hash_crc32(
    app: AppHandle,
    ops: State<'_, OpRegistry>,
    path: String,
    op_id: Option<String>,
) -> Result<String, String> {
    crc32_file(&path, &ops.start(op_id, &app))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::testing::{temp_dir, s};
    use crate::ops::testing::{cancels_at_first_event, events, recorded};
    use crate::ops::CANCELLED;

    fn hash_sha256(path: String) -> Result<String, String> {
        digest_file::<sha2::Sha256>(&path, &Op::untracked())
    }
    fn hash_md5(path: String) -> Result<String, String> {
        digest_file::<md5::Md5>(&path, &Op::untracked())
    }
    fn hash_crc32(path: String) -> Result<String, String> {
        crc32_file(&path, &Op::untracked())
    }

    #[test]
    fn hashes_match_known_digests_across_chunks() {
        use sha2::Digest;
        let dir = temp_dir("hashes");
        let abc = dir.join("abc.txt");
        std::fs::write(&abc, "abc").unwrap();
        assert_eq!(
            hash_sha256(s(&abc)).unwrap(),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        assert_eq!(hash_md5(s(&abc)).unwrap(), "900150983cd24fb0d6963f7d28e17f72");
        assert_eq!(hash_crc32(s(&abc)).unwrap(), "352441c2");

        let empty = dir.join("empty");
        std::fs::write(&empty, "").unwrap();
        assert_eq!(hash_md5(s(&empty)).unwrap(), "d41d8cd98f00b204e9800998ecf8427e");
        assert_eq!(hash_crc32(s(&empty)).unwrap(), "00000000");

        // Three and a bit 64 KB chunks, against one-shot digests of the bytes.
        let data: Vec<u8> = (0..200_000u32).map(|i| (i % 251) as u8).collect();
        let big = dir.join("big.bin");
        std::fs::write(&big, &data).unwrap();
        let sha: String = sha2::Sha256::digest(&data).iter().map(|b| format!("{:02x}", b)).collect();
        let md5: String = md5::Md5::digest(&data).iter().map(|b| format!("{:02x}", b)).collect();
        assert_eq!(hash_sha256(s(&big)).unwrap(), sha);
        assert_eq!(hash_md5(s(&big)).unwrap(), md5);
        assert_eq!(hash_crc32(s(&big)).unwrap(), format!("{:08x}", crc32fast::hash(&data)));

        let err = hash_sha256(s(&dir.join("missing"))).unwrap_err();
        assert!(err.starts_with("open "), "{}", err);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn hashing_refuses_a_fifo_without_blocking() {
        use crate::commands::testing::{mkfifo, without_blocking};
        let dir = temp_dir("hash-fifo");
        let fifo = dir.join("pipe");
        mkfifo(&fifo);
        let p = s(&fifo);
        let err = without_blocking(move || hash_sha256(p)).unwrap_err();
        assert_eq!(err, format!("open {}: a named pipe, not a regular file", fifo.display()));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn hashing_reports_progress_up_to_the_size_and_can_be_cancelled() {
        let dir = temp_dir("hash-progress");
        let big = dir.join("big.bin");
        std::fs::write(&big, vec![7u8; 200_000]).unwrap();

        let (_reg, op, seen) = recorded("h1");
        digest_file::<sha2::Sha256>(&s(&big), &op).unwrap();
        let seen = events(&seen);
        // set_total, then one event per 64 KB chunk.
        assert_eq!(seen.len(), 5, "{:?}", seen);
        assert!(seen.iter().all(|p| p.op_id == "h1" && p.total == Some(200_000)));
        assert!(seen.windows(2).all(|w| w[0].done <= w[1].done));
        assert_eq!(seen.last().unwrap().done, 200_000);

        // Cancelled at its first event (the size): no chunk gets read.
        let (_reg, op, seen) = cancels_at_first_event("h2");
        assert_eq!(crc32_file(&s(&big), &op), Err(CANCELLED.to_string()));
        assert_eq!(events(&seen).len(), 1);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
