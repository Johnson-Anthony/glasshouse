//! git_run's runner (progress, cancel, the idle timeout, no prompts), the
//! branch list's remote branches and the commit dialog's info. The remote is
//! a local bare repo, or a local HTTP server that refuses or never answers.

use super::*;
use crate::commands::testing::{commit_all, put, s, temp_dir, test_repo};
use crate::ops::testing::{events, recorded};
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::Path;

fn have_git() -> bool {
    crate::commands::testing::have_tool("git", which::which("git").is_ok())
}

/// A git command in `dir` that reads no user or system config, so the
/// machine's credential helpers, proxies and askpass programs stay out.
fn git_cmd(dir: &Path, args: &[&str]) -> std::process::Command {
    let empty = dir.parent().unwrap().join(format!(
        "{}.gitconfig",
        dir.file_name().unwrap().to_string_lossy()
    ));
    if !empty.exists() {
        std::fs::write(&empty, "").unwrap();
    }
    let mut cmd = build_git_command(&s(dir));
    cmd.env("GIT_CONFIG_GLOBAL", &empty)
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env("NO_PROXY", "127.0.0.1")
        .env("no_proxy", "127.0.0.1")
        .env_remove("GIT_ASKPASS")
        .env_remove("SSH_ASKPASS")
        .args(["-c", "user.name=test", "-c", "user.email=test@example.com"])
        .args(args);
    cmd
}

fn git_ok(dir: &Path, args: &[&str]) {
    let out = git_cmd(dir, args).output().unwrap();
    assert!(out.status.success(), "git {:?}: {}", args, String::from_utf8_lossy(&out.stderr));
}

/// A work repo with a few commits on `main` and `feature`, a bare remote it
/// has pushed both to, and the folder holding them.
fn work_and_remote(name: &str) -> (PathBuf, PathBuf, PathBuf) {
    let base = temp_dir(name);
    let (remote, work) = (base.join("remote.git"), base.join("work"));
    git_ok(&base, &["init", "-q", "--bare", &s(&remote)]);
    git_ok(&base, &["init", "-q", "-b", "main", &s(&work)]);
    // Enough objects that push and fetch print progress.
    for i in 0..200 {
        put(&work.join(format!("f{}.txt", i)), &format!("file {} {}\n", i, "x".repeat(i * 13)));
    }
    git_ok(&work, &["add", "."]);
    git_ok(&work, &["commit", "-qm", "one"]);
    git_ok(&work, &["remote", "add", "origin", &s(&remote)]);
    git_ok(&work, &["push", "-q", "origin", "main"]);
    git_ok(&work, &["branch", "feature"]);
    git_ok(&work, &["push", "-q", "origin", "feature"]);
    (base, work, remote)
}

/// A local HTTP server. Each connection gets `reply` (if any) after the
/// request arrives; the returned channel gets one message per connection
/// once the client has closed it, or "timeout" if it didn't within 20 s.
/// A local HTTP server for git to fetch from. The receivers report each
/// connection as it's accepted, then how it ended.
fn http_server(
    reply: Option<&'static str>,
) -> (String, std::sync::mpsc::Receiver<&'static str>, std::sync::mpsc::Receiver<()>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://127.0.0.1:{}/repo.git", listener.local_addr().unwrap().port());
    let (tx, rx) = std::sync::mpsc::channel();
    let (opened_tx, opened) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        for conn in listener.incoming() {
            let Ok(mut conn): Result<TcpStream, _> = conn else { return };
            let _ = opened_tx.send(());
            let tx = tx.clone();
            std::thread::spawn(move || {
                conn.set_read_timeout(Some(Duration::from_secs(20))).unwrap();
                let mut buf = [0u8; 4096];
                let _ = conn.read(&mut buf);
                if let Some(reply) = reply {
                    let _ = conn.write_all(reply.as_bytes());
                }
                // Then wait for the client to go away.
                let outcome = loop {
                    match conn.read(&mut buf) {
                        Ok(0) => break "closed",
                        Ok(_) => continue,
                        Err(e) if matches!(e.kind(), std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut) => {
                            break "timeout"
                        }
                        Err(_) => break "closed",
                    }
                };
                let _ = tx.send(outcome);
            });
        }
    });
    (url, rx, opened)
}

