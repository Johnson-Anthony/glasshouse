//! xdg-desktop-portal's FileChooser backend (Linux): the open and save
//! dialogs other apps show, served by the resident (`glasshouse --dbus
//! file-chooser`, `resident.rs`) as `org.freedesktop.impl.portal.desktop.
//! glasshouse`.
//!
//! The portal calls OpenFile, SaveFile or SaveFiles at
//! `/org/freedesktop/portal/desktop` with a `handle` path. For each call
//! this exports an `org.freedesktop.impl.portal.Request` there (its Close
//! ends the dialog), starts a chooser window process (`glasshouse
//! --chooser`, `chooser.rs`) with the request as JSON on stdin, and replies
//! once that process answers or ends. The process is in its own process
//! group (Close kills the group, WebKit's helpers too) and gets SIGTERM if
//! the resident dies.
//!
//! The portal has already checked the options' types and values (its
//! validators) and drops options it doesn't know; parsing here is lenient
//! and ignores what it can't read. See
//! docs/decisions/2026-11-20-file-chooser-backend.md.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use zbus::object_server::ObjectServer;
use zbus::zvariant::{OwnedObjectPath, OwnedValue, Value};

use crate::chooser::{ChooserAnswer, ChooserKind, ChooserRequest, Choice, Filter, Rule};
use crate::lock;

pub(crate) use crate::commands::integration_xdg::CHOOSER_NAME;
pub(crate) const PORTAL_PATH: &str = "/org/freedesktop/portal/desktop";

type Options = HashMap<String, OwnedValue>;
type Results = HashMap<String, OwnedValue>;

/// `org.freedesktop.impl.portal.FileChooser`.
pub(crate) struct FileChooser {
    pub exe: PathBuf,
}

#[zbus::interface(name = "org.freedesktop.impl.portal.FileChooser")]
impl FileChooser {
    #[zbus(out_args("response", "results"))]
    async fn open_file(
        &self,
        #[zbus(object_server)] server: &ObjectServer,
        handle: OwnedObjectPath,
        app_id: String,
        parent_window: String,
        title: String,
        options: Options,
    ) -> (u32, Results) {
        let req = request(ChooserKind::Open, app_id, parent_window, title, &options);
        self.run(server, handle, req).await
    }

    #[zbus(out_args("response", "results"))]
    async fn save_file(
        &self,
        #[zbus(object_server)] server: &ObjectServer,
        handle: OwnedObjectPath,
        app_id: String,
        parent_window: String,
        title: String,
        options: Options,
    ) -> (u32, Results) {
        let req = request(ChooserKind::Save, app_id, parent_window, title, &options);
        self.run(server, handle, req).await
    }

    #[zbus(out_args("response", "results"))]
    async fn save_files(
        &self,
        #[zbus(object_server)] server: &ObjectServer,
        handle: OwnedObjectPath,
        app_id: String,
        parent_window: String,
        title: String,
        options: Options,
    ) -> (u32, Results) {
        let req = request(ChooserKind::SaveFiles, app_id, parent_window, title, &options);
        self.run(server, handle, req).await
    }
}

impl FileChooser {
    async fn run(&self, server: &ObjectServer, handle: OwnedObjectPath, req: ChooserRequest) -> (u32, Results) {
        let job = Arc::new(Job::default());
        if let Err(e) = server.at(&handle, Request { job: job.clone() }).await {
            eprintln!("glasshouse --dbus: exporting {}: {e}", handle.as_str());
        }
        let (tx, rx) = futures_channel::oneshot::channel();
        let exe = self.exe.clone();
        let (thread_job, thread_req) = (job.clone(), req.clone());
        // The thread that starts the chooser waits for it: the chooser's
        // parent-death signal follows that thread.
        let started = std::thread::Builder::new()
            .name("chooser".into())
            .spawn(move || {
                let _ = tx.send(run_chooser(&exe, &thread_req, &thread_job));
            });
        let answer = match started {
            Ok(_) => rx.await.unwrap_or(Err("the chooser thread ended".into())),
            Err(e) => Err(format!("starting a thread: {e}")),
        };
        let _ = server.remove::<Request, _>(&handle).await;
        // After a Close the reply must be non-zero: the portal would still
        // hand a sandboxed app the files of a 0.
        if job.closed.load(Ordering::SeqCst) {
            return (2, Results::new());
        }
        match answer {
            Ok(a) => reply(&req, &a),
            Err(e) => {
                eprintln!("glasshouse --dbus: file chooser: {e}");
                (2, Results::new())
            }
        }
    }
}

