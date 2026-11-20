//! Preferences → Integration on Linux, by the XDG specs (any desktop):
//!
//! - **Open folders with glasshouse:** a hidden desktop entry,
//!   `glasshouse-folders.desktop` in `$XDG_DATA_HOME/applications`, made the
//!   `inode/directory` default in `$XDG_CONFIG_HOME/mimeapps.list`, and in
//!   any `$XDG_CONFIG_HOME/<desktop>-mimeapps.list` that sets one (those
//!   win over mimeapps.list). What each list had is kept in
//!   `integration.json` and put back when it's turned off.
//! - **Show files for other apps:** a user D-Bus service file for
//!   `org.freedesktop.FileManager1` in `$XDG_DATA_HOME/dbus-1/services`,
//!   which the bus prefers to the system's in `/usr/share`.
//!
//! Both point at the running binary (`startup::self_exe`: the AppImage
//! itself for an AppImage). The text work is pure and tested on every
//! platform. See docs/decisions/2026-11-20-folder-handler-integration.md.
#![cfg_attr(not(unix), allow(dead_code))]

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::xdg_apps::{parse_entry, AppIndex, MimeDb, XdgDirs};

pub(crate) const FOLDER_MIME: &str = "inode/directory";
pub(crate) const FILE_MANAGER_NAME: &str = "org.freedesktop.FileManager1";
pub(crate) const DESKTOP_ID: &str = "glasshouse-folders.desktop";
const DEFAULTS_GROUP: &str = "[Default Applications]";
/// The app identifier in tauri.conf.json, which names the app config dir.
const APP_ID: &str = "sh.glasshouse.viles";
/// Marks the files we write, so turning off never removes someone else's.
const ENTRY_MARK: &str = "X-Glasshouse-Integration=folders";
const SERVICE_MARK: &str = "# Written by glasshouse";
const SERVICE_FILE: &str = "org.freedesktop.FileManager1.service";

/// Where the integration's files go.
pub(crate) struct Places {
    pub xdg: XdgDirs,
    /// The app config dir, for `integration.json`.
    pub state_dir: PathBuf,
}

impl Places {
    pub fn from_env() -> Option<Self> {
        let xdg = XdgDirs::from_env()?;
        let state_dir = xdg.config_home.join(APP_ID);
        Some(Places { xdg, state_dir })
    }

    fn entry_path(&self) -> PathBuf {
        self.xdg.data_home.join("applications").join(DESKTOP_ID)
    }

    pub fn service_path(&self) -> PathBuf {
        self.xdg.data_home.join("dbus-1/services").join(SERVICE_FILE)
    }

    fn state_path(&self) -> PathBuf {
        self.state_dir.join("integration.json")
    }

    /// mimeapps.list, then each desktop-specific list in the user's config
    /// dir that sets a folder default: it would win over the plain one.
    fn lists_to_set(&self) -> Vec<PathBuf> {
        let mut out = vec![self.xdg.config_home.join("mimeapps.list")];
        for d in &self.xdg.desktops {
            let p = self.xdg.config_home.join(format!("{d}-mimeapps.list"));
            let sets = std::fs::read_to_string(&p).is_ok_and(|t| current_default(&t, FOLDER_MIME).is_some());
            if sets && !out.contains(&p) {
                out.push(p);
            }
        }
        out
    }
}

// ---------- mimeapps.list text ----------

/// The `[Default Applications]` value for `mime` as written, if any.
pub(crate) fn current_default(text: &str, mime: &str) -> Option<String> {
    let lines: Vec<&str> = text.lines().collect();
    let (start, end) = group_span(&lines)?;
    lines[start + 1..end].iter().find_map(|l| key_value(l, mime))
}

/// The first desktop ID of a value (`a.desktop;b.desktop;`).
fn first_id(value: &str) -> &str {
    value.split(';').map(str::trim).find(|s| !s.is_empty()).unwrap_or("")
}

/// `[Default Applications]`'s header line and the line after its last one.
fn group_span(lines: &[&str]) -> Option<(usize, usize)> {
    let start = lines.iter().position(|l| l.trim() == DEFAULTS_GROUP)?;
    let end = lines[start + 1..]
        .iter()
        .position(|l| l.trim_start().starts_with('['))
        .map_or(lines.len(), |i| start + 1 + i);
    Some((start, end))
}

/// The value of `line` if it's `key=value`.
fn key_value(line: &str, key: &str) -> Option<String> {
    let (k, v) = line.split_once('=')?;
    (k.trim() == key && !line.trim_start().starts_with('#')).then(|| v.trim().to_string())
}

fn join_lines(lines: &[String], trailing_newline: bool) -> String {
    let mut s = lines.join("\n");
    if trailing_newline && !lines.is_empty() {
        s.push('\n');
    }
    s
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) struct SetDefault {
    pub text: String,
    /// The value it replaced; None if there was no line.
    pub previous: Option<String>,
    /// `[Default Applications]` was added.
    pub created_group: bool,
}

