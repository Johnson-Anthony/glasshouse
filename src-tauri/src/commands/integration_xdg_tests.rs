use super::*;
#[cfg(unix)]
use crate::commands::testing::put;
use crate::commands::testing::Scratch;
use crate::commands::xdg_apps::{exec_argvs, parse_entry};

const OURS: &str = DESKTOP_ID;

#[test]
fn a_default_replaces_the_old_line_and_keeps_everything_else() {
    let text = "# mine\n[Added Associations]\ninode/directory=a.desktop;\n\n[Default Applications]\ntext/plain=ed.desktop\ninode/directory = caja-folder-handler.desktop;\nimage/png=v.desktop\n";
    let set = set_default(text, FOLDER_MIME, OURS);
    assert_eq!(set.previous.as_deref(), Some("caja-folder-handler.desktop;"));
    assert!(!set.created_group);
    assert_eq!(set.text, text.replace("inode/directory = caja-folder-handler.desktop;", "inode/directory=glasshouse-folders.desktop"));
    // The Added Associations line is another group's: untouched.
    assert_eq!(current_default(&set.text, FOLDER_MIME).as_deref(), Some(OURS));

    let back = restore_default(&set.text, FOLDER_MIME, OURS, set.previous.as_deref(), false).unwrap();
    assert_eq!(back, text.replace("inode/directory = caja", "inode/directory=caja"));
}

#[test]
fn a_missing_line_goes_in_and_comes_back_out() {
    let text = "[Default Applications]\ntext/plain=ed.desktop\n";
    let set = set_default(text, FOLDER_MIME, OURS);
    assert_eq!(set.previous, None);
    assert_eq!(set.text, "[Default Applications]\ninode/directory=glasshouse-folders.desktop\ntext/plain=ed.desktop\n");
    assert_eq!(restore_default(&set.text, FOLDER_MIME, OURS, None, false).unwrap(), text);
}

#[test]
fn a_missing_group_is_added_at_the_end_and_removed_again() {
    let text = "[Added Associations]\nx/y=z.desktop;";
    let set = set_default(text, FOLDER_MIME, OURS);
    assert!(set.created_group);
    assert_eq!(set.text, "[Added Associations]\nx/y=z.desktop;\n\n[Default Applications]\ninode/directory=glasshouse-folders.desktop\n");
    // Only the missing final newline differs.
    assert_eq!(restore_default(&set.text, FOLDER_MIME, OURS, None, true).unwrap(), format!("{text}\n"));

    let set = set_default("", FOLDER_MIME, OURS);
    assert_eq!(set.text, "[Default Applications]\ninode/directory=glasshouse-folders.desktop\n");
    assert_eq!(restore_default(&set.text, FOLDER_MIME, OURS, None, true).unwrap(), "");
}

#[test]
fn a_group_someone_else_also_uses_stays() {
    let set = set_default("", FOLDER_MIME, OURS);
    let later = format!("{}text/plain=ed.desktop\n", set.text);
    assert_eq!(restore_default(&later, FOLDER_MIME, OURS, None, true).unwrap(), "[Default Applications]\ntext/plain=ed.desktop\n");
}

#[test]
fn a_default_changed_since_is_left_alone() {
    let text = "[Default Applications]\ninode/directory=nemo.desktop\n";
    assert_eq!(restore_default(text, FOLDER_MIME, OURS, Some("caja.desktop"), false), None);
    assert_eq!(restore_default("", FOLDER_MIME, OURS, None, true), None);
    // Ours first in a list still counts as ours.
    let text = "[Default Applications]\ninode/directory=glasshouse-folders.desktop;caja.desktop;\n";
    assert_eq!(restore_default(text, FOLDER_MIME, OURS, Some("caja.desktop"), false).unwrap(), "[Default Applications]\ninode/directory=caja.desktop\n");
}

#[test]
fn a_commented_out_line_isnt_the_default() {
    let text = "[Default Applications]\n#inode/directory=old.desktop\n";
    assert_eq!(current_default(text, FOLDER_MIME), None);
    let set = set_default(text, FOLDER_MIME, OURS);
    assert_eq!(set.previous, None);
    assert!(set.text.contains("#inode/directory=old.desktop"));
}

/// The entry's Exec, as our own launcher (and GLib) reads it back.
fn argv_of(exe: &str) -> Vec<String> {
    let text = folders_entry(Path::new(exe)).unwrap();
    let entry = parse_entry(DESKTOP_ID, Path::new("/x"), &text, &[]);
    assert_eq!(entry.mime_types, [FOLDER_MIME]);
    assert!(entry.no_display);
    assert_eq!(entry.try_exec.as_deref(), Some(exe));
    exec_argvs(&entry, &["/folder".to_string()]).unwrap().remove(0)
}

