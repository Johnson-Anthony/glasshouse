//! A tab dragged out of its window (task 50, phase 3): into another
//! glasshouse window, which takes it where it's dropped, or, let go where no
//! glasshouse window takes it, into a new window at the drop. Every window
//! is in this process (`app_windows.rs`), so the tab moves in memory: when
//! the drag leaves its window, its page hands the backend the tab's record
//! (`src/tabTransfer.ts`: folder, sort, history, filters, private). It's
//! kept here with the window's label and the tab's id until the drag ends,
//! and handed to the page that takes the tab. The source window takes its
//! tab out only once the move is done (`tab-drag-end` with `moved`).
//!
//! - Linux, X11 and Wayland (`tab_drag/gtk_dnd.rs`): at the window's edge
//!   the drag becomes a GTK drag with one target, [`TARGET`], which no
//!   other app takes. Every window's webview answers it from the drop
//!   zones its page registered.
//! - Windows (`tab_drag/win32.rs`): the page keeps the pointer, and the
//!   backend finds the window under the cursor.
//!
//! See docs/decisions/2026-11-21-split-and-tear-off-tear-off.md.

use std::collections::HashMap;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Emitter, EventTarget, Manager, State, WebviewWindow};

use crate::app_windows::{self, Fit, Start, Torn};
use crate::lock;
use crate::window_fit::{self, Rect};

#[cfg(target_os = "linux")]
mod gtk_dnd;
#[cfg(windows)]
mod win32;

/// The drag's one target on Linux. No folder URI goes with it: a drop on a
/// file manager or a terminal would copy the folder or paste its path.
#[cfg(target_os = "linux")]
pub const TARGET: &str = "application/x-glasshouse-tab";

/// A record bigger than this isn't a tab (history is the bulk of one).
const MAX_RECORD: usize = 256 * 1024;
/// More tabs than this in one bar is a broken report.
const MAX_BAR_TABS: usize = 500;
/// How much of a pane's file area, from each edge, splits (as inside a
/// window: `EDGE_SHARE` in src/tabDrag.ts).
pub const EDGE_SHARE: f64 = 0.25;

/// A rectangle in CSS pixels: left, top, width, height.
pub type Css = [f64; 4];

/// A tab bar: its pane, its box and each tab's left and width.
#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct Bar {
    pub pane: u8,
    pub rect: Css,
    pub tabs: Vec<[f64; 2]>,
}

/// A pane's file area (its tab bar too, in a split window).
#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct PaneArea {
    pub pane: u8,
    pub rect: Css,
}

/// Where a window takes a tab from another window, as its page reported
/// them: CSS pixels at `zoom`.
#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct Zones {
    pub zoom: f64,
    pub split: bool,
    pub bars: Vec<Bar>,
    pub panes: Vec<PaneArea>,
}

impl Zones {
    fn checked(self) -> Result<Zones, String> {
        let rect = |r: &Css| r.iter().all(|v| v.is_finite()) && r[2] >= 0.0 && r[3] >= 0.0;
        let ok = self.zoom.is_finite()
            && self.zoom > 0.0
            && self.zoom <= 10.0
            && self.bars.len() <= 2
            && self.panes.len() <= 2
            && self.bars.iter().all(|b| {
                b.pane <= 1 && rect(&b.rect) && b.tabs.len() <= MAX_BAR_TABS && b.tabs.iter().flatten().all(|v| v.is_finite())
            })
            && self.panes.iter().all(|p| p.pane <= 1 && rect(&p.rect));
        if ok {
            Ok(self)
        } else {
            Err("not drop zones".into())
        }
    }
}

/// The side of a pane a split puts the tab on.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Side {
    Left,
    Right,
    Top,
    Bottom,
}

/// Where a tab from another window lands (`landTab` in src/tabLayout.ts).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Zone {
    /// In a tab bar, at gap `gap` (0 is before the first tab).
    Bar { pane: u8, gap: usize },
    /// The outer quarter of an unsplit window's file area: a split, with
    /// the tab in the new pane.
    Split { side: Side },
    /// The rest of a pane's file area: after its tabs.
    Pane { pane: u8 },
}

fn inside(r: &Css, x: f64, y: f64) -> bool {
    x >= r[0] && y >= r[1] && x < r[0] + r[2] && y < r[1] + r[3]
}

/// The gap nearest `x` in a row of tabs: before the first tab whose middle
/// is right of it.
pub fn gap_at(x: f64, tabs: &[[f64; 2]]) -> usize {
    tabs.iter().position(|t| x < t[0] + t[1] / 2.0).unwrap_or(tabs.len())
}

/// The edge of `r` that `x`, `y` is in the outer quarter of, the nearest
/// one first; None in the middle.
pub fn edge_at(x: f64, y: f64, r: &Css) -> Option<Side> {
    if r[2] <= 0.0 || r[3] <= 0.0 {
        return None;
    }
    let fx = (x - r[0]) / r[2];
    let fy = (y - r[1]) / r[3];
    if !((0.0..=1.0).contains(&fx) && (0.0..=1.0).contains(&fy)) {
        return None;
    }
    let near = [(Side::Left, fx), (Side::Right, 1.0 - fx), (Side::Top, fy), (Side::Bottom, 1.0 - fy)];
    let (side, d) = near.into_iter().reduce(|a, b| if b.1 < a.1 { b } else { a })?;
    (d < EDGE_SHARE).then_some(side)
}

