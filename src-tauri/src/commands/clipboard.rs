// Copy, Cut and Paste through the OS clipboard, so files go between
// glasshouse and other apps, and between glasshouse windows: the page keeps
// no clipboard of its own. Copy and Cut write the formats other file
// managers read (`clipboard/formats.rs`); Paste reads them back, whoever
// wrote them. Text copies (Copy Path and the rest) go the same way.
//
// A cut moves nothing until it's pasted. Its rows are dimmed in every
// window while glasshouse's cut is still what the clipboard holds: that is
// kept here (`Held`), and each change is sent to every window as
// `clipboard-cut`. See docs/decisions/2026-11-23-os-clipboard-design.md.
//
// What's read off the clipboard is another app's data: only local files,
// capped in bytes and count, and never read by blocking the main thread.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use crate::error::{Action, AppError, Kind};
use crate::lock;

// Each platform uses its half; the tests use both.
#[allow(dead_code)]
pub(crate) mod formats;
#[cfg(target_os = "linux")]
#[path = "clipboard/linux.rs"]
mod platform;
#[cfg(windows)]
#[path = "clipboard/win32.rs"]
mod platform;

/// What glasshouse put on the clipboard and still has there.
#[derive(Debug)]
struct Live {
    /// The write's number.
    id: u64,
    /// The paths, as the page gave them, if it's a cut.
    cut: Vec<String>,
    /// Windows: the clipboard's sequence number after the write. It moves
    /// when anything else is put there.
    stamp: u32,
}

#[derive(Debug, Default)]
struct Held {
    last: u64,
    live: Option<Live>,
}

impl Held {
    /// The number of a write about to be made.
    fn next(&mut self) -> u64 {
        self.last += 1;
        self.last
    }

    /// Write `id` is on the clipboard. Returns whether the cut paths
    /// changed.
    fn took(&mut self, id: u64, cut: Vec<String>, stamp: u32) -> bool {
        let changed = self.cut() != cut;
        self.live = Some(Live { id, cut, stamp });
        changed
    }

    /// Write `id` is off the clipboard: another app's copy replaced it, or
    /// it was cleared. A later write's is left alone. Returns whether a
    /// cut ended with it.
    fn lost(&mut self, id: u64) -> bool {
        self.live.take_if(|l| l.id == id).is_some_and(|l| !l.cut.is_empty())
    }

    /// Whatever glasshouse had there is gone. Returns whether a cut ended.
    fn emptied(&mut self) -> bool {
        self.live.take().is_some_and(|l| !l.cut.is_empty())
    }

    fn cut(&self) -> &[String] {
        self.live.as_ref().map_or(&[], |l| &l.cut)
    }
}

/// What glasshouse has on the clipboard, as managed state.
#[derive(Default)]
pub struct Clipboard(Mutex<Held>);

/// Tells every window which paths are cut (none: the cut is over).
fn announce(app: &AppHandle, cut: &[String]) {
    if let Err(e) = app.emit("clipboard-cut", cut) {
        log::warn!("clipboard: {e}");
    }
}

/// Write `id` reached the clipboard (called by the platform's write, on
/// Linux before the main loop can report it lost).
#[cfg_attr(not(any(target_os = "linux", windows)), allow(dead_code))]
fn took(app: &AppHandle, id: u64, cut: Vec<String>, stamp: u32) {
    let changed = lock(&app.state::<Clipboard>().0).took(id, cut.clone(), stamp);
    if changed {
        announce(app, &cut);
    }
}

/// Write `id` left the clipboard.
fn lost(app: &AppHandle, id: u64) {
    if lock(&app.state::<Clipboard>().0).lost(id) {
        announce(app, &[]);
    }
}

/// The clipboard was emptied, whatever was there (Windows, where a write
/// starts with that).
#[cfg_attr(not(windows), allow(dead_code))]
fn emptied(app: &AppHandle) {
    if lock(&app.state::<Clipboard>().0).emptied() {
        announce(app, &[]);
    }
}

