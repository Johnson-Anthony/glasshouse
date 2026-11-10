use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
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
    let literal = !spec.contains(['*', '?', '[', ']', '\\'])
        && !spec.starts_with(['!', '#'])
        && !spec.ends_with(char::is_whitespace);
    literal.then_some(spec)
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
    let abs = canonicalize_soft(&path);
    let (repo, _, rels) = open_repo_and_relpaths(std::slice::from_ref(&path))?;
    let rel = &rels[0];

    let mut opts = BlameOptions::new();
    opts.track_copies_same_file(true);
    let blame = repo
        .blame_file(rel, Some(&mut opts))
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

/// Open the repo containing `paths[0]` and return it with its workdir and
/// each path relative to that workdir.
fn open_repo_and_relpaths(
    paths: &[String],
) -> Result<(git2::Repository, PathBuf, Vec<PathBuf>), String> {
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
    Ok((repo, workdir, rels))
}

#[tauri::command(async)]
pub fn git_stage(paths: Vec<String>) -> Result<(), String> {
    let (repo, workdir, rels) = open_repo_and_relpaths(&paths)?;
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

#[tauri::command(async)]
pub fn git_unstage(paths: Vec<String>) -> Result<(), String> {
    let (repo, _, rels) = open_repo_and_relpaths(&paths)?;
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

#[tauri::command(async)]
pub fn git_discard(paths: Vec<String>) -> Result<(), String> {
    use git2::build::CheckoutBuilder;
    let (repo, workdir, rels) = open_repo_and_relpaths(&paths)?;

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
    GitRunSpec { name: "checkout", flags: &[], valued: &["-b"], positionals: 1 },
    GitRunSpec { name: "merge", flags: &["--no-edit"], valued: &[], positionals: 1 },
    GitRunSpec { name: "rebase", flags: &[], valued: &[], positionals: 1 },
];

/// Check `git_run` arguments against GIT_RUN_ALLOWED. The subcommand must
/// come first, so no global option gets in (`-c core.sshCommand=…`, `-C`,
/// `--exec-path`), and a plain argument can't start with `-`, so neither can
/// an option that runs a command (`fetch --upload-pack=…`, `rebase --exec`).
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
    use crate::commands::testing::{temp_dir, test_repo, commit_all, s};

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
            &["checkout", "main"],
            &["checkout", "feature/x"],
            &["checkout", "-"],
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
            &["checkout", "a", "b"],
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
}