/// One dialog's process, for Close.
#[derive(Default)]
struct Job {
    closed: AtomicBool,
    /// The chooser's process group, once it's running.
    group: Mutex<Option<i32>>,
}

impl Job {
    fn close(&self) {
        self.closed.store(true, Ordering::SeqCst);
        if let Some(pgid) = *lock(&self.group) {
            kill_group(pgid);
        }
    }
}

fn kill_group(pgid: i32) {
    // SAFETY: a signal to a process group this resident made.
    unsafe {
        libc::kill(-pgid, libc::SIGTERM);
    }
}

/// `org.freedesktop.impl.portal.Request` at a call's handle.
struct Request {
    job: Arc<Job>,
}

#[zbus::interface(name = "org.freedesktop.impl.portal.Request")]
impl Request {
    /// Ends the dialog; the call then replies 2.
    fn close(&self) {
        self.job.close();
    }
}

// ---------- the chooser process ----------

/// Runs one chooser for `req` and returns its answer. Blocks until the
/// process ends.
fn run_chooser(exe: &Path, req: &ChooserRequest, job: &Job) -> Result<ChooserAnswer, String> {
    use std::os::unix::process::CommandExt;
    let mut cmd = Command::new(exe);
    cmd.arg("--chooser")
        .env_remove("DBUS_STARTER_ADDRESS")
        .env_remove("DBUS_STARTER_BUS_TYPE")
        .env_remove("DESKTOP_STARTUP_ID")
        .env_remove("XDG_ACTIVATION_TOKEN")
        .process_group(0)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped());
    // SAFETY: only async-signal-safe calls between fork and exec.
    unsafe {
        let parent = libc::getpid();
        cmd.pre_exec(move || {
            libc::prctl(libc::PR_SET_PDEATHSIG, libc::SIGTERM);
            // The resident died before the line above: nothing will answer.
            if libc::getppid() != parent {
                libc::_exit(1);
            }
            Ok(())
        });
    }
    let mut child = cmd.spawn().map_err(|e| format!("starting the chooser: {e}"))?;
    *lock(&job.group) = Some(child.id() as i32);
    if job.closed.load(Ordering::SeqCst) {
        kill_group(child.id() as i32);
    }
    let body = serde_json::to_vec(req).map_err(|e| e.to_string())?;
    if let Some(mut stdin) = child.stdin.take() {
        // A chooser that died at once can't take it; its exit says so below.
        let _ = stdin.write_all(&body);
    }
    let mut out = String::new();
    if let Some(mut stdout) = child.stdout.take() {
        let _ = stdout.read_to_string(&mut out);
    }
    let status = child.wait().map_err(|e| e.to_string())?;
    // Its helpers (WebKit's) go with it.
    kill_group(child.id() as i32);
    *lock(&job.group) = None;
    match out.lines().rev().find(|l| !l.trim().is_empty()) {
        Some(line) => serde_json::from_str(line).map_err(|e| format!("a bad answer from the chooser: {e}")),
        None => Err(format!("the chooser ended without answering ({status})")),
    }
}

// ---------- options in, results out ----------

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or(Duration::ZERO).as_millis() as u64
}

fn get<T>(options: &Options, key: &str) -> Option<T>
where
    T: TryFrom<Value<'static>>,
{
    let v = options.get(key)?.try_clone().ok()?;
    T::try_from(Value::from(v)).ok()
}

