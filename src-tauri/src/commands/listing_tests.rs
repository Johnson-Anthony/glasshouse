//! list_dir and path_kind.

use crate::commands::testing::{put, s, Scratch};
use super::*;

fn names(entries: &[FileEntry]) -> Vec<&str> {
    entries.iter().map(|e| e.name.as_str()).collect()
}

#[test]
fn list_dir_puts_folders_first_then_sorts_names_ignoring_case() {
    let d = Scratch::new("ls-order");
    std::fs::create_dir(d.join("b-dir")).unwrap();
    std::fs::create_dir(d.join("A-dir")).unwrap();
    for f in ["c.txt", "B.md", "a.rs"] {
        put(&d.join(f), "x");
    }
    let entries = list_dir(s(d.path()), true).unwrap();
    assert_eq!(names(&entries), ["A-dir", "b-dir", "a.rs", "B.md", "c.txt"]);
}

#[test]
fn list_dir_describes_each_entry() {
    let d = Scratch::new("ls-fields");
    put(&d.join("notes.MD"), "hello");
    std::fs::create_dir(d.join("src")).unwrap();
    put(&d.join("src/inner.rs"), "fn main() {}");
    let root = dunce::canonicalize(d.path()).unwrap();

    let entries = list_dir(s(d.path()), false).unwrap();
    assert_eq!(names(&entries), ["src", "notes.MD"]);
    let (dir, file) = (&entries[0], &entries[1]);

    assert_eq!(dir.kind, "folder");
    assert_eq!(dir.size, 0, "folders report no size");
    assert_eq!(dir.ext, "");
    assert_eq!(dir.path, s(&root.join("src")));

    assert_eq!(file.kind, "text");
    assert_eq!(file.size, 5);
    assert_eq!(file.ext, "MD");
    assert_eq!(file.path, s(&root.join("notes.MD")));
    assert!(file.modified_ms > 0);
    assert!(!file.hidden && !file.is_symlink && !file.lossy);
    assert_eq!(file.git, None, "a temp folder isn't in a repo");
}

#[cfg(unix)]
#[test]
fn list_dir_hides_dotfiles_unless_asked() {
    let d = Scratch::new("ls-hidden");
    put(&d.join(".env"), "x");
    put(&d.join("shown.txt"), "x");
    std::fs::create_dir(d.join(".git")).unwrap();

    assert_eq!(names(&list_dir(s(d.path()), false).unwrap()), ["shown.txt"]);
    let all = list_dir(s(d.path()), true).unwrap();
    assert_eq!(names(&all), [".git", ".env", "shown.txt"]);
    let hidden: Vec<bool> = all.iter().map(|e| e.hidden).collect();
    assert_eq!(hidden, [true, true, false]);
}

#[test]
fn list_dir_of_a_missing_folder_is_an_error() {
    let d = Scratch::new("ls-missing");
    let err = list_dir(s(&d.join("nope")), true).unwrap_err();
    assert!(err.starts_with("read_dir("), "{}", err);
    assert!(err.contains("nope"), "{}", err);
}

#[test]
fn path_kind_tells_a_folder_from_a_file_and_from_nothing() {
    let d = Scratch::new("path-kind");
    std::fs::create_dir(d.join("dir")).unwrap();
    put(&d.join("f.txt"), "x");
    assert_eq!(path_kind(s(&d.join("dir"))), Some("folder"));
    assert_eq!(path_kind(s(&d.join("f.txt"))), Some("file"));
    assert_eq!(path_kind(s(&d.join("gone"))), None);
    std::fs::remove_dir(d.join("dir")).unwrap();
    assert_eq!(path_kind(s(&d.join("dir"))), None);
}

#[cfg(unix)]
#[test]
fn path_kind_follows_links_and_calls_a_dangling_one_a_file() {
    let d = Scratch::new("path-kind-links");
    std::fs::create_dir(d.join("dir")).unwrap();
    std::os::unix::fs::symlink(d.join("dir"), d.join("to-dir")).unwrap();
    std::os::unix::fs::symlink(d.join("nowhere"), d.join("dangling")).unwrap();
    assert_eq!(path_kind(s(&d.join("to-dir"))), Some("folder"));
    assert_eq!(path_kind(s(&d.join("dangling"))), Some("file"));
}

#[cfg(target_os = "linux")]
#[test]
fn list_dir_marks_names_that_are_not_utf8() {
    use std::os::unix::ffi::OsStrExt;
    let d = Scratch::new("ls-lossy");
    let raw = std::ffi::OsStr::from_bytes(b"bad\xffname.txt");
    std::fs::write(d.path().join(raw), "x").unwrap();
    put(&d.join("good.txt"), "x");

    let entries = list_dir(s(d.path()), true).unwrap();
    let lossy: Vec<(&str, bool)> = entries.iter().map(|e| (e.name.as_str(), e.lossy)).collect();
    assert_eq!(lossy, [("bad\u{FFFD}name.txt", true), ("good.txt", false)]);
}
