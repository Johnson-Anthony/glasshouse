use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::thread;

use portable_pty::{ChildKiller, CommandBuilder, MasterPty, PtySize, native_pty_system};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};

use crate::commands::{check_profile, detect_shells, ShellProfile};

/// One live PTY session — keeps the master handle (for resize) plus a writer
/// (to forward keystrokes) and a kill handle. The child itself is owned by
/// the background wait thread so `Child::wait()` and `kill()` never contend
/// on the same lock.
pub struct PtySession {
    master: Box<dyn MasterPty + Send>,
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    killer: Mutex<Box<dyn ChildKiller + Send + Sync>>,
}

/// Live sessions by id. Each session's wait thread holds a clone, so it can
/// remove its own entry when the child exits.
type Sessions = Arc<Mutex<HashMap<String, PtySession>>>;

#[derive(Default)]
pub struct PtyRegistry {
    sessions: Sessions,
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

/// Lock `m` even if a thread panicked while holding it. Nothing these locks
/// guard (the session map, the id counter, a writer, a kill handle) is left
/// half-updated by a panic, so the data is still usable, and unwrapping would
/// turn one panic into every later pty call panicking too. Release builds
/// abort on panic, so this only matters in dev and test builds.
fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(PoisonError::into_inner)
}

fn next_session_id(reg: &PtyRegistry) -> String {
    let mut n = lock(&reg.next_id);
    *n += 1;
    format!("pty-{}", *n)
}

/// Spawn a PTY running the chosen shell/wsl/ssh profile in `cwd`. Returns a
/// session id the frontend uses in subsequent pty_write / pty_resize calls.
///
/// On Windows, `portable-pty`'s ConPTY backend handles CREATE_NO_WINDOW
/// semantics internally — the host process gets attached to the PTY pipe
/// rather than a real console, so no console window flashes.
#[tauri::command(async)]
pub fn pty_spawn(
    app: AppHandle,
    registry: State<'_, PtyRegistry>,
    profile: ShellProfile,
    cwd: String,
    cols: Option<u16>,
    rows: Option<u16>,
) -> Result<String, String> {
    // Only the profiles list_shell_profiles and saved remotes produce: no
    // arbitrary executable, no ssh host that ssh would read as an option.
    check_profile(&profile, &detect_shells())?;
    let size = PtySize {
        rows: rows.unwrap_or(24),
        cols: cols.unwrap_or(80),
        pixel_width: 0,
        pixel_height: 0,
    };

    let mut cmd = match profile.kind.as_str() {
        "wsl" => {
            let mut c = CommandBuilder::new("wsl.exe");
            for a in &profile.args {
                c.arg(a);
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
    if !cwd.is_empty() {
        cmd.cwd(&cwd);
    }

    let session_id = next_session_id(&registry);
    let data_id = session_id.clone();
    let data_app = app.clone();
    spawn_session(
        &registry.sessions,
        session_id.clone(),
        cmd,
        size,
        move |data| {
            let _ = data_app.emit(
                "pty-data",
                PtyDataEvent {
                    session_id: data_id.clone(),
                    data,
                },
            );
        },
        move |exit| {
            let _ = app.emit("pty-exit", exit);
        },
    )?;
    Ok(session_id)
}

/// Open a PTY, start `cmd` in it and register the session as `session_id`.
/// `on_data` gets the child's output as text. `on_exit` runs once the child
/// has exited and its session is gone from `sessions`, so a pty-exit is never
/// reported for a session that's still registered.
fn spawn_session(
    sessions: &Sessions,
    session_id: String,
    cmd: CommandBuilder,
    size: PtySize,
    on_data: impl Fn(String) + Send + 'static,
    on_exit: impl FnOnce(PtyExitEvent) + Send + 'static,
) -> Result<(), String> {
    let pair = native_pty_system()
        .openpty(size)
        .map_err(|e| format!("openpty: {}", e))?;

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

    // Register before the wait thread starts: a child that exits at once
    // could otherwise be removed before it was inserted, leaking the entry.
    lock(sessions).insert(
        session_id.clone(),
        PtySession {
            master: pair.master,
            writer: Arc::new(Mutex::new(writer)),
            killer: Mutex::new(killer),
        },
    );

    thread::spawn(move || {
        let mut reader = reader;
        let mut buf = [0u8; 4096];
        // Carry-over for a multibyte UTF-8 sequence split across reads —
        // lossy-converting each 4096-byte chunk in isolation stamped
        // replacement chars into otherwise-valid output at the boundary.
        let mut pending: Vec<u8> = Vec::new();
        let emit = |data: String| {
            if data.is_empty() {
                return;
            }
            on_data(data);
        };
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    pending.extend_from_slice(&buf[..n]);
                    let chunk = match std::str::from_utf8(&pending) {
                        Ok(s) => {
                            let s = s.to_owned();
                            pending.clear();
                            s
                        }
                        Err(e) if e.error_len().is_none() => {
                            // Ends mid-codepoint: emit the valid prefix, keep
                            // the incomplete tail (≤3 bytes) for the next read.
                            let valid = e.valid_up_to();
                            let s = String::from_utf8_lossy(&pending[..valid]).into_owned();
                            pending.drain(..valid);
                            s
                        }
                        Err(_) => {
                            // Genuinely invalid bytes: lossy the lot.
                            let s = String::from_utf8_lossy(&pending).into_owned();
                            pending.clear();
                            s
                        }
                    };
                    emit(chunk);
                }
                Err(_) => break,
            }
        }
        // Stream ended with an incomplete sequence still buffered.
        if !pending.is_empty() {
            emit(String::from_utf8_lossy(&pending).into_owned());
        }
    });

    let sessions = Arc::clone(sessions);
    thread::spawn(move || {
        let exit_code = child.wait().ok().map(|s| s.exit_code() as i32);
        // Drop the session after releasing the lock: closing a ConPTY can
        // block, and the reader keeps its own handle to drain what's left.
        let session = lock(&sessions).remove(&session_id);
        drop(session);
        on_exit(PtyExitEvent {
            session_id,
            exit_code,
        });
    });
    Ok(())
}

