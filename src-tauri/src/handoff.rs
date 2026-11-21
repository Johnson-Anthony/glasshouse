//! A second launch hands its window to the glasshouse already running, as
//! a browser does: the running app opens it, and the second process exits.
//!
//! - **Linux:** the running app owns `io.github.johnson_anthony.glasshouse.App`
//!   on the session bus (`handoff/dbus.rs`).
//! - **Windows:** a named pipe per user and session (`handoff/pipe.rs`).
//!
//! A debug build uses names of its own (`AppDebug`), so `tauri dev` and the
//! end-to-end tests never hand a window to an installed copy, nor take one
//! from it.
//!
//! Every window process (not `--chooser`, `--dbus` or `--integration-*`)
//! calls `start` before Tauri, GTK or the webview start. Its name or pipe is
//! free: it claims it and serves later launches (`Serving`); their requests
//! wait in the inbox until the app is ready. It's taken: it hands its window
//! over (`HandedOff`) and exits. Anything else (no bus, a pipe that can't be
//! made, a running app that doesn't answer within `ANSWER_WITHIN`) and it
//! runs on its own, as before (`Alone`), with a line in the log saying why.
//!
//! tauri-plugin-single-instance isn't used: it sends only the arguments and
//! the working folder, so the launcher's startup ID can't go with them, and
//! it unwraps the session bus, so a desktop with none would abort the app.
//! See docs/decisions/2026-11-21-split-and-tear-off-handoff.md.

use std::sync::{mpsc, Arc, Mutex};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::lock;
use crate::startup::{LaunchMode, LaunchRequest};

#[cfg(target_os = "linux")]
mod dbus;
#[cfg(windows)]
mod pipe;

/// How long a second launch waits for the running app's answer: an app
/// that hangs holds a launch up for no longer than this, and then the launch
/// starts on its own.
#[cfg_attr(not(any(target_os = "linux", windows)), allow(dead_code))]
pub const ANSWER_WITHIN: Duration = Duration::from_millis(1500);
/// How long the running app waits for its main thread to take a request
/// before it says no, so a launch isn't handed to an app whose windows are
/// stuck. Under `ANSWER_WITHIN`, so the launch hears the no.
const MAIN_THREAD_WITHIN: Duration = Duration::from_millis(800);
/// Paths in one request. A file manager's "Show in folder" sends one; more
/// than this isn't a launch.
const MAX_PATHS: usize = 256;
/// The longest path or note taken (Windows' long paths are 32767 UTF-16 units).
const MAX_TEXT: usize = 32 * 1024;
/// The longest startup ID taken. X11's are `name-pid-host-..._TIMEn`;
/// Wayland's are a compositor's opaque string, well under this.
const MAX_TOKEN: usize = 512;
/// Requests waiting for the app to be ready; more are refused.
const MAX_QUEUED: usize = 32;

/// A window a launch asks for.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Request {
    /// The paths it was started with; None for a plain launch.
    pub launch: Option<LaunchRequest>,
    /// The launcher's startup ID or xdg-activation token (Linux), which lets
    /// the new window take the focus.
    pub token: Option<String>,
}

impl Request {
    /// A request as it arrived from another process, checked: absolute
    /// paths or URIs only (the sender worked out its relative ones), not
    /// too many or too long, and a startup ID that could be one. A plain
    /// open with no paths is a plain window.
    pub fn checked(mode: LaunchMode, paths: Vec<String>, skipped: Vec<String>, token: &str) -> Result<Request, String> {
        if paths.len() > MAX_PATHS || skipped.len() > MAX_PATHS {
            return Err(format!("more than {MAX_PATHS} paths"));
        }
        let mut ok = Vec::new();
        let mut skip: Vec<String> = skipped.into_iter().map(|s| clip(s, MAX_TEXT)).collect();
        for p in paths {
            if p.len() > MAX_TEXT {
                skip.push(format!("{}…: too long", clip(p, 80)));
                continue;
            }
            match crate::startup::bus_path(&p) {
                Ok(abs) => ok.push(abs),
                Err(why) => skip.push(format!("{p}: {why}")),
            }
        }
        let launch = if ok.is_empty() && skip.is_empty() && mode == LaunchMode::Open {
            None
        } else {
            Some(LaunchRequest { mode, paths: ok, skipped: skip })
        };
        Ok(Request { launch, token: token_of(token) })
    }
}

fn clip(mut s: String, max: usize) -> String {
    if s.len() > max {
        let mut at = max;
        while !s.is_char_boundary(at) {
            at -= 1;
        }
        s.truncate(at);
    }
    s
}

/// A startup ID that could be one: not empty, not too long, no control
/// characters. Anything else is dropped, and the window asks for the focus
/// the usual way.
fn token_of(t: &str) -> Option<String> {
    (!t.is_empty() && t.len() <= MAX_TOKEN && !t.chars().any(char::is_control)).then(|| t.to_string())
}

/// The message a launch writes to the pipe (Windows): JSON on one line.
#[derive(Serialize, Deserialize)]
struct Message {
    version: u32,
    launch: Option<LaunchRequest>,
}

