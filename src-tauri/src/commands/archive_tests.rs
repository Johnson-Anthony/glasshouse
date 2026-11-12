//! archive_create / archive_extract through tar and 7-Zip, and extraction
//! never writing outside the destination folder.

use crate::commands::testing::{put, read, s, tree, Scratch};
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

    extract_to(&archive, &d.join("out")).unwrap();
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
        extract_to(&archive, &out).unwrap_or_else(|e| panic!("{}: {}", name, e));
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

    extract_to(&archive, &d.join("out")).unwrap();
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
    let opts: zip::write::FileOptions<'_, '_, ()> = zip::write::FileOptions::default();
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

    let _ = extract_to(&archive, &d.join("out"));
    assert_eq!(outside(&d, "abs.zip"), Vec::<String>::new());
}

/// zip's `enclosed_name` makes a rooted name relative; `entry_path` still
/// refuses it, so the extraction fails and leaves nothing behind.
#[test]
fn zip_extract_refuses_rooted_entry_names() {
    let d = Scratch::new("ziprooted");
    for (i, name) in ["/abs.txt", "\\unc\\abs.txt", "C:abs.txt", "c:/abs.txt"].into_iter().enumerate() {
        let archive = d.join(format!("rooted{}.zip", i));
        hostile_zip(&archive, &[(name, "evil")]);
        let err = archive_extract(s(&archive), s(&d.join("out"))).unwrap_err();
        assert!(err.contains("points outside the folder"), "{}: {}", name, err);
    }
    assert!(!d.join("out").exists());
}

#[cfg(unix)]
#[test]
fn zip_extract_does_not_follow_an_archived_link_out() {
    let d = Scratch::new("ziplink");
    let archive = d.join("link.zip");
    {
        let mut z = zip::ZipWriter::new(std::fs::File::create(&archive).unwrap());
        let opts: zip::write::FileOptions<'_, '_, ()> = zip::write::FileOptions::default();
        z.add_symlink("up", "..", opts).unwrap();
        z.start_file("up/escaped.txt", opts).unwrap();
        z.write_all(b"evil").unwrap();
        z.finish().unwrap();
    }
    let _ = extract_to(&archive, &d.join("out"));
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

    let _ = extract_to(&archive, &d.join("out"));
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

    let _ = extract_to(&archive, &d.join("out"));
    assert_eq!(outside(&d, "evil.7z"), Vec::<String>::new());
}

/// The archive formats this machine can create, with their extensions.
fn creatable_formats() -> Vec<&'static str> {
    let mut formats = vec!["zip"];
    if which::which("tar").is_ok() {
        formats.extend(["tar.gz", "tar.zst"]);
    }
    if find_7z().is_ok() {
        formats.push("7z");
    }
    formats
}

#[test]
fn extract_never_replaces_existing_files() {
    let d = Scratch::new("extract-noclobber");
    let src = payload(d.path());
    for format in creatable_formats() {
        let archive = d.join(format!("payload.{}", format));
        archive_create(vec![s(&src)], s(&archive), format.into()).unwrap();
        let dest = d.join(format!("dest-{}", format));
        put(&dest.join("payload/top.txt"), "keep me");

        let staged = archive_extract(s(&archive), s(&dest)).unwrap();
        let staging = PathBuf::from(&staged.staging);
        assert_eq!(staging.parent(), Some(dest.as_path()), "{}", format);
        assert_eq!(read(&dest.join("payload/top.txt")), "keep me", "{}", format);
        assert_eq!(read(&staging.join("payload/top.txt")), "top", "{}", format);
        assert_payload(&staging);

        archive_discard_staging(staged.staging).unwrap();
        assert_eq!(tree(&dest), ["payload/", "payload/top.txt"], "{}", format);
    }
}

/// A zip of `a.txt` then `b.txt`, stored uncompressed, with one byte of
/// `b.txt` flipped so its checksum fails after `a.txt` was written.
fn zip_with_corrupt_second_entry(path: &Path) {
    let opts = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Stored);
    let mut z = zip::ZipWriter::new(std::fs::File::create(path).unwrap());
    z.start_file("a.txt", opts).unwrap();
    z.write_all(b"AAAAAAAA").unwrap();
    z.start_file("b.txt", opts).unwrap();
    z.write_all(b"BBBBBBBB").unwrap();
    z.finish().unwrap();
    let mut bytes = std::fs::read(path).unwrap();
    let at = bytes.windows(8).position(|w| w == b"BBBBBBBB").unwrap();
    bytes[at] = b'X';
    std::fs::write(path, bytes).unwrap();
}

