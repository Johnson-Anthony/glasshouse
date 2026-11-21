//! The saved session: every window's tabs and, through the window-state
//! plugin (which `lib.rs` registers only in the owner), its size and place.
//!
//! All windows live in one process (`app_windows.rs`), and a second launch
//! hands its window to it (`handoff.rs`). Each window's page reports its
//! tabs (`session_report`); the registry keeps every window's last report,
//! and this module writes them to `session.json` in the app config dir,
//! half a second after a change and again on exit. A plain start restores
//! every window in it. See
//! docs/decisions/2026-11-21-split-and-tear-off-session.md, the successor
//! of docs/decisions/2026-11-15-session-persistence-windows.md.
//!
//! Which process may write it is still `session.lock`: the first plain
//! process running takes an exclusive lock on it and keeps it until it
//! ends; the OS drops it then, crash or not. A process started with paths
//! (another app's "Show in folder") is a guest and doesn't claim it, and so
//! is a second process that couldn't hand off. A guest restores and saves
//! nothing, until a plain launch is handed to it: then it claims the lock
//! if it can (`Session::upgrade`).

use std::fs::{File, OpenOptions, TryLockError};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use serde_json::{json, Map, Value};
use tauri::{AppHandle, Manager, State};

use crate::lock;

pub struct SessionOwner {
    owner: bool,
    /// Held open for the life of the process: closing it drops the lock.
    _lock: Option<File>,
}

impl SessionOwner {
    pub fn is_owner(&self) -> bool {
        self.owner
    }

    /// A process started with paths by another app ("Show in folder"): it
    /// doesn't take the session, so it never replaces the saved tabs, and
    /// the user's next plain start still restores them.
    pub fn guest() -> Self {
        SessionOwner { owner: false, _lock: None }
    }
}

/// Claims the session for this process unless another process holds
/// `dir/session.lock`. With no config dir, or a lock file that can't be made
/// or locked (a read-only config dir, a file system without locks), this
/// process is the owner: saving with no guard beats never saving.
pub fn claim(dir: Option<&Path>) -> SessionOwner {
    let Some(dir) = dir else {
        return SessionOwner { owner: true, _lock: None };
    };
    let opened = std::fs::create_dir_all(dir).and_then(|_| {
        OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(dir.join("session.lock"))
    });
    let Ok(file) = opened else {
        return SessionOwner { owner: true, _lock: None };
    };
    match file.try_lock() {
        Ok(()) => SessionOwner { owner: true, _lock: Some(file) },
        Err(TryLockError::WouldBlock) => SessionOwner { owner: false, _lock: None },
        Err(TryLockError::Error(_)) => SessionOwner { owner: true, _lock: None },
    }
}

/// The session file, in the app config dir.
pub const FILE: &str = "session.json";
const VERSION: u64 = 1;
/// More than this is a broken file, not a session: each window lists and
/// watches its tabs' folders on start.
const MAX_WINDOWS: usize = 20;
/// The most JSON one window's record may take (100 tabs of long paths is
/// well under a tenth of it).
pub const MAX_RECORD: usize = 256 * 1024;
/// How long after a change the file is written: a burst of changes (a
/// restore, a tab dragged across) is one write.
const WRITE_AFTER: Duration = Duration::from_millis(500);

