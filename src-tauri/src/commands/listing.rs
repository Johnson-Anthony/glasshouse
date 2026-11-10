use serde::Serialize;
use std::path::{Path, PathBuf};
use super::git::scan_repo_statuses;

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
    /// True when the on-disk path isn't valid UTF-8, i.e. `name`/`path` are
    /// lossy renderings (U+FFFD substitutions) that cannot address the real
    /// file — the frontend blocks mutating ops on such entries.
    pub lossy: bool,
    /// Per-row git status relative to the repo containing the listing dir.
    /// One of: "M" (modified), "A" (added/new), "D" (deleted), "U" (conflicted),
    /// "?" (untracked); see `git_status_code`. `None` for clean, ignored or
    /// outside-repo.
    pub git: Option<String>,
}

#[tauri::command]
pub fn home_dir() -> Option<String> {
    home_dir_path().map(|p| p.to_string_lossy().into_owned())
}

pub(crate) fn home_dir_path() -> Option<PathBuf> {
    home_from(|k| std::env::var(k).ok()).map(PathBuf::from)
}

/// Windows reads USERPROFILE first; HOME there is only set by unix-style
/// tools and may point elsewhere. Unix trusts HOME alone, since under WSL a
/// USERPROFILE forwarded via WSLENV is a Windows path. Empty means unset.
fn home_from(get: impl Fn(&str) -> Option<String>) -> Option<String> {
    #[cfg(windows)]
    const VARS: &[&str] = &["USERPROFILE", "HOME"];
    #[cfg(not(windows))]
    const VARS: &[&str] = &["HOME"];
    VARS.iter().filter_map(|k| get(k)).find(|v| !v.is_empty())
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

pub(super) fn canonicalize_soft(p: &str) -> PathBuf {
    dunce::canonicalize(p).unwrap_or_else(|_| PathBuf::from(p))
}

#[tauri::command(async)]
pub fn list_dir(path: String, show_hidden: bool) -> Result<Vec<FileEntry>, String> {
    let p = canonicalize_soft(&path);
    let mut out = Vec::new();
    let rd = std::fs::read_dir(&p).map_err(|e| format!("read_dir({}): {}", p.display(), e))?;
    for entry in rd.flatten() {
        // DirEntry::metadata doesn't follow links. Hidden-ness belongs to the
        // link itself, but kind/size/mtime describe what it points at, so a
        // linked folder opens like a folder. A dangling link keeps its own.
        let link_meta = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };
        let name = entry.file_name().to_string_lossy().to_string();
        let hidden = is_hidden(&entry.path(), &name, &link_meta);
        if hidden && !show_hidden {
            continue;
        }
        let is_symlink = link_meta.file_type().is_symlink();
        let meta = if is_symlink {
            std::fs::metadata(entry.path()).unwrap_or(link_meta)
        } else {
            link_meta
        };
        let is_dir = meta.is_dir();
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
        let raw_path = entry.path();
        let lossy = raw_path.to_str().is_none();
        out.push(FileEntry {
            name,
            path: raw_path.to_string_lossy().to_string(),
            kind: kind_from_ext(&ext, is_dir).to_string(),
            size,
            modified_ms,
            hidden,
            ext,
            is_symlink,
            lossy,
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
            // `p` is canonical, so each entry path already matches the scan's
            // keys. Canonicalizing it would resolve a symlink to its target
            // and give the link its target's label.
            if let Some(flag) = git_map.get(Path::new(&fe.path)) {
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use crate::commands::testing::{test_repo, commit_all};
    #[cfg_attr(windows, allow(unused_imports))]
    use crate::commands::testing::{temp_dir, s};

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
    fn list_dir_git_labels_scan_only_the_listed_folder() {
        let (dir, repo) = test_repo("gitscope");
        let weird = "we[ir]d";
        for sub in ["sub/inner/!bang", weird] {
            std::fs::create_dir_all(dir.join(sub)).unwrap();
        }
        let files = [
            "root.txt",
            "sub/a.txt",
            "sub/b.txt",
            "sub/inner/c.txt",
            "sub/inner/!bang/z.txt",
            "we[ir]d/w.txt",
        ];
        for f in files {
            std::fs::write(dir.join(f), "v1").unwrap();
        }
        commit_all(&repo, "init");
        for f in files.iter().filter(|f| **f != "sub/b.txt") {
            std::fs::write(dir.join(f), "v2").unwrap();
        }
        std::fs::write(dir.join("sub/new.txt"), "new").unwrap();

        let labels = |rel: &str| -> HashMap<String, Option<String>> {
            list_dir(dir.join(rel).to_string_lossy().into_owned(), true)
                .unwrap()
                .into_iter()
                .map(|e| (e.name, e.git))
                .collect()
        };
        let code = |c: &str| Some(c.to_string());
        let root = labels("");
        assert_eq!(root["root.txt"], code("M"));
        assert_eq!(root["sub"], None);
        let sub = labels("sub");
        assert_eq!(sub["a.txt"], code("M"));
        assert_eq!(sub["b.txt"], None);
        assert_eq!(sub["new.txt"], code("?"));
        assert_eq!(sub["inner"], None);
        assert_eq!(labels("sub/inner")["c.txt"], code("M"));
        // A `!` past the first character is literal, so this scan is scoped.
        assert_eq!(labels("sub/inner/!bang")["z.txt"], code("M"));
        // `[` makes the path a pattern to libgit2, so this one scans the whole
        // repo; the label must still be right.
        assert_eq!(labels(weird)["w.txt"], code("M"));

        // The scan for `sub` saw nothing outside it.
        let sub_dir = dunce::canonicalize(dir.join("sub")).unwrap();
        let scanned = scan_repo_statuses(&sub_dir).unwrap();
        assert_eq!(scanned.len(), 4, "{:?}", scanned);
        assert!(scanned.keys().all(|p| p.starts_with(&sub_dir)), "{:?}", scanned);
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// A symlink row's git label is the link's own status, never its
    /// target's, and a target never inherits a link's status.
    #[cfg(unix)]
    #[test]
    fn list_dir_git_labels_belong_to_the_link_not_its_target() {
        use std::os::unix::fs::symlink;
        let (dir, repo) = test_repo("gitlinks");
        std::fs::write(dir.join("target.txt"), "v1").unwrap();
        std::fs::write(dir.join("target2.txt"), "v1").unwrap();
        symlink("target.txt", dir.join("link.txt")).unwrap();
        // Committed while dangling; `fresh/` only appears afterwards.
        symlink("fresh", dir.join("dirlink")).unwrap();
        commit_all(&repo, "init");
        std::fs::write(dir.join("target.txt"), "v2").unwrap();
        symlink("target2.txt", dir.join("newlink")).unwrap();
        std::fs::create_dir(dir.join("fresh")).unwrap();
        std::fs::write(dir.join("fresh/f.txt"), "new").unwrap();

        let labels: HashMap<String, Option<String>> = list_dir(s(&dir), true)
            .unwrap()
            .into_iter()
            .map(|e| (e.name, e.git))
            .collect();
        let code = |c: &str| Some(c.to_string());
        assert_eq!(labels["target.txt"], code("M"));
        assert_eq!(labels["link.txt"], None, "clean link to a modified file");
        assert_eq!(labels["newlink"], code("?"));
        assert_eq!(labels["target2.txt"], None, "clean target of an untracked link");
        assert_eq!(labels["fresh"], code("?"));
        assert_eq!(labels["dirlink"], None, "clean link to an untracked folder");

        // Listing the repo through a symlinked path gives the same labels.
        let alias = dir.with_file_name(format!("{}-alias", dir.file_name().unwrap().to_string_lossy()));
        let _ = std::fs::remove_file(&alias);
        symlink(&dir, &alias).unwrap();
        let via_alias: HashMap<String, Option<String>> = list_dir(s(&alias), true)
            .unwrap()
            .into_iter()
            .map(|e| (e.name, e.git))
            .collect();
        assert_eq!(via_alias, labels);
        let _ = std::fs::remove_file(&alias);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn list_dir_follows_links_for_kind_but_marks_them() {
        let dir = temp_dir("listlinks");
        std::fs::create_dir(dir.join("real")).unwrap();
        std::fs::write(dir.join("f.txt"), "hello").unwrap();
        std::os::unix::fs::symlink("real", dir.join("dirlink")).unwrap();
        std::os::unix::fs::symlink("f.txt", dir.join("filelink")).unwrap();
        std::os::unix::fs::symlink("missing", dir.join("broken")).unwrap();

        let entries = list_dir(s(&dir), true).unwrap();
        let get = |n: &str| entries.iter().find(|e| e.name == n).unwrap();
        assert_eq!(get("dirlink").kind, "folder");
        assert!(get("dirlink").is_symlink);
        assert_ne!(get("filelink").kind, "folder");
        assert_eq!(get("filelink").size, 5); // the target's size, not the link's
        assert!(get("filelink").is_symlink);
        assert_ne!(get("broken").kind, "folder");
        assert!(get("broken").is_symlink);
        assert!(!get("real").is_symlink);
        // Linked folders sort with the folders.
        let names: Vec<&str> = entries.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(&names[..2], ["dirlink", "real"]);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[cfg(not(windows))]
    #[test]
    fn home_from_uses_home_only_on_unix() {
        let env = |pairs: &'static [(&'static str, &'static str)]| {
            move |k: &str| pairs.iter().find(|(n, _)| *n == k).map(|(_, v)| v.to_string())
        };
        let both = env(&[("USERPROFILE", "C:\\Users\\me"), ("HOME", "/home/me")]);
        assert_eq!(home_from(both).as_deref(), Some("/home/me"));
        assert_eq!(home_from(env(&[("USERPROFILE", "C:\\Users\\me")])), None);
        assert_eq!(home_from(env(&[("HOME", "")])), None);
    }
}

#[cfg(test)]
#[path = "listing_tests.rs"]
mod listing_tests;
