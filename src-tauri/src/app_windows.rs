//! Every glasshouse window, in one process, as a browser keeps them: File →
//! New Window, the command line, a second launch (`handoff.rs`) and the
//! FileManager1 resident all open windows here. Only `--chooser` (another
//! app's dialog) is still a process of its own.
//!
//! Labels are `main` and `main-<n>`, the lowest one free; the capability
//! in `capabilities/default.json` matches both, and the window-state plugin
//! keys each window's size and place by its label. The config's window
//! isn't made by Tauri (`"create": false`): every window, the first too,
//! is made here from it.
//!
//! The registry knows, per window: what its page starts with (`Start`), its
//! last session report, and whether it has the focus. The session
//! (`session.rs`) is written from it. A window's watches and terminals go
//! when it closes, or when its page loads again (a reload forgets them).
//! See docs/decisions/2026-11-21-split-and-tear-off-one-process.md.

use std::collections::{HashMap, HashSet};
use std::sync::Mutex;

use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize, State, WebviewWindow, WebviewWindowBuilder};

use crate::lock;
use crate::session::{self, has_tabs, Saved, SavedWindow, Session};
use crate::startup::{LaunchMode, LaunchRequest};
use crate::window_fit;

/// The first window's label, and the stem of the others'.
pub const FIRST: &str = "main";
/// `main-2` … `main-9999`.
const MAX_N: u32 = 9999;

/// Whether `label` is one this module gives out (and a saved session may
/// name): `main`, or `main-<n>` for n from 2, no leading zeros.
pub fn valid_label(label: &str) -> bool {
    label == FIRST
        || label
            .strip_prefix("main-")
            .and_then(|n| (!n.starts_with('0') && n.bytes().all(|b| b.is_ascii_digit())).then(|| n.parse::<u32>().ok()))
            .flatten()
            .is_some_and(|n| (2..=MAX_N).contains(&n))
}

/// What a window's page opens with.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Start {
    /// One tab at home: New Window, a plain second launch.
    Plain,
    /// The paths another app or the command line handed over.
    Launch { launch: LaunchRequest },
    /// Its tabs, as saved or as it last reported them (a page that loads
    /// again keeps its tabs). The page checks the record field by field.
    Restore { session: Value },
    /// The first window, with no session file yet: the tabs in the v1
    /// localStorage key (0.2 and the builds before one process).
    Legacy,
    /// A tab moved out of another window (`tab_drag.rs`): its record
    /// (`src/tabTransfer.ts`), which the page checks field by field.
    Transfer { tab: Value },
}

/// What the session keeps for a window made with tab `tab`, until its page
/// reports: that tab, unless it's private.
fn seed_report(tab: &Value) -> Value {
    let private = tab.get("private").and_then(Value::as_bool).unwrap_or(true);
    match tab.get("path").and_then(Value::as_str) {
        Some(path) if !private => json!({ "tabs": [{ "path": path, "sort": tab.get("sort").cloned().unwrap_or(Value::Null) }], "active": 0 }),
        _ => json!({ "tabs": [], "active": 0 }),
    }
}

/// The windows, what their pages start with, and their session reports.
#[derive(Debug, Default)]
pub struct Registry {
    /// Live windows, in the order they opened.
    open: Vec<String>,
    /// The session's windows in order: the live ones, plus the last one
    /// closed (closing it quit the app) and every one open at Quit.
    session: Vec<String>,
    starts: HashMap<String, Start>,
    reports: HashMap<String, Value>,
    focused: Option<String>,
    /// Labels a guest process leaves free: the saved session's, so the
    /// windows it brings back when it becomes the owner keep theirs.
    reserved: HashSet<String>,
    quitting: bool,
}

impl Registry {
    /// The lowest label no window has, nor the saved session.
    pub fn next_label(&self) -> String {
        let taken = |l: &str| self.open.iter().any(|o| o == l) || self.reserved.contains(l);
        if !taken(FIRST) {
            return FIRST.to_string();
        }
        (2..=MAX_N)
            .map(|n| format!("main-{n}"))
            .find(|l| !taken(l))
            .unwrap_or_else(|| format!("main-{MAX_N}"))
    }