/// One saved window: its label (which keys its size and place in the
/// window-state plugin) and its page's own record of its tabs, which the
/// page checks field by field (`parseSession` in src/session.ts).
#[derive(Debug, Clone, PartialEq)]
pub struct SavedWindow {
    pub label: String,
    pub session: Value,
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct Saved {
    /// In the order they opened.
    pub windows: Vec<SavedWindow>,
    /// The window that had the focus last.
    pub focused: Option<String>,
}

/// Whether a page's record has a tab to restore. A window with only private
/// tabs reports none, and isn't brought back.
pub fn has_tabs(record: &Value) -> bool {
    record.get("tabs").and_then(Value::as_array).is_some_and(|t| !t.is_empty())
}

pub fn encode(saved: &Saved) -> String {
    let windows: Vec<Value> = saved
        .windows
        .iter()
        .map(|w| json!({ "label": w.label, "session": w.session }))
        .collect();
    let mut out = Map::new();
    out.insert("version".into(), VERSION.into());
    if let Some(f) = &saved.focused {
        out.insert("focused".into(), f.clone().into());
    }
    out.insert("windows".into(), windows.into());
    Value::Object(out).to_string()
}

/// The file's windows that can be restored: a known label (once each), a
/// record with tabs, not too big. None when it isn't a session file at all
/// (broken JSON, another version), which counts as no file.
pub fn decode(text: &str) -> Option<Saved> {
    let v: Value = serde_json::from_str(text).ok()?;
    if v.get("version").and_then(Value::as_u64) != Some(VERSION) {
        return None;
    }
    let mut windows: Vec<SavedWindow> = Vec::new();
    for w in v.get("windows").and_then(Value::as_array).into_iter().flatten() {
        let Some(label) = w.get("label").and_then(Value::as_str) else { continue };
        let Some(session) = w.get("session").filter(|s| s.is_object()) else { continue };
        if !crate::app_windows::valid_label(label)
            || windows.iter().any(|k| k.label == label)
            || !has_tabs(session)
            || session.to_string().len() > MAX_RECORD
        {
            continue;
        }
        windows.push(SavedWindow { label: label.to_string(), session: session.clone() });
        if windows.len() == MAX_WINDOWS {
            break;
        }
    }
    let focused = v
        .get("focused")
        .and_then(Value::as_str)
        .filter(|f| windows.iter().any(|w| w.label == *f))
        .map(str::to_string);
    Some(Saved { windows, focused })
}

/// The session in `dir`, or None when there's no file yet (0.2 and the
/// builds before this one kept only the v1 localStorage key) or it can't be
/// read as one.
pub fn read(dir: Option<&Path>) -> Option<Saved> {
    decode(&std::fs::read_to_string(dir?.join(FILE)).ok()?)
}

/// The process's part in the session: whether it owns it, and its writer.
pub struct Session {
    owner: Mutex<SessionOwner>,
    dir: Option<PathBuf>,
    /// A write is waiting for its half second.
    scheduled: AtomicBool,
    /// What was last written (or read at start), so an unchanged session
    /// isn't written again.
    last: Mutex<Option<String>>,
}

impl Session {
    pub fn new(owner: SessionOwner, dir: Option<PathBuf>) -> Self {
        Session { owner: Mutex::new(owner), dir, scheduled: AtomicBool::new(false), last: Mutex::new(None) }
    }

    pub fn is_owner(&self) -> bool {
        lock(&self.owner).is_owner()
    }

    pub fn dir(&self) -> Option<&Path> {
        self.dir.as_deref()
    }

    /// A guest takes the session, if no other process holds it. Returns
    /// whether it did (false for a process that already owned it).
    pub fn upgrade(&self) -> bool {
        let mut owner = lock(&self.owner);
        if owner.is_owner() {
            return false;
        }
        let claimed = claim(self.dir.as_deref());
        let took = claimed.is_owner();
        if took {
            *owner = claimed;
        }
        took
    }

    /// The app is ending and its session is written: the lock goes now
    /// rather than with the process, so an update's restart can take it.
    pub fn release(&self) {
        *lock(&self.owner) = SessionOwner::guest();
    }

    /// Writes `saved` unless it's what was written last. Errors go to the
    /// log: the next change tries again.
    fn write(&self, saved: &Saved) {
        let Some(dir) = &self.dir else { return };
        let text = encode(saved);
        let mut last = lock(&self.last);
        if last.as_deref() == Some(text.as_str()) {
            return;
        }
        let written = std::fs::create_dir_all(dir)
            .map_err(|e| e.to_string())
            .and_then(|_| crate::commands::config::write_config_atomic(&dir.join(FILE), &text));
        match written {
            Ok(()) => *last = Some(text),
            Err(e) => log::warn!("saving the session: {e}"),
        }
    }
}

/// Writes the session half a second from now, with whatever it is then.
/// Only the owner writes.
pub fn schedule(app: &AppHandle) {
    let session = app.state::<Session>();
    if !session.is_owner() || session.scheduled.swap(true, Ordering::SeqCst) {
        return;
    }
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(WRITE_AFTER);
        let session = app.state::<Session>();
        session.scheduled.store(false, Ordering::SeqCst);
        flush(&app);
    });
}

/// Writes the session now, if this process owns it: on exit, on Quit.
pub fn flush(app: &AppHandle) {
    let session = app.state::<Session>();
    if !session.is_owner() {
        return;
    }
    let saved = app.state::<crate::app_windows::Windows>().saved();
    session.write(&saved);
}

