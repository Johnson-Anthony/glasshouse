//! What the command line asks for: a window (with paths when another app
//! hands some over), the resident D-Bus mode, or undoing the desktop
//! integration.
//!
//! - `glasshouse [--select | --properties] [--] PATH|URI…` opens a window.
//!   A folder opens in a tab; a file opens its folder with the file
//!   selected. `--select` (FileManager1.ShowItems) selects every item in its
//!   folder, folders too; `--properties` (ShowItemProperties) also opens
//!   Properties. `file://` URIs are accepted for a desktop entry's `%U`.
//! - `glasshouse --dbus SERVICE…` is the resident (`resident.rs`, Linux).
//! - `glasshouse --chooser` is one open or save dialog for another app,
//!   started by the resident with its request on stdin (`chooser.rs`).
//! - `glasshouse --integration-on FEATURE…` (`folders`, `file-manager`)
//!   turns those Preferences → Integration settings on, and
//!   `glasshouse --integration-off` turns them all off; both then exit.
//!   The Windows MSI's uninstall runs the second.
//!
//! Parsing is pure and tested on every platform. See
//! docs/decisions/2026-11-20-folder-handler-processes.md.

use std::ffi::OsString;
use std::path::{Component, Path, PathBuf};

use serde::Serialize;
use tauri::State;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum LaunchMode {
    /// A folder opens; a file opens its folder with it selected.
    Open,
    /// Each item selected in its folder (folders too).
    Select,
    /// As `Select`, then Properties for the first item.
    Properties,
}

/// The paths a window was started with.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchRequest {
    pub mode: LaunchMode,
    /// Absolute, with `.` and `..` worked out (not through links).
    pub paths: Vec<String>,
    /// Arguments that couldn't be used, each with why.
    pub skipped: Vec<String>,
}

#[derive(Debug, PartialEq, Eq)]
pub enum Startup {
    /// A window: `Some` when it was started with paths or URIs.
    Window(Option<LaunchRequest>),
    /// `--dbus SERVICE…`.
    Resident(Vec<String>),
    /// `--integration-on FEATURE…`.
    IntegrationOn(Vec<String>),
    /// `--integration-off [FEATURE…]` (none: every one).
    IntegrationOff(Vec<String>),
    /// `--chooser`: a file chooser dialog (the request comes on stdin).
    Chooser,
}

/// The command line this process was started with.
pub fn from_env() -> Startup {
    let args: Vec<OsString> = std::env::args_os().skip(1).collect();
    let cwd = std::env::current_dir().unwrap_or_default();
    parse(&args, &cwd)
}

/// `args` without the program name; relative paths are taken from `cwd`.
pub fn parse(args: &[OsString], cwd: &Path) -> Startup {
    match args.first().and_then(|a| a.to_str()) {
        Some(flag @ ("--dbus" | "--integration-on" | "--integration-off")) => {
            let names = args[1..].iter().filter_map(|a| a.to_str()).map(String::from).collect();
            return match flag {
                "--dbus" => Startup::Resident(names),
                "--integration-on" => Startup::IntegrationOn(names),
                _ => Startup::IntegrationOff(names),
            };
        }
        Some("--chooser") => return Startup::Chooser,
        _ => {}
    }
    let mut mode = LaunchMode::Open;
    let mut paths = Vec::new();
    let mut skipped = Vec::new();
    let mut operands_only = false;
    for raw in args {
        let Some(arg) = raw.to_str() else {
            skipped.push(format!("{}: not valid UTF-8", raw.to_string_lossy()));
            continue;
        };
        if !operands_only && arg.starts_with('-') && arg.len() > 1 {
            match arg {
                "--" => operands_only = true,
                "--select" => mode = LaunchMode::Select,
                "--properties" => mode = LaunchMode::Properties,
                _ => skipped.push(format!("{arg}: unknown option")),
            }
            continue;
        }
        match operand_path(arg, cwd) {
            Ok(p) => paths.push(p),
            Err(why) => skipped.push(format!("{arg}: {why}")),
        }
    }
    if paths.is_empty() && skipped.is_empty() && mode == LaunchMode::Open {
        return Startup::Window(None);
    }
    Startup::Window(Some(LaunchRequest { mode, paths, skipped }))
}

/// A URI or absolute path from a D-Bus call, as an absolute path.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
pub(crate) fn bus_path(arg: &str) -> Result<String, String> {
    if !has_scheme(arg) && !Path::new(arg).is_absolute() {
        return Err("not a URI or an absolute path".into());
    }
    operand_path(arg, Path::new("/"))
}

