//! MIME lookup, desktop entries, `mimeapps.list` precedence and `Exec`
//! expansion, on scratch XDG trees.

use super::*;
use crate::commands::testing::{put, Scratch};

/// XDG dirs inside `root`: `home/` for the user's data and config,
/// `sys1/` and `sys2/` as system data dirs, `etc/` as a config dir.
fn dirs_in(root: &Path, desktops: &[&str]) -> XdgDirs {
    XdgDirs {
        data_home: root.join("home/data"),
        data_dirs: vec![root.join("sys1"), root.join("sys2")],
        config_home: root.join("home/config"),
        config_dirs: vec![root.join("etc")],
        // Lowercased, as from_env does.
        desktops: desktops.iter().map(|d| d.to_ascii_lowercase()).collect(),
    }
}

fn app(name: &str, exec: &str, mime: &str) -> String {
    format!("[Desktop Entry]\nType=Application\nName={name}\nExec={exec}\nMimeType={mime}\n")
}

fn entry(exec: &str) -> DesktopEntry {
    DesktopEntry {
        id: "t.desktop".into(),
        path: PathBuf::from("/apps/t.desktop"),
        name: "Tool".into(),
        exec: Some(exec.into()),
        is_app: true,
        icon: Some("tool".into()),
        ..Default::default()
    }
}

fn argvs(exec: &str, files: &[&str]) -> Result<Vec<Vec<String>>, String> {
    let files: Vec<String> = files.iter().map(|f| f.to_string()).collect();
    exec_argvs(&entry(exec), &files)
}

fn one(exec: &str, files: &[&str]) -> Vec<String> {
    let mut all = argvs(exec, files).unwrap();
    assert_eq!(all.len(), 1, "{all:?}");
    all.remove(0)
}

fn v(items: &[&str]) -> Vec<String> {
    items.iter().map(|s| s.to_string()).collect()
}

/// File names that would do something if any shell, or a second round of
/// parsing, ever saw them.
const HOSTILE: &[&str] = &[
    "/home/me/my file.txt",
    "/home/me/quote\"d.txt",
    "/home/me/it's.txt",
    "/home/me/a;rm -rf ~.txt",
    "/home/me/$(touch pwned).txt",
    "/home/me/`touch pwned`.txt",
    "/home/me/-rf",
    "/home/me/%f 100%.txt",
    "/home/me/back\\slash.txt",
    "/home/me/new\nline.txt",
];

// ---------- globs and types ----------

#[test]
fn globs_match_like_fnmatch() {
    assert!(glob_match("*.txt", "notes.txt"));
    assert!(!glob_match("*.txt", "notes.txt.bak"));
    assert!(glob_match("*.tar.gz", "a.tar.gz"));
    assert!(glob_match("makefile", "makefile"));
    assert!(glob_match("[Mm]akefile", "Makefile"));
    assert!(!glob_match("[Mm]akefile", "xakefile"));
    assert!(glob_match("*.[1-9]", "ls.1"));
    assert!(!glob_match("*.[1-9]", "ls.0"));
    assert!(glob_match("*.[!a-z]", "x.1"));
    assert!(!glob_match("*.[!a-z]", "x.q"));
    assert!(glob_match("README*", "README.md"));
    assert!(glob_match("?.c", "a.c"));
    assert!(!glob_match("?.c", "ab.c"));
    assert!(glob_match("*a*b*", "xxaxxbxx"));
    // An unclosed class is a literal `[`.
    assert!(glob_match("x[y", "x[y"));
    assert!(glob_match("*", ""));
    assert!(!glob_match("a", ""));
}

#[test]
fn the_highest_weight_then_the_longest_pattern_wins() {
    let t = Scratch::new("xdg-globs");
    let dirs = dirs_in(t.path(), &[]);
    put(
        &t.join("sys1/mime/globs2"),
        "# comment\n\
         50:application/gzip:*.gz\n\
         50:application/x-compressed-tar:*.tar.gz\n\
         50:text/x-csrc:*.c\n\
         50:text/x-c++src:*.C:cs\n\
         80:text/x-makefile:makefile\n\
         10:text/x-readme:readme*\n\
         50:application/x-old:*.old\n",
    );
    put(&t.join("sys1/mime/aliases"), "application/x-gzip application/gzip\n");
    let db = MimeDb::load(&dirs);
    assert!(!db.is_empty());
    assert_eq!(db.type_for_name("a.tar.gz").as_deref(), Some("application/x-compressed-tar"));
    assert_eq!(db.type_for_name("a.gz").as_deref(), Some("application/gzip"));
    assert_eq!(db.type_for_name("A.GZ").as_deref(), Some("application/gzip"), "case-insensitive");
    assert_eq!(db.type_for_name("x.C").as_deref(), Some("text/x-c++src"), "cs pattern");
    assert_eq!(db.type_for_name("x.c").as_deref(), Some("text/x-csrc"));
    assert_eq!(db.type_for_name("Makefile").as_deref(), Some("text/x-makefile"));
    assert_eq!(db.type_for_name("README.md").as_deref(), Some("text/x-readme"));
    assert_eq!(db.type_for_name("nothing"), None);
    assert_eq!(db.unalias("application/x-gzip"), "application/gzip");
}

