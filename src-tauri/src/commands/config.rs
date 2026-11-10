use serde::de::DeserializeOwned;
use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

// ---------- pins / tags persistence ----------

fn config_file(app: &AppHandle, name: &str) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("app_config_dir: {}", e))?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("mkdir {}: {}", dir.display(), e))?;
    Ok(dir.join(name))
}

/// Write a config file via temp-file + rename so a crash mid-write can't
/// truncate existing state (fs::write truncates before writing).
fn write_config_atomic(path: &Path, body: &str) -> Result<(), String> {
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, body).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, path).map_err(|e| e.to_string())
}

/// Read config file `name` as JSON; a missing file reads as `T::default()`.
fn read_json<T: DeserializeOwned + Default>(app: &AppHandle, name: &str) -> Result<T, String> {
    let path = config_file(app, name)?;
    match std::fs::read_to_string(&path) {
        Ok(s) => serde_json::from_str::<T>(&s).map_err(|e| e.to_string()),
        Err(ref e) if e.kind() == std::io::ErrorKind::NotFound => Ok(T::default()),
        Err(e) => Err(e.to_string()),
    }
}

/// Write `value` to config file `name` as JSON, atomically.
fn write_json<T: Serialize>(app: &AppHandle, name: &str, value: &T) -> Result<(), String> {
    let path = config_file(app, name)?;
    let body = serde_json::to_string(value).map_err(|e| e.to_string())?;
    write_config_atomic(&path, &body)
}

#[tauri::command]
pub fn read_pins(app: AppHandle) -> Result<Vec<String>, String> {
    read_json(&app, "pins.json")
}

#[tauri::command]
pub fn write_pins(app: AppHandle, pins: Vec<String>) -> Result<(), String> {
    write_json(&app, "pins.json", &pins)
}

#[tauri::command]
pub fn read_tags(app: AppHandle) -> Result<HashMap<String, Vec<String>>, String> {
    read_json(&app, "tags.json")
}

#[tauri::command]
pub fn write_tags(app: AppHandle, tags: HashMap<String, Vec<String>>) -> Result<(), String> {
    write_json(&app, "tags.json", &tags)
}

// ---------- recent-paths persistence ----------

const RECENT_MAX: usize = 20;

#[tauri::command]
pub fn read_recent(app: AppHandle) -> Result<Vec<String>, String> {
    read_json(&app, "recent.json")
}

#[tauri::command]
pub fn append_recent(app: AppHandle, path: String) -> Result<(), String> {
    let cfg = config_file(&app, "recent.json")?;
    let mut list: Vec<String> = match std::fs::read_to_string(&cfg) {
        Ok(s) => serde_json::from_str::<Vec<String>>(&s).unwrap_or_default(),
        Err(_) => Vec::new(),
    };
    list.retain(|p| p != &path);
    list.insert(0, path);
    if list.len() > RECENT_MAX {
        list.truncate(RECENT_MAX);
    }
    let body = serde_json::to_string(&list).map_err(|e| e.to_string())?;
    write_config_atomic(&cfg, &body)
}

#[tauri::command]
pub fn clear_recent(app: AppHandle) -> Result<(), String> {
    write_json(&app, "recent.json", &Vec::<String>::new())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::testing::temp_dir;

    #[test]
    fn write_config_atomic_writes_and_replaces() {
        let dir = temp_dir("atomic");
        let target = dir.join("pins.json");
        write_config_atomic(&target, "[1]").unwrap();
        assert_eq!(std::fs::read_to_string(&target).unwrap(), "[1]");
        write_config_atomic(&target, "[1,2]").unwrap();
        assert_eq!(std::fs::read_to_string(&target).unwrap(), "[1,2]");
        // no stray tmp file left behind
        assert!(!dir.join("pins.json.tmp").exists());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
