use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;
use super::fs_ops::no_clobber_err;
use super::launch::{find_tool, require_tool};
#[cfg(windows)]
use super::launch::CREATE_NO_WINDOW;
use crate::lock;

/// An input or archive entry that was left out, and why. Shown to the user.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct Skipped {
    pub path: String,
    pub reason: String,
}

/// What `archive_create` left out of the archive.
#[derive(Debug, Default, serde::Serialize)]
pub struct CreateReport {
    pub skipped: Vec<Skipped>,
}

impl CreateReport {
    fn skip(&mut self, path: &Path, reason: impl Into<String>) {
        self.skipped.push(Skipped { path: path.to_string_lossy().into_owned(), reason: reason.into() });
    }
}

// ---------- compress (zip) ----------

/// Create a ZIP archive at `output` containing every path in `paths`. See
/// `zip_create`; this older command drops its report.
#[tauri::command(async)]
pub fn compress(paths: Vec<String>, output: String) -> Result<(), String> {
    zip_create(&paths, &output).map(drop)
}

/// Write a new zip at `output`. Files are added at their basename; folders
/// are walked and their children stored under the folder's basename, so the
/// archive keeps a recognisable structure. Symlinks and entries that can't
/// be read are left out and listed in the report. On any error the output
/// is removed: the writer's Drop would otherwise finish it into a valid-
/// looking zip that's missing entries.
fn zip_create(paths: &[String], output: &str) -> Result<CreateReport, String> {
    use std::io::{BufWriter, Write};

    if paths.is_empty() {
        return Err("compress: no input paths".to_string());
    }

    let out_file = create_new_file(output)?;
    let mut zipw = zip::ZipWriter::new(BufWriter::new(out_file));
    let mut report = CreateReport::default();
    let added = paths
        .iter()
        .try_for_each(|src| add_input(&mut zipw, Path::new(src), &mut report));
    let res = match added {
        // Flush here: dropping the BufWriter would ignore a write error.
        Ok(()) => zipw
            .finish()
            .map_err(|e| format!("finish zip: {}", e))
            .and_then(|mut w| w.flush().map_err(|e| format!("write {}: {}", output, e))),
        Err(e) => {
            drop(zipw);
            Err(e)
        }
    };
    if res.is_err() {
        let _ = std::fs::remove_file(output);
    }
    res.map(|()| report)
}

/// Options for a file entry of `len` bytes. An entry of 4 GiB or more needs
/// the zip64 fields, or the writer fails partway through it.
fn file_options(len: u64) -> zip::write::SimpleFileOptions {
    zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated)
        .large_file(len >= u64::from(u32::MAX))
}

/// Add one selected path at the archive root.
fn add_input<W: std::io::Write + std::io::Seek>(
    zipw: &mut zip::ZipWriter<W>,
    src: &Path,
    report: &mut CreateReport,
) -> Result<(), String> {
    let meta = std::fs::symlink_metadata(src)
        .map_err(|e| format!("stat {}: {}", src.display(), e))?;
    let name = src.file_name().map(|s| s.to_string_lossy().into_owned());
    if meta.file_type().is_symlink() {
        // Left out like the links inside a folder, rather than followed.
        report.skip(src, "symbolic link");
    } else if meta.is_dir() {
        // Archive-side root is the directory's own basename so extraction
        // produces a sibling folder rather than dumping its contents at
        // the archive root.
        let root_name = name.unwrap_or_else(|| "dir".to_string());
        add_dir_recursive(zipw, src, &root_name, report)?;
    } else {
        let name = name.ok_or_else(|| format!("bad filename: {}", src.display()))?;
        zipw.start_file(name, file_options(meta.len()))
            .map_err(|e| format!("start_file: {}", e))?;
        copy_file_into(zipw, src)?;
    }
    Ok(())
}

/// Open a new archive file. Like every other write, archive creation never
/// replaces an existing file; the error is `no_clobber_err`'s.
fn create_new_file(dest: &str) -> Result<std::fs::File, String> {
    std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(dest)
        .map_err(|e| match e.kind() {
            std::io::ErrorKind::AlreadyExists => no_clobber_err(dest, e),
            _ => format!("create {}: {}", dest, e),
        })
}

