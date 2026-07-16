use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

#[derive(Debug, Serialize)]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub kind: String,   // folder | text | code | img | archive | exec | bin
    pub size: u64,
    pub modified_ms: i64,
    pub hidden: bool,
    pub ext: String,
    pub is_symlink: bool,
    /// Per-row git status relative to the repo containing the listing dir.
    /// One of: "M" (modified), "A" (added/new), "D" (deleted), "U" (conflicted),
    /// "?" (untracked), "!" (ignored). `None` for clean-tracked or outside-repo.
    pub git: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct SystemInfo {
    pub cpu_pct: f32,
    pub mem_pct: f32,
    pub mem_used: u64,
    pub mem_total: u64,
    pub uptime_s: u64,
    pub host: String,
}

#[tauri::command]
pub fn ping() -> &'static str {
    "pong"
}

#[tauri::command]
pub fn home_dir() -> Option<String> {
    std::env::var("USERPROFILE")
        .ok()
        .or_else(|| std::env::var("HOME").ok())
}

fn kind_from_ext(ext: &str, is_dir: bool) -> &'static str {
    if is_dir {
        return "folder";
    }
    match ext.to_ascii_lowercase().as_str() {
        "md" | "txt" | "log" | "env" | "gitignore" | "ini" | "toml" | "cfg" => "text",
        "rs" | "py" | "js" | "ts" | "tsx" | "jsx" | "json" | "yaml" | "yml" | "go" | "c" | "cpp"
        | "h" | "hpp" | "java" | "cs" | "html" | "css" | "scss" | "sh" | "ps1" => "code",
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "svg" | "bmp" | "ico" => "img",
        "zip" | "tar" | "gz" | "zst" | "7z" | "rar" | "xz" | "bz2" => "archive",
        "exe" | "bat" | "cmd" | "msi" => "exec",
        _ => "bin",
    }
}

fn canonicalize_soft(p: &str) -> PathBuf {
    dunce::canonicalize(p).unwrap_or_else(|_| PathBuf::from(p))
}

#[tauri::command]
pub fn list_dir(path: String, show_hidden: bool) -> Result<Vec<FileEntry>, String> {
    let p = canonicalize_soft(&path);
    let mut out = Vec::new();
    let rd = std::fs::read_dir(&p).map_err(|e| format!("read_dir({}): {}", p.display(), e))?;
    for entry in rd.flatten() {
        let meta = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };
        let name = entry.file_name().to_string_lossy().to_string();
        let hidden = is_hidden(&entry.path(), &name, &meta);
        if hidden && !show_hidden {
            continue;
        }
        let is_dir = meta.is_dir();
        let is_symlink = meta.file_type().is_symlink();
        let ext = entry
            .path()
            .extension()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_default();
        let size = if is_dir { 0 } else { meta.len() };
        let modified_ms = meta
            .modified()
            .ok()
            .and_then(|m| m.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);
        out.push(FileEntry {
            name,
            path: entry.path().to_string_lossy().to_string(),
            kind: kind_from_ext(&ext, is_dir).to_string(),
            size,
            modified_ms,
            hidden,
            ext,
            is_symlink,
            git: None,
        });
    }
    // Compute per-row git status by opening the repo containing this dir, if
    // any, and building an absolute-path -> status-char map. Cheap on
    // normally-sized repos (single-digit ms for <1k files). If anything
    // fails (no repo, corrupt, permissions), fall through with all `git`
    // fields left None — we just don't show the column.
    if let Some(git_map) = scan_repo_statuses(&p) {
        for fe in out.iter_mut() {
            let key = canonicalize_soft(&fe.path);
            if let Some(flag) = git_map.get(&key) {
                fe.git = Some(flag.clone());
            }
        }
    }
    out.sort_by(|a, b| match (a.kind == "folder", b.kind == "folder") {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_ascii_lowercase().cmp(&b.name.to_ascii_lowercase()),
    });
    Ok(out)
}

/// Walk `repo.statuses()` once and return a map of absolute-canonicalized
/// paths to a single-char status code. Returns None when we couldn't open
/// a repo at all (treat as "outside-repo; don't annotate").
fn scan_repo_statuses(dir: &Path) -> Option<HashMap<PathBuf, String>> {
    use git2::{Repository, Status, StatusOptions};
    let repo = Repository::discover(dir).ok()?;
    let workdir = repo.workdir()?.to_path_buf();
    let mut opts = StatusOptions::new();
    opts.include_untracked(true)
        .include_ignored(false)
        .recurse_untracked_dirs(false);
    let statuses = repo.statuses(Some(&mut opts)).ok()?;
    let mut out: HashMap<PathBuf, String> = HashMap::new();
    for s in statuses.iter() {
        let rel = match s.path() {
            Some(p) => p,
            None => continue,
        };
        let flags = s.status();
        // Single-char code per task spec. Priority ordering: conflict > add >
        // delete > modify > untracked > ignored. Conflicted entries set
        // Status::CONFLICTED on modern libgit2.
        let code = if flags.contains(Status::CONFLICTED) {
            "U"
        } else if flags.contains(Status::INDEX_NEW) || flags.contains(Status::WT_NEW) {
            // WT_NEW is the "untracked" state; keep untracked separate if
            // nothing is staged.
            if flags.contains(Status::INDEX_NEW) {
                "A"
            } else {
                "?"
            }
        } else if flags.contains(Status::WT_DELETED) || flags.contains(Status::INDEX_DELETED) {
            "D"
        } else if flags.contains(Status::WT_MODIFIED)
            || flags.contains(Status::INDEX_MODIFIED)
            || flags.contains(Status::WT_RENAMED)
            || flags.contains(Status::INDEX_RENAMED)
            || flags.contains(Status::WT_TYPECHANGE)
            || flags.contains(Status::INDEX_TYPECHANGE)
        {
            "M"
            // No IGNORED arm: include_ignored(false) above means ignored
            // entries are never enumerated here.
        } else {
            continue;
        };
        // `rel` can include a trailing slash for untracked directories. Trim
        // it before joining so the resulting PathBuf lines up with the
        // canonicalized FileEntry paths we look up against later.
        let rel_trim = rel.trim_end_matches(['/', '\\']);
        let abs = workdir.join(rel_trim);
        let key = dunce::canonicalize(&abs).unwrap_or(abs);
        out.insert(key, code.to_string());
    }
    Some(out)
}

#[cfg(windows)]
fn is_hidden(_path: &Path, name: &str, meta: &std::fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    const FILE_ATTRIBUTE_HIDDEN: u32 = 0x2;
    const FILE_ATTRIBUTE_SYSTEM: u32 = 0x4;
    if name.starts_with('.') {
        return true;
    }
    let attrs = meta.file_attributes();
    (attrs & (FILE_ATTRIBUTE_HIDDEN | FILE_ATTRIBUTE_SYSTEM)) != 0
}

#[cfg(not(windows))]
fn is_hidden(_path: &Path, name: &str, _meta: &std::fs::Metadata) -> bool {
    name.starts_with('.')
}

#[derive(Debug, Serialize)]
pub struct Drive {
    pub letter: String,
    pub label: String,
    pub total: u64,
    pub free: u64,
    pub fs: String,
}

#[tauri::command]
pub fn drives() -> Vec<Drive> {
    let mut out = Vec::new();
    #[cfg(windows)]
    {
        use windows::core::PCWSTR;
        use windows::Win32::Storage::FileSystem::{
            GetDiskFreeSpaceExW, GetLogicalDrives, GetVolumeInformationW,
        };
        unsafe {
            let mask = GetLogicalDrives();
            for i in 0..26u32 {
                if (mask >> i) & 1 == 0 {
                    continue;
                }
                let letter = (b'A' + i as u8) as char;
                let root = format!("{}:\\", letter);
                let root_w: Vec<u16> = root.encode_utf16().chain(std::iter::once(0)).collect();
                let mut total_bytes = 0u64;
                let mut free_bytes = 0u64;
                let mut avail_bytes = 0u64;
                let ok = GetDiskFreeSpaceExW(
                    PCWSTR(root_w.as_ptr()),
                    Some(&mut avail_bytes),
                    Some(&mut total_bytes),
                    Some(&mut free_bytes),
                )
                .is_ok();
                let mut label_buf = [0u16; 256];
                let mut fs_buf = [0u16; 64];
                let _ = GetVolumeInformationW(
                    PCWSTR(root_w.as_ptr()),
                    Some(&mut label_buf),
                    None,
                    None,
                    None,
                    Some(&mut fs_buf),
                );
                let label = String::from_utf16_lossy(
                    &label_buf[..label_buf.iter().position(|&c| c == 0).unwrap_or(0)],
                );
                let fs = String::from_utf16_lossy(
                    &fs_buf[..fs_buf.iter().position(|&c| c == 0).unwrap_or(0)],
                );
                if ok {
                    out.push(Drive {
                        letter: root,
                        label,
                        total: total_bytes,
                        free: free_bytes,
                        fs,
                    });
                }
            }
        }
    }
    #[cfg(not(windows))]
    {
        // Mounted filesystems stand in for drive letters. sysinfo already
        // filters to real block-device mounts, so no /proc pseudo-fs noise.
        use sysinfo::Disks;
        let disks = Disks::new_with_refreshed_list();
        let mut seen = std::collections::HashSet::new();
        for d in disks.list() {
            let mount = d.mount_point().to_string_lossy().into_owned();
            if !seen.insert(mount.clone()) {
                continue;
            }
            out.push(Drive {
                letter: mount,
                label: d.name().to_string_lossy().into_owned(),
                total: d.total_space(),
                free: d.available_space(),
                fs: d.file_system().to_string_lossy().into_owned(),
            });
        }
        out.sort_by(|a, b| a.letter.cmp(&b.letter));
    }
    out
}

#[derive(Debug, Serialize)]
pub struct WslDistro {
    pub name: String,
    pub path: String,
}

#[tauri::command]
pub fn list_wsl_distros() -> Vec<WslDistro> {
    #[cfg_attr(not(windows), allow(unused_mut))]
    let mut out = Vec::new();
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let mut cmd = std::process::Command::new("wsl.exe");
        cmd.args(["--list", "--quiet"]);
        cmd.creation_flags(CREATE_NO_WINDOW);
        let output = match cmd.output() {
            Ok(o) if o.status.success() => o,
            _ => return out,
        };
        // `wsl.exe --list --quiet` emits UTF-16 LE (no BOM). Decode as u16
        // pairs, stripping NULs that appear as padding between chars.
        let bytes = output.stdout;
        let mut u16s: Vec<u16> = Vec::with_capacity(bytes.len() / 2);
        let mut i = 0;
        while i + 1 < bytes.len() {
            u16s.push(u16::from_le_bytes([bytes[i], bytes[i + 1]]));
            i += 2;
        }
        // Trim optional BOM (0xFEFF).
        let start = if u16s.first() == Some(&0xFEFF) { 1 } else { 0 };
        let decoded = String::from_utf16_lossy(&u16s[start..]);
        // Each non-empty, non-null line is a distro name; trim whitespace +
        // interior NULs (some wsl builds emit trailing NULs).
        for line in decoded.lines() {
            let name = line.trim_matches(|c: char| c == '\0' || c.is_whitespace());
            if name.is_empty() {
                continue;
            }
            let path = format!("\\\\wsl$\\{}\\", name);
            out.push(WslDistro {
                name: name.to_string(),
                path,
            });
        }
    }
    out
}

