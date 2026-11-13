// Dragging files out of the window into other apps: a browser's upload
// field, a terminal, another file manager. The pane's own drag uses pointer
// events and never leaves the webview. When it reaches the window's edge with
// the button still down, the frontend calls `start_drag_out` and the OS takes
// the drag from there. Under Wayland that's the only time a drag can start:
// the compositor checks the serial of the button press that's still held.

use std::path::PathBuf;

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

/// Hands `paths` to the OS as a drag, as copies. Returns once the drag has
/// started (Linux) or been scheduled (Windows); where it's dropped is up to
/// the app under the pointer.
#[tauri::command(async)]
pub fn start_drag_out(window: tauri::WebviewWindow, paths: Vec<String>) -> Result<(), String> {
    let paths = checked_paths(paths)?;
    platform::start(window, paths)
}

#[cfg(target_os = "linux")]
mod platform {
    use gtk::glib::SignalHandlerId;
    use gtk::prelude::*;
    use std::cell::RefCell;
    use std::path::PathBuf;
    use std::time::Duration;

    const URI_LIST: u32 = 1;
    const TEXT: u32 = 2;

    thread_local! {
        /// The drag's signal handlers on the window, dropped when it ends.
        static HANDLERS: RefCell<Vec<SignalHandlerId>> = const { RefCell::new(Vec::new()) };
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

    pub(super) fn start(window: tauri::WebviewWindow, paths: Vec<PathBuf>) -> Result<(), String> {
        let (tx, rx) = std::sync::mpsc::channel();
        let w = window.clone();
        window
            .run_on_main_thread(move || {
                let _ = tx.send(begin(&w, &paths));
            })
            .map_err(|e| e.to_string())?;
        rx.recv_timeout(Duration::from_secs(5))
            .map_err(|_| "the drag didn't start".to_string())?
    }

    fn clear_handlers(win: &gtk::ApplicationWindow) {
        for id in HANDLERS.with(|h| std::mem::take(&mut *h.borrow_mut())) {
            win.disconnect(id);
        }
    }

    fn begin(window: &tauri::WebviewWindow, paths: &[PathBuf]) -> Result<(), String> {
        let win = window.gtk_window().map_err(|e| e.to_string())?;
        // A drag whose end never arrived must not answer for this one.
        clear_handlers(&win);

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
        // Said on stderr, for anyone running the app from a terminal: a drag
        // the compositor refuses ends here without any other sign.
        let failed = win.connect_drag_failed(|_, _, result| {
            eprintln!("drag out: failed ({result:?})");
            gtk::glib::Propagation::Proceed
        });
        // drag-end comes once per drag, whether it was dropped or not.
        let end = win.connect_drag_end(|w, ctx| {
            eprintln!("drag out: ended ({:?})", ctx.selected_action());
            clear_handlers(w);
        });
        HANDLERS.with(|h| h.borrow_mut().extend([data, failed, end]));

        // No event: GTK takes the pointer and its position from the seat, and
        // under Wayland the serial of the press that's still held.
        match win.drag_begin_with_coordinates(&targets, gtk::gdk::DragAction::COPY, 1, None, -1, -1) {
            Some(ctx) => {
                ctx.drag_set_icon_default();
                eprintln!("drag out: started with {} item(s)", paths.len());
                Ok(())
            }
            None => {
                clear_handlers(&win);
                Err("the drag didn't start".into())
            }
        }
    }
}

#[cfg(windows)]
mod platform {
    use std::path::PathBuf;

    const ICON: &[u8] = include_bytes!("../../icons/32x32.png");

    // OLE's DoDragDrop through the `drag` crate (CF_HDROP, the same data
    // Explorer offers). It runs a modal loop until the drop, so the command
    // returns as soon as it's scheduled.
    pub(super) fn start(window: tauri::WebviewWindow, paths: Vec<PathBuf>) -> Result<(), String> {
        let w = window.clone();
        window
            .run_on_main_thread(move || {
                let options = drag::Options { mode: drag::DragMode::Copy, ..Default::default() };
                let item = drag::DragItem::Files(paths);
                if let Err(e) = drag::start_drag(&w, item, drag::Image::Raw(ICON.to_vec()), |_, _| {}, options) {
                    eprintln!("drag out: {e}");
                }
            })
            .map_err(|e| e.to_string())
    }
}

#[cfg(not(any(target_os = "linux", windows)))]
mod platform {
    pub(super) fn start(_window: tauri::WebviewWindow, _paths: Vec<std::path::PathBuf>) -> Result<(), String> {
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
}
