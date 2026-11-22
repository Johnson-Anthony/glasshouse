// Dragging files out of the window into other apps: a browser's upload
// field, a terminal, another file manager. The pane's own drag uses pointer
// events and never leaves the webview. When it reaches the window's edge with
// the button still down, the frontend calls `start_drag_out` and the OS takes
// the drag from there. Under Wayland that's the only time a drag can start:
// the compositor checks the serial of the button press that's still held.
//
// Other apps are offered a copy only. Dropped on a glasshouse window, any of
// them, the drag is the pane's own again: a move, or a copy if Ctrl was held
// as it left. Every window is in this process, so the drag is held here
// while the OS has it (`Handoffs`), and each window's page asks
// `drag_out_own` about the OS drags that reach it. See
// docs/decisions/2026-11-22-cross-window-file-drag.md.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;

use tauri::{AppHandle, Emitter, EventTarget, Manager, WebviewWindow};

use crate::lock;

/// The paths a drag offers: absolute, and present on disk (links included,
/// as themselves).
fn checked_paths(paths: Vec<String>) -> Result<Vec<PathBuf>, String> {
    if paths.is_empty() {
        return Err("nothing to drag".into());
    }
    paths
        .into_iter()
        .map(|p| {
            let path = PathBuf::from(&p);
            if !path.is_absolute() {
                return Err(format!("not an absolute path: {p}"));
            }
            std::fs::symlink_metadata(&path).map_err(|e| format!("{p}: {e}"))?;
            Ok(path)
        })
        .collect()
}

/// The files `paths` name, sorted, to match a drop against the drag. On
/// Windows the `drag` crate offers the paths canonicalized (`dunce`), so
/// both sides are; a path that can't be is kept as given.
fn files(paths: &[PathBuf]) -> Vec<PathBuf> {
    let mut files: Vec<PathBuf> = paths.iter().map(|p| dunce::canonicalize(p).unwrap_or_else(|_| p.clone())).collect();
    files.sort();
    files
}

/// Whether `paths` are `files`, checked by count before anything is read.
fn same(files: &[PathBuf], paths: &[PathBuf]) -> bool {
    files.len() == paths.len() && self::files(paths) == files
}

/// The pane's drag, while the OS has it.
#[derive(Debug)]
struct Handoff {
    /// This drag's number: a late end of an earlier one is ignored.
    id: u64,
    /// The window it left.
    source: String,
    files: Vec<PathBuf>,
    /// Ctrl was held as it left the window.
    copy: bool,
}

/// The drag out in progress, and its drops on this process's windows.
#[derive(Debug, Default)]
pub struct Handoffs {
    live: Option<Handoff>,
    last_id: u64,
    /// The drag's drop on each window that got one, and whether it copies,
    /// until that window's page takes it (`own` with `drop`). Noted when the
    /// drop reaches the backend (`dropped`), which is before the drag ends;
    /// the page hears of the drop after that.
    landed: HashMap<String, (Vec<PathBuf>, bool)>,
}

impl Handoffs {
    /// A drag of `files` leaves window `source`. It replaces a drag whose
    /// end never came, and what earlier drops left goes.
    fn start(&mut self, source: &str, files: Vec<PathBuf>, copy: bool) -> u64 {
        self.last_id += 1;
        self.landed.clear();
        self.live = Some(Handoff { id: self.last_id, source: source.to_string(), files, copy });
        self.last_id
    }

    /// Window `label` got an OS drop of `paths`: if it's the drag, how it
    /// goes is kept for that window's page.
    fn dropped(&mut self, label: &str, paths: &[PathBuf]) {
        if let Some(h) = self.live.as_ref().filter(|h| same(&h.files, paths)) {
            self.landed.insert(label.to_string(), (h.files.clone(), h.copy));
        }
    }

    /// The drag `id` ended: the window it left, if it was still held.
    fn end(&mut self, id: u64) -> Option<String> {
        self.live.take_if(|h| h.id == id).map(|h| h.source)
    }