/// What a tab from another window lands on at `x`, `y` (CSS pixels): a tab
/// bar; else a pane's file area, whose outer quarter splits an unsplit
/// window; else nothing (the sidebar, the toolbar).
pub fn zone_at(z: &Zones, x: f64, y: f64) -> Option<Zone> {
    if let Some(b) = z.bars.iter().find(|b| inside(&b.rect, x, y)) {
        return Some(Zone::Bar { pane: b.pane, gap: gap_at(x, &b.tabs) });
    }
    let p = z.panes.iter().find(|p| inside(&p.rect, x, y))?;
    if z.split {
        return Some(Zone::Pane { pane: p.pane });
    }
    Some(edge_at(x, y, &p.rect).map_or(Zone::Pane { pane: p.pane }, |side| Zone::Split { side }))
}

/// `tab-drag-over`, to the window under the drag: where the tab would land,
/// for its mark. Over the tab's own window, `home`: its page finds the spot
/// itself, with the rules of a drag inside a window. `label` is the tab's
/// name, for a page to draw by the pointer where the OS draws nothing
/// (Windows).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Over {
    zone: Option<Zone>,
    home: bool,
    x: f64,
    y: f64,
    label: Option<String>,
}

/// `tab-drop`: the tab's record and where it lands; or, dropped back on its
/// own window (`home`), the point.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Dropped {
    tab: Option<Value>,
    zone: Option<Zone>,
    home: bool,
    x: f64,
    y: f64,
}

/// How a drag ended, for its source.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Outcome {
    /// Another window has the tab, or a new one: the source takes it out.
    Moved,
    /// Dropped back on its own window, which moved it there or left it.
    Home,
    /// Escape, or let go where nothing took it and no window could open.
    Cancelled,
    /// A new window was wanted and didn't open; the tab stays.
    Failed,
}

/// `tab-drag-end`, to the source window.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct End {
    tab: u64,
    outcome: Outcome,
    message: Option<String>,
}

/// What a change to the drags sends, once the lock is let go.
#[derive(Debug, Clone, PartialEq)]
enum Emit {
    /// Every window: send your drop zones.
    Began,
    Over(String, Over),
    Leave(String),
    Drop(String, Dropped),
    Focus(String),
    End(String, End),
}

/// The tab being dragged out of its window.
#[derive(Debug)]
struct Outgoing {
    /// This drag's number: a late end of an earlier one is ignored.
    id: u64,
    source: String,
    tab: u64,
    record: Value,
    /// Drawn by the pointer by the window under it (`Over::label`).
    ghost: Option<String>,
    /// Where a new window's first tab is from its top-left, in the window's
    /// own (logical) pixels.
    anchor: [f64; 2],
    /// The window under the drag, and what it was told last.
    over: Option<(String, Over)>,
    /// The window that took it: the source, for a drop back on it.
    taken: Option<String>,
}

/// Every window's drop zones, and the drag in progress.
#[derive(Debug, Default)]
pub struct Drags {
    zones: HashMap<String, Zones>,
    outgoing: Option<Outgoing>,
    last_id: u64,
}

impl Drags {
    /// A tab leaves window `source`. A drag still held from before (its end
    /// never came) is dropped, and its source keeps its tab.
    fn start(&mut self, source: &str, tab: u64, record: Value, ghost: Option<String>, anchor: [f64; 2]) -> (u64, Vec<Emit>) {
        let mut out = self.outgoing.take().map(|o| close(o, Outcome::Cancelled)).unwrap_or_default();
        self.last_id += 1;
        self.outgoing = Some(Outgoing {
            id: self.last_id,
            source: source.to_string(),
            tab,
            record,
            ghost,
            anchor,
            over: None,
            taken: None,
        });
        out.push(Emit::Began);
        (self.last_id, out)
    }

    /// Where a drop on `label` at `x`, `y` (the webview's own pixels) goes,
    /// as a mark: None when it isn't taken.
    fn verdict(&self, label: &str, x: f64, y: f64) -> Option<Over> {
        let o = self.outgoing.as_ref()?;
        let zones = self.zones.get(label);
        let zoom = zones.map_or(1.0, |z| z.zoom);
        let (x, y) = (x / zoom, y / zoom);
        let home = label == o.source;
        let zone = if home { None } else { zone_at(zones?, x, y) };
        (home || zone.is_some()).then(|| Over { zone, home, x, y, label: o.ghost.clone() })
    }

    /// The drag is over `label` at `x`, `y`: whether that window takes it.
    /// Its page hears what changed.
    fn hover(&mut self, label: &str, x: f64, y: f64) -> (bool, Vec<Emit>) {
        if self.outgoing.is_none() {
            return (false, vec![]);
        }
        let verdict = self.verdict(label, x, y);
        let mut out = Vec::new();
        let o = self.outgoing.as_mut().expect("checked above");
        if let Some((l, _)) = o.over.as_ref().filter(|(l, _)| l != label) {
            out.push(Emit::Leave(l.clone()));
            o.over = None;
        }
        match verdict {
            Some(v) => {
                // Over another window, only a new zone is news, unless the
                // page draws the tab's name by the pointer; over its own,
                // its page follows the point.
                let same = o.over.as_ref().is_some_and(|(_, last)| {
                    if v.home || v.label.is_some() {
                        *last == v
                    } else {
                        last.zone == v.zone
                    }
                });
                if !same {
                    out.push(Emit::Over(label.to_string(), v.clone()));
                }
                o.over = Some((label.to_string(), v));
                (true, out)
            }
            None => {
                if o.over.take().is_some() {
                    out.push(Emit::Leave(label.to_string()));
                }
                (false, out)
            }
        }
    }

