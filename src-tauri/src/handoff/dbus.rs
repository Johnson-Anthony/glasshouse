//! The handoff on Linux: the running app owns a name on the session bus.
//!
//! `io.github.johnson_anthony.glasshouse.App` (`AppDebug` in a debug build)
//! at `/io/github/johnson_anthony/glasshouse/App`, interface
//! `io.github.johnson_anthony.glasshouse.App1`:
//! - `Open(mode s, paths as, skipped as, startup_id s)`: a window on paths;
//!   `mode` is `open`, `select` or `properties`, as on the command line.
//! - `NewWindow(startup_id s)`: a plain window (for a guest process, the
//!   saved session; `app_windows::handed_off`).
//! - `Version` (property): the app's version.
//!
//! The session bus is per user, so only the user's own programs can call it.

use zbus::blocking::Connection;
use zbus::fdo::{RequestNameFlags, RequestNameReply};

use super::{Inbox, Outcome, Request, Server, Started, ANSWER_WITHIN};
use crate::startup::LaunchMode;

#[cfg(not(debug_assertions))]
pub const NAME: &str = "io.github.johnson_anthony.glasshouse.App";
#[cfg(debug_assertions)]
pub const NAME: &str = "io.github.johnson_anthony.glasshouse.AppDebug";
const PATH: &str = "/io/github/johnson_anthony/glasshouse/App";
const IFACE: &str = "io.github.johnson_anthony.glasshouse.App1";

/// `io.github.johnson_anthony.glasshouse.App1`.
struct App {
    inbox: Inbox,
}

#[zbus::interface(name = "io.github.johnson_anthony.glasshouse.App1")]
impl App {
    #[zbus(property)]
    fn version(&self) -> String {
        env!("CARGO_PKG_VERSION").to_string()
    }

    fn open(&self, mode: String, paths: Vec<String>, skipped: Vec<String>, startup_id: String) -> zbus::fdo::Result<()> {
        let mode = mode_of(&mode).ok_or_else(|| zbus::fdo::Error::InvalidArgs(format!("no mode {mode:?}")))?;
        let request = Request::checked(mode, paths, skipped, &startup_id).map_err(zbus::fdo::Error::InvalidArgs)?;
        self.inbox.take(request).map_err(zbus::fdo::Error::Failed)
    }

    fn new_window(&self, startup_id: String) -> zbus::fdo::Result<()> {
        let request = Request::checked(LaunchMode::Open, vec![], vec![], &startup_id).map_err(zbus::fdo::Error::InvalidArgs)?;
        self.inbox.take(request).map_err(zbus::fdo::Error::Failed)
    }
}

fn mode_of(s: &str) -> Option<LaunchMode> {
    match s {
        "open" => Some(LaunchMode::Open),
        "select" => Some(LaunchMode::Select),
        "properties" => Some(LaunchMode::Properties),
        _ => None,
    }
}

fn mode_name(m: LaunchMode) -> &'static str {
    match m {
        LaunchMode::Open => "open",
        LaunchMode::Select => "select",
        LaunchMode::Properties => "properties",
    }
}

pub fn start(request: &Request) -> Started {
    let inbox = Inbox::default();
    // The object is served before the name is claimed, so a launch that
    // finds the name finds the object too.
    let built = zbus::blocking::connection::Builder::session()
        .map(|b| b.method_timeout(ANSWER_WITHIN))
        .and_then(|b| b.serve_at(PATH, App { inbox: inbox.clone() }))
        .and_then(|b| b.build());
    let conn = match built {
        Ok(c) => c,
        Err(e) => {
            return Started::alone(format!(
                "no session bus ({e}): this window runs on its own, and a second launch opens a process of its own"
            ))
        }
    };
    // Once more if the owner went away between the two calls.
    for _ in 0..2 {
        match claim(&conn) {
            Ok(true) => return Started { outcome: Outcome::Serving(Server { inbox, conn }), notes: Vec::new() },
            Ok(false) => {}
            Err(e) => return Started::alone(format!("claiming {NAME} on the session bus: {e}; this window runs on its own")),
        }
        match call(&conn, request) {
            Ok(()) => return Started { outcome: Outcome::HandedOff, notes: Vec::new() },
            Err(e) if owner_gone(&e) => continue,
            // A timeout isn't tried again: the app may still take the first one.
            Err(e) => return Started::alone(format!("the running glasshouse didn't take the window ({e}); this one runs on its own")),
        }
    }
    Started::alone(format!("{NAME} kept changing hands; this window runs on its own"))
}

/// Whether this connection now owns the name (false: another process does,
/// which zbus reports as NameTaken).
fn claim(conn: &Connection) -> zbus::Result<bool> {
    match conn.request_name_with_flags(NAME, RequestNameFlags::DoNotQueue.into()) {
        Ok(reply) => Ok(matches!(reply, RequestNameReply::PrimaryOwner | RequestNameReply::AlreadyOwner)),
        Err(zbus::Error::NameTaken) => Ok(false),
        Err(e) => Err(e),
    }
}

fn call(conn: &Connection, request: &Request) -> zbus::Result<()> {
    let token = request.token.clone().unwrap_or_default();
    match &request.launch {
        None => conn.call_method(Some(NAME), PATH, Some(IFACE), "NewWindow", &(token,)),
        Some(l) => conn.call_method(Some(NAME), PATH, Some(IFACE), "Open", &(mode_name(l.mode), &l.paths, &l.skipped, token)),
    }
    .map(|_| ())
}

/// The call found no one: the owner ended after the name was asked for.
fn owner_gone(e: &zbus::Error) -> bool {
    matches!(e, zbus::Error::MethodError(name, ..)
        if ["org.freedesktop.DBus.Error.ServiceUnknown", "org.freedesktop.DBus.Error.NameHasNoOwner"].contains(&name.as_str()))
}

/// A request from a process that serves no windows (the resident), on a
/// short-lived connection of its own.
pub fn send_alone(request: &Request) -> Result<(), String> {
    let conn = zbus::blocking::connection::Builder::session()
        .map(|b| b.method_timeout(ANSWER_WITHIN))
        .and_then(|b| b.build())
        .map_err(|e| e.to_string())?;
    call(&conn, request).map_err(|e| e.to_string())
}

/// Gives the name back, so the next launch starts on its own.
pub fn release(conn: &Connection) {
    if let Err(e) = conn.release_name(NAME) {
        log::warn!("releasing {NAME}: {e}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn modes_go_over_the_bus_by_name() {
        for m in [LaunchMode::Open, LaunchMode::Select, LaunchMode::Properties] {
            assert_eq!(mode_of(mode_name(m)), Some(m));
        }
        assert_eq!(mode_of("Open"), None);
    }

    #[test]
    #[cfg(debug_assertions)]
    fn a_debug_build_keeps_off_the_release_name() {
        // The tests are a debug build: `tauri dev` and the e2e runs never
        // reach an installed glasshouse.
        assert_eq!(NAME, "io.github.johnson_anthony.glasshouse.AppDebug");
        assert!(PATH.starts_with("/io/github/johnson_anthony/glasshouse/"));
        assert!(IFACE.starts_with("io.github.johnson_anthony.glasshouse."));
    }
}
