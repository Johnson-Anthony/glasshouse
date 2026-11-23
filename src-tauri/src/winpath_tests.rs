//! The Windows path rules, on every platform.

use super::*;

fn w(s: &str) -> Vec<u16> {
    s.encode_utf16().collect()
}

fn text(units: &[u16]) -> String {
    String::from_utf16(units).unwrap()
}

/// `C:\` + enough `aaaaaaaaa\` folders to pass MAX_PATH, + `tail`.
fn long(root: &str, tail: &str) -> String {
    format!("{root}{}{tail}", r"aaaaaaaaa\".repeat(30))
}

#[test]
fn device_names_are_told_from_ordinary_ones() {
    for name in ["CON", "con", "Nul", "PRN", "AUX", "COM1", "com9", "LPT1", "lpt9", "COM¹", "LPT³", "CONIN$", "conout$"] {
        assert!(is_device_name(name), "{name}");
    }
    // An extension, and spaces before it, don't make it a file.
    for name in ["NUL.txt", "con.tar.gz", "aux .txt", "COM1.log", "nul."] {
        assert!(is_device_name(name), "{name}");
    }
    for name in ["CONSOLE", "nulls", "COM0", "COM10", "LPT", "COM", "a.con", "con1", "_nul", "auxiliary.txt", ""] {
        assert!(!is_device_name(name), "{name}");
    }
}

#[test]
fn plain_strips_the_verbatim_prefix_from_drive_paths() {
    assert_eq!(plain(r"\\?\C:\Users\me").as_deref(), Some(r"C:\Users\me"));
    assert_eq!(plain(r"\\?\c:\x.txt").as_deref(), Some(r"c:\x.txt"));
    // A drive's root keeps its separator, with or without one given.
    assert_eq!(plain(r"\\?\C:\").as_deref(), Some(r"C:\"));
    assert_eq!(plain(r"\\?\C:").as_deref(), Some(r"C:\"));
    assert_eq!(plain(r"\\?\D:\dir\").as_deref(), Some(r"D:\dir"));
    // Length is no reason to keep the prefix.
    let deep = long(r"C:\", "end.txt");
    assert!(deep.len() > 260);
    assert_eq!(plain(&format!(r"\\?\{deep}")), Some(deep));
}

#[test]
fn plain_turns_verbatim_unc_into_a_share_path() {
    assert_eq!(plain(r"\\?\UNC\nas\media\films\a.mkv").as_deref(), Some(r"\\nas\media\films\a.mkv"));
    assert_eq!(plain(r"\\?\unc\nas\media").as_deref(), Some(r"\\nas\media"));
    assert_eq!(plain(r"\\?\UNC\nas\media\").as_deref(), Some(r"\\nas\media"));
    assert_eq!(plain(r"\\?\UNC\10.0.0.2\c$\x").as_deref(), Some(r"\\10.0.0.2\c$\x"));
    // No share, no path.
    assert_eq!(plain(r"\\?\UNC\nas"), None);
    assert_eq!(plain(r"\\?\UNC\\share\x"), None);
}

#[test]
fn plain_leaves_what_has_no_plain_form() {
    // Not verbatim at all.
    for p in [r"C:\Users\me", r"\\nas\media\x", "/home/me", r"\\.\C:\x", "", r"\\?"] {
        assert_eq!(plain(p), None, "{p}");
    }
    // Other verbatim roots.
    assert_eq!(plain(r"\\?\Volume{b75e2c83-0000-0000-0000-602f00000000}\x"), None);
    assert_eq!(plain(r"\\?\GLOBALROOT\Device\x"), None);
    assert_eq!(plain(r"\\?\C:x"), None);
    // Components Win32 would read differently in a plain path.
    for p in [
        r"\\?\C:\dir\notes.",
        r"\\?\C:\dir \x",
        r"\\?\C:\dir\con",
        r"\\?\C:\dir\NUL.txt\x",
        r"\\?\C:\dir\..\x",
        r"\\?\C:\dir\.\x",
        r"\\?\C:\a/b",
        r"\\?\C:\a\\b",
        r"\\?\UNC\nas\media\aux",
    ] {
        assert_eq!(plain(p), None, "{p}");
    }
}

#[test]
fn listing_base_is_the_folder_as_people_write_it() {
    assert_eq!(listing_base(r"C:\Users\me"), r"C:\Users\me");
    assert_eq!(listing_base("C:/Users/me"), r"C:\Users\me");
    assert_eq!(listing_base("C:"), r"C:\");
    assert_eq!(listing_base(r"C:\"), r"C:\");
    assert_eq!(listing_base(r"\\nas\media"), r"\\nas\media");
    assert_eq!(listing_base("//nas/media/x"), r"\\nas\media\x");
    // A mapped or subst drive stays the drive it was asked as.
    assert_eq!(listing_base(r"Z:\films"), r"Z:\films");
    // Paths saved from canonical listings.
    assert_eq!(listing_base(r"\\?\UNC\nas\media\films"), r"\\nas\media\films");
    assert_eq!(listing_base(r"\\?\C:\Users\me"), r"C:\Users\me");
    // A verbatim path with no plain form goes through as it is: `/` is an
    // ordinary character there.
    assert_eq!(listing_base(r"\\?\C:\dir\notes."), r"\\?\C:\dir\notes.");
    assert_eq!(listing_base(r"\\?\Volume{1}\a"), r"\\?\Volume{1}\a");
}

#[test]
fn verbatim_leaves_short_verbatim_and_relative_paths_alone() {
    for p in [r"C:\Users\me\file.txt", r"\\nas\media\x", r"C:\", "C:/x/../y", r"rel\path", ""] {
        assert_eq!(text(&verbatim(&w(p))), p, "{p}");
    }
    let already = format!(r"\\?\{}", long(r"C:\", "x"));
    assert_eq!(text(&verbatim(&w(&already))), already);
    let nt = format!(r"\??\{}", long(r"C:\", "x"));
    assert_eq!(text(&verbatim(&w(&nt))), nt);
    // Long but not absolute: nothing a pure function can resolve.
    for root in ["", "C:", r"\"] {
        let p = long(root, "x");
        assert_eq!(text(&verbatim(&w(&p))), p, "{root}");
    }
}

#[test]
fn verbatim_starts_where_win32_stops() {
    // 246 units pass as they are (247 with the NUL); 247 don't.
    let fits = format!(r"C:\{}", "a".repeat(243));
    assert_eq!(fits.len(), 246);
    assert_eq!(text(&verbatim(&w(&fits))), fits);
    let over = format!(r"C:\{}", "a".repeat(244));
    assert_eq!(text(&verbatim(&w(&over))), format!(r"\\?\{over}"));
}

#[test]
fn verbatim_prefixes_long_drive_unc_and_device_paths() {
    let drive = long(r"C:\", "end.txt");
    assert_eq!(text(&verbatim(&w(&drive))), format!(r"\\?\{drive}"));
    let unc = long(r"\\nas\media\", "end.txt");
    assert_eq!(text(&verbatim(&w(&unc))), format!(r"\\?\UNC\{}", &unc[2..]));
    let device = long(r"\\.\C:\", "end.txt");
    assert_eq!(text(&verbatim(&w(&device))), format!(r"\\?\{}", &device[4..]));
}

#[test]
fn verbatim_does_the_normalizing_win32_would() {
    let body = r"aaaaaaaaa\".repeat(30);
    let body = body.trim_end_matches('\\');
    // `/`, repeats, `.` and `..`, and a trailing separator.
    let messy = format!(r"C:/{}//.\gone\..\end.txt\", body.replace('\\', "/"));
    assert_eq!(text(&verbatim(&w(&messy))), format!(r"\\?\C:\{body}\end.txt"));
    // `..` never climbs out of a drive, or out of a share.
    let up = format!(r"C:\..\..\{body}");
    assert_eq!(text(&verbatim(&w(&up))), format!(r"\\?\C:\{body}"));
    let share = format!(r"\\nas\media\..\..\{body}");
    assert_eq!(text(&verbatim(&w(&share))), format!(r"\\?\UNC\nas\media\{body}"));
    // Trailing dots and spaces are the entry's own name: kept.
    let dotted = format!(r"C:\{body}\notes.");
    assert_eq!(text(&verbatim(&w(&dotted))), format!(r"\\?\{dotted}"));
    // Nothing left but the root.
    let root = format!(r"C:\{}", r".\".repeat(130));
    assert_eq!(text(&verbatim(&w(&root))), r"\\?\C:\");
}

#[test]
fn verbatim_keeps_units_that_are_not_text() {
    // An unpaired surrogate, as NTFS allows in names.
    let mut path = w(&long(r"C:\", ""));
    path.push(0xD800);
    let out = verbatim(&path);
    assert_eq!(out[..4], w(r"\\?\")[..]);
    assert_eq!(out.last(), Some(&0xD800));
    assert_eq!(out.len(), path.len() + 4);
}

fn shares() -> Vec<Share> {
    vec![
        ("Z:".to_string(), r"\\nas\media".to_string()),
        ("Y:".to_string(), r"\\NAS\media\films".to_string()),
        ("X:".to_string(), r"\\other\docs\".to_string()),
    ]
}

#[test]
fn saved_form_touches_only_the_old_canonical_form() {
    for p in [r"C:\Users\me", r"\\nas\media\x", r"Z:\x", "/home/me", ""] {
        assert_eq!(saved_form(p, &shares()), None, "{p}");
    }
    assert_eq!(saved_form(r"\\?\C:\Users\me", &shares()).as_deref(), Some(r"C:\Users\me"));
    // No plain form: kept, since it still opens as it is.
    assert_eq!(saved_form(r"\\?\C:\dir\notes.", &shares()), None);
    assert_eq!(saved_form(r"\\?\Volume{1}\x", &shares()), None);
}

#[test]
fn saved_form_gives_a_share_path_its_mapped_drive() {
    let s = shares();
    assert_eq!(saved_form(r"\\?\UNC\nas\media\music\a.flac", &s).as_deref(), Some(r"Z:\music\a.flac"));
    assert_eq!(saved_form(r"\\?\UNC\nas\media", &s).as_deref(), Some(r"Z:\"));
    // The deepest mapping wins, whatever the case.
    assert_eq!(saved_form(r"\\?\UNC\Nas\Media\Films\x.mkv", &s).as_deref(), Some(r"Y:\x.mkv"));
    assert_eq!(saved_form(r"\\?\UNC\nas\media\films", &s).as_deref(), Some(r"Y:\"));
    // A share written with a trailing separator.
    assert_eq!(saved_form(r"\\?\UNC\other\docs\a", &s).as_deref(), Some(r"X:\a"));
    // A share whose name only starts the same isn't that share.
    assert_eq!(saved_form(r"\\?\UNC\nas\media2\x", &s).as_deref(), Some(r"\\nas\media2\x"));
    // No drive mapped to it: the share path.
    assert_eq!(saved_form(r"\\?\UNC\nas\backup\x", &s).as_deref(), Some(r"\\nas\backup\x"));
    assert_eq!(saved_form(r"\\?\UNC\nas\media\x", &[]).as_deref(), Some(r"\\nas\media\x"));
}

#[test]
fn wants_shares_only_for_verbatim_unc() {
    assert!(wants_shares(r"\\?\UNC\nas\media\x"));
    assert!(wants_shares(r"\\?\unc\nas\media"));
    for p in [r"\\?\C:\x", r"\\nas\media", r"C:\x", "/home/me"] {
        assert!(!wants_shares(p), "{p}");
    }
}

#[test]
fn saved_paths_migrate_in_order_without_repeats() {
    let list = |items: &[&str]| items.iter().map(|s| s.to_string()).collect::<Vec<_>>();
    assert_eq!(saved_paths(&list(&[r"C:\a", r"\\nas\media", "/home/me"]), &shares()), None);
    assert_eq!(saved_paths(&[], &shares()), None);
    // A verbatim path with no plain form changes nothing.
    assert_eq!(saved_paths(&list(&[r"\\?\Volume{1}\x"]), &shares()), None);

    let old = list(&[r"C:\a", r"\\?\UNC\nas\media\music", r"\\?\C:\b", r"z:\MUSIC", r"\\?\C:\a"]);
    assert_eq!(saved_paths(&old, &shares()), Some(list(&[r"C:\a", r"Z:\music", r"C:\b"])));
}

#[test]
fn saved_tags_move_old_keys_and_join_labels() {
    let map = |items: &[(&str, &[&str])]| -> HashMap<String, Vec<String>> {
        items.iter().map(|(k, v)| (k.to_string(), v.iter().map(|l| l.to_string()).collect())).collect()
    };
    let plain_only = map(&[(r"C:\a", &["work"]), ("/home/me/x", &["home"])]);
    assert_eq!(saved_tags(&plain_only, &shares()), None);

    let old = map(&[
        (r"C:\a", &["work"]),
        (r"\\?\UNC\nas\media\music\a.flac", &["keep", "loud"]),
        (r"\\?\C:\long\b.txt", &["review"]),
        // The same file, tagged again after the update.
        (r"Z:\Music\a.flac", &["loud", "new"]),
    ]);
    let want = map(&[
        (r"C:\a", &["work"]),
        (r"Z:\Music\a.flac", &["loud", "new", "keep"]),
        (r"C:\long\b.txt", &["review"]),
    ]);
    assert_eq!(saved_tags(&old, &shares()), Some(want));
    // Migrating twice changes nothing more.
    assert_eq!(saved_tags(&saved_tags(&old, &shares()).unwrap(), &shares()), None);
}

#[test]
fn wsl_launchers_are_not_a_bash_of_their_own() {
    for p in [
        r"C:\Windows\System32\bash.exe",
        r"c:\windows\system32\BASH.EXE",
        "C:/Windows/System32/bash.exe",
        r"C:\Windows\Sysnative\bash.exe",
        r"C:\Users\me\AppData\Local\Microsoft\WindowsApps\bash.exe",
    ] {
        assert!(is_wsl_bash(p), "{p}");
    }
    for p in [
        r"C:\Program Files\Git\bin\bash.exe",
        r"C:\Program Files\Git\usr\bin\bash.exe",
        r"C:\msys64\usr\bin\bash.exe",
        r"C:\cygwin64\bin\bash.exe",
        r"C:\Windows\System32\wsl.exe",
        r"C:\tools\system32\extra\bash.exe",
        "/usr/bin/bash",
    ] {
        assert!(!is_wsl_bash(p), "{p}");
    }
}
