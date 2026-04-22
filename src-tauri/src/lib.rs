mod commands;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_shell::init())
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
            commands::read_text,
            commands::git_status,
            commands::open_with_default,
            commands::reveal_in_explorer,
            commands::win_to_wsl,
            commands::wsl_to_win,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
