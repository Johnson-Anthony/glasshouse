use std::path::{Path, PathBuf};
#[cfg(not(windows))]
use super::listing::home_dir_path;
#[cfg(windows)]
use super::launch::CREATE_NO_WINDOW;
use crate::ops::{Op, OpRegistry, CANCELLED};
use tauri::{AppHandle, State};

// ---------- file operations ----------

/// Create a folder. By default (New Folder) an existing path is refused, so
/// undoing the create can never delete a folder that was already there.
/// `all` is `create_dir_all`, for folders the app keeps for itself, where an
/// existing one is fine.
#[tauri::command(async)]
pub fn make_dir(path: String, all: Option<bool>) -> Result<(), String> {
    if all.unwrap_or(false) {
        return std::fs::create_dir_all(&path).map_err(|e| e.to_string());
    }
    std::fs::create_dir(&path).map_err(|e| no_clobber_err(&path, e))
}

/// Rename, refusing a target that already exists instead of replacing it.
#[tauri::command(async)]
pub fn rename_entry(from: String, to: String) -> Result<(), String> {
    rename_no_replace(Path::new(&from), Path::new(&to)).map_err(|e| no_clobber_err(&to, e))
}

/// The error for a create or rename whose target is taken, in the wording
/// undo's `ensureFree` uses; `isAlreadyExists` in api.ts matches it.
fn no_clobber_err(path: &str, e: std::io::Error) -> String {
    if e.kind() != std::io::ErrorKind::AlreadyExists {
        return e.to_string();
    }
    let p = Path::new(path);
    let name = p.file_name().unwrap_or(p.as_os_str()).to_string_lossy();
    let parent = p.parent().map(|d| d.to_string_lossy()).unwrap_or_default();
    format!("\"{}\" already exists in {}", name, parent)
}

/// `fs::rename` that never replaces an existing entry at `to`. The platform
/// primitive refuses atomically; where there's none (non-Linux unix, or a
/// file system that rejects the flag) it's a check followed by the rename,
/// which leaves a small race.
fn rename_no_replace(from: &Path, to: &Path) -> std::io::Result<()> {
    use std::io::ErrorKind;
    if from == to {
        return Ok(()); // as fs::rename does; the primitives would call it taken
    }
    match rename_no_replace_os(from, to) {
        Err(e) if e.kind() == ErrorKind::AlreadyExists && is_case_only_self_rename(from, to) => {
            std::fs::rename(from, to)
        }
        Err(e) if e.kind() == ErrorKind::Unsupported => rename_after_check(from, to),
        other => other,
    }
}

/// The fallback without an atomic primitive: refuse a taken `to`, else rename.
fn rename_after_check(from: &Path, to: &Path) -> std::io::Result<()> {
    use std::io::ErrorKind;
    match std::fs::symlink_metadata(to) {
        Ok(_) if !is_case_only_self_rename(from, to) => Err(ErrorKind::AlreadyExists.into()),
        Err(e) if e.kind() != ErrorKind::NotFound => Err(e),
        _ => std::fs::rename(from, to),
    }
}

#[cfg(target_os = "linux")]
fn rename_no_replace_os(from: &Path, to: &Path) -> std::io::Result<()> {
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt;
    let from = CString::new(from.as_os_str().as_bytes())?;
    let to = CString::new(to.as_os_str().as_bytes())?;
    // The raw syscall rather than the libc wrapper, which only glibc 2.28+
    // has. SAFETY: both paths are NUL-terminated and outlive the call.
    let rc = unsafe {
        libc::syscall(
            libc::SYS_renameat2,
            libc::AT_FDCWD,
            from.as_ptr(),
            libc::AT_FDCWD,
            to.as_ptr(),
            libc::RENAME_NOREPLACE,
        )
    };
    if rc == 0 {
        return Ok(());
    }
    let e = std::io::Error::last_os_error();
    match e.raw_os_error() {
        // EINVAL: this file system doesn't take the flag; ENOSYS: kernel < 3.15.
        Some(libc::EINVAL) | Some(libc::ENOSYS) => Err(std::io::ErrorKind::Unsupported.into()),
        _ => Err(e),
    }
}

#[cfg(windows)]
fn rename_no_replace_os(from: &Path, to: &Path) -> std::io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows::core::PCWSTR;
    use windows::Win32::Storage::FileSystem::{MoveFileExW, MOVE_FILE_FLAGS};
    let wide = |p: &Path| -> Vec<u16> { p.as_os_str().encode_wide().chain(Some(0)).collect() };
    let (f, t) = (wide(from), wide(to));
    // No MOVEFILE_REPLACE_EXISTING, so a taken target fails with
    // ERROR_ALREADY_EXISTS. SAFETY: both strings are NUL-terminated and
    // outlive the call.
    let moved = unsafe { MoveFileExW(PCWSTR(f.as_ptr()), PCWSTR(t.as_ptr()), MOVE_FILE_FLAGS(0)) };
    // A Win32 error HRESULT carries the Win32 code in its low 16 bits.
    moved.map_err(|e| std::io::Error::from_raw_os_error(e.code().0 & 0xFFFF))
}

#[cfg(all(unix, not(target_os = "linux")))]
fn rename_no_replace_os(_from: &Path, _to: &Path) -> std::io::Result<()> {
    Err(std::io::ErrorKind::Unsupported.into())
}

/// `to` is `from` itself under a name that differs only in case: a
/// case-only rename on a case-insensitive file system (NTFS, SMB, vfat, ext4
/// casefold), where the no-replace primitives see the target as taken.
/// Decided by identity without following links, so two different entries in
/// a case-sensitive folder never count.
fn is_case_only_self_rename(from: &Path, to: &Path) -> bool {
    let (Some(a), Some(b)) = (from.file_name(), to.file_name()) else {
        return false;
    };
    from.parent() == to.parent()
        && a != b
        && a.to_string_lossy().to_lowercase() == b.to_string_lossy().to_lowercase()
        && same_entry(from, to)
}

#[cfg(unix)]
fn same_entry(a: &Path, b: &Path) -> bool {
    use std::os::unix::fs::MetadataExt;
    match (std::fs::symlink_metadata(a), std::fs::symlink_metadata(b)) {
        (Ok(x), Ok(y)) => x.dev() == y.dev() && x.ino() == y.ino(),
        _ => false,
    }
}