#[test]
fn a_more_important_dir_can_drop_a_types_globs_and_the_old_format_still_reads() {
    let t = Scratch::new("xdg-noglobs");
    let dirs = dirs_in(t.path(), &[]);
    // The user's own database, in the old `globs` format.
    put(&t.join("home/data/mime/globs"), "text/x-mine:*.mine\napplication/x-old:__NOGLOBS__\n");
    put(&t.join("sys1/mime/globs2"), "50:application/x-old:*.old\n50:text/plain:*.txt\n");
    let db = MimeDb::load(&dirs);
    assert_eq!(db.type_for_name("a.mine").as_deref(), Some("text/x-mine"));
    assert_eq!(db.type_for_name("a.old"), None);
    assert_eq!(db.type_for_name("a.txt").as_deref(), Some("text/plain"));
}

#[test]
fn a_type_chain_has_its_parents_then_text_plain() {
    let t = Scratch::new("xdg-chain");
    let dirs = dirs_in(t.path(), &[]);
    put(&t.join("sys1/mime/globs2"), "50:text/x-python3:*.py\n");
    put(
        &t.join("sys1/mime/subclasses"),
        "text/x-python3 text/x-python\ntext/x-python application/x-executable\napplication/x-executable application/octet-stream\n",
    );
    put(&t.join("sys1/mime/aliases"), "text/x-py text/x-python3\n");
    let db = MimeDb::load(&dirs);
    assert_eq!(
        db.type_chain("text/x-py"),
        v(&["text/x-python3", "text/x-python", "application/x-executable", "application/octet-stream", "text/plain"])
    );
    assert_eq!(db.type_chain("image/png"), v(&["image/png"]));
    assert_eq!(db.type_chain("text/plain"), v(&["text/plain"]));
}

#[test]
fn unmatched_names_are_sniffed() {
    assert_eq!(sniff_bytes(b""), "text/plain");
    assert_eq!(sniff_bytes(b"hello\nworld"), "text/plain");
    assert_eq!(sniff_bytes("caf\u{e9}".as_bytes()), "text/plain");
    // Cut mid-character by the 4 KiB sample.
    assert_eq!(sniff_bytes(&"caf\u{e9}".as_bytes()[..4]), "text/plain");
    assert_eq!(sniff_bytes(b"\x7fELF\x02\x01\x01"), "application/x-executable");
    assert_eq!(sniff_bytes(b"PK\x03\x04\x00\x00"), "application/octet-stream");
    assert_eq!(sniff_bytes(b"\xff\xfe\xfd text"), "application/octet-stream");
}

#[test]
fn a_files_type_comes_from_its_kind_name_or_content() {
    let t = Scratch::new("xdg-mime-path");
    let dirs = dirs_in(t.path(), &[]);
    put(&t.join("sys1/mime/globs2"), "50:text/markdown:*.md\n");
    let db = MimeDb::load(&dirs);
    put(&t.join("f/notes.md"), "# hi");
    put(&t.join("f/LICENSE"), "MIT");
    std::fs::write(t.join("f/blob"), [0u8, 1, 2, 3]).unwrap();
    std::fs::write(t.join("f/prog"), b"\x7fELF\x02\x01\x01\x00").unwrap();
    assert_eq!(mime_for_path(&db, &t.join("f/notes.md")), "text/markdown");
    assert_eq!(mime_for_path(&db, &t.join("f/LICENSE")), "text/plain");
    assert_eq!(mime_for_path(&db, &t.join("f/blob")), "application/octet-stream");
    assert_eq!(mime_for_path(&db, &t.join("f/prog")), "application/x-executable");
    assert_eq!(mime_for_path(&db, &t.join("f")), "inode/directory");
    assert_eq!(mime_for_path(&db, &t.join("f/gone")), "application/octet-stream");
}