    /// The drag left `label`.
    fn leave(&mut self, label: &str) -> Vec<Emit> {
        match self.outgoing.as_mut() {
            Some(o) if o.over.as_ref().is_some_and(|(l, _)| l == label) => {
                o.over = None;
                vec![Emit::Leave(label.to_string())]
            }
            _ => vec![],
        }
    }

    /// The drag left every window.
    fn leave_all(&mut self) -> Vec<Emit> {
        match self.outgoing.as_mut().and_then(|o| o.over.take()) {
            Some((l, _)) => vec![Emit::Leave(l)],
            None => vec![],
        }
    }

    /// Dropped on `label` at `x`, `y`: whether that window took it. It gets
    /// the tab's record (or, its own window, the point) and the focus.
    fn drop_at(&mut self, label: &str, x: f64, y: f64) -> (bool, Vec<Emit>) {
        if self.outgoing.as_ref().is_none_or(|o| o.taken.is_some()) {
            return (false, vec![]);
        }
        let verdict = self.verdict(label, x, y);
        let o = self.outgoing.as_mut().expect("checked above");
        let mut out: Vec<Emit> = o.over.take().into_iter().filter(|(l, _)| l != label).map(|(l, _)| Emit::Leave(l)).collect();
        let Some(v) = verdict else {
            out.push(Emit::Leave(label.to_string()));
            return (false, out);
        };
        o.taken = Some(label.to_string());
        let tab = (!v.home).then(|| o.record.clone());
        out.push(Emit::Drop(label.to_string(), Dropped { tab, zone: v.zone, home: v.home, x: v.x, y: v.y }));
        if !v.home {
            out.push(Emit::Focus(label.to_string()));
        }
        (true, out)
    }

    /// The drag `id` from `source`'s point of view is over: the held tab
    /// goes, and the source hears whether it moved.
    fn end(&mut self, id: u64) -> Vec<Emit> {
        match self.outgoing.take_if(|o| o.id == id) {
            Some(o) => {
                let outcome = match &o.taken {
                    Some(l) if *l == o.source => Outcome::Home,
                    Some(_) => Outcome::Moved,
                    None => Outcome::Cancelled,
                };
                close(o, outcome)
            }
            None => vec![],
        }
    }

    /// The drag `id`, if nothing took it, for a new window. Nothing is
    /// held from then on.
    fn take_untaken(&mut self, id: u64) -> Option<(Outgoing, Vec<Emit>)> {
        let mut o = self.outgoing.take_if(|o| o.id == id && o.taken.is_none())?;
        let out = o.over.take().map(|(l, _)| vec![Emit::Leave(l)]).unwrap_or_default();
        Some((o, out))
    }

    /// The drag from `source`, whatever became of it.
    fn take_from(&mut self, source: &str) -> Option<(Outgoing, Vec<Emit>)> {
        let mut o = self.outgoing.take_if(|o| o.source == source)?;
        let out = o.over.take().map(|(l, _)| vec![Emit::Leave(l)]).unwrap_or_default();
        Some((o, out))
    }

    /// Window `label` closed, or its page loaded again: its zones go, and
    /// a drag from it is over (its page, which would take the tab out, is
    /// gone).
    fn forget(&mut self, label: &str) -> Vec<Emit> {
        self.zones.remove(label);
        if let Some((_, out)) = self.take_from(label) {
            return out.into_iter().filter(|e| *e != Emit::Leave(label.to_string())).collect();
        }
        if let Some(o) = self.outgoing.as_mut() {
            if o.over.as_ref().is_some_and(|(l, _)| l == label) {
                o.over = None;
            }
        }
        vec![]
    }

    #[cfg(test)]
    fn holding(&self) -> bool {
        self.outgoing.is_some()
    }
}

/// The end of a drag that's no longer held: its last window clears its
/// mark, and its source hears `outcome`.
fn close(o: Outgoing, outcome: Outcome) -> Vec<Emit> {
    let mut out: Vec<Emit> = o.over.map(|(l, _)| Emit::Leave(l)).into_iter().collect();
    out.push(Emit::End(o.source, End { tab: o.tab, outcome, message: None }));
    out
}

/// The drags, as managed state.
#[derive(Default)]
pub struct TabDrags(Mutex<Drags>);

fn with<T>(app: &AppHandle, f: impl FnOnce(&mut Drags) -> (T, Vec<Emit>)) -> T {
    let (value, emits) = f(&mut lock(&app.state::<TabDrags>().0));
    fire(app, emits);
    value
}

fn fire(app: &AppHandle, emits: Vec<Emit>) {
    let to = |l: &str| EventTarget::webview_window(l);
    for e in emits {
        let sent = match e {
            Emit::Began => app.emit("tab-drag-began", ()),
            Emit::Over(l, p) => app.emit_to(to(&l), "tab-drag-over", p),
            Emit::Leave(l) => app.emit_to(to(&l), "tab-drag-leave", ()),
            Emit::Drop(l, p) => app.emit_to(to(&l), "tab-drop", p),
            Emit::End(l, p) => app.emit_to(to(&l), "tab-drag-end", p),
            Emit::Focus(l) => {
                if let Some(w) = app.get_webview_window(&l) {
                    let _ = w.set_focus();
                }
                Ok(())
            }
        };
        if let Err(e) = sent {
            log::warn!(target: "tab_drag", "{e}");
        }
    }
}