#[test]
fn failed_extract_leaves_no_partial_output() {
    let d = Scratch::new("extract-partial");
    let archive = d.join("bad.zip");
    zip_with_corrupt_second_entry(&archive);

    let out = d.join("out");
    put(&out.join("keep.txt"), "keep");
    let err = archive_extract(s(&archive), s(&out)).unwrap_err();
    assert!(err.starts_with("extract "), "{}", err);
    assert_eq!(tree(&out), ["keep.txt"], "no a.txt and no staging folder");

    // A folder the extraction made for itself goes too.
    let fresh = d.join("fresh");
    archive_extract(s(&archive), s(&fresh)).unwrap_err();
    assert!(!fresh.exists());
}

#[test]
fn discard_staging_deletes_only_staging_folders() {
    let d = Scratch::new("discard");
    put(&d.join("mine/file.txt"), "x");
    let err = archive_discard_staging(s(&d.join("mine"))).unwrap_err();
    assert!(err.contains("isn't an extraction staging folder"), "{}", err);
    assert_eq!(read(&d.join("mine/file.txt")), "x");

    let archive = d.join("a.zip");
    hostile_zip(&archive, &[]);
    let staged = archive_extract(s(&archive), s(&d.join("out"))).unwrap();
    archive_discard_staging(staged.staging.clone()).unwrap();
    assert!(!Path::new(&staged.staging).exists());
    assert!(archive_discard_staging(staged.staging).is_err(), "only once");
}

#[test]
fn link_targets_must_stay_inside() {
    let inside = [
        ("lib/libfoo.so", "libfoo.so.1"),
        ("lib/libfoo.so", "./libfoo.so.1"),
        ("a/b/link", "../../top.txt"),
        ("a/b/link", "../c/d"),
        ("here", "."),
    ];
    for (rel, target) in inside {
        assert!(link_stays_inside(Path::new(rel), Path::new(target)), "{} -> {}", rel, target);
    }
    let outside = [
        ("up", ".."),
        ("a/link", "../../x"),
        ("abs", "/etc/passwd"),
        ("b", "dot/.."), // climbs after a name: `dot` could be a link to `.`
        ("b", "x/../y"),
        ("empty", ""),
    ];
    for (rel, target) in outside {
        assert!(!link_stays_inside(Path::new(rel), Path::new(target)), "{} -> {}", rel, target);
    }
}

#[cfg(unix)]
#[test]
fn zip_link_entries_are_made_only_when_they_stay_inside() {
    let d = Scratch::new("ziplinks");
    let archive = d.join("links.zip");
    {
        let opts = zip::write::SimpleFileOptions::default();
        let mut z = zip::ZipWriter::new(std::fs::File::create(&archive).unwrap());
        z.start_file("lib/libfoo.so.1", opts).unwrap();
        z.write_all(b"elf").unwrap();
        z.add_symlink("lib/libfoo.so", "libfoo.so.1", opts).unwrap();
        z.add_symlink("abs", "/etc/passwd", opts).unwrap();
        z.add_symlink("up", "../outside", opts).unwrap();
        z.add_symlink("dot", ".", opts).unwrap();
        z.add_symlink("dot/esc", "../x", opts).unwrap(); // `..` from root, via `dot`
        z.add_symlink("b", "dot/..", opts).unwrap();
        z.finish().unwrap();
    }
    let out = d.join("out");
    let mut skipped: Vec<String> = extract_to(&archive, &out)
        .unwrap()
        .into_iter()
        .map(|s| s.path)
        .collect();
    skipped.sort();
    assert_eq!(skipped, ["abs", "b", "dot/esc", "up"]);

    assert_eq!(std::fs::read_link(out.join("lib/libfoo.so")).unwrap(), Path::new("libfoo.so.1"));
    assert_eq!(read(&out.join("lib/libfoo.so")), "elf");
    assert_eq!(std::fs::read_link(out.join("dot")).unwrap(), Path::new("."));
    for gone in ["abs", "up", "b"] {
        assert!(std::fs::symlink_metadata(out.join(gone)).is_err(), "{}", gone);
    }
    assert!(!d.join("outside").exists() && !d.join("x").exists());
}

