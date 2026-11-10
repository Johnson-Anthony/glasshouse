#[cfg(not(windows))]
use std::path::Path;
use std::path::PathBuf;
use crate::pty::profiles::{check_profile, detect_shells, ShellProfile};

// ---------- open / reveal ----------

/// Reap a spawned helper in the background. `drop(Child)` never waits, so on
/// Unix every exited helper (xdg-open, terminals, editors) would linger as a
/// zombie for the app's lifetime; a parked wait thread reaps it on exit.
fn reap(mut child: std::process::Child) {
    std::thread::spawn(move || {
        let _ = child.wait();
    });
}

#[tauri::command(async)]
pub fn open_with_default(path: String) -> Result<(), String> {
    #[cfg(windows)]
    {
        // ShellExecuteExW, not `cmd /C start`: cmd parses its command line, so
        // `&`, `|` or `^` in a filename ran the rest as a command.
        tauri_plugin_opener::open_path(&path, None::<&str>).map_err(|e| e.to_string())
    }
    #[cfg(not(windows))]
    {
        std::process::Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map(reap)
            .map_err(|e| e.to_string())
    }
}

#[tauri::command(async)]
pub fn reveal_in_explorer(path: String) -> Result<(), String> {
    #[cfg(windows)]
    {
        std::process::Command::new("explorer.exe")
            .arg("/select,")
            .arg(&path)
            .spawn()
            .map(reap)
            .map_err(|e| e.to_string())
    }
    #[cfg(target_os = "linux")]
    {
        // D-Bus activation of a cold file manager can take seconds, and
        // commands run on the main thread, so don't wait for it here.
        std::thread::spawn(move || {
            let p = Path::new(&path);
            if let Err(e) = show_items_dbus(p) {
                eprintln!("reveal: FileManager1.ShowItems failed ({e}); opening the parent");
                let _ = open_parent(p);
            }
        });
        Ok(())
    }
    #[cfg(all(not(windows), not(target_os = "linux")))]
    {
        open_parent(Path::new(&path))
    }
}

/// Ask the desktop's file manager (Nautilus, Dolphin, Caja, Nemo, Thunar…) to
/// open the item's folder with the item selected. The path is deliberately
/// not canonicalized, so a symlink is shown as itself rather than its target
/// (the opener plugin's reveal resolves links first).
#[cfg(target_os = "linux")]
fn show_items_dbus(path: &Path) -> Result<(), String> {
    let uri = url::Url::from_file_path(path)
        .map_err(|_| format!("not an absolute path: {}", path.display()))?;
    let conn = zbus::blocking::Connection::session().map_err(|e| e.to_string())?;
    conn.call_method(
        Some("org.freedesktop.FileManager1"),
        "/org/freedesktop/FileManager1",
        Some("org.freedesktop.FileManager1"),
        "ShowItems",
        &(vec![uri.as_str()], ""),
    )
    .map(|_| ())
    .map_err(|e| e.to_string())
}

/// Fallback reveal without selection: open the containing folder.
#[cfg(not(windows))]
fn open_parent(p: &Path) -> Result<(), String> {
    let target = p.parent().filter(|d| !d.as_os_str().is_empty()).unwrap_or(p);
    std::process::Command::new("xdg-open")
        .arg(target)
        .spawn()
        .map(reap)
        .map_err(|e| e.to_string())
}

// ---------- spawn external apps ----------

#[cfg(windows)]
pub(crate) const CREATE_NO_WINDOW: u32 = 0x08000000;

/// Build a command that opens a visible terminal emulator, optionally running
/// `run` inside it. Probes $TERMINAL first, then common emulators; per-emulator
/// flags for cwd and command execution since there is no cross-terminal standard.
#[cfg(not(windows))]
fn linux_terminal_command(
    cwd: &str,
    run: Option<(&str, &[String])>,
) -> Result<std::process::Command, String> {
    let mut candidates: Vec<String> = Vec::new();
    if let Ok(t) = std::env::var("TERMINAL") {
        if !t.trim().is_empty() {
            candidates.push(t);
        }
    }
    for c in [
        "kitty",
        "alacritty",
        "foot",
        "wezterm",
        "konsole",
        "gnome-terminal",
        "xfce4-terminal",
        "x-terminal-emulator",
        "xterm",
    ] {
        candidates.push(c.to_string());
    }
    let term = candidates
        .into_iter()
        .find(|c| which::which(c).is_ok())
        .ok_or_else(|| "no terminal emulator found — set $TERMINAL".to_string())?;
    Ok(terminal_command_for(&term, cwd, run))
}

