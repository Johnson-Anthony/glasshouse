//! delete_entry, move_to_trash, and copy/move onto a taken name.

use crate::commands::testing::{put, read, s, tree, Scratch};
use super::*;
use super::tests::copy_entry;

#[test]
fn delete_entry_removes_a_file() {
    let d = Scratch::new("del-file");
    put(&d.join("a.txt"), "x");
    delete_entry(s(&d.join("a.txt")), false).unwrap();
    assert!(tree(d.path()).is_empty());
}

#[test]
fn delete_entry_removes_a_non_empty_folder_only_when_recursive() {
    let d = Scratch::new("del-dir");
    std::fs::create_dir(d.join("empty")).unwrap();
    put(&d.join("full/a/b.txt"), "x");

    delete_entry(s(&d.join("empty")), false).unwrap();
    assert!(delete_entry(s(&d.join("full")), false).is_err());
    assert_eq!(tree(d.path()), ["full/", "full/a/", "full/a/b.txt"], "nothing removed");

    delete_entry(s(&d.join("full")), true).unwrap();
    assert!(tree(d.path()).is_empty());
}

#[test]
fn delete_entry_of_a_missing_path_is_an_error() {
    let d = Scratch::new("del-missing");
    assert!(delete_entry(s(&d.join("nope")), true).is_err());
}

#[cfg(unix)]
#[test]
fn delete_entry_removes_a_link_but_never_its_target() {
    let d = Scratch::new("del-link");
    put(&d.join("target/keep.txt"), "keep");
    std::os::unix::fs::symlink(d.join("target"), d.join("link")).unwrap();
    std::os::unix::fs::symlink(d.join("gone"), d.join("dangling")).unwrap();

    delete_entry(s(&d.join("link")), true).unwrap();
    delete_entry(s(&d.join("dangling")), false).unwrap();
    assert_eq!(tree(d.path()), ["target/", "target/keep.txt"]);
}

/// Names the scratch folder for `move_to_trash_child`, which does nothing
/// without it.
#[cfg(target_os = "linux")]
const TRASH_TEST_ROOT: &str = "GLASSHOUSE_TRASH_TEST_ROOT";

// The trash crate finds the trash through XDG_DATA_HOME. Setting that in
// this process would race the other test threads (and libgit2's getenv),
// and a test must never touch the real trash, so the work happens in a
// child copy of this test binary with its own environment.
#[cfg(target_os = "linux")]
#[test]
fn move_to_trash_moves_into_the_xdg_trash() {
    let d = Scratch::new("trash");
    let out = std::process::Command::new(std::env::current_exe().unwrap())
        .args([
            "--exact",
            "commands::fs_ops::fs_ops_tests::move_to_trash_child",
            "--ignored",
            "--test-threads=1",
        ])
        .env("XDG_DATA_HOME", d.join("data"))
        .env(TRASH_TEST_ROOT, d.path())
        .output()
        .unwrap();
    let stdout = String::from_utf8_lossy(&out.stdout);
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(out.status.success(), "{}{}", stdout, stderr);
    assert!(stdout.contains("1 passed"), "the child test didn't run: {}", stdout);
}

#[cfg(target_os = "linux")]
#[test]
#[ignore = "run in a child process by move_to_trash_moves_into_the_xdg_trash"]
fn move_to_trash_child() {
    let Some(root) = std::env::var_os(TRASH_TEST_ROOT).map(PathBuf::from) else {
        return;
    };
    let data = root.join("data");
    assert_eq!(std::env::var_os("XDG_DATA_HOME").map(PathBuf::from), Some(data.clone()));

    put(&root.join("doomed.txt"), "bye");
    move_to_trash(s(&root.join("doomed.txt"))).unwrap();
    assert!(!root.join("doomed.txt").exists());
    assert_eq!(read(&data.join("Trash/files/doomed.txt")), "bye");
    let info = read(&data.join("Trash/info/doomed.txt.trashinfo"));
    assert!(info.starts_with("[Trash Info]"), "{}", info);
    assert!(info.contains("doomed.txt"), "{}", info);

    put(&root.join("dir/inner.txt"), "x");
    move_to_trash(s(&root.join("dir"))).unwrap();
    assert_eq!(read(&data.join("Trash/files/dir/inner.txt")), "x");

    let err = move_to_trash(s(&root.join("missing"))).unwrap_err();
    assert!(err.starts_with("move_to_trash("), "{}", err);
    assert!(err.contains("missing"), "{}", err);
}