#[test]
fn the_desktop_entry_runs_the_binary_with_the_folder() {
    assert_eq!(argv_of("/usr/bin/glasshouse"), ["/usr/bin/glasshouse", "/folder"]);
    // Bare when it can be, for xdg-open's generic mode, which can't unquote.
    let plain = folders_entry(Path::new("/home/u/Apps/glasshouse-0.3_x86-64.AppImage")).unwrap();
    assert!(plain.contains("\nExec=/home/u/Apps/glasshouse-0.3_x86-64.AppImage %U\n"), "{plain}");
    // Every character the spec reserves survives the quoting.
    let odd = "/home/u/Apps & more/100% \"gh\" $x `y` \\z;'/glasshouse.AppImage";
    assert_eq!(argv_of(odd), [odd, "/folder"]);
}

#[test]
fn paths_the_files_cant_hold_are_refused() {
    assert!(folders_entry(Path::new("/a\nb")).is_err());
    assert!(service_file(Path::new("/a\\b")).is_err());
}

#[test]
fn the_service_file_quotes_the_path_for_the_bus() {
    let text = service_file(Path::new("/home/u/it's here/glasshouse")).unwrap();
    assert!(text.contains("Name=org.freedesktop.FileManager1\n"));
    assert!(text.contains("Exec='/home/u/it'\\''s here/glasshouse' --dbus file-manager\n"));
    assert!(text.starts_with(SERVICE_MARK));
}

fn places(root: &Scratch, desktops: &[&str]) -> Places {
    Places {
        xdg: XdgDirs {
            data_home: root.join("data"),
            data_dirs: vec![root.join("sys")],
            config_home: root.join("config"),
            config_dirs: vec![root.join("etc")],
            desktops: desktops.iter().map(|d| d.to_string()).collect(),
        },
        state_dir: root.join("config").join(APP_ID),
    }
}

#[cfg(unix)]
#[test]
fn folders_on_then_off_puts_both_lists_back() {
    let root = Scratch::new("integration-folders");
    let p = places(&root, &["gnome", "niri"]);
    let plain = "[Default Applications]\ninode/directory=caja-folder-handler.desktop\n";
    let gnome = "[Default Applications]\ninode/directory=org.gnome.Nautilus.desktop\ntext/plain=ed.desktop\n";
    // niri-mimeapps.list sets nothing for folders, so it isn't touched.
    let niri = "[Default Applications]\ntext/plain=ed.desktop\n";
    put(&p.xdg.config_home.join("mimeapps.list"), plain);
    put(&p.xdg.config_home.join("gnome-mimeapps.list"), gnome);
    put(&p.xdg.config_home.join("niri-mimeapps.list"), niri);

    folders_on(&p, Path::new("/opt/gh/glasshouse")).unwrap();
    assert!(folders_enabled(&p));
    for f in ["mimeapps.list", "gnome-mimeapps.list"] {
        let t = std::fs::read_to_string(p.xdg.config_home.join(f)).unwrap();
        assert_eq!(current_default(&t, FOLDER_MIME).as_deref(), Some(OURS), "{f}");
    }
    assert_eq!(std::fs::read_to_string(p.xdg.config_home.join("niri-mimeapps.list")).unwrap(), niri);
    // On twice: the first previous value is kept.
    folders_on(&p, Path::new("/opt/gh/glasshouse")).unwrap();

    folders_off(&p).unwrap();
    assert!(!folders_enabled(&p));
    assert!(!p.entry_path().exists());
    assert_eq!(std::fs::read_to_string(p.xdg.config_home.join("mimeapps.list")).unwrap(), plain);
    assert_eq!(std::fs::read_to_string(p.xdg.config_home.join("gnome-mimeapps.list")).unwrap(), gnome);
}

/// Needs update-desktop-database (desktop-file-utils); without it, there's
/// nothing to check.
#[cfg(unix)]
#[test]
fn an_existing_mime_cache_names_our_entry_only_while_it_s_on() {
    let have = std::process::Command::new("update-desktop-database").arg("--help").output().is_ok();
    if !have {
        return;
    }
    let root = Scratch::new("integration-cache");
    let p = places(&root, &[]);
    let apps = p.xdg.data_home.join("applications");
    let cache = apps.join("mimeinfo.cache");
    put(&cache, "[MIME Cache]\n");
    folders_on(&p, Path::new("/opt/gh/glasshouse")).unwrap();
    assert!(std::fs::read_to_string(&cache).unwrap().contains(&format!("inode/directory={OURS};")));
    folders_off(&p).unwrap();
    assert!(!std::fs::read_to_string(&cache).unwrap().contains(OURS));

    // With no cache, none is made.
    std::fs::remove_file(&cache).unwrap();
    folders_on(&p, Path::new("/opt/gh/glasshouse")).unwrap();
    folders_off(&p).unwrap();
    assert!(!cache.exists());
}