static SYSINFO: std::sync::OnceLock<std::sync::Mutex<sysinfo::System>> =
    std::sync::OnceLock::new();

#[tauri::command]
pub fn system_info() -> SystemInfo {
    use sysinfo::System;
    // Keep a process-lifetime System instance; System::new_all() is very
    // expensive on Windows (enumerates every process + disk + network), and
    // the StatusBar polls this every 2s. Refresh only CPU + memory per call.
    let cell = SYSINFO.get_or_init(|| std::sync::Mutex::new(System::new()));
    let (cpu_pct, mem_total, mem_used) = match cell.lock() {
        Ok(mut sys) => {
            sys.refresh_cpu_usage();
            sys.refresh_memory();
            (sys.global_cpu_usage(), sys.total_memory(), sys.used_memory())
        }
        Err(_) => (0.0, 0, 0),
    };
    let mem_pct = if mem_total > 0 {
        (mem_used as f32 / mem_total as f32) * 100.0
    } else {
        0.0
    };
    SystemInfo {
        cpu_pct,
        mem_pct,
        mem_used,
        mem_total,
        uptime_s: System::uptime(),
        host: System::host_name().unwrap_or_default(),
    }
}

// ---------- file operations ----------

#[tauri::command]
pub fn make_dir(path: String) -> Result<(), String> {
    std::fs::create_dir_all(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn rename_entry(from: String, to: String) -> Result<(), String> {
    std::fs::rename(&from, &to).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn copy_entry(from: String, to: String) -> Result<(), String> {
    let src = Path::new(&from);
    let dst = Path::new(&to);
    if src.is_dir() {
        copy_dir_recursive(src, dst).map_err(|e| e.to_string())
    } else {
        std::fs::copy(src, dst).map(|_| ()).map_err(|e| e.to_string())
    }
}

fn copy_dir_recursive(src: &Path, dst: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let ty = entry.file_type()?;
        let dst_child = dst.join(entry.file_name());
        if ty.is_dir() {
            copy_dir_recursive(&entry.path(), &dst_child)?;
        } else {
            std::fs::copy(entry.path(), &dst_child)?;
        }
    }
    Ok(())
}

#[tauri::command]
pub fn move_entry(from: String, to: String) -> Result<(), String> {
    // Try rename first (fast path for same volume). Fall back to copy+delete;
    // the delete must be recursive or a cross-volume directory move leaves
    // the source behind (remove_dir fails on non-empty) after a full copy.
    if std::fs::rename(&from, &to).is_ok() {
        return Ok(());
    }
    copy_entry(from.clone(), to)?;
    delete_entry(from, true)
}

#[tauri::command]
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
#[tauri::command]
pub fn move_to_trash(path: String) -> Result<(), String> {
    trash::delete(&path).map_err(|e| format!("move_to_trash({}): {}", path, e))
}

#[tauri::command]
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

#[tauri::command]
pub fn write_text(path: String, content: String) -> Result<(), String> {
    std::fs::write(&path, content).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn read_image_b64(path: String, max_bytes: usize) -> Result<String, String> {
    use base64::{engine::general_purpose::STANDARD, Engine as _};
    let cap = if max_bytes == 0 { 8 * 1024 * 1024 } else { max_bytes };
    let meta = std::fs::metadata(&path).map_err(|e| e.to_string())?;
    if meta.len() > cap as u64 {
        return Err(format!("image too large: {} bytes (cap {})", meta.len(), cap));
    }
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
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
        _ => "application/octet-stream",
    };
    Ok(format!("data:{};base64,{}", mime, STANDARD.encode(&bytes)))
}

// ---------- git status ----------

#[derive(Debug, Serialize)]
pub struct GitInfo {
    pub repo_root: String,
    pub branch: String,
    pub ahead: usize,
    pub behind: usize,
    pub dirty: usize,
    pub status: std::collections::HashMap<String, String>, // path -> flag: mod|add|del|untracked|renamed
}

#[tauri::command]
pub fn git_status(path: String) -> Option<GitInfo> {
    use git2::{Repository, Status, StatusOptions};
    let repo = Repository::discover(&path).ok()?;
    let root = repo.workdir()?.to_string_lossy().to_string();
    let head = repo.head().ok();
    let branch = head
        .as_ref()
        .and_then(|h| h.shorthand().map(|s| s.to_string()))
        .unwrap_or_else(|| "(detached)".to_string());

    // ahead/behind vs upstream
    let (mut ahead, mut behind) = (0usize, 0usize);
    if let Some(h) = &head {
        let head_name = h.name().unwrap_or("").to_string();
        if let (Some(local), Ok(upstream_buf)) = (h.target(), repo.branch_upstream_name(&head_name))
        {
            if let Some(upstream_refname) = upstream_buf.as_str() {
                if let Ok(upstream_oid) = repo.refname_to_id(upstream_refname) {
                    if let Ok((a, b)) = repo.graph_ahead_behind(local, upstream_oid) {
                        ahead = a;
                        behind = b;
                    }
                }
            }
        }
    }

    let mut opts = StatusOptions::new();
    opts.include_untracked(true).recurse_untracked_dirs(false);
    let mut status_map = std::collections::HashMap::new();
    let mut dirty: usize = 0;
    if let Ok(statuses) = repo.statuses(Some(&mut opts)) {
        for s in statuses.iter() {
            let p = match s.path() {
                Some(p) => p.to_string(),
                None => continue,
            };
            let flags = s.status();
            let flag = if flags.contains(Status::WT_NEW) || flags.contains(Status::INDEX_NEW) {
                "add"
            } else if flags.contains(Status::WT_DELETED) || flags.contains(Status::INDEX_DELETED) {
                "del"
            } else if flags.contains(Status::WT_MODIFIED) || flags.contains(Status::INDEX_MODIFIED) {
                "mod"
            } else if flags.contains(Status::WT_RENAMED) || flags.contains(Status::INDEX_RENAMED) {
                "renamed"
            } else if flags.contains(Status::IGNORED) {
                "ignored"
            } else {
                "untracked"
            };
            if flag != "ignored" {
                dirty += 1;
            }
            status_map.insert(p, flag.to_string());
        }
    }
    Some(GitInfo {
        repo_root: root,
        branch,
        ahead,
        behind,
        dirty,
        status: status_map,
    })
}

// ---------- open / reveal ----------

/// Reap a spawned helper in the background. `drop(Child)` never waits, so on
/// Unix every exited helper (xdg-open, terminals, editors) would linger as a
/// zombie for the app's lifetime; a parked wait thread reaps it on exit.
fn reap(mut child: std::process::Child) {
    std::thread::spawn(move || {
        let _ = child.wait();
    });
}

#[tauri::command]
pub fn open_with_default(path: String) -> Result<(), String> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        std::process::Command::new("cmd")
            .args(["/C", "start", "", &path])
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map(reap)
            .map_err(|e| e.to_string())
    }
    #[cfg(not(windows))]
    {
        std::process::Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map(reap)
            .map_err(|e| e.to_string())
    }
}

#[tauri::command]
pub fn reveal_in_explorer(path: String) -> Result<(), String> {
    #[cfg(windows)]
    {
        std::process::Command::new("explorer.exe")
            .arg("/select,")
            .arg(&path)
            .spawn()
            .map(reap)
            .map_err(|e| e.to_string())
    }
    #[cfg(not(windows))]
    {
        // "Reveal" = show in containing folder. No portable selection API,
        // so open the parent in the default file manager.
        let p = std::path::Path::new(&path);
        let target = p.parent().filter(|d| !d.as_os_str().is_empty()).unwrap_or(p);
        std::process::Command::new("xdg-open")
            .arg(target)
            .spawn()
            .map(reap)
            .map_err(|e| e.to_string())
    }
}

// ---------- spawn external apps ----------

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

/// Build a command that opens a visible terminal emulator, optionally running
/// `run` inside it. Probes $TERMINAL first, then common emulators; per-emulator
/// flags for cwd and command execution since there is no cross-terminal standard.
#[cfg(not(windows))]
fn linux_terminal_command(
    cwd: &str,
    run: Option<(&str, &[String])>,
) -> Result<std::process::Command, String> {
    let mut candidates: Vec<String> = Vec::new();
    if let Ok(t) = std::env::var("TERMINAL") {
        if !t.trim().is_empty() {
            candidates.push(t);
        }
    }
    for c in [
        "kitty",
        "alacritty",
        "foot",
        "wezterm",
        "konsole",
        "gnome-terminal",
        "xfce4-terminal",
        "x-terminal-emulator",
        "xterm",
    ] {
        candidates.push(c.to_string());
    }
    let term = candidates
        .into_iter()
        .find(|c| which::which(c).is_ok())
        .ok_or_else(|| "no terminal emulator found — set $TERMINAL".to_string())?;
    let name = std::path::Path::new(&term)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or(term.as_str())
        .to_string();

    let mut cmd = std::process::Command::new(&term);
    if !cwd.is_empty() {
        cmd.current_dir(cwd);
        match name.as_str() {
            "kitty" => {
                cmd.args(["--directory", cwd]);
            }
            "alacritty" | "foot" => {
                cmd.args(["--working-directory", cwd]);
            }
            "konsole" => {
                cmd.args(["--workdir", cwd]);
            }
            "gnome-terminal" | "xfce4-terminal" => {
                cmd.arg(format!("--working-directory={}", cwd));
            }
            // wezterm gets --cwd below; the rest inherit the process cwd.
            _ => {}
        }
    }
    match (name.as_str(), run) {
        ("wezterm", run) => {
            cmd.arg("start");
            if !cwd.is_empty() {
                cmd.args(["--cwd", cwd]);
            }
            if let Some((prog, args)) = run {
                cmd.arg("--").arg(prog).args(args);
            }
        }
        (_, None) => {}
        ("kitty" | "foot", Some((prog, args))) => {
            cmd.arg(prog).args(args);
        }
        ("gnome-terminal", Some((prog, args))) => {
            cmd.arg("--").arg(prog).args(args);
        }
        ("xfce4-terminal", Some((prog, args))) => {
            cmd.arg("-x").arg(prog).args(args);
        }
        (_, Some((prog, args))) => {
            cmd.arg("-e").arg(prog).args(args);
        }
    }
    Ok(cmd)
}