/// The command for terminal emulator `term` (a name or path) with the
/// flags it takes for `cwd` and `run`.
#[cfg(not(windows))]
fn terminal_command_for(
    term: &str,
    cwd: &str,
    run: Option<(&str, &[String])>,
) -> std::process::Command {
    let name = std::path::Path::new(term)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or(term)
        .to_string();

    let mut cmd = std::process::Command::new(term);
    if !cwd.is_empty() {
        cmd.current_dir(cwd);
        match name.as_str() {
            "kitty" => {
                cmd.args(["--directory", cwd]);
            }
            "alacritty" | "foot" => {
                cmd.args(["--working-directory", cwd]);
            }
            "konsole" => {
                cmd.args(["--workdir", cwd]);
            }
            "gnome-terminal" | "xfce4-terminal" => {
                cmd.arg(format!("--working-directory={}", cwd));
            }
            // wezterm gets --cwd below; the rest inherit the process cwd.
            _ => {}
        }
    }
    match (name.as_str(), run) {
        ("wezterm", run) => {
            cmd.arg("start");
            if !cwd.is_empty() {
                cmd.args(["--cwd", cwd]);
            }
            if let Some((prog, args)) = run {
                cmd.arg("--").arg(prog).args(args);
            }
        }
        (_, None) => {}
        ("kitty" | "foot", Some((prog, args))) => {
            cmd.arg(prog).args(args);
        }
        ("gnome-terminal", Some((prog, args))) => {
            cmd.arg("--").arg(prog).args(args);
        }
        ("xfce4-terminal", Some((prog, args))) => {
            cmd.arg("-x").arg(prog).args(args);
        }
        (_, Some((prog, args))) => {
            cmd.arg("-e").arg(prog).args(args);
        }
    }
    cmd
}

/// Carries the folder to a PowerShell started via `cmd /C start` (see
/// `spawn_terminal`), so the path never appears on cmd's command line.
#[cfg(any(windows, test))]
const PS_CWD_ENV: &str = "GLASSHOUSE_CWD";
/// The `-Command` for that PowerShell: cd there, then drop the variable.
/// `-LiteralPath` keeps `[` `]` in folder names from being read as wildcards.
#[cfg(any(windows, test))]
const PS_CD_FROM_ENV: &str =
    "Set-Location -LiteralPath $env:GLASSHOUSE_CWD; Remove-Item Env:GLASSHOUSE_CWD";

/// Open a terminal window at `path`. Prefers Windows Terminal, then pwsh, then powershell.
#[tauri::command(async)]
pub fn spawn_terminal(path: String) -> Result<(), String> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        use std::process::{Command, Stdio};

        // 1) Windows Terminal — spawns its own visible window, no creation_flags.
        if which::which("wt.exe").is_ok() || which::which("wt").is_ok() {
            let child = Command::new("wt.exe")
                .arg("-d")
                .arg(wt_escape(&path))
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn();
            match child {
                Ok(c) => {
                    reap(c);
                    return Ok(());
                }
                Err(e) => {
                    // fall through to pwsh/powershell
                    eprintln!("wt.exe spawn failed: {}, falling back", e);
                }
            }
        }

        // 2) pwsh.exe (PowerShell 7+) — needs a visible console since it has no
        //    window chrome of its own. Use `cmd /C start` to give it a console.
        //    The folder goes in through PS_CWD_ENV, never on cmd's command
        //    line, where `&` or `^` in a folder name would run commands.
        if which::which("pwsh.exe").is_ok() || which::which("pwsh").is_ok() {
            let child = Command::new("cmd")
                .args(["/C", "start", "", "pwsh.exe", "-NoExit", "-Command", PS_CD_FROM_ENV])
                .env(PS_CWD_ENV, &path)
                .creation_flags(CREATE_NO_WINDOW)
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn();
            match child {
                Ok(c) => {
                    reap(c);
                    return Ok(());
                }
                Err(e) => {
                    eprintln!("pwsh.exe spawn failed: {}, falling back", e);
                }
            }
        }

        // 3) powershell.exe — always present on Windows. Same env-var cd as
        //    pwsh (Windows PowerShell 5.1 has no -WorkingDirectory anyway).
        let child = Command::new("cmd")
            .args(["/C", "start", "", "powershell.exe", "-NoExit", "-Command", PS_CD_FROM_ENV])
            .env(PS_CWD_ENV, &path)
            .creation_flags(CREATE_NO_WINDOW)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| format!("powershell.exe spawn failed: {}", e))?;
        reap(child);
        Ok(())
    }
    #[cfg(not(windows))]
    {
        use std::process::Stdio;
        let mut cmd = linux_terminal_command(&path, None)?;
        let child = cmd
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| e.to_string())?;
        reap(child);
        Ok(())
    }
}

