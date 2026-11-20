//! The resident D-Bus mode (Linux): `glasshouse --dbus SERVICE…`.
//!
//! A process with no window or webview, started by D-Bus activation (the
//! user service file Preferences → Integration writes) or by Preferences
//! itself. It owns the bus name of each service it's given and starts a
//! window process for each request, as File → New Window does. It stays
//! running, as caja, Nautilus and the portal backends do, so another file
//! manager can't take the name in a gap.
//!
//! Services, each a `Service` with its bus name and object:
//! - `file-manager`: `org.freedesktop.FileManager1` (ShowFolders, ShowItems,
//!   ShowItemProperties).
//! - `file-chooser`: xdg-desktop-portal's FileChooser backend
//!   (`portal.rs`), the open and save dialogs other apps show.
//!
//! One process can serve both (`--dbus file-manager file-chooser`); the
//! service files Preferences writes start one each.
//!
//! Every resident also serves `io.github.johnson_anthony.glasshouse.Resident1`
//! at `/io/github/johnson_anthony/glasshouse/Resident` (the app identifier
//! with `_` for `-`, which D-Bus names can't have). It's how the app tells
//! that a bus name is held by glasshouse (`holder`), so Reveal in File
//! Manager doesn't open a window of its own, and how turning a toggle off
//! hands the name back (`Release`). See
//! docs/decisions/2026-11-20-folder-handler-processes.md.

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{mpsc, Arc, Mutex};
use std::time::Duration;

use zbus::blocking::Connection;
use zbus::fdo::{RequestNameFlags, RequestNameReply};
use zbus::names::BusName;

use crate::lock;
use crate::startup::LaunchMode;

pub(crate) use crate::commands::integration_xdg::FILE_MANAGER_NAME;
const FILE_MANAGER_PATH: &str = "/org/freedesktop/FileManager1";
const CONTROL_PATH: &str = "/io/github/johnson_anthony/glasshouse/Resident";
const CONTROL_IFACE: &str = "io.github.johnson_anthony.glasshouse.Resident1";
/// The control interface before the identifier changed (`migrate.rs`). No
/// release had a resident, but a build from before the change can still
/// hold a name until the session ends; it's recognized and released as
/// ours are, so turning a switch off and on hands the name to this one.
const OLD_CONTROL: (&str, &str) = ("/sh/glasshouse/viles/Resident", "sh.glasshouse.viles.Resident1");
const CONTROLS: [(&str, &str); 2] = [(CONTROL_PATH, CONTROL_IFACE), OLD_CONTROL];

/// What a resident can provide.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Service {
    FileManager,
    FileChooser,
}

impl Service {
    const ALL: [Service; 2] = [Service::FileManager, Service::FileChooser];

    /// Its name after `--dbus`.
    pub(crate) fn arg(self) -> &'static str {
        match self {
            Service::FileManager => "file-manager",
            Service::FileChooser => "file-chooser",
        }
    }

    pub(crate) fn bus_name(self) -> &'static str {
        match self {
            Service::FileManager => FILE_MANAGER_NAME,
            Service::FileChooser => crate::portal::CHOOSER_NAME,
        }
    }
}

fn parse_services(args: &[String]) -> Result<Vec<Service>, String> {
    if args.is_empty() {
        let known: Vec<_> = Service::ALL.iter().map(|s| s.arg()).collect();
        return Err(format!("name a service: {}", known.join(", ")));
    }
    let mut out = Vec::new();
    for a in args {
        let s = Service::ALL
            .into_iter()
            .find(|s| s.arg() == a)
            .ok_or_else(|| format!("unknown service {a:?}"))?;
        if !out.contains(&s) {
            out.push(s);
        }
    }
    Ok(out)
}