#[tauri::command]
pub fn pty_write(
    registry: State<'_, PtyRegistry>,
    session_id: String,
    data: String,
) -> Result<(), String> {
    // Clone the writer handle out and release the registry lock before the
    // (potentially blocking) pipe write — holding it meant one session whose
    // child stopped draining stdin stalled every pty op, including the
    // pty_kill that would have freed it.
    let writer = {
        let sessions = lock(&registry.sessions);
        let session = sessions
            .get(&session_id)
            .ok_or_else(|| format!("no pty session: {}", session_id))?;
        session.writer.clone()
    };
    let mut w = lock(&writer);
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
    let sessions = lock(&registry.sessions);
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
    // Kill after releasing the registry lock, as the wait thread does. A
    // poisoned kill handle still kills (the old `if let Ok` skipped it).
    let session = lock(&registry.sessions).remove(&session_id);
    if let Some(session) = session {
        let _ = lock(&session.killer).kill();
    }
    Ok(())
}

// Unix only: these spawn `sh` in a real PTY. The ConPTY side isn't checked
// locally, so it isn't asserted here either.
#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::sync::mpsc::{self, RecvTimeoutError};
    use std::time::Duration;

    const SIZE: PtySize = PtySize {
        rows: 24,
        cols: 80,
        pixel_width: 0,
        pixel_height: 0,
    };
    const TIMEOUT: Duration = Duration::from_secs(10);

    fn sh(script: &str) -> CommandBuilder {
        let mut c = CommandBuilder::new("sh");
        c.args(["-c", script]);
        c
    }

    #[test]
    fn exited_session_is_removed_before_exit_is_reported() {
        let sessions = Sessions::default();
        let observed = Arc::clone(&sessions);
        let (exit_tx, exit_rx) = mpsc::channel();
        let (data_tx, data_rx) = mpsc::channel();
        spawn_session(
            &sessions,
            "pty-1".into(),
            sh("printf hello; exit 3"),
            SIZE,
            move |data| data_tx.send(data).unwrap(),
            move |exit| {
                let still_registered = lock(&observed).contains_key(&exit.session_id);
                exit_tx.send((exit, still_registered)).unwrap();
            },
        )
        .unwrap();

        let (exit, still_registered) = exit_rx.recv_timeout(TIMEOUT).unwrap();
        assert_eq!(exit.session_id, "pty-1");
        assert_eq!(exit.exit_code, Some(3));
        assert!(!still_registered);
        assert!(lock(&sessions).is_empty());

        // Dropping the session on exit doesn't cut off buffered output: the
        // reader drains it and then ends (dropping `data_tx`).
        let mut out = String::new();
        loop {
            match data_rx.recv_timeout(TIMEOUT) {
                Ok(s) => out.push_str(&s),
                Err(RecvTimeoutError::Disconnected) => break,
                Err(RecvTimeoutError::Timeout) => panic!("reader never finished; got {:?}", out),
            }
        }
        assert!(out.contains("hello"), "output was {:?}", out);
    }

    #[test]
    fn poisoned_registry_lock_still_works() {
        let sessions = Sessions::default();
        let poisoner = Arc::clone(&sessions);
        let _ = thread::spawn(move || {
            let _guard = poisoner.lock().unwrap();
            panic!("poison the registry");
        })
        .join();
        assert!(sessions.is_poisoned());

        let (tx, rx) = mpsc::channel();
        spawn_session(
            &sessions,
            "pty-2".into(),
            sh("exit 0"),
            SIZE,
            |_| {},
            move |exit| tx.send(exit).unwrap(),
        )
        .unwrap();
        assert_eq!(rx.recv_timeout(TIMEOUT).unwrap().exit_code, Some(0));
        assert!(lock(&sessions).is_empty());
    }
}
