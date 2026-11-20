//! The folders the desktop's own file manager keeps as bookmarks, which
//! the sidebar's pins start with on a first run (src/places.ts):
//! - GTK's bookmarks file, which GNOME Files and GTK file dialogs show;
//! - KDE's places, which Dolphin and KDE file dialogs show;
//! - Quick Access on Windows: its pinned and frequent folders.
//!
//! Only folders that exist come back, each once, in the desktop's order.
//! Nothing is written. See docs/decisions/2026-11-20-first-run-defaults.md.

use std::path::PathBuf;

/// The most places returned, so a long bookmarks file doesn't fill the
/// sidebar.
const MAX_PLACES: usize = 24;

#[tauri::command(async)]
pub fn desktop_places() -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for p in found() {
        if out.len() >= MAX_PLACES {
            break;
        }
        if !p.is_dir() {
            continue;
        }
        let s = p.to_string_lossy().into_owned();
        if !out.contains(&s) {
            out.push(s);
        }
    }
    out
}

#[cfg(not(windows))]
fn found() -> Vec<PathBuf> {
    let env = |k: &str| std::env::var_os(k).map(PathBuf::from).filter(|p| p.is_absolute());
    let Some(home) = env("HOME") else {
        return Vec::new();
    };
    let config = env("XDG_CONFIG_HOME").unwrap_or_else(|| home.join(".config"));
    let data = env("XDG_DATA_HOME").unwrap_or_else(|| home.join(".local").join("share"));
    let read = |p: PathBuf| std::fs::read_to_string(p).ok();
    // GTK 3 and 4 read the first; GTK 2 wrote the second.
    let gtk = read(config.join("gtk-3.0").join("bookmarks")).or_else(|| read(home.join(".gtk-bookmarks")));
    let mut out = gtk.map(|t| gtk_bookmarks(&t)).unwrap_or_default();
    if let Some(t) = read(data.join("user-places.xbel")) {
        out.extend(kde_places(&t));
    }
    out
}

#[cfg(windows)]
fn found() -> Vec<PathBuf> {
    quick_access()
}

/// A `file://` URI as a path; None for other schemes (sftp://, smb://,
/// trash:/ and the like), which glasshouse can't list.
#[cfg(not(windows))]
fn file_uri(uri: &str) -> Option<PathBuf> {
    if !uri.starts_with("file://") {
        return None;
    }
    url::Url::parse(uri).ok()?.to_file_path().ok()
}

/// GTK's bookmarks file: one `URI [label]` per line.
#[cfg(not(windows))]
fn gtk_bookmarks(text: &str) -> Vec<PathBuf> {
    text.lines()
        .filter_map(|line| line.split_whitespace().next())
        .filter_map(file_uri)
        .collect()
}

/// KDE's `user-places.xbel`: the `file://` bookmarks that aren't hidden.
/// KDE's own entries (Home, Root, Trash, Network…) are marked as system
/// items and left out: the known folders are pinned anyway, and the rest
/// are drives or not folders.
#[cfg(not(windows))]
fn kde_places(xml: &str) -> Vec<PathBuf> {
    let mut out = Vec::new();
    let mut rest = xml;
    while let Some(start) = rest.find("<bookmark ") {
        rest = &rest[start..];
        let tag_end = rest.find('>').map(|i| i + 1).unwrap_or(rest.len());
        let tag = &rest[..tag_end];
        let end = if tag.ends_with("/>") {
            tag_end
        } else {
            rest.find("</bookmark>").map(|i| i + "</bookmark>".len()).unwrap_or(rest.len())
        };
        let (block, after) = rest.split_at(end);
        rest = after;
        let flag = |name: &str| block.contains(&format!("<{name}>true</{name}>"));
        if flag("IsHidden") || flag("isSystemItem") {
            continue;
        }
        if let Some(path) = attr(tag, "href").and_then(|h| file_uri(&h)) {
            out.push(path);
        }
    }
    out
}

/// Attribute `name` of an XML start tag, with its entities decoded.
#[cfg(not(windows))]
fn attr(tag: &str, name: &str) -> Option<String> {
    let mut search = tag;
    loop {
        let i = search.find(name)?;
        let before = search[..i].chars().last();
        let after = search[i + name.len()..].trim_start();
        search = &search[i + name.len()..];
        if !matches!(before, Some(c) if c.is_whitespace()) {
            continue;
        }
        let Some(value) = after.strip_prefix('=') else {
            continue;
        };
        let value = value.trim_start();
        let quote = value.chars().next().filter(|c| *c == '"' || *c == '\'')?;
        let body = &value[1..];
        return Some(unescape_xml(&body[..body.find(quote)?]));
    }
}