#[cfg(windows)]
fn same_entry(a: &Path, b: &Path) -> bool {
    fn id(p: &Path) -> Option<(u32, u32, u32)> {
        use std::os::windows::fs::OpenOptionsExt;
        use std::os::windows::io::AsRawHandle;
        use windows::Win32::Foundation::HANDLE;
        use windows::Win32::Storage::FileSystem::{
            GetFileInformationByHandle, BY_HANDLE_FILE_INFORMATION,
        };
        // No access rights needed to read the file id. BACKUP_SEMANTICS opens
        // folders; OPEN_REPARSE_POINT opens a link itself, not its target.
        let f = std::fs::OpenOptions::new()
            .access_mode(0)
            .custom_flags(0x0200_0000 | 0x0020_0000)
            .open(p)
            .ok()?;
        let mut info = BY_HANDLE_FILE_INFORMATION::default();
        // SAFETY: the handle is open for the whole call.
        unsafe { GetFileInformationByHandle(HANDLE(f.as_raw_handle()), &mut info) }.ok()?;
        Some((
            info.dwVolumeSerialNumber,
            info.nFileIndexHigh,
            info.nFileIndexLow,
        ))
    }
    matches!((id(a), id(b)), (Some(x), Some(y)) if x == y)
}

/// Copy a file, folder or symlink. Symlinks are recreated as links, never
/// followed, whether selected directly or found inside a folder. A target
/// that already exists is refused, never overwritten or merged into: the
/// paste planner frees a name (Replace trashes the old item) before copying.
/// With `op_id` it reports bytes copied and can be cancelled (see ops.rs).
#[tauri::command(async)]
pub fn copy_entry(
    app: AppHandle,
    ops: State<'_, OpRegistry>,
    from: String,
    to: String,
    op_id: Option<String>,
) -> Result<(), String> {
    copy_path(&from, &to, &ops.start(op_id, &app))
}

/// copy_entry's work. A cancelled copy leaves nothing behind: the file being
/// copied is removed, and so is a folder copy's whole new folder.
pub(crate) fn copy_path(from: &str, to: &str, op: &Op) -> Result<(), String> {
    let src = Path::new(from);
    let dst = Path::new(to);
    let meta = std::fs::symlink_metadata(src).map_err(|e| format!("stat {}: {}", from, e))?;
    check_not_into_self(src, dst, &meta, false)?;
    let ty = meta.file_type();
    op.set_total(if ty.is_dir() {
        tree_size(src, op).map_err(|e| e.to_string())?
    } else if ty.is_file() {
        meta.len()
    } else {
        0
    });
    // Create the top entry here, so only a taken top-level name gets the
    // standard "already exists" error; a failure deeper down keeps its own.
    let created = if ty.is_symlink() {
        copy_symlink(src, dst)
    } else if ty.is_dir() {
        std::fs::create_dir(dst)
    } else {
        copy_regular_file(src, dst, &ty, op)
    };
    created.map_err(|e| no_clobber_err(to, e))?;
    if ty.is_dir() {
        if let Err(e) = copy_dir_contents(src, dst, op) {
            if op.cancelled() {
                // Everything under dst is from this copy: create_dir above
                // refused a name that was already taken.
                let _ = std::fs::remove_dir_all(dst);
                return Err(CANCELLED.to_string());
            }
            return Err(e.to_string());
        }
    }
    Ok(())
}

/// Total size of the regular files under `dir`, links not followed, for a
/// copy's progress. Entries it can't read count as nothing (the copy itself
/// reports them); only a cancel fails it.
fn tree_size(dir: &Path, op: &Op) -> std::io::Result<u64> {
    let mut total = 0;
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Ok(0);
    };
    for entry in entries.flatten() {
        op.check_io()?;
        match entry.file_type() {
            Ok(t) if t.is_dir() => total += tree_size(&entry.path(), op)?,
            Ok(t) if t.is_file() => total += entry.metadata().map_or(0, |m| m.len()),
            _ => {}
        }
    }
    Ok(total)
}

/// Copy the folder `src` to `dst`, which must not exist yet.
fn copy_dir_recursive(src: &Path, dst: &Path, op: &Op) -> std::io::Result<()> {
    std::fs::create_dir(dst)?;
    copy_dir_contents(src, dst, op)
}

/// Copy what's inside `src` into the new, empty folder `dst`.
fn copy_dir_contents(src: &Path, dst: &Path, op: &Op) -> std::io::Result<()> {
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        // file_type() doesn't follow links, so a link is seen as a link here
        let ty = entry.file_type()?;
        let dst_child = dst.join(entry.file_name());
        if ty.is_symlink() {
            copy_symlink(&entry.path(), &dst_child)?;
        } else if ty.is_dir() {
            copy_dir_recursive(&entry.path(), &dst_child, op)?;
        } else {
            copy_regular_file(&entry.path(), &dst_child, &ty, op)?;
        }
    }
    Ok(())
}

/// Copy a regular file to a `dst` that must not exist yet, refusing FIFOs,
/// sockets and devices: reading a FIFO blocks until something writes to it,
/// which would hang the command.
fn copy_regular_file(
    src: &Path,
    dst: &Path,
    ty: &std::fs::FileType,
    op: &Op,
) -> std::io::Result<()> {
    if !ty.is_file() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::Unsupported,
            format!("can't copy {}: not a regular file", src.display()),
        ));
    }
    copy_file_no_clobber(src, dst, op)
}

/// `fs::copy` that fails with AlreadyExists instead of overwriting `dst`.
/// CopyFileW copies the whole file in one call, so progress and a cancel
/// land between files.
#[cfg(windows)]
fn copy_file_no_clobber(src: &Path, dst: &Path, op: &Op) -> std::io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::TRUE;
    use windows::Win32::Storage::FileSystem::CopyFileW;
    op.check_io()?;
    let len = std::fs::metadata(src).map_or(0, |m| m.len());
    let wide = |p: &Path| -> Vec<u16> { p.as_os_str().encode_wide().chain(Some(0)).collect() };
    let (s, d) = (wide(src), wide(dst));
    // The Win32 copy fs::copy uses, with bFailIfExists set: a taken target
    // fails with ERROR_FILE_EXISTS. SAFETY: both strings are NUL-terminated
    // and outlive the call.
    let copied = unsafe { CopyFileW(PCWSTR(s.as_ptr()), PCWSTR(d.as_ptr()), TRUE) };
    // A Win32 error HRESULT carries the Win32 code in its low 16 bits.
    copied
        .map(|()| op.advance(len))
        .map_err(|e| std::io::Error::from_raw_os_error(e.code().0 & 0xFFFF))
}

