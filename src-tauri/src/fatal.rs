//! The box a user sees when glasshouse can't go on: it couldn't start, it
//! crashed (release builds abort on panic), or on Windows the WebView2
//! runtime is missing. Without it the window just closes, and on Windows a
//! release build has no console to print to.
//!
//! The box comes from a new process, `glasshouse --fatal-dialog <why>`, so
//! it never runs inside the thread that panicked or inside the GTK or Win32
//! loop that failed. On Linux it's a GTK 3 message dialog (GTK 3 is there
//! wherever glasshouse runs, for WebKitGTK); on Windows, MessageBoxW.

use std::path::PathBuf;

/// Why glasshouse stopped.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Fatal {
    /// Startup failed (the app couldn't be built, or panicked before its
    /// window was up).
    Startup,
    /// A panic after the window was up.
    Crash,
    /// Windows: no WebView2 runtime to draw the window with.
    NoWebView,
}

/// Microsoft's WebView2 runtime page, with the Evergreen installer.
const WEBVIEW2_URL: &str = "https://developer.microsoft.com/microsoft-edge/webview2/";

impl Fatal {
    pub fn arg(self) -> &'static str {
        match self {
            Fatal::Startup => "startup",
            Fatal::Crash => "crash",
            Fatal::NoWebView => "webview",
        }
    }

    pub fn from_arg(s: &str) -> Option<Self> {
        [Fatal::Startup, Fatal::Crash, Fatal::NoWebView].into_iter().find(|f| f.arg() == s)
    }

    fn title(self) -> &'static str {
        match self {
            Fatal::Startup => "glasshouse couldn't start.",
            Fatal::Crash => "glasshouse ran into a problem and had to close.",
            Fatal::NoWebView => "glasshouse needs the Microsoft Edge WebView2 Runtime, which isn't installed.",
        }
    }

    fn body(self) -> String {
        match self {
            Fatal::NoWebView => "Install it from Microsoft's WebView2 page, then start glasshouse again.".into(),
            _ => {
                let log = crate::diagnostics::dir().map(|d| d.display().to_string());
                format!(
                    "What happened is in glasshouse.log{}. If it happens again, please report it at \
                     github.com/Johnson-Anthony/glasshouse/issues and attach that file (it can contain file names).",
                    log.map(|l| format!(", in {l}")).unwrap_or_default()
                )
            }
        }
    }

    /// The box's button that does something, besides Close.
    #[cfg_attr(windows, allow(dead_code))]
    fn action(self) -> &'static str {
        match self {
            Fatal::NoWebView => "Get WebView2",
            _ => "Open Log Folder",
        }
    }

    /// Windows' MessageBoxW has only Yes and No, so the action is a question.
    #[cfg_attr(not(windows), allow(dead_code))]
    fn question(self) -> &'static str {
        match self {
            Fatal::NoWebView => "Open Microsoft's WebView2 page now?",
            _ => "Open the log folder now?",
        }
    }

    /// What the action button does.
    fn act(self) {
        match self {
            Fatal::NoWebView => open_link(WEBVIEW2_URL),
            _ => {
                if let Some(dir) = crate::diagnostics::dir() {
                    let _ = std::fs::create_dir_all(&dir);
                    open_folder(dir);
                }
            }
        }
    }
}

/// Show the box for `why` from a new process, and return at once. Best
/// effort: when even that can't start, the log and stderr have it.
pub(crate) fn show(why: Fatal) {
    let Ok(exe) = crate::startup::self_exe() else { return };
    let _ = std::process::Command::new(exe)
        .arg("--fatal-dialog")
        .arg(why.arg())
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .spawn();
}

/// `glasshouse --fatal-dialog <why>`: show the box and exit.
pub(crate) fn run(why: Option<Fatal>) -> i32 {
    let Some(why) = why else {
        eprintln!("glasshouse --fatal-dialog: say why: startup, crash or webview");
        return 2;
    };
    if dialog(why) {
        why.act();
    }
    0
}

fn open_folder(dir: PathBuf) {
    #[cfg(windows)]
    let _ = tauri_plugin_opener::open_path(dir, None::<&str>);
    #[cfg(not(windows))]
    let _ = std::process::Command::new("xdg-open").arg(dir).spawn();
}

fn open_link(url: &str) {
    #[cfg(windows)]
    let _ = tauri_plugin_opener::open_url(url, None::<&str>);
    #[cfg(not(windows))]
    let _ = std::process::Command::new("xdg-open").arg(url).spawn();
}

/// Shows the box; true when the user picked the action.
#[cfg(target_os = "linux")]
fn dialog(why: Fatal) -> bool {
    use gtk::prelude::*;
    if gtk::init().is_err() {
        eprintln!("glasshouse: {} {}", why.title(), why.body());
        return false;
    }
    let d = gtk::MessageDialog::new(
        None::<&gtk::Window>,
        gtk::DialogFlags::MODAL,
        gtk::MessageType::Error,
        gtk::ButtonsType::None,
        why.title(),
    );
    d.set_title("glasshouse");
    d.set_secondary_text(Some(&why.body()));
    d.add_button(why.action(), gtk::ResponseType::Accept);
    d.add_button("Close", gtk::ResponseType::Close);
    d.set_default_response(gtk::ResponseType::Close);
    d.run() == gtk::ResponseType::Accept
}

#[cfg(windows)]
fn dialog(why: Fatal) -> bool {
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{MessageBoxW, IDYES, MB_ICONERROR, MB_SETFOREGROUND, MB_YESNO};
    let wide = |s: &str| s.encode_utf16().chain(std::iter::once(0)).collect::<Vec<u16>>();
    let text = wide(&format!("{}\n\n{}\n\n{}", why.title(), why.body(), why.question()));
    let caption = wide("glasshouse");
    // SAFETY: both strings are NUL-terminated and outlive the call.
    let r = unsafe {
        MessageBoxW(HWND::default(), PCWSTR(text.as_ptr()), PCWSTR(caption.as_ptr()), MB_YESNO | MB_ICONERROR | MB_SETFOREGROUND)
    };
    r == IDYES
}

#[cfg(not(any(windows, target_os = "linux")))]
fn dialog(why: Fatal) -> bool {
    eprintln!("glasshouse: {} {}", why.title(), why.body());
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn each_reason_round_trips_through_its_argument() {
        for f in [Fatal::Startup, Fatal::Crash, Fatal::NoWebView] {
            assert_eq!(Fatal::from_arg(f.arg()), Some(f));
        }
        assert_eq!(Fatal::from_arg("other"), None);
    }

    #[test]
    fn the_crash_box_says_where_the_log_is() {
        let body = Fatal::Crash.body();
        let dir = crate::diagnostics::dir().unwrap();
        assert!(body.contains(&dir.display().to_string()), "{body}");
    }
}
