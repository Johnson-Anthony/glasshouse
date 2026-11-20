//! The open and save dialog other apps get through xdg-desktop-portal
//! (Linux): `glasshouse --chooser`, one process per dialog.
//!
//! The resident's FileChooser backend (`portal.rs`) starts it with a
//! `ChooserRequest` as JSON on stdin. At start this process moves its stdout
//! aside (to a close-on-exec descriptor, so WebKit's helper processes never
//! hold it) and points fd 1 at stderr. It answers with one `ChooserAnswer`
//! line there, then exits. Closing the window, or the app's Esc and Cancel,
//! answer 1 (cancelled).
//!
//! The window is `chooser.html` (`src/chooser/`): it's made hidden and shown
//! once the page has rendered (`chooser_ready`), parented to the calling
//! app's window when the request names one and the display can (`x11:` XID,
//! `wayland:` xdg-foreign handle), else a free dialog. `chooser_painted`
//! logs the time from the D-Bus call to the first frame. See
//! docs/decisions/2026-11-20-file-chooser-backend.md.
//!
//! The types and commands build everywhere (the main window's command list
//! is shared); only Linux ever runs a chooser.

use std::fs::File;
use std::sync::Mutex;
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};

use crate::commands::listing::FileEntry;
use crate::lock;
use crate::ops::OpRegistry;

/// Which portal call this dialog answers.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ChooserKind {
    /// OpenFile: pick existing files, or folders with `directory`.
    Open,
    /// SaveFile: pick a folder and a name.
    Save,
    /// SaveFiles: pick a folder for the request's `files`.
    SaveFiles,
}

/// One pattern of a filter, as the portal gives it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Rule {
    /// A MIME type (`image/png`, `image/*`) rather than a glob (`*.png`).
    pub mime: bool,
    pub pattern: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Filter {
    pub name: String,
    pub rules: Vec<Rule>,
}

/// A choice the app adds to the dialog: a list of options, or a checkbox
/// (no options; its value is "true" or "false").
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Choice {
    pub id: String,
    pub label: String,
    pub options: Vec<(String, String)>,
    /// The option picked at first; "" lets the dialog decide.
    pub initial: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChooserRequest {
    pub kind: ChooserKind,
    /// The calling app's ID ("" for an app outside a sandbox), so the last
    /// folder can be remembered per app.
    pub app_id: String,
    pub title: String,
    pub accept_label: Option<String>,
    pub multiple: bool,
    pub directory: bool,
    pub modal: bool,
    pub filters: Vec<Filter>,
    /// Index into `filters`.
    pub current_filter: Option<usize>,
    pub choices: Vec<Choice>,
    /// Save: the suggested name.
    pub current_name: Option<String>,
    pub current_folder: Option<String>,
    /// Save: the file being saved again.
    pub current_file: Option<String>,
    /// SaveFiles: the names to save.
    pub files: Vec<String>,
    /// `x11:<xid>`, `wayland:<handle>` or "".
    pub parent_window: String,
    /// When the call reached the resident, in ms since the epoch (0: unknown).
    pub requested_ms: u64,
}

/// What the dialog answers: 0 picked (`paths`), 1 cancelled, 2 ended
/// otherwise.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChooserAnswer {
    pub response: u32,
    #[serde(default)]
    pub paths: Vec<String>,
    /// (choice id, value) for every choice.
    #[serde(default)]
    pub choices: Vec<(String, String)>,
    /// Index into the request's `filters`.
    #[serde(default)]
    pub current_filter: Option<usize>,
}

impl ChooserAnswer {
    #[cfg_attr(not(target_os = "linux"), allow(dead_code))]
    pub fn cancelled() -> Self {
        ChooserAnswer { response: 1, paths: vec![], choices: vec![], current_filter: None }
    }
}

/// A filter's patterns as the page matches them: the globs, plus the globs
/// of each MIME type and its subtypes (shared-mime-info).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Glob {
    pub pattern: String,
    /// The portal's own globs are case-sensitive (its spec says so); most
    /// shared-mime-info ones aren't.
    pub case_sensitive: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChooserView {
    pub request: ChooserRequest,
    /// One list per filter, in order.
    pub globs: Vec<Vec<Glob>>,
}