    /// Whether an OS drag of `paths` over window `label` is the pane's
    /// drag: whether it copies, or None for another app's. `drop`: the drop
    /// itself, which takes what was kept for the window, whether or not it
    /// answers, so it can't answer for a later drop.
    fn own(&mut self, label: &str, paths: &[PathBuf], drop: bool) -> Option<bool> {
        let kept = if drop { self.landed.remove(label) } else { None };
        kept.filter(|(files, _)| same(files, paths))
            .map(|(_, copy)| copy)
            .or_else(|| self.live.as_ref().filter(|h| same(&h.files, paths)).map(|h| h.copy))
    }

    /// Window `label` closed or loaded again: what was kept for it goes,
    /// and so does a drag from it, whose page is gone.
    fn forget(&mut self, label: &str) {
        self.landed.remove(label);
        self.live.take_if(|h| h.source == label);
    }
}

/// The drag out, as managed state.
#[derive(Default)]
pub struct DragOuts(Mutex<Handoffs>);

/// Hands `paths` to the OS as a drag, as copies. `copy`: Ctrl was held as
/// it left the window, for a drop back on a glasshouse window. Returns once
/// the drag has started (Linux) or been scheduled (Windows); where it's
/// dropped is up to the app under the pointer.
#[tauri::command(async)]
pub fn start_drag_out(app: AppHandle, window: WebviewWindow, paths: Vec<String>, copy: bool) -> Result<(), String> {
    let paths = checked_paths(paths)?;
    let outs = &app.state::<DragOuts>().0;
    // Held before the drag begins: it can be dropped before this returns.
    let id = lock(outs).start(window.label(), files(&paths), copy);
    platform::start(window, paths, id).inspect_err(|_| {
        lock(outs).end(id);
    })
}

/// Whether an OS drag of `paths` over this window is a pane's drag from a
/// glasshouse window, this one included: whether it copies, or null for a
/// drag from another app. Asked as the drag comes in, for the hint, and at
/// the drop (`drop`), which takes what the backend kept for this window.
#[tauri::command(async)]
pub fn drag_out_own(app: AppHandle, window: WebviewWindow, paths: Vec<PathBuf>, drop: bool) -> Option<bool> {
    lock(&app.state::<DragOuts>().0).own(window.label(), &paths, drop)
}

/// Window `label` got an OS drop of `paths` (the run loop's `DragDrop`,
/// before its page hears of it): if it's the drag out, how it goes is kept
/// for that page.
pub fn dropped(app: &AppHandle, label: &str, paths: &[PathBuf]) {
    lock(&app.state::<DragOuts>().0).dropped(label, paths);
}

/// Window `label` closed or loaded again (`app_windows.rs`).
pub fn forget(app: &AppHandle, label: &str) {
    lock(&app.state::<DragOuts>().0).forget(label);
}

/// The OS drag `id` ended: GTK's `drag-end` or `drag-failed`, or
/// `DoDragDrop` returning. A drop on one of this process's windows is
/// already queued in the event loop by then (wry finishes the drop, then
/// posts it), but not yet seen by `dropped`. So the drag is let go through
/// the same queue, behind it: `run_on_main_thread` from another thread
/// (on the main thread it would run at once). Then its window hears
/// `drag-out-end`.
#[cfg_attr(not(any(target_os = "linux", windows)), allow(dead_code))]
fn ended(app: &AppHandle, id: u64) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let a = app.clone();
        if let Err(e) = app.run_on_main_thread(move || finish(&a, id)) {
            log::warn!("drag out: {e}");
            finish(&app, id);
        }
    });
}

fn finish(app: &AppHandle, id: u64) {
    let Some(source) = lock(&app.state::<DragOuts>().0).end(id) else {
        return;
    };
    log::debug!("drag out: let go");
    if let Err(e) = app.emit_to(EventTarget::webview_window(&source), "drag-out-end", ()) {
        log::warn!("drag out: {e}");
    }
}

#[cfg(target_os = "linux")]
mod platform {
    use gtk::glib::SignalHandlerId;
    use gtk::prelude::*;
    use std::cell::RefCell;
    use std::path::PathBuf;
    use std::time::Duration;
    use tauri::Manager;

    const URI_LIST: u32 = 1;
    const TEXT: u32 = 2;

