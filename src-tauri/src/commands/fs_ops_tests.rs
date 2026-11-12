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
    let d = Scratch::new("mv-xdev-noclobber");
    let Some(other) = other_device(&d, "xdev-noclobber") else { return };
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

/// A fresh folder `name` in /dev/shm, if that's on another device than the
/// scratch folder `d` (as on this machine and CI's Linux runners), for the
/// cross-volume move fallback; else None, and the test skips itself.
#[cfg(unix)]
fn other_device(d: &Scratch, name: &str) -> Option<PathBuf> {
    use std::os::unix::fs::MetadataExt;
    let shm = Path::new("/dev/shm");
    match (std::fs::metadata(shm), std::fs::metadata(d.path())) {
        (Ok(a), Ok(b)) if a.dev() != b.dev() => {}
        _ => {
            eprintln!("skipped: no /dev/shm on another device than the temp dir");
            return None;
        }
    }
    let other = shm.join(format!("glasshouse-test-{}-{}", std::process::id(), name));
    let _ = remove_created_tree(&other);
    std::fs::create_dir(&other).unwrap();
    Some(other)
}

#[cfg(unix)]
fn chmod(path: &Path, mode: u32) {
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(mode)).unwrap();
}

#[cfg(unix)]
fn mode(path: &Path) -> u32 {
    use std::os::unix::fs::PermissionsExt;
    std::fs::symlink_metadata(path).unwrap().permissions().mode() & 0o7777
}

/// 2001-09-09, a time no test file has by accident.
#[cfg(unix)]
fn past() -> std::time::SystemTime {
    std::time::UNIX_EPOCH + std::time::Duration::from_secs(1_000_000_000)
}

/// Give `path` (a file or folder) `past()` as its access and modification time.
#[cfg(unix)]
fn age(path: &Path) {
    let times = std::fs::FileTimes::new().set_accessed(past()).set_modified(past());
    std::fs::File::open(path).unwrap().set_times(times).unwrap();
}

#[cfg(unix)]
fn times(path: &Path) -> (std::time::SystemTime, std::time::SystemTime) {
    let m = std::fs::symlink_metadata(path).unwrap();
    (m.accessed().unwrap(), m.modified().unwrap())
}

// ---------- failed copies and moves, special files, times and modes ----------

/// A copy that fails partway removes its half-made folder, so a retry isn't
/// refused as "already exists". The error names the entry that failed.
#[cfg(unix)]
#[test]
fn failed_folder_copy_leaves_nothing_behind() {
    let d = Scratch::new("cp-fail-cleanup");
    put(&d.join("src/a.txt"), "a");
    put(&d.join("src/sub/b.txt"), "b");
    let fifo = d.join("src/sub/pipe");
    crate::commands::testing::mkfifo(&fifo);

    let (from, to) = (s(&d.join("src")), s(&d.join("dst")));
    let err = crate::commands::testing::without_blocking(move || copy_entry(from, to)).unwrap_err();
    assert_eq!(err, format!("can't copy {}: a named pipe, not a regular file", fifo.display()));
    assert!(std::fs::symlink_metadata(d.join("dst")).is_err(), "partial copy left behind");

    std::fs::remove_file(&fifo).unwrap();
    copy_entry(s(&d.join("src")), s(&d.join("dst"))).unwrap();
    assert_eq!(tree(&d.join("dst")), ["a.txt", "sub/", "sub/b.txt"]);
}

/// Cleanup gets through read-only folders the copy made, and never changes
/// a folder outside the tree through a link.
#[cfg(unix)]
#[test]
fn remove_created_tree_gets_through_read_only_folders() {
    let d = Scratch::new("rm-created");
    put(&d.join("made/ro/deeper/f.txt"), "f");
    put(&d.join("keep/k.txt"), "k");
    std::os::unix::fs::symlink(d.join("keep"), d.join("made/ro/link")).unwrap();
    chmod(&d.join("made/ro/deeper"), 0o500);
    chmod(&d.join("made/ro"), 0o555);
    chmod(&d.join("keep"), 0o555);

    remove_created_tree(&d.join("made")).unwrap();
    assert!(std::fs::symlink_metadata(d.join("made")).is_err());
    assert_eq!(mode(&d.join("keep")), 0o555, "a linked-to folder's mode was changed");
    assert_eq!(read(&d.join("keep/k.txt")), "k");
    chmod(&d.join("keep"), 0o755);
}

