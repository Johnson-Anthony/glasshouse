//! What a bug report needs: the log file (Help → Open Log Folder), a panic
//! hook that writes to it before a release build aborts, and the facts
//! about this system that Report Bug… fills in.
//!
//! The log is `glasshouse.log` in the app's log folder, the one Tauri's
//! `app_log_dir` names: `~/.local/share/<APP_ID>/logs` on Linux,
//! `%LOCALAPPDATA%\<APP_ID>\logs` on Windows. It's written through
//! tauri-plugin-log, in the window and chooser processes. Each line carries
//! the process id: New Window starts another process, which appends to the
//! same file. The CLI modes and the resident D-Bus service have no Tauri app
//! and keep writing to stderr only.

use std::io::Write;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};

use serde::Serialize;

use crate::error::{Action, AppError, Kind};
use crate::fatal::{self, Fatal};
use crate::APP_ID;

/// The log file's name without `.log`.
const FILE_STEM: &str = "glasshouse";

/// Set once the main window is up (Tauri's `Ready`): a panic before that is
/// a start that failed, after it a crash.
static STARTED: AtomicBool = AtomicBool::new(false);

/// The log folder, as Tauri's `app_log_dir` picks it; None when the OS says
/// nothing about where app data goes (no HOME).
pub(crate) fn dir() -> Option<PathBuf> {
    #[cfg(target_os = "macos")]
    return dirs::home_dir().map(|h| h.join("Library/Logs").join(APP_ID));
    #[cfg(not(target_os = "macos"))]
    dirs::data_local_dir().map(|d| d.join(APP_ID).join("logs"))
}

fn file() -> Option<PathBuf> {
    dir().map(|d| d.join(format!("{FILE_STEM}.log")))
}

/// The plugin, logging at Info to stderr and, when its folder can be
/// written, to the log file. A log folder that can't be made never stops the
/// app (the plugin would fail the build).
pub(crate) fn plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    use tauri_plugin_log::{Builder, RotationStrategy, Target, TargetKind};
    let mut targets = vec![Target::new(TargetKind::Stderr).filter(|m| m.target() != FILE_ONLY)];
    if let Some(path) = dir().filter(|_| open_file().is_some()) {
        targets.push(Target::new(TargetKind::Folder { path, file_name: Some(FILE_STEM.into()) }));
    }
    let pid = std::process::id();
    Builder::new()
        .targets(targets)
        .level(log::LevelFilter::Info)
        .max_file_size(1_000_000)
        .rotation_strategy(RotationStrategy::KeepSome(2))
        .format(move |out, message, record| {
            out.finish(format_args!("{} [{pid}] {:<5} {}: {message}", now(), record.level(), record.target()))
        })
        .build()
}

/// The log file opened for appending, creating its folder.
fn open_file() -> Option<std::fs::File> {
    let path = file()?;
    std::fs::create_dir_all(path.parent()?).ok()?;
    std::fs::OpenOptions::new().create(true).append(true).open(path).ok()
}

/// UTC, as every line of the log has it.
fn now() -> String {
    let format = time::macros::format_description!("[year]-[month]-[day] [hour]:[minute]:[second]Z");
    time::OffsetDateTime::now_utc().format(&format).unwrap_or_default()
}

/// Whether the plugin's logger is attached: until it is, `log`'s level is
/// Off and its macros go nowhere.
fn logging() -> bool {
    log::max_level() != log::LevelFilter::Off
}

/// `line` as an error in the log: through the logger once it's up, else
/// straight into the file and stderr (a failed start, a panic before the
/// app is built).
pub(crate) fn log_error(line: &str) {
    if logging() {
        log::error!("{line}");
        log::logger().flush();
        return;
    }
    eprintln!("glasshouse: {line}");
    if let Some(mut f) = open_file() {
        let _ = writeln!(f, "{} [{}] ERROR glasshouse: {line}", now(), std::process::id());
    }
}

/// `line` in the log at `level`, or on stderr in a mode with no log (the
/// CLI's `--integration-on`, which shares its code with Preferences).
/// Only Linux's integration code calls it.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
pub(crate) fn note(level: log::Level, line: &str) {
    if logging() {
        log::log!(level, "{line}");
    } else {
        eprintln!("glasshouse: {line}");
    }
}

/// Logs each panic with where it happened, before the default hook prints
/// it. A release build aborts on panic, so there it also shows the user a
/// box saying so, from a new process (`fatal.rs`). The box's own process
/// passes `with_dialog: false`, so a panic there can't start another.
pub(crate) fn install_panic_hook(with_dialog: bool) {
    let default = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let thread = std::thread::current();
        let at = info.location().map(|l| format!(" at {}:{}", l.file(), l.line())).unwrap_or_default();
        let payload = info.payload();
        let what = payload
            .downcast_ref::<&str>()
            .copied()
            .or_else(|| payload.downcast_ref::<String>().map(String::as_str))
            .unwrap_or("(no message)");
        log_error(&format!("panic in thread '{}'{at}: {what}", thread.name().unwrap_or("unnamed")));
        default(info);
        if with_dialog && cfg!(panic = "abort") {
            fatal::show(if STARTED.load(Ordering::Relaxed) { Fatal::Crash } else { Fatal::Startup });
        }
    }));
}

/// The window is up: a panic from now on is a crash, not a failed start.
pub(crate) fn started() {
    STARTED.store(true, Ordering::Relaxed);
}

/// The app couldn't be built: say why in the log, tell the user, and exit.
pub(crate) fn start_failed(e: &tauri::Error) -> ! {
    log_error(&format!("couldn't start: {e}"));
    fatal::show(Fatal::Startup);
    std::process::exit(1)
}