/// First of `names` found on PATH, in order.
pub(super) fn find_tool(names: &[&str]) -> Option<PathBuf> {
    find_tool_in(names, std::env::var_os("PATH"))
}

fn find_tool_in(names: &[&str], path: Option<std::ffi::OsString>) -> Option<PathBuf> {
    let cwd = std::env::current_dir().unwrap_or_default();
    names
        .iter()
        .find_map(|n| which::which_in(n, path.as_ref(), &cwd).ok())
}

/// `find_tool`, with a miss reported as `what` not being on PATH.
pub(super) fn require_tool(what: &str, names: &[&str]) -> Result<PathBuf, String> {
    find_tool(names).ok_or_else(|| format!("{} not found on PATH (tried {})", what, names.join(", ")))
}

/// VS Code launchers in preference order: Microsoft's build, then VSCodium,
/// then the distro OSS build (Arch, Fedora).
#[cfg(windows)]
const VSCODE_NAMES: &[&str] = &["code.cmd", "code.exe", "code", "codium.cmd", "codium.exe", "codium"];
#[cfg(not(windows))]
const VSCODE_NAMES: &[&str] = &["code", "codium", "code-oss"];

/// Open VS Code at `path` (file or folder).
#[tauri::command(async)]
pub fn spawn_vscode(path: String) -> Result<(), String> {
    use std::process::{Command, Stdio};

    let program = require_tool("VS Code", VSCODE_NAMES)?.into_os_string();

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // `code.cmd` is a batch file. Spawn it directly: std runs batch files
        // through cmd.exe itself and escapes the arguments for cmd's parser.
        // A hand-built `cmd /C code.cmd <path>` didn't, so `&` in a path ran
        // commands. CREATE_NO_WINDOW hides the transient launcher console.
        let child = Command::new(&program)
            .arg(&path)
            .creation_flags(CREATE_NO_WINDOW)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| format!("spawn code: {}", e))?;
        reap(child);
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let child = Command::new(&program)
            .arg(&path)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| format!("spawn code: {}", e))?;
        reap(child);
        Ok(())
    }
}

// ---------- run script ----------

/// How long `run_script` lets a script run before killing it. Commands are
/// synchronous, so the UI waits all that time; long jobs belong in the
/// terminal.
const RUN_SCRIPT_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(60);
/// Output kept per stream. The rest is still read (and dropped), so a chatty
/// script never blocks on a full pipe.
const RUN_SCRIPT_OUTPUT_CAP: usize = 1024 * 1024;
/// How long to keep reading after the script exits. A process it started in
/// the background can hold the pipes open indefinitely.
const RUN_SCRIPT_DRAIN_GRACE: std::time::Duration = std::time::Duration::from_secs(2);

/// What `run_capped` collected.
struct CappedRun {
    stdout: Vec<u8>,
    stderr: Vec<u8>,
    /// None if the process was killed at the timeout.
    status: Option<std::process::ExitStatus>,
    /// Some stream went over the cap.
    truncated: bool,
    /// A stream was still open when the drain grace ran out.
    incomplete: bool,
}

