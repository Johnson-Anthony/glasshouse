mod app_windows;
mod chooser;
mod commands;
mod diagnostics;
mod error;
mod fatal;
mod handoff;
mod migrate;
mod ops;
#[cfg(target_os = "linux")]
mod portal;
mod proc_tree;
mod pty;
#[cfg(target_os = "linux")]
mod resident;
mod session;
mod startup;
mod tab_drag;
mod update;
mod watcher;
mod window_fit;
mod winpath;

use std::sync::{Mutex, MutexGuard, PoisonError};

use tauri::Manager;

/// The identifier in tauri.conf.json, which names the app's config and
/// data folders (`migrate.rs` moves the ones named after the old one).
pub(crate) const APP_ID: &str = "io.github.johnson-anthony.glasshouse";

/// Lock `m` even if a thread panicked while holding it. The callers' data
/// (the op and pty registries, a kill handle, captured output, search
/// results) is never left half-updated by a panic, so it is still usable,
/// and unwrapping would turn one panic into every later call panicking too.
/// Release builds abort on panic, so this only matters in dev and test builds.
pub(crate) fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(PoisonError::into_inner)
}

pub fn run() {
    let startup = startup::from_env();
    diagnostics::install_panic_hook(!matches!(startup, startup::Startup::FatalDialog(_)));
    if let startup::Startup::FatalDialog(why) = startup {
        std::process::exit(fatal::run(why));
    }
    let migrated = migrate::run();
    match startup {
        startup::Startup::Window(launch) => run_window(launch, &migrated),
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
        startup::Startup::FatalDialog(_) => unreachable!("handled before the migration"),
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
        .plugin(diagnostics::plugin())
        .plugin(tauri_plugin_dialog::init())
        // Used from update.rs only; the webview gets none of its commands.
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(watcher::WatcherState::default())
        .manage(pty::PtyRegistry::default())
        .manage(ops::OpRegistry::default())
        .manage(update::UpdateState::default())
        .manage(app_windows::Windows::default())
        .manage(tab_drag::TabDrags::default())
        .manage(commands::drag_out::DragOuts::default())
        // A page that loads again (Import Layout reloads it) forgets its
        // folder watches and terminals; the backend drops them too.
        .on_page_load(|webview, payload| {
            if payload.event() == tauri::webview::PageLoadEvent::Started {
                app_windows::on_page_load(webview.app_handle(), webview.label());
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::listing::home_dir,
            commands::listing::list_dir,
            commands::listing::path_kind,
            commands::listing::real_path,
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
            commands::config::read_remotes,
            commands::config::write_remotes,
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
            app_windows::new_window,
            app_windows::window_start,
            app_windows::session_report,
            app_windows::quit_app,
            pty::profiles::list_shell_profiles,
            commands::launch::spawn_terminal_profile,
            commands::drag_out::start_drag_out,
            commands::drag_out::drag_out_own,
            tab_drag::tab_drop_zones,
            tab_drag::tab_drag_start,
            tab_drag::tab_drag_hover,
            tab_drag::tab_drag_release,
            tab_drag::tab_drag_cancel,
            tab_drag::tab_to_new_window,
            commands::config::read_recent,
            commands::config::append_recent,
            commands::config::clear_recent,
            session::session_owner,
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
            update::update_info,
            update::update_check,
            update::update_install,
            update::update_cancel,
            commands::git::git_file_info,
            commands::system::path_fs_type,
            commands::system::path_space,
            commands::places::desktop_places,
            commands::system::net_rate,
            diagnostics::bug_report_info,
            diagnostics::log_dir,
            watcher::watch_dir,
            watcher::unwatch_dir,
            pty::pty_spawn,
            pty::pty_write,
            pty::pty_resize,
            pty::pty_kill,
        ])
}

fn run_window(launch: Option<startup::LaunchRequest>, migrated: &[(log::Level, String)]) {
    // The launcher's startup ID, for the handoff, then (before anything
    // starts a thread: this sets environment variables) where GTK reads it.
    // GTK sends DESKTOP_STARTUP_ID when it maps the first window: the
    // xdg-activation token on Wayland, the startup-notification ID on X11.
    let token = startup::activation_token();
    #[cfg(target_os = "linux")]
    startup::take_activation_token();
    // Before Tauri, GTK or the webview start: a launch while glasshouse is
    // running opens a window there, and this process ends.
    let handoff = handoff::start(&handoff::Request { launch: launch.clone(), token: token.clone() });
    let server = match handoff.outcome {
        handoff::Outcome::HandedOff => std::process::exit(0),
        handoff::Outcome::Serving(s) => Some(s),
        handoff::Outcome::Alone => None,
    };
    #[cfg(windows)]
    commands::drive_letters::no_critical_error_boxes();
    // Without WebView2 the window can't be made, and the app would just
    // close. The installers bring it; a copied exe or a broken install may not.
    #[cfg(windows)]
    if let Err(e) = tauri::webview_version() {
        diagnostics::log_error(&format!("no WebView2 runtime: {e}"));
        fatal::show(fatal::Fatal::NoWebView);
        std::process::exit(1);
    }
    let app = builder().build(context()).unwrap_or_else(|e| diagnostics::start_failed(&e));
    diagnostics::log_start(&app.package_info().version.to_string(), migrated);
    for (level, line) in &handoff.notes {
        log::log!(target: "handoff", *level, "{line}");
    }
    // Built but not run: the windows are made when the app is ready, so the
    // window-state plugin, which restores a window as it's made, can still
    // be left out of a process that doesn't own the session (session.rs).
    // A window another app asked for ("Show in folder") leaves the session
    // to the user's own windows.
    let dir = app.path().app_config_dir().ok();
    let owner = if launch.is_some() { session::SessionOwner::guest() } else { session::claim(dir.as_deref()) };
    let saved = session::read(dir.as_deref());
    let mut saved = if owner.is_owner() {
        app_windows::register_geometry(app.handle());
        saved
    } else {
        // A guest's windows leave the saved labels free, for when it
        // takes the session (`app_windows::handed_off`).
        if let Some(s) = saved {
            app.state::<app_windows::Windows>().reserve(s.windows.into_iter().map(|w| w.label));
        }
        None
    };
    app.manage(session::Session::new(owner, dir));
    app.manage(chooser::Chooser::none());
    let mut launch = launch;
    app.run(move |handle, event| match event {
        // Ready comes once, before any window is made.
        tauri::RunEvent::Ready => {
            app_windows::first_windows(handle, launch.take(), saved.take(), token.is_some());
            if let Some(s) = &server {
                s.attach(handle);
            }
            diagnostics::started();
        }
        tauri::RunEvent::WindowEvent { label, event, .. } => app_windows::on_window_event(handle, &label, &event),
        tauri::RunEvent::Exit => {
            if let Some(s) = &server {
                s.stop();
            }
            session::flush(handle);
            handle.state::<session::Session>().release();
        }
        _ => {}
    });
}

/// A file chooser for another app (`chooser.rs`): `chooser.html` in a
/// dialog-sized window, made hidden and shown once the page has rendered.
/// It never takes the session, and never hands off or serves.
#[cfg(target_os = "linux")]
fn run_chooser(state: chooser::Chooser) {
    let mut ctx = context();
    if let Some(w) = ctx.config_mut().app.windows.first_mut() {
        // Made by Tauri, unlike the app's windows (`app_windows.rs`).
        w.create = true;
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
    let app = builder().build(ctx).unwrap_or_else(|e| diagnostics::start_failed(&e));
    diagnostics::log_start(&app.package_info().version.to_string(), &[]);
    app.manage(session::Session::new(session::SessionOwner::guest(), None));
    app.manage(state);
    app.run(|handle, event| match event {
        tauri::RunEvent::Ready => {
            diagnostics::started();
            window_fit::fit_main(handle, window_fit::Start::Fresh)
        }
        tauri::RunEvent::Exit => chooser::at_exit(&handle.state::<chooser::Chooser>()),
        _ => {}
    });
}