/// This process's dialog, or none in a normal window.
pub struct Chooser {
    request: Option<ChooserRequest>,
    answer: Mutex<Option<File>>,
    started: Instant,
    shown: Mutex<Option<Instant>>,
}

impl Chooser {
    pub fn none() -> Self {
        Chooser { request: None, answer: Mutex::new(None), started: Instant::now(), shown: Mutex::new(None) }
    }

    /// The window's title: the app's, else what the dialog does.
    #[cfg(target_os = "linux")]
    pub fn title(&self) -> &str {
        match &self.request {
            Some(r) if !r.title.trim().is_empty() => &r.title,
            Some(r) => match (r.kind, r.directory) {
                (ChooserKind::Open, true) => "Select Folder",
                (ChooserKind::Open, false) => "Open File",
                (ChooserKind::Save, _) => "Save File",
                (ChooserKind::SaveFiles, _) => "Save Files",
            },
            None => "glasshouse",
        }
    }

    fn request(&self) -> Result<&ChooserRequest, String> {
        self.request.as_ref().ok_or_else(|| "this window isn't a file chooser".to_string())
    }

    /// Sends `answer`, once; later calls do nothing.
    fn send(&self, answer: &ChooserAnswer) -> Result<(), String> {
        use std::io::Write;
        let Some(mut out) = lock(&self.answer).take() else { return Ok(()) };
        let mut line = serde_json::to_string(answer).map_err(|e| e.to_string())?;
        line.push('\n');
        out.write_all(line.as_bytes()).map_err(|e| format!("answering the portal: {e}"))
    }
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_millis() as u64)
}

// ---------- the page's commands ----------

/// The dialog to show, or null in a normal window.
#[tauri::command]
pub fn chooser_request(state: State<'_, Chooser>) -> Option<ChooserView> {
    let request = state.request.clone()?;
    let globs = filter_globs(&request.filters);
    Some(ChooserView { request, globs })
}

/// The page has rendered: parent the window to the caller's and show it.
#[tauri::command]
pub fn chooser_ready(window: tauri::WebviewWindow, state: State<'_, Chooser>) -> Result<(), String> {
    let req = state.request()?;
    let parent = req.parent_window.clone();
    let modal = req.modal;
    let w = window.clone();
    window
        .run_on_main_thread(move || show_dialog(&w, &parent, modal))
        .map_err(|e| e.to_string())?;
    *lock(&state.shown) = Some(Instant::now());
    Ok(())
}

/// The first frame after showing is on screen: logs how long the dialog
/// took, from the call reaching the resident and from this process's start.
#[tauri::command]
pub fn chooser_painted(state: State<'_, Chooser>) -> Result<(), String> {
    let req = state.request()?;
    let process = state.started.elapsed().as_millis();
    let call = (req.requested_ms > 0).then(|| now_ms().saturating_sub(req.requested_ms));
    let shown = lock(&state.shown).map(|t| t.elapsed().as_millis());
    match call {
        Some(ms) => eprintln!(
            "glasshouse --chooser: first paint {ms} ms after the call ({process} ms after this process started; shown {} ms before)",
            shown.unwrap_or(0)
        ),
        None => eprintln!("glasshouse --chooser: first paint {process} ms after this process started"),
    }
    Ok(())
}

/// Answers the portal and closes the dialog.
#[tauri::command]
pub fn chooser_finish(app: AppHandle, state: State<'_, Chooser>, answer: ChooserAnswer) -> Result<(), String> {
    state.request()?;
    state.send(&answer)?;
    app.exit(0);
    Ok(())
}