const UNAUTHORIZED: &str = "HTTP/1.1 401 Unauthorized\r\n\
    WWW-Authenticate: Basic realm=\"test\"\r\n\
    Content-Length: 0\r\nConnection: close\r\n\r\n";

#[test]
fn parse_progress_reads_counts() {
    assert_eq!(parse_progress("Receiving objects:  45% (450/1000), 1.20 MiB | 2.00 MiB/s"), Some((450, 1000)));
    assert_eq!(parse_progress("remote: Counting objects: 100% (5/5), done."), Some((5, 5)));
    assert_eq!(parse_progress("Writing objects:   0% (1/304)"), Some((1, 304)));
    assert_eq!(parse_progress("Enumerating objects: 304, done."), None);
    assert_eq!(parse_progress("From ../remote"), None);
    assert_eq!(parse_progress("odd: 5% (x/y)"), None);
}

#[test]
fn terminal_text_keeps_each_lines_last_update() {
    let raw = "Counting objects:   0% (1/3)\rCounting objects:  66% (2/3)\rCounting objects: 100% (3/3), done.\n\
               remote: Total 3 (delta 0)\x1b[K        \n\
               From ../remote\n   abc..def  main       -> origin/main\n\
               Receiving objects: 100% (3/3)\r\n";
    assert_eq!(
        terminal_text(raw.as_bytes()),
        "Counting objects: 100% (3/3), done.\n\
         remote: Total 3 (delta 0)\n\
         From ../remote\n   abc..def  main       -> origin/main\n\
         Receiving objects: 100% (3/3)\n"
    );
}

#[test]
fn cut_keeps_short_lines_and_ends_long_ones() {
    assert_eq!(cut("abc", 3), "abc");
    assert_eq!(cut("abcd", 3), "abc…");
    assert_eq!(cut("ééééé", 2), "éé…");
}

#[test]
fn only_remote_commands_get_the_idle_timeout() {
    let a = |x: &[&str]| x.iter().map(|s| s.to_string()).collect::<Vec<_>>();
    for sub in ["pull", "push", "fetch"] {
        assert_eq!(idle_timeout(&a(&[sub])), Some(REMOTE_IDLE_TIMEOUT), "{}", sub);
    }
    for sub in ["commit", "merge", "rebase", "checkout", "status"] {
        assert_eq!(idle_timeout(&a(&[sub])), None, "{}", sub);
    }
}

