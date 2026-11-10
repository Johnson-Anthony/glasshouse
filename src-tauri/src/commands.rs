//! The app's Tauri commands, one module per area. `lib.rs` registers them
//! by path; shell profiles (`ShellProfile`) live with the pty code.

pub mod archive;
pub mod config;
pub mod file_info;
pub mod fs_ops;
pub mod git;
pub mod hash;
pub mod launch;
pub mod listing;
pub mod search;
pub mod system;
pub mod wsl;

#[cfg(test)]
pub(crate) mod testing;