/// Files and folders under `root` whose name contains `pattern` (any
/// case), for the dialog's search: at most `limit`, staying on `root`'s
/// file system, hidden ones only with `show_hidden`. Ignore files don't
/// apply: a build output is still a file to attach.
#[tauri::command(async)]
pub fn chooser_search(
    app: AppHandle,
    ops: State<'_, OpRegistry>,
    root: String,
    pattern: String,
    show_hidden: bool,
    limit: u32,
    op_id: Option<String>,
) -> Result<Vec<FileEntry>, String> {
    let op = ops.start(op_id, &app);
    let needle = pattern.trim().to_lowercase();
    if needle.is_empty() {
        return Ok(Vec::new());
    }
    let cap = (limit as usize).clamp(1, 2000);
    let walk = ignore::WalkBuilder::new(&root)
        .standard_filters(false)
        .hidden(!show_hidden)
        .same_file_system(true)
        .follow_links(false)
        .build();
    let mut out = Vec::new();
    for entry in walk {
        op.check()?;
        let Ok(entry) = entry else { continue };
        if entry.depth() == 0 {
            continue;
        }
        op.advance(1);
        let name = entry.file_name().to_string_lossy();
        if !name.to_lowercase().contains(&needle) {
            continue;
        }
        if let Some(e) = crate::commands::listing::entry_at(entry.path()) {
            out.push(e);
            if out.len() >= cap {
                break;
            }
        }
    }
    Ok(out)
}

// ---------- filters ----------

/// Each filter's globs, MIME types turned into theirs.
fn filter_globs(filters: &[Filter]) -> Vec<Vec<Glob>> {
    let needs_db = filters.iter().any(|f| f.rules.iter().any(|r| r.mime));
    let db = needs_db.then(mime_db).flatten();
    filters
        .iter()
        .map(|f| {
            let mut out: Vec<Glob> = Vec::new();
            let mut add = |g: Glob| {
                if !out.contains(&g) {
                    out.push(g);
                }
            };
            for r in &f.rules {
                if !r.mime {
                    add(Glob { pattern: r.pattern.clone(), case_sensitive: true });
                    continue;
                }
                for (pattern, case_sensitive) in mime_globs(db.as_ref(), &r.pattern) {
                    add(Glob { pattern, case_sensitive });
                }
            }
            out
        })
        .collect()
}

use crate::commands::xdg_apps::{MimeDb, XdgDirs};

fn mime_db() -> Option<MimeDb> {
    XdgDirs::from_env().map(|dirs| MimeDb::load(&dirs))
}

/// The globs for a MIME filter. Every file is an `application/octet-stream`
/// (and `*/*`); otherwise the types it names and their subtypes, by name
/// only: a file no glob types (a `README`) matches only those two.
fn mime_globs(db: Option<&MimeDb>, mime: &str) -> Vec<(String, bool)> {
    if mime == "application/octet-stream" || mime == "*/*" || mime == "*" {
        return vec![("*".into(), false)];
    }
    db.map(|db| db.globs_for(mime)).unwrap_or_default()
}

// ---------- the process ----------

/// `glasshouse --chooser`: reads the request and runs the dialog. The exit
/// code is 0 once it has answered, 2 for a bad request.
#[cfg(target_os = "linux")]
pub fn run() -> i32 {
    let (request, answer) = match take_request() {
        Ok(r) => r,
        Err(e) => {
            eprintln!("glasshouse --chooser: {e}");
            return 2;
        }
    };
    let state = Chooser {
        request: Some(request),
        answer: Mutex::new(Some(answer)),
        started: Instant::now(),
        shown: Mutex::new(None),
    };
    crate::run_chooser(state);
    0
}

/// Moves stdout aside for the answer and reads the request from stdin.
#[cfg(target_os = "linux")]
fn take_request() -> Result<(ChooserRequest, File), String> {
    use std::io::Read;
    use std::os::fd::FromRawFd;
    // SAFETY: plain fd calls on this process's own descriptors, before any
    // other thread runs; the new descriptor is owned by the File.
    let answer = unsafe {
        let fd = libc::fcntl(1, libc::F_DUPFD_CLOEXEC, 3);
        if fd < 0 {
            return Err(format!("no answer pipe: {}", std::io::Error::last_os_error()));
        }
        libc::dup2(2, 1);
        File::from_raw_fd(fd)
    };
    let mut text = String::new();
    std::io::stdin().read_to_string(&mut text).map_err(|e| format!("reading the request: {e}"))?;
    let request = serde_json::from_str(&text).map_err(|e| format!("bad request: {e}"))?;
    Ok((request, answer))
}