/// Files read off the clipboard, before they're checked.
#[cfg_attr(not(any(target_os = "linux", windows)), allow(dead_code))]
struct Read {
    cut: bool,
    /// Absolute local paths.
    paths: Vec<PathBuf>,
    /// Entries that aren't local files.
    other: usize,
    stamp: u32,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct ClipboardItem {
    path: String,
    /// A folder, or a link to one, as the file list shows it.
    folder: bool,
}

#[derive(Debug, Serialize)]
pub struct ClipboardFiles {
    /// A paste moves them.
    cut: bool,
    /// The files that are there to paste.
    items: Vec<ClipboardItem>,
    /// How many are no longer where they were.
    gone: usize,
    /// How many aren't local files (`sftp://`, another computer's), or
    /// have a name glasshouse can't address.
    other: usize,
    /// For `clipboard_cut_pasted`: which clipboard contents this was.
    stamp: u32,
}

fn failed(message: &str, detail: String) -> AppError {
    AppError::new(Kind::Other, None, message, detail)
}

/// The paths a copy offers: absolute, and present on disk (links
/// included, as themselves).
fn checked(paths: &[String]) -> Result<Vec<PathBuf>, AppError> {
    if paths.is_empty() {
        return Err(failed("Nothing is selected to copy.", "no paths".into()));
    }
    paths
        .iter()
        .map(|p| {
            let path = PathBuf::from(p);
            if !path.is_absolute() {
                return Err(AppError::other(Action::Copy, &path, "it isn't a full path"));
            }
            std::fs::symlink_metadata(&path).map_err(|e| AppError::io(Action::Copy, &path, &e))?;
            Ok(path)
        })
        .collect()
}

/// `paths` off the clipboard, sorted out: the ones still there (with
/// whether each is a folder), how many are gone, and how many have a name
/// that isn't valid Unicode, which the page couldn't send back.
fn sort_out(paths: &[PathBuf]) -> (Vec<ClipboardItem>, usize, usize) {
    let mut items = Vec::new();
    let (mut gone, mut unnamed) = (0, 0);
    for p in paths {
        match p.to_str() {
            None => unnamed += 1,
            Some(_) if std::fs::symlink_metadata(p).is_err() => gone += 1,
            Some(s) => items.push(ClipboardItem { path: s.to_string(), folder: p.is_dir() }),
        }
    }
    (items, gone, unnamed)
}

/// Copy or Cut: puts `paths` on the clipboard for every app. A cut moves
/// nothing yet; the paste does.
#[tauri::command(async)]
pub fn clipboard_write_files(app: AppHandle, paths: Vec<String>, cut: bool) -> Result<(), AppError> {
    let files = checked(&paths)?;
    let id = lock(&app.state::<Clipboard>().0).next();
    let held = if cut { paths } else { Vec::new() };
    platform::write_files(&app, id, &files, cut, held).map_err(|e| failed("Couldn't put the files on the clipboard.", e))
}

/// The files on the clipboard, from any app, or null when it holds none.
#[tauri::command(async)]
pub fn clipboard_read_files(app: AppHandle) -> Result<Option<ClipboardFiles>, AppError> {
    let Some(read) = platform::read_files(&app).map_err(|e| failed("Couldn't read the clipboard.", e))? else {
        return Ok(None);
    };
    if read.paths.len() > formats::MAX_FILES {
        return Err(failed(
            &format!("The clipboard holds {} files; glasshouse pastes at most {} at once.", read.paths.len(), formats::MAX_FILES),
            "too many files".into(),
        ));
    }
    let (items, gone, unnamed) = sort_out(&read.paths);
    Ok(Some(ClipboardFiles { cut: read.cut, items, gone, other: read.other + unnamed, stamp: read.stamp }))
}

/// The paths of glasshouse's own cut, while the clipboard still holds it:
/// the rows a window dims. Asked when a window opens and when it gets the
/// focus; changes in between come as `clipboard-cut`.
#[tauri::command(async)]
pub fn clipboard_cut_paths(app: AppHandle) -> Vec<String> {
    let state = app.state::<Clipboard>();
    let mut held = lock(&state.0);
    let Some(live) = &held.live else {
        return Vec::new();
    };
    if platform::owns(live.stamp) {
        return live.cut.clone();
    }
    let ended = held.emptied();
    drop(held);
    if ended {
        announce(&app, &[]);
    }
    Vec::new()
}

/// A cut was pasted in glasshouse. `stamp` is its read's; `done`: every
/// item moved.
/// - glasshouse's own cut: once none of its files is where it was, the cut
///   is over and the clipboard is cleared. Files that stayed (a skipped
///   name, a failure) stay cut.
/// - Another app's: its source is told the way the platform has (Windows'
///   "Paste Succeeded"; nothing on Linux, where the clipboard is the
///   source's to clear).
#[tauri::command(async)]
pub fn clipboard_cut_pasted(app: AppHandle, stamp: u32, done: bool) -> Result<(), String> {
    let state = app.state::<Clipboard>();
    let own = {
        let held = lock(&state.0);
        held.live.as_ref().filter(|l| !l.cut.is_empty() && platform::owns(l.stamp)).map(|l| (l.id, l.cut.clone()))
    };
    match own {
        Some((id, cut)) => {
            if cut.iter().all(|p| std::fs::symlink_metadata(Path::new(p)).is_err()) {
                platform::clear(&app)?;
                lost(&app, id);
            }
        }
        None if done => platform::pasted(&app, stamp),
        None => {}
    }
    Ok(())
}

/// Copy Path and the other text copies.
#[tauri::command(async)]
pub fn clipboard_write_text(app: AppHandle, text: String) -> Result<(), AppError> {
    platform::write_text(&app, text).map_err(|e| failed("Couldn't copy to the clipboard.", e))
}

/// The text on the clipboard, or null when it holds none.
#[tauri::command(async)]
pub fn clipboard_read_text(app: AppHandle) -> Result<Option<String>, AppError> {
    platform::read_text(&app).map_err(|e| failed("Couldn't read the clipboard.", e))
}

/// The app is exiting (the main thread): what glasshouse has on the
/// clipboard is handed to the desktop's clipboard manager, where there is
/// one, so a copy outlives the last window.
pub fn at_exit() {
    platform::store();
}

#[cfg(not(any(target_os = "linux", windows)))]
mod platform {
    use super::Read;
    use std::path::PathBuf;
    use tauri::AppHandle;

