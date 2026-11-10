mod commands;
mod ops;
mod proc_tree;
mod pty;
mod watcher;

use std::sync::{Mutex, MutexGuard, PoisonError};

/// Lock `m` even if a thread panicked while holding it. The callers' data
/// (the op and pty registries, a kill handle, captured output, search
/// results) is never left half-updated by a panic, so it is still usable,
/// and unwrapping would turn one panic into every later call panicking too.
/// Release builds abort on panic, so this only matters in dev and test builds.
pub(crate) fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(PoisonError::into_inner)
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_shell::init())
        .manage(watcher::WatcherState::default())
        .manage(pty::PtyRegistry::default())
        .manage(ops::OpRegistry::default())
        .invoke_handler(tauri::generate_handler![
            commands::listing::home_dir,
            commands::listing::list_dir,
            commands::system::drives,
            commands::wsl::list_wsl_distros,
            commands::system::system_info,
            commands::fs_ops::make_dir,
            commands::fs_ops::rename_entry,
            commands::fs_ops::copy_entry,
            commands::fs_ops::move_entry,
            commands::fs_ops::delete_entry,
            commands::fs_ops::move_to_trash,
            commands::fs_ops::trash_dir,
            commands::fs_ops::read_text,
            commands::fs_ops::write_text,
            commands::fs_ops::read_image_b64,
            commands::git::git_status,
            commands::git::git_blame,
            commands::git::git_stage,
            commands::git::git_unstage,
            commands::git::git_discard,
            commands::git::git_run,
            commands::git::git_branch_list,
            commands::search::find_in_files,
            commands::archive::compress,
            commands::archive::archive_create,
            commands::archive::archive_extract,
            commands::archive::archive_can_handle,
            commands::hash::hash_sha256,
            commands::launch::open_with_default,
            commands::launch::reveal_in_explorer,
            commands::launch::spawn_terminal,
            commands::launch::spawn_vscode,
            commands::wsl::win_to_wsl,
            commands::config::read_pins,
            commands::config::write_pins,
            commands::config::read_tags,
            commands::config::write_tags,
            commands::fs_ops::set_permissions,
            commands::file_info::read_hex_dump,
            commands::file_info::diff_files,
            commands::search::find_file_by_name,
            commands::fs_ops::create_symlink,
            commands::fs_ops::create_hard_link,
            commands::fs_ops::create_shortcut,
            commands::fs_ops::shred,
            commands::file_info::verify_signature,
            commands::fs_ops::change_owner,
            commands::launch::run_script,
            commands::launch::open_url,
            commands::launch::spawn_new_window,
            pty::profiles::list_shell_profiles,
            commands::launch::spawn_terminal_profile,
            commands::config::read_recent,
            commands::config::append_recent,
            commands::config::clear_recent,
            commands::file_info::file_stat_extended,
            commands::hash::hash_md5,
            commands::hash::hash_crc32,
            ops::cancel_op,
            commands::git::git_file_info,
            commands::system::path_fs_type,
            commands::system::net_rate,
            watcher::watch_dir,
            watcher::unwatch_dir,
            pty::pty_spawn,
            pty::pty_write,
            pty::pty_resize,
            pty::pty_kill,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
