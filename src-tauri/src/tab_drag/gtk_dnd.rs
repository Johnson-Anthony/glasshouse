//! A tab drag on Linux, through GTK: XDND on X11 and the data device on
//! Wayland, with the same calls. On Wayland the pointer stays with the
//! window the button went down in, even over another window of this
//! process, so only the drag-and-drop protocol says which window the tab is
//! over.
//!
//! - **The source:** at the window's edge with the button down, as for
//!   files (`commands/drag_out.rs`, which explains why then), a GTK drag
//!   from the GTK window, with one target, `application/x-glasshouse-tab`,
//!   and the tab's name as its icon. Nobody asks for its data: the tab's
//!   record is held in memory (`tab_drag.rs`).
//! - **Every window's webview** handles `drag-motion`, `drag-leave` and
//!   `drag-drop` for that target, from this process only
//!   (`gtk_drag_get_source_widget`), and stops the signal there so WebKit
//!   doesn't take it. Any other drag (files from another app) goes on to
//!   wry and WebKit as before.
//! - **The end:** `drag-failed` with `NO_TARGET` (on Wayland also `ERROR`,
//!   which is what a drop on nothing is reported as there) opens a new
//!   window; `USER_CANCELLED` (Escape) leaves the tab; `drag-end` hands the
//!   source's webview the button release it missed (`release`) and tells
//!   the source page.

use std::cell::RefCell;
use std::time::Duration;

use gtk::gdk;
use gtk::glib::translate::{FromGlibPtrFull, ToGlibPtr};
use gtk::glib::{self, SignalHandlerId};
use gtk::prelude::*;
use tauri::{Manager, WebviewWindow};

use super::TARGET;

/// The drag in progress from this process: its window, its handlers there,
/// its webview and its icon, all dropped when it ends.
struct Source {
    win: gtk::ApplicationWindow,
    view: gtk::Widget,
    handlers: Vec<SignalHandlerId>,
    _icon: Option<gtk::Widget>,
}

thread_local! {
    static SOURCE: RefCell<Option<Source>> = const { RefCell::new(None) };
}

/// Drops the drag's handlers, and gives back its webview.
fn clear() -> Option<gtk::Widget> {
    let s = SOURCE.with(|s| s.borrow_mut().take())?;
    for h in s.handlers {
        s.win.disconnect(h);
    }
    Some(s.view)
}

fn wayland() -> bool {
    gdk::Display::default().is_some_and(|d| d.type_().name() == "GdkWaylandDisplay")
}

/// Whether a drag that failed with `result` was let go where nothing took
/// it, which opens a new window. A Wayland compositor says only that the
/// drop was cancelled, which GTK reports as an error; Escape comes from
/// GTK's own grab as a cancel on both.
pub(super) fn tears_off(result: gtk::DragResult, wayland: bool) -> bool {
    result == gtk::DragResult::NoTarget || (wayland && result == gtk::DragResult::Error)
}

/// Starts the drag of tab drag `id` from `window`, on the main thread.
pub(super) fn start(window: &WebviewWindow, id: u64, title: String) -> Result<(), String> {
    let (tx, rx) = std::sync::mpsc::channel();
    let w = window.clone();
    window
        .with_webview(move |pw| {
            let _ = tx.send(begin(&w, pw.inner().upcast(), id, &title));
        })
        .map_err(|e| e.to_string())?;
    rx.recv_timeout(Duration::from_secs(5)).map_err(|_| "the drag didn't start".to_string())?
}

fn begin(window: &WebviewWindow, view: gtk::Widget, id: u64, title: &str) -> Result<(), String> {
    let win = window.gtk_window().map_err(|e| e.to_string())?;
    // A drag whose end never came must not answer for this one.
    clear();
    let app = window.app_handle().clone();
    let targets = gtk::TargetList::new(&[gtk::TargetEntry::new(TARGET, gtk::TargetFlags::SAME_APP, 0)]);
    let a = app.clone();
    let failed = win.connect_drag_failed(move |w, _, result| {
        // What a compositor reports here decides a new window or nothing,
        // and differs between them (see tears_off): worth a line in the log.
        log::info!(target: "tab_drag", "tab drag {id} not dropped on a window: {result:?} ({})", if wayland() { "Wayland" } else { "X11" });
        if tears_off(result, wayland()) {
            super::nothing_took(&a, id, pointer_at(w));
            // No animation of the tab flying back: it's in a window of its own.
            glib::Propagation::Stop
        } else {
            glib::Propagation::Proceed
        }
    });
    let end = win.connect_drag_end(move |_, _| {
        if let Some(view) = clear() {
            release(&view);
        }
        super::ended(&app, id);
    });
    // No event: GTK takes the pointer and its position from the seat, and
    // under Wayland the serial of the press that's still held.
    match win.drag_begin_with_coordinates(&targets, gdk::DragAction::MOVE, 1, None, -1, -1) {
        Some(ctx) => {
            let icon = icon(title);
            match &icon {
                // Below and right of the pointer, as the page's own label.
                Some(i) => ctx.drag_set_icon_widget(i, -12, -12),
                None => ctx.drag_set_icon_default(),
            }
            SOURCE.with(|s| *s.borrow_mut() = Some(Source { win, view, handlers: vec![failed, end], _icon: icon }));
            log::debug!(target: "tab_drag", "drag {id} started");
            Ok(())
        }
        None => {
            win.disconnect(failed);
            win.disconnect(end);
            Err("the drag didn't start".into())
        }
    }
}

