// The clipboard's file formats as bytes, with no clipboard in sight, so
// both platforms' formats are tested on any host.
//
// Linux (what GTK and Qt file managers write and read):
// - `text/uri-list`: percent-encoded `file://` URIs, one per CRLF line.
// - `x-special/gnome-copied-files` (Nautilus, Nemo, Caja, Thunar,
//   PCManFM): "copy" or "cut", then one URI per line.
// - `application/x-kde-cutselection` (Dolphin, next to the URI list): "1"
//   for a cut.
// - Nautilus 3.30 to 42 wrote plain text instead, headed
//   `x-special/nautilus-clipboard`. Read, never written: as text it's what
//   a terminal or an editor would paste.
// Windows: CF_HDROP (a `DROPFILES` block) and "Preferred DropEffect".
//
// What comes off the clipboard is another app's data. Only local `file://`
// URIs become paths, and both the bytes looked at and the number of files
// are capped.

use std::path::PathBuf;

pub const URI_LIST: &str = "text/uri-list";
pub const GNOME_COPIED_FILES: &str = "x-special/gnome-copied-files";
pub const KDE_CUT_SELECTION: &str = "application/x-kde-cutselection";
const NAUTILUS_TEXT: &str = "x-special/nautilus-clipboard";

/// The most a clipboard format may hold and still be read: 100,000 files
/// with long names fit.
pub const MAX_BYTES: usize = 32 << 20;
/// The most files one paste takes. More is refused, not cut short: half a
/// move would be worse than none.
pub const MAX_FILES: usize = 100_000;
/// The most text read off the clipboard (Paste Text into Filename).
pub const MAX_TEXT_BYTES: usize = 64 << 10;

/// Files on a clipboard: their URIs as the source app gave them, and
/// whether a paste moves them.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct Copied {
    pub cut: bool,
    pub uris: Vec<String>,
}

/// What `paths` are offered as, by the clipboard and by a drag out
/// (`drag_out.rs`): `file://` URIs, percent-encoded (a space, `#` or `%` in
/// a name would otherwise break them), and the plain paths, one per line,
/// for targets that only take text.
pub fn uris_and_text(paths: &[PathBuf]) -> (Vec<String>, String) {
    let uris = paths
        .iter()
        .filter_map(|p| url::Url::from_file_path(p).ok())
        .map(String::from)
        .collect();
    let text = paths
        .iter()
        .map(|p| p.to_string_lossy())
        .collect::<Vec<_>>()
        .join("\n");
    (uris, text)
}

/// `x-special/gnome-copied-files`: the action, then the URIs, with no
/// newline after the last (Nautilus's own form).
pub fn gnome_copied_files(cut: bool, uris: &[String]) -> Vec<u8> {
    let mut out = String::from(if cut { "cut" } else { "copy" });
    for u in uris {
        out.push('\n');
        out.push_str(u);
    }
    out.into_bytes()
}

/// `application/x-kde-cutselection`, as KIO writes it for both actions.
pub fn kde_cut_selection(cut: bool) -> &'static [u8] {
    if cut {
        b"1"
    } else {
        b"0"
    }
}

/// What a Linux clipboard offered, format by format; None for one it
/// doesn't have (or that was over `MAX_BYTES`). `text` is only asked for
/// when neither file format is there.
#[derive(Debug, Default)]
pub struct Offered {
    pub gnome: Option<Vec<u8>>,
    pub uri_list: Option<Vec<u8>>,
    pub kde: Option<Vec<u8>>,
    pub text: Option<String>,
}

/// The lines of a clipboard format: split at LF or CRLF, without blank
/// ones or the NUL some apps end the data with.
fn lines(bytes: &[u8]) -> Vec<String> {
    String::from_utf8_lossy(bytes)
        .split('\n')
        .map(|l| l.trim_matches(|c| c == '\r' || c == '\0').trim())
        .filter(|l| !l.is_empty())
        .map(str::to_string)
        .collect()
}