// ---------- copy-move-no-clobber ----------

fn taken(name: &str, dir: &Path) -> String {
    format!("\"{}\" already exists in {}", name, dir.display())
}

#[test]
fn copy_entry_refuses_an_existing_file_target() {
    let d = Scratch::new("cp-noclobber-file");
    put(&d.join("a.txt"), "new");
    put(&d.join("b.txt"), "old");
    let err = copy_entry(s(&d.join("a.txt")), s(&d.join("b.txt"))).unwrap_err();
    assert_eq!(err, taken("b.txt", d.path()));
    assert_eq!(read(&d.join("b.txt")), "old");
    assert_eq!(read(&d.join("a.txt")), "new");
}

#[test]
fn copy_entry_refuses_an_existing_folder_target_without_merging() {
    let d = Scratch::new("cp-noclobber-dir");
    put(&d.join("src/x.txt"), "x");
    put(&d.join("dst/y.txt"), "y");
    std::fs::create_dir(d.join("empty")).unwrap();
    let err = copy_entry(s(&d.join("src")), s(&d.join("dst"))).unwrap_err();
    assert_eq!(err, taken("dst", d.path()));
    assert_eq!(tree(&d.join("dst")), ["y.txt"]);
    assert!(copy_entry(s(&d.join("src")), s(&d.join("empty"))).is_err());
    assert!(tree(&d.join("empty")).is_empty());
    // Across kinds too: a file onto a folder, a folder onto a file.
    assert!(copy_entry(s(&d.join("src/x.txt")), s(&d.join("dst"))).is_err());
    assert!(copy_entry(s(&d.join("dst")), s(&d.join("src/x.txt"))).is_err());
    assert_eq!(read(&d.join("src/x.txt")), "x");
}

#[cfg(unix)]
#[test]
fn copy_entry_refuses_to_replace_with_a_symlink() {
    let d = Scratch::new("cp-noclobber-link");
    put(&d.join("target.txt"), "t");
    put(&d.join("taken"), "keep");
    std::os::unix::fs::symlink("target.txt", d.join("link")).unwrap();
    let err = copy_entry(s(&d.join("link")), s(&d.join("taken"))).unwrap_err();
    assert_eq!(err, taken("taken", d.path()));
    assert_eq!(read(&d.join("taken")), "keep");
}

#[cfg(unix)]
#[test]
fn copy_entry_keeps_permission_bits() {
    use std::os::unix::fs::PermissionsExt;
    let d = Scratch::new("cp-perms");
    put(&d.join("run.sh"), "#!/bin/sh\n");
    std::fs::set_permissions(d.join("run.sh"), std::fs::Permissions::from_mode(0o750)).unwrap();
    copy_entry(s(&d.join("run.sh")), s(&d.join("copy.sh"))).unwrap();
    let mode = std::fs::metadata(d.join("copy.sh"))
        .unwrap()
        .permissions()
        .mode();
    assert_eq!(mode & 0o777, 0o750);
    assert_eq!(read(&d.join("copy.sh")), "#!/bin/sh\n");
}