/// The program to start for another glasshouse process. An AppImage runs
/// from a mount that goes away when it exits, so that's `$APPIMAGE`, the
/// file itself. A binary replaced while running (a rebuild) reads as
/// `… (deleted)`; the new file at that path is the one to run.
pub(crate) fn self_exe() -> Result<PathBuf, String> {
    if let Some(app) = std::env::var_os("APPIMAGE").map(PathBuf::from) {
        if app.is_absolute() && app.is_file() {
            return Ok(app);
        }
    }
    let exe = std::env::current_exe().map_err(|e| format!("can't tell where glasshouse runs from: {e}"))?;
    if cfg!(target_os = "linux") && !exe.exists() {
        if let Some(live) = exe.to_str().and_then(|s| s.strip_suffix(" (deleted)")) {
            if Path::new(live).is_file() {
                return Ok(PathBuf::from(live));
            }
        }
    }
    Ok(exe)
}

/// One path or URI from the command line, as an absolute path.
fn operand_path(arg: &str, cwd: &Path) -> Result<String, String> {
    let path = if has_scheme(arg) {
        let url = url::Url::parse(arg).map_err(|e| format!("not a valid URI ({e})"))?;
        if url.scheme() != "file" {
            return Err("not a local file".into());
        }
        url.to_file_path().map_err(|_| "not a local file".to_string())?
    } else {
        let arg = if cfg!(windows) { fix_windows_quote(arg) } else { arg.to_string() };
        let p = PathBuf::from(arg);
        if p.is_absolute() { p } else { absolute(&p, cwd) }
    };
    if !path.is_absolute() {
        return Err("not an absolute path".into());
    }
    let path = normalize(&path);
    path.to_str().map(String::from).ok_or_else(|| "not valid UTF-8".to_string())
}

#[cfg(windows)]
fn absolute(p: &Path, _cwd: &Path) -> PathBuf {
    // Handles drive-relative paths (`C:foo`), which a join can't.
    std::path::absolute(p).unwrap_or_else(|_| p.to_path_buf())
}

#[cfg(not(windows))]
fn absolute(p: &Path, cwd: &Path) -> PathBuf {
    cwd.join(p)
}

/// Whether `s` starts with a URI scheme (`file:`, `sftp:`…). A Windows
/// drive letter (`C:`) is one letter, which no scheme here is.
fn has_scheme(s: &str) -> bool {
    let Some((scheme, _)) = s.split_once(':') else { return false };
    scheme.len() > 1
        && scheme.starts_with(|c: char| c.is_ascii_alphabetic())
        && scheme.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '+' | '-' | '.'))
}

/// Explorer runs `glasshouse.exe "%1"`, and for a drive that's `"C:\"`:
/// the MSVC rules read `\"` as a quote, so the argument arrives as `C:"`.
/// No Windows path can hold a `"`, so a trailing one was that backslash.
pub(crate) fn fix_windows_quote(arg: &str) -> String {
    match arg.strip_suffix('"') {
        Some(rest) => format!("{rest}\\"),
        None => arg.to_string(),
    }
}

/// `.` dropped and `..` taken off the path as written, as a shell's `cd`
/// does; links aren't followed, so a link shows as itself.
fn normalize(p: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for c in p.components() {
        match c {
            Component::CurDir => {}
            // At the root there's nothing to take off.
            Component::ParentDir => {
                out.pop();
            }
            other => out.push(other),
        }
    }
    out
}

/// What the window was started with, for the frontend.
pub struct Launch(pub Option<LaunchRequest>);

/// The paths this window was started with, or null for a plain start.
#[tauri::command]
pub fn launch_request(state: State<'_, Launch>) -> Option<LaunchRequest> {
    state.0.clone()
}

