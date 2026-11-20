//! The window fits the screen it opens on. tauri.conf.json asks for
//! 1400×900 (logical), more than a small screen or a scaled one has: on a
//! 1024×768 screen the window ran under the taskbar, and at 1920×1080 with
//! 150% scaling it was too big as well.
//!
//! This runs when the app is ready: the window exists, the window-state
//! plugin has already restored any saved size and place (its restore runs as
//! the window is made), and nothing has been painted yet. The plugin saves
//! what the window ends up as, since its move and resize handlers run after
//! this, so the next start restores a size that fits. See
//! docs/decisions/2026-11-20-first-run-defaults.md.
//!
//! On Linux a window's size and place are known only once the window system
//! has configured it, which is after this: until then they read as zeros,
//! and the plugin's restore is still queued. Then the window is taken to be
//! what it was asked to be: the restored size and place, or the config's
//! size at a place the window manager picks.

use std::path::Path;

use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize, Runtime, WebviewWindow};

/// A rectangle in physical pixels.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub w: u32,
    pub h: u32,
}

impl Rect {
    fn right(&self) -> i64 {
        self.x as i64 + self.w as i64
    }

    fn bottom(&self) -> i64 {
        self.y as i64 + self.h as i64
    }

    fn contains(&self, o: &Rect) -> bool {
        o.x >= self.x && o.y >= self.y && o.right() <= self.right() && o.bottom() <= self.bottom()
    }

    fn contains_point(&self, x: i64, y: i64) -> bool {
        x >= self.x as i64 && y >= self.y as i64 && x < self.right() && y < self.bottom()
    }

    fn overlap(&self, o: &Rect) -> u64 {
        let w = self.right().min(o.right()) - (self.x as i64).max(o.x as i64);
        let h = self.bottom().min(o.bottom()) - (self.y as i64).max(o.y as i64);
        if w > 0 && h > 0 {
            (w * h) as u64
        } else {
            0
        }
    }
}

/// How the main window starts.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Start {
    /// Nothing saved: a first run, or the file chooser.
    Fresh,
    /// The window-state plugin restored what it saved.
    Restored(Saved),
    /// Placed by the OS, at the config's size: a second window, which the
    /// plugin doesn't restore.
    Placed,
}

/// What the window-state plugin saved for a window: its outer place and
/// inner size, in physical pixels.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Saved {
    pub rect: Rect,
    pub maximized: bool,
}

/// How a window is placed.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Mode {
    /// Nothing saved (a first run, or the file chooser): the size it asks
    /// for, made smaller if that doesn't fit, centered on the work area.
    Fresh,
    /// Restored by the window-state plugin, or placed by the OS (a second
    /// window): left alone if it fits, else shrunk and moved inside.
    Keep,
}

/// The most of the work area a window takes when it's made smaller than it
/// asked for, so it still looks like a window rather than a maximized one.
const SHARE: f64 = 0.9;

/// The work area `window` belongs to: the one holding its center, else the
/// one it overlaps most, else the first (the caller puts the primary first).
pub fn work_area_for(window: Rect, areas: &[Rect]) -> Option<Rect> {
    let cx = window.x as i64 + window.w as i64 / 2;
    let cy = window.y as i64 + window.h as i64 / 2;
    if let Some(a) = areas.iter().find(|a| a.contains_point(cx, cy)) {
        return Some(*a);
    }
    areas
        .iter()
        .max_by_key(|a| a.overlap(&window))
        .filter(|a| a.overlap(&window) > 0)
        .or_else(|| areas.first())
        .copied()
}

/// One side of a window that has to fit `room`: `want` if it fits in
/// SHARE of it, else SHARE of it but at least `min`, and never more than
/// `room`.
fn side(want: u32, min: u32, room: u32) -> u32 {
    let share = (room as f64 * SHARE).floor() as u32;
    if want <= share {
        want
    } else {
        share.max(min).min(room)
    }
}