/// "cut" or "copy" as a format's action line.
fn action(line: &str) -> Option<bool> {
    match line {
        "cut" => Some(true),
        "copy" => Some(false),
        _ => None,
    }
}

/// The files `offered` names, or None when it has no file format. The
/// GNOME format says cut or copy itself; a bare URI list is a copy unless
/// KDE's flag says cut.
pub fn decode(offered: &Offered) -> Option<Copied> {
    if let Some(bytes) = &offered.gnome {
        let mut uris = lines(bytes);
        // No action line: an app that put a bare list there. A copy.
        let cut = uris.first().and_then(|l| action(l));
        if cut.is_some() {
            uris.remove(0);
        }
        return Some(Copied { cut: cut.unwrap_or(false), uris });
    }
    if let Some(bytes) = &offered.uri_list {
        let uris = lines(bytes).into_iter().filter(|l| !l.starts_with('#')).collect();
        let cut = offered.kde.as_deref().is_some_and(|k| k.first() == Some(&b'1'));
        return Some(Copied { cut, uris });
    }
    let text = offered.text.as_deref()?;
    let mut uris = lines(text.as_bytes());
    if uris.len() < 2 || uris[0] != NAUTILUS_TEXT {
        return None;
    }
    let cut = action(&uris[1])?;
    uris.drain(..2);
    Some(Copied { cut, uris })
}

/// The local files among `uris`, and how many aren't one: only `file://`
/// URIs with no host (or `localhost`) count, percent-decoded once, and
/// what they name must be an absolute path. `sftp://`, `trash://`,
/// `file://server/share` and plain text are left out.
pub fn local_paths(uris: &[String]) -> (Vec<PathBuf>, usize) {
    let paths: Vec<PathBuf> = uris
        .iter()
        .filter_map(|u| url::Url::parse(u).ok())
        .filter(|u| u.scheme() == "file" && matches!(u.host_str(), None | Some("" | "localhost")))
        .filter_map(|u| u.to_file_path().ok())
        .filter(|p| p.is_absolute())
        .collect();
    let other = uris.len() - paths.len();
    (paths, other)
}

// ---------- Windows ----------

pub const DROPEFFECT_COPY: u32 = 1;
pub const DROPEFFECT_MOVE: u32 = 2;
pub const DROPEFFECT_LINK: u32 = 4;

/// "Preferred DropEffect": what the source wants a paste to do. Explorer
/// writes move for a cut and copy-or-link for a copy.
pub fn preferred_drop_effect(cut: bool) -> [u8; 4] {
    let effect = if cut { DROPEFFECT_MOVE } else { DROPEFFECT_COPY | DROPEFFECT_LINK };
    effect.to_le_bytes()
}

/// Whether a "Preferred DropEffect" value asks for a move: move without
/// copy. Anything unclear is a copy, which can't lose a file.
pub fn prefers_move(bytes: &[u8]) -> bool {
    let Some(first) = bytes.first_chunk::<4>() else {
        return false;
    };
    let effect = u32::from_le_bytes(*first);
    effect & DROPEFFECT_MOVE != 0 && effect & DROPEFFECT_COPY == 0
}

/// CF_HDROP's block for `paths`: a 20-byte `DROPFILES` header (the list's
/// offset, no drop point, wide characters), then each path NUL-terminated
/// in UTF-16, and a NUL after the last.
pub fn dropfiles(paths: &[String]) -> Vec<u8> {
    const HEADER: u32 = 20;
    let mut out = Vec::new();
    out.extend_from_slice(&HEADER.to_le_bytes()); // pFiles
    out.extend_from_slice(&[0; 8]); // pt
    out.extend_from_slice(&0u32.to_le_bytes()); // fNC
    out.extend_from_slice(&1u32.to_le_bytes()); // fWide
    for p in paths {
        for unit in p.encode_utf16().chain(std::iter::once(0)) {
            out.extend_from_slice(&unit.to_le_bytes());
        }
    }
    out.extend_from_slice(&0u16.to_le_bytes());
    out
}