/// The first lines of a run: which build on which system, and what the
/// identifier migration moved.
pub(crate) fn log_start(version: &str, migrated: &[(log::Level, String)]) {
    log::info!("glasshouse {} started: {}", version, report(version).summary());
    for (level, line) in migrated {
        // Not to stderr: the migration printed these there already.
        log::log!(target: FILE_ONLY, *level, "{line}");
    }
}

/// The log target for lines that go to the file but not stderr.
const FILE_ONLY: &str = "migrate";

/// What Report Bug… puts in the issue, and the log's first line: nothing
/// that names the user, the machine or a file.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemReport {
    pub version: String,
    /// The OS's name and version: "Ubuntu 24.04", "Windows 11 (26100)".
    pub os: String,
    pub arch: &'static str,
    /// The desktop and display server on Linux ("GNOME (wayland)").
    pub desktop: Option<String>,
    /// "WebKitGTK 2.50.1" or "WebView2 142.0.3595.53".
    pub webview: Option<String>,
}

impl SystemReport {
    fn summary(&self) -> String {
        let mut parts = vec![self.os.clone(), self.arch.to_string()];
        parts.extend(self.desktop.clone());
        parts.extend(self.webview.clone());
        parts.join(", ")
    }
}

pub(crate) fn report(version: &str) -> SystemReport {
    let os = match (sysinfo::System::name(), sysinfo::System::os_version()) {
        (Some(name), Some(v)) => format!("{name} {v}"),
        (Some(name), None) => name,
        _ => std::env::consts::OS.to_string(),
    };
    SystemReport {
        version: version.to_string(),
        os,
        arch: std::env::consts::ARCH,
        desktop: desktop(|k| std::env::var(k).ok()),
        webview: tauri::webview_version().ok().map(|v| {
            if cfg!(windows) {
                format!("WebView2 {v}")
            } else {
                format!("WebKitGTK {v}")
            }
        }),
    }
}

/// `XDG_CURRENT_DESKTOP` (its first name: "ubuntu:GNOME" is Ubuntu's
/// GNOME) and the session type. None on Windows, where neither is set.
fn desktop(var: impl Fn(&str) -> Option<String>) -> Option<String> {
    let name = var("XDG_CURRENT_DESKTOP").filter(|s| !s.is_empty()).map(|s| s.replace(':', " / "));
    let session = var("XDG_SESSION_TYPE")
        .filter(|s| !s.is_empty() && s != "tty")
        .or_else(|| var("WAYLAND_DISPLAY").filter(|s| !s.is_empty()).map(|_| "wayland".into()))
        .or_else(|| var("DISPLAY").filter(|s| !s.is_empty()).map(|_| "x11".into()));
    match (name, session) {
        (Some(n), Some(s)) => Some(format!("{n} ({s})")),
        (Some(n), None) => Some(n),
        (None, Some(s)) => Some(format!("unknown desktop ({s})")),
        (None, None) => None,
    }
}

/// For Report Bug….
#[tauri::command]
pub fn bug_report_info(app: tauri::AppHandle) -> SystemReport {
    report(&app.package_info().version.to_string())
}

/// The log folder, made if it isn't there yet (Help → Open Log Folder).
#[tauri::command]
pub fn log_dir() -> Result<String, AppError> {
    let dir = dir().ok_or_else(|| {
        AppError::new(Kind::Other, None, "glasshouse has no log folder: the system doesn't say where app data goes.", "no data_local_dir")
    })?;
    std::fs::create_dir_all(&dir).map_err(|e| AppError::io(Action::Create, &dir, &e))?;
    Ok(dir.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn env<'a>(pairs: &'a [(&'a str, &'a str)]) -> impl Fn(&str) -> Option<String> + 'a {
        move |k| pairs.iter().find(|(n, _)| *n == k).map(|(_, v)| v.to_string())
    }

    #[test]
    fn the_log_is_in_the_app_folder_tauri_uses() {
        let dir = dir().unwrap();
        assert!(dir.ends_with(std::path::Path::new(APP_ID).join("logs")), "{}", dir.display());
        #[cfg(not(target_os = "macos"))]
        assert_eq!(dir.parent().unwrap().parent(), dirs::data_local_dir().as_deref());
    }

    #[test]
    fn desktop_names_the_desktop_and_session() {
        assert_eq!(desktop(env(&[("XDG_CURRENT_DESKTOP", "ubuntu:GNOME"), ("XDG_SESSION_TYPE", "wayland")])).as_deref(), Some("ubuntu / GNOME (wayland)"));
        assert_eq!(desktop(env(&[("XDG_CURRENT_DESKTOP", "KDE"), ("DISPLAY", ":0")])).as_deref(), Some("KDE (x11)"));
        assert_eq!(desktop(env(&[("WAYLAND_DISPLAY", "wayland-1")])).as_deref(), Some("unknown desktop (wayland)"));
        assert_eq!(desktop(env(&[])), None);
    }

    #[test]
    fn the_report_names_nothing_personal() {
        let r = report("1.2.3");
        let text = serde_json::to_string(&r).unwrap();
        assert_eq!(r.version, "1.2.3");
        for var in ["HOME", "USERPROFILE", "USER", "USERNAME", "LOGNAME"] {
            if let Some(v) = std::env::var(var).ok().filter(|v| v.len() > 2) {
                assert!(!text.contains(&v), "{var}'s value is in {text}");
            }
        }
        if let Some(host) = sysinfo::System::host_name().filter(|h| h.len() > 2) {
            assert!(!text.contains(&host), "the host name is in {text}");
        }
    }
}