/// `fs::copy` that fails with AlreadyExists instead of overwriting `dst`.
#[cfg(not(windows))]
fn copy_file_no_clobber(src: &Path, dst: &Path, op: &Op) -> std::io::Result<()> {
    let mut from = std::fs::File::open(src)?;
    let perms = from.metadata()?.permissions();
    let mut to = std::fs::File::create_new(dst)?;
    let res = copy_slices(&mut from, &mut to, op).and_then(|()| to.set_permissions(perms));
    if res.is_err() {
        // Don't leave a partial copy behind; this file is ours.
        drop(to);
        let _ = std::fs::remove_file(dst);
    }
    res
}

/// Copy `from` to `to` a slice at a time, so progress is reported and a
/// cancel lands between slices. io::copy between files is copy_file_range on
/// Linux, like fs::copy, and still is through `take`.
#[cfg(not(windows))]
fn copy_slices(from: &mut std::fs::File, to: &mut std::fs::File, op: &Op) -> std::io::Result<()> {
    use std::io::Read;
    const SLICE: u64 = 4 << 20;
    loop {
        op.check_io()?;
        let n = std::io::copy(&mut from.by_ref().take(SLICE), to)?;
        if n == 0 {
            return Ok(());
        }
        op.advance(n);
    }
}

/// Recreate the symlink `src` at `dst` with the same target text, so a
/// relative link stays relative. The link's target is never read.
fn copy_symlink(src: &Path, dst: &Path) -> std::io::Result<()> {
    let target = std::fs::read_link(src)?;
    #[cfg(unix)]
    let res = std::os::unix::fs::symlink(&target, dst);
    #[cfg(windows)]
    let res = {
        use std::os::windows::fs::FileTypeExt;
        if std::fs::symlink_metadata(src)?.file_type().is_symlink_dir() {
            std::os::windows::fs::symlink_dir(&target, dst)
        } else {
            std::os::windows::fs::symlink_file(&target, dst)
        }
    };
    res.map_err(|e| {
        // ERROR_PRIVILEGE_NOT_HELD: Windows only lets admins, or anyone once
        // Developer Mode is on, create symlinks.
        let hint = if cfg!(windows) && e.raw_os_error() == Some(1314) {
            " (Windows needs Developer Mode or admin rights to create symlinks)"
        } else {
            ""
        };
        std::io::Error::new(
            e.kind(),
            format!("can't create symlink {}: {}{}", dst.display(), e, hint),
        )
    })
}

/// Resolve `p` without following its last component: canonicalize the
/// nearest existing ancestor and re-append the rest. Works for paths that
/// don't exist yet, and keeps a symlink as the link rather than its target.
fn resolve_no_follow(p: &Path) -> PathBuf {
    let mut rest = Vec::new();
    let mut cur = p;
    while let (Some(parent), Some(name)) = (cur.parent(), cur.file_name()) {
        rest.push(name);
        if let Ok(base) = std::fs::canonicalize(parent) {
            return rest.iter().rev().fold(base, |acc, n| acc.join(n));
        }
        cur = parent;
    }
    std::fs::canonicalize(p).unwrap_or_else(|_| p.to_path_buf())
}

/// Refuse a copy or move that would write into its own source. Copying a
/// file onto itself truncates it to nothing, and copying or moving a folder
/// into its own subtree recurses until the path gets too long. `allow_same`
/// lets a move through when the destination resolves to the source, as a
/// case-only rename on Windows (`Foo` to `foo`) does.
fn check_not_into_self(
    src: &Path,
    dst: &Path,
    src_meta: &std::fs::Metadata,
    allow_same: bool,
) -> Result<(), String> {
    let s = resolve_no_follow(src);
    // An existing destination is canonicalized in full: fs::copy and
    // create_dir_all write through a destination that is a link.
    let d = std::fs::canonicalize(dst).unwrap_or_else(|_| resolve_no_follow(dst));
    if d == s {
        if allow_same {
            return Ok(());
        }
        return Err(format!(
            "{} is the same as its destination {}",
            src.display(),
            dst.display()
        ));
    }
    if src_meta.is_dir() && d.starts_with(&s) {
        return Err(format!(
            "can't put folder {} inside itself ({})",
            src.display(),
            dst.display()
        ));
    }
    Ok(())
}

/// Rename failed only because source and destination are on different
/// volumes. Matches raw codes because `io::ErrorKind::CrossesDevices` is
/// newer than the crate's `rust-version`.
fn is_cross_device(e: &std::io::Error) -> bool {
    #[cfg(unix)]
    const CODE: i32 = 18; // EXDEV, the same on Linux, macOS and the BSDs
    #[cfg(windows)]
    const CODE: i32 = 17; // ERROR_NOT_SAME_DEVICE
    e.raw_os_error() == Some(CODE)
}

#[tauri::command(async)]
pub fn move_entry(from: String, to: String) -> Result<(), String> {
    let src = Path::new(&from);
    let dst = Path::new(&to);
    let meta = std::fs::symlink_metadata(src).map_err(|e| format!("stat {}: {}", from, e))?;
    check_not_into_self(src, dst, &meta, true)?;
    if src == dst {
        return Ok(());
    }
    // Rename is the whole move on one volume, and never replaces an existing
    // target. Only a cross-volume move falls back to copy + delete: after any
    // other rename error (target taken, access denied, file in use) the
    // fallback would merge into the destination and delete the source. The
    // copy refuses a taken target too, so the source is never deleted then.
    // The delete must be recursive or a directory's source is left behind.
    match rename_no_replace(src, dst) {
        Ok(()) => Ok(()),
        Err(e) if is_cross_device(&e) => {
            copy_path(&from, &to, &Op::untracked())?;
            delete_entry(from, true)
        }
        Err(e) => Err(no_clobber_err(&to, e)),
    }
}

