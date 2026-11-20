//! Preferences → Integration: glasshouse as the file manager other apps
//! hand off to. Every setting is off until the user turns it on, and
//! turning it off undoes it.
//!
//! - `folders`: open folders with glasshouse. Linux: the `inode/directory`
//!   default (`integration_xdg.rs`). Windows: the Directory and Drive
//!   default verb (`integration_win.rs`).
//! - `fileManager` (Linux): answer `org.freedesktop.FileManager1`, so a
//!   browser's "Show in folder" opens glasshouse (`resident.rs`).
//!
//! See docs/decisions/2026-11-20-folder-handler-integration.md.

use serde::Serialize;

/// One setting as Preferences shows it.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Feature {
    pub on: bool,
    /// What the desktop does now, in a line.
    pub detail: String,
    /// Why it isn't fully in effect, when it isn't.
    pub warning: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IntegrationStatus {
    /// False where there's nothing to set (macOS).
    pub supported: bool,
    /// The program the settings start (or would).
    pub program: Option<String>,
    pub folders: Option<Feature>,
    /// Linux only.
    pub file_manager: Option<Feature>,
    /// What the settings can't change, for the section's footnote.
    pub limits: Vec<String>,
}

#[tauri::command(async)]
pub fn integration_status() -> IntegrationStatus {
    imp::status()
}

/// Turns `feature` ("folders" or "fileManager") on or off, then reports.
#[tauri::command(async)]
pub fn integration_set(feature: String, on: bool) -> Result<IntegrationStatus, String> {
    imp::set(&feature, on)?;
    Ok(imp::status())
}

/// `glasshouse --integration-on folders file-manager`: turns those on, as
/// Preferences does, and prints what the desktop does now. 0 when each was
/// turned on, 1 when one failed, 2 for an unknown or missing name.
pub fn on_from_cli(features: &[String]) -> i32 {
    let mut keys = Vec::new();
    for f in features {
        match f.as_str() {
            "folders" => keys.push("folders"),
            "file-manager" => keys.push("fileManager"),
            other => {
                eprintln!("glasshouse --integration-on: unknown setting {other:?}; use folders or file-manager");
                return 2;
            }
        }
    }
    if keys.is_empty() {
        eprintln!("glasshouse --integration-on: name a setting: folders, file-manager");
        return 2;
    }
    let mut code = 0;
    for key in keys {
        if let Err(e) = imp::set(key, true) {
            eprintln!("glasshouse --integration-on: {key}: {e}");
            code = 1;
        }
    }
    let status = imp::status();
    for f in [status.folders, status.file_manager].into_iter().flatten() {
        println!("{}", f.detail);
        if let Some(w) = f.warning {
            println!("warning: {w}");
        }
    }
    code
}

/// `glasshouse --integration-off`: turns everything off and exits; the
/// Windows MSI runs it before uninstalling. 0 when everything is off.
pub fn off_from_cli() -> i32 {
    match imp::all_off() {
        Ok(()) => 0,
        Err(e) => {
            eprintln!("glasshouse --integration-off: {e}");
            1
        }
    }
}

fn program() -> Result<String, String> {
    let exe = crate::startup::self_exe()?;
    exe.to_str()
        .map(String::from)
        .ok_or_else(|| format!("glasshouse's path isn't UTF-8: {}", exe.display()))
}

#[cfg(target_os = "linux")]
mod imp {
    use std::path::Path;
    use std::time::Duration;

    use super::super::integration_xdg::{self as xdg, Places, DESKTOP_ID, FILE_MANAGER_NAME};
    use super::{program, Feature, IntegrationStatus};
    use crate::resident::{self, Holder, Service};

    fn places() -> Result<Places, String> {
        Places::from_env().ok_or_else(|| "HOME isn't set".to_string())
    }

    fn home_relative(p: &Path) -> String {
        let s = p.display().to_string();
        match std::env::var("HOME") {
            Ok(h) if !h.is_empty() && s.starts_with(&format!("{h}/")) => format!("~{}", &s[h.len()..]),
            _ => s,
        }
    }

