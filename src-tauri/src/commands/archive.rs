use std::path::{Path, PathBuf};
use super::launch::find_tool;
#[cfg(windows)]
use super::launch::CREATE_NO_WINDOW;

// ---------- compress (zip) ----------

/// Create a ZIP archive at `output` containing every path in `paths`. Files
/// are added at their basename; directories are walked recursively and their
/// children stored with paths rooted at the directory's basename so the
/// archive keeps a recognisable structure.
#[tauri::command(async)]
pub fn compress(paths: Vec<String>, output: String) -> Result<(), String> {
    use std::io::{BufWriter, Read, Write};

    if paths.is_empty() {
        return Err("compress: no input paths".to_string());
    }

    let out_file = std::fs::File::create(&output)
        .map_err(|e| format!("create {}: {}", output, e))?;
    let mut zipw = zip::ZipWriter::new(BufWriter::new(out_file));
    let options: zip::write::FileOptions<'_, ()> =
        zip::write::FileOptions::default().compression_method(zip::CompressionMethod::Deflated);

    for src in &paths {
        let src_path = Path::new(src);
        let meta = std::fs::symlink_metadata(src_path)
            .map_err(|e| format!("stat {}: {}", src_path.display(), e))?;
        if meta.is_dir() {
            // Archive-side root is the directory's own basename so extraction
            // produces a sibling folder rather than dumping its contents at
            // the archive root.
            let root_name = src_path
                .file_name()
                .map(|s| s.to_string_lossy().into_owned())
                .unwrap_or_else(|| "dir".to_string());
            add_dir_recursive(&mut zipw, src_path, &root_name, &options)?;
        } else {
            let name = src_path
                .file_name()
                .map(|s| s.to_string_lossy().into_owned())
                .ok_or_else(|| format!("bad filename: {}", src_path.display()))?;
            zipw.start_file(name, options)
                .map_err(|e| format!("start_file: {}", e))?;
            let mut f = std::fs::File::open(src_path)
                .map_err(|e| format!("open {}: {}", src_path.display(), e))?;
            let mut buf = [0u8; 64 * 1024];
            loop {
                let n = f.read(&mut buf).map_err(|e| e.to_string())?;
                if n == 0 {
                    break;
                }
                zipw.write_all(&buf[..n]).map_err(|e| e.to_string())?;
            }
        }
    }

    zipw.finish().map_err(|e| format!("finish zip: {}", e))?;
    Ok(())
}

fn add_dir_recursive<W: std::io::Write + std::io::Seek>(
    zipw: &mut zip::ZipWriter<W>,
    abs_dir: &Path,
    archive_prefix: &str,
    options: &zip::write::FileOptions<'_, ()>,
) -> Result<(), String> {
    use std::io::{Read, Write};

    // Write the directory entry itself so empty dirs survive round-trip.
    let dir_entry = format!("{}/", archive_prefix);
    zipw.add_directory(dir_entry, *options)
        .map_err(|e| format!("add_directory: {}", e))?;

    let rd = std::fs::read_dir(abs_dir)
        .map_err(|e| format!("read_dir {}: {}", abs_dir.display(), e))?;
    for entry in rd.flatten() {
        let child = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();
        let child_prefix = format!("{}/{}", archive_prefix, name);
        let meta = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };
        if meta.file_type().is_symlink() {
            // Skip symlinks — stored as files would duplicate content and
            // stored as links needs unix-only extra fields. Safer to skip.
            continue;
        }
        if meta.is_dir() {
            add_dir_recursive(zipw, &child, &child_prefix, options)?;
        } else {
            zipw.start_file(&child_prefix, *options)
                .map_err(|e| format!("start_file {}: {}", child_prefix, e))?;
            let mut f = std::fs::File::open(&child)
                .map_err(|e| format!("open {}: {}", child.display(), e))?;
            let mut buf = [0u8; 64 * 1024];
            loop {
                let n = f.read(&mut buf).map_err(|e| e.to_string())?;
                if n == 0 {
                    break;
                }
                zipw.write_all(&buf[..n]).map_err(|e| e.to_string())?;
            }
        }
    }
    Ok(())
}

