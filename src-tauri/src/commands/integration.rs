//! Preferences → Integration: glasshouse as the file manager other apps
//! hand off to. Every setting is off until the user turns it on, and
//! turning it off undoes it.
//!
//! - `folders`: open folders with glasshouse. Linux: the `inode/directory`
//!   default (`integration_xdg.rs`). Windows: the Directory and Drive
//!   default verb (`integration_win.rs`).
//! - `fileManager` (Linux): answer `org.freedesktop.FileManager1`, so a
//!   browser's "Show in folder" opens glasshouse (`resident.rs`).
//! - `dialogs` (Linux): glasshouse gives the open and save dialogs apps ask
//!   xdg-desktop-portal for, and the toolkits are told to ask
//!   (`integration_portal.rs`). `dialogs.gtk3`, `dialogs.gtk4` and
//!   `dialogs.qt` are its opt-ins, on unless turned off.
//!
//! See docs/decisions/2026-11-20-folder-handler-integration.md and
//! docs/decisions/2026-11-20-file-chooser-integration.md.

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
    /// Linux only.
    pub dialogs: Option<Dialogs>,
    /// What the settings can't change, for the section's footnote.
    pub limits: Vec<String>,
}

/// Use glasshouse for open and save dialogs.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Dialogs {
    #[serde(flatten)]
    pub feature: Feature,
    /// The toolkit opt-ins, for Advanced.
    pub toolkits: Vec<ToolkitRow>,
    /// A command to run as root, when the portal is too old to read
    /// glasshouse's file from the user's folder and the .deb's copy isn't
    /// there.
    pub root_command: Option<String>,
    /// The opt-ins are written but not in this session yet: they apply at
    /// the next login.
    pub pending_login: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolkitRow {
    /// "gtk3", "gtk4" or "qt": `integration_set("dialogs.<key>", on)`.
    pub key: &'static str,
    pub label: String,
    pub on: bool,
    /// What it sets (`GTK_USE_PORTAL=1`); None when nothing is needed here.
    pub sets: Option<String>,
    pub note: String,
    pub warning: Option<String>,
}

#[tauri::command(async)]
pub fn integration_status() -> IntegrationStatus {
    imp::status()
}

/// Turns `feature` ("folders", "fileManager", "dialogs", or a dialogs
/// opt-in: "dialogs.gtk3", "dialogs.gtk4", "dialogs.qt") on or off, then
/// reports.
#[tauri::command(async)]
pub fn integration_set(feature: String, on: bool) -> Result<IntegrationStatus, String> {
    imp::set(&feature, on)?;
    Ok(imp::status())
}

/// `glasshouse --integration-on folders file-manager`: turns those on, as
/// Preferences does, and prints what the desktop does now. 0 when each was
/// turned on, 1 when one failed, 2 for an unknown or missing name.
/// The settings `features` names on the command line, as `set`'s keys.
fn cli_keys(flag: &str, features: &[String]) -> Result<Vec<&'static str>, i32> {
    features
        .iter()
        .map(|f| match f.as_str() {
            "folders" => Ok("folders"),
            "file-manager" => Ok("fileManager"),
            "dialogs" => Ok("dialogs"),
            other => {
                eprintln!("glasshouse {flag}: unknown setting {other:?}; use folders, file-manager or dialogs");
                Err(2)
            }
        })
        .collect()
}