/// The tab's name, as the drag's icon.
fn icon(title: &str) -> Option<gtk::Widget> {
    if title.is_empty() {
        return None;
    }
    let label = gtk::Label::new(Some(title));
    label.set_margin_start(10);
    label.set_margin_end(10);
    label.set_margin_top(5);
    label.set_margin_bottom(5);
    // An ellipsized label asks only for room for "…", and the icon's
    // window takes what it asks for: ask for the name, up to 40 characters.
    let chars = title.chars().count().min(40) as i32;
    label.set_width_chars(chars);
    label.set_max_width_chars(40);
    label.set_ellipsize(gtk::pango::EllipsizeMode::Middle);
    label.show();
    Some(label.upcast())
}

/// Hands `view` the release of button 1, when a drag that began with a
/// press in it ends: a tab's here, files' in `commands/drag_out.rs`. WebKit
/// saw the press the drag began with, but not its release, which went to
/// the drag. It would count the button as still down, and by the rule for
/// chorded buttons fire no `pointerdown` for the next press: the next drag
/// in that window (a tab, files, a selection) wouldn't start. The release
/// is where the pointer is, kept inside the view; the page swallows the
/// click it may make (`tabMoves.ts`, `dragDrop.ts`).
pub(crate) fn release(view: &gtk::Widget) {
    let Some(win) = view.window() else { return };
    let Some(pointer) = WidgetExt::display(view).default_seat().and_then(|s| s.pointer()) else { return };
    let (_, x, y, _) = win.device_position_double(&pointer);
    let size = view.allocation();
    let x = x.clamp(0.0, f64::from((size.width() - 1).max(0)));
    let y = y.clamp(0.0, f64::from((size.height() - 1).max(0)));
    let (_, left, top) = win.origin();
    // SAFETY: gdk_event_new returns a new, zeroed event of the type asked
    // for, which `from_glib_full` takes over and frees. Its `button` member
    // is the one a button event uses. The window gets a reference of its own
    // (`to_glib_full`), which freeing the event drops.
    let mut ev: gdk::Event = unsafe {
        let raw = gdk::ffi::gdk_event_new(gdk::ffi::GDK_BUTTON_RELEASE);
        let b = &mut (*raw).button;
        b.window = win.to_glib_full();
        b.send_event = 1;
        b.time = gtk::current_event_time();
        b.x = x;
        b.y = y;
        b.x_root = f64::from(left) + x;
        b.y_root = f64::from(top) + y;
        b.state = gdk::ffi::GDK_BUTTON1_MASK;
        b.button = 1;
        gdk::Event::from_glib_full(raw)
    };
    ev.set_device(Some(&pointer));
    ev.set_source_device(Some(&pointer));
    view.event(&ev);
}

/// The pointer in physical screen pixels, where there are any: X11. On
/// Wayland a window can't know, and the compositor places the new one.
fn pointer_at(w: &gtk::ApplicationWindow) -> Option<(i32, i32)> {
    if wayland() {
        return None;
    }
    let pointer = WidgetExt::display(w).default_seat()?.pointer()?;
    let (_, x, y) = pointer.position();
    let s = w.scale_factor();
    Some((x * s, y * s))
}

/// The drag offers a tab.
fn offers_tab(ctx: &gdk::DragContext) -> bool {
    ctx.list_targets().iter().any(|a| a.name() == TARGET)
}

/// The drag is this process's: only then is its tab held here. Another
/// glasshouse process's tab is refused.
fn from_here(ctx: &gdk::DragContext) -> bool {
    ctx.drag_get_source_widget().is_some()
}

/// `window`'s webview takes tabs dragged from this process's windows.
pub(super) fn attach(window: &WebviewWindow) {
    let app = window.app_handle().clone();
    let label = window.label().to_string();
    let named = label.clone();
    if let Err(e) = window.with_webview(move |pw| connect(&pw.inner().upcast::<gtk::Widget>(), app, label)) {
        log::warn!(target: "tab_drag", "window {named} won't take dragged tabs: {e}");
    }
}

fn connect(view: &gtk::Widget, app: tauri::AppHandle, label: String) {
    let (a, l) = (app.clone(), label.clone());
    view.connect_drag_motion(move |_, ctx, x, y, time| {
        if !offers_tab(ctx) {
            return false;
        }
        let take = from_here(ctx) && super::hover(&a, &l, f64::from(x), f64::from(y));
        ctx.drag_status(if take { gdk::DragAction::MOVE } else { gdk::DragAction::empty() }, time);
        true
    });
    let (a, l) = (app.clone(), label.clone());
    view.connect_drag_leave(move |w, ctx, _| {
        if !offers_tab(ctx) {
            return;
        }
        super::left(&a, &l);
        w.stop_signal_emission_by_name("drag-leave");
    });
    view.connect_drag_drop(move |_, ctx, x, y, time| {
        if !offers_tab(ctx) {
            return false;
        }
        let took = from_here(ctx) && super::dropped(&app, &label, f64::from(x), f64::from(y));
        ctx.drag_finish(took, false, time);
        true
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_a_drop_on_nothing_opens_a_window() {
        assert!(tears_off(gtk::DragResult::NoTarget, false));
        assert!(tears_off(gtk::DragResult::NoTarget, true));
        assert!(tears_off(gtk::DragResult::Error, true));
        assert!(!tears_off(gtk::DragResult::Error, false));
        for wayland in [false, true] {
            assert!(!tears_off(gtk::DragResult::UserCancelled, wayland));
            assert!(!tears_off(gtk::DragResult::GrabBroken, wayland));
            assert!(!tears_off(gtk::DragResult::TimeoutExpired, wayland));
        }
    }
}