/// Set the unix mode stored in the central directory of the one-entry zip
/// at `path`: the zip writer itself masks modes to 0o777.
#[cfg(unix)]
fn set_stored_mode(path: &Path, mode: u32) {
    let mut bytes = std::fs::read(path).unwrap();
    let at = bytes.windows(4).position(|w| w == b"PK\x01\x02").unwrap();
    // External attributes: offset 38 of the central directory header, with
    // the unix mode (file type included) in the high 16 bits.
    let attrs = &mut bytes[at + 38..at + 42];
    let old = u32::from_le_bytes(attrs.try_into().unwrap());
    let new = (old & 0xFFFF) | ((0o100000 | mode) << 16);
    attrs.copy_from_slice(&new.to_le_bytes());
    std::fs::write(path, bytes).unwrap();
}

#[cfg(unix)]
#[test]
fn zip_extract_keeps_mode_bits_but_not_setuid() {
    use std::os::unix::fs::PermissionsExt;
    let mode = |p: &Path| std::fs::metadata(p).unwrap().permissions().mode() & 0o7777;
    let d = Scratch::new("zipmodes");

    let archive = d.join("suid.zip");
    {
        let mut z = zip::ZipWriter::new(std::fs::File::create(&archive).unwrap());
        let opts = zip::write::SimpleFileOptions::default().unix_permissions(0o755);
        z.start_file("run.sh", opts).unwrap();
        z.write_all(b"#!/bin/sh\n").unwrap();
        z.finish().unwrap();
    }
    set_stored_mode(&archive, 0o6755);
    extract_to(&archive, &d.join("out")).unwrap();
    assert_eq!(mode(&d.join("out/run.sh")), 0o755);

    // A read-only folder stays writable by its owner, so it can be moved
    // into place; its files keep their mode.
    let archive = d.join("ro.zip");
    {
        let mut z = zip::ZipWriter::new(std::fs::File::create(&archive).unwrap());
        let ro = zip::write::SimpleFileOptions::default().unix_permissions(0o555);
        z.add_directory("ro/", ro).unwrap();
        z.start_file("ro/f.txt", ro.unix_permissions(0o444)).unwrap();
        z.write_all(b"f").unwrap();
        z.finish().unwrap();
    }
    extract_to(&archive, &d.join("out2")).unwrap();
    assert_eq!(mode(&d.join("out2/ro")), 0o755);
    assert_eq!(mode(&d.join("out2/ro/f.txt")), 0o444);
}

/// Every entry name in the zip at `path`.
#[cfg(unix)]
fn zip_names(path: &Path) -> Vec<String> {
    let za = zip::ZipArchive::new(std::fs::File::open(path).unwrap()).unwrap();
    let mut names: Vec<String> = za.file_names().map(|n| n.unwrap().into_owned()).collect();
    names.sort();
    names
}

#[cfg(unix)]
#[test]
fn zip_create_reports_the_links_it_leaves_out() {
    use std::os::unix::fs::symlink;
    let d = Scratch::new("zipskips");
    put(&d.join("src/file.txt"), "f");
    std::fs::create_dir_all(d.join("src/sub")).unwrap();
    symlink("file.txt", d.join("src/file-link")).unwrap();
    symlink("sub", d.join("src/dir-link")).unwrap();
    symlink("src/file.txt", d.join("top-link")).unwrap();

    let archive = d.join("out.zip");
    let report = archive_create(
        vec![s(&d.join("src")), s(&d.join("top-link"))],
        s(&archive),
        "zip".into(),
    )
    .unwrap();
    let mut skipped: Vec<(String, String)> = report
        .skipped
        .into_iter()
        .map(|s| (s.path, s.reason))
        .collect();
    skipped.sort();
    let link = |p: &str| (s(&d.join(p)), "symbolic link".to_string());
    assert_eq!(skipped, [link("src/dir-link"), link("src/file-link"), link("top-link")]);
    assert_eq!(zip_names(&archive), ["src/", "src/file.txt", "src/sub/"]);
}