/// Open a terminal window at `path`. Prefers Windows Terminal, then pwsh, then powershell.
#[tauri::command]
pub fn spawn_terminal(path: String) -> Result<(), String> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        use std::process::{Command, Stdio};

        // 1) Windows Terminal — spawns its own visible window, no creation_flags.
        if which::which("wt.exe").is_ok() || which::which("wt").is_ok() {
            let child = Command::new("wt.exe")
                .args(["-d", &path])
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn();
            match child {
                Ok(c) => {
                    reap(c);
                    return Ok(());
                }
                Err(e) => {
                    // fall through to pwsh/powershell
                    eprintln!("wt.exe spawn failed: {}, falling back", e);
                }
            }
        }

        // 2) pwsh.exe (PowerShell 7+) — needs a visible console since it has no
        //    window chrome of its own. Use `cmd /C start` to give it a console.
        if which::which("pwsh.exe").is_ok() || which::which("pwsh").is_ok() {
            let child = Command::new("cmd")
                .args(["/C", "start", "", "pwsh.exe", "-NoExit", "-WorkingDirectory", &path])
                .creation_flags(CREATE_NO_WINDOW)
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn();
            match child {
                Ok(c) => {
                    reap(c);
                    return Ok(());
                }
                Err(e) => {
                    eprintln!("pwsh.exe spawn failed: {}, falling back", e);
                }
            }
        }

        // 3) powershell.exe — always present on Windows.
        let child = Command::new("cmd")
            .args([
                "/C",
                "start",
                "",
                "powershell.exe",
                "-NoExit",
                "-WorkingDirectory",
                &path,
            ])
            .creation_flags(CREATE_NO_WINDOW)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| format!("powershell.exe spawn failed: {}", e))?;
        reap(child);
        Ok(())
    }
    #[cfg(not(windows))]
    {
        use std::process::Stdio;
        let mut cmd = linux_terminal_command(&path, None)?;
        let child = cmd
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| e.to_string())?;
        reap(child);
        Ok(())
    }
}

/// Open VS Code at `path` (file or folder).
#[tauri::command]
pub fn spawn_vscode(path: String) -> Result<(), String> {
    use std::process::{Command, Stdio};

    // Resolve a code launcher: try code.cmd, code.exe, then bare `code`.
    let resolved = which::which("code.cmd")
        .or_else(|_| which::which("code.exe"))
        .or_else(|_| which::which("code"));

    let program: std::ffi::OsString = match resolved {
        Ok(p) => p.into_os_string(),
        Err(_) => std::ffi::OsString::from("code"),
    };

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // `code.cmd` is a batch file; spawning it via cmd /C ensures it runs
        // correctly regardless of extension, and CREATE_NO_WINDOW hides the
        // transient launcher console.
        let program_str = program.to_string_lossy().to_string();
        let child = Command::new("cmd")
            .args(["/C", &program_str, &path])
            .creation_flags(CREATE_NO_WINDOW)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| format!("spawn code: {}", e))?;
        reap(child);
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let child = Command::new(&program)
            .arg(&path)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| format!("spawn code: {}", e))?;
        reap(child);
        Ok(())
    }
}

// ---------- WSL path translation ----------

#[tauri::command]
pub fn win_to_wsl(path: String) -> String {
    // C:\Users\me -> /mnt/c/Users/me
    let p = path.replace('\\', "/");
    if let Some((drive_letter, rest)) = p.split_once(':') {
        if drive_letter.len() == 1 {
            return format!("/mnt/{}{}", drive_letter.to_ascii_lowercase(), rest);
        }
    }
    p
}

#[tauri::command]
pub fn wsl_to_win(path: String) -> String {
    // /mnt/c/Users/me -> C:\Users\me
    if let Some(rest) = path.strip_prefix("/mnt/") {
        if let Some((letter, tail)) = rest.split_once('/') {
            if letter.len() == 1 {
                let mut s = format!("{}:\\", letter.to_ascii_uppercase());
                s.push_str(&tail.replace('/', "\\"));
                return s;
            }
        }
    }
    path.replace('/', "\\")
}

// ---------- pins / tags persistence ----------

fn config_file(app: &AppHandle, name: &str) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("app_config_dir: {}", e))?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("mkdir {}: {}", dir.display(), e))?;
    Ok(dir.join(name))
}

