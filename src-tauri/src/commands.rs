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
        } else if flags.contains(Status::IGNORED) {
            "!"
        } else {
            continue;
        };
        // `rel` can include a trailing slash for untracked directories. Trim
        // it before joining so the resulting PathBuf lines up with the
        // canonicalized FileEntry paths we look up against later.
        let rel_trim = rel.trim_end_matches(|c| c == '/' || c == '\\');
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

    let cap = max_lines.min(BLAME_MAX_CAP).max(1) as usize;
    let mut out: Vec<BlameLine> = Vec::new();

    for hunk in blame.iter() {
        let start = hunk.final_start_line() as usize; // 1-based
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
                        .trim_end_matches(|c| c == '\n' || c == '\r')
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