/// Run `cmd` with stdin closed, killing it and every process it started
/// (`proc_tree`) after `timeout`, keeping at most `cap` bytes of each output
/// stream.
fn run_capped(
    mut cmd: std::process::Command,
    timeout: std::time::Duration,
    cap: usize,
    grace: std::time::Duration,
) -> std::io::Result<CappedRun> {
    use std::io::Read;
    use std::process::Stdio;
    use std::sync::{mpsc, Arc, Mutex};
    use std::time::Instant;

    type Sink = Arc<Mutex<(Vec<u8>, bool)>>;
    // Readers append as they go, so whatever arrived before the grace ran
    // out is kept even if the stream never reaches EOF.
    fn reader(mut r: impl Read + Send + 'static, cap: usize, done: mpsc::Sender<()>) -> Sink {
        let sink: Sink = Arc::default();
        let out = sink.clone();
        std::thread::spawn(move || {
            let mut buf = [0u8; 8192];
            loop {
                match r.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        let mut s = crate::lock(&out);
                        let room = cap.saturating_sub(s.0.len());
                        s.0.extend_from_slice(&buf[..n.min(room)]);
                        s.1 |= n > room;
                    }
                    Err(e) if e.kind() == std::io::ErrorKind::Interrupted => {}
                    Err(_) => break,
                }
            }
            let _ = done.send(());
        });
        sink
    }

    let mut tree = crate::proc_tree::spawn(
        cmd.stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped()),
    )?;
    let (done_tx, done_rx) = mpsc::channel();
    let out = reader(tree.child.stdout.take().expect("stdout is piped"), cap, done_tx.clone());
    let err = reader(tree.child.stderr.take().expect("stderr is piped"), cap, done_tx);

    let deadline = Instant::now() + timeout;
    let status = loop {
        if let Some(s) = tree.child.try_wait()? {
            break Some(s);
        }
        if Instant::now() >= deadline {
            // The whole tree: a background child would otherwise keep
            // running, and keep the output pipes open.
            tree.kill_tree();
            break None;
        }
        std::thread::sleep(std::time::Duration::from_millis(20));
    };

    let drain_until = Instant::now() + grace;
    let mut finished = 0;
    while finished < 2 {
        let left = drain_until.saturating_duration_since(Instant::now());
        match done_rx.recv_timeout(left) {
            Ok(()) => finished += 1,
            Err(_) => break,
        }
    }
    let take = |s: &Sink| std::mem::take(&mut *crate::lock(s));
    let (stdout, out_cut) = take(&out);
    let (stderr, err_cut) = take(&err);
    Ok(CappedRun {
        stdout,
        stderr,
        status,
        truncated: out_cut || err_cut,
        incomplete: finished < 2,
    })
}

/// Execute `script` with `targets` as positional arguments, blocking until it
/// exits (at most RUN_SCRIPT_TIMEOUT), and return combined output as
/// "stdout\n---STDERR---\nstderr" plus status notes. On windows, `.ps1` is run
/// via `powershell -File`, anything else (`.bat`/`.cmd` included) directly.
#[tauri::command(async)]
pub fn run_script(script: String, targets: Vec<String>) -> Result<String, String> {
    use std::process::Command;

    let lower = script.to_ascii_lowercase();
    let mut cmd;
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        if lower.ends_with(".ps1") {
            cmd = Command::new("powershell.exe");
            cmd.args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", &script]);
        } else {
            // Batch files too: std runs them through cmd.exe and escapes the
            // targets for cmd's parser. `cmd /C <script> <targets>` didn't,
            // so `&` in a selected file's name ran commands.
            cmd = Command::new(&script);
        }
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    #[cfg(not(windows))]
    {
        let _ = lower;
        cmd = Command::new(&script);
    }
    for t in &targets {
        cmd.arg(t);
    }

    let run = run_capped(cmd, RUN_SCRIPT_TIMEOUT, RUN_SCRIPT_OUTPUT_CAP, RUN_SCRIPT_DRAIN_GRACE)
        .map_err(|e| format!("run_script {}: {}", script, e))?;
    Ok(format_script_output(&run, RUN_SCRIPT_TIMEOUT))
}