/// Write a config file via temp-file + rename so a crash mid-write can't
/// truncate existing state (fs::write truncates before writing).
fn write_config_atomic(path: &Path, body: &str) -> Result<(), String> {
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, body).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn read_pins(app: AppHandle) -> Result<Vec<String>, String> {
    let path = config_file(&app, "pins.json")?;
    match std::fs::read_to_string(&path) {
        Ok(s) => serde_json::from_str::<Vec<String>>(&s).map_err(|e| e.to_string()),
        Err(ref e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn write_pins(app: AppHandle, pins: Vec<String>) -> Result<(), String> {
    let path = config_file(&app, "pins.json")?;
    let body = serde_json::to_string(&pins).map_err(|e| e.to_string())?;
    write_config_atomic(&path, &body)
}

#[tauri::command]
pub fn read_tags(app: AppHandle) -> Result<HashMap<String, Vec<String>>, String> {
    let path = config_file(&app, "tags.json")?;
    match std::fs::read_to_string(&path) {
        Ok(s) => serde_json::from_str::<HashMap<String, Vec<String>>>(&s).map_err(|e| e.to_string()),
        Err(ref e) if e.kind() == std::io::ErrorKind::NotFound => Ok(HashMap::new()),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn write_tags(app: AppHandle, tags: HashMap<String, Vec<String>>) -> Result<(), String> {
    let path = config_file(&app, "tags.json")?;
    let body = serde_json::to_string(&tags).map_err(|e| e.to_string())?;
    write_config_atomic(&path, &body)
}

// ---------- git blame ----------

#[derive(Debug, Serialize)]
pub struct BlameLine {
    pub line_no: u32,
    pub sha: String,
    pub author: String,
    pub content: String,
    pub timestamp_ms: i64,
}

const BLAME_MAX_CAP: u32 = 2000;

#[tauri::command]
pub fn git_blame(path: String, max_lines: u32) -> Result<Vec<BlameLine>, String> {
    use git2::{BlameOptions, Repository};
    let abs = canonicalize_soft(&path);
    let repo = Repository::discover(&abs).map_err(|e| format!("not a git repo: {}", e))?;
    let workdir = repo
        .workdir()
        .ok_or_else(|| "bare repo has no workdir".to_string())?
        .to_path_buf();
    let rel = abs
        .strip_prefix(&workdir)
        .map_err(|_| format!("{} is not inside repo {}", abs.display(), workdir.display()))?
        .to_path_buf();

    let mut opts = BlameOptions::new();
    opts.track_copies_same_file(true);
    let blame = repo
        .blame_file(&rel, Some(&mut opts))
        .map_err(|e| format!("blame_file: {}", e))?;

    // Pull the file text to attach content per line. Keep this bounded.
    let raw = std::fs::read(&abs).map_err(|e| format!("read {}: {}", abs.display(), e))?;
    // Simple binary check: any NUL in the first 8K means binary.
    let probe_end = raw.len().min(8192);
    if raw[..probe_end].contains(&0u8) {
        return Err("file appears to be binary".to_string());
    }
    let text = String::from_utf8_lossy(&raw);
    let lines: Vec<&str> = text.split('\n').collect();

    let cap = max_lines.clamp(1, BLAME_MAX_CAP) as usize;
    let mut out: Vec<BlameLine> = Vec::new();

    for hunk in blame.iter() {
        let start = hunk.final_start_line(); // 1-based
        let count = hunk.lines_in_hunk();
        let sha_full = hunk.final_commit_id().to_string();
        let sha = sha_full.chars().take(8).collect::<String>();
        let sig = hunk.final_signature();
        let author = sig
            .name()
            .map(|s| s.to_string())
            .unwrap_or_else(|| "?".to_string());
        let timestamp_ms = sig.when().seconds() * 1000;
        for i in 0..count {
            let line_no = (start + i) as u32;
            let content = lines
                .get((start - 1) + i)
                .map(|s| s.to_string())
                .unwrap_or_default();
            out.push(BlameLine {
                line_no,
                sha: sha.clone(),
                author: author.clone(),
                content,
                timestamp_ms,
            });
            if out.len() >= cap {
                return Ok(out);
            }
        }
    }
    Ok(out)
}

// ---------- git per-row actions (stage / unstage / discard) ----------

fn open_repo_and_relpaths(
    paths: &[String],
) -> Result<(git2::Repository, Vec<PathBuf>), String> {
    use git2::Repository;
    if paths.is_empty() {
        return Err("no paths".to_string());
    }
    let first = canonicalize_soft(&paths[0]);
    let repo = Repository::discover(&first).map_err(|e| format!("not a git repo: {}", e))?;
    let workdir = repo
        .workdir()
        .ok_or_else(|| "bare repo has no workdir".to_string())?
        .to_path_buf();
    let mut rels = Vec::with_capacity(paths.len());
    for p in paths {
        let abs = canonicalize_soft(p);
        let rel = abs
            .strip_prefix(&workdir)
            .map_err(|_| format!("{} is not inside repo {}", abs.display(), workdir.display()))?
            .to_path_buf();
        rels.push(rel);
    }
    Ok((repo, rels))
}

#[tauri::command]
pub fn git_stage(paths: Vec<String>) -> Result<(), String> {
    let (repo, rels) = open_repo_and_relpaths(&paths)?;
    let workdir = repo.workdir().unwrap().to_path_buf();
    let mut index = repo.index().map_err(|e| e.to_string())?;
    for rel in &rels {
        let abs = workdir.join(rel);
        if abs.exists() {
            index.add_path(rel).map_err(|e| format!("add_path {}: {}", rel.display(), e))?;
        } else {
            // File was deleted on disk — stage the removal.
            index
                .remove_path(rel)
                .map_err(|e| format!("remove_path {}: {}", rel.display(), e))?;
        }
    }
    index.write().map_err(|e| format!("index.write: {}", e))?;
    Ok(())
}

#[tauri::command]
pub fn git_unstage(paths: Vec<String>) -> Result<(), String> {
    let (repo, rels) = open_repo_and_relpaths(&paths)?;
    // Equivalent of `git reset HEAD -- path`: reset the index entries for
    // these paths to match HEAD. If there is no HEAD yet (fresh repo with no
    // commits), fall back to removing the entries from the index instead.
    match repo.head().and_then(|h| h.peel_to_commit()) {
        Ok(commit) => {
            let rel_refs: Vec<&Path> = rels.iter().map(|p| p.as_path()).collect();
            repo.reset_default(Some(commit.as_object()), rel_refs.iter())
                .map_err(|e| format!("reset_default: {}", e))?;
        }
        Err(_) => {
            let mut index = repo.index().map_err(|e| e.to_string())?;
            for rel in &rels {
                let _ = index.remove_path(rel);
            }
            index.write().map_err(|e| format!("index.write: {}", e))?;
        }
    }
    Ok(())
}

#[tauri::command]
pub fn git_discard(paths: Vec<String>) -> Result<(), String> {
    use git2::build::CheckoutBuilder;
    let (repo, rels) = open_repo_and_relpaths(&paths)?;
    let workdir = repo.workdir().unwrap().to_path_buf();

    // Partition: untracked files (no index entry, no HEAD entry) get deleted;
    // everything else gets `checkout HEAD -- path` treatment.
    let index = repo.index().map_err(|e| e.to_string())?;
    let head_tree = repo.head().and_then(|h| h.peel_to_tree()).ok();

    let mut tracked_rels: Vec<&Path> = Vec::new();
    let mut to_delete: Vec<PathBuf> = Vec::new();
    for rel in &rels {
        let in_index = index.get_path(rel, 0).is_some();
        let in_head = head_tree
            .as_ref()
            .and_then(|t| t.get_path(rel).ok())
            .is_some();
        if !in_index && !in_head {
            to_delete.push(workdir.join(rel));
        } else {
            tracked_rels.push(rel.as_path());
        }
    }

    if !tracked_rels.is_empty() {
        let mut opts = CheckoutBuilder::new();
        opts.force();
        for p in &tracked_rels {
            opts.path(p);
        }
        repo.checkout_head(Some(&mut opts))
            .map_err(|e| format!("checkout_head: {}", e))?;
    }

    for abs in to_delete {
        let meta = match std::fs::symlink_metadata(&abs) {
            Ok(m) => m,
            Err(_) => continue,
        };
        if meta.is_dir() {
            std::fs::remove_dir_all(&abs)
                .map_err(|e| format!("remove_dir_all {}: {}", abs.display(), e))?;
        } else {
            std::fs::remove_file(&abs)
                .map_err(|e| format!("remove_file {}: {}", abs.display(), e))?;
        }
    }
    Ok(())
}

// ---------- find in files (ripgrep-style content search) ----------

#[derive(Debug, Serialize, Clone)]
pub struct FindMatch {
    pub path: String,
    pub line_no: u32,
    pub line: String,
}

const FIND_MAX_FILE_BYTES: u64 = 1 << 20; // 1 MiB per task spec
const FIND_HARD_CAP: u32 = 10_000;

#[tauri::command]
pub fn find_in_files(
    root: String,
    query: String,
    case_insensitive: bool,
    max_results: u32,
) -> Result<Vec<FindMatch>, String> {
    use grep_regex::RegexMatcherBuilder;
    use grep_searcher::{BinaryDetection, Searcher, SearcherBuilder, Sink, SinkMatch};
    use ignore::WalkBuilder;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::{Arc, Mutex};

    if query.is_empty() {
        return Ok(Vec::new());
    }
    let cap = if max_results == 0 {
        500
    } else {
        max_results.min(FIND_HARD_CAP)
    } as usize;

    let pattern = regex::escape(&query);
    let matcher = RegexMatcherBuilder::new()
        .case_insensitive(case_insensitive)
        .build(&pattern)
        .map_err(|e| format!("regex build: {}", e))?;

    let results: Arc<Mutex<Vec<FindMatch>>> = Arc::new(Mutex::new(Vec::new()));
    let done = Arc::new(AtomicBool::new(false));

    let walker = WalkBuilder::new(&root).standard_filters(true).build_parallel();

    walker.run(|| {
        let results = Arc::clone(&results);
        let done = Arc::clone(&done);
        let matcher = matcher.clone();
        Box::new(move |entry| {
            use ignore::WalkState;
            if done.load(Ordering::Relaxed) {
                return WalkState::Quit;
            }
            let entry = match entry {
                Ok(e) => e,
                Err(_) => return WalkState::Continue,
            };
            // Only search regular files.
            let is_file = entry.file_type().map(|ft| ft.is_file()).unwrap_or(false);
            if !is_file {
                return WalkState::Continue;
            }
            // Skip files > 1 MiB.
            if let Ok(meta) = entry.metadata() {
                if meta.len() > FIND_MAX_FILE_BYTES {
                    return WalkState::Continue;
                }
            }
            let path = entry.path().to_path_buf();

            struct CollectSink<'a> {
                path: String,
                out: &'a Arc<Mutex<Vec<FindMatch>>>,
                cap: usize,
                done: &'a Arc<AtomicBool>,
            }
            impl<'a> Sink for CollectSink<'a> {
                type Error = std::io::Error;
                fn matched(
                    &mut self,
                    _searcher: &Searcher,
                    mat: &SinkMatch<'_>,
                ) -> Result<bool, Self::Error> {
                    let line_no = mat.line_number().unwrap_or(0) as u32;
                    let bytes = mat.bytes();
                    let line = String::from_utf8_lossy(bytes)
                        .trim_end_matches(['\n', '\r'])
                        .to_string();
                    let mut guard = match self.out.lock() {
                        Ok(g) => g,
                        Err(p) => p.into_inner(),
                    };
                    if guard.len() >= self.cap {
                        self.done.store(true, Ordering::Relaxed);
                        return Ok(false);
                    }
                    guard.push(FindMatch {
                        path: self.path.clone(),
                        line_no,
                        line,
                    });
                    if guard.len() >= self.cap {
                        self.done.store(true, Ordering::Relaxed);
                        return Ok(false);
                    }
                    Ok(true)
                }
            }

            let mut searcher = SearcherBuilder::new()
                .binary_detection(BinaryDetection::quit(b'\x00'))
                .line_number(true)
                .build();
            let sink = CollectSink {
                path: path.to_string_lossy().to_string(),
                out: &results,
                cap,
                done: &done,
            };
            let _ = searcher.search_path(&matcher, &path, sink);

            if done.load(Ordering::Relaxed) {
                WalkState::Quit
            } else {
                WalkState::Continue
            }
        })
    });

    let mut out = match Arc::try_unwrap(results) {
        Ok(m) => m.into_inner().unwrap_or_default(),
        Err(arc) => {
            let guard = arc.lock().map_err(|e| e.to_string())?;
            guard.clone()
        }
    };
    if out.len() > cap {
        out.truncate(cap);
    }
    Ok(out)
}

// ---------- compress (zip) ----------

/// Create a ZIP archive at `output` containing every path in `paths`. Files
/// are added at their basename; directories are walked recursively and their
/// children stored with paths rooted at the directory's basename so the
/// archive keeps a recognisable structure.
#[tauri::command]
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

/// Return whether the local machine has the tooling required to handle the
/// given archive format. Values: "zip" | "tar.gz" | "tar.zst" | "7z".
#[tauri::command]
pub fn archive_can_handle(format: String) -> bool {
    match format.as_str() {
        "zip" => true, // in-process zip crate
        "tar.gz" => which::which("tar").is_ok() || which::which("tar.exe").is_ok(),
        // tar alone suffices: bsdtar handles --zstd natively, and the extract
        // path falls back to a separate zstd binary only when tar lacks it.
        "tar.zst" => which::which("tar").is_ok() || which::which("tar.exe").is_ok(),
        "7z" => which::which("7z").is_ok() || which::which("7z.exe").is_ok(),
        _ => false,
    }
}

/// Create an archive at `dest` containing `paths`. Format is one of
/// "zip" | "tar.gz" | "tar.zst" | "7z". Relative entries are archived using
/// each input's basename (`tar -C <parent> <basename>`) so the resulting
/// archive mirrors the structure produced by the existing zip path.
#[tauri::command]
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
            let mut args: Vec<&str> = vec!["-czf", &dest, "-C", &parent_str];
            for m in &members {
                args.push(m);
            }
            run_archive_tool("tar", &args)
        }
        "tar.zst" => {
            // Prefer bsdtar's native --zstd. tar.exe on Windows 10+ is
            // bsdtar and supports it.
            let mut args: Vec<&str> = vec!["--zstd", "-cf", &dest, "-C", &parent_str];
            for m in &members {
                args.push(m);
            }
            run_archive_tool("tar", &args)
        }
        "7z" => {
            let program = if which::which("7z").is_ok() {
                "7z"
            } else if which::which("7z.exe").is_ok() {
                "7z.exe"
            } else {
                return Err("7z.exe not found on PATH".to_string());
            };
            // 7z a <dest> <members...>; cd into parent first by using -w
            // (working dir) is not supported, so pass absolute paths instead.
            let mut args: Vec<&str> = vec!["a", "-y", &dest];
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
            run_archive_tool(program, &args)
        }
        other => Err(format!("archive_create: unsupported format '{}'", other)),
    }
}

/// Extract `archive` into `dest_dir`, which must already exist or will be
/// created. Dispatches on extension:
///   .zip/.tar/.tar.gz/.tgz/.tar.bz2/.tar.zst → `tar -xf ...`
///   .7z → `7z.exe x archive -o<dest_dir> -y`
#[tauri::command]
pub fn archive_extract(archive: String, dest_dir: String) -> Result<(), String> {
    // Ensure destination exists.
    if let Err(e) = std::fs::create_dir_all(&dest_dir) {
        return Err(format!("create_dir_all {}: {}", dest_dir, e));
    }

    let lower = archive.to_ascii_lowercase();
    let is_7z = lower.ends_with(".7z");
    let is_tar_zst = lower.ends_with(".tar.zst") || lower.ends_with(".tzst");
    let is_tar_family = lower.ends_with(".zip")
        || lower.ends_with(".tar")
        || lower.ends_with(".tar.gz")
        || lower.ends_with(".tgz")
        || lower.ends_with(".tar.bz2")
        || lower.ends_with(".tbz2")
        || lower.ends_with(".tar.xz")
        || lower.ends_with(".txz")
        || is_tar_zst;

    if is_7z {
        let program = if which::which("7z").is_ok() {
            "7z"
        } else if which::which("7z.exe").is_ok() {
            "7z.exe"
        } else {
            return Err("7z.exe not found on PATH".to_string());
        };
        let out_flag = format!("-o{}", dest_dir);
        let args = ["x", &archive, &out_flag, "-y"];
        return run_archive_tool(program, &args);
    }

    if is_tar_family {
        if which::which("tar").is_err() && which::which("tar.exe").is_err() {
            return Err("tar.exe not found on PATH".to_string());
        }
        let mut args: Vec<&str> = Vec::new();
        if is_tar_zst {
            args.push("--zstd");
        }
        args.push("-xf");
        args.push(&archive);
        args.push("-C");
        args.push(&dest_dir);
        return run_archive_tool("tar", &args);
    }

    Err(format!(
        "archive_extract: unsupported archive extension for '{}'",
        archive
    ))
}

// ---------- sha256 hash ----------

/// Stream the file at `path` in 64 KB chunks and return the lowercase hex
/// SHA-256 digest.
#[tauri::command]
pub fn hash_sha256(path: String) -> Result<String, String> {
    use sha2::{Digest, Sha256};
    use std::io::Read;

    let mut f = std::fs::File::open(&path).map_err(|e| format!("open {}: {}", path, e))?;
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 64 * 1024];
    loop {
        let n = f.read(&mut buf).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    let digest = hasher.finalize();
    let mut hex = String::with_capacity(digest.len() * 2);
    for byte in digest {
        use std::fmt::Write;
        let _ = write!(&mut hex, "{:02x}", byte);
    }
    Ok(hex)
}

// ---------- permissions (chmod) ----------

/// Set permissions on `path`. On unix this applies `mode` directly via
/// `PermissionsExt::from_mode`. On windows it only toggles the read-only
/// attribute based on the owner-write bit (`mode & 0o200`); richer ACL
/// manipulation is out of scope for v1.
#[tauri::command]
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

// ---------- hex dump ----------

/// Read up to `length` bytes starting at `offset` from `path` and return a
/// human-readable hex dump (16 bytes/row, offset + hex + ascii). `length` is
/// capped at 64 KiB; `0` becomes the default of 4096 bytes.
#[tauri::command]
pub fn read_hex_dump(path: String, offset: u64, length: usize) -> Result<String, String> {
    use std::fmt::Write as FmtWrite;
    use std::io::{Read, Seek, SeekFrom};

    let cap = if length == 0 { 4096 } else { length.min(64 * 1024) };
    let mut f = std::fs::File::open(&path).map_err(|e| format!("open {}: {}", path, e))?;
    f.seek(SeekFrom::Start(offset))
        .map_err(|e| format!("seek {}: {}", path, e))?;
    let mut buf = Vec::with_capacity(cap);
    f.take(cap as u64)
        .read_to_end(&mut buf)
        .map_err(|e| format!("read {}: {}", path, e))?;

    let mut out = String::with_capacity(buf.len() * 4);
    for (i, chunk) in buf.chunks(16).enumerate() {
        let row_off = offset + (i as u64) * 16;
        let _ = write!(&mut out, "{:08x}  ", row_off);
        for (j, b) in chunk.iter().enumerate() {
            if j > 0 {
                out.push(' ');
            }
            let _ = write!(&mut out, "{:02x}", b);
        }
        // Pad short final row so ascii column aligns.
        if chunk.len() < 16 {
            for j in chunk.len()..16 {
                if j > 0 {
                    out.push(' ');
                }
                out.push_str("  ");
            }
        }
        out.push_str("  |");
        for b in chunk {
            let c = *b;
            if (0x20..=0x7e).contains(&c) {
                out.push(c as char);
            } else {
                out.push('.');
            }
        }
        out.push_str("|\n");
    }
    Ok(out)
}

// ---------- diff ----------

/// Return a unified diff between two utf-8 text files. Errors with
/// "binary or non-utf8" if either file cannot be decoded. An empty diff
/// (identical content) returns an empty string.
#[tauri::command]
pub fn diff_files(a: String, b: String) -> Result<String, String> {
    let a_bytes = std::fs::read(&a).map_err(|e| format!("read {}: {}", a, e))?;
    let b_bytes = std::fs::read(&b).map_err(|e| format!("read {}: {}", b, e))?;
    let a_text = std::str::from_utf8(&a_bytes)
        .map_err(|_| "binary or non-utf8".to_string())?;
    let b_text = std::str::from_utf8(&b_bytes)
        .map_err(|_| "binary or non-utf8".to_string())?;

    let a_name = Path::new(&a)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or(&a);
    let b_name = Path::new(&b)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or(&b);

    let diff = similar::TextDiff::from_lines(a_text, b_text);
    Ok(diff.unified_diff().header(a_name, b_name).to_string())
}

// ---------- find file by name ----------

/// Walk `root` recursively via ignore::WalkBuilder honoring .gitignore/hidden,
/// and return up to `max_results` paths whose filename contains `pattern`
/// (case-insensitive substring match). Empty pattern → empty result.
#[tauri::command]
pub fn find_file_by_name(
    root: String,
    pattern: String,
    max_results: u32,
) -> Result<Vec<String>, String> {
    use ignore::WalkBuilder;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::{Arc, Mutex};

    if pattern.is_empty() {
        return Ok(Vec::new());
    }
    let cap = if max_results == 0 { 500 } else { max_results.min(10_000) } as usize;
    let needle = pattern.to_ascii_lowercase();

    let results: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
    let done = Arc::new(AtomicBool::new(false));

    let walker = WalkBuilder::new(&root).standard_filters(true).build_parallel();
    walker.run(|| {
        let results = Arc::clone(&results);
        let done = Arc::clone(&done);
        let needle = needle.clone();
        Box::new(move |entry| {
            use ignore::WalkState;
            if done.load(Ordering::Relaxed) {
                return WalkState::Quit;
            }
            let entry = match entry {
                Ok(e) => e,
                Err(_) => return WalkState::Continue,
            };
            let name = entry.file_name().to_string_lossy().to_ascii_lowercase();
            if !name.contains(&needle) {
                return WalkState::Continue;
            }
            let path_str = entry.path().to_string_lossy().to_string();
            let mut guard = match results.lock() {
                Ok(g) => g,
                Err(_) => return WalkState::Continue,
            };
            if guard.len() >= cap {
                done.store(true, Ordering::Relaxed);
                return WalkState::Quit;
            }
            guard.push(path_str);
            if guard.len() >= cap {
                done.store(true, Ordering::Relaxed);
                return WalkState::Quit;
            }
            WalkState::Continue
        })
    });

    let out = Arc::try_unwrap(results)
        .map(|m| m.into_inner().unwrap_or_default())
        .unwrap_or_else(|arc| arc.lock().map(|g| g.clone()).unwrap_or_default());
    Ok(out)
}

// ---------- symlink / hard link ----------

/// Create a symbolic link at `link_path` pointing at `target`. On windows,
/// chooses symlink_dir when the target is an existing directory, else
/// symlink_file. Requires developer mode or admin on pre-1703 Windows.
#[tauri::command]
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
#[tauri::command]
pub fn create_hard_link(target: String, link_path: String) -> Result<(), String> {
    std::fs::hard_link(&target, &link_path)
        .map_err(|e| format!("hard_link {} -> {}: {}", link_path, target, e))
}

// ---------- create shortcut (.lnk) ----------

/// Create a Windows .lnk shortcut at `link_path` pointing at `target`. Shells
/// out to PowerShell's WScript.Shell COM object — no extra Cargo deps. Errors
/// when `link_path` does not end in `.lnk`, or on non-Windows platforms.
#[tauri::command]
pub fn create_shortcut(target: String, link_path: String) -> Result<(), String> {
    if !link_path.to_ascii_lowercase().ends_with(".lnk") {
        return Err("link path must end with .lnk".into());
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        use std::process::Command;

        let script = format!(
            "$s = (New-Object -ComObject WScript.Shell).CreateShortcut('{}'); $s.TargetPath='{}'; $s.Save()",
            link_path.replace('\'', "''"),
            target.replace('\'', "''"),
        );
        let out = Command::new("powershell.exe")
            .args(["-NoProfile", "-NonInteractive", "-Command", &script])
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
/// delete it. Files only; rejects directories. `passes` is clamped to 1..=10.
#[tauri::command]
pub fn shred(path: String, passes: u32) -> Result<(), String> {
    use std::fs::OpenOptions;
    use std::io::{Seek, SeekFrom, Write};

    let meta = std::fs::metadata(&path).map_err(|e| format!("stat {}: {}", path, e))?;
    if meta.is_dir() {
        return Err(format!("shred: {} is a directory", path));
    }
    let len = meta.len();
    let n = passes.clamp(1, 10);
    let patterns: [u8; 3] = [0xFF, 0x00, 0xAA];

    let mut f = OpenOptions::new()
        .write(true)
        .open(&path)
        .map_err(|e| format!("open {}: {}", path, e))?;

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

// ---------- verify signature ----------

/// Verify the Authenticode signature on `path`. Returns "valid", "invalid",
/// or "unsigned". Windows only; shells out to PowerShell Get-AuthenticodeSignature
/// to avoid hand-rolling WinVerifyTrust bindings.
#[tauri::command]
pub fn verify_signature(path: String) -> Result<String, String> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        use std::process::Command;

        let script = format!(
            "(Get-AuthenticodeSignature -FilePath '{}').Status",
            path.replace('\'', "''")
        );
        let out = Command::new("powershell.exe")
            .args(["-NoProfile", "-NonInteractive", "-Command", &script])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .map_err(|e| format!("powershell: {}", e))?;
        if !out.status.success() {
            let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
            return Err(format!("verify_signature: {}", stderr));
        }
        let status = String::from_utf8_lossy(&out.stdout).trim().to_string();
        let result = match status.as_str() {
            "Valid" => "valid",
            "NotSigned" | "MissingSignature" => "unsigned",
            _ => "invalid",
        };
        Ok(result.to_string())
    }
    #[cfg(not(windows))]
    {
        let _ = path;
        Err("verify_signature: windows only".into())
    }
}

// ---------- change owner ----------

/// Change ownership of `path`. On unix accepts "uid:gid" with numeric ids
/// (either side may be omitted: "uid:", ":gid"). On windows returns an
/// unsupported error.
#[tauri::command]
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

// ---------- run script ----------

/// Execute `script` with `targets` as positional arguments, blocking until it
/// exits, and return combined output as "stdout\n---STDERR---\nstderr". On
/// windows, `.ps1` is run via `powershell -File`, `.bat`/`.cmd` via `cmd /c`,
/// otherwise executed directly.
#[tauri::command]
pub fn run_script(script: String, targets: Vec<String>) -> Result<String, String> {
    use std::process::Command;

    let lower = script.to_ascii_lowercase();
    let mut cmd;
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        if lower.ends_with(".ps1") {
            cmd = Command::new("powershell.exe");
            cmd.args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", &script]);
        } else if lower.ends_with(".bat") || lower.ends_with(".cmd") {
            cmd = Command::new("cmd");
            cmd.args(["/C", &script]);
        } else {
            cmd = Command::new(&script);
        }
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    #[cfg(not(windows))]
    {
        let _ = lower;
        cmd = Command::new(&script);
    }
    for t in &targets {
        cmd.arg(t);
    }

    let output = cmd
        .output()
        .map_err(|e| format!("run_script {}: {}", script, e))?;
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    let mut combined = format!("{}\n---STDERR---\n{}", stdout, stderr);
    // Surface failure in the output; a bare Ok on a non-zero exit made
    // failed scripts indistinguishable from successful ones.
    if !output.status.success() {
        let code = output
            .status
            .code()
            .map(|c| c.to_string())
            .unwrap_or_else(|| "killed by signal".to_string());
        combined.push_str(&format!("\n[exit: {}]", code));
    }
    Ok(combined)
}

// ---------- open url ----------

/// Open `url` in the system default browser.
#[tauri::command]
pub fn open_url(url: String) -> Result<(), String> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        std::process::Command::new("cmd")
            .args(["/C", "start", "", &url])
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map(reap)
            .map_err(|e| format!("open_url: {}", e))
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&url)
            .spawn()
            .map(reap)
            .map_err(|e| format!("open_url: {}", e))
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        std::process::Command::new("xdg-open")
            .arg(&url)
            .spawn()
            .map(reap)
            .map_err(|e| format!("open_url: {}", e))
    }
}