#[cfg(unix)]
#[test]
fn a_fifo_is_typed_without_opening_it() {
    let t = Scratch::new("xdg-fifo");
    let db = MimeDb::default();
    let fifo = t.join("pipe.txt");
    let c = std::ffi::CString::new(fifo.to_string_lossy().as_bytes()).unwrap();
    assert_eq!(unsafe { libc::mkfifo(c.as_ptr(), 0o600) }, 0);
    // Would block forever if it were opened for the sniff.
    assert_eq!(mime_for_path(&db, &fifo), "inode/fifo");
}

// ---------- desktop entries ----------

#[test]
fn locale_keys_go_from_most_to_least_specific() {
    assert_eq!(locale_keys("de_DE.UTF-8@euro"), v(&["de_DE@euro", "de_DE", "de@euro", "de"]));
    assert_eq!(locale_keys("fr_CA.UTF-8"), v(&["fr_CA", "fr"]));
    assert_eq!(locale_keys("sr@latin"), v(&["sr@latin", "sr"]));
    assert!(locale_keys("C.UTF-8").is_empty());
    assert!(locale_keys("").is_empty());
}

#[test]
fn an_entry_reads_its_main_group_only() {
    let text = "# leading comment\n\
        [Desktop Entry]\n\
        Type=Application\n\
        Name=Text Editor\n\
        Name[de]=Texteditor\n\
        Name[de_DE]=Texteditor (DE)\n\
        Exec = edit\\s--new %F\n\
        TryExec=/no/such/edit\n\
        Path=/work\n\
        Terminal=true\n\
        Icon=accessories-text-editor\n\
        MimeType=text/plain;text/x-log;\n\
        \n\
        [Desktop Action new-window]\n\
        Name=Should not win\n\
        Exec=other\n";
    let e = parse_entry("ed.desktop", Path::new("/a/ed.desktop"), text, &v(&["de_DE", "de"]));
    assert_eq!(e.name, "Texteditor (DE)");
    assert_eq!(e.exec.as_deref(), Some("edit --new %F"));
    assert_eq!(e.try_exec.as_deref(), Some("/no/such/edit"));
    assert_eq!(e.work_dir.as_deref(), Some("/work"));
    assert!(e.terminal && e.is_app && !e.hidden);
    assert_eq!(e.icon.as_deref(), Some("accessories-text-editor"));
    assert_eq!(e.mime_types, v(&["text/plain", "text/x-log"]));
    assert!(!e.installed(), "TryExec is missing");

    let plain = parse_entry("ed.desktop", Path::new("/a/ed.desktop"), text, &v(&["fr"]));
    assert_eq!(plain.name, "Text Editor");
    let unnamed = parse_entry("org.x.Y.desktop", Path::new("/a"), "[Desktop Entry]\nType=Application\nExec=y\n", &[]);
    assert_eq!(unnamed.name, "org.x.Y");
    assert!(unnamed.installed());
    for hidden in [
        "[Desktop Entry]\nType=Application\nExec=y\nHidden=true\n",
        "[Desktop Entry]\nType=Link\nURL=https://example.com\n",
        "[Desktop Entry]\nType=Application\nName=No exec\n",
        "[Other Group]\nType=Application\nExec=y\n",
    ] {
        assert!(!parse_entry("h.desktop", Path::new("/a"), hidden, &[]).installed(), "{hidden}");
    }
}

#[cfg(unix)]
#[test]
fn an_entry_whose_try_exec_exists_is_installed() {
    let e = parse_entry("sh.desktop", Path::new("/a"), "[Desktop Entry]\nType=Application\nExec=sh\nTryExec=/bin/sh\n", &[]);
    assert!(e.installed());
    let e = parse_entry("sh.desktop", Path::new("/a"), "[Desktop Entry]\nType=Application\nExec=sh\nTryExec=sh\n", &[]);
    assert!(e.installed(), "found on PATH");
}

// ---------- associations ----------