/// The drag is over window `label` at `x`, `y`, its webview's own pixels:
/// whether it takes the tab there.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
pub(crate) fn hover(app: &AppHandle, label: &str, x: f64, y: f64) -> bool {
    with(app, |d| d.hover(label, x, y))
}

#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
pub(crate) fn left(app: &AppHandle, label: &str) {
    with(app, |d| ((), d.leave(label)));
}

/// Dropped on window `label` at `x`, `y`: whether it took the tab.
pub(crate) fn dropped(app: &AppHandle, label: &str, x: f64, y: f64) -> bool {
    with(app, |d| d.drop_at(label, x, y))
}

/// The OS drag `id` ended (Linux).
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
pub(crate) fn ended(app: &AppHandle, id: u64) {
    with(app, |d| ((), d.end(id)));
}

/// The OS drag `id` was let go where no window took it (Linux): a new
/// window with the tab, at `cursor` (physical pixels) where it's known.
/// Made off the main thread, which is in GTK's signal now.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
pub(crate) fn nothing_took(app: &AppHandle, id: u64, cursor: Option<(i32, i32)>) {
    let Some(o) = with(app, |d| match d.take_untaken(id) {
        Some((o, out)) => (Some(o), out),
        None => (None, vec![]),
    }) else {
        return;
    };
    let app = app.clone();
    std::thread::spawn(move || {
        let source = o.source.clone();
        let end = tear_off(&app, o, cursor);
        fire(&app, vec![Emit::End(source, end)]);
    });
}

/// Window `label` closed or loaded again (`app_windows.rs`).
pub fn forget(app: &AppHandle, label: &str) {
    with(app, |d| ((), d.forget(label)));
}

/// Every window's webview takes tab drops (Linux; elsewhere the backend
/// finds the window itself).
pub fn attach(window: &WebviewWindow) {
    #[cfg(target_os = "linux")]
    gtk_dnd::attach(window);
    #[cfg(not(target_os = "linux"))]
    let _ = window;
}

/// A torn-off window's outer rectangle: `size`, with the point `anchor`
/// (from its top-left) under `cursor`, then moved, and shrunk if it has to
/// be, into the work area under the cursor.
pub fn torn_rect(cursor: (i32, i32), anchor: (i32, i32), size: (u32, u32), min: (u32, u32), areas: &[Rect]) -> Rect {
    let rect = Rect { x: cursor.0.saturating_sub(anchor.0), y: cursor.1.saturating_sub(anchor.1), w: size.0, h: size.1 };
    let at = Rect { x: cursor.0, y: cursor.1, w: 1, h: 1 };
    match window_fit::work_area_for(at, areas) {
        Some(work) => window_fit::place(rect, work, size, min, window_fit::Mode::Keep).unwrap_or(rect),
        None => rect,
    }
}

/// A new window for a tab from `src`: its size, and at `cursor` (with the
/// tab's anchor under it) when there's one.
fn torn_from(src: &WebviewWindow, cursor: Option<(i32, i32)>, anchor: [f64; 2]) -> Option<Torn> {
    let scale = src.scale_factor().ok()?;
    let inner = src.inner_size().ok()?;
    let outer = src.outer_size().ok()?;
    if inner.width == 0 || inner.height == 0 {
        return None;
    }
    let frame = (outer.width.saturating_sub(inner.width), outer.height.saturating_sub(inner.height));
    let Some(cursor) = cursor else {
        return Some(Torn { pos: None, inner: (inner.width, inner.height), scale });
    };
    let offset = match (src.outer_position(), src.inner_position()) {
        (Ok(o), Ok(i)) => (i.x - o.x, i.y - o.y),
        _ => (0, 0),
    };
    let px = |v: f64| (v * scale).round() as i32;
    let anchor = (offset.0 + px(anchor[0]), offset.1 + px(anchor[1]));
    let areas: Vec<Rect> = src
        .available_monitors()
        .unwrap_or_default()
        .iter()
        .map(|m| {
            let a = m.work_area();
            Rect { x: a.position.x, y: a.position.y, w: a.size.width, h: a.size.height }
        })
        .collect();
    let min = src
        .app_handle()
        .config()
        .app
        .windows
        .first()
        .map(|c| (px(c.min_width.unwrap_or(0.0)).max(0) as u32 + frame.0, px(c.min_height.unwrap_or(0.0)).max(0) as u32 + frame.1))
        .unwrap_or((0, 0));
    let r = torn_rect(cursor, anchor, (outer.width, outer.height), min, &areas);
    Some(Torn { pos: Some((r.x, r.y)), inner: (r.w.saturating_sub(frame.0), r.h.saturating_sub(frame.1)), scale })
}

/// Opens `o`'s tab in a new window, at `cursor` where it's known, and says
/// how that went for its source.
fn tear_off(app: &AppHandle, o: Outgoing, cursor: Option<(i32, i32)>) -> End {
    let torn = app.get_webview_window(&o.source).and_then(|src| torn_from(&src, cursor, o.anchor));
    let fit = torn.map_or(Fit::Other, Fit::Torn);
    match app_windows::open(app, None, Start::Transfer { tab: o.record }, None, true, fit) {
        Ok(_) => End { tab: o.tab, outcome: Outcome::Moved, message: None },
        Err(e) => End { tab: o.tab, outcome: Outcome::Failed, message: Some(e) },
    }
}