// ---------- archive create / extract (tar.exe, 7z.exe) ----------

/// Best-effort Windows process-spawn helper. Runs `program` with `args`,
/// waits for exit, captures stderr, and returns an error containing stderr
/// text on non-zero exit. Uses CREATE_NO_WINDOW on Windows so no console
/// pops up when spawned from the GUI.
fn run_archive_tool(program: &str, args: &[&str]) -> Result<(), String> {
    use std::process::{Command, Stdio};

    let mut cmd = Command::new(program);
    cmd.args(args).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let output = cmd
        .output()
        .map_err(|e| format!("{} spawn failed: {}", program, e))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        let code = output.status.code().unwrap_or(-1);
        return Err(format!(
            "{} exited {}: {}{}",
            program,
            code,
            stderr.trim(),
            if stderr.trim().is_empty() && !stdout.trim().is_empty() {
                format!(" (stdout: {})", stdout.trim())
            } else {
                String::new()
            },
        ));
    }
    Ok(())
}

/// A tar child whose archive goes through a pipe while the zstd step runs
/// in-process. stderr is read on a thread from the start, so a chatty tar
/// can't fill that pipe and stall the stream.
struct PipedTar {
    child: std::process::Child,
    stderr: std::thread::JoinHandle<Vec<u8>>,
}

impl PipedTar {
    fn spawn(
        args: &[&str],
        stdin: std::process::Stdio,
        stdout: std::process::Stdio,
    ) -> Result<Self, String> {
        use std::io::Read;
        use std::process::{Command, Stdio};

        let mut cmd = Command::new("tar");
        cmd.args(args)
            .stdin(stdin)
            .stdout(stdout)
            .stderr(Stdio::piped());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }
        let mut child = cmd
            .spawn()
            .map_err(|e| format!("tar spawn failed: {}", e))?;
        let mut pipe = child.stderr.take().expect("stderr is piped");
        let stderr = std::thread::spawn(move || {
            let mut buf = Vec::new();
            let _ = pipe.read_to_end(&mut buf);
            buf
        });
        Ok(PipedTar { child, stderr })
    }

    /// Wait for tar and combine its result with the in-process side's
    /// (`streamed`). That side's error wins unless it's a broken pipe, which
    /// just means tar quit first and has the real reason on stderr.
    fn finish(mut self, archive: &str, streamed: std::io::Result<()>) -> Result<(), String> {
        let status = self.child.wait().map_err(|e| format!("tar wait: {}", e))?;
        let stderr = self.stderr.join().unwrap_or_default();
        match streamed {
            Err(e) if e.kind() != std::io::ErrorKind::BrokenPipe => {
                Err(format!("{}: {}", archive, e))
            }
            _ if !status.success() => Err(format!(
                "tar exited {}: {}",
                status.code().unwrap_or(-1),
                String::from_utf8_lossy(&stderr).trim()
            )),
            Err(e) => Err(format!("{}: {}", archive, e)),
            Ok(()) => Ok(()),
        }
    }
}

/// `.tar.zst` support that doesn't depend on tar's own zstd support: GNU
/// tar's `--zstd` runs a separate `zstd` binary that often isn't installed,
/// and not every bsdtar build has zstd compiled in. tar reads or writes a
/// plain tar stream on a pipe, and the `zstd` crate (already linked in
/// through `zip`) does the compression.
fn tar_zst_create(dest: &str, parent: &str, members: &[String]) -> Result<(), String> {
    use std::process::Stdio;
    let file = std::fs::File::create(dest).map_err(|e| format!("create {}: {}", dest, e))?;
    // `--`: a member named like an option (`--checkpoint-action=exec=…`)
    // must stay a file name.
    let mut args = vec!["-cf", "-", "-C", parent, "--"];
    args.extend(members.iter().map(String::as_str));
    let res = PipedTar::spawn(&args, Stdio::null(), Stdio::piped()).and_then(|mut tar| {
        let tar_out = tar.child.stdout.take().expect("stdout is piped");
        let streamed = zstd::stream::copy_encode(tar_out, file, 0);
        tar.finish(dest, streamed)
    });
    if res.is_err() {
        // Don't leave a truncated archive behind.
        let _ = std::fs::remove_file(dest);
    }
    res
}

