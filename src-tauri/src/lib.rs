mod commands;
mod watcher;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_shell::init())
        .manage(watcher::WatcherState::default())
        .invoke_handler(tauri::generate_handler![
            commands::ping,
            commands::home_dir,
            commands::list_dir,
            commands::drives,
            commands::system_info,
            commands::make_dir,
            commands::rename_entry,
            commands::copy_entry,
            commands::move_entry,
            commands::delete_entry,
            commands::move_to_trash,
            commands::read_text,
            commands::write_text,
            commands::git_status,
            commands::git_blame,
            commands::compress,
            commands::hash_sha256,
            commands::open_with_default,
            commands::reveal_in_explorer,
            commands::spawn_terminal,
            commands::spawn_vscode,
            commands::win_to_wsl,
            commands::wsl_to_win,
            commands::read_pins,
            commands::write_pins,
            commands::read_tags,
            commands::write_tags,
            watcher::watch_dir,
            watcher::unwatch_dir,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