    /// A window is being made with `label`. A restored one's saved tabs
    /// count as its report until its page sends one.
    pub fn add(&mut self, label: &str, start: Start) {
        self.reserved.remove(label);
        if !self.open.iter().any(|l| l == label) {
            self.open.push(label.to_string());
        }
        self.session.retain(|l| l != label);
        self.session.push(label.to_string());
        match start {
            Start::Restore { session } => {
                self.reports.insert(label.to_string(), session);
                self.starts.remove(label);
            }
            // The session has the tab from now on, so a tab moved to a new
            // window is never in neither; the page still starts with it.
            Start::Transfer { tab } => {
                self.reports.insert(label.to_string(), seed_report(&tab));
                self.starts.insert(label.to_string(), Start::Transfer { tab });
            }
            other => {
                self.reports.remove(label);
                self.starts.insert(label.to_string(), other);
            }
        }
    }

    pub fn is_open(&self, label: &str) -> bool {
        self.open.iter().any(|l| l == label)
    }

    /// What `label`'s page starts with now: what it was opened with until
    /// it first reports, then its last report.
    pub fn start_of(&self, label: &str) -> Start {
        if let Some(s) = self.starts.get(label) {
            return s.clone();
        }
        self.reports.get(label).map_or(Start::Plain, |r| Start::Restore { session: r.clone() })
    }

    /// The page of `label` reports its tabs. Returns whether the session
    /// changed. A closed window's late report is dropped.
    pub fn report(&mut self, label: &str, record: Value) -> bool {
        if !self.is_open(label) {
            return false;
        }
        self.starts.remove(label);
        if self.reports.get(label) == Some(&record) {
            return false;
        }
        self.reports.insert(label.to_string(), record);
        true
    }

    pub fn focus(&mut self, label: &str) {
        if self.is_open(label) {
            self.focused = Some(label.to_string());
        }
    }

    /// Quit: every window still open stays in the session as it closes.
    pub fn quit(&mut self) {
        self.quitting = true;
    }

    /// The window `label` is gone. Closing one of several drops it from the
    /// session; the last one, or any while quitting, stays in it. Returns
    /// whether the session changed.
    pub fn close(&mut self, label: &str) -> bool {
        let was_open = self.is_open(label);
        self.open.retain(|l| l != label);
        self.starts.remove(label);
        if !was_open || self.quitting || self.open.is_empty() {
            return false;
        }
        self.session.retain(|l| l != label);
        self.reports.remove(label);
        if self.focused.as_deref() == Some(label) {
            self.focused = None;
        }
        true
    }

    /// Leaves `labels` free for windows a guest process may bring back.
    pub fn reserve(&mut self, labels: impl IntoIterator<Item = String>) {
        self.reserved.extend(labels);
    }

    /// The session to save: its windows with tabs, in order.
    pub fn saved(&self) -> Saved {
        let windows: Vec<SavedWindow> = self
            .session
            .iter()
            .filter_map(|l| self.reports.get(l).filter(|r| has_tabs(r)).map(|r| SavedWindow { label: l.clone(), session: r.clone() }))
            .collect();
        let focused = self.focused.clone().filter(|f| windows.iter().any(|w| &w.label == f));
        Saved { windows, focused }
    }
}

/// The registry, as managed state.
#[derive(Default)]
pub struct Windows(Mutex<Registry>);

impl Windows {
    pub fn saved(&self) -> Saved {
        lock(&self.0).saved()
    }

    pub fn reserve(&self, labels: impl IntoIterator<Item = String>) {
        lock(&self.0).reserve(labels);
    }
}

/// How a window's size and place start (`window_fit.rs`).
#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Fit {
    /// The first window of a process that owns the session: centered at a
    /// size that fits when nothing is saved for it.
    First,
    /// Any other: where the OS puts it, unless something is saved for it.
    Other,
    /// A tab's new window (`tab_drag.rs`): this size, and this place where
    /// the platform has one, whatever the window-state plugin saved for the
    /// label.
    Torn(Torn),
}

/// A torn-off tab's window: its inner size and its outer place, physical
/// pixels, and the scale they were worked out at.
#[derive(Clone, Copy, PartialEq, Debug)]
pub struct Torn {
    pub pos: Option<(i32, i32)>,
    pub inner: (u32, u32),
    pub scale: f64,
}

