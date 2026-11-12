use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;

use notify::{Config, RecommendedWatcher, RecursiveMode};
use notify_debouncer_full::{new_debouncer_opt, DebouncedEvent, Debouncer, NoCache};
use tauri::{AppHandle, Emitter, State};

/// The debouncer keeps no file-ID cache. Its default one (on Windows and
/// macOS) walks a folder and reads every entry's ID when it's watched, and
/// on Windows that opens each file: a 50k-entry or SMB folder froze the UI,
/// since `watch_dir` runs on the main thread. The cache only serves to
/// stitch a rename's two halves into one event, and `watch` reports the
/// folders events are in, which both halves already give.
type FolderDebouncer = Debouncer<RecommendedWatcher, NoCache>;

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
}

#[tauri::command]
pub fn watch_dir(
    app: AppHandle,
    state: State<'_, WatcherState>,
    path: String,
) -> Result<(), String> {
    watch(&state, PathBuf::from(&path), move |dir| {
        if let Err(e) = app.emit("fs-changed", dir) {
            eprintln!("fs-changed emit failed: {}", e);
        }
    })
}

/// Watch folder `pb` (not its subfolders). Changes are reported, 300 ms
/// debounced, as the folder each changed path is in. `on_change` is used
/// only by the call that creates `state`'s debouncer, the first one.
/// Each call needs one `unwatch`: two tabs on one folder share its watch,
/// and it stops when the last of them leaves.
fn watch(
    state: &WatcherState,
    pb: PathBuf,
    on_change: impl Fn(String) + Send + 'static,
) -> Result<(), String> {
    // Hold the registrations lock for the whole call, so `active` is only
    // set after deb.watch() succeeds. A failed watch used to be recorded as
    // watched, and every later watch_dir returned Ok without retrying.
    let mut watched = state.watched.lock().map_err(|e| e.to_string())?;
    let reg = watched.entry(pb.clone()).or_default();
    reg.count += 1;
    if reg.active {
        return Ok(());
    }

    let mut guard = state.debouncer.lock().map_err(|e| e.to_string())?;
    if guard.is_none() {
        let debouncer = new_debouncer_opt::<_, RecommendedWatcher, NoCache>(
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
                        eprintln!("notify error: {}", e);
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
    state: State<'_, WatcherState>,
    path: String,
) -> Result<(), String> {
    unwatch(&state, PathBuf::from(&path))
}

/// Match one `watch` of `pb`. The OS watch goes when the last one is
/// matched; an unmatched `unwatch` does nothing. The registrations lock is
/// held throughout, so a `watch` can't slip in between the count reaching
/// zero and the OS watch going.
fn unwatch(state: &WatcherState, pb: PathBuf) -> Result<(), String> {
    let mut watched = state.watched.lock().map_err(|e| e.to_string())?;
    let Some(reg) = watched.get_mut(&pb) else {
        return Ok(());
    };
    reg.count -= 1;
    if reg.count > 0 {
        return Ok(());
    }
    let was_active = reg.active;
    watched.remove(&pb);
    if !was_active {
        return Ok(());
    }

    let mut guard = state.debouncer.lock().map_err(|e| e.to_string())?;
    if let Some(deb) = guard.as_mut() {
        if let Err(e) = deb.unwatch(&pb) {
            eprintln!("unwatch failed for {:?}: {}", pb, e);
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests;