#[cfg(unix)]
#[test]
fn a_cancel_before_the_start_runs_nothing() {
    let (reg, op, _) = recorded("early");
    reg.cancel("early");
    let dir = temp_dir("gitrunearly");
    let marker = dir.join("ran");
    let mut cmd = std::process::Command::new("sh");
    cmd.args(["-c", &format!("touch '{}'", s(&marker))]);
    assert_eq!(run_git(cmd, &op, None).unwrap_err(), CANCELLED);
    assert!(!marker.exists());
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn push_and_fetch_report_their_progress_lines() {
    if !have_git() {
        return;
    }
    let (base, work, remote) = work_and_remote("gitrunprogress");
    put(&work.join("more.txt"), &"y".repeat(50_000));
    git_ok(&work, &["add", "."]);
    git_ok(&work, &["commit", "-qm", "two"]);

    let (_reg, op, sent) = recorded("push");
    let r = run_git(git_cmd(&work, &["push", "--progress", "origin", "main"]), &op, idle_timeout(&["push".into()])).unwrap();
    assert!(r.ok, "{}", r.stderr);
    let sent = events(&sent);
    assert!(sent.iter().all(|p| p.detail.is_some()), "{:?}", sent);
    assert!(sent.iter().any(|p| p.total.is_some()), "no counted step in {:?}", sent);
    assert!(!r.stderr.contains('\r'), "{:?}", r.stderr);
    assert!(r.stderr.contains("main -> main"), "{}", r.stderr);

    // A clone that's one commit behind fetches it.
    let other = base.join("other");
    git_ok(&base, &["clone", "-q", &s(&remote), &s(&other)]);
    git_ok(&work, &["commit", "-q", "--allow-empty", "-m", "three"]);
    git_ok(&work, &["push", "-q", "origin", "main"]);
    let (_reg, op, sent) = recorded("fetch");
    let r = run_git(git_cmd(&other, &["fetch", "--all", "--prune", "--progress"]), &op, Some(REMOTE_IDLE_TIMEOUT)).unwrap();
    assert!(r.ok, "{}", r.stderr);
    assert!(!events(&sent).is_empty());
    assert!(r.stderr.contains("origin/main"), "{}", r.stderr);
    let _ = std::fs::remove_dir_all(&base);
}

#[test]
fn a_remote_that_wants_a_password_fails_at_once() {
    if !have_git() {
        return;
    }
    let dir = temp_dir("gitrunauth");
    git_ok(&dir, &["init", "-q"]);
    let (url, closed, _) = http_server(Some(UNAUTHORIZED));
    let started = Instant::now();
    let r = run_git(git_cmd(&dir, &["fetch", &url]), &Op::untracked(), Some(Duration::from_secs(60))).unwrap();
    assert!(!r.ok);
    assert!(r.stderr.contains("terminal prompts disabled"), "{}", r.stderr);
    assert!(started.elapsed() < Duration::from_secs(20), "took {:?}", started.elapsed());
    assert_eq!(closed.recv_timeout(Duration::from_secs(5)), Ok("closed"));
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn a_silent_remote_is_stopped_at_the_idle_timeout() {
    if !have_git() {
        return;
    }
    let dir = temp_dir("gitrunidle");
    git_ok(&dir, &["init", "-q"]);
    let (url, closed, opened) = http_server(None);
    let started = Instant::now();
    let err = run_git(git_cmd(&dir, &["fetch", &url]), &Op::untracked(), Some(Duration::from_millis(800))).unwrap_err();
    assert!(err.contains("glasshouse stopped it"), "{}", err);
    assert!(started.elapsed() < Duration::from_secs(10), "took {:?}", started.elapsed());
    // The kill reached git's HTTP helper, which held the connection. On a
    // slow machine git can be stopped before it connects; then there's none.
    if opened.try_recv().is_ok() {
        assert_eq!(closed.recv_timeout(Duration::from_secs(10)), Ok("closed"));
    }
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn a_cancel_stops_a_running_fetch() {
    if !have_git() {
        return;
    }
    let dir = temp_dir("gitruncancel");
    git_ok(&dir, &["init", "-q"]);
    let (url, closed, opened) = http_server(None);
    let (reg, op, _) = recorded("hang");
    // Cancel once git's HTTP helper holds a connection, so the cancel has
    // to stop it (git can take over a second to connect on Windows CI).
    let canceller = std::thread::spawn(move || {
        opened.recv_timeout(Duration::from_secs(20)).expect("git never connected");
        reg.cancel("hang");
    });
    let started = Instant::now();
    // No idle timeout, as for a commit: only the cancel stops it.
    let err = run_git(git_cmd(&dir, &["fetch", &url]), &op, None).unwrap_err();
    assert_eq!(err, CANCELLED);
    assert!(started.elapsed() < Duration::from_secs(10), "took {:?}", started.elapsed());
    assert_eq!(closed.recv_timeout(Duration::from_secs(10)), Ok("closed"));
    canceller.join().unwrap();
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn branch_list_adds_remote_branches_when_asked() {
    if !have_git() {
        return;
    }
    let (base, work, _remote) = work_and_remote("gitbranchremotes");
    git_ok(&work, &["fetch", "-q", "origin"]);
    // origin/HEAD, a symbolic ref, isn't a branch to pick.
    git_ok(&work, &["remote", "set-head", "origin", "main"]);
    let local = git_branch_list(s(&work), None).unwrap();
    assert!(local.iter().all(|b| !b.remote));
    let all = git_branch_list(s(&work), Some(true)).unwrap();
    let remote: Vec<_> = all.iter().filter(|b| b.remote).map(|b| b.name.as_str()).collect();
    assert_eq!(remote, ["origin/feature", "origin/main"]);
    assert_eq!(all.len(), local.len() + 2);
    let _ = std::fs::remove_dir_all(&base);
}

#[test]
fn checkout_of_a_remote_only_branch_makes_a_tracking_branch() {
    // What the branch picker sends for `origin/feature` with no local one.
    if !have_git() {
        return;
    }
    let (base, _work, remote) = work_and_remote("gitcheckoutremote");
    let clone = base.join("clone");
    git_ok(&base, &["clone", "-q", &s(&remote), &s(&clone)]);
    let args: Vec<String> = ["checkout", "feature", "--"].iter().map(|a| a.to_string()).collect();
    check_git_args(&args).unwrap();
    let mut cmd = git_cmd(&clone, &[]);
    cmd.args(&args);
    let r = run_git(cmd, &Op::untracked(), None).unwrap();
    assert!(r.ok, "{}", r.stderr);
    let feature = git_branch_list(s(&clone), None).unwrap().into_iter().find(|b| b.name == "feature").unwrap();
    assert!(feature.current);
    assert_eq!(feature.upstream.as_deref(), Some("origin/feature"));
    let _ = std::fs::remove_dir_all(&base);
}

#[test]
fn commit_info_lists_whats_staged() {
    let (dir, repo) = test_repo("commitinfo");
    put(&dir.join("a.txt"), "a\n");
    put(&dir.join("b.txt"), "b\n");
    put(&dir.join("c.txt"), "the same content, renamed\n");
    commit_all(&repo, "first line\n\nbody\n");

    put(&dir.join("a.txt"), "a2\n");
    std::fs::remove_file(dir.join("b.txt")).unwrap();
    std::fs::rename(dir.join("c.txt"), dir.join("d.txt")).unwrap();
    put(&dir.join("e.txt"), "e\n");
    let mut index = repo.index().unwrap();
    index.add_path(Path::new("a.txt")).unwrap();
    index.remove_path(Path::new("b.txt")).unwrap();
    index.remove_path(Path::new("c.txt")).unwrap();
    index.add_path(Path::new("d.txt")).unwrap();
    index.add_path(Path::new("e.txt")).unwrap();
    index.write().unwrap();
    // Not staged: a second edit, and a new file.
    put(&dir.join("a.txt"), "a3\n");
    put(&dir.join("f.txt"), "f\n");

    let info = git_commit_info(s(&dir)).unwrap();
    assert_eq!(info.branch, "main");
    let file = |code, path: &str, old: Option<&str>| StagedFile {
        code,
        path: path.into(),
        old_path: old.map(str::to_string),
    };
    assert_eq!(
        info.staged,
        vec![
            file("M", "a.txt", None),
            file("D", "b.txt", None),
            file("R", "d.txt", Some("c.txt")),
            file("A", "e.txt", None),
        ]
    );
    assert_eq!(info.staged_total, 4);
    assert_eq!(info.unstaged, 2);
    assert_eq!(info.head_message.as_deref(), Some("first line\n\nbody\n"));
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn commit_info_on_a_branch_with_no_commits() {
    let (dir, repo) = test_repo("commitinfounborn");
    put(&dir.join("a.txt"), "a\n");
    let mut index = repo.index().unwrap();
    index.add_path(Path::new("a.txt")).unwrap();
    index.write().unwrap();
    let info = git_commit_info(s(&dir)).unwrap();
    assert_eq!(info.branch, "main");
    assert_eq!(info.head_message, None);
    assert_eq!(info.staged, vec![StagedFile { code: "A", path: "a.txt".into(), old_path: None }]);
    let _ = std::fs::remove_dir_all(&dir);
}
