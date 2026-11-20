//! Updates: Help → Check for Updates, and Preferences → Updates' "check for
//! updates automatically" (off unless the user turns it on). glasshouse
//! makes no network request otherwise. See
//! docs/decisions/2026-11-20-updater-design.md.
//!
//! A check is one GET of the latest release's latest.json (the endpoint in
//! tauri.conf.json, `plugins.updater`), through tauri-plugin-updater, here
//! in Rust: the plugin's own commands aren't granted to the webview, and the
//! CSP's `connect-src` stays local. A download starts only when the user
//! picks Install, and the package's minisign signature is checked against
//! the public key in tauri.conf.json, bound to the version announced
//! (`requireSignedVersion`), before anything is installed.
//!
//! How a copy updates depends on how it was installed. The Tauri bundler
//! writes a marker into each package's copy of the binary, which
//! `bundle_type()` reads:
//! - the NSIS setup (per user) and the MSI (per machine) run the new
//!   installer of the same kind, which the plugin picks from the marker
//!   (`windows-<arch>-nsis` or `-msi` in latest.json);
//! - an AppImage is replaced in place, if the user can write to its folder;
//! - a .deb or .rpm belongs to the package manager: the user gets a link to
//!   the new package and installs it the way they installed this one;
//! - no marker means a build from source (`tauri dev`, `--no-bundle`), which
//!   can only be told that a new version is out.

use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::utils::config::BundleType;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_updater::{Error as UpdaterError, Update, UpdaterExt};

use crate::lock;

/// How this copy was installed.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Install {
    Nsis,
    Msi,
    AppImage,
    Deb,
    Rpm,
    /// No package marker: built from source, or a package type glasshouse
    /// doesn't ship.
    Source,
}

impl Install {
    fn from_bundle(bundle: Option<BundleType>) -> Install {
        match bundle {
            Some(BundleType::Nsis) => Install::Nsis,
            Some(BundleType::Msi) => Install::Msi,
            Some(BundleType::AppImage) => Install::AppImage,
            Some(BundleType::Deb) => Install::Deb,
            Some(BundleType::Rpm) => Install::Rpm,
            _ => Install::Source,
        }
    }

    fn current() -> Install {
        Install::from_bundle(tauri::utils::platform::bundle_type())
    }

    /// The file a download link for this install should end with, when the
    /// user installs the update themselves.
    fn package_suffix(self) -> Option<&'static str> {
        match self {
            Install::Deb => Some(".deb"),
            Install::Rpm => Some(".rpm"),
            Install::AppImage => Some(".AppImage"),
            _ => None,
        }
    }
}

/// What Preferences → Updates and the update dialog show.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub version: String,
    pub install: Install,
    /// glasshouse can install an update itself (else it links to it).
    pub can_install: bool,
    /// The AppImage's path, when that's how it runs.
    pub app_image: Option<String>,
    /// The URL a check fetches.
    pub endpoint: String,
    /// The last check that got an answer, in ms since 1970.
    pub last_check: Option<u64>,
}

/// One check's answer.
#[derive(Debug, Serialize)]
#[serde(tag = "status", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum CheckResult {
    /// This is the newest version.
    Current { version: String },
    Available {
        version: String,
        current: String,
        /// RFC 3339, as latest.json has it.
        date: Option<String>,
        notes: String,
        /// The package to download, when the user installs it themselves.
        download: Option<String>,
        can_install: bool,
    },
    /// An automatic check that had nothing to show: not due yet, or a
    /// version it already reported.
    Quiet,
}

/// Download progress, as the `update-progress` event.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    pub got: u64,
    pub total: Option<u64>,
    /// The download is done and verified; the installer is running.
    pub installing: bool,
}

/// What the last check found, for Install, and the install running.
#[derive(Default)]
pub struct UpdateState {
    found: Mutex<Option<Update>>,
    run: Mutex<Option<Running>>,
}

/// An install in progress. Cancel and the start of the installer both take
/// the lock, so a cancel either stops the download or is refused.
#[derive(Default)]
struct Running {
    /// Aborts the download task.
    abort: Option<Box<dyn Fn() + Send>>,
    cancelled: bool,
    installing: bool,
}

/// When the automatic check last ran, kept in the config folder
/// (`update.json`), so every window and restart shares it.
#[derive(Debug, Default, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Record {
    /// The last check that got an answer from the server (seconds).
    pub last_check: Option<u64>,
    /// The last attempt, answered or not (seconds).
    pub last_try: Option<u64>,
    /// The newest version already shown, which the automatic check doesn't
    /// show again.
    pub notified: Option<String>,
}

