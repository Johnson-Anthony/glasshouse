use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;

use notify::{RecommendedWatcher, RecursiveMode};
use notify_debouncer_full::{new_debouncer, DebouncedEvent, Debouncer, RecommendedCache};
use tauri::{AppHandle, Emitter, State};

pub struct WatcherState {
    pub debouncer: Mutex<Option<Debouncer<RecommendedWatcher, RecommendedCache>>>,
    pub watched: Mutex<HashSet<PathBuf>>,
}

impl Default for WatcherState {
    fn default() -> Self {
        Self {
            debouncer: Mutex::new(None),
            watched: Mutex::new(HashSet::new()),
        }
    }
}

#[tauri::command]
pub fn watch_dir(
    app: AppHandle,
    state: State<'_, WatcherState>,
    path: String,
) -> Result<(), String> {
    let pb = PathBuf::from(&path);

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
        let app_handle = app.clone();
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
                            if let Err(e) = app_handle.emit("fs-changed", s.to_string()) {
                                eprintln!("fs-changed emit failed: {}", e);
                            }
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
    let pb = PathBuf::from(&path);

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