    fn folders(p: &Places) -> Feature {
        let on = xdg::folders_enabled(p);
        let now = xdg::folder_default(p);
        let detail = match &now {
            Some((id, _, _)) if id == DESKTOP_ID => "Folders open with glasshouse.".to_string(),
            Some((id, name, Some(list))) => format!("Folders open with {name} ({id}, set in {}).", home_relative(list)),
            Some((id, name, None)) => format!("Folders open with {name} ({id}): no app is set, so it's the first that takes folders."),
            None => "No app opens folders.".to_string(),
        };
        // The menu entry the packages install takes no types (so installing
        // never changes who opens folders); the hidden one this writes does.
        let detail = if on {
            detail
        } else {
            format!("{detail} While this is off, other apps' Open With lists don't offer glasshouse for folders.")
        };
        let warning = match &now {
            Some((id, _, list)) if on && id != DESKTOP_ID => Some(match list {
                Some(l) => format!("{} sets another app, and it wins over the lists glasshouse changes.", home_relative(l)),
                None => "Another setting wins over the folder default glasshouse set.".to_string(),
            }),
            _ => None,
        };
        let warning = warning.or_else(|| other_copy(xdg::folders_program(p)));
        Feature { on, detail, warning }
    }

    /// When a setting starts a glasshouse other than this one (a moved
    /// AppImage, another install), says so.
    fn other_copy(target: Option<String>) -> Option<String> {
        let me = program().ok()?;
        let target = target.filter(|t| *t != me)?;
        Some(format!("This starts {target}, not this copy of glasshouse; turn it off and on to point it here."))
    }

    fn holder_text(h: &Holder) -> String {
        match h {
            Holder::Glasshouse => "glasshouse".to_string(),
            Holder::Nobody => "nobody".to_string(),
            Holder::Other { program, pid } => match (program, pid) {
                (Some(p), Some(pid)) => format!("{p} (pid {pid})"),
                (Some(p), None) => p.clone(),
                (None, Some(pid)) => format!("pid {pid}"),
                (None, None) => "another program".to_string(),
            },
        }
    }

    fn file_manager(p: &Places) -> Feature {
        let on = xdg::service_enabled(p);
        let holder = resident::connect().and_then(|c| resident::holder(&c, FILE_MANAGER_NAME));
        let (detail, warning) = match holder {
            Err(e) => ("Can't reach the session bus.".to_string(), Some(e.to_string())),
            Ok(Holder::Glasshouse) => ("glasshouse answers \"Show in folder\" from other apps.".to_string(), None),
            Ok(Holder::Nobody) if on => (
                "glasshouse answers \"Show in folder\" from other apps; it starts when one asks.".to_string(),
                None,
            ),
            Ok(Holder::Nobody) => (
                "No file manager is running for \"Show in folder\"; the bus starts the system's when an app asks.".to_string(),
                None,
            ),
            Ok(h) => {
                let who = holder_text(&h);
                let detail = format!("{who} answers \"Show in folder\" from other apps.");
                let warning = on.then(|| {
                    format!(
                        "{who} is running and holds {FILE_MANAGER_NAME}, and it doesn't let another program take it over. \
                         glasshouse answers once {who} isn't running: quit it, or log out and back in. \
                         A desktop that starts it at login (MATE's caja, GNOME's Nautilus) keeps it."
                    )
                });
                (detail, warning)
            }
        };
        let warning = warning.or_else(|| other_copy(xdg::service_program(p)));
        Feature { on, detail, warning }
    }

    pub fn status() -> IntegrationStatus {
        let Ok(p) = places() else {
            return IntegrationStatus { supported: false, program: None, folders: None, file_manager: None, limits: vec![] };
        };
        IntegrationStatus {
            supported: true,
            program: program().ok(),
            folders: Some(folders(&p)),
            file_manager: Some(file_manager(&p)),
            limits: vec![],
        }
    }

    pub fn set(feature: &str, on: bool) -> Result<(), String> {
        let p = places()?;
        match (feature, on) {
            ("folders", true) => xdg::folders_on(&p, Path::new(&program()?)),
            ("folders", false) => xdg::folders_off(&p),
            ("fileManager", true) => file_manager_on(&p),
            ("fileManager", false) => file_manager_off(&p),
            _ => Err(format!("unknown setting {feature:?}")),
        }
    }

    fn file_manager_on(p: &Places) -> Result<(), String> {
        xdg::service_on(p, Path::new(&program()?))?;
        let conn = resident::connect().map_err(|e| format!("session bus: {e}"))?;
        // The bus would also see the file on the next activation; this
        // makes it count now.
        if let Err(e) = resident::reload_config(&conn) {
            eprintln!("integration: ReloadConfig: {e}");
        }
        match resident::holder(&conn, FILE_MANAGER_NAME).map_err(|e| e.to_string())? {
            Holder::Glasshouse => Ok(()),
            // Start ours now, so the status says at once whether it got the
            // name. One that can't take it exits with 1, which isn't an
            // error here: the status explains who holds it.
            _ => resident::start(Service::FileManager, Duration::from_millis(1500)).map(|_| ()),
        }
    }