/// What the source page hands over: a tab's record, checked again by the
/// page that takes it (`parseTransfer` in src/tabTransfer.ts).
fn check_record(record: &Value) -> Result<(), String> {
    let path = record.get("path").and_then(Value::as_str);
    if !record.is_object() || path.is_none_or(str::is_empty) || record.to_string().len() > MAX_RECORD {
        return Err("not a tab".into());
    }
    Ok(())
}

/// The cursor, and the app's window under it with the point in its
/// webview's own pixels (Windows).
#[cfg_attr(not(windows), allow(dead_code))]
struct Cursor {
    /// Physical screen pixels.
    screen: (i32, i32),
    window: Option<(String, f64, f64)>,
}

/// A point on the screen (physical pixels) in a webview's own pixels, from
/// where its client area starts and its scale factor.
#[cfg_attr(not(windows), allow(dead_code))]
pub fn webview_point(screen: (i32, i32), client: (i32, i32), scale: f64) -> (f64, f64) {
    let scale = if scale.is_finite() && scale > 0.0 { scale } else { 1.0 };
    (f64::from(screen.0 - client.0) / scale, f64::from(screen.1 - client.1) / scale)
}

#[cfg(windows)]
fn under_cursor(app: &AppHandle) -> Option<Cursor> {
    let (screen, root) = win32::under_cursor()?;
    let window = root.and_then(|root| {
        let (label, w) = app.webview_windows().into_iter().find(|(_, w)| w.hwnd().is_ok_and(|h| h.0 as isize == root))?;
        let client = w.inner_position().ok()?;
        let (x, y) = webview_point(screen, (client.x, client.y), w.scale_factor().ok()?);
        Some((label, x, y))
    });
    Some(Cursor { screen, window })
}

/// Only Windows finds the window under the cursor itself.
#[cfg(not(windows))]
fn under_cursor(_app: &AppHandle) -> Option<Cursor> {
    None
}

/// Where this window takes a tab from another window, in CSS pixels. Sent
/// by every page when a drag begins (`tab-drag-began`).
#[tauri::command]
pub fn tab_drop_zones(window: WebviewWindow, drags: State<'_, TabDrags>, zones: Zones) -> Result<(), String> {
    let zones = zones.checked()?;
    lock(&drags.0).zones.insert(window.label().to_string(), zones);
    Ok(())
}

/// Tab `tab` (its record, `record`, and its name, `title`) is dragged out
/// of this window. On Linux it becomes a GTK drag, whose end the page hears
/// as `tab-drag-end`. On Windows the page keeps the pointer and asks
/// `tab_drag_hover` and `tab_drag_release`. `anchor`: where a new window's
/// first tab is from its top-left, in the window's own pixels.
#[tauri::command(async)]
pub fn tab_drag_start(app: AppHandle, window: WebviewWindow, tab: u64, record: Value, title: String, anchor: [f64; 2]) -> Result<(), String> {
    check_record(&record)?;
    let title: String = title.chars().take(200).collect();
    let anchor = if anchor.iter().all(|v| v.is_finite()) { anchor } else { [0.0, 0.0] };
    let ghost = cfg!(windows).then(|| title.clone());
    let id = with(&app, |d| d.start(window.label(), tab, record, ghost, anchor));
    #[cfg(target_os = "linux")]
    if let Err(e) = gtk_dnd::start(&window, id, title) {
        log::warn!(target: "tab_drag", "tab drag {id} from {} didn't start: {e}", window.label());
        with(&app, |d| ((), d.take_from(window.label()).map(|(_, out)| out).unwrap_or_default()));
        return Err(e);
    }
    #[cfg(not(target_os = "linux"))]
    let _ = (id, title);
    Ok(())
}

/// The pointer moved outside the window during a tab drag (Windows): the
/// window under it shows where the tab would land.
#[tauri::command]
pub fn tab_drag_hover(app: AppHandle, window: WebviewWindow) {
    let source = window.label();
    let under = under_cursor(&app).and_then(|c| c.window).filter(|(l, _, _)| l != source);
    match under {
        Some((label, x, y)) => {
            with(&app, |d| d.hover(&label, x, y));
        }
        None => with(&app, |d| ((), d.leave_all())),
    }
}

/// The tab was let go outside its window (Windows): over another window
/// that takes it, it moves there; anywhere else, into a new window at the
/// cursor. Answers `moved` (the page takes its tab out), `home` or
/// `cancelled` (it stays), or an error (it stays).
#[tauri::command(async)]
pub fn tab_drag_release(app: AppHandle, window: WebviewWindow) -> Result<Outcome, String> {
    let source = window.label().to_string();
    let cursor = under_cursor(&app);
    if let Some((label, x, y)) = cursor.as_ref().and_then(|c| c.window.clone()) {
        if label == source {
            with(&app, |d| ((), d.take_from(&source).map(|(_, out)| out).unwrap_or_default()));
            return Ok(Outcome::Home);
        }
        if dropped(&app, &label, x, y) {
            with(&app, |d| ((), d.take_from(&source).map(|(_, out)| out).unwrap_or_default()));
            return Ok(Outcome::Moved);
        }
    }
    let Some(o) = with(&app, |d| match d.take_from(&source) {
        Some((o, out)) => (Some(o), out),
        None => (None, vec![]),
    }) else {
        return Ok(Outcome::Cancelled);
    };
    let end = tear_off(&app, o, cursor.map(|c| c.screen));
    match end.outcome {
        Outcome::Failed => Err(end.message.unwrap_or_else(|| "no window opened".into())),
        other => Ok(other),
    }
}