/// Runs the resident until it owns no names or the bus goes away. The exit
/// code is 0 after a normal end, 1 when it got none of its names (another
/// program holds them), 2 for a bad command line or no bus.
pub fn run(args: &[String]) -> i32 {
    let services = match parse_services(args) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("glasshouse --dbus: {e}");
            return 2;
        }
    };
    // Taken now: a rebuilt binary has a new file at this path, which is
    // what the windows should run, while this process keeps the old one.
    let exe = match crate::startup::self_exe() {
        Ok(p) => p,
        Err(e) => {
            eprintln!("glasshouse --dbus: {e}");
            return 2;
        }
    };
    let (quit_tx, quit_rx) = mpsc::channel::<()>();
    let owned = Arc::new(Mutex::new(Vec::<String>::new()));
    let conn = match serve(&services, &exe, owned.clone(), quit_tx.clone()) {
        Ok(c) => c,
        Err(e) => {
            eprintln!("glasshouse --dbus: session bus: {e}");
            return 2;
        }
    };
    for s in &services {
        let name = s.bus_name();
        // No queueing: a file manager that holds the name keeps it. One
        // that allowed replacement is replaced; we don't allow it in turn.
        match conn.request_name_with_flags(name, RequestNameFlags::ReplaceExisting | RequestNameFlags::DoNotQueue) {
            Ok(RequestNameReply::PrimaryOwner | RequestNameReply::AlreadyOwner) => lock(&owned).push(name.to_string()),
            Ok(_) => eprintln!("glasshouse --dbus: {name} is held by another program; leaving it there"),
            Err(e) => eprintln!("glasshouse --dbus: {name}: {e}"),
        }
    }
    if lock(&owned).is_empty() {
        return 1;
    }
    // Every message is copied to this stream too; it ends when the bus
    // connection does, at the end of the session.
    let messages = zbus::blocking::MessageIterator::from(&conn);
    std::thread::spawn(move || {
        for _ in messages {}
        let _ = quit_tx.send(());
    });
    let _ = quit_rx.recv();
    // Let a reply on its way (Release) go out before the process ends.
    std::thread::sleep(Duration::from_millis(200));
    0
}

fn serve(
    services: &[Service],
    exe: &Path,
    owned: Arc<Mutex<Vec<String>>>,
    quit: mpsc::Sender<()>,
) -> zbus::Result<Connection> {
    let mut builder = zbus::blocking::connection::Builder::session()?
        .serve_at(CONTROL_PATH, Control { owned, quit })?;
    for s in services {
        builder = match s {
            Service::FileManager => builder.serve_at(FILE_MANAGER_PATH, FileManager1 { exe: exe.to_path_buf() })?,
            Service::FileChooser => {
                builder.serve_at(crate::portal::PORTAL_PATH, crate::portal::FileChooser { exe: exe.to_path_buf() })?
            }
        };
    }
    builder.build()
}

/// `io.github.johnson_anthony.glasshouse.Resident1`.
struct Control {
    owned: Arc<Mutex<Vec<String>>>,
    quit: mpsc::Sender<()>,
}

#[zbus::interface(name = "io.github.johnson_anthony.glasshouse.Resident1")]
impl Control {
    #[zbus(property)]
    fn version(&self) -> String {
        env!("CARGO_PKG_VERSION").to_string()
    }

    /// The bus names this process owns.
    #[zbus(property)]
    fn names(&self) -> Vec<String> {
        lock(&self.owned).clone()
    }

    /// Gives up bus name `name`; the process ends once it owns none.
    async fn release(&self, #[zbus(connection)] conn: &zbus::Connection, name: String) -> zbus::fdo::Result<()> {
        if !lock(&self.owned).contains(&name) {
            return Err(zbus::fdo::Error::InvalidArgs(format!("not held here: {name}")));
        }
        conn.release_name(name.as_str())
            .await
            .map_err(|e| zbus::fdo::Error::Failed(e.to_string()))?;
        let left = {
            let mut owned = lock(&self.owned);
            owned.retain(|n| n != &name);
            owned.len()
        };
        if left == 0 {
            let _ = self.quit.send(());
        }
        Ok(())
    }
}

/// `org.freedesktop.FileManager1`: each call opens a window.
struct FileManager1 {
    exe: PathBuf,
}

#[zbus::interface(name = "org.freedesktop.FileManager1")]
impl FileManager1 {
    /// Opens each folder (a file opens its folder with it selected).
    fn show_folders(&self, uris: Vec<String>, startup_id: String) -> zbus::fdo::Result<()> {
        self.open(LaunchMode::Open, &uris, &startup_id)
    }

    /// Opens each item's folder with the item selected.
    fn show_items(&self, uris: Vec<String>, startup_id: String) -> zbus::fdo::Result<()> {
        self.open(LaunchMode::Select, &uris, &startup_id)
    }

    /// As ShowItems, then Properties for the first item.
    fn show_item_properties(&self, uris: Vec<String>, startup_id: String) -> zbus::fdo::Result<()> {
        self.open(LaunchMode::Properties, &uris, &startup_id)
    }
}

