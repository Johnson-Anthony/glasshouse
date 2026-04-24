use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use std::thread;

use portable_pty::{ChildKiller, CommandBuilder, MasterPty, PtySize, native_pty_system};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};

use crate::commands::ShellProfile;

/// One live PTY session — keeps the master handle (for resize) plus a writer
/// (to forward keystrokes) and a kill handle. The child itself is owned by
/// the background wait thread so `Child::wait()` and `kill()` never contend
/// on the same lock.
pub struct PtySession {
    master: Box<dyn MasterPty + Send>,
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    killer: Mutex<Box<dyn ChildKiller + Send + Sync>>,
}

#[derive(Default)]
pub struct PtyRegistry {
    sessions: Mutex<HashMap<String, PtySession>>,
    next_id: Mutex<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PtyDataEvent {
    pub session_id: String,
    pub data: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PtyExitEvent {
    pub session_id: String,
    pub exit_code: Option<i32>,
}

fn next_session_id(reg: &PtyRegistry) -> String {
    let mut n = reg.next_id.lock().unwrap();
    *n += 1;
    format!("pty-{}", *n)
}

/// Spawn a PTY running the chosen shell/wsl/ssh profile in `cwd`. Returns a
/// session id the frontend uses in subsequent pty_write / pty_resize calls.
///
/// On Windows, `portable-pty`'s ConPTY backend handles CREATE_NO_WINDOW
/// semantics internally — the host process gets attached to the PTY pipe
/// rather than a real console, so no console window flashes.
#[tauri::command]
pub fn pty_spawn(
    app: AppHandle,
    registry: State<'_, PtyRegistry>,
    profile: ShellProfile,
    cwd: String,
    cols: Option<u16>,
    rows: Option<u16>,
) -> Result<String, String> {
    let pty_system = native_pty_system();
    let size = PtySize {
        rows: rows.unwrap_or(24),
        cols: cols.unwrap_or(80),
        pixel_width: 0,
        pixel_height: 0,
    };
    let pair = pty_system
        .openpty(size)
        .map_err(|e| format!("openpty: {}", e))?;

    // Translate a Windows path to the posix form a WSL distro expects.
    // `\\wsl$\Ubuntu\home\x` -> `/home/x`; `C:\foo` -> `/mnt/c/foo`; anything
    // already starting with `/` is passed through. Returns None for empty.
    fn win_to_wsl_posix(path: &str) -> Option<String> {
        if path.is_empty() {
            return None;
        }
        if path.starts_with('/') {
            return Some(path.to_string());
        }
        let lowered = path.to_ascii_lowercase();
        // Match `\\wsl$\<distro>\rest` or `\\wsl.localhost\<distro>\rest`.
        for prefix in [r"\\wsl$\", r"\\wsl.localhost\"] {
            if let Some(tail) = lowered.strip_prefix(prefix) {
                // Strip the distro segment. We index the original-case string
                // at the same byte offset — `lowered` is ASCII for these
                // prefixes so offsets match.
                let original_tail = &path[prefix.len()..];
                let rest = match tail.find('\\') {
                    Some(i) => &original_tail[i..],
                    None => return Some("/".to_string()),
                };
                let out = rest.replace('\\', "/");
                return Some(if out.is_empty() { "/".to_string() } else { out });
            }
        }
        // Drive-letter form.
        let bytes = path.as_bytes();
        if bytes.len() >= 2 && bytes[1] == b':' {
            let letter = (bytes[0] as char).to_ascii_lowercase();
            let rest = if bytes.len() > 2 {
                path[2..].trim_start_matches(['\\', '/']).replace('\\', "/")
            } else {
                String::new()
            };
            let posix = if rest.is_empty() {
                format!("/mnt/{}", letter)
            } else {
                format!("/mnt/{}/{}", letter, rest)
            };
            return Some(posix);
        }
        None
    }

    let mut cmd = match profile.kind.as_str() {
        "wsl" => {
            let mut c = CommandBuilder::new("wsl.exe");
            for a in &profile.args {
                c.arg(a);
            }
            // For WSL, pass the target directory via `--cd <posix>`. That
            // way the shell chdir's *inside* the distro regardless of what
            // form the Windows-side cwd is in. Skip setting CommandBuilder::cwd
            // for WSL — a `\\wsl.localhost\...` UNC would fail to resolve on
            // the Windows side, and we don't need it.
            if let Some(posix) = win_to_wsl_posix(&cwd) {
                c.arg("--cd");
                c.arg(posix);
            }
            c
        }
        "ssh" => {
            let mut c = CommandBuilder::new("ssh");
            for a in &profile.args {
                c.arg(a);
            }
            c
        }
        _ => {
            let mut c = CommandBuilder::new(&profile.exec);
            for a in &profile.args {
                c.arg(a);
            }
            c
        }
    };
    // Set the process cwd for everything *except* WSL — WSL handled its
    // own chdir above via --cd.
    if !cwd.is_empty() && profile.kind != "wsl" {
        cmd.cwd(&cwd);
    }

    let mut child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("spawn: {}", e))?;
    drop(pair.slave);

    let reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("clone reader: {}", e))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("take writer: {}", e))?;
    let killer = child.clone_killer();

    let session_id = next_session_id(&registry);
    let writer = Arc::new(Mutex::new(writer));

    let reader_id = session_id.clone();
    let reader_app = app.clone();
    thread::spawn(move || {
        let mut reader = reader;
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let chunk = String::from_utf8_lossy(&buf[..n]).into_owned();
                    let _ = reader_app.emit(
                        "pty-data",
                        PtyDataEvent {
                            session_id: reader_id.clone(),
                            data: chunk,
                        },
                    );
                }
                Err(_) => break,
            }
        }
    });

    let wait_id = session_id.clone();
    let wait_app = app.clone();
    thread::spawn(move || {
        let exit_code = child.wait().ok().map(|s| s.exit_code() as i32);
        let _ = wait_app.emit(
            "pty-exit",
            PtyExitEvent {
                session_id: wait_id,
                exit_code,
            },
        );
    });

    registry.sessions.lock().unwrap().insert(
        session_id.clone(),
        PtySession {
            master: pair.master,
            writer,
            killer: Mutex::new(killer),
        },
    );
    Ok(session_id)
}

#[tauri::command]
pub fn pty_write(
    registry: State<'_, PtyRegistry>,
    session_id: String,
    data: String,
) -> Result<(), String> {
    let sessions = registry.sessions.lock().unwrap();
    let session = sessions
        .get(&session_id)
        .ok_or_else(|| format!("no pty session: {}", session_id))?;
    let mut w = session.writer.lock().unwrap();
    w.write_all(data.as_bytes())
        .map_err(|e| format!("pty_write: {}", e))?;
    w.flush().map_err(|e| format!("pty_write flush: {}", e))
}

#[tauri::command]
pub fn pty_resize(
    registry: State<'_, PtyRegistry>,
    session_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let sessions = registry.sessions.lock().unwrap();
    let session = sessions
        .get(&session_id)
        .ok_or_else(|| format!("no pty session: {}", session_id))?;
    session
        .master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("pty_resize: {}", e))
}

#[tauri::command]
pub fn pty_kill(registry: State<'_, PtyRegistry>, session_id: String) -> Result<(), String> {
    let mut sessions = registry.sessions.lock().unwrap();
    if let Some(session) = sessions.remove(&session_id) {
        if let Ok(mut k) = session.killer.lock() {
            let _ = k.kill();
        }
    }
    Ok(())
}
