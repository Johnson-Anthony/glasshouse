//! Folder watching for every window: each `watch_dir` is counted per
//! (window, folder), one OS watch serves every count on a folder, and
//! `fs-changed` goes only to the windows watching the folder it names.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

use notify::{Config, RecommendedWatcher, RecursiveMode, Watcher};
use notify_debouncer_full::{new_debouncer_opt, DebouncedEvent, Debouncer, NoCache};
use tauri::{Emitter, EventTarget, Manager, State, WebviewWindow};

/// The debouncer keeps no file-ID cache. Its default one (on Windows and
/// macOS) walks a folder and reads every entry's ID when it's watched, and
/// on Windows that opens each file: a 50k-entry or SMB folder froze the UI,
/// since `watch_dir` runs on the main thread. The cache only serves to
/// stitch a rename's two halves into one event, and `watch` reports the
/// folders events are in, which both halves already give.
type FolderDebouncer = Debouncer<PathEvents, NoCache>;

/// The OS watcher, without the events that name no path. On Linux an
/// inotify event read after its watch was removed comes through with none:
/// a folder opened or changed just as its tab moved on, which every
/// listing of a subfolder does to the folder above. notify-debouncer-full
/// 0.4 indexes `paths[0]` of every event, so its thread panicked holding
/// its lock, and the next `watch_dir` or `unwatch_dir`, on the main thread,
/// panicked on the poisoned lock and aborted the app.
pub struct PathEvents(RecommendedWatcher);

impl Watcher for PathEvents {
    fn new<F: notify::EventHandler>(mut handler: F, config: Config) -> notify::Result<Self> {
        let pathful = move |result: notify::Result<notify::Event>| {
            if has_path(&result) {
                handler.handle_event(result);
            }
        };
        RecommendedWatcher::new(pathful, config).map(Self)
    }

    fn watch(&mut self, path: &Path, mode: RecursiveMode) -> notify::Result<()> {
        self.0.watch(path, mode)
    }

    fn unwatch(&mut self, path: &Path) -> notify::Result<()> {
        self.0.unwatch(path)
    }

    fn configure(&mut self, option: Config) -> notify::Result<bool> {
        self.0.configure(option)
    }

    fn kind() -> notify::WatcherKind {
        RecommendedWatcher::kind()
    }
}

/// What the debouncer can take: an error, a rescan request (it reads no
/// path of those), or an event with a path.
fn has_path(result: &notify::Result<notify::Event>) -> bool {
    match result {
        Ok(event) => event.need_rescan() || !event.paths.is_empty(),
        Err(_) => true,
    }
}

#[derive(Default)]
pub struct WatcherState {
    pub debouncer: Mutex<Option<FolderDebouncer>>,
    pub watched: Mutex<HashMap<PathBuf, Registration>>,
}

/// One folder's `watch_dir` calls that no `unwatch_dir` has matched yet,
/// counted whether or not they succeeded: every caller (a tab, `state.ts`)
/// unwatches what it watched, failed or not. `active` says whether the OS
/// watch is set; the next `watch_dir` retries it while it isn't.
#[derive(Default)]
pub struct Registration {
    count: usize,
    active: bool,
    /// Each window's share of `count`, by label.
    windows: HashMap<String, usize>,
}

#[tauri::command]
pub fn watch_dir(
    window: WebviewWindow,
    state: State<'_, WatcherState>,
    path: String,
) -> Result<(), String> {
    let app = window.app_handle().clone();
    watch(&state, window.label(), PathBuf::from(&path), move |dir| {
        for label in app.state::<WatcherState>().windows_watching(Path::new(&dir)) {
            if let Err(e) = app.emit_to(EventTarget::webview_window(&label), "fs-changed", &dir) {
                log::warn!("fs-changed emit failed: {}", e);
            }
        }
    })
}

impl WatcherState {
    /// The windows with a watch on `dir`, the folder a change was in.
    pub fn windows_watching(&self, dir: &Path) -> Vec<String> {
        let watched = crate::lock(&self.watched);
        let mut out: Vec<String> = Vec::new();
        for reg in watched.iter().filter(|(p, _)| same_dir(p, dir)).map(|(_, r)| r) {
            for (label, n) in &reg.windows {
                if *n > 0 && !out.contains(label) {
                    out.push(label.clone());
                }
            }
        }
        out
    }

    /// Drops every watch the window `label` holds: it closed, or its page
    /// loaded again and forgot them. Returns how many there were.
    pub fn unwatch_window(&self, label: &str) -> usize {
        unwatch_window(self, label)
    }
}

/// Whether two folder paths name the same folder as the frontend compares
/// them: case-insensitively on Windows. A trailing separator doesn't count
/// (`Path` compares components).
fn same_dir(a: &Path, b: &Path) -> bool {
    a == b || (cfg!(windows) && a.to_string_lossy().to_lowercase() == b.to_string_lossy().to_lowercase())
}

