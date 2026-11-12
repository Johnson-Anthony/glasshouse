//! Helpers shared by the test modules.

use std::path::{Path, PathBuf};

/// A fresh, empty folder under the system temp dir, removed on drop.
pub(crate) struct Scratch(PathBuf);

impl Scratch {
    pub(crate) fn new(name: &str) -> Self {
        Scratch(temp_dir(name))
    }

    pub(crate) fn path(&self) -> &Path {
        &self.0
    }

    pub(crate) fn join(&self, rel: impl AsRef<Path>) -> PathBuf {
        self.0.join(rel)
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

/// A path as the `String` the commands take.
pub(crate) fn s(p: &Path) -> String {
    p.to_string_lossy().into_owned()
}

/// Write `body` to `path`, creating its parent folders.
pub(crate) fn put(path: &Path, body: &str) {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).unwrap();
    }
    std::fs::write(path, body).unwrap();
}

pub(crate) fn read(path: &Path) -> String {
    std::fs::read_to_string(path).unwrap_or_else(|e| panic!("read {}: {}", path.display(), e))
}

/// Every path under `root`, relative to it, sorted. Folders end in `/`.
pub(crate) fn tree(root: &Path) -> Vec<String> {
    fn walk(root: &Path, dir: &Path, out: &mut Vec<String>) {
        for entry in std::fs::read_dir(dir).unwrap().flatten() {
            let p = entry.path();
            let rel = p.strip_prefix(root).unwrap().to_string_lossy().replace('\\', "/");
            if entry.file_type().unwrap().is_dir() {
                out.push(format!("{}/", rel));
                walk(root, &p, out);
            } else {
                out.push(rel);
            }
        }
    }
    let mut out = Vec::new();
    walk(root, root, &mut out);
    out.sort();
    out
}

/// Make a FIFO (named pipe) at `path`.
#[cfg(unix)]
pub(crate) fn mkfifo(path: &Path) {
    use std::os::unix::ffi::OsStrExt;
    let c = std::ffi::CString::new(path.as_os_str().as_bytes()).unwrap();
    // SAFETY: `c` is a NUL-terminated path that outlives the call.
    assert_eq!(unsafe { libc::mkfifo(c.as_ptr(), 0o644) }, 0, "mkfifo {}", path.display());
}

/// Run `f` on a thread of its own and return what it returns, failing the
/// test if that takes over 10 s: for calls that would block on a FIFO.
#[cfg(unix)]
pub(crate) fn without_blocking<T: Send + 'static>(f: impl FnOnce() -> T + Send + 'static) -> T {
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let _ = tx.send(f());
    });
    rx.recv_timeout(std::time::Duration::from_secs(10)).expect("blocked for 10 s")
}

/// A fresh, empty folder under the system temp dir. Unlike `Scratch`, it
/// stays until the test removes it.
pub(crate) fn temp_dir(name: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!("glasshouse-test-{}-{}", std::process::id(), name));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    d
}

/// Alive = in /proc and not a zombie. A killed orphan can sit as a
/// zombie under whichever ancestor reaps orphans, which may not reap.
#[cfg(target_os = "linux")]
pub(crate) fn process_alive(pid: u32) -> bool {
    match std::fs::read_to_string(format!("/proc/{}/stat", pid)) {
        Ok(stat) => stat.rsplit(')').next().and_then(|s| s.trim().chars().next()) != Some('Z'),
        Err(_) => false,
    }
}

pub(crate) fn test_repo(name: &str) -> (PathBuf, git2::Repository) {
    let dir = temp_dir(name);
    let mut opts = git2::RepositoryInitOptions::new();
    opts.initial_head("main");
    let repo = git2::Repository::init_opts(&dir, &opts).unwrap();
    (dir, repo)
}

/// Stage the work tree's files and commit them on HEAD.
pub(crate) fn commit_all(repo: &git2::Repository, msg: &str) -> git2::Oid {
    let mut index = repo.index().unwrap();
    index
        .add_all(["*"], git2::IndexAddOption::DEFAULT, None)
        .unwrap();
    index.write().unwrap();
    let tree = repo.find_tree(index.write_tree().unwrap()).unwrap();
    let sig = git2::Signature::now("test", "test@example.com").unwrap();
    let parent = repo.head().ok().and_then(|h| h.peel_to_commit().ok());
    let parents: Vec<&git2::Commit> = parent.iter().collect();
    repo.commit(Some("HEAD"), &sig, &sig, msg, &tree, &parents)
        .unwrap()
}