/// The window's new outer rectangle, or None to leave it as it is.
/// `want` is the size it asks for and `min` its smallest size, both outer.
pub fn place(window: Rect, work: Rect, want: (u32, u32), min: (u32, u32), mode: Mode) -> Option<Rect> {
    if work.w == 0 || work.h == 0 {
        return None;
    }
    let placed = match mode {
        Mode::Fresh => {
            let w = side(want.0, min.0, work.w);
            let h = side(want.1, min.1, work.h);
            Rect {
                x: work.x + ((work.w - w) / 2) as i32,
                y: work.y + ((work.h - h) / 2) as i32,
                w,
                h,
            }
        }
        Mode::Keep => {
            if work.contains(&window) {
                return None;
            }
            let w = if window.w > work.w { side(window.w, min.0, work.w) } else { window.w };
            let h = if window.h > work.h { side(window.h, min.1, work.h) } else { window.h };
            let clamp = |v: i32, lo: i32, len: u32, room: u32| v.clamp(lo, lo + (room - len) as i32);
            Rect {
                x: clamp(window.x, work.x, w, work.w),
                y: clamp(window.y, work.y, h, work.h),
                w,
                h,
            }
        }
    };
    (placed != window).then_some(placed)
}

/// A smallest size that fits `work`, when `min` doesn't.
pub fn min_for(min: (u32, u32), work: Rect) -> Option<(u32, u32)> {
    (min.0 > work.w || min.1 > work.h).then(|| (min.0.min(work.w), min.1.min(work.h)))
}

/// What the window-state plugin saved for `label` in `file`, when it saved a
/// size, which it then restores (it skips an entry of zeros).
pub fn saved_state(file: &Path, label: &str) -> Option<Saved> {
    let text = std::fs::read_to_string(file).ok()?;
    let v = serde_json::from_str::<serde_json::Value>(&text).ok()?;
    let entry = v.get(label)?;
    let num = |k: &str| entry.get(k).and_then(|n| n.as_i64()).unwrap_or(0);
    let flag = |k: &str| entry.get(k).and_then(|b| b.as_bool()).unwrap_or(false);
    let (w, h) = (u32::try_from(num("width")).ok()?, u32::try_from(num("height")).ok()?);
    if w == 0 || h == 0 {
        return None;
    }
    let pos = |k: &str| i32::try_from(num(k)).unwrap_or(0);
    Some(Saved {
        rect: Rect { x: pos("x"), y: pos("y"), w, h },
        maximized: flag("maximized") || flag("fullscreen"),
    })
}

/// How the main window of a process that owns the session starts: Restored
/// when the window-state plugin was registered and has a size to restore.
pub fn start_for_owner<R: Runtime>(app: &AppHandle<R>, plugin_registered: bool) -> Start {
    if !plugin_registered {
        return Start::Fresh;
    }
    app.path()
        .app_config_dir()
        .ok()
        .and_then(|dir| saved_state(&dir.join(tauri_plugin_window_state::DEFAULT_FILENAME), "main"))
        .map_or(Start::Fresh, Start::Restored)
}

/// Fit the main window to its screen. The size it asks for and its minimum
/// come from the first window in the config. Errors are printed: a window
/// that couldn't be fitted is still a window.
pub fn fit_main<R: Runtime>(app: &AppHandle<R>, start: Start) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let Some(cfg) = app.config().app.windows.first() else {
        return;
    };
    let want = (cfg.width, cfg.height);
    let min = (cfg.min_width.unwrap_or(0.0), cfg.min_height.unwrap_or(0.0));
    if let Err(e) = fit(&window, want, min, start) {
        log::warn!("fitting the window to the screen: {e}");
    }
}