/// A window handed a startup ID gets focus with it: GTK 3 reads
/// `DESKTOP_STARTUP_ID` (and only that) and sends it when it maps the
/// window, as the xdg-activation token on Wayland and the
/// startup-notification ID on X11, then unsets it. A launcher that sets only
/// `XDG_ACTIVATION_TOKEN` (GTK 4, Qt) has it moved over, so children don't
/// inherit a used token. Call before anything starts a thread.
#[cfg(target_os = "linux")]
pub fn take_activation_token() {
    const GTK3_KEY: &str = "DESKTOP_STARTUP_ID";
    const WAYLAND_KEY: &str = "XDG_ACTIVATION_TOKEN";
    let wayland = std::env::var(WAYLAND_KEY).ok().filter(|t| !t.is_empty());
    std::env::remove_var(WAYLAND_KEY);
    let have = std::env::var(GTK3_KEY).is_ok_and(|t| !t.is_empty());
    if let (false, Some(token)) = (have, wayland) {
        std::env::set_var(GTK3_KEY, token);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(list: &[&str]) -> Vec<OsString> {
        list.iter().map(OsString::from).collect()
    }

    fn window(list: &[&str]) -> Option<LaunchRequest> {
        match parse(&args(list), Path::new("/home/u/work")) {
            Startup::Window(w) => w,
            other => panic!("not a window: {other:?}"),
        }
    }

    #[test]
    fn no_arguments_is_a_plain_window() {
        assert_eq!(window(&[]), None);
    }

    #[cfg(unix)]
    #[test]
    fn paths_and_file_uris_become_absolute_paths() {
        let w = window(&["/tmp/a b", "file:///home/u/Down%20loads/x.zip", "rel/dir", ".", "../up"]).unwrap();
        assert_eq!(w.mode, LaunchMode::Open);
        assert_eq!(w.paths, ["/tmp/a b", "/home/u/Down loads/x.zip", "/home/u/work/rel/dir", "/home/u/work", "/home/u/up"]);
        assert!(w.skipped.is_empty());
    }

    #[cfg(unix)]
    #[test]
    fn dots_are_worked_out_without_going_above_the_root() {
        let w = window(&["/a/./b/../c/", "/../.."]).unwrap();
        assert_eq!(w.paths, ["/a/c", "/"]);
    }

    #[cfg(unix)]
    #[test]
    fn modes_and_the_end_of_options() {
        let w = window(&["--select", "/a"]).unwrap();
        assert_eq!((w.mode, w.paths.as_slice()), (LaunchMode::Select, &["/a".to_string()][..]));
        let w = window(&["--properties", "--", "-dash", "--select"]).unwrap();
        assert_eq!(w.mode, LaunchMode::Properties);
        assert_eq!(w.paths, ["/home/u/work/-dash", "/home/u/work/--select"]);
    }

    #[cfg(unix)]
    #[test]
    fn unusable_arguments_are_skipped_with_a_reason() {
        let w = window(&["--frobnicate", "sftp://host/x", "file://elsewhere/x", "/ok"]).unwrap();
        assert_eq!(w.paths, ["/ok"]);
        assert_eq!(w.skipped, [
            "--frobnicate: unknown option",
            "sftp://host/x: not a local file",
            "file://elsewhere/x: not a local file",
        ]);
        // Only unusable ones: still a request, so the window can say why.
        let w = window(&["trash:///"]).unwrap();
        assert!(w.paths.is_empty());
        assert_eq!(w.skipped.len(), 1);
    }

    #[test]
    fn the_resident_and_the_cleanup_modes() {
        let cwd = Path::new("/");
        assert_eq!(parse(&args(&["--dbus", "file-manager"]), cwd), Startup::Resident(vec!["file-manager".into()]));
        assert_eq!(parse(&args(&["--dbus"]), cwd), Startup::Resident(vec![]));
        assert_eq!(parse(&args(&["--integration-off"]), cwd), Startup::IntegrationOff(vec![]));
        assert_eq!(parse(&args(&["--integration-off", "dialogs"]), cwd), Startup::IntegrationOff(vec!["dialogs".into()]));
        assert_eq!(parse(&args(&["--chooser"]), cwd), Startup::Chooser);
        assert_eq!(
            parse(&args(&["--integration-on", "folders", "file-manager"]), cwd),
            Startup::IntegrationOn(vec!["folders".into(), "file-manager".into()])
        );
        // Only as the first argument.
        assert!(matches!(parse(&args(&["/a", "--dbus"]), cwd), Startup::Window(Some(_))));
    }

    #[cfg(unix)]
    #[test]
    fn bus_calls_take_uris_and_absolute_paths_only() {
        assert_eq!(bus_path("file:///srv/a%23b"), Ok("/srv/a#b".to_string()));
        assert_eq!(bus_path("/srv/./x/.."), Ok("/srv".to_string()));
        assert!(bus_path("relative").is_err());
        assert!(bus_path("smb://host/share").is_err());
    }

    #[test]
    fn a_drive_root_argument_gets_its_backslash_back() {
        assert_eq!(fix_windows_quote("C:\""), "C:\\");
        assert_eq!(fix_windows_quote("C:\\Users\\me\""), "C:\\Users\\me\\");
        assert_eq!(fix_windows_quote("C:\\Users"), "C:\\Users");
    }

    #[test]
    fn schemes_are_told_from_drive_letters() {
        assert!(has_scheme("file:///x"));
        assert!(has_scheme("sftp://h/x"));
        assert!(!has_scheme("C:\\x"));
        assert!(!has_scheme("c:/x"));
        assert!(!has_scheme("/a:b"));
        assert!(!has_scheme("rel/dir"));
    }
}