/// The drag came back into its window, or Escape (Windows): nothing moves,
/// and nothing is held.
#[tauri::command]
pub fn tab_drag_cancel(app: AppHandle, window: WebviewWindow) {
    with(&app, |d| ((), d.take_from(window.label()).map(|(_, out)| out).unwrap_or_default()));
}

/// Move to New Window on the tab menu: the tab in a window of its own, the
/// size of this one, where the OS puts it. The page takes its tab out once
/// this answers.
#[tauri::command(async)]
pub fn tab_to_new_window(app: AppHandle, window: WebviewWindow, record: Value) -> Result<(), String> {
    check_record(&record)?;
    let fit = torn_from(&window, None, [0.0, 0.0]).map_or(Fit::Other, Fit::Torn);
    app_windows::open(&app, None, Start::Transfer { tab: record }, None, true, fit).map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn zones(split: bool) -> Zones {
        // An unsplit window: the title bar's tabs at the top, the file area
        // under the toolbar, right of the sidebar.
        Zones {
            zoom: 1.0,
            split,
            bars: vec![Bar { pane: 0, rect: [100.0, 0.0, 600.0, 36.0], tabs: vec![[100.0, 120.0], [220.0, 120.0]] }],
            panes: vec![PaneArea { pane: 0, rect: [200.0, 100.0, 800.0, 600.0] }],
        }
    }

    fn record(path: &str) -> Value {
        json!({ "path": path, "sort": { "key": "name", "dir": "asc" }, "back": [], "forward": [], "search": "", "tagFilter": null, "private": false })
    }

    fn drags() -> Drags {
        let mut d = Drags::default();
        d.zones.insert("main-2".into(), zones(false));
        d
    }

    #[test]
    fn a_tab_bar_takes_the_tab_at_the_nearest_gap() {
        let z = zones(false);
        assert_eq!(zone_at(&z, 105.0, 10.0), Some(Zone::Bar { pane: 0, gap: 0 }));
        assert_eq!(zone_at(&z, 200.0, 10.0), Some(Zone::Bar { pane: 0, gap: 1 }));
        assert_eq!(zone_at(&z, 300.0, 10.0), Some(Zone::Bar { pane: 0, gap: 2 }));
        // Right of the last tab, still in the bar: after it.
        assert_eq!(zone_at(&z, 650.0, 30.0), Some(Zone::Bar { pane: 0, gap: 2 }));
        assert_eq!(gap_at(5.0, &[]), 0);
    }

    #[test]
    fn the_outer_quarter_of_an_unsplit_file_area_splits_and_the_middle_appends() {
        let z = zones(false);
        // The area is 200..1000 by 100..700.
        assert_eq!(zone_at(&z, 210.0, 400.0), Some(Zone::Split { side: Side::Left }));
        assert_eq!(zone_at(&z, 990.0, 400.0), Some(Zone::Split { side: Side::Right }));
        assert_eq!(zone_at(&z, 600.0, 110.0), Some(Zone::Split { side: Side::Top }));
        assert_eq!(zone_at(&z, 600.0, 690.0), Some(Zone::Split { side: Side::Bottom }));
        assert_eq!(zone_at(&z, 600.0, 400.0), Some(Zone::Pane { pane: 0 }));
        // Just inside a quarter, and just past it.
        assert_eq!(zone_at(&z, 399.0, 400.0), Some(Zone::Split { side: Side::Left }));
        assert_eq!(zone_at(&z, 401.0, 400.0), Some(Zone::Pane { pane: 0 }));
        // In a corner the nearer edge wins.
        assert_eq!(zone_at(&z, 205.0, 120.0), Some(Zone::Split { side: Side::Left }));
        assert_eq!(zone_at(&z, 230.0, 102.0), Some(Zone::Split { side: Side::Top }));
    }

    #[test]
    fn a_split_window_appends_to_the_pane_and_splits_no_further() {
        let z = Zones {
            zoom: 1.0,
            split: true,
            bars: vec![
                Bar { pane: 0, rect: [200.0, 100.0, 400.0, 30.0], tabs: vec![[200.0, 100.0]] },
                Bar { pane: 1, rect: [605.0, 100.0, 395.0, 30.0], tabs: vec![[605.0, 100.0], [705.0, 100.0]] },
            ],
            panes: vec![PaneArea { pane: 0, rect: [200.0, 100.0, 400.0, 600.0] }, PaneArea { pane: 1, rect: [605.0, 100.0, 395.0, 600.0] }],
        };
        assert_eq!(zone_at(&z, 210.0, 400.0), Some(Zone::Pane { pane: 0 }));
        assert_eq!(zone_at(&z, 990.0, 400.0), Some(Zone::Pane { pane: 1 }));
        // The bar inside the pane is checked first.
        assert_eq!(zone_at(&z, 760.0, 110.0), Some(Zone::Bar { pane: 1, gap: 2 }));
        // The divider between them takes nothing.
        assert_eq!(zone_at(&z, 602.0, 400.0), None);
    }

    #[test]
    fn the_sidebar_and_toolbar_take_nothing() {
        let z = zones(false);
        assert_eq!(zone_at(&z, 50.0, 400.0), None);
        assert_eq!(zone_at(&z, 600.0, 60.0), None);
        assert_eq!(zone_at(&z, -5.0, -5.0), None);
        assert_eq!(edge_at(5.0, 5.0, &[0.0, 0.0, 0.0, 10.0]), None);
    }

    #[test]
    fn the_hit_test_is_in_css_pixels_at_the_windows_zoom() {
        let mut d = drags();
        d.zones.get_mut("main-2").unwrap().zoom = 2.0;
        d.start("main", 7, record("/a"), None, [0.0, 0.0]);
        // 1200, 800 in the webview's pixels is 600, 400 in CSS pixels: the
        // middle of the file area.
        assert_eq!(d.verdict("main-2", 1200.0, 800.0).and_then(|v| v.zone), Some(Zone::Pane { pane: 0 }));
        // 300, 100 is 150, 50: the sidebar.
        assert_eq!(d.verdict("main-2", 300.0, 100.0).and_then(|v| v.zone), None);
    }

    #[test]
    fn zones_that_are_not_zones_are_refused() {
        assert!(zones(false).checked().is_ok());
        let mut z = zones(false);
        z.zoom = 0.0;
        assert!(z.checked().is_err());
        let mut z = zones(false);
        z.bars[0].rect[2] = f64::NAN;
        assert!(z.checked().is_err());
        let mut z = zones(false);
        z.panes.extend([z.panes[0].clone(), z.panes[0].clone()]);
        assert!(z.checked().is_err());
        let mut z = zones(false);
        z.bars[0].pane = 2;
        assert!(z.checked().is_err());
    }

    #[test]
    fn a_tab_dropped_on_another_window_goes_there_with_its_record() {
        let mut d = drags();
        let (id, out) = d.start("main", 7, record("/a"), None, [40.0, 18.0]);
        assert_eq!(out, [Emit::Began]);
        // Over the tab bar: a mark, once per zone.
        let (take, out) = d.hover("main-2", 105.0, 10.0);
        assert!(take);
        assert!(matches!(&out[..], [Emit::Over(l, o)] if l == "main-2" && o.zone == Some(Zone::Bar { pane: 0, gap: 0 })));
        assert_eq!(d.hover("main-2", 106.0, 11.0), (true, vec![]));
        // Over the sidebar: refused, and the mark goes.
        assert_eq!(d.hover("main-2", 50.0, 400.0), (false, vec![Emit::Leave("main-2".into())]));
        let (took, out) = d.drop_at("main-2", 600.0, 400.0);
        assert!(took);
        assert_eq!(
            out,
            [
                Emit::Drop("main-2".into(), Dropped { tab: Some(record("/a")), zone: Some(Zone::Pane { pane: 0 }), home: false, x: 600.0, y: 400.0 }),
                Emit::Focus("main-2".into()),
            ]
        );
        // Dropped once only.
        assert_eq!(d.drop_at("main-2", 600.0, 400.0), (false, vec![]));
        assert_eq!(d.end(id), [Emit::End("main".into(), End { tab: 7, outcome: Outcome::Moved, message: None })]);
        assert!(!d.holding());
    }

    #[test]
    fn a_cancelled_drag_leaves_nothing_held_and_the_tab_where_it_was() {
        let mut d = drags();
        let (id, _) = d.start("main", 7, record("/a"), None, [0.0, 0.0]);
        d.hover("main-2", 105.0, 10.0);
        // Escape (USER_CANCELLED): the mark goes, and the source keeps it.
        assert_eq!(d.end(id), [Emit::Leave("main-2".into()), Emit::End("main".into(), End { tab: 7, outcome: Outcome::Cancelled, message: None })]);
        assert!(!d.holding());
        // Nothing to drop any more.
        assert_eq!(d.drop_at("main-2", 105.0, 10.0), (false, vec![]));
        assert_eq!(d.hover("main-2", 105.0, 10.0), (false, vec![]));
        // Windows: back in its window, or Escape.
        d.start("main", 8, record("/b"), Some("b".into()), [0.0, 0.0]);
        assert!(d.take_from("main").is_some());
        assert!(!d.holding());
    }

    #[test]
    fn a_drop_nothing_takes_hands_the_tab_to_a_new_window_once() {
        let mut d = drags();
        let (id, _) = d.start("main", 7, record("/a"), None, [0.0, 0.0]);
        // Let go over another window's sidebar: refused there.
        assert!(!d.drop_at("main-2", 50.0, 400.0).0);
        let (o, _) = d.take_untaken(id).expect("held until a window is made");
        assert_eq!(o.record, record("/a"));
        assert!(!d.holding());
        // Its end after that changes nothing.
        assert_eq!(d.end(id), []);
        // A drag another window took isn't torn off as well.
        let (id, _) = d.start("main", 9, record("/c"), None, [0.0, 0.0]);
        d.drop_at("main-2", 600.0, 400.0);
        assert!(d.take_untaken(id).is_none());
        assert!(d.holding(), "held until the source hears it moved");
        d.end(id);
        assert!(!d.holding());
    }

    #[test]
    fn a_drop_back_on_its_own_window_is_its_own_move() {
        let mut d = drags();
        let (id, _) = d.start("main", 7, record("/a"), None, [0.0, 0.0]);
        // Its own window takes it anywhere, and its page follows the point.
        let (take, out) = d.hover("main", 30.0, 300.0);
        assert!(take);
        assert!(matches!(&out[..], [Emit::Over(l, o)] if l == "main" && o.home && o.zone.is_none()));
        let (_, out) = d.hover("main", 31.0, 300.0);
        assert_eq!(out.len(), 1, "its page hears every move");
        let (took, out) = d.drop_at("main", 31.0, 300.0);
        assert!(took);
        assert_eq!(out, [Emit::Drop("main".into(), Dropped { tab: None, zone: None, home: true, x: 31.0, y: 300.0 })]);
        assert_eq!(d.end(id), [Emit::End("main".into(), End { tab: 7, outcome: Outcome::Home, message: None })]);
    }

    #[test]
    fn moving_from_one_window_to_another_tells_the_first_to_clear_its_mark() {
        let mut d = drags();
        d.zones.insert("main-3".into(), zones(false));
        d.start("main", 7, record("/a"), None, [0.0, 0.0]);
        d.hover("main-2", 105.0, 10.0);
        let (_, out) = d.hover("main-3", 105.0, 10.0);
        assert_eq!(out[0], Emit::Leave("main-2".into()));
        assert!(matches!(&out[1], Emit::Over(l, _) if l == "main-3"));
        assert_eq!(d.leave("main-2"), []);
        assert_eq!(d.leave("main-3"), [Emit::Leave("main-3".into())]);
        // Windows: the pointer over no window.
        d.hover("main-2", 105.0, 10.0);
        assert_eq!(d.leave_all(), [Emit::Leave("main-2".into())]);
        assert_eq!(d.leave_all(), []);
    }

    #[test]
    fn a_window_draws_the_tabs_name_where_the_os_does_not() {
        let mut d = drags();
        d.start("main", 7, record("/a"), Some("a".into()), [0.0, 0.0]);
        let (_, out) = d.hover("main-2", 105.0, 10.0);
        assert!(matches!(&out[..], [Emit::Over(_, o)] if o.label.as_deref() == Some("a")));
        // The name follows the pointer, so every move is news.
        assert_eq!(d.hover("main-2", 106.0, 10.0).1.len(), 1);
    }

    #[test]
    fn the_source_window_closing_or_reloading_drops_the_drag() {
        let mut d = drags();
        let (id, _) = d.start("main", 7, record("/a"), None, [0.0, 0.0]);
        d.hover("main-2", 105.0, 10.0);
        // The window under it hears the drag is over; the source is gone.
        assert_eq!(d.forget("main"), [Emit::Leave("main-2".into())]);
        assert!(!d.holding());
        assert_eq!(d.end(id), []);
        // A window under the drag closing: its zones go, the drag stays.
        d.start("main", 8, record("/b"), None, [0.0, 0.0]);
        d.hover("main-2", 105.0, 10.0);
        assert_eq!(d.forget("main-2"), []);
        assert!(d.holding());
        assert!(!d.zones.contains_key("main-2"));
        assert!(!d.hover("main-2", 105.0, 10.0).0);
    }

    #[test]
    fn a_new_drag_drops_one_whose_end_never_came() {
        let mut d = drags();
        let (old, _) = d.start("main", 7, record("/a"), None, [0.0, 0.0]);
        let (new, out) = d.start("main-2", 9, record("/b"), None, [0.0, 0.0]);
        assert_ne!(old, new);
        assert_eq!(out, [Emit::End("main".into(), End { tab: 7, outcome: Outcome::Cancelled, message: None }), Emit::Began]);
        // The old one's late end is ignored.
        assert_eq!(d.end(old), []);
        assert!(d.holding());
    }

    #[test]
    fn only_a_tab_record_is_held() {
        assert!(check_record(&record("/a")).is_ok());
        assert!(check_record(&json!("x")).is_err());
        assert!(check_record(&json!({ "path": "" })).is_err());
        assert!(check_record(&json!({ "sort": {} })).is_err());
        let long = vec!["/x".repeat(1000); 200];
        assert!(check_record(&json!({ "path": "/a", "back": long })).is_err());
    }

    #[test]
    fn a_torn_off_window_opens_with_the_pointer_over_its_first_tab() {
        let work = [Rect { x: 0, y: 0, w: 1920, h: 1040 }];
        // The pointer at 500, 100; the tab's anchor 140, 18 in.
        assert_eq!(torn_rect((500, 100), (140, 18), (1200, 800), (960, 600), &work), Rect { x: 360, y: 82, w: 1200, h: 800 });
    }

    #[test]
    fn a_torn_off_window_stays_inside_the_work_area_under_the_pointer() {
        let left = Rect { x: 0, y: 0, w: 1920, h: 1040 };
        let right = Rect { x: 1920, y: 0, w: 1280, h: 984 };
        // Near the right edge of the first screen: moved in, at its size.
        assert_eq!(torn_rect((1900, 1000), (140, 18), (1200, 800), (960, 600), &[left, right]), Rect { x: 720, y: 240, w: 1200, h: 800 });
        // On the second screen, which is smaller: moved and shrunk into it.
        let r = torn_rect((2000, 100), (140, 18), (1400, 1000), (960, 600), &[left, right]);
        assert_eq!((r.x, r.y), (1920, 82));
        assert!(r.w <= 1280 && r.h <= 984, "{r:?}");
        // Off every screen: kept as it is with no work area to fit.
        assert_eq!(torn_rect((10, 10), (140, 18), (800, 600), (0, 0), &[]), Rect { x: -130, y: -8, w: 800, h: 600 });
    }

    #[test]
    fn a_point_on_the_screen_in_a_webviews_pixels() {
        assert_eq!(webview_point((1300, 260), (1000, 200), 1.5), (200.0, 40.0));
        assert_eq!(webview_point((10, 10), (0, 0), 0.0), (10.0, 10.0));
        assert_eq!(webview_point((-5, 0), (0, 0), 1.0), (-5.0, 0.0));
    }
}
