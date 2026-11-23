//! The app's Tauri commands, one module per area. `lib.rs` registers them
//! by path; shell profiles (`ShellProfile`) live with the pty code.

pub mod archive;
pub mod clipboard;
pub mod config;
pub mod drag_out;
#[cfg(windows)]
pub(crate) mod drive_letters;
pub mod file_info;
pub mod fs_ops;
pub mod git;
pub mod hash;
pub mod integration;
#[cfg_attr(windows, allow(dead_code))]
pub(crate) mod integration_portal;
#[cfg_attr(windows, allow(dead_code))]
pub(crate) mod integration_xdg;
mod integration_win;
pub mod launch;
pub mod listing;
pub mod open_with;
pub mod places;
mod recycle_bin;
pub mod replace;
pub mod search;
pub mod system;
pub mod trash;
#[cfg(windows)]
mod win_open_with;
pub mod wsl;
pub(crate) mod xdg_apps;

#[cfg(test)]
pub(crate) mod testing;

/// The size or count limit a command was asked for: 0 means `default`, and
/// the result is never above `cap`.
fn clamp_limit(asked: usize, default: usize, cap: usize) -> usize {
    let n = if asked == 0 { default } else { asked };
    n.min(cap)
}