/// Watch folder `pb` (not its subfolders). Changes are reported, 300 ms
/// debounced, as the folder each changed path is in. `on_change` is used
/// only by the call that creates `state`'s debouncer, the first one.
/// Each call needs one `unwatch` from the same window: two tabs on one
/// folder share its watch, also in two windows, and it stops when the last
/// of them leaves.
fn watch(
    state: &WatcherState,
    window: &str,
    pb: PathBuf,
    on_change: impl Fn(String) + Send + 'static,
) -> Result<(), String> {
    // Hold the registrations lock for the whole call, so `active` is only
    // set after deb.watch() succeeds. A failed watch used to be recorded as
    // watched, and every later watch_dir returned Ok without retrying.
    let mut watched = state.watched.lock().map_err(|e| e.to_string())?;
    let reg = watched.entry(pb.clone()).or_default();
    reg.count += 1;
    *reg.windows.entry(window.to_string()).or_default() += 1;
    if reg.active {
        return Ok(());
    }

    let mut guard = state.debouncer.lock().map_err(|e| e.to_string())?;
    if guard.is_none() {
        let debouncer = new_debouncer_opt::<_, PathEvents, NoCache>(
            Duration::from_millis(300),
            None,
            move |result: notify_debouncer_full::DebounceEventResult| match result {
                Ok(events) => {
                    let mut parents: HashSet<PathBuf> = HashSet::new();
                    for DebouncedEvent { event, .. } in events {
                        for p in event.paths {
                            if let Some(parent) = p.parent() {
                                parents.insert(parent.to_path_buf());
                            } else {
                                parents.insert(p);
                            }
                        }
                    }
                    for parent in parents {
                        if let Some(s) = parent.to_str() {
                            on_change(s.to_string());
                        }
                    }
                }
                Err(errors) => {
                    for e in errors {
                        log::warn!("watching folders: {}", e);
                    }
                }
            },
            NoCache,
            Config::default(),
        )
        .map_err(|e| e.to_string())?;
        *guard = Some(debouncer);
    }

    if let Some(deb) = guard.as_mut() {
        deb.watch(&pb, RecursiveMode::NonRecursive)
            .map_err(|e| e.to_string())?;
        reg.active = true;
    }

    Ok(())
}

#[tauri::command]
pub fn unwatch_dir(
    window: WebviewWindow,
    state: State<'_, WatcherState>,
    path: String,
) -> Result<(), String> {
    unwatch(&state, window.label(), PathBuf::from(&path))
}

/// Match one `watch` of `pb` by `window`. The OS watch goes when the last
/// one is matched; an unmatched `unwatch` (none of that window's left) does
/// nothing. The registrations lock is held throughout, so a `watch` can't
/// slip in between the count reaching zero and the OS watch going.
fn unwatch(state: &WatcherState, window: &str, pb: PathBuf) -> Result<(), String> {
    let mut watched = state.watched.lock().map_err(|e| e.to_string())?;
    let Some(reg) = watched.get_mut(&pb) else {
        return Ok(());
    };
    match reg.windows.get_mut(window) {
        Some(n) if *n > 1 => *n -= 1,
        Some(_) => {
            reg.windows.remove(window);
        }
        None => return Ok(()),
    }
    reg.count -= 1;
    if reg.count > 0 {
        return Ok(());
    }
    let was_active = reg.active;
    watched.remove(&pb);
    if was_active {
        drop_os_watch(state, &pb)?;
    }
    Ok(())
}

/// Every watch `window` holds goes, as if it had unwatched each.
fn unwatch_window(state: &WatcherState, window: &str) -> usize {
    let mut watched = crate::lock(&state.watched);
    let mut dropped = 0;
    let mut gone = Vec::new();
    for (pb, reg) in watched.iter_mut() {
        let Some(n) = reg.windows.remove(window) else { continue };
        dropped += n;
        reg.count -= n;
        if reg.count == 0 {
            gone.push((pb.clone(), reg.active));
        }
    }
    for (pb, active) in gone {
        watched.remove(&pb);
        if active {
            let _ = drop_os_watch(state, &pb);
        }
    }
    dropped
}

/// Stops the OS watch on `pb`. The caller holds the registrations lock.
fn drop_os_watch(state: &WatcherState, pb: &Path) -> Result<(), String> {
    let mut guard = state.debouncer.lock().map_err(|e| e.to_string())?;
    if let Some(deb) = guard.as_mut() {
        if let Err(e) = deb.unwatch(pb) {
            log::warn!("unwatch failed for {:?}: {}", pb, e);
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests;