/// Makes a window for `start`, with `label` or the lowest free one. With
/// `token` (a second launch's startup ID), the window takes the focus with
/// it; without one, `focus` asks for the focus the usual way.
pub fn open(app: &AppHandle, label: Option<String>, start: Start, token: Option<String>, focus: bool, fit: Fit) -> Result<WebviewWindow, String> {
    let label = {
        let windows = app.state::<Windows>();
        let mut reg = lock(&windows.0);
        let label = label.unwrap_or_else(|| reg.next_label());
        reg.add(&label, start);
        label
    };
    let torn = match fit {
        Fit::Torn(t) => Some(t),
        _ => None,
    };
    let made = make(app, &label, token.as_deref(), torn);
    let window = match made {
        Ok(w) => w,
        Err(e) => {
            lock(&app.state::<Windows>().0).close(&label);
            log::warn!("opening window {label}: {e}");
            return Err(e);
        }
    };
    crate::tab_drag::attach(&window);
    match torn {
        Some(t) => place_torn(&window, t),
        None => window_fit::fit_window(&window, window_fit::start_for(app, &label, owns_geometry(app), fit == Fit::First)),
    }
    #[cfg(target_os = "linux")]
    if let Some(t) = &token {
        activation::completed(app, t);
    }
    if focus && token.is_none() {
        let _ = window.set_focus();
    }
    Ok(window)
}

/// Whether the window-state plugin restores and saves windows' size and
/// place here: it's registered in the process that owns the session.
fn owns_geometry(app: &AppHandle) -> bool {
    app.try_state::<GeometryPlugin>().is_some()
}

/// Managed once the window-state plugin is registered.
pub struct GeometryPlugin;

/// Registers the window-state plugin, once: at the start of the process
/// that owns the session, or when a guest takes it. It restores each window
/// made from then on as it's made, and saves them all on exit.
pub fn register_geometry(app: &AppHandle) -> bool {
    use tauri_plugin_window_state::StateFlags;
    if owns_geometry(app) {
        return true;
    }
    let plugin = tauri_plugin_window_state::Builder::new()
        .with_state_flags(StateFlags::SIZE | StateFlags::POSITION | StateFlags::MAXIMIZED)
        .build();
    match app.plugin(plugin) {
        Ok(()) => {
            app.manage(GeometryPlugin);
            true
        }
        Err(e) => {
            log::warn!("window-state plugin: {e}");
            false
        }
    }
}

/// A torn-off tab's window goes where the drop was, at its source's size,
/// over what the window-state plugin restored for a label used before.
fn place_torn(window: &WebviewWindow, t: Torn) {
    let _ = window.unmaximize();
    let _ = window.set_size(PhysicalSize::new(t.inner.0, t.inner.1));
    if let Some((x, y)) = t.pos {
        let _ = window.set_position(PhysicalPosition::new(x, y));
    }
}

fn make(app: &AppHandle, label: &str, token: Option<&str>, torn: Option<Torn>) -> Result<WebviewWindow, String> {
    let mut config = app.config().app.windows.first().cloned().ok_or("no window in the config")?;
    config.label = label.to_string();
    config.create = true;
    // Made there from the start, so it doesn't show elsewhere first.
    if let Some(t) = torn.filter(|t| t.scale > 0.0) {
        config.width = f64::from(t.inner.0) / t.scale;
        config.height = f64::from(t.inner.1) / t.scale;
        config.maximized = false;
        if let Some((x, y)) = t.pos {
            config.x = Some(f64::from(x) / t.scale);
            config.y = Some(f64::from(y) / t.scale);
            config.center = false;
        }
    }
    #[cfg(target_os = "linux")]
    if let Some(t) = token {
        activation::before_window(app, t);
    }
    #[cfg(not(target_os = "linux"))]
    let _ = token;
    WebviewWindowBuilder::from_config(app, &config)
        .and_then(|b| b.build())
        .map_err(|e| e.to_string())
}

/// How the windows a restore opens get the focus.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Focus {
    /// At start: the window manager gives it, with the launcher's startup
    /// ID when GTK read one (`token`).
    AtStart { token: bool },
    /// For a launch handed over: with its startup ID, else asked for.
    HandedOff,
}