fn format_script_output(run: &CappedRun, timeout: std::time::Duration) -> String {
    let stdout = String::from_utf8_lossy(&run.stdout);
    let stderr = String::from_utf8_lossy(&run.stderr);
    let mut combined = format!("{}\n---STDERR---\n{}", stdout, stderr);
    // Surface failure in the output; a bare Ok on a non-zero exit made
    // failed scripts indistinguishable from successful ones.
    match run.status {
        None => combined.push_str(&format!(
            "\n[timed out after {} s: killed. Run long jobs in the terminal.]",
            timeout.as_secs()
        )),
        Some(s) if !s.success() => {
            let code = s
                .code()
                .map(|c| c.to_string())
                .unwrap_or_else(|| "killed by signal".to_string());
            combined.push_str(&format!("\n[exit: {}]", code));
        }
        Some(_) => {}
    }
    if run.truncated {
        combined.push_str(&format!(
            "\n[output truncated: kept the first {} KiB of each stream]",
            RUN_SCRIPT_OUTPUT_CAP / 1024
        ));
    }
    if run.incomplete {
        combined.push_str("\n[output may be incomplete: a process the script started still holds its output open]");
    }
    combined
}

// ---------- open url ----------

/// Only web and mail links. Any other scheme hands the string to whatever
/// protocol handler claims it (`file:`, `ms-msdt:`, `search-ms:`…), and a
/// leading `-` would reach xdg-open as an option.
fn check_open_url(url: &str) -> Result<(), String> {
    let scheme = url.split_once(':').map(|(s, _)| s.to_ascii_lowercase());
    let ok_scheme = matches!(scheme.as_deref(), Some("http" | "https" | "mailto"));
    if !ok_scheme || url.chars().any(char::is_control) {
        return Err(format!("open_url: only http, https and mailto links can be opened: {}", url));
    }
    Ok(())
}

/// Open `url` in the system default browser.
#[tauri::command(async)]
pub fn open_url(url: String) -> Result<(), String> {
    check_open_url(&url)?;
    #[cfg(windows)]
    {
        // ShellExecuteExW, not `cmd /C start`: cmd split the URL at every `&`
        // (so query strings broke) and ran what followed as a command.
        tauri_plugin_opener::open_url(&url, None::<&str>).map_err(|e| format!("open_url: {}", e))
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&url)
            .spawn()
            .map(reap)
            .map_err(|e| format!("open_url: {}", e))
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        std::process::Command::new("xdg-open")
            .arg(&url)
            .spawn()
            .map(reap)
            .map_err(|e| format!("open_url: {}", e))
    }
}

// ---------- spawn new window ----------

/// Launch a detached copy of the current executable (new app window).
#[tauri::command(async)]
pub fn spawn_new_window() -> Result<(), String> {
    use std::process::{Command, Stdio};
    let exe = std::env::current_exe()
        .map_err(|e| format!("current_exe: {}", e))?;

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let child = Command::new(&exe)
            .creation_flags(CREATE_NO_WINDOW)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| format!("spawn_new_window: {}", e))?;
        reap(child);
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let child = Command::new(&exe)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| format!("spawn_new_window: {}", e))?;
        reap(child);
        Ok(())
    }
}


/// Whether `s` can sit on a `cmd /C` command line without cmd interpreting
/// any of it (Windows paths can't contain `"`, `<`, `>` or `|` anyway).
#[cfg(any(windows, test))]
fn is_cmd_inert(s: &str) -> bool {
    !s.chars().any(|c| matches!(c, '&' | '|' | '<' | '>' | '^' | '%' | '!' | '"') || c.is_control())
}

/// Escape `s` for a wt.exe argument. wt splits its command line into
/// subcommands at every `;`, even inside an argument (so `-d C:\a;calc`
/// would run calc), and turns `\;` back into `;`.
#[cfg(any(windows, test))]
fn wt_escape(s: &str) -> String {
    s.replace(';', "\\;")
}