    thread_local! {
        /// The drag's window and its signal handlers there, dropped when it
        /// ends.
        static SOURCE: RefCell<Option<(gtk::ApplicationWindow, Vec<SignalHandlerId>)>> = const { RefCell::new(None) };
    }

    /// What the drag offers: `file://` URIs, percent-encoded (a space, `#`
    /// or `%` in a name would otherwise break them), and the plain paths, one
    /// per line, for targets that only take text.
    pub(super) fn payload(paths: &[PathBuf]) -> (Vec<String>, String) {
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

    pub(super) fn start(window: tauri::WebviewWindow, paths: Vec<PathBuf>, id: u64) -> Result<(), String> {
        let (tx, rx) = std::sync::mpsc::channel();
        let w = window.clone();
        window
            .with_webview(move |pw| {
                let _ = tx.send(begin(&w, pw.inner().upcast(), &paths, id));
            })
            .map_err(|e| e.to_string())?;
        rx.recv_timeout(Duration::from_secs(5))
            .map_err(|_| "the drag didn't start".to_string())?
    }

    fn clear_handlers() {
        if let Some((win, handlers)) = SOURCE.with(|s| s.borrow_mut().take()) {
            for id in handlers {
                win.disconnect(id);
            }
        }
    }

    fn begin(window: &tauri::WebviewWindow, view: gtk::Widget, paths: &[PathBuf], id: u64) -> Result<(), String> {
        let win = window.gtk_window().map_err(|e| e.to_string())?;
        // A drag whose end never arrived must not answer for this one.
        clear_handlers();

        let targets = gtk::TargetList::new(&[]);
        targets.add_uri_targets(URI_LIST);
        targets.add_text_targets(TEXT);
        let (uris, text) = payload(paths);
        let data = win.connect_drag_data_get(move |_, _, sel, info, _| {
            if info == URI_LIST {
                let refs: Vec<&str> = uris.iter().map(String::as_str).collect();
                sel.set_uris(&refs);
            } else {
                sel.set_text(&text);
            }
        });
        let app = window.app_handle().clone();
        // Said on stderr, for anyone running the app from a terminal: a drag
        // the compositor refuses ends here without any other sign.
        let a = app.clone();
        let failed = win.connect_drag_failed(move |_, _, result| {
            log::warn!("drag out: failed ({result:?})");
            super::ended(&a, id);
            gtk::glib::Propagation::Proceed
        });
        // drag-end comes once per drag, whether it was dropped or not; only a
        // drag-failed line before it says the drop didn't take. The press
        // the drag began with went to WebKit and its release to the drag:
        // the webview gets a release (`tab_drag::release`), or the next drag
        // in this window wouldn't start.
        let end = win.connect_drag_end(move |_, _| {
            log::debug!("drag out: ended");
            clear_handlers();
            crate::tab_drag::release(&view);
            super::ended(&app, id);
        });

        // No event: GTK takes the pointer and its position from the seat, and
        // under Wayland the serial of the press that's still held.
        match win.drag_begin_with_coordinates(&targets, gtk::gdk::DragAction::COPY, 1, None, -1, -1) {
            Some(ctx) => {
                ctx.drag_set_icon_default();
                SOURCE.with(|s| *s.borrow_mut() = Some((win, vec![data, failed, end])));
                log::debug!("drag out: started with {} item(s)", paths.len());
                Ok(())
            }
            None => {
                for h in [data, failed, end] {
                    win.disconnect(h);
                }
                Err("the drag didn't start".into())
            }
        }
    }
}

#[cfg(windows)]
mod platform {
    use std::path::PathBuf;
    use tauri::Manager;

    const ICON: &[u8] = include_bytes!("../../icons/32x32.png");

