use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;

use notify::{RecommendedWatcher, RecursiveMode};
use notify_debouncer_full::{new_debouncer, DebouncedEvent, Debouncer, RecommendedCache};
use tauri::{AppHandle, Emitter, State};

#[derive(Default)]
pub struct WatcherState {
    pub debouncer: Mutex<Option<Debouncer<RecommendedWatcher, RecommendedCache>>>,
    pub watched: Mutex<HashSet<PathBuf>>,
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
fn watch(
    state: &WatcherState,
    pb: PathBuf,
    on_change: impl Fn(String) + Send + 'static,
) -> Result<(), String> {
    // Hold the watched-set lock for the whole registration so the path is
    // only recorded after deb.watch() succeeds — inserting up front meant a
    // failed watch left the path marked as watched forever, and every later
    // watch_dir returned Ok without ever retrying.
    let mut watched = state.watched.lock().map_err(|e| e.to_string())?;
    if watched.contains(&pb) {
        return Ok(());
    }

    let mut guard = state.debouncer.lock().map_err(|e| e.to_string())?;
    if guard.is_none() {
        let debouncer = new_debouncer(
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
        )
        .map_err(|e| e.to_string())?;
        *guard = Some(debouncer);
    }

    if let Some(deb) = guard.as_mut() {
        deb.watch(&pb, RecursiveMode::NonRecursive)
            .map_err(|e| e.to_string())?;
    }
    watched.insert(pb);

    Ok(())
}

#[tauri::command]
pub fn unwatch_dir(
    state: State<'_, WatcherState>,
    path: String,
) -> Result<(), String> {
    unwatch(&state, PathBuf::from(&path))
}

fn unwatch(state: &WatcherState, pb: PathBuf) -> Result<(), String> {
    {
        let mut watched = state.watched.lock().map_err(|e| e.to_string())?;
        watched.remove(&pb);
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