#[cfg(unix)]
#[test]
fn a_list_we_made_is_removed_and_a_linked_one_stays_a_link() {
    let root = Scratch::new("integration-made");
    let p = places(&root, &[]);
    folders_on(&p, Path::new("/opt/gh/glasshouse")).unwrap();
    let list = p.xdg.config_home.join("mimeapps.list");
    assert!(list.is_file());
    folders_off(&p).unwrap();
    assert!(!list.exists());

    // A dotfiles repo's list, linked into place.
    let real = root.join("dotfiles/mimeapps.list");
    put(&real, "[Default Applications]\ntext/plain=ed.desktop\n");
    std::os::unix::fs::symlink(&real, &list).unwrap();
    folders_on(&p, Path::new("/opt/gh/glasshouse")).unwrap();
    assert!(std::fs::symlink_metadata(&list).unwrap().file_type().is_symlink());
    assert!(std::fs::read_to_string(&real).unwrap().contains(OURS));
    folders_off(&p).unwrap();
    assert!(std::fs::symlink_metadata(&list).unwrap().file_type().is_symlink());
    assert_eq!(std::fs::read_to_string(&real).unwrap(), "[Default Applications]\ntext/plain=ed.desktop\n");
}

#[cfg(unix)]
#[test]
fn a_choice_made_since_survives_turning_off() {
    let root = Scratch::new("integration-since");
    let p = places(&root, &[]);
    let list = p.xdg.config_home.join("mimeapps.list");
    put(&list, "[Default Applications]\ninode/directory=caja.desktop\n");
    folders_on(&p, Path::new("/opt/gh/glasshouse")).unwrap();
    put(&list, "[Default Applications]\ninode/directory=nemo.desktop\n");
    folders_off(&p).unwrap();
    assert_eq!(std::fs::read_to_string(&list).unwrap(), "[Default Applications]\ninode/directory=nemo.desktop\n");
}

#[cfg(unix)]
#[test]
fn turning_off_with_no_record_still_takes_our_default_out() {
    let root = Scratch::new("integration-norecord");
    let p = places(&root, &[]);
    let list = p.xdg.config_home.join("mimeapps.list");
    put(&list, "[Default Applications]\ninode/directory=glasshouse-folders.desktop\ntext/plain=ed.desktop\n");
    folders_off(&p).unwrap();
    assert_eq!(std::fs::read_to_string(&list).unwrap(), "[Default Applications]\ntext/plain=ed.desktop\n");
}

#[cfg(unix)]
#[test]
fn files_glasshouse_didnt_write_are_left_alone() {
    let root = Scratch::new("integration-foreign");
    let p = places(&root, &[]);
    put(&p.service_path(), "[D-BUS Service]\nName=org.freedesktop.FileManager1\nExec=/usr/bin/nemo\n");
    assert!(service_on(&p, Path::new("/opt/gh/glasshouse")).unwrap_err().contains("another program"));
    assert!(!service_enabled(&p));
    assert!(service_off(&p).is_err());
    assert!(p.service_path().exists());

    put(&p.entry_path(), "[Desktop Entry]\nName=mine\n");
    assert!(folders_on(&p, Path::new("/opt/gh/glasshouse")).is_err());
}

#[cfg(unix)]
#[test]
fn the_files_say_which_program_they_start() {
    let root = Scratch::new("integration-program");
    let p = places(&root, &[]);
    assert_eq!(folders_program(&p), None);
    assert_eq!(service_program(&p), None);
    let odd = "/home/u/it's \\ here/glasshouse.AppImage";
    folders_on(&p, Path::new(odd)).unwrap();
    service_on(&p, Path::new("/home/u/it's here/glasshouse")).unwrap();
    assert_eq!(folders_program(&p).as_deref(), Some(odd));
    assert_eq!(service_program(&p).as_deref(), Some("/home/u/it's here/glasshouse"));
}

#[cfg(unix)]
#[test]
fn the_service_file_goes_on_and_off() {
    let root = Scratch::new("integration-service");
    let p = places(&root, &[]);
    service_on(&p, Path::new("/opt/gh/glasshouse")).unwrap();
    assert!(service_enabled(&p));
    service_off(&p).unwrap();
    assert!(!p.service_path().exists());
    // Off when already off.
    service_off(&p).unwrap();
}

#[cfg(unix)]
#[test]
fn the_folder_default_says_which_list_sets_it() {
    let root = Scratch::new("integration-default");
    let p = places(&root, &["niri"]);
    put(&root.join("sys/applications/caja.desktop"), "[Desktop Entry]\nType=Application\nName=Caja\nExec=/bin/sh %U\nMimeType=inode/directory;\n");
    put(&root.join("sys/applications/nemo.desktop"), "[Desktop Entry]\nType=Application\nName=Nemo\nExec=/bin/sh %U\nMimeType=inode/directory;\n");
    // No list: the first app that takes folders.
    let (id, _, from) = folder_default(&p).unwrap();
    assert_eq!((id.as_str(), from), ("caja.desktop", None));
    let list = p.xdg.config_home.join("niri-mimeapps.list");
    put(&list, "[Default Applications]\ninode/directory=gone.desktop;nemo.desktop;\n");
    assert_eq!(folder_default(&p).unwrap(), ("nemo.desktop".to_string(), "Nemo".to_string(), Some(list)));
}

#[test]
fn the_app_id_is_tauri_s_identifier() {
    let conf: serde_json::Value = serde_json::from_str(include_str!("../../tauri.conf.json")).unwrap();
    assert_eq!(conf["identifier"], APP_ID);
}