/// `text` with `mime`'s default set to `value`. Every other line stays as
/// it was.
pub(crate) fn set_default(text: &str, mime: &str, value: &str) -> SetDefault {
    let mut lines: Vec<String> = text.lines().map(String::from).collect();
    let line = format!("{mime}={value}");
    let refs: Vec<&str> = lines.iter().map(String::as_str).collect();
    match group_span(&refs) {
        Some((start, end)) => {
            let found = (start + 1..end).find_map(|i| key_value(&lines[i], mime).map(|v| (i, v)));
            let previous = match found {
                Some((i, v)) => {
                    lines[i] = line;
                    Some(v)
                }
                None => {
                    lines.insert(start + 1, line);
                    None
                }
            };
            SetDefault { text: join_lines(&lines, true), previous, created_group: false }
        }
        None => {
            if lines.last().is_some_and(|l| !l.trim().is_empty()) {
                lines.push(String::new());
            }
            lines.push(DEFAULTS_GROUP.to_string());
            lines.push(line);
            SetDefault { text: join_lines(&lines, true), previous: None, created_group: true }
        }
    }
}

/// `text` with `mime`'s default put back to `previous` (or its line
/// removed), when it's still `ours`; None when it isn't, so it's left as
/// the user has since set it. `drop_group` also removes the group when we
/// added it and nothing else is in it now.
pub(crate) fn restore_default(text: &str, mime: &str, ours: &str, previous: Option<&str>, drop_group: bool) -> Option<String> {
    let mut lines: Vec<String> = text.lines().map(String::from).collect();
    let refs: Vec<&str> = lines.iter().map(String::as_str).collect();
    let (start, end) = group_span(&refs)?;
    let (i, v) = (start + 1..end).find_map(|i| key_value(&lines[i], mime).map(|v| (i, v)))?;
    if first_id(&v) != ours {
        return None;
    }
    match previous {
        Some(p) => lines[i] = format!("{mime}={p}"),
        None => {
            lines.remove(i);
            let end = end - 1;
            let empty = lines[start + 1..end].iter().all(|l| l.trim().is_empty());
            if drop_group && empty {
                lines.drain(start..end);
                // The blank line set_default put before the group.
                if start > 0 && start == lines.len() && lines[start - 1].trim().is_empty() {
                    lines.pop();
                }
            }
        }
    }
    Some(join_lines(&lines, true))
}

// ---------- the files we write ----------

/// `s` as one quoted `Exec` argument (Desktop Entry spec: `"`, `` ` ``, `$`
/// and `\` escaped inside the quotes, `%` doubled, then the string value's
/// own `\` escape).
fn exec_quote(s: &str) -> String {
    let mut q = String::from("\"");
    for c in s.chars() {
        match c {
            '"' | '`' | '$' => {
                q.push('\\');
                q.push(c);
            }
            '\\' => q.push_str("\\\\"),
            '%' => q.push_str("%%"),
            c => q.push(c),
        }
    }
    q.push('"');
    q.replace('\\', "\\\\")
}

/// `s` as one `Exec` argument: as it is when nothing in it needs quoting,
/// else `exec_quote`d. Bare matters: xdg-open's generic mode (no desktop
/// environment: sway, Hyprland, niri…) takes the Exec line's first word
/// as is, quotes and all, so it can't start a quoted program.
fn exec_arg(s: &str) -> String {
    const RESERVED: &str = " \t\n\"'\\><~|&;$*?#()`%";
    if s.is_empty() || s.contains(|c| RESERVED.contains(c)) {
        exec_quote(s)
    } else {
        s.to_string()
    }
}

fn checked_path(exe: &Path) -> Result<&str, String> {
    let s = exe.to_str().ok_or_else(|| format!("glasshouse's path isn't UTF-8: {}", exe.display()))?;
    if s.chars().any(char::is_control) {
        return Err(format!("glasshouse's path has control characters: {s:?}"));
    }
    Ok(s)
}

/// The hidden desktop entry that opens folders with `exe`. `TryExec`: if
/// the binary goes away (an uninstalled .deb, a deleted AppImage), GLib
/// and KDE skip the entry and folders open with the next app.
pub(crate) fn folders_entry(exe: &Path) -> Result<String, String> {
    let s = checked_path(exe)?;
    Ok(format!(
        "[Desktop Entry]\n\
         Type=Application\n\
         Name=glasshouse\n\
         GenericName=File Manager\n\
         Comment=Open folders in glasshouse (Preferences → Integration; turning it off removes this file)\n\
         Exec={} %U\n\
         TryExec={}\n\
         Icon=glasshouse\n\
         Terminal=false\n\
         NoDisplay=true\n\
         StartupNotify=true\n\
         StartupWMClass=glasshouse\n\
         MimeType={FOLDER_MIME};\n\
         {ENTRY_MARK}\n",
        exec_arg(s),
        s.replace('\\', "\\\\"),
    ))
}