#[test]
fn move_entry_refuses_an_existing_file_or_folder_target() {
    let d = Scratch::new("mv-noclobber");
    put(&d.join("a.txt"), "a");
    put(&d.join("b.txt"), "b");
    put(&d.join("dir/inner.txt"), "i");
    std::fs::create_dir(d.join("empty")).unwrap();

    let err = move_entry(s(&d.join("a.txt")), s(&d.join("b.txt"))).unwrap_err();
    assert_eq!(err, taken("b.txt", d.path()));
    // fs::rename would have replaced the empty folder.
    let err = move_entry(s(&d.join("dir")), s(&d.join("empty"))).unwrap_err();
    assert_eq!(err, taken("empty", d.path()));
    assert!(move_entry(s(&d.join("dir")), s(&d.join("b.txt"))).is_err());
    assert!(move_entry(s(&d.join("a.txt")), s(&d.join("dir"))).is_err());

    assert_eq!(read(&d.join("a.txt")), "a");
    assert_eq!(read(&d.join("b.txt")), "b");
    assert_eq!(tree(&d.join("dir")), ["inner.txt"]);
    assert!(tree(&d.join("empty")).is_empty());
}

#[test]
fn copy_and_move_go_through_once_replace_frees_the_name() {
    // The planner's Replace trashes the existing item, then copies or moves
    // into the freed name; deleting it here stands in for the trash.
    let d = Scratch::new("replace-flow");
    put(&d.join("a.txt"), "new");
    put(&d.join("b.txt"), "old");
    delete_entry(s(&d.join("b.txt")), false).unwrap();
    copy_entry(s(&d.join("a.txt")), s(&d.join("b.txt"))).unwrap();
    assert_eq!(read(&d.join("b.txt")), "new");

    put(&d.join("src/x.txt"), "x");
    put(&d.join("dst/old.txt"), "old");
    delete_entry(s(&d.join("dst")), true).unwrap();
    move_entry(s(&d.join("src")), s(&d.join("dst"))).unwrap();
    assert_eq!(tree(&d.join("dst")), ["x.txt"]);
    assert!(!d.join("src").exists());
}

/// The cross-device fallback (copy, then delete the source) refuses a taken
/// target too, and then leaves the source alone. Needs /dev/shm on another
/// device than the temp dir; skips itself otherwise.
#[cfg(unix)]
#[test]
fn move_entry_across_devices_refuses_an_existing_target() {
    use std::os::unix::fs::MetadataExt;
    let d = Scratch::new("mv-xdev-noclobber");
    let shm = Path::new("/dev/shm");
    match (std::fs::metadata(shm), std::fs::metadata(d.path())) {
        (Ok(a), Ok(b)) if a.dev() != b.dev() => {}
        _ => {
            eprintln!("skipped: no /dev/shm on another device than the temp dir");
            return;
        }
    }
    let other = shm.join(format!(
        "glasshouse-test-{}-xdev-noclobber",
        std::process::id()
    ));
    let _ = std::fs::remove_dir_all(&other);
    put(&other.join("taken.txt"), "keep");
    put(&other.join("taken-dir/inner.txt"), "keep");
    put(&d.join("taken.txt"), "mine");
    put(&d.join("taken-dir/mine.txt"), "mine");

    let file_err = move_entry(s(&d.join("taken.txt")), s(&other.join("taken.txt")));
    let dir_err = move_entry(s(&d.join("taken-dir")), s(&other.join("taken-dir")));
    let after = (
        read(&other.join("taken.txt")),
        tree(&other.join("taken-dir")),
    );
    let _ = std::fs::remove_dir_all(&other);

    assert_eq!(file_err.unwrap_err(), taken("taken.txt", &other));
    assert_eq!(dir_err.unwrap_err(), taken("taken-dir", &other));
    assert_eq!(after, ("keep".to_string(), vec!["inner.txt".to_string()]));
    assert_eq!(read(&d.join("taken.txt")), "mine");
    assert_eq!(tree(&d.join("taken-dir")), ["mine.txt"]);
}

// ---------- progress and cancel (ops.rs) ----------

