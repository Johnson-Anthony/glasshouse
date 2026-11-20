//! Open With: the default app for a file, the apps that can open it, and a
//! program the user picked. Linux reads the XDG MIME and desktop-entry
//! files (`xdg_apps`); Windows asks the shell (`win_open_with`). Nothing
//! here builds a shell command line: see
//! docs/decisions/2026-11-20-open-with-linux-apps.md and
//! docs/decisions/2026-11-20-open-with-windows-handlers.md.

#[cfg(not(windows))]
use super::xdg_apps::{self, AppIndex, MimeDb, XdgDirs};

/// One app offered for a file.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct AppChoice {
    /// The desktop file ID (Linux) or the shell's handler name (Windows).
    pub id: String,
    pub name: String,
    pub is_default: bool,
}

/// What `open_with_default` did.
#[derive(Debug, serde::Serialize)]
pub struct OpenOutcome {
    /// False when no app is set to open the file's type.
    pub opened: bool,
    /// The MIME type (Linux) or extension (Windows) the app was looked up for.
    pub file_type: String,
}

/// Open `path` with its default app; `as_text` opens it with the app for
/// plain text instead, whatever its type.
pub(super) fn open_default(path: String, as_text: bool) -> Result<OpenOutcome, String> {
    #[cfg(windows)]
    {
        let ext = std::path::Path::new(&path)
            .extension()
            .map(|e| format!(".{}", e.to_string_lossy()))
            .unwrap_or_default();
        if as_text {
            super::win_open_with::open_as_class(path, ".txt")?;
            return Ok(OpenOutcome { opened: true, file_type: ".txt".into() });
        }
        // ShellExecuteExW, not `cmd /C start`: cmd parses its command line, so
        // `&`, `|` or `^` in a filename ran the rest as a command. For a type
        // nothing opens, Windows shows its own "How do you want to open this
        // file?" chooser, so ERROR_NO_ASSOCIATION is rare.
        match tauri_plugin_opener::open_path(&path, None::<&str>) {
            Ok(()) => Ok(OpenOutcome { opened: true, file_type: ext }),
            Err(tauri_plugin_opener::Error::Io(e)) if e.raw_os_error() == Some(ERROR_NO_ASSOCIATION) => {
                Ok(OpenOutcome { opened: false, file_type: ext })
            }
            Err(e) => Err(e.to_string()),
        }
    }
    #[cfg(not(windows))]
    {
        let dirs = XdgDirs::from_env().ok_or("HOME isn't set")?;
        let db = MimeDb::load(&dirs);
        if db.is_empty() && !as_text {
            // No shared-mime-info: leave it to xdg-open, as before.
            return super::launch::xdg_open(&path).map(|()| OpenOutcome { opened: true, file_type: String::new() });
        }
        let mime = if as_text {
            "text/plain".to_string()
        } else {
            xdg_apps::mime_for_path(&db, std::path::Path::new(&path))
        };
        let index = AppIndex::load(&dirs, &db);
        match index.default_for(&db.type_chain(&mime)) {
            Some(entry) => {
                xdg_apps::launch_entry(entry, &[path])?;
                Ok(OpenOutcome { opened: true, file_type: mime })
            }
            None => Ok(OpenOutcome { opened: false, file_type: mime }),
        }
    }
}

/// The Win32 error a ShellExecuteExW with no app for the type returns.
#[cfg(windows)]
const ERROR_NO_ASSOCIATION: i32 = 1155;

/// The apps that can open `path`, its default first. Linux: the desktop
/// entries for its MIME type and the types it's a kind of. Windows: the
/// handlers Explorer's Open with recommends for its extension.
#[tauri::command(async)]
pub fn open_with_apps(path: String) -> Result<Vec<AppChoice>, String> {
    #[cfg(windows)]
    {
        super::win_open_with::apps_for(&path)
    }
    #[cfg(not(windows))]
    {
        let dirs = XdgDirs::from_env().ok_or("HOME isn't set")?;
        let db = MimeDb::load(&dirs);
        let mime = xdg_apps::mime_for_path(&db, std::path::Path::new(&path));
        Ok(AppIndex::load(&dirs, &db).apps_for(&db.type_chain(&mime)))
    }
}

/// Open `paths` with the app `id` from `open_with_apps`.
#[tauri::command(async)]
pub fn open_with_app(id: String, paths: Vec<String>) -> Result<(), String> {
    check_paths(&paths)?;
    #[cfg(windows)]
    {
        super::win_open_with::launch(id, paths)
    }
    #[cfg(not(windows))]
    {
        let dirs = XdgDirs::from_env().ok_or("HOME isn't set")?;
        let db = MimeDb::load(&dirs);
        let index = AppIndex::load(&dirs, &db);
        let entry = index.get(&id).ok_or_else(|| format!("{id} isn't installed any more"))?;
        xdg_apps::launch_entry(entry, &paths)
    }
}