/// A tree with a user app, two system apps and a hidden override.
fn sample_tree(t: &Scratch, desktops: &[&str]) -> (XdgDirs, MimeDb) {
    let dirs = dirs_in(t.path(), desktops);
    put(&t.join("sys1/mime/globs2"), "50:text/x-python3:*.py\n50:text/plain:*.txt\n50:image/png:*.png\n");
    put(&t.join("sys1/mime/subclasses"), "text/x-python3 text/plain\n");
    put(&t.join("sys1/mime/aliases"), "text/x-py text/x-python3\n");
    // The user's editor, listed under an alias.
    put(&t.join("home/data/applications/mine.desktop"), &app("Mine", "mine %f", "text/x-py;"));
    put(&t.join("sys1/applications/gedit.desktop"), &app("Gedit", "gedit %U", "text/plain;"));
    put(&t.join("sys1/applications/ide.desktop"), &app("IDE", "ide %F", "text/x-python3;"));
    put(&t.join("sys1/applications/kde/viewer.desktop"), &app("Viewer", "viewer %u", "image/png;"));
    // Hidden in a more important dir: removed, though sys2 still has it.
    put(&t.join("sys1/applications/gone.desktop"), "[Desktop Entry]\nHidden=true\n");
    put(&t.join("sys2/applications/gone.desktop"), &app("Gone", "gone %f", "text/plain;image/png;"));
    let db = MimeDb::load(&dirs);
    (dirs, db)
}

fn ids(list: &[&DesktopEntry]) -> Vec<String> {
    list.iter().map(|e| e.id.clone()).collect()
}

#[test]
fn associations_follow_the_mime_apps_spec() {
    let t = Scratch::new("xdg-assoc");
    let (dirs, db) = sample_tree(&t, &[]);
    let idx = AppIndex::load(&dirs, &db);
    assert!(idx.get("kde-viewer.desktop").is_some(), "subfolder IDs use -");
    assert!(idx.get("gone.desktop").is_none(), "hidden by sys1");
    // MimeType= order: user dir first, then sys1 by ID.
    assert_eq!(ids(&idx.associations("text/x-python3")), v(&["mine.desktop", "ide.desktop"]));
    assert_eq!(ids(&idx.associations("text/plain")), v(&["gedit.desktop"]));

    // Added Associations come first; Removed ones go, also from MimeType=.
    put(
        &t.join("home/config/mimeapps.list"),
        "[Added Associations]\ntext/plain=kde-viewer.desktop;missing.desktop;\n\
         [Removed Associations]\ntext/x-py=mine.desktop;\n",
    );
    let idx = AppIndex::load(&dirs, &db);
    assert_eq!(ids(&idx.associations("text/plain")), v(&["kde-viewer.desktop", "gedit.desktop"]));
    assert_eq!(ids(&idx.associations("text/x-python3")), v(&["ide.desktop"]));
}

#[test]
fn the_default_is_per_type_nearest_first_as_glib_picks_it() {
    let t = Scratch::new("xdg-default");
    let (dirs, db) = sample_tree(&t, &["GNOME"]);
    let chain = db.type_chain("text/x-python3");
    // No defaults anywhere: the python type's own first association, not
    // text/plain's, though text/plain is in the chain.
    let idx = AppIndex::load(&dirs, &db);
    assert_eq!(idx.default_for(&chain).map(|e| e.id.as_str()), Some("mine.desktop"));

    // A system default for text/plain doesn't beat the python associations.
    put(&t.join("etc/mimeapps.list"), "[Default Applications]\ntext/plain=gedit.desktop\n");
    let idx = AppIndex::load(&dirs, &db);
    assert_eq!(idx.default_for(&chain).map(|e| e.id.as_str()), Some("mine.desktop"));
    assert_eq!(idx.default_for(&db.type_chain("text/plain")).map(|e| e.id.as_str()), Some("gedit.desktop"));

    // A python default does; the first installed one counts, and the
    // desktop-specific list outranks the plain one in the same folder.
    put(&t.join("home/config/mimeapps.list"), "[Default Applications]\ntext/x-python3=gone.desktop;mine.desktop\n");
    put(&t.join("home/config/gnome-mimeapps.list"), "[Default Applications]\ntext/x-py=ide.desktop\n");
    let idx = AppIndex::load(&dirs, &db);
    assert_eq!(idx.default_for(&chain).map(|e| e.id.as_str()), Some("ide.desktop"));
    let apps = idx.apps_for(&chain);
    assert_eq!(
        apps.iter().map(|a| (a.id.as_str(), a.name.as_str(), a.is_default)).collect::<Vec<_>>(),
        [("ide.desktop", "IDE", true), ("mine.desktop", "Mine", false), ("gedit.desktop", "Gedit", false)]
    );
    std::fs::remove_file(t.join("home/config/gnome-mimeapps.list")).unwrap();
    let idx = AppIndex::load(&dirs, &db);
    assert_eq!(idx.default_for(&chain).map(|e| e.id.as_str()), Some("mine.desktop"), "gone.desktop is skipped");

    // A NoDisplay handler can be the default, but isn't listed otherwise.
    put(
        &t.join("sys1/applications/handler.desktop"),
        &(app("Handler", "handler %f", "text/plain;image/png;") + "NoDisplay=true\n"),
    );
    put(&t.join("home/config/mimeapps.list"), "[Default Applications]\nimage/png=handler.desktop\n");
    let idx = AppIndex::load(&dirs, &db);
    let names = |mime: &str| -> Vec<String> {
        idx.apps_for(&db.type_chain(mime)).into_iter().map(|a| a.name).collect()
    };
    assert_eq!(names("image/png"), v(&["Handler", "Viewer"]));
    assert_eq!(names("text/plain"), v(&["Gedit"]));
    assert!(parse_entry("h.desktop", Path::new("/a"), "[Desktop Entry]\nNoDisplay=true\n", &[]).no_display);

    // Nothing at all for a type: no default, and no apps.
    assert!(idx.default_for(&db.type_chain("application/x-unknown")).is_none());
    assert!(idx.apps_for(&db.type_chain("application/x-unknown")).is_empty());
}