const DAY: u64 = 24 * 60 * 60;
/// After a check that got no answer (offline), the next automatic one.
const RETRY: u64 = 60 * 60;
const RECORD_FILE: &str = "update.json";
/// A check is one small file; a slow link still fetches it in this time.
const CHECK_TIMEOUT: Duration = Duration::from_secs(30);

/// Seconds since `t`, as of `now`. A time ahead of `now` (the clock went
/// back) counts as long ago, so a wrong clock can't stop the checks.
fn since(t: Option<u64>, now: u64) -> u64 {
    match t {
        Some(t) if t <= now => now - t,
        _ => u64::MAX,
    }
}

/// Whether the automatic check should ask the server now: a day after the
/// last answer, and an hour after the last attempt.
pub fn due(r: &Record, now: u64) -> bool {
    since(r.last_check, now) >= DAY && since(r.last_try, now) >= RETRY
}

fn now_secs() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

fn record_path(app: &AppHandle) -> Option<std::path::PathBuf> {
    app.path().app_config_dir().ok().map(|d| d.join(RECORD_FILE))
}

fn read_record(app: &AppHandle) -> Record {
    record_path(app)
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

/// Best effort: without it the automatic check just asks again sooner.
fn write_record(app: &AppHandle, r: &Record) {
    let Some(path) = record_path(app) else { return };
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    if let Ok(body) = serde_json::to_string(r) {
        if let Err(e) = crate::commands::config::write_config_atomic(&path, &body) {
            eprintln!("update: {e}");
        }
    }
}

/// The running AppImage, if that's how glasshouse runs.
fn app_image(app: &AppHandle) -> Option<std::path::PathBuf> {
    app.env().appimage.map(Into::into)
}

/// Whether the user can replace the file at `path`: the updater moves it
/// aside and writes the new one in its folder.
#[cfg(unix)]
fn can_replace(path: &std::path::Path) -> bool {
    use std::os::unix::ffi::OsStrExt;
    let Some(dir) = path.parent() else { return false };
    let Ok(c) = std::ffi::CString::new(dir.as_os_str().as_bytes()) else { return false };
    // SAFETY: `c` is a valid NUL-terminated path for the call's duration.
    unsafe { libc::access(c.as_ptr(), libc::W_OK) == 0 }
}

#[cfg(not(unix))]
fn can_replace(_path: &std::path::Path) -> bool {
    false
}

/// Whether this install updates itself: the Windows installers do; an
/// AppImage does when it runs as one and its folder is writable.
fn can_install(install: Install, app_image: Option<&std::path::Path>) -> bool {
    match install {
        Install::Nsis | Install::Msi => true,
        Install::AppImage => app_image.is_some_and(can_replace),
        _ => false,
    }
}

fn endpoint(app: &AppHandle) -> String {
    app.config()
        .plugins
        .0
        .get("updater")
        .and_then(|u| u.get("endpoints"))
        .and_then(|e| e.get(0))
        .and_then(|e| e.as_str())
        .unwrap_or_default()
        .to_string()
}

/// The updater's errors in words the update dialog can show.
pub fn words(e: &UpdaterError) -> String {
    match e {
        UpdaterError::Reqwest(r) if r.is_connect() || r.is_timeout() => {
            "Couldn't reach the update server. Check the internet connection and try again.".into()
        }
        UpdaterError::Reqwest(r) if r.is_decode() => {
            "The update information couldn't be read (latest.json isn't valid).".into()
        }
        UpdaterError::Reqwest(r) => format!("The update server couldn't be reached: {r}"),
        UpdaterError::Serialization(_) => {
            "The update information couldn't be read (latest.json isn't valid).".into()
        }
        UpdaterError::ReleaseNotFound => {
            "The latest release has no update information (latest.json). See the releases page.".into()
        }
        UpdaterError::TargetNotFound(_) | UpdaterError::TargetsNotFound(_) => {
            "The latest release has no package for this system. See the releases page.".into()
        }
        UpdaterError::Network(m) => format!("The download failed: {m}"),
        UpdaterError::Minisign(_) | UpdaterError::Base64(_) | UpdaterError::SignatureUtf8(_) => {
            "The download's signature doesn't match glasshouse's key, so it wasn't installed.".into()
        }
        UpdaterError::SignedVersionMismatch { signed, announced } => format!(
            "The download is signed as version {signed}, not the {announced} announced, so it wasn't installed."
        ),
        UpdaterError::MissingSignedVersion => {
            "The download's signature names no version, so it wasn't installed.".into()
        }
        UpdaterError::InvalidUpdaterFormat | UpdaterError::BinaryNotFoundInArchive => {
            "The download isn't a package this copy of glasshouse can install.".into()
        }
        UpdaterError::Io(io) if io.kind() == std::io::ErrorKind::PermissionDenied => {
            format!("glasshouse couldn't replace itself ({io}). Download the new version instead.")
        }
        other => other.to_string(),
    }
}

/// The download link for an update the user installs themselves: the
/// package latest.json lists for this install, if it's that kind of file.
fn download_link(install: Install, url: &str) -> Option<String> {
    let suffix = install.package_suffix()?;
    url.ends_with(suffix).then(|| url.to_string())
}

#[tauri::command]
pub fn update_info(app: AppHandle) -> UpdateInfo {
    let install = Install::current();
    let image = app_image(&app);
    UpdateInfo {
        version: app.package_info().version.to_string(),
        install,
        can_install: can_install(install, image.as_deref()),
        app_image: image.map(|p| p.to_string_lossy().into_owned()),
        endpoint: endpoint(&app),
        last_check: read_record(&app).last_check.map(|s| s * 1000),
    }
}

/// Asks the endpoint for the latest release, once. With `auto` (the
/// automatic check) it asks only when `due`, and reports each version once.
#[tauri::command]
pub async fn update_check(app: AppHandle, state: State<'_, UpdateState>, auto: bool) -> Result<CheckResult, String> {
    let mut record = read_record(&app);
    let now = now_secs();
    if auto {
        if !due(&record, now) {
            return Ok(CheckResult::Quiet);
        }
        record.last_try = Some(now);
        write_record(&app, &record);
    }
    let updater = app
        .updater_builder()
        .timeout(CHECK_TIMEOUT)
        .build()
        .map_err(|e| words(&e))?;
    let found = updater.check().await;
    record.last_try = Some(now);
    if !matches!(&found, Err(UpdaterError::Reqwest(r)) if r.is_connect() || r.is_timeout()) {
        record.last_check = Some(now);
    }
    let found = match found {
        Ok(f) => f,
        Err(e) => {
            write_record(&app, &record);
            return Err(words(&e));
        }
    };
    let current = app.package_info().version.to_string();
    let Some(update) = found else {
        write_record(&app, &record);
        *lock(&state.found) = None;
        return Ok(CheckResult::Current { version: current });
    };
    let seen = record.notified.as_deref() == Some(update.version.as_str());
    record.notified = Some(update.version.clone());
    write_record(&app, &record);
    let install = Install::current();
    let result = CheckResult::Available {
        version: update.version.clone(),
        current,
        date: update.raw_json.get("pub_date").and_then(|d| d.as_str()).map(str::to_string),
        notes: update.body.clone().unwrap_or_default(),
        download: download_link(install, update.download_url.as_str()),
        can_install: can_install(install, app_image(&app).as_deref()),
    };
    *lock(&state.found) = Some(update);
    if auto && seen {
        return Ok(CheckResult::Quiet);
    }
    Ok(result)
}

/// Downloads the update the last check found, checks its signature, and
/// installs it: on Windows the installer takes over and this process ends;
/// an AppImage is replaced and glasshouse starts again. Progress comes as
/// `update-progress` events. Only for an install that updates itself.
#[tauri::command]
pub async fn update_install(app: AppHandle, state: State<'_, UpdateState>) -> Result<(), String> {
    let install = Install::current();
    if !can_install(install, app_image(&app).as_deref()) {
        return Err("This copy of glasshouse can't install updates itself.".into());
    }
    let Some(update) = lock(&state.found).clone() else {
        return Err("Check for updates first.".into());
    };
    {
        let mut run = lock(&state.run);
        if run.is_some() {
            return Err("An update is already being installed.".into());
        }
        *run = Some(Running::default());
    }
    let task_app = app.clone();
    let task = tauri::async_runtime::spawn(async move {
        let emit = |p: Progress| {
            let _ = task_app.emit("update-progress", p);
        };
        let mut got = 0u64;
        let mut last = Instant::now();
        let bytes = update
            .download(
                |chunk, total| {
                    got += chunk as u64;
                    if last.elapsed() >= Duration::from_millis(100) {
                        last = Instant::now();
                        emit(Progress { got, total, installing: false });
                    }
                },
                || {},
            )
            .await
            .map_err(|e| words(&e))?;
        {
            let state = task_app.state::<UpdateState>();
            let mut run = lock(&state.run);
            match run.as_mut() {
                Some(r) if !r.cancelled => {
                    r.installing = true;
                    r.abort = None;
                }
                _ => return Err("Cancelled.".to_string()),
            }
        }
        emit(Progress { got, total: Some(got), installing: true });
        tauri::async_runtime::spawn_blocking(move || update.install(bytes))
            .await
            .map_err(|e| e.to_string())?
            .map_err(|e| words(&e))
    });
    let abort = task.inner().abort_handle();
    if let Some(r) = lock(&state.run).as_mut() {
        r.abort = Some(Box::new(move || abort.abort()));
    }
    let finished = task.await.unwrap_or_else(|_| Err("Cancelled.".to_string()));
    *lock(&state.run) = None;
    finished?;
    // Only the AppImage gets here: the Windows installers end the process.
    #[cfg(target_os = "linux")]
    close_on_exec();
    app.restart();
}

/// Keeps this process's files out of the one the restart starts. The
/// AppImage runtime leaves a handle on its mount open in the app, without
/// close-on-exec; the new AppImage's runtime would inherit it and keep the
/// old image mounted, and its replaced file on disk, until the new window
/// closes.
#[cfg(target_os = "linux")]
fn close_on_exec() {
    let Ok(dir) = std::fs::read_dir("/proc/self/fd") else { return };
    let fds: Vec<i32> = dir
        .filter_map(|e| e.ok()?.file_name().to_str()?.parse().ok())
        .filter(|&fd| fd > 2)
        .collect();
    for fd in fds {
        // SAFETY: fcntl on a closed or foreign fd fails with EBADF; flags
        // are only added, never removed.
        unsafe {
            let flags = libc::fcntl(fd, libc::F_GETFD);
            if flags >= 0 {
                libc::fcntl(fd, libc::F_SETFD, flags | libc::FD_CLOEXEC);
            }
        }
    }
}

/// Stops a download in progress. Once the installer has started it can't
/// be stopped, and this says so.
#[tauri::command]
pub fn update_cancel(state: State<'_, UpdateState>) -> Result<(), String> {
    let mut run = lock(&state.run);
    let Some(r) = run.as_mut() else { return Ok(()) };
    if r.installing {
        return Err("The update is being installed and can't be stopped now.".into());
    }
    r.cancelled = true;
    if let Some(abort) = r.abort.take() {
        abort();
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rec(check: Option<u64>, attempt: Option<u64>) -> Record {
        Record { last_check: check, last_try: attempt, notified: None }
    }

    #[test]
    fn the_first_check_is_due() {
        assert!(due(&Record::default(), 1_000_000));
    }

    #[test]
    fn a_check_is_due_a_day_after_the_last_answer() {
        let t = 1_000_000;
        assert!(!due(&rec(Some(t), Some(t)), t + DAY - 1));
        assert!(due(&rec(Some(t), Some(t)), t + DAY));
    }

    #[test]
    fn a_failed_attempt_waits_an_hour() {
        let t = 1_000_000;
        let r = rec(Some(t - 2 * DAY), Some(t));
        assert!(!due(&r, t + RETRY - 1));
        assert!(due(&r, t + RETRY));
    }

    #[test]
    fn a_clock_that_went_back_doesnt_stop_the_checks() {
        let t = 1_000_000;
        assert!(due(&rec(Some(t + 10 * DAY), Some(t + 10 * DAY)), t));
    }

    #[test]
    fn the_record_reads_with_missing_or_unknown_fields() {
        let r: Record = serde_json::from_str(r#"{"lastCheck":5,"other":1}"#).unwrap();
        assert_eq!(r, rec(Some(5), None));
        let r: Record = serde_json::from_str("{}").unwrap();
        assert_eq!(r, Record::default());
    }

    #[test]
    fn each_package_marker_maps_to_its_install() {
        assert_eq!(Install::from_bundle(Some(BundleType::Nsis)), Install::Nsis);
        assert_eq!(Install::from_bundle(Some(BundleType::Msi)), Install::Msi);
        assert_eq!(Install::from_bundle(Some(BundleType::AppImage)), Install::AppImage);
        assert_eq!(Install::from_bundle(Some(BundleType::Deb)), Install::Deb);
        assert_eq!(Install::from_bundle(Some(BundleType::Rpm)), Install::Rpm);
        assert_eq!(Install::from_bundle(Some(BundleType::Dmg)), Install::Source);
        assert_eq!(Install::from_bundle(None), Install::Source);
    }

    #[test]
    fn only_the_installers_and_a_writable_appimage_update_themselves() {
        assert!(can_install(Install::Nsis, None));
        assert!(can_install(Install::Msi, None));
        assert!(!can_install(Install::Deb, None));
        assert!(!can_install(Install::Rpm, None));
        assert!(!can_install(Install::Source, None));
        // An AppImage marker without $APPIMAGE: the updater wouldn't know
        // which file to replace.
        assert!(!can_install(Install::AppImage, None));
    }

    #[cfg(unix)]
    #[test]
    fn an_appimage_updates_itself_only_where_its_folder_is_writable() {
        use std::os::unix::fs::PermissionsExt;
        let dir = crate::commands::testing::Scratch::new("update-appimage");
        let image = dir.join("glasshouse.AppImage");
        std::fs::write(&image, b"").unwrap();
        assert!(can_install(Install::AppImage, Some(&image)));
        std::fs::set_permissions(dir.path(), std::fs::Permissions::from_mode(0o555)).unwrap();
        // Root can write anywhere, so the check only means something as a user.
        if unsafe { libc::geteuid() } != 0 {
            assert!(!can_install(Install::AppImage, Some(&image)));
        }
        std::fs::set_permissions(dir.path(), std::fs::Permissions::from_mode(0o755)).unwrap();
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn the_restart_inherits_no_files() {
        use std::os::fd::AsRawFd;
        let file = std::fs::File::open("/proc/self/stat").unwrap();
        // SAFETY: dup of an open fd; the copy is closed below. A dup has no
        // close-on-exec, like the AppImage runtime's handle on its mount.
        let fd = unsafe { libc::dup(file.as_raw_fd()) };
        assert!(fd > 2);
        let cloexec = |fd| unsafe { libc::fcntl(fd, libc::F_GETFD) } & libc::FD_CLOEXEC != 0;
        assert!(!cloexec(fd));
        close_on_exec();
        assert!(cloexec(fd));
        unsafe { libc::close(fd) };
    }

    #[test]
    fn a_download_link_is_the_package_for_this_install() {
        let deb = "https://example.test/glasshouse_0.3.0_amd64.deb";
        let image = "https://example.test/glasshouse_0.3.0_amd64.AppImage";
        assert_eq!(download_link(Install::Deb, deb).as_deref(), Some(deb));
        // A .deb install handed the AppImage (no deb entry): no direct link.
        assert_eq!(download_link(Install::Deb, image), None);
        assert_eq!(download_link(Install::AppImage, image).as_deref(), Some(image));
        assert_eq!(download_link(Install::Source, image), None);
        assert_eq!(download_link(Install::Nsis, "https://example.test/x-setup.exe"), None);
    }

    #[test]
    fn the_check_result_has_the_shape_the_frontend_reads() {
        let v = serde_json::to_value(CheckResult::Available {
            version: "0.3.0".into(),
            current: "0.2.0".into(),
            date: None,
            notes: "n".into(),
            download: None,
            can_install: true,
        })
        .unwrap();
        assert_eq!(v["status"], "available");
        assert_eq!(v["canInstall"], true);
        assert_eq!(serde_json::to_value(CheckResult::Quiet).unwrap()["status"], "quiet");
        assert_eq!(serde_json::to_value(Install::AppImage).unwrap(), "appimage");
    }

    #[test]
    fn signature_and_lookup_errors_read_as_words() {
        assert!(words(&UpdaterError::ReleaseNotFound).contains("latest.json"));
        assert!(words(&UpdaterError::TargetsNotFound(vec!["linux-x86_64".into()])).contains("no package"));
        assert!(words(&UpdaterError::MissingSignedVersion).contains("wasn't installed"));
        let mismatch = UpdaterError::SignedVersionMismatch { signed: "0.2.0".into(), announced: "0.3.0".into() };
        assert!(words(&mismatch).contains("0.2.0"));
    }
}