/// What the window does at exit: a dialog closed without an answer (the
/// window's close button) answers "cancelled".
#[cfg(target_os = "linux")]
pub fn at_exit(state: &Chooser) {
    if state.request.is_some() {
        let _ = state.send(&ChooserAnswer::cancelled());
    }
}

/// Makes the window a dialog of the caller's, where the display allows,
/// and shows it. Runs on the main thread.
#[cfg(target_os = "linux")]
fn show_dialog(window: &tauri::WebviewWindow, parent: &str, modal: bool) {
    use gtk::prelude::*;
    let Ok(gtk_window) = window.gtk_window() else {
        let _ = window.show();
        return;
    };
    // A dialog type: window managers place and float it as one (X11; on
    // Wayland the parent does that).
    gtk_window.set_type_hint(gtk::gdk::WindowTypeHint::Dialog);
    gtk_window.set_modal(modal);
    gtk_window.realize();
    let how = match gtk_window.window() {
        Some(gdk_window) => parent::attach(&gdk_window, parent),
        None => Err("no window yet".into()),
    };
    match how {
        Ok(how) => eprintln!("glasshouse --chooser: parented to {parent} ({how})"),
        Err(why) if parent.is_empty() => {
            let _ = why;
        }
        Err(why) => eprintln!("glasshouse --chooser: not parented to {parent}: {why}"),
    }
    let _ = window.show();
}

#[cfg(not(target_os = "linux"))]
fn show_dialog(window: &tauri::WebviewWindow, _parent: &str, _modal: bool) {
    let _ = window.show();
}

/// Setting a foreign window as the parent. GDK's X11 and Wayland calls are
/// looked up at run time, so a GTK built without one of those backends
/// still starts.
#[cfg(target_os = "linux")]
mod parent {
    use std::ffi::{c_char, c_int, c_ulong, c_void, CString};

    use gtk::gdk;
    use gtk::glib::object::ObjectType;
    use gtk::glib::translate::{FromGlibPtrFull, ToGlibPtr};
    use gtk::prelude::*;

    fn symbol(name: &std::ffi::CStr) -> Option<*mut c_void> {
        // SAFETY: dlsym with RTLD_DEFAULT only looks a name up.
        let p = unsafe { libc::dlsym(libc::RTLD_DEFAULT, name.as_ptr()) };
        (!p.is_null()).then_some(p)
    }

    /// The XID in an `x11:` handle (hex, as the portal spec has it).
    pub(super) fn parse_xid(s: &str) -> Option<c_ulong> {
        let hex = s.strip_prefix("0x").or_else(|| s.strip_prefix("0X")).unwrap_or(s);
        c_ulong::from_str_radix(hex, 16).ok().filter(|x| *x != 0)
    }