/// See `tar_zst_create`.
fn tar_zst_extract(archive: &str, dest_dir: &str) -> Result<(), String> {
    use std::process::Stdio;
    let file = std::fs::File::open(archive).map_err(|e| format!("open {}: {}", archive, e))?;
    let mut tar = PipedTar::spawn(&["-xf", "-", "-C", dest_dir], Stdio::piped(), Stdio::null())?;
    let tar_in = tar.child.stdin.take().expect("stdin is piped");
    // copy_decode drops `tar_in` when it returns, which gives tar its EOF.
    let streamed = zstd::stream::copy_decode(file, tar_in);
    tar.finish(archive, streamed)
}

/// 7-Zip goes by several names: `7z` (p7zip, Windows), `7zz` (7-Zip's own
/// Linux build, Debian's `7zip` package) and `7za` (standalone p7zip).
pub(super) const SEVEN_ZIP_NAMES: &[&str] = &["7z", "7zz", "7za", "7z.exe"];

fn find_7z() -> Result<String, String> {
    find_tool(SEVEN_ZIP_NAMES)
        .map(|p| p.to_string_lossy().into_owned())
        .ok_or_else(|| format!("7-Zip not found on PATH (tried {})", SEVEN_ZIP_NAMES.join(", ")))
}

/// Return whether the local machine has the tooling required to handle the
/// given archive format. Values: "zip" | "tar.gz" | "tar.zst" | "7z".
#[tauri::command(async)]
pub fn archive_can_handle(format: String) -> bool {
    match format.as_str() {
        "zip" => true, // in-process zip crate
        "tar.gz" => which::which("tar").is_ok() || which::which("tar.exe").is_ok(),
        // tar alone suffices: the zstd step runs in-process (tar_zst_create),
        // so neither tar's --zstd nor a zstd binary is needed.
        "tar.zst" => which::which("tar").is_ok() || which::which("tar.exe").is_ok(),
        "7z" => find_7z().is_ok(),
        _ => false,
    }
}

/// Create an archive at `dest` containing `paths`. Format is one of
/// "zip" | "tar.gz" | "tar.zst" | "7z". Relative entries are archived using
/// each input's basename (`tar -C <parent> <basename>`) so the resulting
/// archive mirrors the structure produced by the existing zip path.
#[tauri::command(async)]
pub fn archive_create(
    paths: Vec<String>,
    dest: String,
    format: String,
) -> Result<(), String> {
    if paths.is_empty() {
        return Err("archive_create: no input paths".to_string());
    }

    if format == "zip" {
        // Reuse the in-process zip writer.
        return compress(paths, dest);
    }

    // For tar-based formats we invoke tar once per unique parent, passing
    // the basenames as members. This keeps archive entries relative rather
    // than embedding absolute Windows paths.
    let mut by_parent: std::collections::BTreeMap<PathBuf, Vec<String>> =
        std::collections::BTreeMap::new();
    for p in &paths {
        let pth = Path::new(p);
        let parent = pth
            .parent()
            .map(|x| x.to_path_buf())
            .unwrap_or_else(|| PathBuf::from("."));
        let name = pth
            .file_name()
            .map(|s| s.to_string_lossy().into_owned())
            .ok_or_else(|| format!("bad filename: {}", p))?;
        by_parent.entry(parent).or_default().push(name);
    }
    if by_parent.len() != 1 {
        return Err(
            "archive_create: tar-based formats require all inputs to share a parent directory"
                .to_string(),
        );
    }
    let (parent, members) = by_parent.into_iter().next().unwrap();
    let parent_str = parent.to_string_lossy().into_owned();

    match format.as_str() {
        "tar.gz" => {
            // `--` keeps a member named like an option a file name.
            let mut args: Vec<&str> = vec!["-czf", &dest, "-C", &parent_str, "--"];
            for m in &members {
                args.push(m);
            }
            run_archive_tool("tar", &args)
        }
        "tar.zst" => tar_zst_create(&dest, &parent_str, &members),
        "7z" => {
            let program = find_7z()?;
            // 7z a <dest> <members...>; cd into parent first by using -w
            // (working dir) is not supported, so pass absolute paths instead.
            // `--` ends 7z's switch and @listfile parsing.
            let mut args: Vec<&str> = vec!["a", "-y", "--", &dest];
            let abs_members: Vec<String> = members
                .iter()
                .map(|m| {
                    let mut p = parent.clone();
                    p.push(m);
                    p.to_string_lossy().into_owned()
                })
                .collect();
            for m in &abs_members {
                args.push(m);
            }
            run_archive_tool(&program, &args)
        }
        other => Err(format!("archive_create: unsupported format '{}'", other)),
    }
}

