use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use super::file_info::read_capped;
use super::listing::canonicalize_soft;
#[cfg(windows)]
use super::launch::CREATE_NO_WINDOW;

/// Single-char code for one status entry, shared by `list_dir` and
/// `git_status` so they agree. Priority: conflict > staged new >
/// untracked > delete > modify (renames and type changes count as "M").
/// `None` for anything else; ignored entries never reach here because no
/// caller asks libgit2 for them.
fn git_status_code(flags: git2::Status) -> Option<&'static str> {
    use git2::Status;
    if flags.contains(Status::CONFLICTED) {
        Some("U")
    } else if flags.contains(Status::INDEX_NEW) {
        Some("A")
    } else if flags.contains(Status::WT_NEW) {
        Some("?")
    } else if flags.intersects(Status::WT_DELETED | Status::INDEX_DELETED) {
        Some("D")
    } else if flags.intersects(
        Status::WT_MODIFIED
            | Status::INDEX_MODIFIED
            | Status::WT_RENAMED
            | Status::INDEX_RENAMED
            | Status::WT_TYPECHANGE
            | Status::INDEX_TYPECHANGE,
    ) {
        Some("M")
    } else {
        None
    }
}

/// Walk `repo.statuses()` once and return a map of absolute paths (canonical
/// workdir + the repo-relative path) to a single-char status code. Returns
/// None when we couldn't open a repo at all (treat as "outside-repo; don't
/// annotate").
pub(super) fn scan_repo_statuses(dir: &Path) -> Option<HashMap<PathBuf, String>> {
    use git2::{Repository, StatusOptions};
    let repo = Repository::discover(dir).ok()?;
    let workdir = repo.workdir()?.to_path_buf();
    // Only the workdir is canonicalized. Git never descends through a
    // symlink, so every folder in a status path is real; canonicalizing the
    // whole path would resolve a symlink entry to its target.
    let root = canonicalize_soft(&workdir);
    let mut opts = StatusOptions::new();
    opts.include_untracked(true)
        .include_ignored(false)
        .recurse_untracked_dirs(false);
    // Only the listed folder's children get a label, so scan just its subtree
    // instead of the whole repo.
    if let Some(spec) = status_pathspec(&workdir, dir) {
        opts.pathspec(spec);
    }
    let statuses = repo.statuses(Some(&mut opts)).ok()?;
    let mut out: HashMap<PathBuf, String> = HashMap::new();
    for s in statuses.iter() {
        let rel = match s.path() {
            Some(p) => p,
            None => continue,
        };
        let Some(code) = git_status_code(s.status()) else {
            continue;
        };
        // `rel` can include a trailing slash for untracked directories. Trim
        // it, and push its `/`-separated parts one by one so the key uses the
        // platform separator like the FileEntry paths looked up against it.
        let rel_trim = rel.trim_end_matches(['/', '\\']);
        let key = rel_trim.split('/').fold(root.clone(), |k, part| k.join(part));
        out.insert(key, code.to_string());
    }
    Some(out)
}

/// The workdir-relative pathspec that limits a status scan to `dir`, or
/// `None` to scan the whole repo: at the repo root, when `dir` isn't under the
/// workdir or isn't UTF-8, and when libgit2 would read the path as a pattern
/// (glob characters, a leading `!` or `#`, trailing whitespace) rather than
/// as a plain folder prefix.
fn status_pathspec(workdir: &Path, dir: &Path) -> Option<String> {
    let rel = dir.strip_prefix(workdir).ok()?;
    let parts = rel
        .components()
        .map(|c| match c {
            std::path::Component::Normal(s) => s.to_str(),
            _ => None,
        })
        .collect::<Option<Vec<_>>>()?;
    if parts.is_empty() {
        return None;
    }
    let spec = parts.join("/");
    literal_pathspec(&spec).then_some(spec)
}

// ---------- git status ----------

#[derive(Debug, Serialize)]
pub struct GitInfo {
    pub repo_root: String,
    pub branch: String,
    pub ahead: usize,
    pub behind: usize,
    pub dirty: usize,
    pub status: std::collections::HashMap<String, String>, // repo-relative path -> code, as in FileEntry.git
}

/// Commits HEAD is ahead of and behind its upstream. `Ok(None)` when there's
/// nothing to compare: detached or unborn HEAD, no upstream configured, or
/// an upstream ref that's gone (deleted on the remote and pruned).
fn upstream_ahead_behind(repo: &git2::Repository) -> Result<Option<(usize, usize)>, git2::Error> {
    use git2::ErrorCode;
    let head = match repo.head() {
        Ok(h) => h,
        Err(e) if matches!(e.code(), ErrorCode::UnbornBranch | ErrorCode::NotFound) => {
            return Ok(None)
        }
        Err(e) => return Err(e),
    };
    let (true, Some(name), Some(local)) = (head.is_branch(), head.name(), head.target()) else {
        return Ok(None);
    };
    let upstream = match repo.branch_upstream_name(name) {
        Ok(u) => u,
        Err(e) if e.code() == ErrorCode::NotFound => return Ok(None),
        Err(e) => return Err(e),
    };
    let Some(upstream) = upstream.as_str() else {
        return Ok(None);
    };
    let upstream_oid = match repo.refname_to_id(upstream) {
        Ok(oid) => oid,
        Err(e) if e.code() == ErrorCode::NotFound => return Ok(None),
        Err(e) => return Err(e),
    };
    repo.graph_ahead_behind(local, upstream_oid).map(Some)
}