/// For 7-Zip, which opens `dest` itself: `7z a` would add to an existing
/// archive. This leaves a small race.
fn refuse_existing(dest: &str) -> Result<(), String> {
    match std::fs::symlink_metadata(dest) {
        Ok(_) => Err(no_clobber_err(dest, std::io::ErrorKind::AlreadyExists.into())),
        Err(_) => Ok(()),
    }
}

fn add_dir_recursive<W: std::io::Write + std::io::Seek>(
    zipw: &mut zip::ZipWriter<W>,
    abs_dir: &Path,
    archive_prefix: &str,
    report: &mut CreateReport,
) -> Result<(), String> {
    // Write the directory entry itself so empty dirs survive round-trip.
    let dir_entry = format!("{}/", archive_prefix);
    zipw.add_directory(dir_entry, file_options(0))
        .map_err(|e| format!("add_directory: {}", e))?;

    let rd = std::fs::read_dir(abs_dir)
        .map_err(|e| format!("read_dir {}: {}", abs_dir.display(), e))?;
    for entry in rd {
        let entry = match entry {
            Ok(entry) => entry,
            Err(e) => {
                report.skip(abs_dir, format!("an entry couldn't be listed: {}", e));
                continue;
            }
        };
        let child = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();
        let child_prefix = format!("{}/{}", archive_prefix, name);
        let meta = match entry.metadata() {
            Ok(m) => m,
            Err(e) => {
                report.skip(&child, format!("its details couldn't be read: {}", e));
                continue;
            }
        };
        if meta.file_type().is_symlink() {
            // Stored as files would duplicate content, and stored as links
            // needs unix-only extra fields, so links are left out.
            report.skip(&child, "symbolic link");
            continue;
        }
        if meta.is_dir() {
            add_dir_recursive(zipw, &child, &child_prefix, report)?;
        } else {
            zipw.start_file(&child_prefix, file_options(meta.len()))
                .map_err(|e| format!("start_file {}: {}", child_prefix, e))?;
            copy_file_into(zipw, &child)?;
        }
    }
    Ok(())
}