/// Extract `archive` into `dest_dir`, which must already exist or will be
/// created. Dispatches on extension:
///   .zip → in-process zip crate (GNU tar on Linux can't read zip)
///   .tar/.tar.gz/.tgz/.tar.bz2 → `tar -xf ...`
///   .tar.zst/.tzst → in-process zstd piped into `tar -xf -`
///   .7z → `7z.exe x archive -o<dest_dir> -y`
#[tauri::command(async)]
pub fn archive_extract(archive: String, dest_dir: String) -> Result<(), String> {
    // Ensure destination exists.
    if let Err(e) = std::fs::create_dir_all(&dest_dir) {
        return Err(format!("create_dir_all {}: {}", dest_dir, e));
    }

    let lower = archive.to_ascii_lowercase();

    if lower.ends_with(".zip") {
        let f = std::fs::File::open(&archive)
            .map_err(|e| format!("open {}: {}", archive, e))?;
        let mut za = zip::ZipArchive::new(std::io::BufReader::new(f))
            .map_err(|e| format!("read zip {}: {}", archive, e))?;
        // ZipArchive::extract sanitises entry names (rejects traversal).
        return za
            .extract(&dest_dir)
            .map_err(|e| format!("extract {}: {}", archive, e));
    }

    let is_7z = lower.ends_with(".7z");
    let is_tar_zst = lower.ends_with(".tar.zst") || lower.ends_with(".tzst");
    let is_tar_family = lower.ends_with(".tar")
        || lower.ends_with(".tar.gz")
        || lower.ends_with(".tgz")
        || lower.ends_with(".tar.bz2")
        || lower.ends_with(".tbz2")
        || lower.ends_with(".tar.xz")
        || lower.ends_with(".txz")
        || is_tar_zst;

    if is_7z {
        let program = find_7z()?;
        let out_flag = format!("-o{}", dest_dir);
        let args = ["x", &out_flag, "-y", "--", &archive];
        return run_archive_tool(&program, &args);
    }

    if is_tar_family {
        if which::which("tar").is_err() && which::which("tar.exe").is_err() {
            return Err("tar.exe not found on PATH".to_string());
        }
        if is_tar_zst {
            return tar_zst_extract(&archive, &dest_dir);
        }
        let args = ["-xf", archive.as_str(), "-C", dest_dir.as_str()];
        return run_archive_tool("tar", &args);
    }

    Err(format!(
        "archive_extract: unsupported archive extension for '{}'",
        archive
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::testing::{temp_dir, s};

    #[test]
    fn zip_compress_extract_round_trip() {
        let dir = temp_dir("ziprt");
        let src = dir.join("payload");
        std::fs::create_dir_all(src.join("nested/empty")).unwrap();
        std::fs::write(src.join("top.txt"), "top").unwrap();
        std::fs::write(src.join("nested/inner.txt"), "inner").unwrap();

        let zip_path = dir.join("payload.zip");
        compress(
            vec![src.to_string_lossy().into_owned()],
            zip_path.to_string_lossy().into_owned(),
        )
        .unwrap();

        let out = dir.join("out");
        archive_extract(
            zip_path.to_string_lossy().into_owned(),
            out.to_string_lossy().into_owned(),
        )
        .unwrap();

        let root = out.join("payload");
        assert_eq!(std::fs::read_to_string(root.join("top.txt")).unwrap(), "top");
        assert_eq!(
            std::fs::read_to_string(root.join("nested/inner.txt")).unwrap(),
            "inner"
        );
        // empty directory entries survive the round-trip
        assert!(root.join("nested/empty").is_dir());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn tar_zst_round_trip_and_failures() {
        if which::which("tar").is_err() {
            return; // nothing to test without tar
        }
        let dir = temp_dir("tarzst");
        let src = dir.join("payload");
        std::fs::create_dir_all(src.join("nested")).unwrap();
        std::fs::write(src.join("top.txt"), "top").unwrap();
        let big = "inner ".repeat(50_000);
        std::fs::write(src.join("nested/inner.txt"), &big).unwrap();

        let archive = dir.join("payload.tar.zst");
        archive_create(vec![s(&src)], s(&archive), "tar.zst".into()).unwrap();
        let bytes = std::fs::read(&archive).unwrap();
        assert_eq!(&bytes[..4], &[0x28, 0xB5, 0x2F, 0xFD], "zstd frame magic");
        assert!(
            bytes.len() < big.len() / 10,
            "compressed: {} bytes",
            bytes.len()
        );

        let out = dir.join("out");
        archive_extract(s(&archive), s(&out)).unwrap();
        assert_eq!(
            std::fs::read_to_string(out.join("payload/top.txt")).unwrap(),
            "top"
        );
        assert_eq!(
            std::fs::read_to_string(out.join("payload/nested/inner.txt")).unwrap(),
            big
        );

        // Corrupt data reports the zstd error (and doesn't hang tar).
        let bad = dir.join("bad.tar.zst");
        std::fs::write(&bad, b"not zstd at all").unwrap();
        let err = archive_extract(s(&bad), s(&dir.join("out2"))).unwrap_err();
        assert!(err.contains("bad.tar.zst"), "{}", err);

        // A failed create reports tar's error and leaves no partial archive.
        let failed = dir.join("missing.tar.zst");
        let err = archive_create(vec![s(&dir.join("missing"))], s(&failed), "tar.zst".into())
            .unwrap_err();
        assert!(err.starts_with("tar exited"), "{}", err);
        assert!(!failed.exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn tar_members_named_like_options_stay_files() {
        if which::which("tar").is_err() {
            return;
        }
        let dir = temp_dir("tardash");
        let src = dir.join("src");
        std::fs::create_dir_all(&src).unwrap();
        // Without `--`, tar reads these as options: the first would run a
        // command at every checkpoint.
        let names = ["--checkpoint-action=exec=echo pwned", "-v"];
        for n in names {
            std::fs::write(src.join(n), n).unwrap();
        }
        let paths: Vec<String> = names.iter().map(|n| s(&src.join(n))).collect();
        for format in ["tar.gz", "tar.zst"] {
            let archive = dir.join(format!("a.{}", format));
            archive_create(paths.clone(), s(&archive), format.into()).unwrap();
            let out = dir.join(format!("out-{}", format));
            archive_extract(s(&archive), s(&out)).unwrap();
            for n in names {
                assert_eq!(std::fs::read_to_string(out.join(n)).unwrap(), n, "{} {}", format, n);
            }
        }
        let _ = std::fs::remove_dir_all(&dir);
    }
}

#[cfg(test)]
#[path = "archive_tests.rs"]
mod archive_tests;