/// `want` and `min` are logical inner sizes.
fn fit<R: Runtime>(window: &WebviewWindow<R>, want: (f64, f64), min: (f64, f64), start: Start) -> tauri::Result<()> {
    if window.is_maximized()? || window.is_fullscreen()? {
        return Ok(());
    }
    let outer = window.outer_size()?;
    let inner = window.inner_size()?;
    // Wayland has no global positions; every window is at 0,0 there, and
    // only its size counts.
    let pos = window.outer_position().unwrap_or_default();
    let mut rect = Rect { x: pos.x, y: pos.y, w: outer.width, h: outer.height };
    // Not configured yet (Linux): what it was asked to be.
    let known = outer.width > 0 && outer.height > 0;
    if !known {
        if let Start::Restored(saved) = start {
            if saved.maximized {
                return Ok(());
            }
            rect = saved.rect;
        }
    }

    let mut monitors = window.available_monitors()?;
    if let Some(primary) = window.primary_monitor()? {
        if let Some(i) = monitors.iter().position(|m| m.position() == primary.position()) {
            let p = monitors.remove(i);
            monitors.insert(0, p);
        }
    }
    let areas: Vec<Rect> = monitors
        .iter()
        .map(|m| {
            let a = m.work_area();
            Rect { x: a.position.x, y: a.position.y, w: a.size.width, h: a.size.height }
        })
        .collect();
    let Some(work) = work_area_for(rect, &areas) else {
        return Ok(());
    };
    let scale = areas
        .iter()
        .position(|a| *a == work)
        .map(|i| monitors[i].scale_factor())
        .unwrap_or(1.0);

    let frame = (outer.width.saturating_sub(inner.width), outer.height.saturating_sub(inner.height));
    let px = |v: f64| (v * scale).round().max(0.0) as u32;
    let want = (px(want.0) + frame.0, px(want.1) + frame.1);
    let min = (px(min.0) + frame.0, px(min.1) + frame.1);
    // A second window that isn't configured yet is at the config's size,
    // where the window manager will put it: only its size is changed.
    let placed_by_wm = !known && start == Start::Placed;
    if placed_by_wm {
        (rect.w, rect.h) = want;
    }
    let mode = if start == Start::Fresh { Mode::Fresh } else { Mode::Keep };

    // First, or the window manager holds the window at its old minimum.
    if let Some((w, h)) = min_for(min, work) {
        window.set_min_size(Some(PhysicalSize::new(w.saturating_sub(frame.0), h.saturating_sub(frame.1))))?;
    }
    if let Some(r) = place(rect, work, want, min, mode) {
        window.set_size(PhysicalSize::new(r.w.saturating_sub(frame.0), r.h.saturating_sub(frame.1)))?;
        if !placed_by_wm {
            window.set_position(PhysicalPosition::new(r.x, r.y))?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const fn r(x: i32, y: i32, w: u32, h: u32) -> Rect {
        Rect { x, y, w, h }
    }

    /// The config's 1400×900 and 960×600 at 100%.
    const WANT: (u32, u32) = (1400, 900);
    const MIN: (u32, u32) = (960, 600);

    #[test]
    fn a_first_window_on_a_big_screen_gets_what_it_asks_for_centered() {
        let work = r(0, 0, 1920, 1040);
        assert_eq!(place(r(0, 0, 1400, 900), work, WANT, MIN, Mode::Fresh), Some(r(260, 70, 1400, 900)));
    }

    #[test]
    fn a_first_window_on_a_small_screen_fits_its_work_area() {
        // GitHub's Windows runner: 1024×768 with a 48 px taskbar.
        let work = r(0, 0, 1024, 720);
        let got = place(r(0, 0, 1044, 788), work, WANT, MIN, Mode::Fresh).unwrap();
        assert!(work.contains(&got), "{got:?}");
        // Width: 90% would be under the minimum, so the minimum; height: 90%.
        assert_eq!(got, r(32, 36, 960, 648));
    }

    #[test]
    fn a_first_window_at_150_percent_on_1080p_fits() {
        // 1920×1080 at 150%: the config's size is 2100×1350 physical.
        let work = r(0, 0, 1920, 1032);
        let want = (2100, 1350);
        let min = (1440, 900);
        let got = place(r(0, 0, 2100, 1350), work, want, min, Mode::Fresh).unwrap();
        assert_eq!(got, r(96, 52, 1728, 928));
    }

    #[test]
    fn a_first_window_is_centered_on_a_work_area_that_is_not_at_the_origin() {
        // A second monitor to the right, with a taskbar along its top.
        let work = r(1920, 40, 2560, 1400);
        assert_eq!(place(r(1920, 40, 1400, 900), work, WANT, MIN, Mode::Fresh), Some(r(2500, 290, 1400, 900)));
    }

    #[test]
    fn a_work_area_smaller_than_the_minimum_gets_the_whole_area() {
        let work = r(0, 0, 900, 560);
        let got = place(r(0, 0, 1400, 900), work, WANT, MIN, Mode::Fresh).unwrap();
        assert_eq!(got, r(0, 0, 900, 560));
        assert_eq!(min_for(MIN, work), Some((900, 560)));
        assert_eq!(min_for(MIN, r(0, 0, 1024, 720)), None);
    }

    #[test]
    fn a_restored_window_that_fits_is_left_alone() {
        let work = r(0, 0, 1920, 1040);
        assert_eq!(place(r(100, 50, 1200, 800), work, WANT, MIN, Mode::Keep), None);
        assert_eq!(place(r(0, 0, 1920, 1040), work, WANT, MIN, Mode::Keep), None);
    }

    #[test]
    fn a_restored_window_too_big_for_a_smaller_screen_is_shrunk_and_moved_in() {
        // Saved on a 2560×1440 monitor, restored on a laptop's 1366×728.
        let work = r(0, 0, 1366, 728);
        let got = place(r(200, 100, 2000, 1200), work, WANT, MIN, Mode::Keep).unwrap();
        assert!(work.contains(&got), "{got:?}");
        assert_eq!((got.w, got.h), (1229, 655));
    }

    #[test]
    fn a_restored_window_partly_off_screen_is_moved_in_at_its_size() {
        let work = r(0, 0, 1920, 1040);
        assert_eq!(place(r(1500, 600, 1200, 800), work, WANT, MIN, Mode::Keep), Some(r(720, 240, 1200, 800)));
        assert_eq!(place(r(-300, -20, 1200, 800), work, WANT, MIN, Mode::Keep), Some(r(0, 0, 1200, 800)));
    }

    #[test]
    fn only_the_side_that_does_not_fit_shrinks() {
        let work = r(0, 0, 1920, 720);
        assert_eq!(place(r(10, 0, 1400, 900), work, WANT, MIN, Mode::Keep), Some(r(10, 0, 1400, 648)));
    }

    #[test]
    fn the_work_area_is_the_one_holding_the_window_center() {
        let left = r(0, 0, 1920, 1040);
        let right = r(1920, 0, 1280, 984);
        let areas = [left, right];
        assert_eq!(work_area_for(r(1800, 100, 1000, 700), &areas), Some(right));
        assert_eq!(work_area_for(r(100, 100, 1000, 700), &areas), Some(left));
        // Off every monitor: the one it overlaps most, else the first.
        assert_eq!(work_area_for(r(3000, -500, 400, 600), &areas), Some(right));
        assert_eq!(work_area_for(r(9000, 9000, 400, 300), &areas), Some(left));
        assert_eq!(work_area_for(r(0, 0, 10, 10), &[]), None);
    }

    #[test]
    fn an_empty_work_area_changes_nothing() {
        assert_eq!(place(r(0, 0, 1400, 900), r(0, 0, 0, 0), WANT, MIN, Mode::Fresh), None);
    }

    #[test]
    fn a_saved_state_is_one_with_a_size() {
        let dir = crate::commands::testing::temp_dir("window-fit");
        let file = dir.join(".window-state.json");
        assert_eq!(saved_state(&file, "main"), None);
        std::fs::write(&file, r#"{"main":{"width":1200,"height":800,"x":-5,"y":6,"maximized":false}}"#).unwrap();
        assert_eq!(saved_state(&file, "main"), Some(Saved { rect: r(-5, 6, 1200, 800), maximized: false }));
        assert_eq!(saved_state(&file, "other"), None);
        std::fs::write(&file, r#"{"main":{"width":1200,"height":800,"x":0,"y":0,"fullscreen":true}}"#).unwrap();
        assert!(saved_state(&file, "main").unwrap().maximized);
        std::fs::write(&file, r#"{"main":{"width":0,"height":0}}"#).unwrap();
        assert_eq!(saved_state(&file, "main"), None);
        std::fs::write(&file, "not json").unwrap();
        assert_eq!(saved_state(&file, "main"), None);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
