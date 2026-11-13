//! The app's Tauri commands, one module per area. `lib.rs` registers them
//! by path; shell profiles (`ShellProfile`) live with the pty code.

pub mod archive;
pub mod config;
pub mod drag_out;
pub mod file_info;
pub mod fs_ops;
pub mod git;
pub mod hash;
pub mod launch;
pub mod listing;
mod recycle_bin;
pub mod replace;
pub mod search;
pub mod system;
pub mod trash;
pub mod wsl;

#[cfg(test)]
pub(crate) mod testing;

/// The size or count limit a command was asked for: 0 means `default`, and
/// the result is never above `cap`.
fn clamp_limit(asked: usize, default: usize, cap: usize) -> usize {
    let n = if asked == 0 { default } else { asked };
    n.min(cap)
}
