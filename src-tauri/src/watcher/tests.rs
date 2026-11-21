// Platform-neutral: these run on the Windows CI job too, which is the only
// place the Windows backend (ReadDirectoryChangesW, with no file-ID cache
// to stitch renames) is exercised.

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

/// Wait until every one of `dirs` is reported, in any order. Other folders
/// may be reported on the way.
fn reports(rx: &mpsc::Receiver<String>, dirs: &[&Path], within: Duration) -> bool {
    let mut want: HashSet<PathBuf> = dirs.iter().map(|d| canon(d)).collect();
    let deadline = std::time::Instant::now() + within;
    while let Some(left) = deadline.checked_duration_since(std::time::Instant::now()) {
        match rx.recv_timeout(left) {
            Ok(got) => {
                want.remove(&canon(Path::new(&got)));
                if want.is_empty() {
                    return true;
                }
            }
            Err(_) => return false,
        }
    }
    false
}

fn reported(rx: &mpsc::Receiver<String>, dir: &Path, within: Duration) -> bool {
    reports(rx, &[dir], within)
}

/// Wait until nothing has been reported for a debounce and a half, and
/// drop what came. One write can be reported twice: its create and its
/// close-write can expire in different debouncer ticks.
fn settle(rx: &mpsc::Receiver<String>) {
    while rx.recv_timeout(Duration::from_millis(450)).is_ok() {}
}

/// Each registered folder with its unmatched watch count and whether its
/// OS watch is set.
fn watched(state: &WatcherState) -> Vec<(PathBuf, usize, bool)> {
    let regs = state.watched.lock().unwrap();
    regs.iter().map(|(p, r)| (p.clone(), r.count, r.active)).collect()
}

#[test]
fn a_new_file_reports_its_folder() {
    let d = Scratch::new("watch-new");
    let (state, on_change, rx) = watcher();
    watch(&state, "w", d.path().to_path_buf(), on_change).unwrap();
    put(&d.join("new.txt"), "x");
    assert!(reported(&rx, d.path(), TIMEOUT));
}

#[test]
fn two_watchers_share_a_folder_until_both_leave() {
    let d = Scratch::new("watch-twice");
    let dir = d.path().to_path_buf();
    let (state, on_change, rx) = watcher();
    watch(&state, "w", dir.clone(), on_change).unwrap();
    watch(&state, "w", dir.clone(), |_| {}).unwrap();
    assert_eq!(watched(&state), [(dir.clone(), 2, true)]);

    // One tab leaves: the other still hears about changes, through the
    // first callback.
    unwatch(&state, "w", dir.clone()).unwrap();
    assert_eq!(watched(&state), [(dir.clone(), 1, true)]);
    put(&d.join("a.txt"), "x");
    assert!(reported(&rx, &dir, TIMEOUT));

    // The last one leaves: the watch goes.
    unwatch(&state, "w", dir.clone()).unwrap();
    assert!(watched(&state).is_empty());
    settle(&rx);
    put(&d.join("b.txt"), "x");
    assert!(!reported(&rx, &dir, QUIET));
}

#[test]
fn a_failed_watch_counts_and_the_next_one_retries() {
    let d = Scratch::new("watch-retry");
    let later = d.join("later");
    let (state, on_change, rx) = watcher();
    assert!(watch(&state, "w", later.clone(), on_change).is_err());
    assert_eq!(watched(&state), [(later.clone(), 1, false)]);

    std::fs::create_dir(&later).unwrap();
    watch(&state, "w", later.clone(), |_| {}).unwrap();
    assert_eq!(watched(&state), [(later.clone(), 2, true)]);

    // The failed call's unwatch matches it, and leaves the second
    // watcher's watch alone.
    unwatch(&state, "w", later.clone()).unwrap();
    assert_eq!(watched(&state), [(later.clone(), 1, true)]);
    // The debouncer made by the failed call is kept, with its callback.
    put(&later.join("a.txt"), "x");
    assert!(reported(&rx, &later, TIMEOUT));
}

#[test]
fn a_failed_watch_alone_unwatches_cleanly() {
    let d = Scratch::new("watch-missing");
    let (state, on_change, _rx) = watcher();
    assert!(watch(&state, "w", d.join("missing"), on_change).is_err());
    unwatch(&state, "w", d.join("missing")).unwrap();
    assert!(watched(&state).is_empty());
}