    fn file_manager_off(p: &Places) -> Result<(), String> {
        xdg::service_off(p)?;
        let Ok(conn) = resident::connect() else { return Ok(()) };
        if let Err(e) = resident::reload_config(&conn) {
            eprintln!("integration: ReloadConfig: {e}");
        }
        if matches!(resident::holder(&conn, FILE_MANAGER_NAME), Ok(Holder::Glasshouse)) {
            resident::release(&conn, FILE_MANAGER_NAME).map_err(|e| format!("asking glasshouse to give up {FILE_MANAGER_NAME}: {e}"))?;
        }
        Ok(())
    }

    pub fn all_off() -> Result<(), String> {
        let a = set("folders", false);
        let b = set("fileManager", false);
        match (a, b) {
            (Ok(()), Ok(())) => Ok(()),
            (a, b) => Err([a.err(), b.err()].into_iter().flatten().collect::<Vec<_>>().join("\n")),
        }
    }

    /// Whether a FileManager1 call (or its fallback, opening the folder)
    /// would land in glasshouse itself, so Reveal in File Manager should
    /// select the item here instead of opening another window.
    pub fn reveals_in_glasshouse() -> bool {
        let Ok(p) = places() else { return false };
        let conn = resident::connect().ok();
        match conn.as_ref().map(|c| resident::holder(c, FILE_MANAGER_NAME)) {
            Some(Ok(Holder::Glasshouse)) => true,
            Some(Ok(Holder::Other { .. })) => false,
            // Nobody: the bus starts the service file it has, which is ours
            // when it's on (a user file wins over the system's).
            Some(Ok(Holder::Nobody)) if xdg::service_enabled(&p) => true,
            Some(Ok(Holder::Nobody)) if conn.as_ref().is_some_and(|c| resident::activatable(c, FILE_MANAGER_NAME)) => false,
            // No file manager at all, or no bus: the fallback opens the folder.
            _ => xdg::folder_default(&p).is_some_and(|(id, _, _)| id == DESKTOP_ID),
        }
    }
}

#[cfg(windows)]
mod imp {
    use super::super::integration_win::{self as win, reg};
    use super::{program, Feature, IntegrationStatus};

    const LIMITS: [&str; 2] = [
        "Explorer's own \"Show in folder\" (what browsers and most apps use to show a download) and Win+E always open Explorer: Windows doesn't let another app take those over.",
        "This PC, the Recycle Bin, Control Panel and other virtual folders stay with Explorer.",
    ];

    pub fn status() -> IntegrationStatus {
        let now = reg::shell_keys();
        let on = win::is_on(&now);
        let target = now[0].command.as_deref().and_then(win::command_program).map(String::from);
        let me = program().ok();
        let detail = if on {
            "Folders open with glasshouse, from Explorer and from apps that open a folder.".to_string()
        } else {
            "Folders open with Explorer.".to_string()
        };
        let warning = match (&target, &me) {
            (Some(t), Some(m)) if on && !t.eq_ignore_ascii_case(m) => {
                Some(format!("Folders open with {t}, not this copy of glasshouse; turn this off and on to point it here."))
            }
            _ => None,
        };
        IntegrationStatus {
            supported: true,
            program: me,
            folders: Some(Feature { on, detail, warning }),
            file_manager: None,
            limits: LIMITS.iter().map(|s| s.to_string()).collect(),
        }
    }

    pub fn set(feature: &str, on: bool) -> Result<(), String> {
        if feature != "folders" {
            return Err(format!("unknown setting {feature:?}"));
        }
        let now = reg::shell_keys();
        let ops = if on { win::on_ops(&program()?, &now) } else { win::off_ops(&now) };
        reg::apply(&ops)
    }

    pub fn all_off() -> Result<(), String> {
        set("folders", false)
    }
}

#[cfg(not(any(target_os = "linux", windows)))]
mod imp {
    use super::IntegrationStatus;

    pub fn status() -> IntegrationStatus {
        IntegrationStatus { supported: false, program: None, folders: None, file_manager: None, limits: vec![] }
    }

    pub fn set(_feature: &str, _on: bool) -> Result<(), String> {
        Err("there's nothing to set on this system".into())
    }

    pub fn all_off() -> Result<(), String> {
        Ok(())
    }
}

#[cfg(target_os = "linux")]
pub(crate) use imp::reveals_in_glasshouse;