/// Copies keep each file's times, and each folder's mode and modification
/// time, set once the folder's contents are in (a 0555 folder still gets
/// them).
#[cfg(unix)]
#[test]
fn copy_keeps_times_and_folder_modes() {
    let d = Scratch::new("cp-times");
    let src = d.join("src");
    put(&src.join("f.txt"), "f");
    put(&src.join("ro/g.txt"), "g");
    for p in ["f.txt", "ro/g.txt", "ro", ""] {
        age(&src.join(p));
    }
    chmod(&src.join("ro"), 0o555);
    chmod(&src, 0o750);

    copy_entry(s(&src), s(&d.join("dst"))).unwrap();
    let dst = d.join("dst");
    assert_eq!(tree(&dst), ["f.txt", "ro/", "ro/g.txt"]);
    for p in ["f.txt", "ro/g.txt"] {
        assert_eq!(times(&dst.join(p)), (past(), past()), "times of {}", p);
    }
    for p in ["ro", ""] {
        assert_eq!(times(&dst.join(p)).1, past(), "modified time of {:?}", p);
    }
    assert_eq!((mode(&dst), mode(&dst.join("ro"))), (0o750, 0o555));

    chmod(&src, 0o755);
    remove_created_tree(d.path()).unwrap();
}

/// A cross-volume move whose copy is done but whose delete fails: a file's
/// copy is removed again (its source is intact), a folder's copy is kept
/// (its source may be partly gone) and the error says so. A move that works
/// keeps the times.
#[cfg(unix)]
#[test]
fn move_across_devices_handles_a_failed_delete() {
    let d = Scratch::new("mv-xdev-delete");
    let Some(other) = other_device(&d, "xdev-delete") else { return };

    // A file in a folder it can't be removed from.
    put(&d.join("ro/f.txt"), "f");
    chmod(&d.join("ro"), 0o555);
    let err = move_entry(s(&d.join("ro/f.txt")), s(&other.join("f.txt"))).unwrap_err();
    assert!(err.contains("so it wasn't moved"), "{}", err);
    assert!(std::fs::symlink_metadata(other.join("f.txt")).is_err(), "copy left behind");
    assert_eq!(read(&d.join("ro/f.txt")), "f");

    // A folder with a file in a folder it can't be removed from.
    put(&d.join("tree/ok.txt"), "ok");
    put(&d.join("tree/locked/x.txt"), "x");
    chmod(&d.join("tree/locked"), 0o555);
    let err = move_entry(s(&d.join("tree")), s(&other.join("tree"))).unwrap_err();
    assert!(err.starts_with(&format!("copied to {}, but some of the original", s(&other.join("tree")))), "{}", err);
    assert_eq!(tree(&other.join("tree")), ["locked/", "locked/x.txt", "ok.txt"]);
    assert_eq!(read(&d.join("tree/locked/x.txt")), "x");

    put(&d.join("t.txt"), "t");
    age(&d.join("t.txt"));
    move_entry(s(&d.join("t.txt")), s(&other.join("t.txt"))).unwrap();
    assert_eq!(times(&other.join("t.txt")).1, past());
    assert!(std::fs::symlink_metadata(d.join("t.txt")).is_err());

    let _ = remove_created_tree(&other);
    let _ = remove_created_tree(d.path());
}

/// Previews, hex dumps, diffs and copies refuse a FIFO without waiting for
/// a writer, and refuse devices and folders too.
#[cfg(unix)]
#[test]
fn readers_refuse_special_files_without_blocking() {
    use crate::commands::file_info::{read_capped, read_hex_dump};
    let d = Scratch::new("special-readers");
    let fifo = d.join("pipe");
    crate::commands::testing::mkfifo(&fifo);

    let p = s(&fifo);
    let errs = crate::commands::testing::without_blocking(move || {
        vec![
            read_text(p.clone(), 0).unwrap_err(),
            read_image_b64(p.clone(), 0).unwrap_err(),
            read_hex_dump(p.clone(), 0, 0).unwrap_err(),
            read_capped(Path::new(&p)).unwrap_err(),
            copy_entry(p.clone(), format!("{}-copy", p)).unwrap_err(),
        ]
    });
    for e in errs {
        assert!(e.ends_with("a named pipe, not a regular file"), "{}", e);
    }
    assert!(std::fs::symlink_metadata(d.join("pipe-copy")).is_err());

    assert_eq!(read_text("/dev/null".into(), 0).unwrap_err(), "a device, not a regular file");
    assert_eq!(read_text(s(d.path()), 0).unwrap_err(), "a folder, not a regular file");
    // A link to a regular file is still read.
    put(&d.join("real.txt"), "real");
    std::os::unix::fs::symlink("real.txt", d.join("link")).unwrap();
    assert_eq!(read_text(s(&d.join("link")), 0).unwrap(), "real");
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