/// The user D-Bus service file that starts `exe --dbus file-manager`. The
/// bus splits `Exec` like a shell: single quotes keep the path whole.
pub(crate) fn service_file(exe: &Path) -> Result<String, String> {
    let s = checked_path(exe)?;
    if s.contains('\\') {
        return Err(format!("glasshouse's path has a backslash: {s}"));
    }
    Ok(format!(
        "{SERVICE_MARK} (Preferences → Integration → Show files for other apps).\n\
         # Turning that off removes this file.\n\
         [D-BUS Service]\n\
         Name={}\n\
         Exec='{}' --dbus file-manager\n",
        FILE_MANAGER_NAME,
        s.replace('\'', "'\\''"),
    ))
}

// ---------- state ----------

/// What turning folders on changed in one list.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ListChange {
    path: PathBuf,
    previous: Option<String>,
    created_file: bool,
    created_group: bool,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct State {
    #[serde(default)]
    folders: Vec<ListChange>,
}

fn read_state(p: &Places) -> State {
    std::fs::read_to_string(p.state_path())
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default()
}

fn write_state(p: &Places, s: &State) -> Result<(), String> {
    let body = serde_json::to_string_pretty(s).map_err(|e| e.to_string())?;
    write_atomic(&p.state_path(), &body)
}

/// Writes `path` through a temp file and a rename. A symlink (a dotfiles
/// repo) is written through, so it stays a link; the file keeps its mode.
fn write_atomic(path: &Path, body: &str) -> Result<(), String> {
    use std::io::Write;
    let target = match std::fs::symlink_metadata(path) {
        Ok(m) if m.file_type().is_symlink() => {
            std::fs::canonicalize(path).map_err(|e| format!("{}: {e}", path.display()))?
        }
        _ => path.to_path_buf(),
    };
    let dir = target.parent().ok_or_else(|| format!("no folder for {}", target.display()))?;
    std::fs::create_dir_all(dir).map_err(|e| format!("mkdir {}: {e}", dir.display()))?;
    let name = target.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let tmp = dir.join(format!(".{name}.glasshouse-tmp"));
    let written = std::fs::File::create(&tmp).and_then(|mut f| {
        f.write_all(body.as_bytes())?;
        if let Ok(old) = std::fs::metadata(&target) {
            f.set_permissions(old.permissions())?;
        }
        f.sync_all()
    });
    if let Err(e) = written {
        let _ = std::fs::remove_file(&tmp);
        return Err(format!("write {}: {e}", target.display()));
    }
    std::fs::rename(&tmp, &target).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        format!("write {}: {e}", target.display())
    })
}

fn read_or_empty(path: &Path) -> Result<Option<String>, String> {
    match std::fs::read_to_string(path) {
        Ok(t) => Ok(Some(t)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("{}: {e}", path.display())),
    }
}

/// Removes `path` if it's a file we wrote (it has `mark`).
fn remove_ours(path: &Path, mark: &str) -> Result<(), String> {
    match std::fs::read_to_string(path) {
        Ok(t) if t.contains(mark) => std::fs::remove_file(path).map_err(|e| format!("{}: {e}", path.display())),
        Ok(_) => Err(format!("{} wasn't written by glasshouse; leaving it", path.display())),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("{}: {e}", path.display())),
    }
}

fn is_ours(path: &Path, mark: &str) -> bool {
    std::fs::read_to_string(path).is_ok_and(|t| t.contains(mark))
}

/// GLib lists an app for a type in its Open With lists from the folder's
/// `mimeinfo.cache`; the default in mimeapps.list works without one. A
/// cache that's there is rebuilt, so it names our entry while that exists
/// and not after; none is made. Best effort: without
/// update-desktop-database, nothing changes.
fn refresh_mime_cache(dir: &Path) {
    if !dir.join("mimeinfo.cache").is_file() {
        return;
    }
    let _ = std::process::Command::new("update-desktop-database")
        .arg("-q")
        .arg(dir)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status();
}

// ---------- folders ----------