pub fn on_from_cli(features: &[String]) -> i32 {
    let keys = match cli_keys("--integration-on", features) {
        Ok(k) => k,
        Err(code) => return code,
    };
    if keys.is_empty() {
        eprintln!("glasshouse --integration-on: name a setting: folders, file-manager, dialogs");
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
    let dialogs = status.dialogs;
    let root = dialogs.as_ref().and_then(|d| d.root_command.clone());
    let pending = dialogs.as_ref().is_some_and(|d| d.pending_login);
    for f in [status.folders, status.file_manager, dialogs.map(|d| d.feature)].into_iter().flatten() {
        println!("{}", f.detail);
        if let Some(w) = f.warning {
            println!("warning: {w}");
        }
    }
    if let Some(cmd) = root {
        println!("run once as root:\n  {cmd}");
    }
    if pending {
        println!("The toolkit settings apply at your next login; apps already running keep their old dialog until they're restarted.");
    }
    code
}

/// `glasshouse --integration-off`: turns everything off and exits; the
/// Windows MSI runs it before uninstalling. 0 when everything is off.
/// `--integration-off [FEATURE…]`: the named settings, or every one.
pub fn off_from_cli(features: &[String]) -> i32 {
    let keys = match cli_keys("--integration-off", features) {
        Ok(k) => k,
        Err(code) => return code,
    };
    let result = if keys.is_empty() {
        imp::all_off()
    } else {
        let errors: Vec<String> = keys.iter().filter_map(|k| imp::set(k, false).err().map(|e| format!("{k}: {e}"))).collect();
        if errors.is_empty() { Ok(()) } else { Err(errors.join("; ")) }
    };
    match result {
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

    use super::super::integration_portal::{self as portal, live, Version, BACKEND, CHOOSER_IFACE};
    use super::super::integration_xdg::{self as xdg, Places, CHOOSER_NAME, DESKTOP_ID, FILE_MANAGER_NAME};
    use super::{program, Dialogs, Feature, IntegrationStatus, ToolkitRow};
    use crate::resident::{self, Holder, Service};

    const LIMITS: [&str; 2] = [
        "Apps that don't use GTK, Qt or a browser engine keep their own open and save dialogs: Java (Swing) and Tk apps, Wine and terminal programs.",
        "So do GTK and Qt apps that build their own dialog instead of the toolkit's standard one.",
    ];

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

    // ---------- open and save dialogs ----------

    /// What decides which variables the opt-ins need.
    fn toolkit_system(env: Option<&portal::PortalEnv>) -> portal::Toolkit {
        let desktops = match env {
            Some(e) => e.desktops.clone(),
            None => portal::desktops(&std::env::var("XDG_CURRENT_DESKTOP").unwrap_or_default()),
        };
        portal::Toolkit { gtk4: portal::gtk4_version(&portal::lib_dirs()), kde: desktops.iter().any(|d| d == "kde") }
    }

    fn toolkit_rows(t: portal::Toolkits, sys: &portal::Toolkit) -> Vec<ToolkitRow> {
        let vars = portal::vars(portal::Toolkits { gtk3: true, gtk4: true, qt: true }, sys);
        let sets = |name: &str| vars.iter().find(|v| v.name == name).map(|v| format!("{}={}", v.name, (v.session)(None).unwrap_or_default()));
        let gtk4_note = match sys.gtk4 {
            Some((minor, micro)) if !sys.gtk4_needs_debug() => {
                format!("GTK 4.18 and later ask the portal on their own when it's there (this system has 4.{minor}.{micro}), so nothing is set.")
            }
            _ => "GTK 4 before 4.18 asks the portal only when this is set.".to_string(),
        };
        let qt_sets = if sys.kde { sets("PLASMA_INTEGRATION_USE_PORTAL") } else { sets("QT_QPA_PLATFORMTHEME") };
        let qt_note = if sys.kde {
            "KDE's own Qt theme asks the portal when this is set; the look doesn't change.".to_string()
        } else {
            let now = std::env::var("QT_QPA_PLATFORMTHEME").ok().filter(|v| !v.is_empty() && v != "xdgdesktopportal");
            match now {
                Some(v) => format!("Qt apps ask the portal with this platform theme. It also changes how they look: it replaces QT_QPA_PLATFORMTHEME={v}."),
                None => "Qt apps ask the portal with this platform theme. It also changes how they look: they lose the theme they'd get from the desktop.".to_string(),
            }
        };
        let (qt6, qt5) = portal::qt_plugin_found(&portal::lib_dirs());
        let qt_warning = (!sys.kde && !qt6).then(|| {
            let five = if qt5 { "" } else { " (and qt5-xdgdesktopportal-platformtheme for Qt 5)" };
            format!("The Qt 6 plugin for it isn't installed, so Qt 6 apps keep their own dialog. Debian and Ubuntu have it as qt6-xdgdesktopportal-platformtheme{five}.")
        });
        vec![
            ToolkitRow {
                key: "gtk3",
                label: "GTK 3 apps, and Firefox".into(),
                on: t.gtk3,
                sets: sets("GTK_USE_PORTAL"),
                note: "GTK 3 apps ask the portal when this is set, and so do Firefox and its forks (LibreWolf, Thunderbird) in their default \"auto\" mode. Recent releases may ask on their own.".into(),
                warning: None,
            },
            ToolkitRow { key: "gtk4", label: "GTK 4 apps".into(), on: t.gtk4, sets: sets("GDK_DEBUG"), note: gtk4_note, warning: None },
            ToolkitRow { key: "qt", label: "Qt apps".into(), on: t.qt, sets: qt_sets, note: qt_note, warning: qt_warning },
        ]
    }

    /// Whether a file changed after the portal started, so it hasn't read
    /// it. The start time comes from the boot time in whole seconds, so a
    /// file written up to two seconds before it counts as read.
    fn newer_than(path: &Path, started: Option<std::time::SystemTime>) -> bool {
        let (Some(started), Ok(m)) = (started, std::fs::metadata(path).and_then(|m| m.modified())) else { return false };
        m > started + Duration::from_secs(2)
    }

    fn dialogs(p: &Places) -> Dialogs {
        let on = portal::enabled(p);
        let state = portal::read_state(p);
        let conn = resident::connect().ok();
        let found = live::find(conn.as_ref());
        let sys = toolkit_system(found.as_ref().map(|f| &f.env));
        let vars = portal::vars(state.toolkits, &sys);
        let mut warnings: Vec<String> = Vec::new();
        let mut root_command = None;
        let detail = match &found {
            None => {
                if on {
                    warnings.push("Install xdg-desktop-portal: apps reach glasshouse's dialog through it.".into());
                }
                "xdg-desktop-portal isn't installed, so apps show their own open and save dialogs.".to_string()
            }
            Some(pt) => {
                let v = pt.version;
                let backends = portal::load_backends(&pt.env.portal_dirs(v), &pt.env.desktops);
                let conf = portal::effective_conf(&pt.env.conf_candidates());
                let keys = conf.as_ref().map(|(_, t)| portal::group_keys(t, "[preferred]")).unwrap_or_default();
                let chosen = portal::chosen_backend(&keys, &backends, &pt.env.desktops, CHOOSER_IFACE, v);
                let ours = chosen.is_some_and(|b| b.name == BACKEND);
                if on {
                    if let Some(v) = v.filter(|v| *v < Version::CONFIG) {
                        warnings.push(format!("xdg-desktop-portal {v} is too old to choose its dialog backend: that takes 1.17 or later."));
                    } else if pt.env.portal_dir.is_some() {
                        warnings.push("xdg-desktop-portal runs with XDG_DESKTOP_PORTAL_DIR set, so it reads its settings only from there, which glasshouse doesn't change.".into());
                    } else if !backends.iter().any(|b| b.name == BACKEND) {
                        let cmd = portal::root_command(&pt.env);
                        let vtext = v.map(|v| format!(" {v}")).unwrap_or_default();
                        warnings.push(format!(
                            "xdg-desktop-portal{vtext} reads its backends only from {}, where glasshouse.portal isn't (the .deb installs it). \
                             Run the command below once as root, then turn this off and on again.",
                            pt.env.datadir().join("xdg-desktop-portal/portals").display()
                        ));
                        root_command = Some(cmd);
                    } else if !ours {
                        let at = conf.as_ref().map(|(path, _)| format!(" ({})", home_relative(path))).unwrap_or_default();
                        warnings.push(format!("Another portal setting{at} wins over the one glasshouse wrote."));
                    } else if pt.pid.is_some() {
                        let started = pt.pid.and_then(live::started_at);
                        let files = [conf.as_ref().map(|(path, _)| path.clone()), state.portal_file.clone()];
                        if files.iter().flatten().any(|f| newer_than(f, started)) {
                            warnings.push("xdg-desktop-portal hasn't read the new setting yet: it reads it when it starts. Turn this off and on to restart it, or log out and back in.".into());
                        }
                    }
                }
                match chosen {
                    _ if ours => "Apps that ask xdg-desktop-portal for open and save dialogs get glasshouse's.".to_string(),
                    Some(b) => format!("Apps that ask xdg-desktop-portal for open and save dialogs get the {} backend's.", b.name),
                    None => "xdg-desktop-portal has no backend for open and save dialogs, so apps show their own.".to_string(),
                }
            }
        };
        if on {
            if let Some(w) = other_copy(portal::service_program(p)) {
                warnings.push(w);
            }
        }
        let pending_login = on && !vars.is_empty() && !portal::vars_in_effect(&vars, |k| std::env::var(k).ok());
        Dialogs {
            feature: Feature { on, detail, warning: (!warnings.is_empty()).then(|| warnings.join(" ")) },
            toolkits: toolkit_rows(state.toolkits, &sys),
            root_command,
            pending_login,
        }
    }

    /// Writes the opt-ins: the environment.d file, and the service
    /// manager's environment for apps it starts from now on.
    fn apply_toolkits(p: &Places, state: &mut portal::State, conn: Option<&zbus::blocking::Connection>, env: Option<&portal::PortalEnv>) -> Result<(), String> {
        let vars = portal::vars(state.toolkits, &toolkit_system(env));
        portal::env_on(p, &vars)?;
        if let Some(c) = conn {
            let left = live::session_env_off(c, std::mem::take(&mut state.session_env));
            state.session_env = left;
            match live::session_env_on(c, &vars) {
                Ok(changes) => state.session_env.extend(changes),
                Err(e) => crate::diagnostics::note(log::Level::Warn, &format!("integration: session environment: {e}")),
            }
        }
        Ok(())
    }

    fn dialogs_on(p: &Places) -> Result<(), String> {
        let exe = program()?;
        let conn = resident::connect().ok();
        let pt = live::find(conn.as_ref()).ok_or_else(|| {
            "xdg-desktop-portal isn't installed, and apps reach glasshouse's dialog through it. Install it (the package is xdg-desktop-portal), then turn this on.".to_string()
        })?;
        if let Some(v) = pt.version.filter(|v| *v < Version::CONFIG) {
            return Err(format!("xdg-desktop-portal {v} is too old to choose its dialog backend: that takes 1.17 or later."));
        }
        if pt.env.portal_dir.is_some() {
            return Err("xdg-desktop-portal runs with XDG_DESKTOP_PORTAL_DIR set, so it reads its settings only from there; glasshouse can't change them.".into());
        }
        let mut state = portal::read_state(p);
        let portal_file = pt.env.user_portal_file();
        portal::service_on(p, Path::new(&exe), &portal_file, &pt.env.conf_target())?;
        if let Some(c) = &conn {
            if let Err(e) = resident::reload_config(c) {
                crate::diagnostics::note(log::Level::Warn, &format!("integration: ReloadConfig: {e}"));
            }
        }
        let mut changed = false;
        if pt.version.is_none_or(|v| v >= Version::USER_PORTALS) {
            changed |= !xdg_is_ours(&portal_file);
            portal::portal_file_on(&portal_file)?;
            state.portal_file = Some(portal_file);
        }
        if let Some(change) = portal::conf_on(&pt.env, pt.version)? {
            state.conf = Some(change);
            changed = true;
        }
        // Recorded before the steps that can still fail, so off undoes it.
        portal::write_state(p, &state)?;
        apply_toolkits(p, &mut state, conn.as_ref(), Some(&pt.env))?;
        portal::write_state(p, &state)?;
        match &conn {
            Some(c) if changed => live::restart(c).map_err(|e| format!("The settings are written, but {e}")),
            _ => Ok(()),
        }
    }

    fn xdg_is_ours(path: &Path) -> bool {
        std::fs::read_to_string(path).is_ok_and(|t| t.contains(portal::MARK))
    }

    fn dialogs_off(p: &Places) -> Result<(), String> {
        let conn = resident::connect().ok();
        let pt = live::find(conn.as_ref());
        let mut state = portal::read_state(p);
        let mut errors = Vec::new();
        let mut changed = false;
        match state.conf.take() {
            Some(c) => match portal::conf_off(&c) {
                Ok(()) => changed = true,
                Err(e) => {
                    errors.push(e);
                    state.conf = Some(c);
                }
            },
            None => {
                if let Some(pt) = &pt {
                    match portal::conf_off_unrecorded(&pt.env) {
                        Ok(c) => changed |= c,
                        Err(e) => errors.push(e),
                    }
                }
            }
        }
        let portal_file = state.portal_file.take().or_else(|| pt.as_ref().map(|t| t.env.user_portal_file()));
        if let Some(f) = portal_file.filter(|f| xdg_is_ours(f)) {
            match std::fs::remove_file(&f) {
                Ok(()) => changed = true,
                Err(e) => {
                    errors.push(format!("{}: {e}", f.display()));
                    state.portal_file = Some(f);
                }
            }
        }
        if let Err(e) = portal::service_off(p) {
            errors.push(e);
        }
        if let Err(e) = portal::env_off(p) {
            errors.push(e);
        }
        if let Some(c) = &conn {
            state.session_env = live::session_env_off(c, std::mem::take(&mut state.session_env));
            if let Err(e) = resident::reload_config(c) {
                crate::diagnostics::note(log::Level::Warn, &format!("integration: ReloadConfig: {e}"));
            }
            if matches!(resident::holder(c, CHOOSER_NAME), Ok(Holder::Glasshouse)) {
                if let Err(e) = resident::release(c, CHOOSER_NAME) {
                    errors.push(format!("asking glasshouse to give up {CHOOSER_NAME}: {e}"));
                }
            }
        }
        portal::write_state(p, &state)?;
        if changed {
            if let Some(c) = &conn {
                if let Err(e) = live::restart(c) {
                    errors.push(e);
                }
            }
        }
        if errors.is_empty() { Ok(()) } else { Err(errors.join("\n")) }
    }

    fn toolkit_set(p: &Places, key: &str, on: bool) -> Result<(), String> {
        let mut state = portal::read_state(p);
        match key {
            "gtk3" => state.toolkits.gtk3 = on,
            "gtk4" => state.toolkits.gtk4 = on,
            "qt" => state.toolkits.qt = on,
            _ => return Err(format!("unknown setting dialogs.{key}")),
        }
        if portal::enabled(p) {
            let conn = resident::connect().ok();
            let env = live::find(conn.as_ref()).map(|t| t.env);
            apply_toolkits(p, &mut state, conn.as_ref(), env.as_ref())?;
        }
        portal::write_state(p, &state)
    }

    pub fn status() -> IntegrationStatus {
        let Ok(p) = places() else {
            return IntegrationStatus {
                supported: false,
                program: None,
                folders: None,
                file_manager: None,
                dialogs: None,
                limits: vec![],
            };
        };
        IntegrationStatus {
            supported: true,
            program: program().ok(),
            folders: Some(folders(&p)),
            file_manager: Some(file_manager(&p)),
            dialogs: Some(dialogs(&p)),
            limits: LIMITS.iter().map(|s| s.to_string()).collect(),
        }
    }

    pub fn set(feature: &str, on: bool) -> Result<(), String> {
        let p = places()?;
        match (feature, on) {
            ("folders", true) => xdg::folders_on(&p, Path::new(&program()?)),
            ("folders", false) => xdg::folders_off(&p),
            ("fileManager", true) => file_manager_on(&p),
            ("fileManager", false) => file_manager_off(&p),
            ("dialogs", true) => dialogs_on(&p),
            ("dialogs", false) => dialogs_off(&p),
            (f, on) if f.starts_with("dialogs.") => toolkit_set(&p, &f["dialogs.".len()..], on),
            _ => Err(format!("unknown setting {feature:?}")),
        }
    }

    fn file_manager_on(p: &Places) -> Result<(), String> {
        xdg::service_on(p, Path::new(&program()?))?;
        let conn = resident::connect().map_err(|e| format!("session bus: {e}"))?;
        // The bus would also see the file on the next activation; this
        // makes it count now.
        if let Err(e) = resident::reload_config(&conn) {
            crate::diagnostics::note(log::Level::Warn, &format!("integration: ReloadConfig: {e}"));
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
            crate::diagnostics::note(log::Level::Warn, &format!("integration: ReloadConfig: {e}"));
        }
        if matches!(resident::holder(&conn, FILE_MANAGER_NAME), Ok(Holder::Glasshouse)) {
            resident::release(&conn, FILE_MANAGER_NAME).map_err(|e| format!("asking glasshouse to give up {FILE_MANAGER_NAME}: {e}"))?;
        }
        Ok(())
    }

    pub fn all_off() -> Result<(), String> {
        let errors: Vec<String> = ["folders", "fileManager", "dialogs"]
            .into_iter()
            .filter_map(|f| set(f, false).err())
            .collect();
        if errors.is_empty() { Ok(()) } else { Err(errors.join("\n")) }
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

    const LIMITS: [&str; 3] = [
        "Explorer's own \"Show in folder\" (what browsers and most apps use to show a download) and Win+E always open Explorer: Windows doesn't let another app take those over.",
        "This PC, the Recycle Bin, Control Panel and other virtual folders stay with Explorer.",
        "Other apps' open and save dialogs stay Windows' own: replacing them would mean loading code into every app, which glasshouse doesn't do.",
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
            dialogs: None,
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
        IntegrationStatus { supported: false, program: None, folders: None, file_manager: None, dialogs: None, limits: vec![] }
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