    pub(super) fn attach(window: &gdk::Window, parent: &str) -> Result<&'static str, String> {
        let display = window.display();
        let display_type = display.type_().name();
        if let Some(xid) = parent.strip_prefix("x11:") {
            if display_type != "GdkX11Display" {
                return Err("an X11 parent, but this window isn't on X11".into());
            }
            let xid = parse_xid(xid).ok_or("not an X window ID")?;
            let f = symbol(c"gdk_x11_window_foreign_new_for_display").ok_or("GDK has no X11 backend")?;
            // SAFETY: GDK's own signature; the display is an X11 one.
            let foreign = unsafe {
                let f: unsafe extern "C" fn(*mut gdk::ffi::GdkDisplay, c_ulong) -> *mut gdk::ffi::GdkWindow =
                    std::mem::transmute(f);
                f(display.to_glib_none().0, xid)
            };
            if foreign.is_null() {
                return Err("no such X window".into());
            }
            // SAFETY: a new reference GDK hands over.
            let foreign = unsafe { gdk::Window::from_glib_full(foreign) };
            window.set_transient_for(&foreign);
            return Ok("X11 transient-for");
        }
        if let Some(handle) = parent.strip_prefix("wayland:") {
            if display_type != "GdkWaylandDisplay" {
                return Err("a Wayland parent, but this window isn't on Wayland".into());
            }
            let f = symbol(c"gdk_wayland_window_set_transient_for_exported").ok_or("GDK has no Wayland backend")?;
            let handle = CString::new(handle).map_err(|_| "a bad handle")?;
            // SAFETY: GDK's own signature; the window is a Wayland one. GDK
            // copies the handle.
            let ok = unsafe {
                let f: unsafe extern "C" fn(*mut gdk::ffi::GdkWindow, *mut c_char) -> c_int = std::mem::transmute(f);
                f(window.as_ptr(), handle.as_ptr() as *mut c_char)
            };
            return if ok != 0 {
                Ok("xdg-foreign")
            } else {
                Err("the compositor has no xdg-foreign v1 (zxdg_importer_v1)".into())
            };
        }
        if parent.is_empty() {
            return Err("no parent given".into());
        }
        Err("an unknown kind of window handle".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_request_round_trips_as_the_page_reads_it() {
        let req = ChooserRequest {
            kind: ChooserKind::SaveFiles,
            app_id: "org.example.App".into(),
            title: "Save".into(),
            accept_label: Some("_Save".into()),
            multiple: false,
            directory: false,
            modal: true,
            filters: vec![Filter { name: "Images".into(), rules: vec![Rule { mime: true, pattern: "image/png".into() }] }],
            current_filter: Some(0),
            choices: vec![Choice { id: "enc".into(), label: "Encoding".into(), options: vec![("utf8".into(), "UTF-8".into())], initial: "utf8".into() }],
            current_name: None,
            current_folder: Some("/tmp".into()),
            current_file: None,
            files: vec!["a.txt".into()],
            parent_window: "x11:3a00004".into(),
            requested_ms: 5,
        };
        let json = serde_json::to_value(&req).unwrap();
        assert_eq!(json["kind"], "saveFiles");
        assert_eq!(json["acceptLabel"], "_Save");
        assert_eq!(json["choices"][0]["options"][0][1], "UTF-8");
        let back: ChooserRequest = serde_json::from_value(json).unwrap();
        assert_eq!(back, req);
    }

    #[test]
    fn an_answer_may_leave_out_what_it_has_none_of() {
        let a: ChooserAnswer = serde_json::from_str(r#"{"response":1}"#).unwrap();
        assert_eq!(a, ChooserAnswer::cancelled());
        let a: ChooserAnswer =
            serde_json::from_str(r#"{"response":0,"paths":["/a b"],"choices":[["x","true"]],"currentFilter":1}"#).unwrap();
        assert_eq!(a.paths, ["/a b"]);
        assert_eq!(a.choices, [("x".to_string(), "true".to_string())]);
        assert_eq!(a.current_filter, Some(1));
    }

    #[test]
    fn globs_stay_case_sensitive_and_octet_stream_takes_everything() {
        let filters = vec![
            Filter { name: "Text".into(), rules: vec![Rule { mime: false, pattern: "*.txt".into() }, Rule { mime: false, pattern: "*.txt".into() }] },
            Filter { name: "All".into(), rules: vec![Rule { mime: true, pattern: "application/octet-stream".into() }] },
        ];
        let g = filter_globs(&filters);
        assert_eq!(g[0], [Glob { pattern: "*.txt".into(), case_sensitive: true }]);
        assert_eq!(g[1], [Glob { pattern: "*".into(), case_sensitive: false }]);
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn x11_handles_are_hex() {
        assert_eq!(parent::parse_xid("3a00004"), Some(0x3a00004));
        assert_eq!(parent::parse_xid("0x1E"), Some(0x1e));
        assert_eq!(parent::parse_xid("0"), None);
        assert_eq!(parent::parse_xid("zz"), None);
    }
}