pub(crate) fn folders_on(p: &Places, exe: &Path) -> Result<(), String> {
    let entry = p.entry_path();
    if entry.exists() && !is_ours(&entry, ENTRY_MARK) {
        return Err(format!("{} wasn't written by glasshouse; leaving it", entry.display()));
    }
    write_atomic(&entry, &folders_entry(exe)?)?;
    if let Some(dir) = entry.parent() {
        refresh_mime_cache(dir);
    }
    let mut state = read_state(p);
    for list in p.lists_to_set() {
        let text = read_or_empty(&list)?;
        let edit = set_default(text.as_deref().unwrap_or(""), FOLDER_MIME, DESKTOP_ID);
        let earlier = state.folders.iter().position(|c| c.path == list);
        // Already ours: keep what was there before we first set it.
        if edit.previous.as_deref().is_some_and(|v| first_id(v) == DESKTOP_ID) {
            if earlier.is_none() {
                state.folders.push(ListChange { path: list, previous: None, created_file: false, created_group: false });
            }
            continue;
        }
        write_atomic(&list, &edit.text)?;
        let change = ListChange {
            path: list,
            previous: edit.previous,
            created_file: text.is_none(),
            created_group: edit.created_group,
        };
        match earlier {
            Some(i) => state.folders[i] = change,
            None => state.folders.push(change),
        }
    }
    write_state(p, &state)
}

pub(crate) fn folders_off(p: &Places) -> Result<(), String> {
    let mut state = read_state(p);
    // With no record (a lost state file), still take our default back out.
    let changes = if state.folders.is_empty() {
        p.lists_to_set()
            .into_iter()
            .map(|path| ListChange { path, previous: None, created_file: false, created_group: false })
            .collect()
    } else {
        std::mem::take(&mut state.folders)
    };
    let mut errors = Vec::new();
    for c in changes {
        let Ok(Some(text)) = read_or_empty(&c.path) else { continue };
        let Some(restored) = restore_default(&text, FOLDER_MIME, DESKTOP_ID, c.previous.as_deref(), c.created_group) else {
            continue;
        };
        let done = if c.created_file && restored.trim().is_empty() {
            std::fs::remove_file(&c.path).map_err(|e| format!("{}: {e}", c.path.display()))
        } else {
            write_atomic(&c.path, &restored)
        };
        if let Err(e) = done {
            errors.push(e);
            state.folders.push(c);
        }
    }
    let entry = p.entry_path();
    if let Err(e) = remove_ours(&entry, ENTRY_MARK) {
        errors.push(e);
    }
    if let Some(dir) = entry.parent() {
        refresh_mime_cache(dir);
    }
    write_state(p, &state)?;
    if errors.is_empty() { Ok(()) } else { Err(errors.join("\n")) }
}

pub(crate) fn folders_enabled(p: &Places) -> bool {
    is_ours(&p.entry_path(), ENTRY_MARK)
}

/// The program our folders entry starts (its `TryExec`), when it's ours.
pub(crate) fn folders_program(p: &Places) -> Option<String> {
    let path = p.entry_path();
    let text = std::fs::read_to_string(&path).ok().filter(|t| t.contains(ENTRY_MARK))?;
    parse_entry(DESKTOP_ID, &path, &text, &[]).try_exec
}

/// Which app opens folders now, as the mime-apps spec picks it, and in
/// which file that's set (None: no list sets one, so it's the first app
/// whose entry takes folders).
pub(crate) fn folder_default(p: &Places) -> Option<(String, String, Option<PathBuf>)> {
    let db = MimeDb::load(&p.xdg);
    let index = AppIndex::load(&p.xdg, &db);
    for list in p.xdg.mimeapps_lists() {
        let Ok(text) = std::fs::read_to_string(&list) else { continue };
        let Some(v) = current_default(&text, FOLDER_MIME) else { continue };
        for id in v.split(';').map(str::trim).filter(|s| !s.is_empty()) {
            if let Some(e) = index.get(id) {
                return Some((e.id.clone(), e.name.clone(), Some(list)));
            }
        }
    }
    index
        .default_for(&[FOLDER_MIME.to_string()])
        .map(|e| (e.id.clone(), e.name.clone(), None))
}

// ---------- the FileManager1 service file ----------

pub(crate) fn service_on(p: &Places, exe: &Path) -> Result<(), String> {
    let path = p.service_path();
    if path.exists() && !is_ours(&path, SERVICE_MARK) {
        return Err(format!("{} belongs to another program; remove it first", path.display()));
    }
    write_atomic(&path, &service_file(exe)?)
}

pub(crate) fn service_off(p: &Places) -> Result<(), String> {
    remove_ours(&p.service_path(), SERVICE_MARK)
}

pub(crate) fn service_enabled(p: &Places) -> bool {
    is_ours(&p.service_path(), SERVICE_MARK)
}

/// The program our service file starts, when it's ours.
pub(crate) fn service_program(p: &Places) -> Option<String> {
    let text = std::fs::read_to_string(p.service_path()).ok().filter(|t| t.contains(SERVICE_MARK))?;
    let quoted = text.lines().find_map(|l| l.strip_prefix("Exec='")?.strip_suffix("' --dbus file-manager"))?;
    Some(quoted.replace("'\\''", "'"))
}

#[cfg(test)]
#[path = "integration_xdg_tests.rs"]
mod tests;
