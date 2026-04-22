use serde::Serialize;
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
        });
    }
    out.sort_by(|a, b| match (a.kind == "folder", b.kind == "folder") {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_ascii_lowercase().cmp(&b.name.to_ascii_lowercase()),
    });
    Ok(out)
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
    out
}

#[tauri::command]
pub fn system_info() -> SystemInfo {
    use sysinfo::System;
    let mut sys = System::new_all();
    sys.refresh_cpu_usage();
    sys.refresh_memory();
    let cpu_pct = sys.global_cpu_usage();
    let mem_total = sys.total_memory();
    let mem_used = sys.used_memory();
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
    // Try rename first (fast path for same volume). Fall back to copy+delete.
    if std::fs::rename(&from, &to).is_ok() {
        return Ok(());
    }
    copy_entry(from.clone(), to)?;
    delete_entry(from, false)
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

#[tauri::command]
pub fn read_text(path: String, max_bytes: usize) -> Result<String, String> {
    use std::io::Read;
    let f = std::fs::File::open(&path).map_err(|e| e.to_string())?;
    let cap = if max_bytes == 0 { 1_000_000 } else { max_bytes };
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

// ---------- git status ----------

#[derive(Debug, Serialize)]
pub struct GitInfo {
    pub repo_root: String,
    pub branch: String,
    pub ahead: usize,
    pub behind: usize,
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
            status_map.insert(p, flag.to_string());
        }
    }
    Some(GitInfo {
        repo_root: root,
        branch,
        ahead,
        behind,
        status: status_map,
    })
}

// ---------- open / reveal ----------

#[tauri::command]
pub fn open_with_default(path: String) -> Result<(), String> {
    #[cfg(windows)]
    {
        std::process::Command::new("cmd")
            .args(["/C", "start", "", &path])
            .spawn()
            .map(|_| ())
            .map_err(|e| e.to_string())
    }
    #[cfg(not(windows))]
    {
        std::process::Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map(|_| ())
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
            .map(|_| ())
            .map_err(|e| e.to_string())
    }
    #[cfg(not(windows))]
    {
        Err(format!("reveal_in_explorer unsupported on this platform: {}", path))
    }
}

// ---------- spawn external apps ----------

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

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
                    drop(c);
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
                    drop(c);
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
        drop(child);
        Ok(())
    }
    #[cfg(not(windows))]
    {
        use std::process::{Command, Stdio};
        let child = Command::new("x-terminal-emulator")
            .arg("--working-directory")
            .arg(&path)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| e.to_string())?;
        drop(child);
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
        drop(child);
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
        drop(child);
        Ok(())
    }
}

// ---------- WSL path translation ----------

#[tauri::command]
pub fn win_to_wsl(path: String) -> String {
    // C:\Users\ajohn -> /mnt/c/Users/ajohn
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
    // /mnt/c/Users/ajohn -> C:\Users\ajohn
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
    std::fs::write(&path, body).map_err(|e| e.to_string())
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
    std::fs::write(&path, body).map_err(|e| e.to_string())
}
