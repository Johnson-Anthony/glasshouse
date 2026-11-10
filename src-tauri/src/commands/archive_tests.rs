//! archive_create / archive_extract through tar and 7-Zip, and extraction
//! never writing outside the destination folder.

use crate::commands::testing::{put, s, tree, Scratch};
use super::*;
use std::io::Write;

/// `root/payload` with a nested file and an empty folder.
#[cfg_attr(windows, allow(dead_code))]
fn payload(root: &Path) -> PathBuf {
    let src = root.join("payload");
    put(&src.join("top.txt"), "top");
    put(&src.join("nested/inner.txt"), "inner");
    std::fs::create_dir_all(src.join("nested/empty")).unwrap();
    src
}

/// `payload` extracted into `out`: the same tree, nothing else.
#[cfg_attr(windows, allow(dead_code))]
fn assert_payload(out: &Path) {
    assert_eq!(
        tree(out),
        [
            "payload/",
            "payload/nested/",
            "payload/nested/empty/",
            "payload/nested/inner.txt",
            "payload/top.txt",
        ]
    );
    assert_eq!(std::fs::read_to_string(out.join("payload/nested/inner.txt")).unwrap(), "inner");
}

#[cfg_attr(windows, allow(dead_code))]
fn tool_works(program: &str, args: &[&str], cwd: &Path) -> bool {
    std::process::Command::new(program)
        .args(args)
        .current_dir(cwd)
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

#[cfg(unix)]
#[test]
fn tar_gz_round_trip_keeps_the_tree() {
    if which::which("tar").is_err() {
        return;
    }
    let d = Scratch::new("tgz-rt");
    let src = payload(d.path());
    let archive = d.join("payload.tar.gz");
    archive_create(vec![s(&src)], s(&archive), "tar.gz".into()).unwrap();
    assert_eq!(&std::fs::read(&archive).unwrap()[..2], &[0x1F, 0x8B], "gzip magic");

    archive_extract(s(&archive), s(&d.join("out"))).unwrap();
    assert_payload(&d.join("out"));
}

#[cfg(unix)]
#[test]
fn extracts_every_tar_flavour_by_extension() {
    if which::which("tar").is_err() {
        return;
    }
    let d = Scratch::new("tar-flavours");
    payload(d.path());
    for (name, flags) in [
        ("a.tar", "-cf"),
        ("a.tgz", "-czf"),
        ("a.TAR.GZ", "-czf"),
        ("a.tar.bz2", "-cjf"),
        ("a.tbz2", "-cjf"),
        ("a.tar.xz", "-cJf"),
        ("a.txz", "-cJf"),
    ] {
        let archive = d.join(name);
        if !tool_works("tar", &[flags, &s(&archive), "payload"], d.path()) {
            eprintln!("skipping {}: this tar can't write it", name);
            continue;
        }
        let out = d.join(format!("out-{}", name));
        archive_extract(s(&archive), s(&out)).unwrap_or_else(|e| panic!("{}: {}", name, e));
        assert_payload(&out);
    }
}

#[cfg(unix)]
#[test]
fn seven_zip_round_trip_keeps_the_tree() {
    if find_7z().is_err() {
        return; // no 7-Zip here
    }
    let d = Scratch::new("7z-rt");
    let src = payload(d.path());
    let archive = d.join("payload.7z");
    archive_create(vec![s(&src)], s(&archive), "7z".into()).unwrap();
    assert_eq!(&std::fs::read(&archive).unwrap()[..6], b"7z\xBC\xAF\x27\x1C", "7z magic");

    archive_extract(s(&archive), s(&d.join("out"))).unwrap();
    assert_payload(&d.join("out"));
}

#[test]
fn archive_create_refuses_bad_input_before_running_a_tool() {
    let d = Scratch::new("create-bad");
    put(&d.join("a/x.txt"), "x");
    put(&d.join("b/y.txt"), "y");

    let err = archive_create(vec![], s(&d.join("o.tar.gz")), "tar.gz".into()).unwrap_err();
    assert!(err.contains("no input paths"), "{}", err);

    let mixed = vec![s(&d.join("a/x.txt")), s(&d.join("b/y.txt"))];
    let err = archive_create(mixed, s(&d.join("o.tar.gz")), "tar.gz".into()).unwrap_err();
    assert!(err.contains("share a parent"), "{}", err);

    let err = archive_create(vec![s(&d.join("a/x.txt"))], s(&d.join("o.rar")), "rar".into())
        .unwrap_err();
    assert!(err.contains("unsupported format 'rar'"), "{}", err);
    assert_eq!(tree(d.path()), ["a/", "a/x.txt", "b/", "b/y.txt"], "nothing written");
}

#[test]
fn archive_extract_refuses_unknown_extensions() {
    let d = Scratch::new("extract-bad");
    put(&d.join("a.rar"), "not really");
    let err = archive_extract(s(&d.join("a.rar")), s(&d.join("out"))).unwrap_err();
    assert!(err.contains("unsupported archive extension"), "{}", err);
}

#[test]
fn archive_can_handle_knows_the_formats() {
    assert!(archive_can_handle("zip".into()));
    assert!(!archive_can_handle("rar".into()));
    assert_eq!(archive_can_handle("7z".into()), find_7z().is_ok());
}

/// A zip at `path` holding `ok.txt` plus `entries` (name, body), written
/// with whatever names it's given.
fn hostile_zip(path: &Path, entries: &[(&str, &str)]) {
    let mut z = zip::ZipWriter::new(std::fs::File::create(path).unwrap());
    let opts: zip::write::FileOptions<'_, ()> = zip::write::FileOptions::default();
    z.start_file("ok.txt", opts).unwrap();
    z.write_all(b"ok").unwrap();
    for (name, body) in entries {
        z.start_file(*name, opts).unwrap();
        z.write_all(body.as_bytes()).unwrap();
    }
    z.finish().unwrap();
}

/// Everything in `d` outside the `out` folder and the archive itself.
fn outside(d: &Scratch, archive: &str) -> Vec<String> {
    tree(d.path())
        .into_iter()
        .filter(|p| !p.starts_with("out/") && p != "out/" && p != archive)
        .collect()
}

#[test]
fn zip_extract_refuses_entries_that_climb_out() {
    let d = Scratch::new("zipslip");
    let archive = d.join("evil.zip");
    hostile_zip(&archive, &[("../escaped.txt", "evil"), ("a/../../escaped2.txt", "evil")]);

    let err = archive_extract(s(&archive), s(&d.join("out"))).unwrap_err();
    assert!(err.starts_with("extract "), "{}", err);
    assert_eq!(outside(&d, "evil.zip"), Vec::<String>::new());
}

#[cfg(unix)]
#[test]
fn zip_extract_keeps_absolute_entries_inside() {
    let d = Scratch::new("zipabs");
    let archive = d.join("abs.zip");
    let abs = s(&d.join("escaped.txt"));
    hostile_zip(&archive, &[(abs.as_str(), "evil")]);

    let _ = archive_extract(s(&archive), s(&d.join("out")));
    assert_eq!(outside(&d, "abs.zip"), Vec::<String>::new());
}

#[cfg(unix)]
#[test]
fn zip_extract_does_not_follow_an_archived_link_out() {
    let d = Scratch::new("ziplink");
    let archive = d.join("link.zip");
    {
        let mut z = zip::ZipWriter::new(std::fs::File::create(&archive).unwrap());
        let opts: zip::write::FileOptions<'_, ()> = zip::write::FileOptions::default();
        z.add_symlink("up", "..", opts).unwrap();
        z.start_file("up/escaped.txt", opts).unwrap();
        z.write_all(b"evil").unwrap();
        z.finish().unwrap();
    }
    let _ = archive_extract(s(&archive), s(&d.join("out")));
    assert_eq!(outside(&d, "link.zip"), Vec::<String>::new());
}

#[cfg(unix)]
#[test]
fn tar_extract_refuses_members_that_climb_out() {
    if which::which("tar").is_err() {
        return;
    }
    let d = Scratch::new("tarslip");
    // `-P` keeps the leading `../` in the member name.
    put(&d.join("src/escaped.txt"), "evil");
    std::fs::create_dir_all(d.join("src/inner")).unwrap();
    let archive = d.join("evil.tar");
    assert!(tool_works("tar", &["-cPf", &s(&archive), "../escaped.txt"], &d.join("src/inner")));
    std::fs::remove_dir_all(d.join("src")).unwrap();

    let _ = archive_extract(s(&archive), s(&d.join("out")));
    assert_eq!(outside(&d, "evil.tar"), Vec::<String>::new());
}

#[cfg(unix)]
#[test]
fn seven_zip_extract_keeps_climbing_entries_inside() {
    if find_7z().is_err() {
        return;
    }
    let d = Scratch::new("7zslip");
    // 7-Zip reads the format from the content, so a zip named .7z goes
    // through the 7-Zip path.
    let archive = d.join("evil.7z");
    hostile_zip(&archive, &[("../escaped.txt", "evil")]);

    let _ = archive_extract(s(&archive), s(&d.join("out")));
    assert_eq!(outside(&d, "evil.7z"), Vec::<String>::new());
}