/// Launch a terminal profile in `cwd`. Prefers Windows Terminal (`wt.exe`);
/// falls back to `cmd /C start`. Never flashes a console window.
#[tauri::command(async)]
pub fn spawn_terminal_profile(profile: ShellProfile, cwd: String) -> Result<(), String> {
    check_profile(&profile, &detect_shells())?;
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        use std::process::{Command, Stdio};

        let have_wt = which::which("wt.exe").is_ok() || which::which("wt").is_ok();

        if have_wt {
            let mut cmd = Command::new("wt.exe");
            cmd.arg("-d").arg(wt_escape(&cwd));
            match profile.kind.as_str() {
                "wsl" => {
                    cmd.arg("wsl.exe");
                    for a in &profile.args {
                        cmd.arg(wt_escape(a));
                    }
                }
                "ssh" => {
                    cmd.arg("ssh");
                    for a in &profile.args {
                        cmd.arg(wt_escape(a));
                    }
                }
                _ => {
                    cmd.arg(wt_escape(&profile.exec));
                    for a in &profile.args {
                        cmd.arg(wt_escape(a));
                    }
                }
            }
            let res = cmd
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn();
            match res {
                Ok(c) => {
                    reap(c);
                    return Ok(());
                }
                Err(e) => {
                    eprintln!("wt.exe spawn failed: {}, falling back", e);
                }
            }
        }

        // Fallback: cmd /C start "" <exec> <args>. cmd parses this line, so
        // refuse anything it would interpret (check_profile already limits
        // hosts and distro names; this covers a shell's exec path).
        let mut on_cmd_line =
            profile.args.iter().chain((profile.kind == "shell").then_some(&profile.exec));
        if !on_cmd_line.all(|a| is_cmd_inert(a)) {
            return Err("spawn_terminal_profile: without Windows Terminal, this profile can't be launched safely (cmd.exe would interpret its path)".into());
        }
        let mut cmd = Command::new("cmd");
        cmd.arg("/C").arg("start").arg("");
        match profile.kind.as_str() {
            "wsl" => {
                cmd.arg("wsl.exe");
                for a in &profile.args {
                    cmd.arg(a);
                }
            }
            "ssh" => {
                cmd.arg("ssh");
                for a in &profile.args {
                    cmd.arg(a);
                }
            }
            _ => {
                cmd.arg(&profile.exec);
                for a in &profile.args {
                    cmd.arg(a);
                }
            }
        }
        cmd.creation_flags(CREATE_NO_WINDOW)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        let _ = cwd; // cwd used above for wt; fallback ignores per spec.
        cmd.spawn()
            .map(reap)
            .map_err(|e| format!("spawn_terminal_profile fallback: {}", e))
    }
    #[cfg(not(windows))]
    {
        use std::process::Stdio;
        let prog: &str = match profile.kind.as_str() {
            "ssh" => "ssh",
            _ => profile.exec.as_str(),
        };
        let mut cmd = linux_terminal_command(&cwd, Some((prog, &profile.args)))?;
        cmd.stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map(reap)
            .map_err(|e| format!("spawn_terminal_profile: {}", e))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg_attr(windows, allow(unused_imports))]
    use crate::commands::archive::SEVEN_ZIP_NAMES;
    #[cfg_attr(windows, allow(unused_imports))]
    use crate::commands::testing::temp_dir;

    #[cfg(unix)]
    fn sh(script: &str) -> std::process::Command {
        let mut c = std::process::Command::new("sh");
        c.args(["-c", script]);
        c
    }

    #[cfg(unix)]
    #[test]
    fn find_tool_in_takes_the_first_name_present() {
        use std::os::unix::fs::PermissionsExt;
        let dir = temp_dir("findtool");
        for name in ["7zz", "7za"] {
            let p = dir.join(name);
            std::fs::write(&p, "#!/bin/sh\n").unwrap();
            std::fs::set_permissions(&p, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
        let path = Some(dir.clone().into_os_string());
        assert_eq!(find_tool_in(SEVEN_ZIP_NAMES, path.clone()), Some(dir.join("7zz")));
        assert_eq!(find_tool_in(&["codium"], path), None);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn cmd_and_wt_quoting_helpers() {
        assert!(is_cmd_inert(r"C:\Program Files (x86)\Git\bin\bash.exe"));
        assert!(is_cmd_inert("Ubuntu-24.04"));
        for bad in ["a&b", "a|b", "a^b", "%PATH%", "a!b", "a\"b", "a<b", "a\nb"] {
            assert!(!is_cmd_inert(bad), "{}", bad);
        }
        // Inverse of wt's own unescape (`\;` -> `;`), so the path arrives intact.
        assert_eq!(wt_escape(r"C:\a;b"), r"C:\a\;b");
        assert_eq!(wt_escape(r"C:\x\;y"), r"C:\x\\;y");
        assert_eq!(wt_escape(";x;;"), r"\;x\;\;");
        assert_eq!(wt_escape(r"C:\plain"), r"C:\plain");
        // The PowerShell cd command only ever reads the path from the env var.
        assert!(PS_CD_FROM_ENV.contains(&format!("$env:{}", PS_CWD_ENV)));
        assert!(!PS_CD_FROM_ENV.contains('"'));
    }

    #[test]
    fn open_url_allows_only_web_and_mail() {
        for ok in [
            "https://github.com/Johnson-Anthony/glasshouse/issues/new",
            "http://localhost:1420/?a=1&b=2",
            "HTTPS://EXAMPLE.COM",
            "mailto:someone@example.com",
        ] {
            assert!(check_open_url(ok).is_ok(), "{}", ok);
        }
        for bad in [
            "file:///C:/Windows/System32/calc.exe",
            "ms-msdt:/id PCWDiagnostic",
            "search-ms:query=x",
            "javascript:alert(1)",
            "--help",
            "/etc/passwd",
            "https://example.com/\nfoo",
            "",
        ] {
            assert!(check_open_url(bad).is_err(), "{}", bad);
        }
    }

    #[cfg(unix)]
    #[test]
    fn run_capped_kills_at_the_timeout() {
        use std::time::{Duration, Instant};
        let t = Instant::now();
        let run = run_capped(
            sh("echo started; sleep 10"),
            Duration::from_millis(300),
            1024,
            Duration::from_millis(500),
        )
        .unwrap();
        assert!(t.elapsed() < Duration::from_secs(5), "{:?}", t.elapsed());
        assert!(run.status.is_none());
        assert_eq!(String::from_utf8_lossy(&run.stdout), "started\n");
        let text = format_script_output(&run, Duration::from_secs(60));
        assert!(text.contains("[timed out after 60 s"), "{}", text);
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn run_capped_kills_the_whole_tree_at_the_timeout() {
        use std::time::{Duration, Instant};
        let t = Instant::now();
        // The background sleep holds stdout open. Killing only `sh` left it
        // running and made the drain wait out its whole grace period.
        let run = run_capped(
            sh("sleep 30 & echo $!; wait"),
            Duration::from_millis(300),
            1024,
            Duration::from_secs(10),
        )
        .unwrap();
        assert!(run.status.is_none());
        assert!(!run.incomplete, "a killed tree closes its pipes");
        assert!(t.elapsed() < Duration::from_secs(5), "{:?}", t.elapsed());
        let bg: u32 = String::from_utf8_lossy(&run.stdout).trim().parse().unwrap();
        // Gone, or a zombie waiting for whichever ancestor reaps orphans.
        let dead = || !crate::commands::testing::process_alive(bg);
        let until = Instant::now() + Duration::from_secs(5);
        while !dead() && Instant::now() < until {
            std::thread::sleep(Duration::from_millis(50));
        }
        assert!(dead(), "background child {} outlived the timeout", bg);
    }

    #[cfg(unix)]
    #[test]
    fn run_capped_caps_output_and_keeps_draining() {
        use std::time::Duration;
        // 3 MB on stdout: well past the cap and any pipe buffer, so a reader
        // that stopped reading at the cap would hang the script.
        let run = run_capped(
            sh("head -c 3000000 /dev/zero; echo err >&2; exit 3"),
            Duration::from_secs(20),
            1000,
            Duration::from_secs(2),
        )
        .unwrap();
        assert_eq!(run.stdout.len(), 1000);
        assert_eq!(String::from_utf8_lossy(&run.stderr), "err\n");
        assert!(run.truncated && !run.incomplete);
        let text = format_script_output(&run, Duration::from_secs(60));
        assert!(text.contains("[exit: 3]") && text.contains("[output truncated"), "{}", text);
    }

    #[cfg(unix)]
    #[test]
    fn run_capped_returns_when_a_background_child_holds_the_pipe() {
        use std::time::{Duration, Instant};
        let t = Instant::now();
        // The script exits at once, but `sleep` inherits stdout and keeps it
        // open; Command::output() would wait for it.
        let run = run_capped(
            sh("sleep 5 & echo hi"),
            Duration::from_secs(20),
            1024,
            Duration::from_millis(300),
        )
        .unwrap();
        assert!(t.elapsed() < Duration::from_secs(4), "{:?}", t.elapsed());
        assert!(run.status.is_some_and(|s| s.success()));
        assert_eq!(String::from_utf8_lossy(&run.stdout), "hi\n");
        assert!(run.incomplete);
    }
}

#[cfg(test)]
#[path = "launch_tests.rs"]
mod launch_tests;