#[tauri::command(async)]
pub fn delete_entry(path: String, recursive: bool) -> Result<(), String> {
    let p = Path::new(&path);
    let meta = std::fs::symlink_metadata(p).map_err(|e| e.to_string())?;
    if meta.is_dir() {
        if recursive {
            std::fs::remove_dir_all(p).map_err(|e| e.to_string())
        } else {
            std::fs::remove_dir(p).map_err(|e| e.to_string())
        }
    } else {
        std::fs::remove_file(p).map_err(|e| e.to_string())
    }
}

/// Move a file or directory to the system recycle bin. Uses the `trash`
/// crate, which dispatches to `IFileOperation` with `FOFX_RECYCLEONDELETE`
/// on Windows — items land in the recycle bin and can be restored.
#[tauri::command(async)]
pub fn move_to_trash(path: String) -> Result<(), String> {
    trash::delete(&path).map_err(|e| format!("move_to_trash({}): {}", path, e))
}

/// The folder holding trashed files: the XDG home trash on unix, `None` on
/// Windows (the Recycle Bin isn't a browsable directory).
#[tauri::command(async)]
pub fn trash_dir() -> Option<String> {
    #[cfg(windows)]
    {
        None
    }
    #[cfg(not(windows))]
    {
        let dir = xdg_trash_files(std::env::var("XDG_DATA_HOME").ok(), home_dir_path())?;
        // The trash is created on first use, so an account that has never
        // trashed anything has none; make it so browsing shows an empty
        // folder instead of a read error.
        let _ = std::fs::create_dir_all(&dir);
        Some(dir.to_string_lossy().into_owned())
    }
}

/// `$XDG_DATA_HOME/Trash/files`. The XDG spec ignores an empty or relative
/// XDG_DATA_HOME and falls back to `~/.local/share`.
#[cfg(not(windows))]
fn xdg_trash_files(xdg_data_home: Option<String>, home: Option<PathBuf>) -> Option<PathBuf> {
    let data = xdg_data_home
        .map(PathBuf::from)
        .filter(|p| p.is_absolute())
        .or_else(|| home.map(|h| h.join(".local/share")))?;
    Some(data.join("Trash/files"))
}

#[tauri::command(async)]
pub fn read_text(path: String, max_bytes: usize) -> Result<String, String> {
    use std::io::Read;
    let f = std::fs::File::open(&path).map_err(|e| e.to_string())?;
    // Hard server-side ceiling regardless of what the frontend asks for —
    // an oversized cap would buffer the whole file in memory.
    let cap = if max_bytes == 0 { 1_000_000 } else { max_bytes }.min(64 * 1024 * 1024);
    let mut buf = Vec::with_capacity(cap.min(1 << 20));
    f.take(cap as u64)
        .read_to_end(&mut buf)
        .map_err(|e| e.to_string())?;
    Ok(String::from_utf8_lossy(&buf).into_owned())
}

/// Write a text file. By default (New File and friends) the file must not
/// exist yet: an existing path is refused atomically instead of emptied.
/// `overwrite` is for saving over a file on purpose.
#[tauri::command(async)]
pub fn write_text(path: String, content: String, overwrite: Option<bool>) -> Result<(), String> {
    use std::io::Write;
    if overwrite.unwrap_or(false) {
        return std::fs::write(&path, content).map_err(|e| e.to_string());
    }
    let mut file = std::fs::File::create_new(&path).map_err(|e| no_clobber_err(&path, e))?;
    if let Err(e) = file.write_all(content.as_bytes()) {
        // Don't leave a half-written new file behind.
        drop(file);
        let _ = std::fs::remove_file(&path);
        return Err(e.to_string());
    }
    Ok(())
}

/// Server-side ceiling for `read_image_b64`, whatever the frontend asks for.
/// The largest request today is the 64 MiB image preview; base64 makes the
/// IPC string a third bigger again.
const READ_IMAGE_MAX: usize = 64 * 1024 * 1024;

#[tauri::command(async)]
pub fn read_image_b64(path: String, max_bytes: usize) -> Result<String, String> {
    use base64::{engine::general_purpose::STANDARD, Engine as _};
    use std::io::Read;
    let cap = if max_bytes == 0 { 8 * 1024 * 1024 } else { max_bytes }.min(READ_IMAGE_MAX);
    let f = std::fs::File::open(&path).map_err(|e| e.to_string())?;
    let len = f.metadata().map_err(|e| e.to_string())?.len();
    if len > cap as u64 {
        return Err(format!("image too large: {} bytes (cap {})", len, cap));
    }
    // Read at most cap + 1 bytes, so a file that grew after the size check
    // is still refused instead of read whole.
    let mut bytes = Vec::with_capacity(len as usize);
    f.take(cap as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() > cap {
        return Err(format!("image too large: over {} bytes", cap));
    }
    let ext = Path::new(&path)
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let mime = match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "bmp" => "image/bmp",
        "ico" => "image/x-icon",
        "avif" => "image/avif",
        // The inspector's audio and pdf previews ride the same data-URL path.
        "pdf" => "application/pdf",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "ogg" | "oga" | "opus" => "audio/ogg",
        "flac" => "audio/flac",
        "m4a" => "audio/mp4",
        _ => "application/octet-stream",
    };
    Ok(format!("data:{};base64,{}", mime, STANDARD.encode(&bytes)))
}

// ---------- permissions (chmod) ----------

/// Set permissions on `path`. On unix this applies `mode` directly via
/// `PermissionsExt::from_mode`. On windows it only toggles the read-only
/// attribute based on the owner-write bit (`mode & 0o200`); richer ACL
/// manipulation is out of scope for v1.
#[tauri::command(async)]
pub fn set_permissions(path: String, mode: u32) -> Result<(), String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(mode))
            .map_err(|e| format!("set_permissions({}): {}", path, e))?;
        Ok(())
    }
    #[cfg(windows)]
    {
        let meta = std::fs::metadata(&path)
            .map_err(|e| format!("metadata({}): {}", path, e))?;
        let mut perms = meta.permissions();
        // Owner-write bit set → writable (clear read-only); unset → read-only.
        let writable = (mode & 0o200) != 0;
        perms.set_readonly(!writable);
        std::fs::set_permissions(&path, perms)
            .map_err(|e| format!("set_permissions({}): {}", path, e))?;
        Ok(())
    }
    #[cfg(not(any(unix, windows)))]
    {
        let _ = (path, mode);
        Err("set_permissions: unsupported platform".into())
    }
}