/// Open `paths` with `program`, a file the user picked: started directly
/// with the paths as its arguments. On Linux a picked `.desktop` file starts
/// as that entry. On Windows std passes a `.bat`/`.cmd` through cmd.exe with
/// its arguments escaped for cmd (or refuses them).
#[tauri::command(async)]
pub fn open_with_program(program: String, paths: Vec<String>) -> Result<(), String> {
    use std::process::{Command, Stdio};
    check_paths(&paths)?;
    let prog = std::path::Path::new(&program);
    if !prog.is_absolute() || !prog.is_file() {
        return Err(format!("not a program file: {program}"));
    }
    #[cfg(not(windows))]
    if program.ends_with(".desktop") {
        let text = std::fs::read_to_string(prog).map_err(|e| format!("{program}: {e}"))?;
        let id = prog.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        let entry = xdg_apps::parse_entry(&id, prog, &text, &xdg_apps::current_locale_keys());
        if !entry.installed() {
            return Err(format!("{program} isn't an application entry that can be started"));
        }
        return xdg_apps::launch_entry(&entry, &paths);
    }
    let mut cmd = Command::new(prog);
    cmd.args(&paths).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
    if let Some(dir) = paths.first().and_then(|p| std::path::Path::new(p).parent()) {
        cmd.current_dir(dir);
    }
    #[cfg(windows)]
    let child = cmd.spawn().map_err(|e| format!("{program}: {e}"))?;
    #[cfg(not(windows))]
    let child = crate::proc_tree::spawn_detached(&mut cmd).map_err(|e| format!("{program}: {e}"))?.child;
    super::launch::reap(child);
    Ok(())
}

/// At least one path, each absolute, so a name starting with `-` is never
/// the start of an argument.
fn check_paths(paths: &[String]) -> Result<(), String> {
    if paths.is_empty() {
        return Err("no file to open".into());
    }
    match paths.iter().find(|p| !std::path::Path::new(p).is_absolute()) {
        Some(p) => Err(format!("not an absolute path: {p}")),
        None => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::testing::{s, Scratch};

    #[test]
    fn a_program_and_its_files_must_be_absolute() {
        let t = Scratch::new("open-with-program-checks");
        let file = s(&t.join("a.txt"));
        std::fs::write(&file, "x").unwrap();
        for (program, paths, want) in [
            ("sh", vec![file.clone()], "not a program file"),
            (file.as_str(), vec![], "no file to open"),
            (file.as_str(), vec!["-rf".to_string()], "not an absolute path"),
            (file.as_str(), vec!["a.txt".to_string()], "not an absolute path"),
        ] {
            let err = open_with_program(program.to_string(), paths).unwrap_err();
            assert!(err.contains(want), "{program}: {err}");
        }
        let err = open_with_program(s(t.path()), vec![file.clone()]).unwrap_err();
        assert!(err.contains("not a program file"), "a folder: {err}");
        let err = open_with_app("x.desktop".into(), vec!["rel".into()]).unwrap_err();
        assert!(err.contains("not an absolute path"), "{err}");
    }

    #[cfg(unix)]
    #[test]
    fn a_picked_program_gets_the_files_as_its_arguments() {
        use std::os::unix::fs::PermissionsExt;
        let t = Scratch::new("open-with-program-run");
        let out = t.join("argv.out");
        let prog = t.join("record");
        std::fs::write(
            &prog,
            format!("#!/bin/sh\nprintf '%s\\0' \"$@\" > '{0}.tmp'\nmv '{0}.tmp' '{0}'\n", out.display()),
        )
        .unwrap();
        std::fs::set_permissions(&prog, std::fs::Permissions::from_mode(0o755)).unwrap();
        let file = s(&t.join("a b;$(id).txt"));
        open_with_program(s(&prog), vec![file.clone()]).unwrap();
        let until = std::time::Instant::now() + std::time::Duration::from_secs(10);
        while !out.exists() {
            assert!(std::time::Instant::now() < until, "the program never ran");
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
        assert_eq!(std::fs::read(&out).unwrap(), format!("{file}\0").into_bytes());

        // A picked .desktop file starts as that entry.
        std::fs::remove_file(&out).unwrap();
        let entry = t.join("rec.desktop");
        std::fs::write(&entry, format!("[Desktop Entry]\nType=Application\nName=Rec\nExec=\"{}\" --x %f\n", prog.display()))
            .unwrap();
        open_with_program(s(&entry), vec![file.clone()]).unwrap();
        let until = std::time::Instant::now() + std::time::Duration::from_secs(10);
        while !out.exists() {
            assert!(std::time::Instant::now() < until, "the entry never ran");
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
        assert_eq!(std::fs::read(&out).unwrap(), format!("--x\0{file}\0").into_bytes());
    }
}