/// Text for CF_UNICODETEXT: UTF-16 with its NUL.
pub fn unicode_text(text: &str) -> Vec<u8> {
    text.encode_utf16().chain(std::iter::once(0)).flat_map(u16::to_le_bytes).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn s(items: &[&str]) -> Vec<String> {
        items.iter().map(|s| s.to_string()).collect()
    }

    #[cfg(unix)]
    #[test]
    fn uris_are_percent_encoded_and_text_is_the_plain_paths() {
        let paths = [PathBuf::from("/home/u/a b#1%.txt"), PathBuf::from("/home/u/ünï")];
        let (uris, text) = uris_and_text(&paths);
        assert_eq!(uris, ["file:///home/u/a%20b%231%25.txt", "file:///home/u/%C3%BCn%C3%AF"]);
        assert_eq!(text, "/home/u/a b#1%.txt\n/home/u/ünï");
    }

    #[test]
    fn gnome_copied_files_is_the_action_then_the_uris() {
        let uris = s(&["file:///a", "file:///b%20c"]);
        assert_eq!(gnome_copied_files(false, &uris), b"copy\nfile:///a\nfile:///b%20c");
        assert_eq!(gnome_copied_files(true, &uris[..1]), b"cut\nfile:///a");
        assert_eq!(kde_cut_selection(true), b"1");
        assert_eq!(kde_cut_selection(false), b"0");
    }

    #[test]
    fn what_is_written_reads_back() {
        let uris = s(&["file:///a", "file:///b%20c"]);
        for cut in [false, true] {
            let gnome = Offered { gnome: Some(gnome_copied_files(cut, &uris)), ..Default::default() };
            assert_eq!(decode(&gnome), Some(Copied { cut, uris: uris.clone() }));
            // Dolphin reads the URI list with KDE's flag.
            let kde = Offered {
                uri_list: Some(b"file:///a\r\nfile:///b%20c\r\n".to_vec()),
                kde: Some(kde_cut_selection(cut).to_vec()),
                ..Default::default()
            };
            assert_eq!(decode(&kde), Some(Copied { cut, uris: uris.clone() }));
        }
    }

    #[test]
    fn the_gnome_format_wins_and_tolerates_other_apps_endings() {
        // Thunar and Caja end the list with a newline; some apps add a NUL.
        let o = Offered {
            gnome: Some(b"cut\nfile:///a\r\nfile:///b\n\0".to_vec()),
            uri_list: Some(b"file:///other\r\n".to_vec()),
            ..Default::default()
        };
        assert_eq!(decode(&o), Some(Copied { cut: true, uris: s(&["file:///a", "file:///b"]) }));
        // No action line: a copy of everything listed.
        let bare = Offered { gnome: Some(b"file:///a\n".to_vec()), ..Default::default() };
        assert_eq!(decode(&bare), Some(Copied { cut: false, uris: s(&["file:///a"]) }));
        // Just the action: files copied, none named.
        let none = Offered { gnome: Some(b"copy\n".to_vec()), ..Default::default() };
        assert_eq!(decode(&none), Some(Copied { cut: false, uris: vec![] }));
    }

    #[test]
    fn a_bare_uri_list_is_a_copy_and_skips_comments() {
        let o = Offered { uri_list: Some(b"# from a browser\r\nfile:///a\r\n\r\nfile:///b".to_vec()), ..Default::default() };
        assert_eq!(decode(&o), Some(Copied { cut: false, uris: s(&["file:///a", "file:///b"]) }));
        // KDE's flag for a copy, or an empty one.
        for kde in [&b"0"[..], b""] {
            let o = Offered { uri_list: Some(b"file:///a".to_vec()), kde: Some(kde.to_vec()), ..Default::default() };
            assert!(!decode(&o).unwrap().cut);
        }
    }

    #[test]
    fn nautilus_text_form_is_read_and_other_text_is_not_files() {
        let cut = Offered { text: Some("x-special/nautilus-clipboard\ncut\nfile:///a\nfile:///b\n".into()), ..Default::default() };
        assert_eq!(decode(&cut), Some(Copied { cut: true, uris: s(&["file:///a", "file:///b"]) }));
        let copy = Offered { text: Some("x-special/nautilus-clipboard\ncopy\nfile:///a\n".into()), ..Default::default() };
        assert_eq!(decode(&copy), Some(Copied { cut: false, uris: s(&["file:///a"]) }));
        for text in ["/home/u/a.txt", "file:///a", "x-special/nautilus-clipboard", "x-special/nautilus-clipboard\nmove\nfile:///a", "copy\nfile:///a", ""] {
            assert_eq!(decode(&Offered { text: Some(text.into()), ..Default::default() }), None, "{text:?}");
        }
        assert_eq!(decode(&Offered::default()), None);
    }

    #[cfg(unix)]
    #[test]
    fn only_local_file_uris_become_paths() {
        let uris = s(&[
            "file:///home/u/a%20b%231%25.txt",
            "file://localhost/home/u/c",
            "file:/home/u/d",
            "file:///home/u/%2541", // decoded once: "%41", not "A"
            "file://server/share/x",
            "sftp://host/home/u/a",
            "trash:///a",
            "/home/u/plain",
            "relative/path",
            "https://example.com/a",
            "",
        ]);
        let (paths, other) = local_paths(&uris);
        let want: Vec<PathBuf> = ["/home/u/a b#1%.txt", "/home/u/c", "/home/u/d", "/home/u/%41"].iter().map(PathBuf::from).collect();
        assert_eq!(paths, want);
        assert_eq!(other, 7);
        assert_eq!(local_paths(&[]), (vec![], 0));
    }

    #[test]
    fn preferred_drop_effect_is_move_for_a_cut() {
        assert_eq!(preferred_drop_effect(true), [2, 0, 0, 0]);
        assert_eq!(preferred_drop_effect(false), [5, 0, 0, 0]);
        assert!(prefers_move(&preferred_drop_effect(true)));
        assert!(!prefers_move(&preferred_drop_effect(false)));
        // Copy, link, both actions offered, nothing, or a short block: a copy.
        for bytes in [&[1u8, 0, 0, 0][..], &[4, 0, 0, 0], &[3, 0, 0, 0], &[0, 0, 0, 0], &[2, 0], &[]] {
            assert!(!prefers_move(bytes), "{bytes:?}");
        }
        // Longer than a DWORD (some apps pad it): the first four bytes.
        assert!(prefers_move(&[2, 0, 0, 0, 9, 9]));
    }

    #[test]
    fn dropfiles_is_a_wide_double_nul_list_after_its_header() {
        let block = dropfiles(&s(&["C:\\a b.txt", "D:\\ü"]));
        assert_eq!(&block[..4], &20u32.to_le_bytes(), "pFiles: the list starts after the header");
        assert_eq!(&block[4..16], &[0; 12], "no drop point, client coordinates");
        assert_eq!(&block[16..20], &1u32.to_le_bytes(), "fWide");
        let units: Vec<u16> = block[20..].chunks(2).map(|c| u16::from_le_bytes([c[0], c[1]])).collect();
        let want: Vec<u16> = "C:\\a b.txt\0D:\\ü\0\0".encode_utf16().collect();
        assert_eq!(units, want);
        // No files: the header and the list's end.
        assert_eq!(dropfiles(&[]).len(), 22);
    }

    #[test]
    fn unicode_text_is_utf16_with_a_nul() {
        assert_eq!(unicode_text("aü"), [0x61, 0, 0xFC, 0, 0, 0]);
        assert_eq!(unicode_text(""), [0, 0]);
    }
}
