use serde::Serialize;
use std::io::Read;
use std::process::{Command, Output, Stdio};
use std::sync::{mpsc, Mutex};
use std::time::{Duration, Instant};
#[cfg(windows)]
use super::launch::CREATE_NO_WINDOW;

#[derive(Debug, Serialize)]
pub struct WslDistro {
    pub name: String,
    pub path: String,
}

#[tauri::command(async)]
pub fn list_wsl_distros() -> Vec<WslDistro> {
    distro_names()
        .into_iter()
        .map(|name| WslDistro {
            path: format!("\\\\wsl$\\{}\\", name),
            name,
        })
        .collect()
}

/// How long `wsl.exe --list` may take. A cold start of the WSL service can
/// take a few seconds; past this the list comes back empty.
#[cfg_attr(not(windows), allow(dead_code))]
const LIST_TIMEOUT: Duration = Duration::from_secs(5);
/// How long one list serves: the sidebar, the terminal drawer and the
/// terminal menus all ask for it.
const LIST_KEEP: Duration = Duration::from_secs(300);

/// The installed WSL distros, in `wsl.exe --list --quiet` order. It runs at
/// most once per `LIST_KEEP`, and a caller that comes while it runs waits for
/// that run. A failed or timed-out run counts too, so a WSL that hangs costs
/// one timeout, not one per menu.
pub(crate) fn distro_names() -> Vec<String> {
    static LAST: Mutex<Option<(Instant, Vec<String>)>> = Mutex::new(None);
    let mut last = crate::lock(&LAST);
    if let Some((at, names)) = last.as_ref() {
        if at.elapsed() < LIST_KEEP {
            return names.clone();
        }
    }
    let names = run_list();
    *last = Some((Instant::now(), names.clone()));
    names
}

#[cfg(windows)]
fn run_list() -> Vec<String> {
    use std::os::windows::process::CommandExt;
    let mut cmd = Command::new("wsl.exe");
    cmd.args(["--list", "--quiet"]).creation_flags(CREATE_NO_WINDOW);
    match output_within(cmd, LIST_TIMEOUT) {
        Some(out) if out.status.success() => parse_list(&out.stdout),
        _ => Vec::new(),
    }
}

#[cfg(not(windows))]
fn run_list() -> Vec<String> {
    Vec::new()
}

/// The distro names in `wsl.exe --list --quiet` output: UTF-16 LE, maybe
/// with a BOM, one name a line, and some builds pad with NULs. Empty lines
/// and repeats are dropped.
#[cfg_attr(not(any(windows, test)), allow(dead_code))]
fn parse_list(bytes: &[u8]) -> Vec<String> {
    let (pairs, _) = bytes.as_chunks::<2>();
    let units: Vec<u16> = pairs.iter().map(|&pair| u16::from_le_bytes(pair)).collect();
    let units = units.strip_prefix(&[0xFEFF]).unwrap_or(&units);
    let mut names: Vec<String> = Vec::new();
    for line in String::from_utf16_lossy(units).lines() {
        let name: String = line.chars().filter(|c| *c != '\0').collect();
        let name = name.trim();
        if !name.is_empty() && !names.iter().any(|n| n == name) {
            names.push(name.to_string());
        }
    }
    names
}

/// Run `cmd` with stdout captured and stdin and stderr closed, and return
/// its output, or kill it and return `None` once `timeout` has passed.
#[cfg_attr(not(any(windows, test)), allow(dead_code))]
fn output_within(mut cmd: Command, timeout: Duration) -> Option<Output> {
    let deadline = Instant::now() + timeout;
    cmd.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null());
    let mut child = cmd.spawn().ok()?;
    // Read on another thread, so a full pipe can't stall the child, and so
    // the wait below has a deadline even if something the child started
    // keeps the pipe open.
    let mut stdout = child.stdout.take()?;
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        let mut buf = Vec::new();
        let _ = stdout.read_to_end(&mut buf);
        let _ = tx.send(buf);
    });
    let out = rx.recv_timeout(deadline.saturating_duration_since(Instant::now()));
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                return out.ok().map(|stdout| Output { status, stdout, stderr: Vec::new() })
            }
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(10)),
            _ => break,
        }
    }
    let _ = child.kill();
    let _ = child.wait();
    None
}

// ---------- WSL path translation ----------

#[tauri::command]
pub fn win_to_wsl(path: String) -> String {
    // C:\Users\me -> /mnt/c/Users/me
    let p = path.replace('\\', "/");
    if let Some((drive_letter, rest)) = p.split_once(':') {
        if drive_letter.len() == 1 {
            return format!("/mnt/{}{}", drive_letter.to_ascii_lowercase(), rest);
        }
    }
    p
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn win_to_wsl_drive_paths() {
        assert_eq!(win_to_wsl("C:\\Users\\me".into()), "/mnt/c/Users/me");
        assert_eq!(win_to_wsl("D:/data".into()), "/mnt/d/data");
        assert_eq!(win_to_wsl("C:".into()), "/mnt/c");
    }

    #[test]
    fn win_to_wsl_leaves_posix_paths() {
        assert_eq!(win_to_wsl("/home/me".into()), "/home/me");
    }

    fn utf16(text: &str) -> Vec<u8> {
        text.encode_utf16().flat_map(u16::to_le_bytes).collect()
    }

    #[test]
    fn the_list_is_utf16_names_one_a_line() {
        assert_eq!(parse_list(&utf16("Ubuntu\r\nDebian\r\n")), ["Ubuntu", "Debian"]);
        // A BOM, NUL padding, blank lines and a repeat.
        let bytes = utf16("\u{feff}Ubuntu-24.04\0\r\n\r\n  kali-linux \r\nUbuntu-24.04\r\n");
        assert_eq!(parse_list(&bytes), ["Ubuntu-24.04", "kali-linux"]);
        assert!(parse_list(&[]).is_empty());
        // A stray odd byte at the end is ignored.
        let mut odd = utf16("Arch");
        odd.push(0x41);
        assert_eq!(parse_list(&odd), ["Arch"]);
    }

    #[cfg(unix)]
    fn sh(script: &str) -> Command {
        let mut cmd = Command::new("sh");
        cmd.args(["-c", script]);
        cmd
    }

    #[cfg(unix)]
    #[test]
    fn a_quick_command_gives_its_output() {
        let out = output_within(sh("printf hi"), Duration::from_secs(10)).unwrap();
        assert!(out.status.success());
        assert_eq!(out.stdout, b"hi");
        let out = output_within(sh("exit 3"), Duration::from_secs(10)).unwrap();
        assert_eq!(out.status.code(), Some(3));
        assert!(output_within(Command::new("/no/such/program"), Duration::from_secs(1)).is_none());
    }

    #[cfg(unix)]
    #[test]
    fn a_command_past_its_time_is_killed() {
        let started = Instant::now();
        assert!(output_within(sh("sleep 20"), Duration::from_millis(200)).is_none());
        // Something left running that holds the pipe doesn't hold the call.
        assert!(output_within(sh("sleep 20 & printf hi"), Duration::from_millis(300)).is_none());
        assert!(started.elapsed() < Duration::from_secs(5), "{:?}", started.elapsed());
    }
}