#[tauri::command(async)]
pub fn git_status(path: String) -> Option<GitInfo> {
    use git2::{Repository, StatusOptions};
    let repo = Repository::discover(&path).ok()?;
    let root = repo.workdir()?.to_string_lossy().to_string();
    let head = repo.head().ok();
    let branch = head
        .as_ref()
        .and_then(|h| h.shorthand().map(|s| s.to_string()))
        .unwrap_or_else(|| "(detached)".to_string());

    // The toolbar just hides zero counts, so a failure here shows nothing.
    let (ahead, behind) = upstream_ahead_behind(&repo)
        .ok()
        .flatten()
        .unwrap_or((0, 0));

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
            let Some(code) = git_status_code(s.status()) else {
                continue;
            };
            dirty += 1;
            status_map.insert(p, code.to_string());
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

#[tauri::command(async)]
pub fn git_blame(path: String, max_lines: u32) -> Result<Vec<BlameLine>, String> {
    use git2::BlameOptions;
    // A linked file is blamed as the file it points to.
    let abs = canonicalize_soft(&path);
    let (repo, _, rels) = open_repo_and_relpaths(&[abs.to_string_lossy().into_owned()])?;
    let rel = &rels[0];

    // The text gives each line its content. Read it first: the size cap and
    // the binary check also spare a blame of a file that can't be shown.
    let raw = read_capped(&abs)?;
    // Simple binary check: any NUL in the first 8K means binary.
    let probe_end = raw.len().min(8192);
    if raw[..probe_end].contains(&0u8) {
        return Err("file appears to be binary".to_string());
    }

    let mut opts = BlameOptions::new();
    opts.track_copies_same_file(true);
    let blame = repo
        .blame_file(rel, Some(&mut opts))
        .map_err(|e| format!("blame_file: {}", e))?;
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

/// `p` made absolute with its folders resolved but not its last part, so a
/// symlink stays the link, which is what git tracks, not its target.
fn resolve_folders(p: &str) -> PathBuf {
    let p = Path::new(p);
    match (p.parent(), p.file_name()) {
        (Some(parent), Some(name)) if !parent.as_os_str().is_empty() => {
            canonicalize_soft(parent).join(name)
        }
        _ => canonicalize_soft(p),
    }
}

/// Open the repo containing `paths[0]` and return it with its workdir and
/// each path relative to that workdir. A symlink in `paths` stands for
/// itself, not its target.
fn open_repo_and_relpaths(
    paths: &[String],
) -> Result<(git2::Repository, PathBuf, Vec<PathBuf>), String> {
    use git2::Repository;
    if paths.is_empty() {
        return Err("no paths".to_string());
    }
    let first = resolve_folders(&paths[0]);
    // libgit2 resolves the path it starts from, so a link starts from its
    // folder. A real folder starts from itself, since it may be the root.
    let real_dir = std::fs::symlink_metadata(&first).is_ok_and(|m| m.is_dir());
    let start = if real_dir { first.as_path() } else { first.parent().unwrap_or(&first) };
    let repo = Repository::discover(start).map_err(|e| format!("not a git repo: {}", e))?;
    let workdir = canonicalize_soft(
        repo.workdir()
            .ok_or_else(|| "bare repo has no workdir".to_string())?,
    );
    let mut rels = Vec::with_capacity(paths.len());
    for p in paths {
        let abs = resolve_folders(p);
        let rel = abs
            .strip_prefix(&workdir)
            .map_err(|_| format!("{} is not inside repo {}", abs.display(), workdir.display()))?
            .to_path_buf();
        rels.push(rel);
    }
    Ok((repo, workdir, rels))
}

/// `rel` as git writes paths, `/`-separated; `None` if it isn't UTF-8.
fn git_path(rel: &Path) -> Option<String> {
    let parts = rel
        .components()
        .map(|c| match c {
            std::path::Component::Normal(s) => s.to_str(),
            _ => None,
        })
        .collect::<Option<Vec<_>>>()?;
    Some(parts.join("/"))
}

/// Whether git path `p` is `dir` or inside it. `""` is the repo's root.
fn git_path_under(p: &str, dir: &str) -> bool {
    dir.is_empty()
        || p.strip_prefix(dir)
            .is_some_and(|rest| rest.is_empty() || rest.starts_with('/'))
}

/// Whether libgit2 reads pathspec `spec` as the plain path it is, which
/// also matches what's under it when it's a folder. Glob characters, a
/// leading `!` or `#`, a line break and trailing whitespace make it mean
/// something else.
fn literal_pathspec(spec: &str) -> bool {
    !spec.is_empty()
        && !spec.contains(['*', '?', '[', ']', '\\', '\n', '\x0b', '\x0c'])
        && !spec.starts_with(['!', '#'])
        && !spec.ends_with(char::is_whitespace)
}

/// The nearest of git path `dir` and its parents that libgit2 reads as the
/// plain path it is, to narrow a scan of `dir` with. `None`: scan everything.
///
/// Escaping an unusual name instead doesn't work everywhere: on Windows,
/// git2 turns every `\` in a pathspec into `/`.
fn literal_scope(dir: &str) -> Option<&str> {
    let mut d = dir;
    while !d.is_empty() {
        if literal_pathspec(d) {
            return Some(d);
        }
        d = d.rfind('/').map_or("", |i| &d[..i]);
    }
    None
}

/// `git reset -- <paths>` on `index` (`""` is the repo's root): each file at
/// or under one of `paths` that differs gets `head`'s entry back, or leaves
/// the index if `head` doesn't have it (all of them when there's no HEAD).
/// A conflict on it is dropped. The paths are taken exactly, not as
/// patterns. The caller writes the index.
fn reset_to_head(
    repo: &git2::Repository,
    index: &mut git2::Index,
    head: Option<&git2::Tree>,
    paths: &[String],
) -> Result<(), String> {
    let mut opts = git2::DiffOptions::new();
    opts.disable_pathspec_match(true);
    if !paths.iter().any(|p| p.is_empty()) {
        for p in paths {
            opts.pathspec(p.as_str());
        }
    }
    let diff = repo
        .diff_tree_to_index(head, Some(index), Some(&mut opts))
        .map_err(|e| format!("diff HEAD to index: {}", e))?;
    let changed: Vec<(Vec<u8>, PathBuf)> = diff
        .deltas()
        .filter_map(|d| {
            let f = if d.new_file().path().is_some() { d.new_file() } else { d.old_file() };
            Some((f.path_bytes()?.to_vec(), f.path()?.to_path_buf()))
        })
        .collect();
    drop(diff);
    for (bytes, path) in changed {
        // Stage 0, then the three sides of a conflict.
        for stage in 0..=3 {
            match index.remove(&path, stage) {
                Err(e) if e.code() != git2::ErrorCode::NotFound => {
                    return Err(format!("remove {}: {}", path.display(), e))
                }
                _ => {}
            }
        }
        if let Some(entry) = head.and_then(|t| t.get_path(&path).ok()) {
            index
                .add(&git2::IndexEntry {
                    ctime: git2::IndexTime::new(0, 0),
                    mtime: git2::IndexTime::new(0, 0),
                    dev: 0,
                    ino: 0,
                    mode: entry.filemode() as u32,
                    uid: 0,
                    gid: 0,
                    file_size: 0,
                    id: entry.id(),
                    flags: 0,
                    flags_extended: 0,
                    path: bytes,
                })
                .map_err(|e| format!("add {}: {}", path.display(), e))?;
        }
    }
    Ok(())
}

/// Write `files` (git paths of files in HEAD) to disk as HEAD has them,
/// taking each path exactly, and leave the index alone.
///
/// `checkout_head` reads its paths as patterns unless
/// GIT_CHECKOUT_DISABLE_PATHSPEC_MATCH is set, which git2 0.19 can't do
/// (0.21's `disable_pathspec_match` can), so the flag goes on the raw
/// options. The index isn't updated here because checkout still reads the
/// paths as patterns to choose the conflicts it drops: a name that starts
/// with `#` reads as nothing, which means every conflict in the repo.
fn checkout_head_exact(repo: &git2::Repository, files: &[String]) -> Result<(), String> {
    let mut opts = git2::build::CheckoutBuilder::new();
    opts.force().update_index(false);
    for p in files {
        opts.path(p.as_str());
    }
    // libgit2 also narrows its walk to the paths' common prefix, read with
    // `\` as an escape, which leaves out a name that has one. "/" matches no
    // path and leaves no common prefix.
    if files.iter().any(|p| p.contains('\\')) {
        opts.path("/");
    }
    let gitdir = git2::IntoCString::into_c_string(repo.path()).map_err(|e| e.to_string())?;
    #[allow(clippy::unnecessary_cast)] // u32, but i32 under MSVC
    let exact = libgit2_sys::GIT_CHECKOUT_DISABLE_PATHSPEC_MATCH as u32;
    // SAFETY: `raw_opts` points into `opts`, which outlives it, and `handle`
    // is a repository of our own, freed before leaving.
    let rc = unsafe {
        let mut raw_opts: libgit2_sys::git_checkout_options = std::mem::zeroed();
        let mut rc = libgit2_sys::git_checkout_init_options(
            &mut raw_opts,
            libgit2_sys::GIT_CHECKOUT_OPTIONS_VERSION,
        );
        if rc == 0 {
            opts.configure(&mut raw_opts);
            raw_opts.checkout_strategy |= exact;
            let mut handle = std::ptr::null_mut();
            rc = libgit2_sys::git_repository_open(&mut handle, gitdir.as_ptr());
            if rc == 0 {
                rc = libgit2_sys::git_checkout_head(handle, &raw_opts);
                libgit2_sys::git_repository_free(handle);
            }
        }
        rc
    };
    if rc < 0 {
        let why = git2::Error::last_error(rc).map_or_else(|| format!("error {}", rc), |e| e.to_string());
        return Err(format!("checkout_head: {}", why));
    }
    Ok(())
}

/// The status of `dir` and everything under it (`""` is the whole repo), as
/// (git path, flags). An untracked folder comes back as one `sub/` entry
/// unless `recurse_untracked`. Ignored files and submodules aren't listed.
fn statuses_under(
    repo: &git2::Repository,
    dir: &str,
    recurse_untracked: bool,
) -> Result<Vec<(String, git2::Status)>, String> {
    let mut opts = git2::StatusOptions::new();
    opts.include_untracked(true)
        .include_ignored(false)
        .exclude_submodules(true)
        .recurse_untracked_dirs(recurse_untracked);
    // The pathspec only narrows the scan; the filter below decides.
    if let Some(scope) = literal_scope(dir) {
        opts.pathspec(scope);
    }
    let statuses = repo
        .statuses(Some(&mut opts))
        .map_err(|e| format!("git status: {}", e))?;
    Ok(statuses
        .iter()
        .filter_map(|s| {
            let p = s.path()?;
            git_path_under(p.trim_end_matches('/'), dir).then(|| (p.to_string(), s.status()))
        })
        .collect())
}

#[tauri::command(async)]
pub fn git_stage(paths: Vec<String>) -> Result<(), String> {
    let (repo, workdir, rels) = open_repo_and_relpaths(&paths)?;
    let mut index = repo.index().map_err(|e| e.to_string())?;
    for rel in &rels {
        match std::fs::symlink_metadata(workdir.join(rel)) {
            Ok(m) if m.is_dir() => stage_folder(&mut index, &workdir, rel)?,
            Ok(_) => index
                .add_path(rel)
                .map_err(|e| format!("add_path {}: {}", rel.display(), e))?,
            // Gone from disk: stage the removal.
            Err(_) => index
                .remove_path(rel)
                .map_err(|e| format!("remove_path {}: {}", rel.display(), e))?,
        }
    }
    index.write().map_err(|e| format!("index.write: {}", e))?;
    Ok(())
}

/// `git add <folder>`: add the new and changed files under `rel`, skipping
/// ignored ones (libgit2's `add_path` takes files only), and stage the
/// removal of tracked files under it that are gone from disk.
fn stage_folder(index: &mut git2::Index, workdir: &Path, rel: &Path) -> Result<(), String> {
    let dir = git_path(rel).ok_or_else(|| format!("{}: name isn't valid UTF-8", rel.display()))?;
    // add_all reads its pathspec as a pattern, so an unusual name goes
    // through its nearest plain parent (or the whole repo), and `keep` picks
    // what's under it.
    let spec = literal_scope(&dir).unwrap_or("*");
    let mut keep = |p: &Path, _: &[u8]| i32::from(!git_path_under(&p.to_string_lossy(), &dir));
    let filter = (spec != dir).then_some(&mut keep as &mut git2::IndexMatchedPath);
    index
        .add_all([spec], git2::IndexAddOption::DEFAULT, filter)
        .map_err(|e| format!("add_all {}: {}", dir, e))?;
    let gone: Vec<PathBuf> = index
        .iter()
        .filter_map(|e| String::from_utf8(e.path).ok())
        .filter(|p| git_path_under(p, &dir))
        .map(|p| p.split('/').collect::<PathBuf>())
        .filter(|p| std::fs::symlink_metadata(workdir.join(p)).is_err())
        .collect();
    for p in gone {
        index
            .remove_path(&p)
            .map_err(|e| format!("remove_path {}: {}", p.display(), e))?;
    }
    Ok(())
}

#[tauri::command(async)]
pub fn git_unstage(paths: Vec<String>) -> Result<(), String> {
    let (repo, _, rels) = open_repo_and_relpaths(&paths)?;
    // Equivalent of `git reset HEAD -- path`: reset the index entries for
    // these paths to match HEAD. If there is no HEAD yet (fresh repo with no
    // commits), the entries just leave the index.
    let head = repo.head().and_then(|h| h.peel_to_tree()).ok();
    let mut specs = Vec::with_capacity(rels.len());
    for rel in &rels {
        specs.push(git_path(rel).ok_or_else(|| format!("{}: name isn't valid UTF-8", rel.display()))?);
    }
    let mut index = repo.index().map_err(|e| e.to_string())?;
    reset_to_head(&repo, &mut index, head.as_ref(), &specs)?;
    index.write().map_err(|e| format!("index.write: {}", e))?;
    Ok(())
}

/// What `git_discard` did, for the frontend's report.
#[derive(Debug, Serialize, Default)]
pub struct DiscardResult {
    /// Files put back as HEAD has them, in the index and on disk.
    pub restored: usize,
    /// Untracked files and folders moved to the trash.
    pub trashed: usize,
    /// Paths left as they were.
    pub skipped: Vec<DiscardSkip>,
}

#[derive(Debug, Serialize)]
pub struct DiscardSkip {
    /// Relative to the repo's root and `/`-separated, as `git status` prints
    /// it; `.` for the root.
    pub path: String,
    pub reason: String,
}

fn discard_skip(path: &str, reason: impl Into<String>) -> DiscardSkip {
    let path = path.trim_end_matches('/');
    DiscardSkip {
        path: if path.is_empty() { ".".into() } else { path.into() },
        reason: reason.into(),
    }
}

#[tauri::command(async)]
pub fn git_discard(paths: Vec<String>) -> Result<DiscardResult, String> {
    discard_paths(&paths, |p| super::trash::trash_path(p).map(|_| ()))
}

/// Discard makes each path match HEAD, but never destroys what git can't
/// give back:
/// - files in HEAD with a change are restored from HEAD;
/// - untracked files and folders go to `trash`, a folder whole only when
///   nothing under it is in the index;
/// - files staged but never committed, ignored paths and nested repos are
///   left alone and reported.
fn discard_paths(
    paths: &[String],
    trash: impl Fn(&Path) -> Result<(), String>,
) -> Result<DiscardResult, String> {
    use git2::{DiffOptions, Status};
    let (repo, workdir, rels) = open_repo_and_relpaths(paths)?;
    let mut index = repo.index().map_err(|e| e.to_string())?;
    let head_tree = repo.head().and_then(|h| h.peel_to_tree()).ok();
    let in_head = |p: &str| head_tree.as_ref().is_some_and(|t| t.get_path(Path::new(p)).is_ok());
    let abs = |p: &str| {
        p.trim_end_matches('/')
            .split('/')
            .fold(workdir.clone(), |a, part| a.join(part))
    };
    let nested_repo = |p: &str| std::fs::symlink_metadata(abs(p).join(".git")).is_ok();

    let mut out = DiscardResult::default();
    let mut restore: Vec<String> = Vec::new();
    let mut to_trash: Vec<String> = Vec::new();
    for rel in &rels {
        let Some(path) = git_path(rel) else {
            out.skipped.push(discard_skip(&rel.to_string_lossy(), "name isn't valid UTF-8"));
            continue;
        };
        let tracked = path.is_empty()
            || in_head(&path)
            || (0..=3).any(|stage| index.get_path(rel, stage).is_some())
            || index.find_prefix(format!("{}/", path)).is_ok();
        if !tracked {
            // Nothing of it is in git, so only the trash can give it back.
            let reason = match std::fs::symlink_metadata(workdir.join(rel)) {
                Err(_) => Some("not found"),
                Ok(_) if repo.is_path_ignored(rel).unwrap_or(false) => Some("ignored"),
                Ok(m) if m.is_dir() && nested_repo(&path) => Some("a separate git repository"),
                Ok(_) if statuses_under(&repo, &path, true)?.is_empty() => {
                    Some("no changes (only ignored files)")
                }
                Ok(_) => None,
            };
            match reason {
                Some(r) => out.skipped.push(discard_skip(&path, r)),
                None => to_trash.push(path),
            }
            continue;
        }
        let entries = statuses_under(&repo, &path, false)?;
        if entries.is_empty() {
            out.skipped.push(discard_skip(&path, "no changes"));
        }
        for (p, st) in entries {
            if st == Status::WT_NEW {
                if p.ends_with('/') && nested_repo(&p) {
                    out.skipped.push(discard_skip(&p, "a separate git repository"));
                } else {
                    to_trash.push(p);
                }
            } else if st.contains(Status::INDEX_NEW) {
                out.skipped.push(discard_skip(&p, "staged but never committed; unstage it first"));
            } else if in_head(&p) {
                restore.push(p);
            } else {
                out.skipped.push(discard_skip(&p, "not in the last commit"));
            }
        }
    }
    restore.sort();
    restore.dedup();
    to_trash.sort();
    to_trash.dedup();

    if !restore.is_empty() {
        checkout_head_exact(&repo, &restore)?;
        reset_to_head(&repo, &mut index, head_tree.as_ref(), &restore)?;
        // The entries put back carry no file times, so every status would
        // hash these files again. This diff records them in the index.
        let mut opts = DiffOptions::new();
        opts.disable_pathspec_match(true).update_index(true);
        for p in &restore {
            opts.pathspec(p.as_str());
        }
        repo.diff_index_to_workdir(Some(&index), Some(&mut opts))
            .map_err(|e| format!("refresh index: {}", e))?;
        index.write().map_err(|e| format!("index.write: {}", e))?;
        out.restored = restore.len();
    }
    for p in to_trash {
        match trash(&abs(&p)) {
            Ok(()) => out.trashed += 1,
            Err(e) => out.skipped.push(discard_skip(&p, format!("couldn't move it to the trash: {}", e))),
        }
    }
    Ok(out)
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

#[tauri::command(async)]
pub fn git_file_info(cwd: String, path: String) -> Result<GitFileInfo, String> {
    let mut out = GitFileInfo::default();

    // Cheap repo check first — a subprocess spawn per selection is too
    // expensive when the file isn't in a git repo at all.
    let Ok(repo) = git2::Repository::discover(&cwd) else {
        return Ok(out);
    };

    // This runs whenever the selection changes, so it must not run anything
    // the repo's own config names: a cloned or unzipped repo is untrusted.
    // `--no-show-signature`: with log.showSignature set, a forged signature
    // on a commit made git run the repo's gpg.program.
    //
    // log -1 --format=%cr%n%an%n%h -- <path>
    // Must go through build_git_command so CREATE_NO_WINDOW is applied — this
    // runs on every file-selection change; without the flag every click
    // flashes a cmd.exe console on Windows.
    if let Ok(o) = build_git_command(&cwd)
        .args(["log", "-1", "--no-show-signature", "--format=%cr%n%an%n%h", "--"])
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

    // Lines added/removed vs HEAD (`git diff --numstat HEAD -- <path>`), via
    // libgit2: the git CLI runs the repo's core.fsmonitor and filter clean
    // commands when it compares the working tree; libgit2 runs neither.
    if let Some((added, removed)) = numstat_vs_head(&repo, Path::new(&cwd), Path::new(&path)) {
        out.added = added;
        out.removed = removed;
    }

    Ok(out)
}

/// Insertions and deletions in `path` between HEAD and the working tree.
/// None if there's no HEAD or `path` isn't inside the repo's working tree.
fn numstat_vs_head(repo: &git2::Repository, cwd: &Path, path: &Path) -> Option<(u32, u32)> {
    let workdir = repo.workdir()?;
    let abs = cwd.join(path);
    let rel = abs.strip_prefix(workdir).map(Path::to_path_buf).or_else(|_| {
        // Fall back to canonical forms (symlinked folders, `\\?\` prefixes).
        let abs = dunce::canonicalize(&abs).map_err(|_| ())?;
        let workdir = dunce::canonicalize(workdir).map_err(|_| ())?;
        abs.strip_prefix(&workdir).map(Path::to_path_buf).map_err(|_| ())
    });
    let rel = rel.ok()?;
    // libgit2 pathspecs use `/` on every platform.
    let spec: Vec<String> = rel
        .components()
        .map(|c| c.as_os_str().to_string_lossy().into_owned())
        .collect();
    if spec.is_empty() {
        return None;
    }
    let head = repo.head().ok()?.peel_to_tree().ok()?;
    let mut opts = git2::DiffOptions::new();
    opts.pathspec(spec.join("/")).disable_pathspec_match(true);
    let diff = repo
        .diff_tree_to_workdir_with_index(Some(&head), Some(&mut opts))
        .ok()?;
    let stats = diff.stats().ok()?;
    Some((stats.insertions() as u32, stats.deletions() as u32))
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
    /// The upstream is configured but its ref no longer exists (deleted on
    /// the remote and pruned), so ahead/behind are 0 without meaning "in sync".
    pub upstream_gone: bool,
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

/// One subcommand `git_run` may run, with the arguments it may take.
struct GitRunSpec {
    name: &'static str,
    /// Options allowed as-is.
    flags: &'static [&'static str],
    /// Options whose value is the next argument, taken as-is (a commit
    /// message may start with `-`), just as git itself parses them.
    valued: &'static [&'static str],
    /// How many plain arguments (branch names…) may follow.
    positionals: usize,
}

/// The commands the git menu sends (src/handlers/git.ts). A new menu item
/// that runs something else needs an entry here.
const GIT_RUN_ALLOWED: &[GitRunSpec] = &[
    GitRunSpec { name: "status", flags: &["--short"], valued: &[], positionals: 0 },
    GitRunSpec { name: "commit", flags: &["--amend"], valued: &["-m"], positionals: 0 },
    GitRunSpec { name: "pull", flags: &["--ff-only"], valued: &[], positionals: 0 },
    GitRunSpec { name: "push", flags: &[], valued: &[], positionals: 0 },
    GitRunSpec { name: "fetch", flags: &["--all", "--prune"], valued: &[], positionals: 0 },
    GitRunSpec { name: "stash", flags: &["-u"], valued: &[], positionals: 1 },
    GitRunSpec {
        name: "log",
        flags: &["--oneline", "--graph", "--decorate", "--all"],
        valued: &["-n"],
        positionals: 0,
    },
    GitRunSpec { name: "clean", flags: &["-fd"], valued: &[], positionals: 0 },
    GitRunSpec { name: "checkout", flags: &["--"], valued: &["-b"], positionals: 1 },
    GitRunSpec { name: "merge", flags: &["--no-edit"], valued: &[], positionals: 1 },
    GitRunSpec { name: "rebase", flags: &[], valued: &[], positionals: 1 },
];

/// Check `git_run` arguments against GIT_RUN_ALLOWED. The subcommand must
/// come first, so no global option gets in (`-c core.sshCommand=…`, `-C`,
/// `--exec-path`), and a plain argument can't start with `-`, so neither can
/// an option that runs a command (`fetch --upload-pack=…`, `rebase --exec`).
///
/// No paths either: `--` is taken only last, and `checkout` must end with
/// it, because `git checkout docs` restores the folder `docs` when there's
/// no branch of that name, and `git checkout docs --` only switches.
fn check_git_args(args: &[String]) -> Result<(), String> {
    let (sub, rest) = args.split_first().ok_or("git_run: no git subcommand")?;
    let spec = GIT_RUN_ALLOWED
        .iter()
        .find(|s| s.name == sub)
        .ok_or_else(|| format!("git_run: `git {}` isn't one of the git menu's commands", sub))?;
    let mut positionals = 0;
    let mut it = rest.iter();
    while let Some(a) = it.next() {
        if spec.flags.contains(&a.as_str()) {
            if a == "--" && it.len() > 0 {
                return Err(format!("git_run: `git {}` takes no paths after `--`", sub));
            }
            continue;
        }
        if spec.valued.contains(&a.as_str()) {
            it.next()
                .ok_or_else(|| format!("git_run: `{}` needs a value", a))?;
            continue;
        }
        // A lone `-` is git's "previous branch", not an option.
        if a.starts_with('-') && a != "-" {
            return Err(format!("git_run: `git {}` doesn't take `{}` here", sub, a));
        }
        positionals += 1;
        if positionals > spec.positionals {
            return Err(format!("git_run: too many arguments for `git {}`", sub));
        }
    }
    if spec.name == "checkout" && positionals > 0 && rest.last().is_none_or(|a| a != "--") {
        return Err("git_run: `git checkout <branch>` must end with `--`".to_string());
    }
    Ok(())
}

#[tauri::command(async)]
pub fn git_run(cwd: String, args: Vec<String>) -> Result<GitRunResult, String> {
    check_git_args(&args)?;
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

#[tauri::command(async)]
pub fn git_branch_list(cwd: String) -> Result<Vec<GitBranch>, String> {
    // One for-each-ref gives every branch's ahead/behind via upstream:track,
    // instead of a rev-list per branch. Its words ("ahead", "behind", "gone")
    // are translated, so ask for the untranslated ones.
    let mut cmd = build_git_command(&cwd);
    cmd.env("LC_ALL", "C");
    cmd.args([
        "for-each-ref",
        "--format=%(refname:short)\t%(HEAD)\t%(upstream:short)\t%(upstream:track,nobracket)",
        "refs/heads/",
    ]);
    let out = cmd.output().map_err(|e| classify_spawn_err(&e))?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).into_owned());
    }
    let text = String::from_utf8_lossy(&out.stdout);
    let mut branches = Vec::new();
    for line in text.lines() {
        let mut it = line.splitn(4, '\t');
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
        let (ahead, behind, upstream_gone) = parse_upstream_track(it.next().unwrap_or(""));

        branches.push(GitBranch {
            name,
            current,
            upstream,
            ahead,
            behind,
            upstream_gone,
        });
    }
    Ok(branches)
}