#[test]
fn failed_create_removes_the_partial_archive() {
    let d = Scratch::new("create-partial");
    put(&d.join("good.txt"), "good");
    let missing = s(&d.join("missing.txt"));

    // `good.txt` is written before `missing.txt` fails; the writer's Drop
    // would have finished that into a valid-looking zip.
    let zip = d.join("out.zip");
    let err = archive_create(vec![s(&d.join("good.txt")), missing.clone()], s(&zip), "zip".into())
        .unwrap_err();
    assert!(err.starts_with("stat "), "{}", err);
    assert!(!zip.exists());

    if which::which("tar").is_ok() {
        let tgz = d.join("out.tar.gz");
        let err = archive_create(vec![missing], s(&tgz), "tar.gz".into()).unwrap_err();
        assert!(err.starts_with("tar exited"), "{}", err);
        assert!(!tgz.exists());
    }
}

#[test]
fn zip64_from_4_gib() {
    // Pinned: the options' default timestamp is "now".
    let t = zip::DateTime::default();
    let opts = |large| {
        zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated)
            .large_file(large)
            .last_modified_time(t)
    };
    let of = |len| file_options(len).last_modified_time(t);
    assert_eq!(of(u64::from(u32::MAX) - 1), opts(false));
    assert_eq!(of(u64::from(u32::MAX)), opts(true));
    assert_eq!(of(8 << 30), opts(true));
}

/// The real thing, on a sparse file. Slow without optimizations (deflating
/// 4 GiB), so run it by hand: `cargo test zip_of_a_4_gib_file -- --ignored`.
#[test]
#[ignore]
fn zip_of_a_4_gib_file() {
    let d = Scratch::new("zip4g");
    let big = d.join("big.bin");
    let len = (4u64 << 30) + 1;
    std::fs::File::create(&big).unwrap().set_len(len).unwrap();
    let archive = d.join("big.zip");
    archive_create(vec![s(&big)], s(&archive), "zip".into()).unwrap();
    let mut za = zip::ZipArchive::new(std::fs::File::open(&archive).unwrap()).unwrap();
    let mut entry = za.by_name("big.bin").unwrap();
    assert_eq!(entry.size(), len);
    // Reading it all checks the CRC.
    assert_eq!(std::io::copy(&mut entry, &mut std::io::sink()).unwrap(), len);
}

#[cfg(windows)]
#[test]
fn extracted_files_keep_the_mark_of_the_web() {
    let d = Scratch::new("motw");
    let src = payload(d.path());
    let archive = d.join("payload.zip");
    archive_create(vec![s(&src)], s(&archive), "zip".into()).unwrap();
    let mark = "[ZoneTransfer]\r\nZoneId=3\r\n";
    std::fs::write(format!("{}:Zone.Identifier", s(&archive)), mark).unwrap();

    let out = d.join("out");
    extract_to(&archive, &out).unwrap();
    for file in ["payload/top.txt", "payload/nested/inner.txt"] {
        let stream = format!("{}:Zone.Identifier", s(&out.join(file)));
        assert_eq!(std::fs::read_to_string(&stream).unwrap(), mark, "{}", file);
    }
}

// ---------- special files, links from tar and 7-Zip, read-only folders ----------

/// A FIFO among the inputs, or inside a selected folder, is left out of a
/// zip and reported, without blocking on it.
#[cfg(unix)]
#[test]
fn zip_create_leaves_out_special_files() {
    use crate::commands::testing::{mkfifo, without_blocking};
    let d = Scratch::new("zip-fifo");
    let src = payload(d.path());
    mkfifo(&src.join("nested/pipe"));
    mkfifo(&d.join("top-pipe"));
    let archive = d.join("out.zip");
    let (inputs, dest) = (vec![s(&src), s(&d.join("top-pipe"))], s(&archive));
    let report = without_blocking(move || archive_create(inputs, dest, "zip".into())).unwrap();
    let why = "a named pipe, not a regular file".to_string();
    assert_eq!(
        report.skipped,
        [
            Skipped { path: s(&src.join("nested/pipe")), reason: why.clone() },
            Skipped { path: s(&d.join("top-pipe")), reason: why },
        ]
    );
    extract_to(&archive, &d.join("out")).unwrap();
    assert_payload(&d.join("out"));
}

/// An "archive" that's really a FIFO is refused before anything waits on it.
#[cfg(unix)]
#[test]
fn archive_extract_refuses_a_fifo() {
    use crate::commands::testing::{mkfifo, without_blocking};
    let d = Scratch::new("extract-fifo");
    for name in ["a.zip", "a.tar", "a.tar.zst", "a.7z"] {
        mkfifo(&d.join(name));
        let (archive, out) = (s(&d.join(name)), s(&d.join("out")));
        let err = without_blocking(move || archive_extract(archive, out)).unwrap_err();
        assert_eq!(err, format!("open {}: a named pipe, not a regular file", d.join(name).display()));
    }
    assert!(!d.join("out").exists());
}