/// A path the portal sends as bytes (`ay`, NUL-terminated); None when it
/// isn't absolute UTF-8.
fn byte_path(bytes: Vec<u8>) -> Option<String> {
    let bytes = bytes.strip_suffix(&[0]).unwrap_or(&bytes);
    let s = String::from_utf8(bytes.to_vec()).ok()?;
    Path::new(&s).is_absolute().then_some(s)
}

/// A name the portal sends as bytes; None when it's empty, has a `/` or
/// isn't UTF-8.
fn byte_name(bytes: Vec<u8>) -> Option<String> {
    let bytes = bytes.strip_suffix(&[0]).unwrap_or(&bytes);
    let s = String::from_utf8(bytes.to_vec()).ok()?;
    (!s.is_empty() && !s.contains('/') && s != "." && s != "..").then_some(s)
}

type WireFilter = (String, Vec<(u32, String)>);

fn filter_of((name, rules): WireFilter) -> Filter {
    let rules = rules
        .into_iter()
        .filter(|(_, p)| !p.is_empty())
        .filter_map(|(kind, pattern)| match kind {
            0 => Some(Rule { mime: false, pattern }),
            1 => Some(Rule { mime: true, pattern }),
            _ => None,
        })
        .collect();
    Filter { name, rules }
}

fn wire_filter(f: &Filter) -> WireFilter {
    (f.name.clone(), f.rules.iter().map(|r| (u32::from(r.mime), r.pattern.clone())).collect())
}

/// The request for a call, from its options.
pub(crate) fn request(kind: ChooserKind, app_id: String, parent_window: String, title: String, options: &Options) -> ChooserRequest {
    let mut filters: Vec<Filter> = if kind == ChooserKind::SaveFiles {
        Vec::new()
    } else {
        get::<Vec<WireFilter>>(options, "filters").unwrap_or_default().into_iter().map(filter_of).collect()
    };
    filters.retain(|f| !f.rules.is_empty());
    let current = (kind != ChooserKind::SaveFiles)
        .then(|| get::<WireFilter>(options, "current_filter"))
        .flatten()
        .map(filter_of)
        .filter(|f| !f.rules.is_empty());
    // A current filter with no list applies on its own (the portal's spec).
    let current_filter = current.map(|c| match filters.iter().position(|f| *f == c) {
        Some(i) => i,
        None => {
            filters.push(c);
            filters.len() - 1
        }
    });
    let choices = get::<Vec<(String, String, Vec<(String, String)>, String)>>(options, "choices")
        .unwrap_or_default()
        .into_iter()
        .map(|(id, label, options, initial)| Choice { id, label, options, initial })
        .collect();
    let current_name = get::<String>(options, "current_name").filter(|n| !n.is_empty() && kind == ChooserKind::Save);
    let files = if kind == ChooserKind::SaveFiles {
        get::<Vec<Vec<u8>>>(options, "files").unwrap_or_default().into_iter().filter_map(byte_name).collect()
    } else {
        Vec::new()
    };
    let open = kind == ChooserKind::Open;
    ChooserRequest {
        kind,
        app_id,
        title,
        accept_label: get::<String>(options, "accept_label").filter(|l| !l.trim().is_empty()),
        multiple: open && get::<bool>(options, "multiple").unwrap_or(false),
        directory: open && get::<bool>(options, "directory").unwrap_or(false),
        modal: get::<bool>(options, "modal").unwrap_or(true),
        filters,
        current_filter,
        choices,
        current_name,
        current_folder: get::<Vec<u8>>(options, "current_folder").and_then(byte_path),
        current_file: (kind == ChooserKind::Save)
            .then(|| get::<Vec<u8>>(options, "current_file").and_then(byte_path))
            .flatten(),
        files,
        parent_window,
        requested_ms: now_ms(),
    }
}

fn owned<'a>(v: impl Into<Value<'a>>) -> Option<OwnedValue> {
    v.into().try_to_owned().ok()
}