#[test]
fn unwatch_stops_reports() {
    let d = Scratch::new("watch-stop");
    let (state, on_change, rx) = watcher();
    watch(&state, "w", d.path().to_path_buf(), on_change).unwrap();
    unwatch(&state, "w", d.path().to_path_buf()).unwrap();
    assert!(watched(&state).is_empty());
    put(&d.join("a.txt"), "x");
    assert!(!reported(&rx, d.path(), QUIET));
    // Unwatching something never watched is fine.
    unwatch(&state, "w", d.join("never")).unwrap();
}

#[test]
fn an_extra_unwatch_does_not_take_a_later_watch() {
    let d = Scratch::new("watch-extra");
    let dir = d.path().to_path_buf();
    let (state, on_change, rx) = watcher();
    watch(&state, "w", dir.clone(), on_change).unwrap();
    unwatch(&state, "w", dir.clone()).unwrap();
    unwatch(&state, "w", dir.clone()).unwrap();

    watch(&state, "w", dir.clone(), |_| {}).unwrap();
    assert_eq!(watched(&state), [(dir.clone(), 1, true)]);
    put(&d.join("a.txt"), "x");
    assert!(reported(&rx, &dir, TIMEOUT));
}

#[test]
fn a_move_between_watched_folders_reports_both() {
    // With no file-ID cache, Windows reports the two halves of a move as
    // separate events; each half still names its folder.
    let d = Scratch::new("watch-move");
    let (from, to) = (d.join("from"), d.join("to"));
    put(&from.join("a.txt"), "x");
    std::fs::create_dir(&to).unwrap();
    let (state, on_change, rx) = watcher();
    watch(&state, "w", from.clone(), on_change).unwrap();
    watch(&state, "w", to.clone(), |_| {}).unwrap();

    std::fs::rename(from.join("a.txt"), to.join("b.txt")).unwrap();
    assert!(reports(&rx, &[&from, &to], TIMEOUT));
}

#[test]
fn a_rename_inside_a_folder_reports_it() {
    let d = Scratch::new("watch-rename");
    put(&d.join("a.txt"), "x");
    let (state, on_change, rx) = watcher();
    watch(&state, "w", d.path().to_path_buf(), on_change).unwrap();
    std::fs::rename(d.join("a.txt"), d.join("b.txt")).unwrap();
    assert!(reported(&rx, d.path(), TIMEOUT));
}

#[test]
fn subfolders_are_not_watched() {
    let d = Scratch::new("watch-shallow");
    std::fs::create_dir(d.join("sub")).unwrap();
    let (state, on_change, rx) = watcher();
    watch(&state, "w", d.path().to_path_buf(), on_change).unwrap();
    put(&d.join("sub/deep.txt"), "x");
    assert!(!reported(&rx, &d.join("sub"), QUIET));
}

#[test]
fn each_window_counts_its_own_watches() {
    let d = Scratch::new("watch-windows");
    let (a, b) = (d.join("a"), d.join("b"));
    std::fs::create_dir(&a).unwrap();
    std::fs::create_dir(&b).unwrap();
    let (state, on_change, rx) = watcher();
    watch(&state, "main", a.clone(), on_change).unwrap();
    watch(&state, "main-2", a.clone(), |_| {}).unwrap();
    watch(&state, "main-2", b.clone(), |_| {}).unwrap();
    let mut on_a = state.windows_watching(&a);
    on_a.sort();
    assert_eq!(on_a, ["main", "main-2"]);
    assert_eq!(state.windows_watching(&b), ["main-2"]);
    // A trailing separator names the same folder.
    let mut slash = b.clone().into_os_string();
    slash.push(std::path::MAIN_SEPARATOR_STR);
    assert_eq!(state.windows_watching(Path::new(&slash)), ["main-2"]);
    assert!(state.windows_watching(d.path()).is_empty());

    // An unwatch from a window that has none left there takes nothing.
    unwatch(&state, "main", b.clone()).unwrap();
    assert_eq!(state.windows_watching(&b), ["main-2"]);

    // The second window goes: its watches go, the first's stays and reports.
    assert_eq!(state.unwatch_window("main-2"), 2);
    assert_eq!(watched(&state), [(a.clone(), 1, true)]);
    assert_eq!(state.windows_watching(&a), ["main"]);
    assert_eq!(state.unwatch_window("main-2"), 0);
    put(&a.join("x.txt"), "x");
    assert!(reported(&rx, &a, TIMEOUT));
    settle(&rx);
    put(&b.join("y.txt"), "x");
    assert!(!reported(&rx, &b, QUIET));
}