// ---------- symlink / hard link ----------

/// Create a symbolic link at `link_path` pointing at `target`. On windows,
/// chooses symlink_dir when the target is an existing directory, else
/// symlink_file. Requires developer mode or admin on pre-1703 Windows.
#[tauri::command(async)]
pub fn create_symlink(target: String, link_path: String) -> Result<(), String> {
    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(&target, &link_path)
            .map_err(|e| format!("symlink {} -> {}: {}", link_path, target, e))
    }
    #[cfg(windows)]
    {
        let is_dir = std::fs::metadata(&target).map(|m| m.is_dir()).unwrap_or(false);
        let res = if is_dir {
            std::os::windows::fs::symlink_dir(&target, &link_path)
        } else {
            std::os::windows::fs::symlink_file(&target, &link_path)
        };
        res.map_err(|e| format!("symlink {} -> {}: {}", link_path, target, e))
    }
    #[cfg(not(any(unix, windows)))]
    {
        let _ = (target, link_path);
        Err("create_symlink: unsupported platform".into())
    }
}

/// Create a hard link at `link_path` pointing at `target`. Requires both on
/// the same volume; errors otherwise.
#[tauri::command(async)]
pub fn create_hard_link(target: String, link_path: String) -> Result<(), String> {
    std::fs::hard_link(&target, &link_path)
        .map_err(|e| format!("hard_link {} -> {}: {}", link_path, target, e))
}

// ---------- create shortcut (.lnk) ----------

/// Create a Windows .lnk shortcut at `link_path` pointing at `target`. Shells
/// out to PowerShell's WScript.Shell COM object — no extra Cargo deps. Errors
/// when `link_path` does not end in `.lnk`, or on non-Windows platforms.
#[tauri::command(async)]
pub fn create_shortcut(target: String, link_path: String) -> Result<(), String> {
    if !link_path.to_ascii_lowercase().ends_with(".lnk") {
        return Err("link path must end with .lnk".into());
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        use std::process::Command;

        // The paths go in through environment variables, never into the
        // script text: PowerShell also reads ‘ ’ ‚ ‛ as quotes, so doubling
        // ASCII `'` still let a filename close the string and run code.
        let script = "$s = (New-Object -ComObject WScript.Shell).CreateShortcut($env:GLASSHOUSE_LINK); \
                      $s.TargetPath = $env:GLASSHOUSE_TARGET; $s.Save()";
        let out = Command::new("powershell.exe")
            .args(["-NoProfile", "-NonInteractive", "-Command", script])
            .env("GLASSHOUSE_LINK", &link_path)
            .env("GLASSHOUSE_TARGET", &target)
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .map_err(|e| format!("powershell: {}", e))?;
        if !out.status.success() {
            let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
            return Err(format!("create_shortcut: {}", stderr));
        }
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = target;
        Err("create_shortcut is Windows-only".into())
    }
}

// ---------- shred ----------

/// Overwrite `path` with fixed-pattern passes (cycling 0xFF, 0x00, 0xAA) then
/// delete it. Regular files only: rejects directories, special files and
/// symlinks, and never opens a link's target. `passes` is clamped to 1..=10.
#[tauri::command(async)]
pub fn shred(path: String, passes: u32) -> Result<(), String> {
    use std::fs::OpenOptions;
    use std::io::{Seek, SeekFrom, Write};

    let meta = std::fs::symlink_metadata(&path).map_err(|e| format!("stat {}: {}", path, e))?;
    let ty = meta.file_type();
    if ty.is_symlink() {
        // Refuse rather than unlink: removing only the link would look like
        // the data was destroyed when the target is untouched.
        let target = std::fs::read_link(&path)
            .map(|t| format!(" to {}", t.display()))
            .unwrap_or_default();
        return Err(format!(
            "shred: {} is a symbolic link{}; shred the target itself instead",
            path, target
        ));
    }
    if ty.is_dir() {
        return Err(format!("shred: {} is a directory", path));
    }
    if !ty.is_file() {
        return Err(format!("shred: {} is not a regular file", path));
    }
    let len = meta.len();
    let n = passes.clamp(1, 10);
    let patterns: [u8; 3] = [0xFF, 0x00, 0xAA];

    let mut opts = OpenOptions::new();
    opts.write(true);
    #[cfg(windows)]
    {
        // FILE_FLAG_OPEN_REPARSE_POINT: open a link itself, not its target
        use std::os::windows::fs::OpenOptionsExt;
        opts.custom_flags(0x0020_0000);
    }
    let mut f = opts
        .open(&path)
        .map_err(|e| format!("open {}: {}", path, e))?;
    // The path could have been swapped for a link between the stat and the
    // open; make sure the open file is still the one that was checked.
    let opened = f.metadata().map_err(|e| format!("stat {}: {}", path, e))?;
    #[cfg(unix)]
    let same = {
        use std::os::unix::fs::MetadataExt;
        opened.dev() == meta.dev() && opened.ino() == meta.ino()
    };
    #[cfg(windows)]
    let same = opened.file_type().is_file();
    if !same {
        return Err(format!("shred: {} changed while it was being opened", path));
    }

    const CHUNK: usize = 64 * 1024;
    for i in 0..n {
        let byte = patterns[(i as usize) % patterns.len()];
        let buf = vec![byte; CHUNK];
        f.seek(SeekFrom::Start(0))
            .map_err(|e| format!("seek {}: {}", path, e))?;
        let mut remaining = len;
        while remaining > 0 {
            let w = remaining.min(CHUNK as u64) as usize;
            f.write_all(&buf[..w])
                .map_err(|e| format!("write {}: {}", path, e))?;
            remaining -= w as u64;
        }
        f.flush().map_err(|e| format!("flush {}: {}", path, e))?;
        f.sync_all().ok();
    }
    drop(f);
    std::fs::remove_file(&path).map_err(|e| format!("remove {}: {}", path, e))
}

// ---------- change owner ----------