    const NO: &str = "the clipboard isn't supported on this platform";

    pub(super) fn write_files(_: &AppHandle, _: u64, _: &[PathBuf], _: bool, _: Vec<String>) -> Result<(), String> {
        Err(NO.into())
    }
    pub(super) fn read_files(_: &AppHandle) -> Result<Option<Read>, String> {
        Err(NO.into())
    }
    pub(super) fn write_text(_: &AppHandle, _: String) -> Result<(), String> {
        Err(NO.into())
    }
    pub(super) fn read_text(_: &AppHandle) -> Result<Option<String>, String> {
        Err(NO.into())
    }
    pub(super) fn clear(_: &AppHandle) -> Result<(), String> {
        Ok(())
    }
    pub(super) fn owns(_: u32) -> bool {
        false
    }
    pub(super) fn pasted(_: &AppHandle, _: u32) {}
    pub(super) fn store() {}
}

#[cfg(test)]
mod tests {
    use super::*;

    fn s(items: &[&str]) -> Vec<String> {
        items.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn a_cut_is_held_until_its_write_leaves_the_clipboard() {
        let mut h = Held::default();
        assert!(h.cut().is_empty());

        // A copy holds no cut; losing it changes nothing a window shows.
        let copy = h.next();
        assert!(!h.took(copy, vec![], 0));
        assert!(!h.lost(copy));

        // A cut is held until another app takes the clipboard.
        let cut = h.next();
        assert!(h.took(cut, s(&["/a", "/b"]), 0));
        assert_eq!(h.cut(), s(&["/a", "/b"]));
        assert!(h.lost(cut));
        assert!(h.cut().is_empty());
        assert!(!h.lost(cut), "lost once");
    }

    #[test]
    fn a_later_write_is_not_ended_by_an_earlier_ones_loss() {
        // GTK drops the old offer while the new one is being set (Linux):
        // the old one's loss comes first and ends the old cut.
        let mut h = Held::default();
        let first = h.next();
        h.took(first, s(&["/a"]), 0);
        let second = h.next();
        assert!(h.lost(first));
        assert!(h.took(second, s(&["/b"]), 0));
        assert_eq!(h.cut(), s(&["/b"]));

        // A loss reported late, after the new write is in place (a write
        // that replaces the block in one go, as on Windows).
        let third = h.next();
        assert!(h.took(third, s(&["/c"]), 0));
        assert!(!h.lost(second));
        assert_eq!(h.cut(), s(&["/c"]));

        // A copy over a cut ends the cut.
        let copy = h.next();
        assert!(h.took(copy, vec![], 0));
        assert!(h.cut().is_empty());

        // A write that failed never took: its loss means nothing.
        h.took(copy, s(&["/d"]), 0);
        let failed = h.next();
        assert!(!h.lost(failed));
        assert_eq!(h.cut(), s(&["/d"]));
    }

    #[test]
    fn emptying_the_clipboard_ends_whatever_was_held() {
        let mut h = Held::default();
        assert!(!h.emptied());
        let id = h.next();
        h.took(id, s(&["/a"]), 7);
        assert_eq!(h.live.as_ref().map(|l| l.stamp), Some(7));
        assert!(h.emptied());
        assert!(h.cut().is_empty());
        let id = h.next();
        h.took(id, vec![], 8);
        assert!(!h.emptied(), "a copy: no cut ended");
    }

    #[test]
    fn copies_must_be_full_paths_of_things_that_exist() {
        assert!(checked(&[]).is_err());
        assert!(checked(&s(&["relative/file"])).is_err());
        let dir = std::env::temp_dir().join(format!("gh-clipboard-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("a b.txt");
        std::fs::write(&file, "x").unwrap();
        let ok = file.to_string_lossy().into_owned();
        assert_eq!(checked(std::slice::from_ref(&ok)).unwrap(), vec![file.clone()]);
        let missing = dir.join("gone").to_string_lossy().into_owned();
        let err = checked(&[ok, missing]).unwrap_err();
        assert_eq!(err.kind, Kind::NotFound);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn clipboard_paths_are_sorted_into_there_gone_and_unnamed() {
        let dir = std::env::temp_dir().join(format!("gh-clipboard-sort-{}", std::process::id()));
        std::fs::create_dir_all(dir.join("folder")).unwrap();
        std::fs::write(dir.join("file.txt"), "x").unwrap();
        let mut paths = vec![dir.join("file.txt"), dir.join("folder"), dir.join("gone.txt")];
        #[cfg(unix)]
        {
            use std::os::unix::ffi::OsStringExt;
            std::os::unix::fs::symlink(dir.join("folder"), dir.join("link")).unwrap();
            std::os::unix::fs::symlink(dir.join("nowhere"), dir.join("broken")).unwrap();
            paths.push(dir.join("link"));
            paths.push(dir.join("broken"));
            paths.push(dir.join(std::ffi::OsString::from_vec(vec![b'x', 0xff])));
        }
        let (items, gone, unnamed) = sort_out(&paths);
        let item = |name: &str, folder: bool| ClipboardItem { path: dir.join(name).to_string_lossy().into_owned(), folder };
        assert_eq!(items[..2], [item("file.txt", false), item("folder", true)]);
        assert_eq!(gone, 1);
        #[cfg(unix)]
        {
            // A link to a folder is a folder, as the list shows it; a
            // broken link is still there to move.
            assert_eq!(items[2..], [item("link", true), item("broken", false)]);
            assert_eq!(unnamed, 1);
        }
        #[cfg(not(unix))]
        assert_eq!(unnamed, 0);
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