// ---------- spawn new window ----------

/// Launch a detached copy of the current executable (new app window).
#[tauri::command]
pub fn spawn_new_window() -> Result<(), String> {
    use std::process::{Command, Stdio};
    let exe = std::env::current_exe()
        .map_err(|e| format!("current_exe: {}", e))?;

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let child = Command::new(&exe)
            .creation_flags(CREATE_NO_WINDOW)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| format!("spawn_new_window: {}", e))?;
        reap(child);
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let child = Command::new(&exe)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| format!("spawn_new_window: {}", e))?;
        reap(child);
        Ok(())
    }
}

// ---------- window always-on-top ----------

/// Toggle the always-on-top flag on the invoking window.
#[tauri::command]
pub fn set_always_on_top(window: tauri::Window, enabled: bool) -> Result<(), String> {
    window
        .set_always_on_top(enabled)
        .map_err(|e| format!("set_always_on_top: {}", e))
}

// ---------- shell profile detection ----------

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ShellProfile {
    pub id: String,
    pub label: String,
    pub kind: String,
    pub exec: String,
    pub args: Vec<String>,
}

fn home_dir_path() -> Option<PathBuf> {
    std::env::var("USERPROFILE")
        .ok()
        .or_else(|| std::env::var("HOME").ok())
        .map(PathBuf::from)
}