/// Links tar extracts with targets outside the archive are removed and
/// reported, by zip's rule; links that stay inside are kept.
#[cfg(unix)]
#[test]
fn tar_extract_drops_links_that_point_outside() {
    if which::which("tar").is_err() {
        return;
    }
    let d = Scratch::new("tar-links");
    let links = d.join("src/links");
    put(&links.join("f.txt"), "f");
    put(&links.join("sub/g.txt"), "g");
    let link = |target: &str, at: &str| std::os::unix::fs::symlink(target, links.join(at)).unwrap();
    link("f.txt", "in");
    link("../f.txt", "sub/up-in");
    link("/etc/passwd", "abs");
    link("../../outside", "up");
    link("sub/../../x", "sneaky");
    let archive = d.join("links.tar");
    assert!(tool_works("tar", &["-cf", &s(&archive), "links"], &d.join("src")));

    let out = d.join("out");
    let mut skipped = extract_to(&archive, &out).unwrap();
    skipped.sort_by(|a, b| a.path.cmp(&b.path));
    let outside = |path: &str, target: &str| Skipped {
        path: path.into(),
        reason: format!("its target {} is outside the archive", target),
    };
    assert_eq!(
        skipped,
        [
            outside("links/abs", "/etc/passwd"),
            outside("links/sneaky", "sub/../../x"),
            outside("links/up", "../../outside"),
        ]
    );
    assert_eq!(
        tree(&out),
        ["links/", "links/f.txt", "links/in", "links/sub/", "links/sub/g.txt", "links/sub/up-in"]
    );
    assert_eq!(read(&out.join("links/sub/up-in")), "f");
}

/// The same for 7-Zip, which keeps an absolute link absolute (newer
/// versions point it under the output folder, still absolute). A 7-Zip
/// that can't store links (`-snl`) can't make the archive; the test skips.
#[cfg(unix)]
#[test]
fn seven_zip_extract_drops_links_that_point_outside() {
    let Ok(program) = find_7z() else { return };
    let d = Scratch::new("7z-links");
    let links = d.join("src/links");
    put(&links.join("f.txt"), "f");
    std::os::unix::fs::symlink("f.txt", links.join("in")).unwrap();
    std::os::unix::fs::symlink("/etc/passwd", links.join("abs")).unwrap();
    let archive = d.join("links.7z");
    if !tool_works(&program, &["a", "-snl", &s(&archive), "links"], &d.join("src")) {
        return;
    }
    let out = d.join("out");
    let skipped = extract_to(&archive, &out).unwrap();
    assert_eq!(skipped.iter().map(|k| k.path.as_str()).collect::<Vec<_>>(), ["links/abs"]);
    assert_eq!(tree(&out), ["links/", "links/f.txt", "links/in"]);
}

/// A read-only folder from a tar can still be moved out of the staging
/// folder (moving a folder to another parent needs write permission on it),
/// and comes out owner-writable, as zip_extract makes it.
#[cfg(unix)]
#[test]
fn tar_read_only_folders_can_be_moved_into_place() {
    use std::os::unix::fs::PermissionsExt;
    if which::which("tar").is_err() {
        return;
    }
    let d = Scratch::new("tar-ro");
    put(&d.join("src/ro/inner/x.txt"), "x");
    let set = |p: &str, m: u32| std::fs::set_permissions(d.join(p), std::fs::Permissions::from_mode(m)).unwrap();
    set("src/ro/inner", 0o555);
    set("src/ro", 0o555);
    let archive = d.join("ro.tar");
    assert!(tool_works("tar", &["-cf", &s(&archive), "ro"], &d.join("src")));
    set("src/ro", 0o755);
    set("src/ro/inner", 0o755);

    let out = d.join("out");
    extract_to(&archive, &out).unwrap();
    assert_eq!(tree(&out), ["ro/", "ro/inner/", "ro/inner/x.txt"]);
    let mode = |p: &str| std::fs::metadata(out.join(p)).unwrap().permissions().mode() & 0o777;
    assert_eq!((mode("ro"), mode("ro/inner")), (0o755, 0o755));
}
