//! The window under the cursor, for a tab let go outside its window on
//! Windows. The page keeps the pointer while the button is down (the
//! webview holds the mouse capture), so the drag never becomes an OS drag:
//! the backend looks where the cursor is, and `tab_drag.rs` matches the
//! top-level window found there against the app's own.

use windows::Win32::Foundation::POINT;
use windows::Win32::UI::WindowsAndMessaging::{GetAncestor, GetCursorPos, WindowFromPoint, GA_ROOT};

/// The cursor in physical screen pixels, and the top-level window under it
/// (its handle as a number) if there's one.
pub fn under_cursor() -> Option<((i32, i32), Option<isize>)> {
    let mut pt = POINT::default();
    // SAFETY: GetCursorPos writes the POINT it's given, which lives here.
    unsafe { GetCursorPos(&mut pt) }.ok()?;
    // SAFETY: a plain query with a point; a null handle means no window.
    let hit = unsafe { WindowFromPoint(pt) };
    if hit.0.is_null() {
        return Some(((pt.x, pt.y), None));
    }
    // SAFETY: `hit` is a window handle WindowFromPoint just returned; a
    // window gone since then makes GetAncestor return null.
    let root = unsafe { GetAncestor(hit, GA_ROOT) };
    let root = if root.0.is_null() { hit } else { root };
    Some(((pt.x, pt.y), Some(root.0 as isize)))
}
