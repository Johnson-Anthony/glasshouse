// Unix only, like the pty tests: the Windows watcher backend isn't checked
// locally, so it isn't asserted here either.
#![cfg(unix)]

use super::*;
use crate::commands::testing::{put, Scratch};
use std::path::Path;
use std::sync::mpsc;

const TIMEOUT: Duration = Duration::from_secs(10);
/// Comfortably past the 300 ms debounce, for checks that nothing arrives.
const QUIET: Duration = Duration::from_millis(1500);

/// A fresh state plus a receiver for the folders it reports.
fn watcher() -> (WatcherState, impl Fn(String) + Send + 'static, mpsc::Receiver<String>) {
    let (tx, rx) = mpsc::channel();
    let on_change = move |dir: String| {
        let _ = tx.send(dir);
    };
    (WatcherState::default(), on_change, rx)
}

fn canon(p: &Path) -> PathBuf {
    dunce::canonicalize(p).unwrap()
}

/// Wait until `dir` is reported. Other folders may be reported on the way.
fn reported(rx: &mpsc::Receiver<String>, dir: &Path, within: Duration) -> bool {
    let want = canon(dir);
    let deadline = std::time::Instant::now() + within;
    while let Some(left) = deadline.checked_duration_since(std::time::Instant::now()) {
        match rx.recv_timeout(left) {
            Ok(got) if canon(Path::new(&got)) == want => return true,
            Ok(_) => {}
            Err(_) => return false,
        }
    }
    false
}

fn watched(state: &WatcherState) -> Vec<PathBuf> {
    state.watched.lock().unwrap().iter().cloned().collect()
}

#[test]
fn a_new_file_reports_its_folder() {
    let d = Scratch::new("watch-new");
    let (state, on_change, rx) = watcher();
    watch(&state, d.path().to_path_buf(), on_change).unwrap();
    put(&d.join("new.txt"), "x");
    assert!(reported(&rx, d.path(), TIMEOUT));
}

#[test]
fn watching_a_folder_twice_registers_it_once() {
    let d = Scratch::new("watch-twice");
    let (state, on_change, rx) = watcher();
    watch(&state, d.path().to_path_buf(), on_change).unwrap();
    watch(&state, d.path().to_path_buf(), |_| {}).unwrap();
    assert_eq!(watched(&state), [d.path().to_path_buf()]);
    // Still reported once per change, through the first callback.
    put(&d.join("a.txt"), "x");
    assert!(reported(&rx, d.path(), TIMEOUT));
}

#[test]
fn a_failed_watch_is_not_recorded_and_can_be_retried() {
    let d = Scratch::new("watch-retry");
    let later = d.join("later");
    let (state, on_change, rx) = watcher();
    assert!(watch(&state, later.clone(), on_change).is_err());
    assert!(watched(&state).is_empty());

    std::fs::create_dir(&later).unwrap();
    watch(&state, later.clone(), |_| {}).unwrap();
    assert_eq!(watched(&state), std::slice::from_ref(&later));
    // The debouncer made by the failed call is kept, with its callback.
    put(&later.join("a.txt"), "x");
    assert!(reported(&rx, &later, TIMEOUT));
}

#[test]
fn unwatch_stops_reports() {
    let d = Scratch::new("watch-stop");
    let (state, on_change, rx) = watcher();
    watch(&state, d.path().to_path_buf(), on_change).unwrap();
    unwatch(&state, d.path().to_path_buf()).unwrap();
    assert!(watched(&state).is_empty());
    put(&d.join("a.txt"), "x");
    assert!(!reported(&rx, d.path(), QUIET));
    // Unwatching something never watched is fine.
    unwatch(&state, d.join("never")).unwrap();
}

#[test]
fn subfolders_are_not_watched() {
    let d = Scratch::new("watch-shallow");
    std::fs::create_dir(d.join("sub")).unwrap();
    let (state, on_change, rx) = watcher();
    watch(&state, d.path().to_path_buf(), on_change).unwrap();
    put(&d.join("sub/deep.txt"), "x");
    assert!(!reported(&rx, &d.join("sub"), QUIET));
}