// ---------- Exec ----------

#[test]
fn exec_words_split_as_the_spec_quotes_them() {
    assert_eq!(one("prog --flag", &[]), v(&["prog", "--flag"]));
    assert_eq!(one("  prog   a\tb  ", &[]), v(&["prog", "a", "b"]));
    assert_eq!(one(r#""/opt/My App/run" --x"#, &[]), v(&["/opt/My App/run", "--x"]));
    assert_eq!(one(r#"sh -c "echo \"hi\" \$HOME \`x\` \\ \n""#, &[]), v(&["sh", "-c", r#"echo "hi" $HOME `x` \ \n"#]));
    assert_eq!(one("sh -c 'a \"b\" $c'", &[]), v(&["sh", "-c", "a \"b\" $c"]));
    assert_eq!(one(r"prog a\ b \;", &[]), v(&["prog", "a b", ";"]));
    assert_eq!(one(r#"prog "" x"#, &[]), v(&["prog", "", "x"]));
    assert_eq!(one("prog 100%% \"50%%\"", &[]), v(&["prog", "100%", "50%"]));
    assert_eq!(one("prog \"50% off\"", &[]), v(&["prog", "50% off"]));
    assert!(argvs("prog \"unclosed", &[]).unwrap_err().contains("unclosed"));
    assert!(argvs("prog 'unclosed", &[]).is_err());
}

#[test]
fn field_codes_expand_inside_words_after_splitting() {
    let f = "/home/me/my file.txt";
    let g = "/home/me/other.txt";
    assert_eq!(one("edit %f", &[f]), v(&["edit", f]));
    assert_eq!(one("edit %u", &[f]), v(&["edit", f]));
    assert_eq!(one("edit %F", &[f, g]), v(&["edit", f, g]));
    assert_eq!(one("edit %U --end", &[f, g]), v(&["edit", f, g, "--end"]));
    assert_eq!(one("edit --file=%f", &[f]), v(&["edit", &format!("--file={f}")]));
    assert_eq!(one("edit --files=%F", &[f, g]), v(&["edit", &format!("--files={f}")]));
    assert_eq!(one("edit %i %c %k", &[f]), v(&["edit", "--icon", "tool", "Tool", "/apps/t.desktop", f]));
    assert_eq!(one("edit --name=%c", &[]), v(&["edit", "--name=Tool"]));
    // Deprecated and unknown codes vanish, and so do words of only them.
    assert_eq!(one("edit %d %D %n %N %v %m %z %f", &[f]), v(&["edit", f]));
    assert_eq!(one("edit x%dy %f", &[f]), v(&["edit", "xy", f]));
    // No files: the file codes vanish.
    assert_eq!(one("edit %f --x %F", &[]), v(&["edit", "--x"]));
    // No file code: the files are appended.
    assert_eq!(one("viewer --fullscreen", &[f, g]), v(&["viewer", "--fullscreen", f, g]));
    // %f with several files: one process each.
    assert_eq!(argvs("edit %f", &[f, g]).unwrap(), vec![v(&["edit", f]), v(&["edit", g])]);
}

#[test]
fn hostile_file_names_stay_single_arguments() {
    for &name in HOSTILE {
        assert_eq!(one("edit %f", &[name]), v(&["edit", name]), "{name:?}");
        assert_eq!(one("edit --in=%u", &[name]), v(&["edit", &format!("--in={name}")]), "{name:?}");
        assert_eq!(one("edit", &[name]), v(&["edit", name]), "{name:?}");
        // The safe idiom for a shell: the name as $1, never in the script.
        assert_eq!(
            one(r#"sh -c "exec cat \"\$1\"" sh %f"#, &[name]),
            v(&["sh", "-c", "exec cat \"$1\"", "sh", name]),
            "{name:?}"
        );
    }
    let all = one("edit %F", HOSTILE);
    assert_eq!(&all[1..], HOSTILE);
}

#[test]
fn a_field_code_in_quotes_or_as_the_program_is_refused() {
    // `sh -c "cat %f"` would make the file name part of a shell script.
    for exec in [r#"sh -c "cat %f""#, "sh -c 'cat %F'", r#"x "--in=%u""#] {
        let err = argvs(exec, &["/a b"]).unwrap_err();
        assert!(err.contains("inside quotes"), "{exec}: {err}");
    }
    for exec in ["%f", "%F --x", "pre%u", ""] {
        let err = argvs(exec, &["/a"]).unwrap_err();
        assert!(err.contains("no program"), "{exec}: {err}");
    }
}

/// The entry for a script that records its argv (NUL-separated) in `out`.
#[cfg(unix)]
fn recorder(t: &Scratch, exec_args: &str) -> (DesktopEntry, PathBuf) {
    use std::os::unix::fs::PermissionsExt;
    let out = t.join("argv.out");
    let script = t.join("bin/record args");
    put(&script, &format!("#!/bin/sh\nprintf '%s\\0' \"$PWD\" \"$@\" > '{}.tmp'\nmv '{0}.tmp' '{0}'\n", out.display()));
    std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();
    let mut e = entry(&format!("\"{}\" {}", script.display(), exec_args));
    e.icon = None;
    (e, out)
}

#[cfg(unix)]
fn wait_for(path: &Path) -> Vec<String> {
    let until = std::time::Instant::now() + std::time::Duration::from_secs(10);
    while !path.exists() {
        assert!(std::time::Instant::now() < until, "the program never ran");
        std::thread::sleep(std::time::Duration::from_millis(20));
    }
    let bytes = std::fs::read(path).unwrap();
    bytes
        .split(|&b| b == 0)
        .filter(|s| !s.is_empty())
        .map(|s| String::from_utf8_lossy(s).into_owned())
        .collect()
}

#[cfg(unix)]
#[test]
fn a_launch_passes_hostile_names_through_unchanged() {
    let t = Scratch::new("xdg-launch");
    let dir = t.join("files");
    std::fs::create_dir_all(&dir).unwrap();
    let files: Vec<String> = HOSTILE
        .iter()
        .map(|h| dir.join(Path::new(h).file_name().unwrap()).to_string_lossy().into_owned())
        .collect();
    let (e, out) = recorder(&t, "--first %F");
    launch_entry(&e, &files).unwrap();
    let got = wait_for(&out);
    // The working folder is the first file's folder.
    assert_eq!(got[0], dir.to_string_lossy());
    assert_eq!(got[1], "--first");
    assert_eq!(&got[2..], &files[..]);
    assert!(!dir.join("pwned").exists() && !t.join("pwned").exists());
}

#[cfg(unix)]
#[test]
fn a_launch_starts_in_path_and_refuses_relative_files() {
    let t = Scratch::new("xdg-launch-path");
    let (mut e, out) = recorder(&t, "%f");
    let work = t.join("work");
    std::fs::create_dir_all(&work).unwrap();
    e.work_dir = Some(work.to_string_lossy().into_owned());
    launch_entry(&e, &["/x/-rf".to_string()]).unwrap();
    assert_eq!(wait_for(&out), v(&[&work.to_string_lossy(), "/x/-rf"]));

    let err = launch_entry(&e, &["-rf".to_string()]).unwrap_err();
    assert!(err.contains("not an absolute path"), "{err}");
    let missing = entry("no-such-program-glasshouse %f");
    let err = launch_entry(&missing, &["/a".to_string()]).unwrap_err();
    assert!(err.contains("isn't on PATH"), "{err}");
}

