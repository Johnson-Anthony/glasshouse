//! list_dir, path_kind and real_path.

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
    let root = d.path();

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
    assert_eq!(err.kind, crate::error::Kind::NotFound);
    assert_eq!(err.message, "Couldn't open “nope” because it isn't there anymore.");
    assert!(err.detail.contains("nope"), "{}", err.detail);
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

/// A folder reached through a link lists its entries under the link, as it
/// was asked for, and a child folder opened from there stays under it.
#[cfg(unix)]
#[test]
fn list_dir_keeps_entries_under_the_path_it_was_asked_for() {
    let d = Scratch::new("ls-alias");
    put(&d.join("real/sub/deep.txt"), "x");
    put(&d.join("real/top.txt"), "x");
    std::os::unix::fs::symlink(d.join("real"), d.join("alias")).unwrap();

    let alias = d.join("alias");
    let entries = list_dir(s(&alias), true).unwrap();
    assert_eq!(names(&entries), ["sub", "top.txt"]);
    assert_eq!(entries[0].path, s(&alias.join("sub")));
    assert_eq!(entries[1].path, s(&alias.join("top.txt")));
    assert!(!entries[0].is_symlink, "only the folder above is a link");

    let below = list_dir(entries[0].path.clone(), true).unwrap();
    assert_eq!(below[0].path, s(&alias.join("sub/deep.txt")));
    // A trailing separator on the request adds none to the entries.
    let slashed = list_dir(format!("{}/", s(&alias)), true).unwrap();
    assert_eq!(slashed[1].path, s(&alias.join("top.txt")));
}

/// Two paths to one folder resolve to the same place, which is how the page
/// tells that a drop from one tab onto another lands where it started.
#[cfg(unix)]
#[test]
fn real_path_is_the_same_through_a_link_and_leaves_what_it_cannot_resolve() {
    let d = Scratch::new("ls-real");
    put(&d.join("real/sub/f.txt"), "x");
    std::os::unix::fs::symlink(d.join("real"), d.join("alias")).unwrap();

    let direct = real_path(s(&d.join("real/sub")));
    assert_eq!(real_path(s(&d.join("alias/sub"))), direct);
    assert_eq!(real_path(s(&d.join("alias/../alias/sub/"))), direct);
    assert_ne!(real_path(s(&d.join("real"))), direct);
    let gone = s(&d.join("alias/missing"));
    assert_eq!(real_path(gone.clone()), gone);
}

/// Git labels through a linked folder: the scan runs on the real folder and
/// the rows keep the linked paths.
#[cfg(unix)]
#[test]
fn list_dir_labels_rows_reached_through_a_link() {
    use crate::commands::testing::{commit_all, test_repo};
    let (dir, repo) = test_repo("ls-alias-git");
    put(&dir.join("sub/a.txt"), "v1");
    commit_all(&repo, "init");
    put(&dir.join("sub/a.txt"), "v2");
    put(&dir.join("sub/new.txt"), "new");
    let alias = dir.with_file_name(format!("{}-alias", dir.file_name().unwrap().to_string_lossy()));
    let _ = std::fs::remove_file(&alias);
    std::os::unix::fs::symlink(&dir, &alias).unwrap();

    let entries = list_dir(s(&alias.join("sub")), true).unwrap();
    let got: Vec<(&str, Option<&str>)> = entries.iter().map(|e| (e.path.as_str(), e.git.as_deref())).collect();
    let (a, new) = (s(&alias.join("sub/a.txt")), s(&alias.join("sub/new.txt")));
    assert_eq!(got, [(a.as_str(), Some("M")), (new.as_str(), Some("?"))]);
    let _ = std::fs::remove_file(&alias);
    let _ = std::fs::remove_dir_all(&dir);
}

#[cfg(windows)]
mod windows {
    use super::*;

    /// A leading dot hides nothing on Windows; the Hidden attribute does.
    #[test]
    fn list_dir_shows_dotfiles_and_hides_by_attribute() {
        let d = Scratch::new("ls-dots");
        put(&d.join(".gitignore"), "x");
        put(&d.join("shown.txt"), "x");
        put(&d.join("secret.txt"), "x");
        let hide = std::process::Command::new("attrib").arg("+h").arg(d.join("secret.txt")).status().unwrap();
        assert!(hide.success());

        let entries = list_dir(s(d.path()), false).unwrap();
        assert_eq!(names(&entries), [".gitignore", "shown.txt"]);
        assert!(!entries[0].hidden);
        let all = list_dir(s(d.path()), true).unwrap();
        let hidden: Vec<(&str, bool)> = all.iter().map(|e| (e.name.as_str(), e.hidden)).collect();
        assert_eq!(hidden, [(".gitignore", false), ("secret.txt", true), ("shown.txt", false)]);
    }

    /// A verbatim path (what older builds saved) lists in the plain form.
    #[test]
    fn list_dir_of_a_verbatim_path_gives_plain_entries() {
        let d = Scratch::new("ls-verbatim");
        put(&d.join("a.txt"), "x");
        let canonical = std::fs::canonicalize(d.path()).unwrap();
        assert!(s(&canonical).starts_with(r"\\?\"), "{}", canonical.display());

        let entries = list_dir(s(&canonical), true).unwrap();
        let plain = crate::winpath::plain(&s(&canonical)).unwrap();
        assert_eq!(entries[0].path, format!(r"{plain}\a.txt"));
        assert_eq!(std::fs::read_to_string(&entries[0].path).unwrap(), "x");
        // `/` and a trailing separator are tidied the same way.
        let slashed = list_dir(format!("{}/", plain.replace('\\', "/")), true).unwrap();
        assert_eq!(slashed[0].path, entries[0].path);
    }

    /// A folder whose name Win32 would change (a trailing dot) has no plain
    /// form: its entries keep the verbatim one, which still opens them.
    #[test]
    fn list_dir_keeps_the_verbatim_form_where_only_it_works() {
        let d = Scratch::new("ls-dotted");
        let canonical = s(&std::fs::canonicalize(d.path()).unwrap());
        let dotted = format!(r"{canonical}\trailing.");
        std::fs::create_dir(&dotted).unwrap();
        std::fs::write(format!(r"{dotted}\in.txt"), "x").unwrap();

        let entries = list_dir(dotted.clone(), true).unwrap();
        assert_eq!(entries[0].path, format!(r"{dotted}\in.txt"));
        assert_eq!(std::fs::read_to_string(&entries[0].path).unwrap(), "x");
        // The parent lists it under its real name.
        let parent = list_dir(canonical, true).unwrap();
        assert_eq!(names(&parent), ["trailing."]);
    }

    /// A share lists as `\\server\share\…`, asked plain or verbatim. Uses
    /// this PC's admin share, which needs an elevated run (as on CI); where
    /// it can't be reached the test has nothing to check.
    #[test]
    fn list_dir_of_a_share_gives_share_paths() {
        let d = Scratch::new("ls-unc");
        put(&d.join("a.txt"), "x");
        let local = crate::winpath::plain(&s(&std::fs::canonicalize(d.path()).unwrap())).unwrap();
        let (drive, rest) = local.split_once(':').unwrap();
        let share = format!(r"\\localhost\{drive}${rest}");
        if std::fs::metadata(&share).is_err() {
            eprintln!("skipped: {share} can't be reached");
            return;
        }
        let want = format!(r"{share}\a.txt");
        assert_eq!(list_dir(share.clone(), true).unwrap()[0].path, want);
        let verbatim = format!(r"\\?\UNC\{}", &share[2..]);
        assert_eq!(list_dir(verbatim, true).unwrap()[0].path, want);
    }
}