/// Whether this window restores and saves the tabs.
#[tauri::command]
pub fn session_owner(state: State<'_, Session>) -> bool {
    state.is_owner()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::testing::Scratch;

    #[test]
    fn the_first_claim_owns_the_session_until_it_ends() {
        let dir = Scratch::new("session-claim");
        let first = claim(Some(dir.path()));
        assert!(first.is_owner());
        // A second process opens the file on its own, as this does.
        assert!(!claim(Some(dir.path())).is_owner());
        drop(first);
        assert!(claim(Some(dir.path())).is_owner());
    }

    #[test]
    fn a_missing_config_dir_is_made() {
        let dir = Scratch::new("session-mkdir");
        let nested = dir.join("a/b");
        assert!(claim(Some(&nested)).is_owner());
        assert!(nested.join("session.lock").is_file());
    }

    #[test]
    fn no_lock_file_still_owns() {
        let dir = Scratch::new("session-nofile");
        // A file where the config dir should be: the lock can't be made.
        let blocked = dir.join("config");
        std::fs::write(&blocked, "").unwrap();
        assert!(claim(Some(&blocked)).is_owner());
        assert!(claim(None).is_owner());
    }

    #[test]
    fn a_guest_takes_the_session_only_when_nobody_holds_it() {
        let dir = Scratch::new("session-upgrade");
        let other = claim(Some(dir.path()));
        let guest = Session::new(SessionOwner::guest(), Some(dir.path().to_path_buf()));
        assert!(!guest.upgrade());
        assert!(!guest.is_owner());
        drop(other);
        assert!(guest.upgrade());
        assert!(guest.is_owner());
        // It holds the lock now, and taking it twice is no change.
        assert!(!claim(Some(dir.path())).is_owner());
        assert!(!guest.upgrade());
    }

    fn record(paths: &[&str]) -> Value {
        json!({ "tabs": paths.iter().map(|p| json!({ "path": p, "sort": { "key": "name", "dir": "asc" } })).collect::<Vec<_>>(), "active": 0 })
    }

    fn window(label: &str, paths: &[&str]) -> SavedWindow {
        SavedWindow { label: label.into(), session: record(paths) }
    }

    #[test]
    fn a_session_reads_back_as_written() {
        let saved = Saved { windows: vec![window("main", &["/a", "/b"]), window("main-3", &["/c"])], focused: Some("main-3".into()) };
        assert_eq!(decode(&encode(&saved)), Some(saved.clone()));
        let none_focused = Saved { focused: None, ..saved };
        assert_eq!(decode(&encode(&none_focused)), Some(none_focused));
    }

    #[test]
    fn only_restorable_windows_are_kept() {
        let big = "/x".repeat(MAX_RECORD);
        let text = json!({
            "version": 1,
            "focused": "main-4",
            "windows": [
                { "label": "main", "session": record(&["/a"]) },
                // The same label again, a label no window gets, a record that
                // isn't one, one with no tabs (private ones only), one too big.
                { "label": "main", "session": record(&["/dup"]) },
                { "label": "../../etc", "session": record(&["/b"]) },
                { "label": "main-02", "session": record(&["/b"]) },
                { "label": "main-2", "session": [1, 2] },
                { "label": "main-3", "session": { "tabs": [], "active": 0 } },
                { "label": "main-4", "session": record(&[big.as_str()]) },
                { "session": record(&["/no-label"]) },
                { "label": "main-5", "session": record(&["/e"]) },
            ],
        })
        .to_string();
        let got = decode(&text).unwrap();
        assert_eq!(got.windows, [window("main", &["/a"]), window("main-5", &["/e"])]);
        // The focused window was dropped: no focus.
        assert_eq!(got.focused, None);
    }

    #[test]
    fn a_file_that_is_not_a_session_counts_as_none() {
        assert_eq!(decode("not json"), None);
        assert_eq!(decode("[]"), None);
        assert_eq!(decode(r#"{"version":2,"windows":[]}"#), None);
        // A session with nothing to restore is still one: no fallback to v1.
        assert_eq!(decode(r#"{"version":1,"windows":[]}"#), Some(Saved::default()));
        assert_eq!(decode(r#"{"version":1}"#), Some(Saved::default()));
    }

    #[test]
    fn at_most_twenty_windows_come_back() {
        let windows: Vec<SavedWindow> = (1..=30).map(|n| window(&format!("main-{}", n + 1), &["/a"])).collect();
        let got = decode(&encode(&Saved { windows, focused: Some("main-31".into()) })).unwrap();
        assert_eq!(got.windows.len(), MAX_WINDOWS);
        assert_eq!(got.windows[0].label, "main-2");
        assert_eq!(got.focused, None);
    }

    #[test]
    fn the_writer_skips_an_unchanged_session_and_reads_back() {
        let dir = Scratch::new("session-write");
        let session = Session::new(claim(Some(dir.path())), Some(dir.path().to_path_buf()));
        let saved = Saved { windows: vec![window("main", &["/a"])], focused: Some("main".into()) };
        session.write(&saved);
        assert_eq!(read(Some(dir.path())), Some(saved.clone()));
        // Changed behind its back: an unchanged session isn't written again.
        std::fs::write(dir.join(FILE), "{}").unwrap();
        session.write(&saved);
        assert_eq!(std::fs::read_to_string(dir.join(FILE)).unwrap(), "{}");
        assert_eq!(read(Some(dir.path())), None);
        assert_eq!(read(None), None);
    }
}