    // OLE's DoDragDrop through the `drag` crate (CF_HDROP, the same data
    // Explorer offers). It runs a modal loop until the drop, so the command
    // returns as soon as it's scheduled, and the drag ends when the call
    // returns. The webview keeps no stuck button: OLE takes the mouse
    // capture, and WebView2 hears it go (WM_CAPTURECHANGED).
    pub(super) fn start(window: tauri::WebviewWindow, paths: Vec<PathBuf>, id: u64) -> Result<(), String> {
        let w = window.clone();
        window
            .run_on_main_thread(move || {
                let options = drag::Options { mode: drag::DragMode::Copy, ..Default::default() };
                let item = drag::DragItem::Files(paths);
                if let Err(e) = drag::start_drag(&w, item, drag::Image::Raw(ICON.to_vec()), |_, _| {}, options) {
                    log::warn!("drag out: {e}");
                }
                super::ended(w.app_handle(), id);
            })
            .map_err(|e| e.to_string())
    }
}

#[cfg(not(any(target_os = "linux", windows)))]
mod platform {
    pub(super) fn start(_window: tauri::WebviewWindow, _paths: Vec<std::path::PathBuf>, _id: u64) -> Result<(), String> {
        Err("dragging files out isn't supported on this platform".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn refuses_relative_missing_and_empty() {
        assert!(checked_paths(vec![]).is_err());
        assert!(checked_paths(vec!["relative/file".into()]).is_err());
        let dir = std::env::temp_dir().join(format!("gh-drag-out-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("a b.txt");
        std::fs::write(&file, "x").unwrap();
        let ok = file.to_string_lossy().into_owned();
        assert_eq!(checked_paths(vec![ok.clone()]).unwrap(), vec![file.clone()]);
        let missing = dir.join("gone").to_string_lossy().into_owned();
        assert!(checked_paths(vec![ok, missing]).is_err());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn payload_percent_encodes_uris_and_keeps_plain_paths() {
        let paths = [PathBuf::from("/home/u/a b#1%.txt"), PathBuf::from("/home/u/ünï")];
        let (uris, text) = platform::payload(&paths);
        assert_eq!(uris, ["file:///home/u/a%20b%231%25.txt", "file:///home/u/%C3%BCn%C3%AF"]);
        assert_eq!(text, "/home/u/a b#1%.txt\n/home/u/ünï");
    }

    fn p(paths: &[&str]) -> Vec<PathBuf> {
        let root = std::env::temp_dir().join("gh-drag-out-none");
        paths.iter().map(|s| root.join(s)).collect()
    }

    /// A drag of `paths` from window "a", Ctrl held or not.
    fn from_a(h: &mut Handoffs, paths: &[&str], copy: bool) -> u64 {
        h.start("a", files(&p(paths)), copy)
    }

    #[test]
    fn a_drag_is_known_by_exactly_its_files_in_any_order() {
        let mut h = Handoffs::default();
        from_a(&mut h, &["x", "y"], false);
        assert_eq!(h.own("b", &p(&["y", "x"]), false), Some(false));
        assert_eq!(h.own("b", &p(&["x"]), false), None);
        assert_eq!(h.own("b", &p(&["x", "y", "z"]), false), None);
        assert_eq!(h.own("b", &p(&["x", "z"]), false), None);
        from_a(&mut h, &["x"], true);
        assert_eq!(h.own("a", &p(&["x"]), false), Some(true));
    }

    #[test]
    fn the_same_file_by_another_path_is_the_same_file() {
        let dir = std::env::temp_dir().join(format!("gh-drag-out-same-{}", std::process::id()));
        std::fs::create_dir_all(dir.join("sub")).unwrap();
        std::fs::write(dir.join("a.txt"), "x").unwrap();
        let mut h = Handoffs::default();
        h.start("a", files(&[dir.join("a.txt")]), false);
        assert_eq!(h.own("b", &[dir.join("sub").join("..").join("a.txt")], false), Some(false));
        std::fs::remove_dir_all(&dir).unwrap();
    }

    /// Every way the OS drag can end lets it go: after that, nothing
    /// answers for its files but what a window's drop kept, once.
    #[test]
    fn the_drag_is_held_from_its_start_until_any_end() {
        // Dropped on another glasshouse window: kept for that window, then
        // the end (drag-end, or DoDragDrop returning).
        let mut h = Handoffs::default();
        let id = from_a(&mut h, &["x"], false);
        h.dropped("b", &p(&["x"]));
        assert_eq!(h.end(id).as_deref(), Some("a"));
        assert_eq!(h.own("b", &p(&["x"]), false), None, "only the drop takes what was kept");
        assert_eq!(h.own("b", &p(&["x"]), true), Some(false));
        assert_eq!(h.own("b", &p(&["x"]), true), None, "taken once");

        // Back on its own window (the overshoot), Ctrl held as it left.
        let id = from_a(&mut h, &["x"], true);
        h.dropped("a", &p(&["x"]));
        h.end(id);
        assert_eq!(h.own("a", &p(&["x"]), true), Some(true));

        // Dropped on another app, or on nothing: drag-failed, then
        // drag-end. Both end it; the second finds nothing, so the source
        // hears drag-out-end once.
        for label in ["b", "a"] {
            let id = from_a(&mut h, &["x"], false);
            assert_eq!(h.end(id).as_deref(), Some("a"));
            assert_eq!(h.end(id), None);
            assert_eq!(h.own(label, &p(&["x"]), true), None);
        }

        // Escape (drag-failed with USER_CANCELLED, then drag-end), or
        // DoDragDrop cancelled: the same.
        let id = from_a(&mut h, &["x"], false);
        assert_eq!(h.own("a", &p(&["x"]), false), Some(false));
        h.end(id);
        assert_eq!(h.own("a", &p(&["x"]), false), None);

        // The drag didn't start: start_drag_out ends it at once.
        let id = from_a(&mut h, &["x"], false);
        h.end(id);
        assert!(h.live.is_none());

        // A new drag before the old one's end came: the new one is held,
        // and the old one's late end doesn't let it go.
        let old = from_a(&mut h, &["x"], false);
        let new = h.start("b", files(&p(&["y"])), true);
        assert_eq!(h.own("a", &p(&["x"]), false), None);
        assert_eq!(h.end(old), None);
        assert_eq!(h.own("a", &p(&["y"]), false), Some(true));
        assert_eq!(h.end(new).as_deref(), Some("b"));

        // Its window closed or loaded again.
        from_a(&mut h, &["x"], false);
        h.forget("b");
        assert_eq!(h.own("b", &p(&["x"]), false), Some(false), "another window going changes nothing");
        h.forget("a");
        assert!(h.live.is_none());
    }

    #[test]
    fn a_drop_from_another_app_is_never_the_drag() {
        let mut h = Handoffs::default();
        assert_eq!(h.own("b", &p(&["x"]), true), None, "no drag out");
        // Not the drag's files: nothing is kept.
        let id = from_a(&mut h, &["x"], false);
        h.dropped("b", &p(&["o"]));
        h.end(id);
        assert!(h.landed.is_empty());
        // A drop when no drag is held keeps nothing.
        h.dropped("b", &p(&["x"]));
        assert_eq!(h.own("b", &p(&["x"]), true), None);
    }

    /// A to B, dropped where B takes nothing (its sidebar, outside any
    /// folder): B's page still takes what was kept, so the same file
    /// dropped from another app afterwards is a copy.
    #[test]
    fn what_a_drop_kept_never_answers_for_a_later_one() {
        let mut h = Handoffs::default();
        let id = from_a(&mut h, &["x"], false);
        h.dropped("b", &p(&["x"]));
        h.end(id);
        assert_eq!(h.own("b", &p(&["x"]), true), Some(false), "the page asks at every drop, taken or not");
        h.dropped("b", &p(&["x"]));
        assert_eq!(h.own("b", &p(&["x"]), true), None);

        // Kept for B, but B's next drop is of other files: taken anyway.
        let id = from_a(&mut h, &["x"], false);
        h.dropped("b", &p(&["x"]));
        h.end(id);
        assert_eq!(h.own("b", &p(&["o"]), true), None);
        assert_eq!(h.own("b", &p(&["x"]), true), None);

        // Kept for B and never taken (its page went): a new drag clears it.
        let id = from_a(&mut h, &["x"], false);
        h.dropped("b", &p(&["x"]));
        h.end(id);
        let id = from_a(&mut h, &["y"], false);
        h.end(id);
        assert_eq!(h.own("b", &p(&["x"]), true), None);

        // Or B closed or loaded again.
        let id = from_a(&mut h, &["x"], false);
        h.dropped("b", &p(&["x"]));
        h.end(id);
        h.forget("b");
        assert_eq!(h.own("b", &p(&["x"]), true), None);
    }
}