/// Opens the saved session's windows, all at once. The focused one is made
/// first, so it takes the launcher's startup ID (`token`, or the one GTK
/// read at start), and gets the focus back once the others are up. A saved
/// label that's open already (a guest's window) gets a free one instead.
/// Returns how many opened.
fn restore(app: &AppHandle, saved: Saved, token: Option<String>, focus: Focus) -> usize {
    let mut windows = saved.windows;
    if let Some(i) = saved.focused.as_ref().and_then(|f| windows.iter().position(|w| &w.label == f)) {
        let w = windows.remove(i);
        windows.insert(0, w);
    }
    let had_token = match focus {
        Focus::AtStart { token } => token,
        Focus::HandedOff => token.is_some(),
    };
    let mut token = token;
    let mut first: Option<WebviewWindow> = None;
    let mut opened = 0;
    for (i, w) in windows.into_iter().enumerate() {
        let fit = if i == 0 { Fit::First } else { Fit::Other };
        let label = (!lock(&app.state::<Windows>().0).is_open(&w.label)).then_some(w.label);
        if let Ok(win) = open(app, label, Start::Restore { session: w.session }, token.take(), false, fit) {
            opened += 1;
            first.get_or_insert(win);
        }
    }
    if let Some(win) = first {
        lock(&app.state::<Windows>().0).focus(win.label());
        if opened > 1 || (focus == Focus::HandedOff && !had_token) {
            refocus(app, win, had_token);
        }
    }
    opened
}

/// The window made first gets the focus (back, once the others are up). On
/// Wayland, not when it was activated with a startup ID: asking again makes
/// GTK request a token of its own, which a desktop with focus-stealing
/// prevention may flag (docs/decisions/2026-11-20-folder-handler-processes.md).
fn refocus(app: &AppHandle, win: WebviewWindow, had_token: bool) {
    #[cfg(target_os = "linux")]
    {
        let _ = app.run_on_main_thread(move || {
            if !(had_token && activation::is_wayland()) {
                let _ = win.set_focus();
            }
        });
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = (app, had_token);
        let _ = win.set_focus();
    }
}

/// The process's first windows, when it's ready: the paths it was started
/// with (a guest); else the saved session (the owner); else one window,
/// which reads the v1 key when there's no session file yet. `token`: the
/// launcher gave a startup ID, which GTK took at start.
pub fn first_windows(app: &AppHandle, launch: Option<LaunchRequest>, saved: Option<Saved>, token: bool) {
    let owner = app.state::<Session>().is_owner();
    let fit = if owner { Fit::First } else { Fit::Other };
    if let Some(launch) = launch {
        let _ = open(app, None, Start::Launch { launch }, None, false, fit);
        return;
    }
    if !owner {
        let _ = open(app, None, Start::Plain, None, false, fit);
        return;
    }
    match saved {
        Some(s) if !s.windows.is_empty() => {
            if restore(app, s, None, Focus::AtStart { token }) == 0 {
                let _ = open(app, None, Start::Plain, None, false, fit);
            }
        }
        Some(_) => {
            let _ = open(app, None, Start::Plain, None, false, fit);
        }
        None => {
            let _ = open(app, None, Start::Legacy, None, false, fit);
        }
    }
}

/// A second launch, or the resident, handed over a window (`handoff.rs`).
/// A plain launch handed to a guest makes it the owner, if no other process
/// holds the session: it then brings the saved windows back, as a plain
/// start would have, and saves every window from then on.
pub fn handed_off(app: &AppHandle, launch: Option<LaunchRequest>, token: Option<String>) {
    if let Some(launch) = launch {
        let _ = open(app, None, Start::Launch { launch }, token, true, Fit::Other);
        return;
    }
    let session = app.state::<Session>();
    if session.upgrade() {
        log::info!("a plain launch was handed over: this process now saves the session");
        register_geometry(app);
        let saved = session::read(session.dir());
        lock(&app.state::<Windows>().0).reserved.clear();
        session::schedule(app);
        if let Some(saved) = saved.filter(|s| !s.windows.is_empty()) {
            if restore(app, saved, token.clone(), Focus::HandedOff) > 0 {
                return;
            }
        }
    }
    let _ = open(app, None, Start::Plain, token, true, Fit::Other);
}