/// The `file://` URI of an absolute path.
pub(crate) fn file_uri(path: &str) -> Option<String> {
    url::Url::from_file_path(path).ok().map(String::from)
}

/// The reply for the chooser's answer.
pub(crate) fn reply(req: &ChooserRequest, a: &ChooserAnswer) -> (u32, Results) {
    if a.response != 0 {
        return (a.response.min(2), Results::new());
    }
    let uris: Vec<String> = a.paths.iter().filter_map(|p| file_uri(p)).collect();
    if uris.is_empty() {
        return (2, Results::new());
    }
    let mut out = Results::new();
    if let Some(v) = owned(uris) {
        out.insert("uris".into(), v);
    }
    // Only the app's own choices, each with one of its own values.
    let choices: Vec<(String, String)> = a
        .choices
        .iter()
        .filter(|(id, value)| {
            req.choices.iter().any(|c| {
                c.id == *id
                    && if c.options.is_empty() {
                        value == "true" || value == "false"
                    } else {
                        c.options.iter().any(|(o, _)| o == value)
                    }
            })
        })
        .cloned()
        .collect();
    if !choices.is_empty() {
        if let Some(v) = owned(choices) {
            out.insert("choices".into(), v);
        }
    }
    if let Some(f) = a.current_filter.and_then(|i| req.filters.get(i)) {
        if let Some(v) = owned(wire_filter(f)) {
            out.insert("current_filter".into(), v);
        }
    }
    (0, out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn opts(list: Vec<(&str, Value<'static>)>) -> Options {
        list.into_iter().map(|(k, v)| (k.to_string(), v.try_to_owned().unwrap())).collect()
    }

    fn bytes(s: &str) -> Value<'static> {
        let mut b = s.as_bytes().to_vec();
        b.push(0);
        Value::from(b)
    }

    fn filter(name: &str, rules: &[(u32, &str)]) -> WireFilter {
        (name.into(), rules.iter().map(|(k, p)| (*k, p.to_string())).collect())
    }

    #[test]
    fn open_file_options() {
        let o = opts(vec![
            ("accept_label", Value::from("_Attach")),
            ("multiple", Value::from(true)),
            ("modal", Value::from(false)),
            ("filters", Value::from(vec![filter("Images", &[(1, "image/png"), (0, "*.jpg")]), filter("All", &[(0, "*")])])),
            ("current_filter", Value::from(filter("All", &[(0, "*")]))),
            ("current_folder", bytes("/home/u/Pictures")),
            ("choices", Value::from(vec![("ro".to_string(), "Read only".to_string(), Vec::<(String, String)>::new(), "false".to_string())])),
        ]);
        let r = request(ChooserKind::Open, "org.x".into(), "x11:1a".into(), "Attach".into(), &o);
        assert_eq!(r.accept_label.as_deref(), Some("_Attach"));
        assert!(r.multiple && !r.directory && !r.modal);
        assert_eq!(r.filters.len(), 2);
        assert_eq!(r.filters[0].rules, [Rule { mime: true, pattern: "image/png".into() }, Rule { mime: false, pattern: "*.jpg".into() }]);
        assert_eq!(r.current_filter, Some(1));
        assert_eq!(r.current_folder.as_deref(), Some("/home/u/Pictures"));
        assert_eq!(r.choices[0].id, "ro");
        assert!(r.choices[0].options.is_empty());
        assert_eq!(r.parent_window, "x11:1a");
        // Save-only options don't apply.
        assert_eq!(r.current_name, None);
    }

    #[test]
    fn a_current_filter_without_a_list_is_the_only_filter() {
        let o = opts(vec![("current_filter", Value::from(filter("PDF", &[(1, "application/pdf")])))]);
        let r = request(ChooserKind::Open, String::new(), String::new(), String::new(), &o);
        assert_eq!(r.filters.len(), 1);
        assert_eq!(r.current_filter, Some(0));
        assert!(r.modal, "modal by default");
    }

    #[test]
    fn save_file_options() {
        let o = opts(vec![
            ("current_name", Value::from("notes.txt")),
            ("current_folder", bytes("/tmp/x")),
            ("current_file", bytes("/tmp/x/old.txt")),
            ("multiple", Value::from(true)),
            ("directory", Value::from(true)),
        ]);
        let r = request(ChooserKind::Save, String::new(), String::new(), "Save".into(), &o);
        assert_eq!(r.current_name.as_deref(), Some("notes.txt"));
        assert_eq!(r.current_file.as_deref(), Some("/tmp/x/old.txt"));
        assert!(!r.multiple && !r.directory, "open-only options don't apply");
    }

    #[test]
    fn save_files_takes_plain_names_only() {
        let names: Vec<Vec<u8>> = ["a.txt\0", "../b\0", "c d.png\0", "\0", "x/y\0"].iter().map(|s| s.as_bytes().to_vec()).collect();
        let o = opts(vec![("files", Value::from(names)), ("current_folder", bytes("/srv")), ("filters", Value::from(vec![filter("T", &[(0, "*.txt")])]))]);
        let r = request(ChooserKind::SaveFiles, String::new(), String::new(), String::new(), &o);
        assert_eq!(r.files, ["a.txt", "c d.png"]);
        assert_eq!(r.current_folder.as_deref(), Some("/srv"));
        assert!(r.filters.is_empty());
    }

    #[test]
    fn unreadable_options_are_ignored() {
        let o = opts(vec![("multiple", Value::from("yes")), ("current_folder", bytes("relative")), ("filters", Value::from(7u32))]);
        let r = request(ChooserKind::Open, String::new(), String::new(), String::new(), &o);
        assert!(!r.multiple);
        assert_eq!(r.current_folder, None);
        assert!(r.filters.is_empty());
    }

    fn get_result<T: TryFrom<Value<'static>>>(r: &Results, key: &str) -> Option<T> {
        get(r, key)
    }

    #[test]
    fn a_pick_becomes_file_uris_with_the_filter_and_choices() {
        let o = opts(vec![
            ("filters", Value::from(vec![filter("Text", &[(0, "*.txt")])])),
            ("choices", Value::from(vec![
                ("enc".to_string(), "Encoding".to_string(), vec![("utf8".to_string(), "UTF-8".to_string())], "utf8".to_string()),
            ])),
        ]);
        let req = request(ChooserKind::Save, String::new(), String::new(), String::new(), &o);
        let a = ChooserAnswer {
            response: 0,
            paths: vec!["/tmp/a b#1.txt".into()],
            choices: vec![("enc".into(), "utf8".into()), ("enc".into(), "latin1".into()), ("other".into(), "x".into())],
            current_filter: Some(0),
        };
        let (code, r) = reply(&req, &a);
        assert_eq!(code, 0);
        assert_eq!(get_result::<Vec<String>>(&r, "uris").unwrap(), ["file:///tmp/a%20b%231.txt"]);
        assert_eq!(get_result::<Vec<(String, String)>>(&r, "choices").unwrap(), [("enc".to_string(), "utf8".to_string())]);
        assert_eq!(get_result::<WireFilter>(&r, "current_filter").unwrap(), filter("Text", &[(0, "*.txt")]));
    }

    #[test]
    fn cancel_and_empty_picks_carry_nothing() {
        let req = request(ChooserKind::Open, String::new(), String::new(), String::new(), &Options::new());
        let (code, r) = reply(&req, &ChooserAnswer::cancelled());
        assert_eq!((code, r.len()), (1, 0));
        let empty = ChooserAnswer { response: 0, ..ChooserAnswer::cancelled() };
        assert_eq!(reply(&req, &empty).0, 2);
        let odd = ChooserAnswer { response: 9, ..ChooserAnswer::cancelled() };
        assert_eq!(reply(&req, &odd).0, 2);
    }
}