/// Decode UTF-16LE byte buffer into String. Returns lossy UTF-8 on failure.
#[cfg(windows)]
fn decode_utf16le(bytes: &[u8]) -> String {
    // Strip BOM if present.
    let mut slice = bytes;
    if slice.len() >= 2 && slice[0] == 0xFF && slice[1] == 0xFE {
        slice = &slice[2..];
    }
    let mut u16s: Vec<u16> = Vec::with_capacity(slice.len() / 2);
    let mut i = 0;
    while i + 1 < slice.len() {
        u16s.push(u16::from_le_bytes([slice[i], slice[i + 1]]));
        i += 2;
    }
    String::from_utf16_lossy(&u16s)
}

/// Parse `~/.ssh/config` and return host entries, skipping wildcards.
fn ssh_hosts() -> Vec<String> {
    let home = match home_dir_path() {
        Some(h) => h,
        None => return Vec::new(),
    };
    let cfg_path = home.join(".ssh").join("config");
    let text = match std::fs::read_to_string(&cfg_path) {
        Ok(t) => t,
        Err(_) => return Vec::new(),
    };
    let mut hosts: Vec<String> = Vec::new();
    for raw in text.lines() {
        let line = raw.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        // Case-insensitive "Host " prefix.
        let lower = line.to_ascii_lowercase();
        if !lower.starts_with("host ") && !lower.starts_with("host\t") {
            continue;
        }
        let rest = line[4..].trim();
        for tok in rest.split_whitespace() {
            if tok.contains('*') || tok.contains('?') {
                continue;
            }
            if !hosts.iter().any(|h| h == tok) {
                hosts.push(tok.to_string());
            }
        }
    }
    hosts
}

/// Detect installed WSL distributions by running `wsl.exe -l -q`.
/// Output is UTF-16LE; decode manually without pulling `encoding_rs`.
fn wsl_distros() -> Vec<String> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        use std::process::Command;
        if which::which("wsl.exe").is_err() && which::which("wsl").is_err() {
            return Vec::new();
        }
        let out = Command::new("wsl.exe")
            .args(["-l", "-q"])
            .creation_flags(CREATE_NO_WINDOW)
            .output();
        let output = match out {
            Ok(o) => o,
            Err(_) => return Vec::new(),
        };
        if !output.status.success() {
            return Vec::new();
        }
        let text = decode_utf16le(&output.stdout);
        let mut distros: Vec<String> = Vec::new();
        for line in text.lines() {
            // Strip nulls and whitespace; -q output often has stray \0.
            let cleaned: String = line.chars().filter(|c| *c != '\0').collect();
            let trimmed = cleaned.trim();
            if trimmed.is_empty() {
                continue;
            }
            if !distros.iter().any(|d| d == trimmed) {
                distros.push(trimmed.to_string());
            }
        }
        distros
    }
    #[cfg(not(windows))]
    {
        Vec::new()
    }
}

/// Probe the system for available shells, WSL distros, and SSH hosts.
/// Emits only what actually exists: shells first, then WSL, then SSH.
#[tauri::command]
pub fn list_shell_profiles() -> Vec<ShellProfile> {
    let mut out: Vec<ShellProfile> = Vec::new();

    // Shell probes, in preferred order.
    #[cfg(windows)]
    let shell_probes: [(&str, &str, &str); 5] = [
        ("bash.exe", "bash", "shell:bash"),
        ("zsh.exe", "zsh", "shell:zsh"),
        ("fish.exe", "fish", "shell:fish"),
        ("pwsh.exe", "PowerShell", "shell:pwsh"),
        ("powershell.exe", "PowerShell", "shell:powershell"),
    ];
    #[cfg(not(windows))]
    let shell_probes: [(&str, &str, &str); 5] = [
        ("bash", "bash", "shell:bash"),
        ("zsh", "zsh", "shell:zsh"),
        ("fish", "fish", "shell:fish"),
        ("pwsh", "PowerShell", "shell:pwsh"),
        ("powershell", "PowerShell", "shell:powershell"),
    ];
    let mut have_pwsh_label = false;
    for (exe, label, id) in shell_probes.iter() {
        if let Ok(resolved) = which::which(exe) {
            // De-duplicate the two PowerShell variants under one label.
            if *label == "PowerShell" {
                if have_pwsh_label {
                    continue;
                }
                have_pwsh_label = true;
            }
            out.push(ShellProfile {
                id: (*id).to_string(),
                label: (*label).to_string(),
                kind: "shell".to_string(),
                exec: resolved.to_string_lossy().to_string(),
                args: Vec::new(),
            });
        }
    }

    // WSL distros.
    for distro in wsl_distros() {
        out.push(ShellProfile {
            id: format!("wsl:{}", distro),
            label: format!("WSL · {}", distro),
            kind: "wsl".to_string(),
            exec: "wsl.exe".to_string(),
            args: vec!["-d".to_string(), distro],
        });
    }

    // SSH hosts from ~/.ssh/config.
    for host in ssh_hosts() {
        out.push(ShellProfile {
            id: format!("ssh:{}", host),
            label: format!("SSH: {}", host),
            kind: "ssh".to_string(),
            exec: "ssh".to_string(),
            args: vec![host],
        });
    }

    out
}

/// Launch a terminal profile in `cwd`. Prefers Windows Terminal (`wt.exe`);
/// falls back to `cmd /C start`. Never flashes a console window.
#[tauri::command]
pub fn spawn_terminal_profile(profile: ShellProfile, cwd: String) -> Result<(), String> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        use std::process::{Command, Stdio};

        let have_wt = which::which("wt.exe").is_ok() || which::which("wt").is_ok();

        if have_wt {
            let mut cmd = Command::new("wt.exe");
            cmd.args(["-d", &cwd]);
            match profile.kind.as_str() {
                "wsl" => {
                    cmd.arg("wsl.exe");
                    for a in &profile.args {
                        cmd.arg(a);
                    }
                }
                "ssh" => {
                    cmd.arg("ssh");
                    for a in &profile.args {
                        cmd.arg(a);
                    }
                }
                _ => {
                    cmd.arg(&profile.exec);
                    for a in &profile.args {
                        cmd.arg(a);
                    }
                }
            }
            let res = cmd
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn();
            match res {
                Ok(c) => {
                    reap(c);
                    return Ok(());
                }
                Err(e) => {
                    eprintln!("wt.exe spawn failed: {}, falling back", e);
                }
            }
        }

        // Fallback: cmd /C start "" <exec> <args>
        let mut cmd = Command::new("cmd");
        cmd.arg("/C").arg("start").arg("");
        match profile.kind.as_str() {
            "wsl" => {
                cmd.arg("wsl.exe");
                for a in &profile.args {
                    cmd.arg(a);
                }
            }
            "ssh" => {
                cmd.arg("ssh");
                for a in &profile.args {
                    cmd.arg(a);
                }
            }
            _ => {
                cmd.arg(&profile.exec);
                for a in &profile.args {
                    cmd.arg(a);
                }
            }
        }
        cmd.creation_flags(CREATE_NO_WINDOW)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        let _ = cwd; // cwd used above for wt; fallback ignores per spec.
        cmd.spawn()
            .map(reap)
            .map_err(|e| format!("spawn_terminal_profile fallback: {}", e))
    }
    #[cfg(not(windows))]
    {
        use std::process::Stdio;
        let prog: &str = match profile.kind.as_str() {
            "ssh" => "ssh",
            _ => profile.exec.as_str(),
        };
        let mut cmd = linux_terminal_command(&cwd, Some((prog, &profile.args)))?;
        cmd.stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map(reap)
            .map_err(|e| format!("spawn_terminal_profile: {}", e))
    }
}

// ---------- recent-paths persistence ----------

const RECENT_MAX: usize = 20;