/// A tree with one file big enough for several 4 MiB copy slices.
fn tree_with_big_file(d: &Scratch) -> (PathBuf, u64) {
    let src = d.join("src");
    put(&src.join("small.txt"), "hello");
    put(&src.join("sub/also.txt"), "x");
    std::fs::write(src.join("sub/big.bin"), vec![1u8; 9 << 20]).unwrap();
    (src, 5 + 1 + (9 << 20))
}

#[test]
fn copy_reports_bytes_up_to_the_total() {
    use crate::ops::testing::{events, recorded};
    let d = Scratch::new("copy-progress");
    let (src, size) = tree_with_big_file(&d);
    let (_reg, op, seen) = recorded("c1");
    copy_path(&s(&src), &s(&d.join("dst")), &op).unwrap();
    let seen = events(&seen);
    assert!(seen.iter().all(|p| p.total == Some(size)), "{:?}", seen);
    assert!(seen.windows(2).all(|w| w[0].done <= w[1].done));
    assert_eq!(seen.last().unwrap().done, size);
    // On unix the big file went in slices, so there's more than an event per
    // file. Windows' CopyFileW copies a file in one call and reports per file.
    #[cfg(unix)]
    assert!(seen.len() > 4, "{} events", seen.len());
    assert_eq!(tree(&d.join("dst")), tree(&src));
}

#[test]
fn cancelled_copy_of_a_file_leaves_no_file() {
    use crate::ops::testing::cancels_at_first_event;
    let d = Scratch::new("copy-cancel-file");
    let (src, _) = tree_with_big_file(&d);
    let (_reg, op, _) = cancels_at_first_event("c2");
    let dst = d.join("big-copy.bin");
    assert_eq!(copy_path(&s(&src.join("sub/big.bin")), &s(&dst), &op), Err(CANCELLED.to_string()));
    assert!(std::fs::symlink_metadata(&dst).is_err(), "half-written copy left behind");
}

#[test]
fn cancelled_copy_of_a_folder_leaves_no_folder() {
    use crate::ops::OpRegistry;
    use std::sync::Arc;
    use std::time::Duration;
    let d = Scratch::new("copy-cancel-dir");
    let (src, _) = tree_with_big_file(&d);
    let before = tree(&src);
    // Cancelled at the first event with bytes done: partway into the tree,
    // so some files and folders already exist in the copy.
    let reg = Arc::new(OpRegistry::default());
    let canceller = Arc::clone(&reg);
    let op = reg.start_with(Some("c3".into()), Duration::ZERO, move |p| {
        if p.done > 0 {
            canceller.cancel("c3");
        }
    });
    let dst = d.join("dst");
    assert_eq!(copy_path(&s(&src), &s(&dst), &op), Err(CANCELLED.to_string()));
    assert!(std::fs::symlink_metadata(&dst).is_err(), "partial folder left behind");
    assert_eq!(tree(&src), before);

    // Cancelled before it started: stops while adding up the sizes, before
    // anything is created.
    let reg = OpRegistry::default();
    reg.cancel("c4");
    let op = reg.start_with(Some("c4".into()), Duration::ZERO, |_| {});
    assert_eq!(copy_path(&s(&src), &s(&dst), &op), Err(CANCELLED.to_string()));
    assert!(std::fs::symlink_metadata(&dst).is_err());
}

#[cfg(unix)]
#[test]
fn set_permissions_applies_the_mode_and_refuses_anything_bigger() {
    use std::os::unix::fs::PermissionsExt;
    let d = Scratch::new("chmod");
    std::fs::create_dir(d.join("shared")).unwrap();
    let mode = || std::fs::metadata(d.join("shared")).unwrap().permissions().mode() & 0o7777;
    set_permissions(s(&d.join("shared")), 0o2750).unwrap();
    assert_eq!(mode(), 0o2750);
    let err = set_permissions(s(&d.join("shared")), 0o10755).unwrap_err();
    assert!(err.contains("isn't a permission mode"), "{}", err);
    assert_eq!(mode(), 0o2750);
}