/// Window events the app's run loop passes on.
pub fn on_window_event(app: &AppHandle, label: &str, event: &tauri::WindowEvent) {
    match event {
        tauri::WindowEvent::Focused(true) => lock(&app.state::<Windows>().0).focus(label),
        tauri::WindowEvent::Destroyed => {
            forget_backend(app, label);
            crate::tab_drag::forget(app, label);
            let changed = lock(&app.state::<Windows>().0).close(label);
            if changed {
                session::schedule(app);
            }
        }
        _ => {}
    }
}

/// A window's page is loading (again, after a reload): what the old page
/// set up in the backend has no one to answer to.
pub fn on_page_load(app: &AppHandle, label: &str) {
    forget_backend(app, label);
    crate::tab_drag::forget(app, label);
}

fn forget_backend(app: &AppHandle, label: &str) {
    let watches = app.state::<crate::watcher::WatcherState>().unwatch_window(label);
    let terminals = app.state::<crate::pty::PtyRegistry>().kill_window(label);
    if watches + terminals > 0 {
        log::info!("window {label}: dropped {watches} folder watches and {terminals} terminals");
    }
}

/// What a window's page needs at start.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowStart {
    /// This process saves the session (the v1 localStorage key is written
    /// only then).
    owner: bool,
    start: Start,
}

/// What this window's page opens with: the same answer until the page
/// first reports its tabs (React's dev mode asks twice), then its report.
#[tauri::command]
pub fn window_start(window: WebviewWindow, windows: State<'_, Windows>, session: State<'_, Session>) -> WindowStart {
    let start = lock(&windows.0).start_of(window.label());
    WindowStart { owner: session.is_owner(), start }
}

/// The page's tabs, as it would save them (`sessionOf` in src/session.ts):
/// kept for the window and written with the session.
#[tauri::command]
pub fn session_report(app: AppHandle, window: WebviewWindow, windows: State<'_, Windows>, session: Value) -> Result<(), String> {
    if !session.is_object() || session.to_string().len() > session::MAX_RECORD {
        return Err("not a session record".into());
    }
    if lock(&windows.0).report(window.label(), session) {
        session::schedule(&app);
    }
    Ok(())
}

/// File → New Window: a window with one tab at home, or with `paths` (the
/// sidebar's Open in New Window). Async: on Windows, making a webview from
/// a command on the main thread deadlocks.
#[tauri::command(async)]
pub fn new_window(app: AppHandle, paths: Option<Vec<String>>) -> Result<(), String> {
    let paths: Vec<String> = paths.unwrap_or_default();
    let start = if paths.is_empty() {
        Start::Plain
    } else {
        let mut ok = Vec::new();
        let mut skipped = Vec::new();
        for p in paths.iter().take(100) {
            match crate::startup::bus_path(p) {
                Ok(p) => ok.push(p),
                Err(why) => skipped.push(format!("{p}: {why}")),
            }
        }
        Start::Launch { launch: LaunchRequest { mode: LaunchMode::Open, paths: ok, skipped } }
    };
    open(&app, None, start, None, true, Fit::Other).map(|_| ())
}

/// Quit: every window closes, and all of them stay in the session.
#[tauri::command]
pub fn quit_app(app: AppHandle) {
    lock(&app.state::<Windows>().0).quit();
    session::flush(&app);
    app.exit(0);
}

/// Focus with a second launch's startup ID, on Linux: GTK takes it from the
/// display, as GtkApplication does when another instance hands it one.
#[cfg(target_os = "linux")]
mod activation {
    use std::ffi::{c_char, CString};

    use gtk::gdk;
    use gtk::glib::prelude::*;
    use gtk::glib::translate::ToGlibPtr;
    use tauri::AppHandle;