impl FileManager1 {
    fn open(&self, mode: LaunchMode, uris: &[String], startup_id: &str) -> zbus::fdo::Result<()> {
        let mut paths = Vec::new();
        let mut skipped = Vec::new();
        for u in uris {
            match crate::startup::bus_path(u) {
                Ok(p) => paths.push(p),
                Err(why) => skipped.push(format!("{u}: {why}")),
            }
        }
        for s in &skipped {
            eprintln!("glasshouse --dbus: skipped {s}");
        }
        if paths.is_empty() {
            let why = if skipped.is_empty() { "no URIs given".to_string() } else { skipped.join("; ") };
            return Err(zbus::fdo::Error::InvalidArgs(why));
        }
        spawn_window(&self.exe, mode, &paths, startup_id).map_err(|e| zbus::fdo::Error::Failed(format!("starting a window: {e}")))
    }
}

/// The command for a window process opening `paths`.
fn window_command(exe: &Path, mode: LaunchMode, paths: &[String], startup_id: &str) -> Command {
    let mut cmd = Command::new(exe);
    match mode {
        LaunchMode::Open => {}
        LaunchMode::Select => {
            cmd.arg("--select");
        }
        LaunchMode::Properties => {
            cmd.arg("--properties");
        }
    }
    cmd.arg("--").args(paths);
    // Set for this process by the bus; the window has its own connection.
    cmd.env_remove("DBUS_STARTER_ADDRESS").env_remove("DBUS_STARTER_BUS_TYPE");
    // GTK 3 takes the startup ID from DESKTOP_STARTUP_ID alone, on X11 and
    // Wayland (startup.rs, take_activation_token).
    cmd.env_remove("XDG_ACTIVATION_TOKEN");
    if startup_id.is_empty() {
        cmd.env_remove("DESKTOP_STARTUP_ID");
    } else {
        cmd.env("DESKTOP_STARTUP_ID", startup_id);
    }
    cmd
}

fn spawn_window(exe: &Path, mode: LaunchMode, paths: &[String], startup_id: &str) -> std::io::Result<()> {
    use std::os::unix::process::CommandExt;
    let mut cmd = window_command(exe, mode, paths, startup_id);
    // Its own process group, so a signal meant for the resident (a Ctrl+C
    // when it's run by hand) leaves the windows open. stderr goes where the
    // resident's goes: the journal when the bus started it, nowhere when
    // Preferences did.
    cmd.process_group(0).stdin(Stdio::null()).stdout(Stdio::null());
    crate::commands::launch::reap(cmd.spawn()?);
    Ok(())
}

/// Starts a resident for `service` from this binary, detached, and waits
/// up to `wait` for it to end: `Some(code)` if it ended (1: the name is
/// held), `None` if it's still running, which means it owns the name.
pub(crate) fn start(service: Service, wait: Duration) -> Result<Option<i32>, String> {
    use std::os::unix::process::CommandExt;
    let exe = crate::startup::self_exe()?;
    let mut child = Command::new(exe)
        .args(["--dbus", service.arg()])
        .process_group(0)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("starting glasshouse --dbus: {e}"))?;
    let until = std::time::Instant::now() + wait;
    loop {
        if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
            return Ok(Some(status.code().unwrap_or(2)));
        }
        if std::time::Instant::now() >= until {
            crate::commands::launch::reap(child);
            return Ok(None);
        }
        std::thread::sleep(Duration::from_millis(50));
    }
}

// ---------- asking the bus ----------

/// Who answers for a bus name now.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Holder {
    Nobody,
    Glasshouse,
    /// Another program; its name and pid when the bus says.
    Other { program: Option<String>, pid: Option<u32> },
}

/// A session-bus connection for short questions: a call that gets no
/// answer (a hung owner) fails after two seconds instead of 25.
pub(crate) fn connect() -> zbus::Result<Connection> {
    zbus::blocking::connection::Builder::session()?
        .method_timeout(Duration::from_secs(2))
        .build()
}

pub(crate) fn holder(conn: &Connection, name: &str) -> zbus::Result<Holder> {
    let dbus = zbus::blocking::fdo::DBusProxy::new(conn)?;
    let owner = match dbus.get_name_owner(BusName::try_from(name)?) {
        Ok(o) => o,
        Err(zbus::fdo::Error::NameHasNoOwner(_)) => return Ok(Holder::Nobody),
        Err(e) => return Err(e.into()),
    };
    if control_of(conn, owner.as_str()).is_some() {
        return Ok(Holder::Glasshouse);
    }
    let pid = dbus.get_connection_unix_process_id(BusName::from(owner.into_inner())).ok();
    Ok(Holder::Other { program: pid.and_then(program_name), pid })
}

/// The control interface (path, name) the connection `unique` answers on,
/// if it's a glasshouse resident.
fn control_of(conn: &Connection, unique: &str) -> Option<(&'static str, &'static str)> {
    CONTROLS.into_iter().find(|(path, iface)| {
        conn.call_method(Some(unique), *path, Some("org.freedesktop.DBus.Properties"), "Get", &(*iface, "Version"))
            .is_ok()
    })
}