/// Change ownership of `path`. On unix accepts "uid:gid" with numeric ids
/// (either side may be omitted: "uid:", ":gid"). On windows returns an
/// unsupported error.
#[tauri::command(async)]
pub fn change_owner(path: String, owner: String) -> Result<(), String> {
    #[cfg(unix)]
    {
        let (uid_s, gid_s) = owner
            .split_once(':')
            .ok_or_else(|| "change_owner: expected 'uid:gid'".to_string())?;
        let uid = if uid_s.is_empty() {
            None
        } else {
            Some(uid_s.parse::<u32>().map_err(|_| "change_owner: non-numeric uid".to_string())?)
        };
        let gid = if gid_s.is_empty() {
            None
        } else {
            Some(gid_s.parse::<u32>().map_err(|_| "change_owner: non-numeric gid".to_string())?)
        };
        std::os::unix::fs::chown(&path, uid, gid)
            .map_err(|e| format!("chown {}: {}", path, e))
    }
    #[cfg(windows)]
    {
        let _ = (path, owner);
        Err("change_owner: not supported on windows".into())
    }
    #[cfg(not(any(unix, windows)))]
    {
        let _ = (path, owner);
        Err("change_owner: unsupported platform".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::testing::{temp_dir, s};

    /// The copy_entry command without its Tauri arguments: untracked.
    fn copy_entry(from: String, to: String) -> Result<(), String> {
        copy_path(&from, &to, &Op::untracked())
    }

    fn read(p: &Path) -> String {
        std::fs::read_to_string(p).unwrap()
    }

    #[cfg_attr(windows, allow(dead_code))]
    fn is_link(p: &Path) -> bool {
        std::fs::symlink_metadata(p).is_ok_and(|m| m.file_type().is_symlink())
    }

    #[test]
    fn copy_dir_recursive_copies_nested_tree() {
        let dir = temp_dir("copytree");
        let src = dir.join("src");
        std::fs::create_dir_all(src.join("a/b")).unwrap();
        std::fs::write(src.join("root.txt"), "r").unwrap();
        std::fs::write(src.join("a/b/leaf.txt"), "leaf").unwrap();
        let dst = dir.join("dst");
        copy_dir_recursive(&src, &dst, &Op::untracked()).unwrap();
        assert_eq!(std::fs::read_to_string(dst.join("root.txt")).unwrap(), "r");
        assert_eq!(std::fs::read_to_string(dst.join("a/b/leaf.txt")).unwrap(), "leaf");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn shred_overwrites_and_removes_regular_file() {
        let dir = temp_dir("shredfile");
        let f = dir.join("secret.txt");
        std::fs::write(&f, "secret").unwrap();
        shred(s(&f), 2).unwrap();
        assert!(!f.exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn shred_rejects_directory() {
        let dir = temp_dir("shreddir");
        assert!(shred(s(&dir), 1).is_err());
        assert!(dir.is_dir());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn shred_refuses_symlink_and_leaves_target_intact() {
        let dir = temp_dir("shredlink");
        let target = dir.join("target.txt");
        std::fs::write(&target, "keep me").unwrap();
        let link = dir.join("link.txt");
        std::os::unix::fs::symlink(&target, &link).unwrap();

        let err = shred(s(&link), 3).unwrap_err();
        assert!(err.contains("symbolic link"), "{err}");
        assert_eq!(std::fs::read_to_string(&target).unwrap(), "keep me");
        assert!(is_link(&link));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn copy_dir_recursive_keeps_symlinks_as_links() {
        use std::os::unix::fs::symlink;
        let dir = temp_dir("copylinks");
        let src = dir.join("src");
        std::fs::create_dir_all(src.join("sub")).unwrap();
        std::fs::write(src.join("sub/file.txt"), "data").unwrap();
        symlink("sub/file.txt", src.join("file-link")).unwrap();
        symlink("sub", src.join("dir-link")).unwrap();
        // points at its own parent: following it would never end
        symlink("..", src.join("sub/loop")).unwrap();
        symlink("missing", src.join("dangling")).unwrap();

        let dst = dir.join("dst");
        copy_entry(s(&src), s(&dst)).unwrap();

        for (name, target) in [
            ("file-link", "sub/file.txt"),
            ("dir-link", "sub"),
            ("sub/loop", ".."),
            ("dangling", "missing"),
        ] {
            let p = dst.join(name);
            assert!(is_link(&p), "{name}");
            assert_eq!(std::fs::read_link(&p).unwrap(), Path::new(target), "{name}");
        }
        // relative links resolve inside the copy, not back into the source
        assert_eq!(std::fs::read_to_string(dst.join("file-link")).unwrap(), "data");
        assert_eq!(
            std::fs::canonicalize(dst.join("dir-link")).unwrap(),
            std::fs::canonicalize(dst.join("sub")).unwrap()
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn copy_entry_copies_a_selected_symlink_as_a_link() {
        let dir = temp_dir("copytoplink");
        std::fs::create_dir_all(dir.join("real/inner")).unwrap();
        let link = dir.join("link");
        std::os::unix::fs::symlink(dir.join("real"), &link).unwrap();
        let dst = dir.join("link-copy");
        copy_entry(s(&link), s(&dst)).unwrap();
        assert!(is_link(&dst));
        assert_eq!(std::fs::read_link(&dst).unwrap(), dir.join("real"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn copy_entry_refuses_copy_onto_itself() {
        let dir = temp_dir("copyself");
        let f = dir.join("a.txt");
        std::fs::write(&f, "hello").unwrap();
        // fs::copy(a, a) would truncate a to 0 bytes
        assert!(copy_entry(s(&f), s(&f)).is_err());
        assert_eq!(std::fs::read_to_string(&f).unwrap(), "hello");

        let folder = dir.join("folder");
        std::fs::create_dir_all(&folder).unwrap();
        std::fs::write(folder.join("x.txt"), "x").unwrap();
        assert!(copy_entry(s(&folder), s(&folder)).is_err());
        assert_eq!(std::fs::read_to_string(folder.join("x.txt")).unwrap(), "x");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn copy_entry_refuses_folder_into_its_own_subtree() {
        let dir = temp_dir("copyinto");
        let folder = dir.join("folder");
        std::fs::create_dir_all(folder.join("sub")).unwrap();
        let dst = folder.join("sub").join("folder");
        let err = copy_entry(s(&folder), s(&dst)).unwrap_err();
        assert!(err.contains("inside itself"), "{err}");
        assert!(!dst.exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn copy_entry_refuses_destination_that_links_back_into_source() {
        let dir = temp_dir("copyvialink");
        let f = dir.join("a.txt");
        std::fs::write(&f, "hello").unwrap();
        let alias = dir.join("alias.txt");
        std::os::unix::fs::symlink(&f, &alias).unwrap();
        // writing through the alias would truncate the source
        assert!(copy_entry(s(&f), s(&alias)).is_err());
        assert_eq!(std::fs::read_to_string(&f).unwrap(), "hello");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn move_entry_refuses_folder_into_its_own_subtree() {
        let dir = temp_dir("moveinto");
        let folder = dir.join("folder");
        std::fs::create_dir_all(folder.join("sub")).unwrap();
        std::fs::write(folder.join("x.txt"), "x").unwrap();
        let dst = folder.join("sub").join("folder");
        let err = move_entry(s(&folder), s(&dst)).unwrap_err();
        assert!(err.contains("inside itself"), "{err}");
        assert_eq!(std::fs::read_to_string(folder.join("x.txt")).unwrap(), "x");
        assert!(!dst.exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn move_entry_onto_its_own_path_is_a_no_op() {
        let dir = temp_dir("moveself");
        let folder = dir.join("folder");
        std::fs::create_dir_all(&folder).unwrap();
        std::fs::write(folder.join("x.txt"), "x").unwrap();
        move_entry(s(&folder), s(&folder)).unwrap();
        assert_eq!(std::fs::read_to_string(folder.join("x.txt")).unwrap(), "x");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn move_entry_does_not_merge_when_rename_fails() {
        let dir = temp_dir("movenomerge");
        let a = dir.join("a");
        std::fs::create_dir_all(&a).unwrap();
        std::fs::write(a.join("from-a.txt"), "a").unwrap();
        let b = dir.join("b");
        std::fs::create_dir_all(&b).unwrap();
        std::fs::write(b.join("from-b.txt"), "b").unwrap();

        // renaming onto a non-empty folder fails, but not across devices,
        // so there's no copy + delete fallback
        assert!(move_entry(s(&a), s(&b)).is_err());
        assert_eq!(std::fs::read_to_string(a.join("from-a.txt")).unwrap(), "a");
        assert!(!b.join("from-a.txt").exists());
        assert_eq!(std::fs::read_to_string(b.join("from-b.txt")).unwrap(), "b");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn is_cross_device_matches_only_the_cross_device_code() {
        #[cfg(unix)]
        let code = 18;
        #[cfg(windows)]
        let code = 17;
        assert!(is_cross_device(&std::io::Error::from_raw_os_error(code)));
        assert!(!is_cross_device(&std::io::Error::from_raw_os_error(2)));
        assert!(!is_cross_device(&std::io::Error::other("not an os error")));
    }

    /// Moves between the temp dir and /dev/shm, when they're on different
    /// devices (true on a Linux CI runner and here, where /tmp and /dev/shm
    /// are separate tmpfs mounts). Skips itself otherwise.
    #[cfg(unix)]
    #[test]
    fn move_entry_falls_back_to_copy_across_devices() {
        use std::os::unix::fs::MetadataExt;
        let shm = Path::new("/dev/shm");
        let dir = temp_dir("movexdev");
        let same_dev = match (std::fs::metadata(shm), std::fs::metadata(&dir)) {
            (Ok(a), Ok(b)) => a.dev() == b.dev(),
            _ => true,
        };
        if same_dev {
            eprintln!("skipped: /dev/shm and the temp dir share a device");
            let _ = std::fs::remove_dir_all(&dir);
            return;
        }
        let src = dir.join("tree");
        std::fs::create_dir_all(src.join("sub")).unwrap();
        std::fs::write(src.join("sub/f.txt"), "f").unwrap();
        std::os::unix::fs::symlink("sub/f.txt", src.join("link")).unwrap();
        let dst = shm.join(format!("glasshouse-test-{}-movexdev", std::process::id()));
        let _ = std::fs::remove_dir_all(&dst);

        move_entry(s(&src), s(&dst)).unwrap();
        assert!(!src.exists());
        assert_eq!(std::fs::read_to_string(dst.join("sub/f.txt")).unwrap(), "f");
        assert_eq!(std::fs::read_link(dst.join("link")).unwrap(), Path::new("sub/f.txt"));
        let _ = std::fs::remove_dir_all(&dst);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[cfg(not(windows))]
    #[test]
    fn xdg_trash_files_respects_xdg_data_home() {
        let home = Some(PathBuf::from("/home/me"));
        assert_eq!(
            xdg_trash_files(Some("/data".into()), home.clone()),
            Some(PathBuf::from("/data/Trash/files"))
        );
        let fallback = Some(PathBuf::from("/home/me/.local/share/Trash/files"));
        assert_eq!(xdg_trash_files(None, home.clone()), fallback);
        assert_eq!(xdg_trash_files(Some(String::new()), home.clone()), fallback);
        assert_eq!(xdg_trash_files(Some("rel/data".into()), home), fallback);
        assert_eq!(xdg_trash_files(None, None), None);
    }

    #[test]
    fn read_image_b64_caps_on_the_server() {
        let dir = temp_dir("imgcap");
        let small = dir.join("a.png");
        std::fs::write(&small, b"\x89PNG").unwrap();
        let url = read_image_b64(s(&small), 0).unwrap();
        assert!(url.starts_with("data:image/png;base64,"), "{}", url);
        assert!(read_image_b64(s(&small), 3).unwrap_err().contains("too large"));

        // A frontend asking for more than the ceiling still gets the ceiling.
        let big = dir.join("big.png");
        let f = std::fs::File::create(&big).unwrap();
        f.set_len(READ_IMAGE_MAX as u64 + 1).unwrap(); // sparse, so this is quick
        drop(f);
        let err = read_image_b64(s(&big), usize::MAX).unwrap_err();
        assert!(err.contains("too large"), "{}", err);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn write_text_creates_but_never_empties_an_existing_file() {
        let dir = temp_dir("writenew");
        let p = dir.join("a.txt");
        write_text(s(&p), "first".into(), None).unwrap();
        assert_eq!(read(&p), "first");
        let err = write_text(s(&p), "second".into(), None).unwrap_err();
        assert_eq!(
            err,
            format!("\"a.txt\" already exists in {}", dir.display())
        );
        assert!(write_text(s(&p), "second".into(), Some(false)).is_err());
        assert_eq!(read(&p), "first");
        // A save replaces the file.
        write_text(s(&p), "saved".into(), Some(true)).unwrap();
        assert_eq!(read(&p), "saved");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn make_dir_refuses_an_existing_path_unless_all() {
        let dir = temp_dir("mkdirnew");
        let d = dir.join("sub");
        make_dir(s(&d), None).unwrap();
        std::fs::write(d.join("keep.txt"), "k").unwrap();
        let err = make_dir(s(&d), None).unwrap_err();
        assert_eq!(err, format!("\"sub\" already exists in {}", dir.display()));
        std::fs::write(dir.join("file"), "f").unwrap();
        assert!(make_dir(s(&dir.join("file")), None).is_err());
        assert_eq!(read(&dir.join("file")), "f");
        // `all` accepts an existing folder and creates missing parents.
        make_dir(s(&d), Some(true)).unwrap();
        make_dir(s(&dir.join("x/y/z")), Some(true)).unwrap();
        assert!(dir.join("x/y/z").is_dir());
        assert_eq!(read(&d.join("keep.txt")), "k");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn rename_entry_never_replaces_an_existing_target() {
        let dir = temp_dir("renamenoclobber");
        let a = dir.join("a.txt");
        let b = dir.join("b.txt");
        let folder = dir.join("folder");
        std::fs::write(&a, "a").unwrap();
        std::fs::write(&b, "b").unwrap();
        std::fs::create_dir(&folder).unwrap();
        std::fs::write(folder.join("inner.txt"), "i").unwrap();

        let err = rename_entry(s(&a), s(&b)).unwrap_err();
        assert_eq!(
            err,
            format!("\"b.txt\" already exists in {}", dir.display())
        );
        assert!(rename_entry(s(&a), s(&folder)).is_err());
        assert!(rename_entry(s(&folder), s(&b)).is_err());
        let empty = dir.join("empty");
        std::fs::create_dir(&empty).unwrap();
        assert!(rename_entry(s(&folder), s(&empty)).is_err());
        assert_eq!(read(&a), "a");
        assert_eq!(read(&b), "b");
        assert_eq!(read(&folder.join("inner.txt")), "i");

        // A free name still renames, and the same path is a no-op.
        rename_entry(s(&a), s(&dir.join("c.txt"))).unwrap();
        assert!(!a.exists());
        assert_eq!(read(&dir.join("c.txt")), "a");
        rename_entry(s(&b), s(&b)).unwrap();
        assert_eq!(read(&b), "b");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn rename_entry_allows_a_case_only_rename() {
        // On a case-insensitive file system (Windows CI's NTFS) the new name
        // "exists" because it is the source; on a case-sensitive one it's free.
        let dir = temp_dir("renamecase");
        let from = dir.join("Readme.md");
        let to = dir.join("README.md");
        std::fs::write(&from, "r").unwrap();
        rename_entry(s(&from), s(&to)).unwrap();
        let names: Vec<String> = std::fs::read_dir(&dir)
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        assert_eq!(names, ["README.md"]);
        assert_eq!(read(&to), "r");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn rename_after_check_refuses_a_taken_name() {
        // The fallback for file systems without RENAME_NOREPLACE, which
        // ext4 and tmpfs never take, so it's tested directly.
        let dir = temp_dir("renamefallback");
        let a = dir.join("a");
        let b = dir.join("b");
        std::fs::write(&a, "a").unwrap();
        std::fs::write(&b, "b").unwrap();
        let err = rename_after_check(&a, &b).unwrap_err();
        assert_eq!(err.kind(), std::io::ErrorKind::AlreadyExists);
        assert_eq!(read(&b), "b");
        rename_after_check(&a, &dir.join("c")).unwrap();
        assert_eq!(read(&dir.join("c")), "a");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn case_only_self_rename_needs_the_same_entry() {
        let dir = temp_dir("caseself");
        // A hard link stands in for one entry seen under two cases on a
        // case-insensitive file system: same inode, names differ in case.
        let foo = dir.join("Foo");
        std::fs::write(&foo, "f").unwrap();
        std::fs::hard_link(&foo, dir.join("foo")).unwrap();
        assert!(is_case_only_self_rename(&foo, &dir.join("foo")));
        // Same entry, but the names differ by more than case.
        std::fs::hard_link(&foo, dir.join("other")).unwrap();
        assert!(!is_case_only_self_rename(&foo, &dir.join("other")));
        // Two different files in a case-sensitive folder.
        std::fs::write(dir.join("Bar"), "1").unwrap();
        std::fs::write(dir.join("bar"), "2").unwrap();
        let (upper, lower) = (dir.join("Bar"), dir.join("bar"));
        assert!(!is_case_only_self_rename(&upper, &lower));
        let err = rename_after_check(&upper, &lower).unwrap_err();
        assert_eq!(err.kind(), std::io::ErrorKind::AlreadyExists);
        assert_eq!(read(&dir.join("bar")), "2");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[cfg(any(target_os = "linux", windows))]
    #[test]
    fn rename_uses_the_atomic_primitive_here() {
        // AlreadyExists rather than Unsupported from the primitive itself:
        // renameat2 / MoveFileExW work on this file system, so rename_entry
        // never takes the check-then-rename fallback here.
        let dir = temp_dir("primitive");
        let a = dir.join("a");
        let b = dir.join("b");
        std::fs::write(&a, "a").unwrap();
        std::fs::write(&b, "b").unwrap();
        let err = rename_no_replace_os(&a, &b).unwrap_err();
        assert_eq!(err.kind(), std::io::ErrorKind::AlreadyExists, "{}", err);
        assert_eq!(read(&b), "b");
        rename_no_replace_os(&a, &dir.join("c")).unwrap();
        assert_eq!(read(&dir.join("c")), "a");
        let _ = std::fs::remove_dir_all(&dir);
    }
}

#[cfg(test)]
#[path = "fs_ops_tests.rs"]
mod fs_ops_tests;