    /// Which GDK backend the display is, on the main thread.
    fn backend() -> Option<&'static str> {
        let display = gdk::Display::default()?;
        match display.type_().name() {
            "GdkWaylandDisplay" => Some("wayland"),
            "GdkX11Display" => Some("x11"),
            _ => None,
        }
    }

    pub fn is_wayland() -> bool {
        backend() == Some("wayland")
    }

    /// The display's startup ID becomes `token`, so the next window made
    /// takes it: xdg-activation on Wayland, `_NET_STARTUP_ID` and the user
    /// time on X11. Looked up at run time, so a GTK built without one of the
    /// backends still starts.
    pub fn before_window(app: &AppHandle, token: &str) {
        let Ok(id) = CString::new(token) else { return };
        let _ = app.run_on_main_thread(move || {
            let symbol = match backend() {
                Some("wayland") => c"gdk_wayland_display_set_startup_notification_id",
                Some("x11") => c"gdk_x11_display_set_startup_notification_id",
                _ => return,
            };
            let Some(display) = gdk::Display::default() else { return };
            // SAFETY: dlsym with RTLD_DEFAULT looks the symbol up in what's
            // loaded already; GDK is, since the display exists.
            let f = unsafe { libc::dlsym(libc::RTLD_DEFAULT, symbol.as_ptr()) };
            if f.is_null() {
                return;
            }
            // SAFETY: both functions are `void (GdkDisplay *, const char *)`
            // and are called on the main thread with a live display of the
            // matching type and a NUL-terminated string.
            unsafe {
                let set: unsafe extern "C" fn(*mut gdk::ffi::GdkDisplay, *const c_char) = std::mem::transmute(f);
                let ptr: *mut gdk::ffi::GdkDisplay = display.to_glib_none().0;
                set(ptr, id.as_ptr());
            }
        });
    }

    /// The window is up: X11's launch feedback ends. On Wayland the
    /// activation was the end, and this does nothing.
    pub fn completed(app: &AppHandle, _token: &str) {
        let _ = app.run_on_main_thread(|| {
            if backend() == Some("x11") {
                gdk::notify_startup_complete();
            }
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn tabs(path: &str) -> Value {
        json!({ "tabs": [{ "path": path, "sort": { "key": "name", "dir": "asc" } }], "active": 0 })
    }

    fn launch(path: &str) -> Start {
        Start::Launch { launch: LaunchRequest { mode: LaunchMode::Open, paths: vec![path.into()], skipped: vec![] } }
    }

    #[test]
    fn labels_are_main_then_the_lowest_free_number() {
        let mut reg = Registry::default();
        assert_eq!(reg.next_label(), "main");
        reg.add("main", Start::Plain);
        reg.add(&reg.next_label(), Start::Plain);
        reg.add(&reg.next_label(), Start::Plain);
        assert_eq!(reg.open, ["main", "main-2", "main-3"]);
        reg.close("main-2");
        assert_eq!(reg.next_label(), "main-2");
        reg.close("main");
        assert_eq!(reg.next_label(), "main");
    }

    #[test]
    fn a_guest_leaves_the_saved_labels_free() {
        let mut reg = Registry::default();
        reg.reserve(["main".to_string(), "main-2".to_string()]);
        assert_eq!(reg.next_label(), "main-3");
        reg.add("main-3", launch("/x"));
        assert_eq!(reg.next_label(), "main-4");
        // A restored window takes its saved label back.
        reg.add("main", Start::Restore { session: tabs("/a") });
        assert!(!reg.reserved.contains("main"));
    }

    #[test]
    fn only_these_labels_are_ours() {
        for ok in ["main", "main-2", "main-17", "main-9999"] {
            assert!(valid_label(ok), "{ok}");
        }
        for bad in ["", "Main", "main-", "main-0", "main-1", "main-02", "main-10000", "main-2a", "main--2", "chooser", "main-+2"] {
            assert!(!valid_label(bad), "{bad}");
        }
        // Every label next_label gives is valid.
        let mut reg = Registry::default();
        for _ in 0..30 {
            let l = reg.next_label();
            assert!(valid_label(&l), "{l}");
            reg.add(&l, Start::Plain);
        }
    }

    #[test]
    fn a_page_starts_with_what_its_window_opened_with_until_it_reports() {
        let mut reg = Registry::default();
        reg.add("main", launch("/x"));
        // Asked twice (React's dev mode): the same answer.
        assert_eq!(reg.start_of("main"), launch("/x"));
        assert_eq!(reg.start_of("main"), launch("/x"));
        assert!(reg.report("main", tabs("/x")));
        // A reload keeps its tabs, not the paths it opened with.
        assert_eq!(reg.start_of("main"), Start::Restore { session: tabs("/x") });
        assert!(!reg.report("main", tabs("/x")), "the same report again is no change");
        assert_eq!(reg.start_of("unknown"), Start::Plain);
        reg.add("main-2", Start::Legacy);
        assert_eq!(reg.start_of("main-2"), Start::Legacy);
    }

    #[test]
    fn closing_one_of_several_windows_drops_it_but_the_last_one_stays() {
        let mut reg = Registry::default();
        for (l, p) in [("main", "/a"), ("main-2", "/b"), ("main-3", "/c")] {
            reg.add(l, Start::Plain);
            reg.report(l, tabs(p));
        }
        reg.focus("main-2");
        assert!(reg.close("main-2"));
        assert_eq!(reg.saved(), Saved {
            windows: vec![SavedWindow { label: "main".into(), session: tabs("/a") }, SavedWindow { label: "main-3".into(), session: tabs("/c") }],
            focused: None,
        });
        assert!(reg.close("main"));
        // The last window closing quits the app: it's what comes back.
        assert!(!reg.close("main-3"));
        assert_eq!(reg.saved().windows, [SavedWindow { label: "main-3".into(), session: tabs("/c") }]);
        // A late report from a window that's gone changes nothing.
        assert!(!reg.report("main-3", tabs("/z")));
        assert!(!reg.close("main-3"));
    }

    #[test]
    fn quit_keeps_every_window() {
        let mut reg = Registry::default();
        for (l, p) in [("main", "/a"), ("main-2", "/b")] {
            reg.add(l, Start::Plain);
            reg.report(l, tabs(p));
        }
        reg.focus("main-2");
        reg.quit();
        assert!(!reg.close("main"));
        assert!(!reg.close("main-2"));
        let saved = reg.saved();
        assert_eq!(saved.windows.len(), 2);
        assert_eq!(saved.focused.as_deref(), Some("main-2"));
    }

    #[test]
    fn a_window_made_for_a_moved_tab_is_in_the_session_from_the_start() {
        let mut reg = Registry::default();
        reg.add("main", Start::Plain);
        reg.report("main", tabs("/a"));
        let tab = json!({ "path": "/b", "sort": { "key": "name", "dir": "asc" }, "back": ["/x"], "forward": [], "search": "", "tagFilter": null, "private": false });
        reg.add("main-2", Start::Transfer { tab: tab.clone() });
        // Its page starts with the tab, history and all; the session has the
        // tab before the page reports.
        assert_eq!(reg.start_of("main-2"), Start::Transfer { tab: tab.clone() });
        assert_eq!(reg.start_of("main-2"), Start::Transfer { tab });
        assert_eq!(reg.saved().windows, [SavedWindow { label: "main".into(), session: tabs("/a") }, SavedWindow { label: "main-2".into(), session: tabs("/b") }]);
        // Once it reports, a reload keeps what it reported.
        assert!(reg.report("main-2", tabs("/c")));
        assert_eq!(reg.start_of("main-2"), Start::Restore { session: tabs("/c") });
    }

    #[test]
    fn a_moved_private_tab_stays_out_of_the_session() {
        let mut reg = Registry::default();
        reg.add("main", Start::Transfer { tab: json!({ "path": "/secret", "sort": { "key": "name", "dir": "asc" }, "private": true }) });
        assert_eq!(reg.saved().windows, []);
        // A record without the flag counts as private: nothing is saved by mistake.
        assert_eq!(seed_report(&json!({ "path": "/x" })), json!({ "tabs": [], "active": 0 }));
    }

    #[test]
    fn windows_without_tabs_are_not_saved() {
        let mut reg = Registry::default();
        reg.add("main", Start::Restore { session: tabs("/a") });
        reg.add("main-2", Start::Plain);
        reg.add("main-3", Start::Plain);
        // main-2's page hasn't reported; main-3 has only private tabs.
        reg.report("main-3", json!({ "tabs": [], "active": 0 }));
        reg.focus("main-3");
        assert_eq!(reg.saved(), Saved { windows: vec![SavedWindow { label: "main".into(), session: tabs("/a") }], focused: None });
        // A focus change to a window that isn't open is ignored.
        reg.focus("main-9");
        assert_eq!(reg.focused.as_deref(), Some("main-3"));
    }
}