const MESSAGE_VERSION: u32 = 1;
/// The most a message may take.
#[cfg_attr(not(windows), allow(dead_code))]
const MAX_MESSAGE: usize = 1024 * 1024;

#[cfg_attr(not(windows), allow(dead_code))]
fn encode(request: &Request) -> String {
    let mut line = serde_json::to_string(&Message { version: MESSAGE_VERSION, launch: request.launch.clone() })
        .unwrap_or_else(|_| format!(r#"{{"version":{MESSAGE_VERSION},"launch":null}}"#));
    line.push('\n');
    line
}

/// A message from the pipe, checked as `Request::checked` checks a D-Bus
/// call. Windows has no startup ID: the launch lets the app take the
/// foreground instead (`AllowSetForegroundWindow`).
#[cfg_attr(not(windows), allow(dead_code))]
fn decode(text: &str) -> Result<Request, String> {
    let m: Message = serde_json::from_str(text.trim_end()).map_err(|e| format!("not a request: {e}"))?;
    if m.version != MESSAGE_VERSION {
        return Err(format!("request version {} (this glasshouse reads {MESSAGE_VERSION})", m.version));
    }
    match m.launch {
        None => Ok(Request { launch: None, token: None }),
        Some(l) => Request::checked(l.mode, l.paths, l.skipped, ""),
    }
}

/// What `start` found.
pub enum Outcome {
    /// The running app took the window: this process is done.
    HandedOff,
    /// This process answers later launches.
    Serving(Server),
    /// Neither: it runs on its own.
    Alone,
}

/// What `start` found, and what to log about it once the log is up.
pub struct Started {
    pub outcome: Outcome,
    pub notes: Vec<(log::Level, String)>,
}

impl Started {
    #[cfg_attr(not(any(target_os = "linux", windows)), allow(dead_code))]
    fn alone(why: String) -> Started {
        Started { outcome: Outcome::Alone, notes: vec![(log::Level::Warn, why)] }
    }
}

/// Hands `request` to the running app, or else claims the name or pipe so
/// later launches come here. Never fails: at worst this process runs alone.
pub fn start(request: &Request) -> Started {
    #[cfg(target_os = "linux")]
    {
        dbus::start(request)
    }
    #[cfg(windows)]
    {
        pipe::start(request)
    }
    #[cfg(not(any(target_os = "linux", windows)))]
    {
        let _ = request;
        Started { outcome: Outcome::Alone, notes: Vec::new() }
    }
}

/// Asks the running app for a window, from a process that isn't one: the
/// resident, for a FileManager1 call (Linux). Err when no app took it.
#[cfg(target_os = "linux")]
pub fn send(request: &Request) -> Result<(), String> {
    dbus::send_alone(request)
}

/// This process's name or pipe, and the requests that came to it.
pub struct Server {
    inbox: Inbox,
    #[cfg(target_os = "linux")]
    conn: zbus::blocking::Connection,
}

impl Server {
    /// The app is ready: queued requests open their windows now, and later
    /// ones as they come.
    pub fn attach(&self, app: &AppHandle) {
        self.inbox.attach(app);
    }

    /// The app is ending: later launches start on their own (an update's
    /// restart among them) instead of handing a window to an app that's
    /// going away.
    pub fn stop(&self) {
        self.inbox.close();
        #[cfg(target_os = "linux")]
        dbus::release(&self.conn);
    }
}

/// Requests from later launches. Until the app is ready they wait; after
/// that each one is taken only once the main thread has answered, so a
/// launch isn't handed to an app that can't make windows.
#[derive(Clone, Default)]
pub struct Inbox(Arc<Mutex<InboxState>>);

#[derive(Default)]
enum InboxState {
    #[default]
    Starting,
    Queued(Vec<Request>),
    Ready(AppHandle, mpsc::Sender<Request>),
    Closed,
}

impl Inbox {
    /// Takes `request`, or says why not (the launch then starts on its own).
    #[cfg_attr(not(any(target_os = "linux", windows)), allow(dead_code))]
    pub fn take(&self, request: Request) -> Result<(), String> {
        let (app, tx) = {
            let mut state = lock(&self.0);
            match &mut *state {
                InboxState::Starting => {
                    *state = InboxState::Queued(vec![request]);
                    return Ok(());
                }
                InboxState::Queued(q) if q.len() < MAX_QUEUED => {
                    q.push(request);
                    return Ok(());
                }
                InboxState::Queued(_) => return Err("glasshouse is still starting".into()),
                InboxState::Ready(app, tx) => (app.clone(), tx.clone()),
                InboxState::Closed => return Err("glasshouse is quitting".into()),
            }
        };
        // Whichever comes first takes the request: the main thread, which
        // passes it on, or the timeout, which refuses it. Never both.
        let slot = Arc::new(Mutex::new(Some(request)));
        let (ack_tx, ack_rx) = mpsc::channel();
        let theirs = slot.clone();
        app.run_on_main_thread(move || {
            if let Some(r) = lock(&theirs).take() {
                let _ = tx.send(r);
                let _ = ack_tx.send(());
            }
        })
        .map_err(|e| e.to_string())?;
        match ack_rx.recv_timeout(MAIN_THREAD_WITHIN) {
            Ok(()) => Ok(()),
            Err(_) if lock(&slot).take().is_some() => Err("glasshouse isn't answering".into()),
            Err(_) => Ok(()),
        }
    }

    /// Opens the queued requests' windows, in order, and every later one's,
    /// one at a time on a thread of its own (making a window waits on the
    /// main thread).
    fn attach(&self, app: &AppHandle) {
        let (tx, rx) = mpsc::channel::<Request>();
        let before = std::mem::replace(&mut *lock(&self.0), InboxState::Ready(app.clone(), tx.clone()));
        if let InboxState::Queued(q) = before {
            for r in q {
                let _ = tx.send(r);
            }
        }
        drop(tx);
        let app = app.clone();
        let spawned = std::thread::Builder::new().name("handoff".into()).spawn(move || {
            for r in rx {
                crate::app_windows::handed_off(&app, r.launch, r.token);
            }
        });
        if let Err(e) = spawned {
            log::warn!("handing windows over: {e}");
            self.close();
        }
    }

    fn close(&self) {
        *lock(&self.0) = InboxState::Closed;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn abs(p: &str) -> String {
        // An absolute path on the platform the tests run on.
        if cfg!(windows) {
            format!("C:\\{}", p.replace('/', "\\"))
        } else {
            format!("/{p}")
        }
    }

    #[test]
    fn a_plain_launch_is_a_plain_window() {
        let r = Request::checked(LaunchMode::Open, vec![], vec![], "tok_TIME5").unwrap();
        assert_eq!(r, Request { launch: None, token: Some("tok_TIME5".into()) });
        // --select with nothing is still a launch (the window says so).
        let r = Request::checked(LaunchMode::Select, vec![], vec![], "").unwrap();
        assert_eq!(r.launch.unwrap().mode, LaunchMode::Select);
        assert_eq!(r.token, None);
    }

    #[test]
    fn only_absolute_paths_and_uris_are_taken() {
        let r = Request::checked(
            LaunchMode::Open,
            vec![abs("home/a"), "relative/b".into(), "".into()],
            vec!["--bad: unknown option".into()],
            "",
        )
        .unwrap();
        let launch = r.launch.unwrap();
        assert_eq!(launch.paths, [abs("home/a")]);
        assert_eq!(launch.skipped.len(), 3, "{:?}", launch.skipped);
        assert!(launch.skipped[1].starts_with("relative/b: "));
    }

    #[test]
    fn too_much_is_refused_or_clipped() {
        let many = vec![abs("a"); MAX_PATHS + 1];
        assert!(Request::checked(LaunchMode::Open, many, vec![], "").is_err());
        let long = abs(&"x".repeat(MAX_TEXT));
        let r = Request::checked(LaunchMode::Open, vec![long], vec!["é".repeat(MAX_TEXT)], "").unwrap();
        let launch = r.launch.unwrap();
        assert!(launch.paths.is_empty());
        assert!(launch.skipped[0].len() <= MAX_TEXT);
        assert!(launch.skipped[1].ends_with("too long"));
    }

    #[test]
    fn a_startup_id_must_look_like_one() {
        assert_eq!(token_of("gnome-shell/glasshouse/1234-0-host_TIME98765"), Some("gnome-shell/glasshouse/1234-0-host_TIME98765".into()));
        assert_eq!(token_of(""), None);
        assert_eq!(token_of("a\nb"), None);
        assert_eq!(token_of(&"t".repeat(MAX_TOKEN + 1)), None);
    }

    #[test]
    fn requests_wait_until_the_app_is_ready_and_are_refused_once_it_ends() {
        let inbox = Inbox::default();
        let plain = || Request { launch: None, token: None };
        for _ in 0..MAX_QUEUED {
            assert_eq!(inbox.take(plain()), Ok(()));
        }
        // A launch that can't be queued starts on its own.
        assert!(inbox.take(plain()).is_err());
        assert!(matches!(&*lock(&inbox.0), InboxState::Queued(q) if q.len() == MAX_QUEUED));
        inbox.close();
        assert_eq!(inbox.take(plain()), Err("glasshouse is quitting".to_string()));
    }

    #[test]
    fn a_pipe_message_reads_back_as_sent() {
        let plain = Request { launch: None, token: None };
        assert_eq!(decode(&encode(&plain)), Ok(plain));
        let launch = LaunchRequest { mode: LaunchMode::Properties, paths: vec![abs("a b/c")], skipped: vec!["x: why".into()] };
        let r = Request { launch: Some(launch), token: None };
        let line = encode(&r);
        assert!(line.ends_with('\n') && !line.trim_end().contains('\n'));
        assert_eq!(decode(&line), Ok(r));
    }

    #[test]
    fn a_pipe_message_is_checked_like_a_bus_call() {
        assert!(decode("not json").is_err());
        assert!(decode(r#"{"version":2,"launch":null}"#).is_err());
        let r = decode(r#"{"version":1,"launch":{"mode":"open","paths":["rel"],"skipped":[]}}"#).unwrap();
        assert_eq!(r.launch.unwrap().paths, Vec::<String>::new());
    }
}