/// Parse `%(upstream:track,nobracket)` as git prints it under LC_ALL=C: ""
/// (in sync, or no upstream), "gone", "ahead 3", "behind 2" or
/// "ahead 3, behind 2". Returns (ahead, behind, gone).
fn parse_upstream_track(track: &str) -> (u32, u32, bool) {
    let track = track.trim();
    if track == "gone" {
        return (0, 0, true);
    }
    let (mut ahead, mut behind) = (0, 0);
    for part in track.split(", ") {
        match part.split_once(' ') {
            Some(("ahead", n)) => ahead = n.parse().unwrap_or(0),
            Some(("behind", n)) => behind = n.parse().unwrap_or(0),
            _ => {}
        }
    }
    (ahead, behind, false)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::testing::{commit_all, put, read, s, temp_dir, test_repo, tree};

    fn args(a: &[&str]) -> Vec<String> {
        a.iter().map(|x| x.to_string()).collect()
    }

    #[test]
    fn git_status_codes_match_list_dir() {
        let (dir, repo) = test_repo("gitcodes");
        std::fs::write(dir.join("modified.txt"), "v1").unwrap();
        std::fs::write(dir.join("deleted.txt"), "v1").unwrap();
        commit_all(&repo, "init");
        std::fs::write(dir.join("modified.txt"), "v2").unwrap();
        std::fs::remove_file(dir.join("deleted.txt")).unwrap();
        std::fs::write(dir.join("untracked.txt"), "new").unwrap();
        std::fs::write(dir.join("staged.txt"), "new").unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(Path::new("staged.txt")).unwrap();
        index.write().unwrap();

        let expected = [
            ("modified.txt", "M"),
            ("deleted.txt", "D"),
            ("untracked.txt", "?"),
            ("staged.txt", "A"),
        ];
        let info = git_status(dir.to_string_lossy().into_owned()).unwrap();
        let listed: HashMap<String, String> = scan_repo_statuses(&dir)
            .unwrap()
            .into_iter()
            .map(|(p, code)| (p.file_name().unwrap().to_string_lossy().into_owned(), code))
            .collect();
        for (name, code) in expected {
            assert_eq!(
                info.status.get(name).map(String::as_str),
                Some(code),
                "git_status {}",
                name
            );
            assert_eq!(
                listed.get(name).map(String::as_str),
                Some(code),
                "list_dir {}",
                name
            );
        }
        assert_eq!(info.status.len(), expected.len());
        assert_eq!(info.dirty, expected.len());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn status_pathspec_scopes_plain_folders_only() {
        let wd = Path::new("/repo");
        assert_eq!(status_pathspec(wd, wd), None);
        assert_eq!(status_pathspec(wd, &wd.join("src")), Some("src".into()));
        assert_eq!(
            status_pathspec(wd, &wd.join("src").join("deep dir")),
            Some("src/deep dir".into())
        );
        assert_eq!(status_pathspec(wd, Path::new("/elsewhere/src")), None);
        for odd in ["a*b", "a?b", "a[b]", "trail "] {
            assert_eq!(status_pathspec(wd, &wd.join("src").join(odd)), None, "{}", odd);
        }
        // `!` and `#` only mean something at the start of the pathspec.
        assert_eq!(status_pathspec(wd, &wd.join("!neg")), None);
        assert_eq!(status_pathspec(wd, &wd.join("#hash")), None);
        assert_eq!(
            status_pathspec(wd, &wd.join("src").join("!x")),
            Some("src/!x".into())
        );
        #[cfg(not(windows))]
        assert_eq!(status_pathspec(wd, &wd.join("back\\slash")), None);
    }

    #[test]
    fn parse_upstream_track_reads_counts_and_gone() {
        assert_eq!(parse_upstream_track(""), (0, 0, false));
        assert_eq!(parse_upstream_track("gone"), (0, 0, true));
        assert_eq!(parse_upstream_track("ahead 3"), (3, 0, false));
        assert_eq!(parse_upstream_track("behind 2"), (0, 2, false));
        assert_eq!(parse_upstream_track("ahead 3, behind 12"), (3, 12, false));
    }

    #[test]
    fn git_branch_list_reads_tracking_from_one_call() {
        if which::which("git").is_err() {
            return;
        }
        let (dir, repo) = test_repo("gitbranches");
        std::fs::write(dir.join("f.txt"), "v1").unwrap();
        let base = repo.find_commit(commit_all(&repo, "init")).unwrap();
        let tree = base.tree().unwrap();
        let sig = git2::Signature::now("test", "test@example.com").unwrap();
        let one = repo.commit(None, &sig, &sig, "one", &tree, &[&base]).unwrap();
        let one = repo.find_commit(one).unwrap();
        let two = repo.commit(None, &sig, &sig, "two", &tree, &[&one]).unwrap();
        let two = repo.find_commit(two).unwrap();
        // feature: two commits ahead of its upstream, main.
        let mut feature = repo.branch("feature", &two, false).unwrap();
        feature.set_upstream(Some("main")).unwrap();
        // stale: its upstream branch was deleted afterwards.
        repo.branch("doomed", &base, false).unwrap();
        let mut stale = repo.branch("stale", &base, false).unwrap();
        stale.set_upstream(Some("doomed")).unwrap();
        repo.find_branch("doomed", git2::BranchType::Local)
            .unwrap()
            .delete()
            .unwrap();

        let branches = git_branch_list(dir.to_string_lossy().into_owned()).unwrap();
        let get = |n: &str| branches.iter().find(|b| b.name == n).unwrap();
        let main = get("main");
        assert!(main.current);
        assert_eq!(main.upstream, None);
        assert_eq!((main.ahead, main.behind, main.upstream_gone), (0, 0, false));
        let feature = get("feature");
        assert_eq!(feature.upstream.as_deref(), Some("main"));
        assert_eq!((feature.ahead, feature.behind, feature.upstream_gone), (2, 0, false));
        let stale = get("stale");
        assert_eq!((stale.ahead, stale.behind, stale.upstream_gone), (0, 0, true));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn upstream_ahead_behind_counts_and_nothing_to_compare() {
        let (dir, repo) = test_repo("aheadbehind");
        let cwd = dir.to_string_lossy().into_owned();
        assert_eq!(upstream_ahead_behind(&repo).unwrap(), None, "unborn HEAD");
        std::fs::write(dir.join("a.txt"), "1").unwrap();
        let base = commit_all(&repo, "one");
        assert_eq!(upstream_ahead_behind(&repo).unwrap(), None, "no upstream");

        // A fake origin/main at the first commit, then two local commits.
        repo.remote("origin", "https://example.invalid/repo.git")
            .unwrap();
        repo.reference("refs/remotes/origin/main", base, true, "test")
            .unwrap();
        repo.find_branch("main", git2::BranchType::Local)
            .unwrap()
            .set_upstream(Some("origin/main"))
            .unwrap();
        std::fs::write(dir.join("a.txt"), "2").unwrap();
        commit_all(&repo, "two");
        std::fs::write(dir.join("a.txt"), "3").unwrap();
        let tip = commit_all(&repo, "three");
        assert_eq!(upstream_ahead_behind(&repo).unwrap(), Some((2, 0)));
        let info = git_status(cwd).unwrap();
        assert_eq!((info.ahead, info.behind), (2, 0));

        // Swap them: local main at the first commit, origin/main at the tip.
        repo.reference("refs/remotes/origin/main", tip, true, "test")
            .unwrap();
        repo.reference("refs/heads/main", base, true, "test")
            .unwrap();
        assert_eq!(upstream_ahead_behind(&repo).unwrap(), Some((0, 2)));

        repo.set_head_detached(base).unwrap();
        assert_eq!(upstream_ahead_behind(&repo).unwrap(), None, "detached HEAD");
        repo.set_head("refs/heads/main").unwrap();
        repo.find_reference("refs/remotes/origin/main")
            .unwrap()
            .delete()
            .unwrap();
        assert_eq!(upstream_ahead_behind(&repo).unwrap(), None, "upstream gone");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn git_status_outside_a_repo_is_none() {
        let dir = temp_dir("norepo");
        // Only meaningful when the temp dir isn't itself inside a repo.
        if git2::Repository::discover(&dir).is_err() {
            assert!(git_status(s(&dir)).is_none());
            // libgit2 reports a path that doesn't exist as NotFound too.
            assert!(git_status(s(&dir.join("missing"))).is_none());
        }
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn git_args_accepts_the_git_menu() {
        // Every shape src/handlers/git.ts sends.
        let ok: &[&[&str]] = &[
            &["status", "--short"],
            &["commit", "-m", "fix: things"],
            &["commit", "-m", "-starts with a dash"],
            &["commit", "--amend", "-m", "msg"],
            &["pull", "--ff-only"],
            &["push"],
            &["fetch", "--all", "--prune"],
            &["stash", "push", "-u"],
            &["log", "--oneline", "--graph", "--decorate", "--all", "-n", "200"],
            &["clean", "-fd"],
            &["checkout", "main", "--"],
            &["checkout", "feature/x", "--"],
            &["checkout", "-", "--"],
            &["checkout", "-b", "feature/new"],
            &["merge", "main", "--no-edit"],
            &["rebase", "main"],
        ];
        for a in ok {
            assert!(check_git_args(&args(a)).is_ok(), "{:?}", a);
        }
    }

    #[test]
    fn git_args_refuses_options_that_run_commands() {
        let bad: &[&[&str]] = &[
            &[],
            &["-c", "core.sshCommand=calc", "fetch"],
            &["-C", "/tmp", "status"],
            &["--exec-path=/tmp", "status"],
            &["config", "core.fsmonitor", "calc"],
            &["fetch", "--upload-pack=calc"],
            &["pull", "--upload-pack", "calc"],
            &["push", "--receive-pack=calc"],
            &["rebase", "--exec", "calc", "main"],
            &["rebase", "-x", "calc", "main"],
            &["log", "--output=/tmp/x"],
            &["commit", "-m"],
            &["checkout", "a", "b", "--"],
            // Paths: what `git checkout` restores.
            &["checkout", "docs"],
            &["checkout", "-"],
            &["checkout", "--", "docs"],
            &["checkout", "main", "--", "docs"],
            &["status", "--"],
            &["merge", "--no-edit", "-s", "evil", "main"],
            &["clean", "-fdx"],
        ];
        for a in bad {
            assert!(check_git_args(&args(a)).is_err(), "{:?}", a);
        }
    }

    /// git_file_info runs on every selection change, so a hostile repo's
    /// config must not get to run anything. Checks the setup really is
    /// hostile to the plain git CLI first.
    #[cfg(unix)]
    #[test]
    fn git_file_info_runs_nothing_from_repo_config() {
        use std::os::unix::fs::PermissionsExt;
        if which::which("git").is_err() {
            return;
        }
        let dir = temp_dir("hostilerepo");
        let marker = |name: &str| dir.join(format!("PWNED_{}", name));
        let git = |a: &[&str]| {
            let st = std::process::Command::new("git")
                .current_dir(&dir)
                .args(["-c", "user.email=t@t", "-c", "user.name=t"])
                .args(a)
                .output()
                .unwrap();
            assert!(st.status.success(), "git {:?}: {}", a, String::from_utf8_lossy(&st.stderr));
        };
        git(&["init", "-q"]);
        std::fs::write(dir.join("a.txt"), "one\n").unwrap();
        git(&["add", "a.txt"]);
        git(&["commit", "-qm", "init"]);
        // A commit with a (bogus) signature, so log.showSignature calls gpg.
        let tree = std::process::Command::new("git")
            .current_dir(&dir)
            .args(["rev-parse", "HEAD^{tree}"])
            .output()
            .unwrap();
        let tree = String::from_utf8_lossy(&tree.stdout).trim().to_string();
        let raw = format!(
            "tree {}\nauthor t <t@t> 0 +0000\ncommitter t <t@t> 0 +0000\n\
             gpgsig -----BEGIN PGP SIGNATURE-----\n abc\n -----END PGP SIGNATURE-----\n\nsigned\n",
            tree
        );
        let mut hash = std::process::Command::new("git")
            .current_dir(&dir)
            .args(["hash-object", "-t", "commit", "-w", "--stdin"])
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .spawn()
            .unwrap();
        std::io::Write::write_all(&mut hash.stdin.take().unwrap(), raw.as_bytes()).unwrap();
        let sha = String::from_utf8_lossy(&hash.wait_with_output().unwrap().stdout).trim().to_string();
        git(&["update-ref", "HEAD", &sha]);

        let fake_gpg = dir.join("fake-gpg");
        std::fs::write(&fake_gpg, format!("#!/bin/sh\ntouch '{}'\n", s(&marker("gpg")))).unwrap();
        std::fs::set_permissions(&fake_gpg, std::fs::Permissions::from_mode(0o755)).unwrap();
        git(&["config", "gpg.program", &s(&fake_gpg)]);
        git(&["config", "log.showSignature", "true"]);
        git(&["config", "core.fsmonitor", &format!("touch '{}'; false", s(&marker("fsmonitor")))]);
        git(&["config", "filter.x.clean", &format!("touch '{}'; cat", s(&marker("clean")))]);
        std::fs::write(dir.join(".gitattributes"), "*.txt filter=x\n").unwrap();
        std::fs::write(dir.join("a.txt"), "one\ntwo\nthree\n").unwrap();

        // The plain CLI calls git_file_info used to make do run them all.
        for a in [
            &["log", "-1", "--format=%h", "--", "a.txt"][..],
            &["diff", "--numstat", "HEAD", "--", "a.txt"][..],
        ] {
            let _ = std::process::Command::new("git").current_dir(&dir).args(a).output();
        }
        for m in ["gpg", "fsmonitor", "clean"] {
            assert!(marker(m).exists(), "setup: {} didn't fire", m);
            std::fs::remove_file(marker(m)).unwrap();
        }

        let info = git_file_info(s(&dir), s(&dir.join("a.txt"))).unwrap();
        for m in ["gpg", "fsmonitor", "clean"] {
            assert!(!marker(m).exists(), "git_file_info ran the repo's {}", m);
        }
        assert_eq!((info.added, info.removed), (2, 0));
        assert!(info.sha.is_some());
        // A relative path, as from cwd, gives the same answer.
        let rel = git_file_info(s(&dir), "a.txt".into()).unwrap();
        assert_eq!((rel.added, rel.removed), (2, 0));
        let _ = std::fs::remove_dir_all(&dir);
    }

    // ---------- stage / unstage / discard ----------

    /// Stands in for the system trash: moves each path into `bin`.
    fn fake_trash(bin: &Path) -> impl Fn(&Path) -> Result<(), String> + '_ {
        move |p| {
            std::fs::rename(p, bin.join(p.file_name().unwrap())).map_err(|e| e.to_string())
        }
    }

    /// The index's paths, read fresh from disk.
    fn staged(dir: &Path) -> Vec<String> {
        let repo = git2::Repository::open(dir).unwrap();
        let index = repo.index().unwrap();
        index.iter().map(|e| String::from_utf8(e.path).unwrap()).collect()
    }

    /// One file's status, read fresh from disk.
    fn status_of(dir: &Path, p: &str) -> git2::Status {
        git2::Repository::open(dir).unwrap().status_file(Path::new(p)).unwrap()
    }

    fn stage_now(repo: &git2::Repository, paths: &[&str]) {
        let mut index = repo.index().unwrap();
        for p in paths {
            index.add_path(Path::new(p)).unwrap();
        }
        index.write().unwrap();
    }

    fn skips(r: &DiscardResult) -> Vec<(String, String)> {
        let mut v: Vec<_> = r.skipped.iter().map(|k| (k.path.clone(), k.reason.clone())).collect();
        v.sort();
        v
    }

    #[test]
    fn discard_restores_tracked_files_and_trashes_untracked_ones() {
        let (dir, repo) = test_repo("discard-basic");
        let bin = temp_dir("discard-basic-bin");
        put(&dir.join("tracked.txt"), "v1");
        put(&dir.join("src/edit.txt"), "v1");
        put(&dir.join("src/keep.txt"), "v1");
        commit_all(&repo, "init");
        put(&dir.join("tracked.txt"), "v2");
        put(&dir.join("src/edit.txt"), "v2");
        put(&dir.join("src/new.txt"), "new");
        put(&dir.join("src/staged.txt"), "staged");
        stage_now(&repo, &["src/staged.txt"]);
        put(&dir.join("untracked.txt"), "new");
        put(&dir.join("untracked_dir/a.txt"), "new");
        put(&dir.join("untracked_dir/b/c.txt"), "new");

        let paths = ["tracked.txt", "untracked.txt", "untracked_dir", "src"].map(|p| s(&dir.join(p)));
        let r = discard_paths(&paths, fake_trash(&bin)).unwrap();

        assert_eq!((r.restored, r.trashed), (2, 3));
        assert_eq!(read(&dir.join("tracked.txt")), "v1");
        assert_eq!(read(&dir.join("src/edit.txt")), "v1");
        assert_eq!(tree(&bin), ["new.txt", "untracked.txt", "untracked_dir/", "untracked_dir/a.txt", "untracked_dir/b/", "untracked_dir/b/c.txt"]);
        // Staged but never committed: only the index has it, so it stays.
        assert_eq!(read(&dir.join("src/staged.txt")), "staged");
        assert!(staged(&dir).contains(&"src/staged.txt".to_string()));
        assert_eq!(
            skips(&r),
            [("src/staged.txt".into(), "staged but never committed; unstage it first".into())]
        );
        let _ = std::fs::remove_dir_all(&dir);
        let _ = std::fs::remove_dir_all(&bin);
    }

    #[test]
    fn discard_leaves_ignored_staged_and_nested_repos_alone() {
        let (dir, repo) = test_repo("discard-keep");
        let bin = temp_dir("discard-keep-bin");
        put(&dir.join(".gitignore"), "build/\n*.log\n");
        put(&dir.join("clean.txt"), "v1");
        commit_all(&repo, "init");
        put(&dir.join("build/out.bin"), "ignored");
        put(&dir.join("debug.log"), "ignored");
        put(&dir.join("only_ignored/z.log"), "ignored");
        put(&dir.join("staged.txt"), "staged");
        put(&dir.join("staged_dir/x.txt"), "staged");
        put(&dir.join("staged_dir/y.txt"), "untracked beside a staged file");
        stage_now(&repo, &["staged.txt", "staged_dir/x.txt"]);
        let nested = git2::Repository::init(dir.join("nested")).unwrap();
        put(&dir.join("nested/inner.txt"), "its own repo");
        drop(nested);

        let names = ["build", "debug.log", "only_ignored", "staged.txt", "staged_dir", "nested", "clean.txt"];
        let before = tree(&dir);
        let r = discard_paths(&names.map(|p| s(&dir.join(p))), fake_trash(&bin)).unwrap();

        assert_eq!((r.restored, r.trashed), (0, 1), "{:?}", r);
        assert_eq!(tree(&bin), ["y.txt"]);
        let mut after = tree(&dir);
        after.push("staged_dir/y.txt".into());
        after.sort();
        assert_eq!(after, before);
        assert!(staged(&dir).contains(&"staged_dir/x.txt".to_string()));
        let staged_note = "staged but never committed; unstage it first";
        assert_eq!(
            skips(&r),
            [
                ("build", "ignored"),
                ("clean.txt", "no changes"),
                ("debug.log", "ignored"),
                ("nested", "a separate git repository"),
                ("only_ignored", "no changes (only ignored files)"),
                ("staged.txt", staged_note),
                ("staged_dir/x.txt", staged_note),
            ]
            .map(|(p, why)| (p.to_string(), why.to_string()))
        );
        let _ = std::fs::remove_dir_all(&dir);
        let _ = std::fs::remove_dir_all(&bin);
    }

    #[test]
    fn a_failed_trash_is_reported_and_the_rest_goes_on() {
        let (dir, repo) = test_repo("discard-trashfail");
        put(&dir.join("tracked.txt"), "v1");
        commit_all(&repo, "init");
        put(&dir.join("tracked.txt"), "v2");
        put(&dir.join("stuck.txt"), "new");
        let paths = ["stuck.txt", "tracked.txt"].map(|p| s(&dir.join(p)));
        let r = discard_paths(&paths, |_| Err("no trash here".into())).unwrap();
        assert_eq!((r.restored, r.trashed), (1, 0));
        assert_eq!(read(&dir.join("tracked.txt")), "v1");
        assert!(dir.join("stuck.txt").exists());
        assert_eq!(
            skips(&r),
            [("stuck.txt".into(), "couldn't move it to the trash: no trash here".into())]
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Discard each of `odd`, then unstage them all, in a repo that also has
    /// `plain`, names the odd ones match when read as patterns. The odd ones
    /// must be restored and unstaged, and the plain ones left alone.
    fn odd_names_are_taken_literally(name: &str, odd: &[&str], plain: &[&str]) {
        let (dir, repo) = test_repo(name);
        let all: Vec<&str> = odd.iter().chain(plain).copied().collect();
        for n in &all {
            put(&dir.join(n), "v1");
        }
        commit_all(&repo, "init");
        for n in &all {
            put(&dir.join(n), "v2");
        }
        for n in odd {
            let r = discard_paths(&[s(&dir.join(n))], fake_trash(&dir)).unwrap();
            assert_eq!((r.restored, r.trashed, r.skipped.len()), (1, 0, 0), "{}: {:?}", n, r);
        }
        for n in &all {
            let want = if odd.contains(n) { "v1" } else { "v2" };
            assert_eq!(read(&dir.join(n)), want, "{}", n);
        }

        for n in &all {
            put(&dir.join(n), "v3");
        }
        stage_now(&repo, &all);
        git_unstage(odd.iter().map(|n| s(&dir.join(n))).collect()).unwrap();
        for n in &all {
            let st = status_of(&dir, n);
            assert_eq!(st.contains(git2::Status::INDEX_MODIFIED), plain.contains(n), "{}: {:?}", n, st);
        }
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Read as patterns, `a[1].txt` matches `a1.txt`, a leading `!` negates
    /// and a leading `#` makes a comment. Escaping them with `\` doesn't work
    /// on Windows, where git2 turns `\` into `/`.
    #[test]
    fn discard_and_unstage_take_odd_names_literally() {
        odd_names_are_taken_literally(
            "discard-odd",
            &["a[1].txt", "#notes.md", "!bang.txt", "x]y.txt"],
            &["a1.txt", "bang.txt", "other.txt"],
        );
    }

    /// Names Windows doesn't allow: wildcards, a backslash, trailing space.
    #[cfg(unix)]
    #[test]
    fn discard_and_unstage_take_unix_only_odd_names_literally() {
        odd_names_are_taken_literally(
            "discard-odd-unix",
            &["a*b.txt", "q?.txt", "back\\slash.txt", "trail "],
            &["axb.txt", "qx.txt", "backslash.txt", "trail"],
        );
    }

    /// Fill `p`'s index slot with a three-way conflict.
    fn conflict(repo: &git2::Repository, p: &str) {
        let mut index = repo.index().unwrap();
        index.remove(Path::new(p), 0).unwrap();
        for (stage, body) in [(1u16, "base"), (2, "ours"), (3, "theirs")] {
            index
                .add(&git2::IndexEntry {
                    ctime: git2::IndexTime::new(0, 0),
                    mtime: git2::IndexTime::new(0, 0),
                    dev: 0,
                    ino: 0,
                    mode: 0o100644,
                    uid: 0,
                    gid: 0,
                    file_size: 0,
                    id: repo.blob(body.as_bytes()).unwrap(),
                    flags: stage << 12,
                    flags_extended: 0,
                    path: p.as_bytes().to_vec(),
                })
                .unwrap();
        }
        index.write().unwrap();
    }

    #[test]
    fn discard_puts_the_index_back_too() {
        let (dir, repo) = test_repo("discard-index");
        for n in ["staged.txt", "c.txt", "#x.md"] {
            put(&dir.join(n), "v1");
        }
        commit_all(&repo, "init");
        put(&dir.join("staged.txt"), "v2");
        stage_now(&repo, &["staged.txt"]);
        put(&dir.join("staged.txt"), "v3");
        conflict(&repo, "c.txt");
        put(&dir.join("c.txt"), "<<<<<<< ours");
        put(&dir.join("#x.md"), "v2");

        // A conflict elsewhere stays.
        let r = discard_paths(&[s(&dir.join("#x.md"))], fake_trash(&dir)).unwrap();
        assert_eq!(r.restored, 1);
        assert!(status_of(&dir, "c.txt").contains(git2::Status::CONFLICTED));

        let r = discard_paths(&["staged.txt", "c.txt"].map(|n| s(&dir.join(n))), fake_trash(&dir)).unwrap();
        assert_eq!((r.restored, r.skipped.len()), (2, 0), "{:?}", r);
        for n in ["staged.txt", "c.txt", "#x.md"] {
            assert_eq!(read(&dir.join(n)), "v1", "{}", n);
            assert_eq!(status_of(&dir, n), git2::Status::CURRENT, "{}", n);
        }
        // The entries put back record the file, so status needn't hash it.
        let repo = git2::Repository::open(&dir).unwrap();
        let entry = repo.index().unwrap().get_path(Path::new("staged.txt"), 0).unwrap();
        assert_eq!(entry.file_size, 2);
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// A selected symlink is the link, as git tracks it, never its target.
    #[cfg(unix)]
    #[test]
    fn discard_of_a_link_acts_on_the_link_not_its_target() {
        let (dir, repo) = test_repo("discard-link");
        let bin = temp_dir("discard-link-bin");
        put(&dir.join("src/edit.txt"), "v1");
        commit_all(&repo, "init");
        put(&dir.join("src/edit.txt"), "v2");
        std::os::unix::fs::symlink("src", dir.join("link")).unwrap();
        let r = discard_paths(&[s(&dir.join("link"))], fake_trash(&bin)).unwrap();
        assert_eq!((r.restored, r.trashed), (0, 1));
        assert_eq!(read(&dir.join("src/edit.txt")), "v2");
        assert!(std::fs::symlink_metadata(bin.join("link")).unwrap().file_type().is_symlink());
        let _ = std::fs::remove_dir_all(&dir);
        let _ = std::fs::remove_dir_all(&bin);
    }

    #[test]
    fn stage_takes_folders_like_git_add() {
        let (dir, repo) = test_repo("stage-folders");
        put(&dir.join(".gitignore"), "*.log\n");
        put(&dir.join("old/gone.txt"), "v1");
        put(&dir.join("old/keep.txt"), "v1");
        commit_all(&repo, "init");
        std::fs::remove_file(dir.join("old/gone.txt")).unwrap();
        put(&dir.join("old/keep.txt"), "v2");
        put(&dir.join("new/a.txt"), "new");
        put(&dir.join("new/sub/b.txt"), "new");
        put(&dir.join("new/skip.log"), "ignored");
        // `a[b]` is a pattern that matches `ab`.
        put(&dir.join("a[b]/c.txt"), "new");
        put(&dir.join("ab/d.txt"), "new");

        git_stage(["new", "old", "a[b]"].map(|p| s(&dir.join(p))).to_vec()).unwrap();
        let mut got = staged(&dir);
        got.sort();
        assert_eq!(got, [".gitignore", "a[b]/c.txt", "new/a.txt", "new/sub/b.txt", "old/keep.txt"]);
        assert!(status_of(&dir, "old/keep.txt").contains(git2::Status::INDEX_MODIFIED));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn stage_adds_a_link_to_a_folder_as_the_link() {
        let (dir, repo) = test_repo("stage-link");
        put(&dir.join("real/a.txt"), "v1");
        commit_all(&repo, "init");
        std::os::unix::fs::symlink("real", dir.join("link")).unwrap();
        git_stage(vec![s(&dir.join("link"))]).unwrap();
        let repo = git2::Repository::open(&dir).unwrap();
        let entry = repo.index().unwrap().get_path(Path::new("link"), 0).unwrap();
        assert_eq!(entry.mode, 0o120000);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn unstage_takes_folders() {
        let (dir, repo) = test_repo("unstage-folders");
        put(&dir.join("src/x.txt"), "v1");
        commit_all(&repo, "init");
        put(&dir.join("src/x.txt"), "v2");
        put(&dir.join("new/a.txt"), "new");
        stage_now(&repo, &["src/x.txt", "new/a.txt"]);
        git_unstage(["src", "new"].map(|p| s(&dir.join(p))).to_vec()).unwrap();
        assert_eq!(staged(&dir), ["src/x.txt"]);
        assert_eq!(status_of(&dir, "src/x.txt"), git2::Status::WT_MODIFIED);

        // No commit yet: the entries just leave the index.
        let (fresh, repo) = test_repo("unstage-unborn");
        put(&fresh.join("new/a.txt"), "new");
        stage_now(&repo, &["new/a.txt"]);
        git_unstage(vec![s(&fresh.join("new"))]).unwrap();
        assert!(staged(&fresh).is_empty());
        let _ = std::fs::remove_dir_all(&dir);
        let _ = std::fs::remove_dir_all(&fresh);
    }

    /// A folder named like a pattern stages, unstages and discards only
    /// what's under it, at the top or under a plain folder.
    #[test]
    fn odd_folder_names_are_taken_literally() {
        let (dir, repo) = test_repo("odd-folders");
        let files = ["a[b]/x.txt", "ab/x.txt", "src/#c/x.txt", "src/c/x.txt", "src/!d/x.txt", "src/d/x.txt"];
        let odd = ["a[b]", "src/#c", "src/!d"];
        let is_odd = |f: &str| odd.iter().any(|o| f.starts_with(&format!("{}/", o)));
        for f in files {
            put(&dir.join(f), "v1");
        }
        put(&dir.join("a[b]/gone.txt"), "v1");
        commit_all(&repo, "init");
        for f in files {
            put(&dir.join(f), "v2");
        }
        put(&dir.join("a[b]/new.txt"), "new");
        put(&dir.join("ab/new.txt"), "new");
        std::fs::remove_file(dir.join("a[b]/gone.txt")).unwrap();

        git_stage(odd.map(|o| s(&dir.join(o))).to_vec()).unwrap();
        for f in files {
            let st = status_of(&dir, f);
            assert_eq!(st.contains(git2::Status::INDEX_MODIFIED), is_odd(f), "stage {}: {:?}", f, st);
        }
        assert_eq!(status_of(&dir, "a[b]/new.txt"), git2::Status::INDEX_NEW);
        assert_eq!(status_of(&dir, "ab/new.txt"), git2::Status::WT_NEW);
        assert_eq!(status_of(&dir, "a[b]/gone.txt"), git2::Status::INDEX_DELETED);

        stage_now(&repo, &files);
        git_unstage(odd.map(|o| s(&dir.join(o))).to_vec()).unwrap();
        for f in files {
            let st = status_of(&dir, f);
            assert_eq!(st.contains(git2::Status::INDEX_MODIFIED), !is_odd(f), "unstage {}: {:?}", f, st);
        }
        assert_eq!(status_of(&dir, "a[b]/new.txt"), git2::Status::WT_NEW);
        assert_eq!(status_of(&dir, "a[b]/gone.txt"), git2::Status::WT_DELETED);

        let bin = temp_dir("odd-folders-bin");
        let r = discard_paths(&odd.map(|o| s(&dir.join(o))), fake_trash(&bin)).unwrap();
        assert_eq!((r.restored, r.trashed, r.skipped.len()), (4, 1, 0), "{:?}", r);
        assert_eq!(tree(&bin), ["new.txt"]);
        assert_eq!(read(&dir.join("a[b]/gone.txt")), "v1");
        for f in files {
            assert_eq!(read(&dir.join(f)), if is_odd(f) { "v1" } else { "v2" }, "discard {}", f);
        }
        let _ = std::fs::remove_dir_all(&dir);
        let _ = std::fs::remove_dir_all(&bin);
    }

    #[test]
    fn literal_scope_is_the_nearest_plain_parent() {
        assert_eq!(literal_scope(""), None);
        assert_eq!(literal_scope("src/deep"), Some("src/deep"));
        assert_eq!(literal_scope("src/a[b]/c"), Some("src"));
        assert_eq!(literal_scope("src/!x"), Some("src/!x"));
        assert_eq!(literal_scope("#top/sub"), None);
    }

    /// The checkout the git menu sends switches branches and never restores
    /// files, on the git that's installed.
    #[test]
    fn menu_checkout_never_restores_a_folder() {
        if which::which("git").is_err() {
            return;
        }
        let (dir, repo) = test_repo("checkout-dashdash");
        put(&dir.join("docs/f.txt"), "v1");
        let head = commit_all(&repo, "init");
        repo.branch("other", &repo.find_commit(head).unwrap(), false).unwrap();
        put(&dir.join("docs/f.txt"), "edited");

        let r = git_run(s(&dir), args(&["checkout", "docs", "--"])).unwrap();
        assert!(!r.ok, "{:?}", r.stderr);
        assert_eq!(read(&dir.join("docs/f.txt")), "edited");
        let r = git_run(s(&dir), args(&["checkout", "other", "--"])).unwrap();
        assert!(r.ok, "{:?}", r.stderr);
        assert_eq!(git2::Repository::open(&dir).unwrap().head().unwrap().shorthand(), Some("other"));
        assert_eq!(read(&dir.join("docs/f.txt")), "edited");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn blame_refuses_a_file_over_the_read_cap() {
        let (dir, _repo) = test_repo("blame-cap");
        let big = dir.join("big.txt");
        std::fs::File::create(&big).unwrap().set_len(super::super::file_info::TEXT_READ_CAP + 1).unwrap();
        let err = git_blame(s(&big), 10).unwrap_err();
        assert!(err.contains("too big"), "{}", err);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