#[tauri::command]
pub fn read_recent(app: AppHandle) -> Result<Vec<String>, String> {
    let path = config_file(&app, "recent.json")?;
    match std::fs::read_to_string(&path) {
        Ok(s) => serde_json::from_str::<Vec<String>>(&s).map_err(|e| e.to_string()),
        Err(ref e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn append_recent(app: AppHandle, path: String) -> Result<(), String> {
    let cfg = config_file(&app, "recent.json")?;
    let mut list: Vec<String> = match std::fs::read_to_string(&cfg) {
        Ok(s) => serde_json::from_str::<Vec<String>>(&s).unwrap_or_default(),
        Err(_) => Vec::new(),
    };
    list.retain(|p| p != &path);
    list.insert(0, path);
    if list.len() > RECENT_MAX {
        list.truncate(RECENT_MAX);
    }
    let body = serde_json::to_string(&list).map_err(|e| e.to_string())?;
    write_config_atomic(&cfg, &body)
}

#[tauri::command]
pub fn clear_recent(app: AppHandle) -> Result<(), String> {
    let cfg = config_file(&app, "recent.json")?;
    let body = serde_json::to_string(&Vec::<String>::new()).map_err(|e| e.to_string())?;
    write_config_atomic(&cfg, &body)
}

// ---------- extended file stat ----------

#[derive(Debug, Serialize, Default)]
pub struct FileStatExt {
    pub created_ms: Option<i64>,
    pub modified_ms: Option<i64>,
    pub owner: Option<String>,
    pub file_index: Option<u64>,
    pub readonly: bool,
    pub is_symlink: bool,
    pub symlink_target: Option<String>,
}

fn system_time_to_ms(t: std::time::SystemTime) -> Option<i64> {
    t.duration_since(std::time::UNIX_EPOCH)
        .ok()
        .map(|d| d.as_millis() as i64)
}

#[tauri::command]
pub fn file_stat_extended(path: String) -> Result<FileStatExt, String> {
    let md = std::fs::symlink_metadata(&path).map_err(|e| format!("stat {}: {}", path, e))?;
    let mut out = FileStatExt {
        readonly: md.permissions().readonly(),
        is_symlink: md.file_type().is_symlink(),
        ..Default::default()
    };
    out.created_ms = md.created().ok().and_then(system_time_to_ms);
    out.modified_ms = md.modified().ok().and_then(system_time_to_ms);
    if out.is_symlink {
        if let Ok(target) = std::fs::read_link(&path) {
            out.symlink_target = Some(target.to_string_lossy().to_string());
        }
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        out.file_index = Some(md.ino());
        out.owner = Some(format!("{}:{}", md.uid(), md.gid()));
    }

    #[cfg(windows)]
    {
        // Best-effort: file index via GetFileInformationByHandle.
        use windows::core::PCWSTR;
        use windows::Win32::Foundation::{CloseHandle, HANDLE};
        use windows::Win32::Storage::FileSystem::{
            CreateFileW, GetFileInformationByHandle, BY_HANDLE_FILE_INFORMATION,
            FILE_FLAG_BACKUP_SEMANTICS, FILE_GENERIC_READ, FILE_SHARE_DELETE, FILE_SHARE_READ,
            FILE_SHARE_WRITE, OPEN_EXISTING,
        };
        unsafe {
            let wide: Vec<u16> = path.encode_utf16().chain(std::iter::once(0)).collect();
            let handle = CreateFileW(
                PCWSTR(wide.as_ptr()),
                FILE_GENERIC_READ.0,
                FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
                None,
                OPEN_EXISTING,
                FILE_FLAG_BACKUP_SEMANTICS,
                HANDLE::default(),
            );
            if let Ok(h) = handle {
                let mut info = BY_HANDLE_FILE_INFORMATION::default();
                if GetFileInformationByHandle(h, &mut info).is_ok() {
                    let idx = ((info.nFileIndexHigh as u64) << 32) | info.nFileIndexLow as u64;
                    out.file_index = Some(idx);
                }
                let _ = CloseHandle(h);
            }
        }
        // Owner: GetSecurityInfo + LookupAccountSidW (best-effort).
        out.owner = win_file_owner(&path);
    }

    Ok(out)
}

#[cfg(windows)]
fn win_file_owner(path: &str) -> Option<String> {
    use windows::core::PCWSTR;
    use windows::Win32::Security::Authorization::{GetNamedSecurityInfoW, SE_FILE_OBJECT};
    use windows::Win32::Security::{
        LookupAccountSidW, OWNER_SECURITY_INFORMATION, PSID, SID_NAME_USE,
    };
    unsafe {
        let wide: Vec<u16> = path.encode_utf16().chain(std::iter::once(0)).collect();
        let mut psid_owner: PSID = PSID::default();
        let mut psd = windows::Win32::Security::PSECURITY_DESCRIPTOR::default();
        let err = GetNamedSecurityInfoW(
            PCWSTR(wide.as_ptr()),
            SE_FILE_OBJECT,
            OWNER_SECURITY_INFORMATION,
            Some(&mut psid_owner as *mut _),
            None,
            None,
            None,
            &mut psd as *mut _,
        );
        if err.0 != 0 {
            return None;
        }
        let mut name_buf = [0u16; 256];
        let mut domain_buf = [0u16; 256];
        let mut name_len = name_buf.len() as u32;
        let mut domain_len = domain_buf.len() as u32;
        let mut sid_use = SID_NAME_USE::default();
        let looked = LookupAccountSidW(
            PCWSTR::null(),
            psid_owner,
            windows::core::PWSTR(name_buf.as_mut_ptr()),
            &mut name_len,
            windows::core::PWSTR(domain_buf.as_mut_ptr()),
            &mut domain_len,
            &mut sid_use,
        );
        // Free the descriptor allocated by GetNamedSecurityInfoW.
        let _ = windows::Win32::Foundation::LocalFree(windows::Win32::Foundation::HLOCAL(
            psd.0 as _,
        ));
        if looked.is_err() {
            return None;
        }
        let name =
            String::from_utf16_lossy(&name_buf[..name_buf.iter().position(|&c| c == 0).unwrap_or(0)]);
        let domain = String::from_utf16_lossy(
            &domain_buf[..domain_buf.iter().position(|&c| c == 0).unwrap_or(0)],
        );
        if domain.is_empty() {
            Some(name)
        } else {
            Some(format!("{}\\{}", domain, name))
        }
    }
}

// ---------- additional checksums ----------

#[tauri::command]
pub fn hash_md5(path: String) -> Result<String, String> {
    use md5::{Digest, Md5};
    use std::io::Read;

    let mut f = std::fs::File::open(&path).map_err(|e| format!("open {}: {}", path, e))?;
    let mut hasher = Md5::new();
    let mut buf = [0u8; 64 * 1024];
    loop {
        let n = f.read(&mut buf).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    let digest = hasher.finalize();
    let mut hex = String::with_capacity(digest.len() * 2);
    for byte in digest {
        use std::fmt::Write;
        let _ = write!(&mut hex, "{:02x}", byte);
    }
    Ok(hex)
}

#[tauri::command]
pub fn hash_crc32(path: String) -> Result<String, String> {
    use std::io::Read;

    let mut f = std::fs::File::open(&path).map_err(|e| format!("open {}: {}", path, e))?;
    let mut hasher = crc32fast::Hasher::new();
    let mut buf = [0u8; 64 * 1024];
    loop {
        let n = f.read(&mut buf).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(format!("{:08x}", hasher.finalize()))
}

// ---------- per-file git info ----------

#[derive(Debug, Serialize, Default)]
pub struct GitFileInfo {
    pub last_commit_ago: Option<String>,
    pub author: Option<String>,
    pub sha: Option<String>,
    pub added: u32,
    pub removed: u32,
}

#[tauri::command]
pub fn git_file_info(cwd: String, path: String) -> Result<GitFileInfo, String> {
    let mut out = GitFileInfo::default();

    // Cheap repo check first — two subprocess spawns per selection is too
    // expensive when the file isn't in a git repo at all.
    if git2::Repository::discover(&cwd).is_err() {
        return Ok(out);
    }

    // log -1 --format=%cr%n%an%n%h -- <path>
    // Must go through build_git_command so CREATE_NO_WINDOW is applied — this
    // runs on every file-selection change; without the flag every click
    // flashes a cmd.exe console on Windows.
    if let Ok(o) = build_git_command(&cwd)
        .args(["log", "-1", "--format=%cr%n%an%n%h", "--"])
        .arg(&path)
        .output()
    {
        if o.status.success() {
            let s = String::from_utf8_lossy(&o.stdout);
            let mut lines = s.lines();
            out.last_commit_ago = lines.next().map(|x| x.trim().to_string()).filter(|x| !x.is_empty());
            out.author = lines.next().map(|x| x.trim().to_string()).filter(|x| !x.is_empty());
            out.sha = lines.next().map(|x| x.trim().to_string()).filter(|x| !x.is_empty());
        }
    }

    // diff --numstat HEAD -- <path>
    if let Ok(o) = build_git_command(&cwd)
        .args(["diff", "--numstat", "HEAD", "--"])
        .arg(&path)
        .output()
    {
        if o.status.success() {
            let s = String::from_utf8_lossy(&o.stdout);
            if let Some(line) = s.lines().next() {
                let mut parts = line.split_whitespace();
                if let (Some(a), Some(d)) = (parts.next(), parts.next()) {
                    out.added = a.parse().unwrap_or(0);
                    out.removed = d.parse().unwrap_or(0);
                }
            }
        }
    }

    Ok(out)
}

// ---------- filesystem type for arbitrary path ----------

#[tauri::command]
pub fn path_fs_type(path: String) -> Result<String, String> {
    #[cfg(windows)]
    {
        use windows::core::PCWSTR;
        use windows::Win32::Storage::FileSystem::{GetVolumePathNameW, GetVolumeInformationW};
        unsafe {
            let wide: Vec<u16> = path.encode_utf16().chain(std::iter::once(0)).collect();
            let mut vol_buf = [0u16; 260];
            let ok = GetVolumePathNameW(PCWSTR(wide.as_ptr()), &mut vol_buf).is_ok();
            if !ok {
                return Ok(String::new());
            }
            let mut fs_buf = [0u16; 64];
            let res = GetVolumeInformationW(
                PCWSTR(vol_buf.as_ptr()),
                None,
                None,
                None,
                None,
                Some(&mut fs_buf),
            );
            if res.is_err() {
                return Ok(String::new());
            }
            let fs = String::from_utf16_lossy(
                &fs_buf[..fs_buf.iter().position(|&c| c == 0).unwrap_or(0)],
            );
            Ok(fs)
        }
    }
    #[cfg(not(windows))]
    {
        // Longest mount-point prefix of `path` wins. /proc/self/mounts escapes
        // spaces in mount points as \040.
        let mounts = std::fs::read_to_string("/proc/self/mounts").map_err(|e| e.to_string())?;
        let mut best_len = 0usize;
        let mut best_fs = String::new();
        for line in mounts.lines() {
            let mut it = line.split_whitespace();
            let (Some(_dev), Some(mp_raw), Some(fs)) = (it.next(), it.next(), it.next()) else {
                continue;
            };
            let mp = mp_raw.replace("\\040", " ");
            let matches = mp == "/" || path == mp || path.starts_with(&(mp.clone() + "/"));
            if matches && mp.len() > best_len {
                best_len = mp.len();
                best_fs = fs.to_string();
            }
        }
        Ok(best_fs)
    }
}

// ---------- network rate ----------

#[derive(Debug, Serialize, Default, Clone, Copy)]
pub struct NetRate {
    pub down_bps: u64,
    pub up_bps: u64,
}

static NET_LAST: std::sync::Mutex<Option<(std::time::Instant, u64, u64)>> =
    std::sync::Mutex::new(None);

#[tauri::command]
pub fn net_rate() -> Result<NetRate, String> {
    let (total_in, total_out) = sample_net_octets()?;
    let now = std::time::Instant::now();
    let mut slot = NET_LAST.lock().map_err(|e| e.to_string())?;
    let rate = match *slot {
        Some((prev_t, prev_in, prev_out)) => {
            let dt = now.duration_since(prev_t).as_secs_f64().max(0.001);
            let d_in = total_in.saturating_sub(prev_in) as f64;
            let d_out = total_out.saturating_sub(prev_out) as f64;
            NetRate {
                down_bps: (d_in / dt) as u64,
                up_bps: (d_out / dt) as u64,
            }
        }
        None => NetRate::default(),
    };
    *slot = Some((now, total_in, total_out));
    Ok(rate)
}

#[cfg(windows)]
fn sample_net_octets() -> Result<(u64, u64), String> {
    use windows::Win32::NetworkManagement::IpHelper::{
        FreeMibTable, GetIfTable2, MIB_IF_TABLE2,
    };
    unsafe {
        let mut table_ptr: *mut MIB_IF_TABLE2 = std::ptr::null_mut();
        let err = GetIfTable2(&mut table_ptr);
        if err.0 != 0 || table_ptr.is_null() {
            return Err(format!("GetIfTable2: {:?}", err));
        }
        let table = &*table_ptr;
        let count = table.NumEntries as usize;
        let rows = std::slice::from_raw_parts(table.Table.as_ptr(), count);
        let mut total_in: u64 = 0;
        let mut total_out: u64 = 0;
        for row in rows {
            // Skip loopback (IF_TYPE_SOFTWARE_LOOPBACK = 24).
            if row.Type == 24 {
                continue;
            }
            total_in = total_in.saturating_add(row.InOctets);
            total_out = total_out.saturating_add(row.OutOctets);
        }
        FreeMibTable(table_ptr as _);
        Ok((total_in, total_out))
    }
}

#[cfg(not(windows))]
fn sample_net_octets() -> Result<(u64, u64), String> {
    // /proc/net/dev: two header lines, then "iface: rx_bytes ... tx_bytes ..."
    // with tx_bytes at field index 8 after the colon.
    let text = std::fs::read_to_string("/proc/net/dev").map_err(|e| e.to_string())?;
    let mut total_in = 0u64;
    let mut total_out = 0u64;
    for line in text.lines().skip(2) {
        let Some((iface, rest)) = line.split_once(':') else {
            continue;
        };
        if iface.trim() == "lo" {
            continue;
        }
        let fields: Vec<&str> = rest.split_whitespace().collect();
        if fields.len() < 9 {
            continue;
        }
        total_in = total_in.saturating_add(fields[0].parse::<u64>().unwrap_or(0));
        total_out = total_out.saturating_add(fields[8].parse::<u64>().unwrap_or(0));
    }
    Ok((total_in, total_out))
}

// ---------- per-repo dirty count ----------

#[tauri::command]
pub fn git_dirty_count(path: String) -> Result<u32, String> {
    use git2::{Repository, Status, StatusOptions};
    let Ok(repo) = Repository::discover(&path) else {
        return Ok(0);
    };
    let mut opts = StatusOptions::new();
    opts.include_untracked(true).recurse_untracked_dirs(false);
    let Ok(statuses) = repo.statuses(Some(&mut opts)) else {
        return Ok(0);
    };
    let mut n: u32 = 0;
    for s in statuses.iter() {
        if s.status().contains(Status::IGNORED) {
            continue;
        }
        n += 1;
    }
    Ok(n)
}

// ---------- real git shell-outs ----------

#[derive(Debug, Serialize)]
pub struct GitRunResult {
    pub ok: bool,
    pub stdout: String,
    pub stderr: String,
    pub exit: i32,
}

#[derive(Debug, Serialize)]
pub struct GitBranch {
    pub name: String,
    pub current: bool,
    pub upstream: Option<String>,
    pub ahead: u32,
    pub behind: u32,
}

fn build_git_command(cwd: &str) -> std::process::Command {
    let mut cmd = std::process::Command::new("git");
    cmd.current_dir(cwd);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

fn classify_spawn_err(e: &std::io::Error) -> String {
    if e.kind() == std::io::ErrorKind::NotFound {
        "git not found — is it installed and on PATH?".to_string()
    } else {
        format!("git spawn failed: {}", e)
    }
}

#[tauri::command]
pub fn git_run(cwd: String, args: Vec<String>) -> Result<GitRunResult, String> {
    let mut cmd = build_git_command(&cwd);
    cmd.args(&args);
    let out = cmd.output().map_err(|e| classify_spawn_err(&e))?;
    let stdout = String::from_utf8_lossy(&out.stdout).into_owned();
    let stderr = String::from_utf8_lossy(&out.stderr).into_owned();
    let exit = out.status.code().unwrap_or(-1);
    Ok(GitRunResult {
        ok: out.status.success(),
        stdout,
        stderr,
        exit,
    })
}

#[tauri::command]
pub fn git_branch_list(cwd: String) -> Result<Vec<GitBranch>, String> {
    let mut cmd = build_git_command(&cwd);
    cmd.args([
        "for-each-ref",
        "--format=%(refname:short)\t%(HEAD)\t%(upstream:short)",
        "refs/heads/",
    ]);
    let out = cmd.output().map_err(|e| classify_spawn_err(&e))?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).into_owned());
    }
    let text = String::from_utf8_lossy(&out.stdout);
    let mut branches = Vec::new();
    for line in text.lines() {
        let mut it = line.splitn(3, '\t');
        let name = match it.next() {
            Some(s) if !s.is_empty() => s.to_string(),
            _ => continue,
        };
        let head_flag = it.next().unwrap_or("");
        let upstream_raw = it.next().unwrap_or("");
        let current = head_flag.trim() == "*";
        let upstream = if upstream_raw.is_empty() {
            None
        } else {
            Some(upstream_raw.to_string())
        };

        let (ahead, behind) = if let Some(up) = &upstream {
            let mut rl = build_git_command(&cwd);
            rl.args([
                "rev-list",
                "--left-right",
                "--count",
                &format!("{}...{}", name, up),
            ]);
            match rl.output() {
                Ok(o) if o.status.success() => {
                    let s = String::from_utf8_lossy(&o.stdout);
                    let parts: Vec<&str> = s.split_whitespace().collect();
                    let a: u32 = parts.first().and_then(|x| x.parse().ok()).unwrap_or(0);
                    let b: u32 = parts.get(1).and_then(|x| x.parse().ok()).unwrap_or(0);
                    (a, b)
                }
                _ => (0, 0),
            }
        } else {
            (0, 0)
        };

        branches.push(GitBranch {
            name,
            current,
            upstream,
            ahead,
            behind,
        });
    }
    Ok(branches)
}

#[tauri::command]
pub fn git_ahead_behind(cwd: String) -> Result<(u32, u32), String> {
    let mut cmd = build_git_command(&cwd);
    cmd.args(["rev-list", "--left-right", "--count", "HEAD...@{upstream}"]);
    let out = match cmd.output() {
        Ok(o) => o,
        Err(e) => return Err(classify_spawn_err(&e)),
    };
    if !out.status.success() {
        return Ok((0, 0));
    }
    let s = String::from_utf8_lossy(&out.stdout);
    let parts: Vec<&str> = s.split_whitespace().collect();
    let a: u32 = parts.first().and_then(|x| x.parse().ok()).unwrap_or(0);
    let b: u32 = parts.get(1).and_then(|x| x.parse().ok()).unwrap_or(0);
    Ok((a, b))
}

// ---------- tests ----------

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("glasshouse-test-{}-{}", std::process::id(), name));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn kind_from_ext_dir_wins_over_ext() {
        assert_eq!(kind_from_ext("rs", true), "folder");
        assert_eq!(kind_from_ext("", true), "folder");
    }

    #[test]
    fn kind_from_ext_maps_common_types() {
        assert_eq!(kind_from_ext("md", false), "text");
        assert_eq!(kind_from_ext("rs", false), "code");
        assert_eq!(kind_from_ext("PNG", false), "img"); // case-insensitive
        assert_eq!(kind_from_ext("tar", false), "archive");
        assert_eq!(kind_from_ext("exe", false), "exec");
        assert_eq!(kind_from_ext("blob", false), "bin");
        assert_eq!(kind_from_ext("", false), "bin");
    }

    #[test]
    fn win_to_wsl_drive_paths() {
        assert_eq!(win_to_wsl("C:\\Users\\me".into()), "/mnt/c/Users/me");
        assert_eq!(win_to_wsl("D:/data".into()), "/mnt/d/data");
        assert_eq!(win_to_wsl("C:".into()), "/mnt/c");
    }

    #[test]
    fn win_to_wsl_leaves_posix_paths() {
        assert_eq!(win_to_wsl("/home/me".into()), "/home/me");
    }

    #[test]
    fn wsl_to_win_mnt_paths() {
        assert_eq!(wsl_to_win("/mnt/c/Users/me".into()), "C:\\Users\\me");
        assert_eq!(wsl_to_win("/mnt/d/".into()), "D:\\");
    }

    #[test]
    fn win_wsl_round_trip() {
        let orig = "C:\\Users\\me\\proj";
        assert_eq!(wsl_to_win(win_to_wsl(orig.into())), orig);
    }

    #[test]
    fn write_config_atomic_writes_and_replaces() {
        let dir = temp_dir("atomic");
        let target = dir.join("pins.json");
        write_config_atomic(&target, "[1]").unwrap();
        assert_eq!(std::fs::read_to_string(&target).unwrap(), "[1]");
        write_config_atomic(&target, "[1,2]").unwrap();
        assert_eq!(std::fs::read_to_string(&target).unwrap(), "[1,2]");
        // no stray tmp file left behind
        assert!(!dir.join("pins.json.tmp").exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn copy_dir_recursive_copies_nested_tree() {
        let dir = temp_dir("copytree");
        let src = dir.join("src");
        std::fs::create_dir_all(src.join("a/b")).unwrap();
        std::fs::write(src.join("root.txt"), "r").unwrap();
        std::fs::write(src.join("a/b/leaf.txt"), "leaf").unwrap();
        let dst = dir.join("dst");
        copy_dir_recursive(&src, &dst).unwrap();
        assert_eq!(std::fs::read_to_string(dst.join("root.txt")).unwrap(), "r");
        assert_eq!(std::fs::read_to_string(dst.join("a/b/leaf.txt")).unwrap(), "leaf");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