/// Copy the file at `src` into the zip entry just started. A plain read
/// loop: `io::copy` would also retry interrupted reads.
fn copy_file_into(zipw: &mut impl std::io::Write, src: &Path) -> Result<(), String> {
    use std::io::Read;
    let mut f = std::fs::File::open(src).map_err(|e| format!("open {}: {}", src.display(), e))?;
    let mut buf = [0u8; 64 * 1024];
    loop {
        let n = f.read(&mut buf).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        zipw.write_all(&buf[..n]).map_err(|e| e.to_string())?;
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
    let file = create_new_file(dest)?;
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

/// tar writes the gzip stream to stdout, into a file opened with
/// `create_new`, so an existing file is refused with no check-then-create
/// race, and a failed run removes only what it wrote.
fn tar_gz_create(dest: &str, parent: &str, members: &[String]) -> Result<(), String> {
    use std::process::Stdio;
    let file = create_new_file(dest)?;
    // `--` keeps a member named like an option a file name.
    let mut args = vec!["-czf", "-", "-C", parent, "--"];
    args.extend(members.iter().map(String::as_str));
    let res = PipedTar::spawn(&args, Stdio::null(), Stdio::from(file))
        .and_then(|tar| tar.finish(dest, Ok(())));
    if res.is_err() {
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

const TAR_NAMES: &[&str] = &["tar", "tar.exe"];

fn find_7z() -> Result<String, String> {
    require_tool("7-Zip", SEVEN_ZIP_NAMES).map(|p| p.to_string_lossy().into_owned())
}

/// Return whether the local machine has the tooling required to handle the
/// given archive format. Values: "zip" | "tar.gz" | "tar.zst" | "7z".
#[tauri::command(async)]
pub fn archive_can_handle(format: String) -> bool {
    match format.as_str() {
        "zip" => true, // in-process zip crate
        // For tar.zst too tar alone suffices: the zstd step runs in-process
        // (tar_zst_create), so neither tar's --zstd nor a zstd binary is needed.
        "tar.gz" | "tar.zst" => find_tool(TAR_NAMES).is_some(),
        "7z" => find_7z().is_ok(),
        _ => false,
    }
}

/// Create an archive at `dest` containing `paths`. Format is one of
/// "zip" | "tar.gz" | "tar.zst" | "7z". Relative entries are archived using
/// each input's basename (`tar -C <parent> <basename>`) so the resulting
/// archive mirrors the structure produced by the existing zip path. A failed
/// create leaves no partial archive. Only zip leaves anything out (links,
/// unreadable entries); the report lists it.
#[tauri::command(async)]
pub fn archive_create(
    paths: Vec<String>,
    dest: String,
    format: String,
) -> Result<CreateReport, String> {
    if paths.is_empty() {
        return Err("archive_create: no input paths".to_string());
    }

    if format == "zip" {
        // Reuse the in-process zip writer.
        return zip_create(&paths, &dest);
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

    let res = match format.as_str() {
        "tar.gz" => tar_gz_create(&dest, &parent_str, &members),
        "tar.zst" => tar_zst_create(&dest, &parent_str, &members),
        "7z" => {
            refuse_existing(&dest)?;
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
            let res = run_archive_tool(&program, &args);
            if res.is_err() {
                // 7z opens `dest` itself, so this could only remove a file
                // that appeared after refuse_existing's check.
                let _ = std::fs::remove_file(&dest);
            }
            res
        }
        other => Err(format!("archive_create: unsupported format '{}'", other)),
    };
    res.map(|()| CreateReport::default())
}

/// An extraction waiting in its staging folder for the frontend to move its
/// top-level entries into place (`runTransfer`, with the paste conflict
/// question), after which it calls `archive_discard_staging`.
#[derive(Debug, serde::Serialize)]
pub struct Staged {
    pub staging: String,
    /// Archive entries that weren't extracted (unsafe or unsupported links).
    pub skipped: Vec<Skipped>,
}

/// Staging folders this process made, so `archive_discard_staging` only
/// ever deletes one of those.
static STAGED: Mutex<Vec<PathBuf>> = Mutex::new(Vec::new());

/// Extract `archive` into a new staging folder inside `dest_dir` (created
/// if missing) and return it. Nothing outside the staging folder is
/// written, so existing files are never replaced: the frontend moves the
/// entries in with the no-clobber moves. A failed extraction removes the
/// staging folder, and `dest_dir` too if this call created it.
#[tauri::command(async)]
pub fn archive_extract(archive: String, dest_dir: String) -> Result<Staged, String> {
    let dest = Path::new(&dest_dir);
    let created = std::fs::symlink_metadata(dest).is_err();
    std::fs::create_dir_all(dest).map_err(|e| format!("create_dir_all {}: {}", dest_dir, e))?;
    let res = make_staging(dest).and_then(|staging| {
        match extract_into(&archive, &staging) {
            Ok(skipped) => Ok((staging, skipped)),
            Err(e) => {
                let _ = std::fs::remove_dir_all(&staging);
                Err(e)
            }
        }
    });
    let (staging, skipped) = match res {
        Ok(done) => done,
        Err(e) => {
            if created {
                let _ = std::fs::remove_dir(dest); // only if still empty
            }
            return Err(e);
        }
    };
    #[cfg(windows)]
    copy_mark_of_the_web(Path::new(&archive), &staging);
    lock(&STAGED).push(staging.clone());
    Ok(Staged { staging: staging.to_string_lossy().into_owned(), skipped })
}

/// Delete a staging folder `archive_extract` returned, with whatever is
/// still in it (entries the user skipped, or that failed to move).
#[tauri::command(async)]
pub fn archive_discard_staging(staging: String) -> Result<(), String> {
    let path = PathBuf::from(&staging);
    {
        let mut staged = lock(&STAGED);
        let Some(i) = staged.iter().position(|p| *p == path) else {
            return Err(format!("{} isn't an extraction staging folder", staging));
        };
        staged.swap_remove(i);
    }
    std::fs::remove_dir_all(&path).map_err(|e| format!("remove {}: {}", staging, e))
}

/// A new, empty folder in `dest` to extract into: on the same volume, so
/// moving entries out is a rename, and hidden on unix by its leading dot.
fn make_staging(dest: &Path) -> Result<PathBuf, String> {
    use std::sync::atomic::{AtomicU32, Ordering};
    static NEXT: AtomicU32 = AtomicU32::new(0);
    for _ in 0..1000 {
        let n = NEXT.fetch_add(1, Ordering::Relaxed);
        let p = dest.join(format!(".glasshouse-extract-{}-{}", std::process::id(), n));
        match std::fs::create_dir(&p) {
            Ok(()) => return Ok(p),
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(format!("create {}: {}", p.display(), e)),
        }
    }
    Err(format!("couldn't make a staging folder in {}", dest.display()))
}

/// Give every regular file under `dir` the archive's `Zone.Identifier`
/// stream, the Mark-of-the-Web that makes Windows warn before running a
/// downloaded file, as Explorer does when it extracts. Best effort: an
/// archive without the mark has nothing to copy, and a file system without
/// streams (FAT, exFAT) or a read-only file is skipped. Only called on
/// Windows, where `name:stream` is a stream, not a file name.
#[cfg_attr(not(windows), allow(dead_code))]
fn copy_mark_of_the_web(archive: &Path, dir: &Path) {
    fn zone(p: &Path) -> PathBuf {
        let mut s = p.as_os_str().to_owned();
        s.push(":Zone.Identifier");
        PathBuf::from(s)
    }
    fn walk(dir: &Path, mark: &[u8]) {
        let Ok(rd) = std::fs::read_dir(dir) else { return };
        for entry in rd.flatten() {
            // file_type() doesn't follow links, so links are neither
            // marked nor walked into.
            match entry.file_type() {
                Ok(t) if t.is_dir() => walk(&entry.path(), mark),
                Ok(t) if t.is_file() => {
                    let _ = std::fs::write(zone(&entry.path()), mark);
                }
                _ => {}
            }
        }
    }
    if let Ok(mark) = std::fs::read(zone(archive)) {
        walk(dir, &mark);
    }
}

/// Extract `archive` into the empty folder `dir`. Dispatches on extension:
///   .zip → in-process (`zip_extract`; GNU tar on Linux can't read zip)
///   .tar/.tar.gz/.tgz/.tar.bz2 → `tar -xf ...`
///   .tar.zst/.tzst → in-process zstd piped into `tar -xf -`
///   .7z → `7z.exe x archive -o<dir> -y` (`-y` only answers for entries the
///   archive itself repeats, since `dir` starts empty)
fn extract_into(archive: &str, dir: &Path) -> Result<Vec<Skipped>, String> {
    let dest_dir = dir.to_string_lossy().into_owned();
    let lower = archive.to_ascii_lowercase();

    if lower.ends_with(".zip") {
        return zip_extract(archive, dir);
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
        let args = ["x", &out_flag, "-y", "--", archive];
        return run_archive_tool(&program, &args).map(|()| Vec::new());
    }

    if is_tar_family {
        if find_tool(TAR_NAMES).is_none() {
            return Err("tar.exe not found on PATH".to_string());
        }
        if is_tar_zst {
            return tar_zst_extract(archive, &dest_dir).map(|()| Vec::new());
        }
        let args = ["-xf", archive, "-C", dest_dir.as_str()];
        return run_archive_tool("tar", &args).map(|()| Vec::new());
    }

    Err(format!(
        "archive_extract: unsupported archive extension for '{}'",
        archive
    ))
}

/// Extract a zip into the empty folder `dir`. Our own loop rather than
/// `ZipArchive::extract`, which creates archived symlinks pointing anywhere
/// and stops at the first link Windows won't create:
/// - an entry whose name climbs out of `dir` fails the extraction;
/// - links are made last, so nothing is ever written through one, and only
///   when `link_stays_inside` (else skipped and reported, as is a link
///   Windows refuses for want of the symlink privilege);
/// - unix mode bits are applied at the end, without setuid, setgid or
///   sticky, and folders stay writable by their owner so they can be moved
///   into place and cleaned up.
fn zip_extract(archive: &str, dir: &Path) -> Result<Vec<Skipped>, String> {
    use std::io::Read;
    let fail = |e: &dyn std::fmt::Display| format!("extract {}: {}", archive, e);
    let f = std::fs::File::open(archive).map_err(|e| format!("open {}: {}", archive, e))?;
    let mut za = zip::ZipArchive::new(std::io::BufReader::new(f))
        .map_err(|e| format!("read zip {}: {}", archive, e))?;

    let mut links: Vec<(PathBuf, Vec<u8>)> = Vec::new();
    let mut modes: Vec<(PathBuf, u32, bool)> = Vec::new();
    for i in 0..za.len() {
        let mut entry = za.by_index(i).map_err(|e| fail(&e))?;
        let rel = entry_path(&entry)
            .ok_or_else(|| fail(&format!("entry \"{}\" points outside the folder", entry.name())))?;
        if entry.is_symlink() {
            let mut target = Vec::new();
            entry.read_to_end(&mut target).map_err(|e| fail(&e))?;
            links.push((rel, target));
            continue;
        }
        let out = dir.join(&rel);
        if entry.is_dir() {
            std::fs::create_dir_all(&out).map_err(|e| fail(&e))?;
        } else {
            if let Some(parent) = out.parent() {
                std::fs::create_dir_all(parent).map_err(|e| fail(&e))?;
            }
            // `create` replaces only an earlier entry of the same archive
            // with the same name; `dir` started empty and holds no links yet.
            let mut file = std::fs::File::create(&out).map_err(|e| fail(&e))?;
            std::io::copy(&mut entry, &mut file).map_err(|e| fail(&e))?;
        }
        if let Some(mode) = entry.unix_mode() {
            modes.push((out, mode, entry.is_dir()));
        }
    }

    let mut skipped = Vec::new();
    for (rel, target) in &links {
        if let Err(reason) = make_archived_link(dir, rel, target) {
            skipped.push(Skipped { path: rel.to_string_lossy().into_owned(), reason });
        }
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        // Deepest first, so a folder made read-only doesn't block its children.
        modes.sort_by_key(|(p, _, _)| std::cmp::Reverse(p.components().count()));
        for (path, mode, is_dir) in modes {
            let mode = if is_dir { mode & 0o777 | 0o700 } else { mode & 0o777 };
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(mode))
                .map_err(|e| fail(&e))?;
        }
    }
    Ok(skipped)
}

/// The entry's path inside the extraction folder, with `.` and `..` folded
/// away, or None if it's absolute, has a drive or climbs above the folder.
fn entry_path(entry: &zip::read::ZipFile<'_>) -> Option<PathBuf> {
    let mut out = PathBuf::new();
    for c in entry.enclosed_name()?.components() {
        match c {
            Component::Normal(name) => out.push(name),
            Component::ParentDir => {
                if !out.pop() {
                    return None;
                }
            }
            Component::CurDir => {}
            Component::RootDir | Component::Prefix(_) => return None,
        }
    }
    (!out.as_os_str().is_empty()).then_some(out)
}

/// A link target from the archive stays inside the extraction when it's
/// relative and climbs (`..`) only at its start, never above the root, from
/// the link's own folder. A `..` after a name ("a/../..") could climb out
/// through another archived link (`a` → `.`), so it's refused even when it
/// looks harmless.
fn link_stays_inside(rel: &Path, target: &Path) -> bool {
    let mut depth = rel.parent().map_or(0, |p| p.components().count());
    let mut climbing = true;
    for c in target.components() {
        match c {
            Component::CurDir => {}
            Component::ParentDir if climbing => {
                if depth == 0 {
                    return false;
                }
                depth -= 1;
            }
            Component::Normal(_) => climbing = false,
            _ => return false, // absolute, a drive, or `..` after a name
        }
    }
    !target.as_os_str().is_empty()
}

/// Create the archived link `rel` → `target` under `root`, or say why not.
fn make_archived_link(root: &Path, rel: &Path, target: &[u8]) -> Result<(), String> {
    let target = std::str::from_utf8(target).map_err(|_| "its target isn't valid UTF-8".to_string())?;
    #[cfg(windows)]
    let target = target.replace('/', "\\");
    let target = Path::new(&target);
    if !link_stays_inside(rel, target) {
        return Err(format!("its target {} is outside the archive", target.display()));
    }
    // The link's folders must be real folders: under another link, `..`
    // would climb from wherever that link points.
    let mut ancestor = root.to_path_buf();
    for c in rel.parent().into_iter().flat_map(Path::components) {
        ancestor.push(c);
        match std::fs::symlink_metadata(&ancestor) {
            Ok(m) if m.file_type().is_symlink() => {
                return Err("it's inside another archived link".to_string())
            }
            Ok(_) => {}
            Err(_) => std::fs::create_dir(&ancestor).map_err(|e| e.to_string())?,
        }
    }
    let at = root.join(rel);
    #[cfg(unix)]
    let res = std::os::unix::fs::symlink(target, &at);
    #[cfg(windows)]
    let res = {
        let points_at = at.parent().unwrap_or(root).join(target);
        if points_at.is_dir() {
            std::os::windows::fs::symlink_dir(target, &at)
        } else {
            std::os::windows::fs::symlink_file(target, &at)
        }
    };
    res.map_err(|e| match e.raw_os_error() {
        Some(1314) if cfg!(windows) => {
            "Windows needs Developer Mode or admin rights to create symlinks".to_string()
        }
        _ if e.kind() == std::io::ErrorKind::AlreadyExists => {
            "the archive has another entry with its name".to_string()
        }
        _ => e.to_string(),
    })
}

/// `archive_extract`, then what the frontend does when nothing conflicts:
/// move every staged entry into `dest` and discard the staging folder.
#[cfg(test)]
pub(super) fn extract_to(archive: &Path, dest: &Path) -> Result<Vec<Skipped>, String> {
    let staged = archive_extract(
        archive.to_string_lossy().into_owned(),
        dest.to_string_lossy().into_owned(),
    )?;
    for entry in std::fs::read_dir(&staged.staging).unwrap() {
        let entry = entry.unwrap();
        let to = dest.join(entry.file_name());
        assert!(std::fs::symlink_metadata(&to).is_err(), "{} is taken", to.display());
        std::fs::rename(entry.path(), to).unwrap();
    }
    archive_discard_staging(staged.staging).unwrap();
    Ok(staged.skipped)
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
        extract_to(&zip_path, &out).unwrap();

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
        extract_to(&archive, &out).unwrap();
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
            extract_to(&archive, &out).unwrap();
            for n in names {
                assert_eq!(std::fs::read_to_string(out.join(n)).unwrap(), n, "{} {}", format, n);
            }
        }
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn create_never_replaces_an_existing_file() {
        let dir = temp_dir("archnoclobber");
        let src = dir.join("a.txt");
        std::fs::write(&src, "payload").unwrap();
        let mut formats = vec!["zip"];
        if which::which("tar").is_ok() {
            formats.extend(["tar.gz", "tar.zst"]);
        }
        if find_7z().is_ok() {
            formats.push("7z");
        }
        for format in formats {
            let dest = dir.join(format!("taken.{}", format));
            std::fs::write(&dest, "keep me").unwrap();
            let err = archive_create(vec![s(&src)], s(&dest), format.into()).unwrap_err();
            assert!(err.starts_with("\"taken."), "{}: {}", format, err);
            assert!(err.contains("already exists in"), "{}: {}", format, err);
            assert_eq!(std::fs::read_to_string(&dest).unwrap(), "keep me", "{}", format);
        }
        let dest = dir.join("taken.zip");
        assert!(compress(vec![s(&src)], s(&dest)).unwrap_err().contains("already exists in"));
        assert_eq!(std::fs::read_to_string(&dest).unwrap(), "keep me");
        let _ = std::fs::remove_dir_all(&dir);
    }
}

#[cfg(test)]
#[path = "archive_tests.rs"]
mod archive_tests;
