mod chooser;
mod commands;
mod ops;
#[cfg(target_os = "linux")]
mod portal;
mod proc_tree;
mod pty;
#[cfg(target_os = "linux")]
mod resident;
mod session;
mod startup;
mod watcher;

use std::sync::{Mutex, MutexGuard, PoisonError};

use tauri::Manager;
use tauri_plugin_window_state::StateFlags;

/// Lock `m` even if a thread panicked while holding it. The callers' data
/// (the op and pty registries, a kill handle, captured output, search
/// results) is never left half-updated by a panic, so it is still usable,
/// and unwrapping would turn one panic into every later call panicking too.
/// Release builds abort on panic, so this only matters in dev and test builds.
pub(crate) fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(PoisonError::into_inner)
}

pub fn run() {
    match startup::from_env() {
        startup::Startup::Window(launch) => run_window(launch),
        startup::Startup::IntegrationOn(features) => std::process::exit(commands::integration::on_from_cli(&features)),
        startup::Startup::IntegrationOff(features) => std::process::exit(commands::integration::off_from_cli(&features)),
        #[cfg(target_os = "linux")]
        startup::Startup::Resident(services) => std::process::exit(resident::run(&services)),
        #[cfg(not(target_os = "linux"))]
        startup::Startup::Resident(_) => {
            eprintln!("glasshouse --dbus: D-Bus services are Linux only");
            std::process::exit(2)
        }
        #[cfg(target_os = "linux")]
        startup::Startup::Chooser => std::process::exit(chooser::run()),
        #[cfg(not(target_os = "linux"))]
        startup::Startup::Chooser => {
            eprintln!("glasshouse --chooser: the file chooser is Linux only");
            std::process::exit(2)
        }
    }
}

/// The app's config and assets, made once: `generate_context!` embeds the
/// frontend, so a second call would put it in the binary twice.
fn context() -> tauri::Context<tauri::Wry> {
    tauri::generate_context!()
}

/// Plugins, managed state and every command, for both kinds of window.
fn builder() -> tauri::Builder<tauri::Wry> {
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
            commands::listing::path_kind,
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
            commands::trash::trash_list,
            commands::trash::trash_restore,
            commands::trash::trash_purge,
            commands::trash::trash_unsupported,
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
            commands::git::git_commit_info,
            commands::search::find_in_files,
            commands::replace::replace_preview,
            commands::replace::replace_apply,
            commands::replace::rewrite_text,
            commands::archive::compress,
            commands::archive::archive_create,
            commands::archive::archive_extract,
            commands::archive::archive_discard_staging,
            commands::archive::archive_can_handle,
            commands::hash::hash_sha256,
            commands::launch::open_with_default,
            commands::open_with::open_with_apps,
            commands::open_with::open_with_app,
            commands::open_with::open_with_program,
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
            commands::drag_out::start_drag_out,
            commands::config::read_recent,
            commands::config::append_recent,
            commands::config::clear_recent,
            session::session_owner,
            startup::launch_request,
            chooser::chooser_request,
            chooser::chooser_ready,
            chooser::chooser_painted,
            chooser::chooser_finish,
            chooser::chooser_search,
            commands::integration::integration_status,
            commands::integration::integration_set,
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
}

fn run_window(launch: Option<startup::LaunchRequest>) {
    // Before anything starts a thread: this sets environment variables.
    // GTK sends DESKTOP_STARTUP_ID when it maps the window: the
    // xdg-activation token on Wayland, the startup-notification ID on X11.
    #[cfg(target_os = "linux")]
    startup::take_activation_token();
    #[cfg(windows)]
    commands::drive_letters::no_critical_error_boxes();
    let app = builder()
        .build(context())
        .expect("error while building tauri application");
    // Built but not run: the main window is made when the app runs, so the
    // window-state plugin, which restores a window as it's made, can still
    // be left out of a process that doesn't own the session (session.rs).
    // A window another app asked for ("Show in folder") leaves the session
    // to the user's own windows.
    let session = if launch.is_some() {
        session::SessionOwner::guest()
    } else {
        session::claim(app.path().app_config_dir().ok().as_deref())
    };
    if session.is_owner() {
        let window_state = tauri_plugin_window_state::Builder::new()
            .with_state_flags(StateFlags::SIZE | StateFlags::POSITION | StateFlags::MAXIMIZED)
            .build();
        if let Err(e) = app.handle().plugin(window_state) {
            eprintln!("window-state plugin: {e}");
        }
    }
    app.manage(session);
    app.manage(startup::Launch(launch));
    app.manage(chooser::Chooser::none());
    app.run(|_, _| {});
}

/// A file chooser for another app (`chooser.rs`): `chooser.html` in a
/// dialog-sized window, made hidden and shown once the page has rendered.
/// It never takes the session.
#[cfg(target_os = "linux")]
fn run_chooser(state: chooser::Chooser) {
    let mut ctx = context();
    if let Some(w) = ctx.config_mut().app.windows.first_mut() {
        w.url = tauri::WebviewUrl::App("chooser.html".into());
        w.title = state.title().to_string();
        w.width = 980.0;
        w.height = 640.0;
        w.min_width = Some(560.0);
        w.min_height = Some(360.0);
        w.center = true;
        w.visible = false;
        w.decorations = true;
        w.drag_drop_enabled = false;
    }
    let app = builder().build(ctx).expect("error while building tauri application");
    app.manage(session::SessionOwner::guest());
    app.manage(startup::Launch(None));
    app.manage(state);
    app.run(|handle, event| {
        if let tauri::RunEvent::Exit = event {
            chooser::at_exit(&handle.state::<chooser::Chooser>());
        }
    });
}