#[cfg(not(windows))]
fn unescape_xml(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    while let Some(i) = rest.find('&') {
        out.push_str(&rest[..i]);
        rest = &rest[i..];
        let Some(semi) = rest.find(';') else { break };
        let entity = &rest[1..semi];
        let c = match entity {
            "amp" => Some('&'),
            "lt" => Some('<'),
            "gt" => Some('>'),
            "quot" => Some('"'),
            "apos" => Some('\''),
            _ => entity
                .strip_prefix("#x")
                .map(|h| u32::from_str_radix(h, 16).ok())
                .or_else(|| entity.strip_prefix('#').map(|d| d.parse().ok()))
                .flatten()
                .and_then(char::from_u32),
        };
        match c {
            Some(c) => {
                out.push(c);
                rest = &rest[semi + 1..];
            }
            None => {
                out.push('&');
                rest = &rest[1..];
            }
        }
    }
    out.push_str(rest);
    out
}

/// Quick Access's folders, from the shell's own list of them. The shell
/// needs COM in a single-threaded apartment, so this runs on a thread of its
/// own (commands run on Tauri's pool, whose threads may be in another).
#[cfg(windows)]
fn quick_access() -> Vec<PathBuf> {
    use windows::core::HSTRING;
    use windows::Win32::System::Com::{
        CoInitializeEx, CoTaskMemFree, CoUninitialize, IBindCtx, COINIT_APARTMENTTHREADED, COINIT_DISABLE_OLE1DDE,
    };
    use windows::Win32::UI::Shell::{
        BHID_EnumItems, IEnumShellItems, IShellItem, SHCreateItemFromParsingName, SIGDN_FILESYSPATH,
    };

    /// Quick Access's shell folder (Explorer's "Quick access").
    const QUICK_ACCESS: &str = "shell:::{679f85cb-0220-4080-b29b-5540cc05aab6}";

    let list = || -> windows::core::Result<Vec<PathBuf>> {
        let root: IShellItem = unsafe { SHCreateItemFromParsingName(&HSTRING::from(QUICK_ACCESS), None::<&IBindCtx>) }?;
        let items: IEnumShellItems = unsafe { root.BindToHandler(None::<&IBindCtx>, &BHID_EnumItems) }?;
        let mut out = Vec::new();
        while out.len() < MAX_PLACES * 2 {
            let mut one = [None];
            let mut fetched = 0u32;
            if unsafe { items.Next(&mut one, Some(&mut fetched)) }.is_err() || fetched == 0 {
                break;
            }
            let Some(item) = one[0].take() else { break };
            // Items with no file-system path (a library, a phone) fail here.
            if let Ok(p) = unsafe { item.GetDisplayName(SIGDN_FILESYSPATH) } {
                let path = unsafe { p.to_string() }.unwrap_or_default();
                unsafe { CoTaskMemFree(Some(p.0 as *const _)) };
                if !path.is_empty() {
                    out.push(PathBuf::from(path));
                }
            }
        }
        Ok(out)
    };
    std::thread::spawn(move || {
        if unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE) }.is_err() {
            return Vec::new();
        }
        let out = list().unwrap_or_default();
        unsafe { CoUninitialize() };
        out
    })
    .join()
    .unwrap_or_default()
}

#[cfg(all(test, not(windows)))]
mod tests {
    use super::*;

    #[test]
    fn gtk_bookmarks_are_file_uris_with_optional_labels() {
        let text = "file:///home/me/Documents\n\
                    file:///home/me/My%20Projects Projects\n\
                    sftp://server/home/me server\n\
                    \n\
                    file:///home/me/caf%C3%A9 café\n";
        assert_eq!(
            gtk_bookmarks(text),
            vec![
                PathBuf::from("/home/me/Documents"),
                PathBuf::from("/home/me/My Projects"),
                PathBuf::from("/home/me/café"),
            ]
        );
    }

    #[test]
    fn kde_places_skip_hidden_and_system_items() {
        let xml = r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE xbel>
<xbel xmlns:bookmark="http://www.freedesktop.org/standards/desktop-bookmarks">
 <bookmark href="file:///home/me">
  <title>Home</title>
  <info><metadata owner="http://www.kde.org"><isSystemItem>true</isSystemItem></metadata></info>
 </bookmark>
 <bookmark href="file:///home/me/Work%20%26%20Play">
  <title>Work</title>
  <info><metadata owner="http://www.kde.org"><ID>1/0</ID></metadata></info>
 </bookmark>
 <bookmark href="file:///home/me/old">
  <info><metadata owner="http://www.kde.org"><IsHidden>true</IsHidden></metadata></info>
 </bookmark>
 <bookmark href="trash:/">
  <title>Trash</title>
 </bookmark>
 <bookmark  href='file:///srv/a&amp;b'><title>ab</title></bookmark>
 <separator/>
 <bookmark xhref="file:///nope" href="file:///srv/shared"/>
 <bookmark href="file:///srv/last"><title>last</title></bookmark>
</xbel>"#;
        assert_eq!(
            kde_places(xml),
            vec![
                PathBuf::from("/home/me/Work & Play"),
                PathBuf::from("/srv/a&b"),
                PathBuf::from("/srv/shared"),
                PathBuf::from("/srv/last"),
            ]
        );
    }

    #[test]
    fn xml_entities_are_decoded() {
        assert_eq!(unescape_xml("a&amp;b&lt;&gt;&quot;&apos;&#65;&#x42;"), "a&b<>\"'AB");
        assert_eq!(unescape_xml("a & b; &bogus; c"), "a & b; &bogus; c");
    }
}