/// The program running as `pid`: its executable's name, else its `comm`.
fn program_name(pid: u32) -> Option<String> {
    let exe = std::fs::read_link(format!("/proc/{pid}/exe")).ok();
    exe.and_then(|p| p.file_name().map(|n| n.to_string_lossy().into_owned()))
        .or_else(|| std::fs::read_to_string(format!("/proc/{pid}/comm")).ok().map(|s| s.trim().to_string()))
        .filter(|s| !s.is_empty())
}

/// Whether the bus can start a program for `name` (it has a service file).
pub(crate) fn activatable(conn: &Connection, name: &str) -> bool {
    zbus::blocking::fdo::DBusProxy::new(conn)
        .and_then(|d| Ok(d.list_activatable_names()?))
        .is_ok_and(|names| names.iter().any(|n| n.as_str() == name))
}

/// Asks the glasshouse resident holding `name` to give it up.
pub(crate) fn release(conn: &Connection, name: &str) -> zbus::Result<()> {
    let dbus = zbus::blocking::fdo::DBusProxy::new(conn)?;
    let owner = dbus.get_name_owner(BusName::try_from(name)?)?;
    let (path, iface) = control_of(conn, owner.as_str()).unwrap_or((CONTROL_PATH, CONTROL_IFACE));
    conn.call_method(Some(name), path, Some(iface), "Release", &(name,)).map(|_| ())
}

/// Asks the bus to read its service files again, so one just written or
/// removed counts (dbus-daemon and dbus-broker both take this).
pub(crate) fn reload_config(conn: &Connection) -> zbus::Result<()> {
    zbus::blocking::fdo::DBusProxy::new(conn)?.reload_config()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_control_interface_is_named_after_the_app_identifier() {
        let id = crate::APP_ID.replace('-', "_");
        assert_eq!(CONTROL_IFACE, format!("{id}.Resident1"));
        assert_eq!(CONTROL_PATH, format!("/{}/Resident", id.replace('.', "/")));
        assert_eq!(<Control as zbus::object_server::Interface>::name().as_str(), CONTROL_IFACE);
        assert!(zbus::names::InterfaceName::try_from(CONTROL_IFACE).is_ok());
        assert!(zbus::zvariant::ObjectPath::try_from(CONTROL_PATH).is_ok());
        let old = crate::migrate::OLD_APP_ID;
        assert_eq!(OLD_CONTROL, (format!("/{}/Resident", old.replace('.', "/")).as_str(), format!("{old}.Resident1").as_str()));
    }

    #[test]
    fn services_by_name() {
        assert_eq!(parse_services(&["file-manager".into(), "file-manager".into()]), Ok(vec![Service::FileManager]));
        assert_eq!(
            parse_services(&["file-chooser".into(), "file-manager".into()]),
            Ok(vec![Service::FileChooser, Service::FileManager])
        );
        assert!(parse_services(&[]).unwrap_err().contains("file-manager, file-chooser"));
        assert!(parse_services(&["portal".into()]).unwrap_err().contains("unknown service"));
    }

    fn env_of(cmd: &Command, key: &str) -> Option<Option<String>> {
        cmd.get_envs()
            .find(|(k, _)| *k == key)
            .map(|(_, v)| v.map(|v| v.to_string_lossy().into_owned()))
    }

    #[test]
    fn a_window_gets_the_mode_the_paths_and_the_startup_id() {
        let cmd = window_command(Path::new("/opt/gh"), LaunchMode::Select, &["/a".into(), "-b".into()], "tok-1");
        let args: Vec<_> = cmd.get_args().map(|a| a.to_string_lossy().into_owned()).collect();
        assert_eq!(args, ["--select", "--", "/a", "-b"]);
        assert_eq!(env_of(&cmd, "DESKTOP_STARTUP_ID"), Some(Some("tok-1".into())));
        // Removed, not inherited.
        assert_eq!(env_of(&cmd, "XDG_ACTIVATION_TOKEN"), Some(None));
        assert_eq!(env_of(&cmd, "DBUS_STARTER_ADDRESS"), Some(None));

        let cmd = window_command(Path::new("/opt/gh"), LaunchMode::Open, &["/a".into()], "");
        let args: Vec<_> = cmd.get_args().map(|a| a.to_string_lossy().into_owned()).collect();
        assert_eq!(args, ["--", "/a"]);
        assert_eq!(env_of(&cmd, "DESKTOP_STARTUP_ID"), Some(None));
    }
}
