use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use crate::commands::listing::home_dir_path;
#[cfg(windows)]
use crate::commands::launch::CREATE_NO_WINDOW;

// ---------- shell profile detection ----------

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ShellProfile {
    pub id: String,
    pub label: String,
    pub kind: String,
    pub exec: String,
    pub args: Vec<String>,
}

/// Decode UTF-16LE byte buffer into String. Returns lossy UTF-8 on failure.
#[cfg(windows)]
fn decode_utf16le(bytes: &[u8]) -> String {
    // Strip BOM if present.
    let mut slice = bytes;
    if slice.len() >= 2 && slice[0] == 0xFF && slice[1] == 0xFE {
        slice = &slice[2..];
    }
    let mut u16s: Vec<u16> = Vec::with_capacity(slice.len() / 2);
    let mut i = 0;
    while i + 1 < slice.len() {
        u16s.push(u16::from_le_bytes([slice[i], slice[i + 1]]));
        i += 2;
    }
    String::from_utf16_lossy(&u16s)
}

/// Parse `~/.ssh/config` and return host entries, skipping wildcards.
fn ssh_hosts() -> Vec<String> {
    let home = match home_dir_path() {
        Some(h) => h,
        None => return Vec::new(),
    };
    let cfg_path = home.join(".ssh").join("config");
    let text = match std::fs::read_to_string(&cfg_path) {
        Ok(t) => t,
        Err(_) => return Vec::new(),
    };
    parse_ssh_hosts(&text)
}

/// The `Host` names in an ssh config's text, in order, without wildcards or
/// repeats.
fn parse_ssh_hosts(text: &str) -> Vec<String> {
    let mut hosts: Vec<String> = Vec::new();
    for raw in text.lines() {
        let line = raw.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        // ssh_config(5): the keyword (any case) ends at whitespace or `=`,
        // and is followed by whitespace or by exactly one `=`.
        let end = line
            .find(|c: char| c.is_whitespace() || c == '=')
            .unwrap_or(line.len());
        if !line[..end].eq_ignore_ascii_case("host") {
            continue;
        }
        let rest = line[end..].trim_start();
        let rest = rest.strip_prefix('=').unwrap_or(rest).trim_start();
        if rest.starts_with('=') {
            continue;
        }
        for tok in rest.split_whitespace() {
            if tok.contains('*') || tok.contains('?') {
                continue;
            }
            if !hosts.iter().any(|h| h == tok) {
                hosts.push(tok.to_string());
            }
        }
    }
    hosts
}

/// Detect installed WSL distributions by running `wsl.exe -l -q`.
/// Output is UTF-16LE; decode manually without pulling `encoding_rs`.
fn wsl_distros() -> Vec<String> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        use std::process::Command;
        if which::which("wsl.exe").is_err() && which::which("wsl").is_err() {
            return Vec::new();
        }
        let out = Command::new("wsl.exe")
            .args(["-l", "-q"])
            .creation_flags(CREATE_NO_WINDOW)
            .output();
        let output = match out {
            Ok(o) => o,
            Err(_) => return Vec::new(),
        };
        if !output.status.success() {
            return Vec::new();
        }
        let text = decode_utf16le(&output.stdout);
        let mut distros: Vec<String> = Vec::new();
        for line in text.lines() {
            // Strip nulls and whitespace; -q output often has stray \0.
            let cleaned: String = line.chars().filter(|c| *c != '\0').collect();
            let trimmed = cleaned.trim();
            if trimmed.is_empty() {
                continue;
            }
            if !distros.iter().any(|d| d == trimmed) {
                distros.push(trimmed.to_string());
            }
        }
        distros
    }
    #[cfg(not(windows))]
    {
        Vec::new()
    }
}

/// The user's login shell from `$SHELL`, if it names a real program. The
/// terminal drawer opens `profiles[0]` by default, so this goes first.
#[cfg(not(windows))]
fn login_shell(var: Option<String>) -> Option<PathBuf> {
    let p = PathBuf::from(var?);
    let name = p.file_name()?.to_string_lossy();
    if name == "nologin" || name == "false" {
        return None;
    }
    (p.is_absolute() && p.is_file()).then_some(p)
}

/// The login shell (if any), then each probe that `resolve` finds. A probe
/// whose id is already listed is skipped, so `$SHELL=/usr/bin/zsh` replaces
/// the zsh probe rather than doubling it, and the two PowerShell variants
/// share one entry.
fn shell_profiles(
    login: Option<PathBuf>,
    probes: &[(&str, &str, &str)],
    resolve: impl Fn(&str) -> Option<PathBuf>,
) -> Vec<ShellProfile> {
    let mut out: Vec<ShellProfile> = Vec::new();
    let shell = |id: String, label: String, exec: PathBuf| ShellProfile {
        id,
        label,
        kind: "shell".to_string(),
        exec: exec.to_string_lossy().to_string(),
        args: Vec::new(),
    };
    if let Some(path) = login {
        let name = path.file_name().unwrap_or_default().to_string_lossy().into_owned();
        // Reuse a probe's id and label when there is one, so a profile the
        // frontend remembered by id still matches.
        let (id, label) = match probes.iter().find(|(exe, _, _)| *exe == name) {
            Some((_, label, id)) => ((*id).to_string(), (*label).to_string()),
            None => (format!("shell:{}", name), name),
        };
        out.push(shell(id, label, path));
    }
    for (exe, label, id) in probes {
        let dup = out
            .iter()
            .any(|p| p.id == *id || (*label == "PowerShell" && p.label == "PowerShell"));
        if dup {
            continue;
        }
        if let Some(resolved) = resolve(exe) {
            out.push(shell((*id).to_string(), (*label).to_string(), resolved));
        }
    }
    out
}

/// Probe the system for available shells, WSL distros, and SSH hosts.
/// Emits only what actually exists: shells first, then WSL, then SSH.
#[tauri::command(async)]
pub fn list_shell_profiles() -> Vec<ShellProfile> {
    let mut out = detect_shells();

    // WSL distros.
    for distro in wsl_distros() {
        out.push(ShellProfile {
            id: format!("wsl:{}", distro),
            label: format!("WSL · {}", distro),
            kind: "wsl".to_string(),
            exec: "wsl.exe".to_string(),
            args: vec!["-d".to_string(), distro],
        });
    }

    // SSH hosts from ~/.ssh/config.
    for host in ssh_hosts() {
        out.push(ShellProfile {
            id: format!("ssh:{}", host),
            label: format!("SSH: {}", host),
            kind: "ssh".to_string(),
            exec: "ssh".to_string(),
            args: vec![host],
        });
    }

    out
}

/// The `kind: "shell"` profiles: shells found on PATH, in preferred order.
/// Also the allowlist `check_profile` holds a shell profile's `exec` to.
pub(crate) fn detect_shells() -> Vec<ShellProfile> {
    let mut out: Vec<ShellProfile> = Vec::new();

    // Shell probes, in preferred order.
    #[cfg(windows)]
    let shell_probes: [(&str, &str, &str); 5] = [
        ("bash.exe", "bash", "shell:bash"),
        ("zsh.exe", "zsh", "shell:zsh"),
        ("fish.exe", "fish", "shell:fish"),
        ("pwsh.exe", "PowerShell", "shell:pwsh"),
        ("powershell.exe", "PowerShell", "shell:powershell"),
    ];
    #[cfg(not(windows))]
    let shell_probes: [(&str, &str, &str); 5] = [
        ("bash", "bash", "shell:bash"),
        ("zsh", "zsh", "shell:zsh"),
        ("fish", "fish", "shell:fish"),
        ("pwsh", "PowerShell", "shell:pwsh"),
        ("powershell", "PowerShell", "shell:powershell"),
    ];
    #[cfg(windows)]
    let login = None;
    #[cfg(not(windows))]
    let login = login_shell(std::env::var("SHELL").ok());
    out.extend(shell_profiles(login, &shell_probes, |exe| which::which(exe).ok()));
    out
}

/// Check a terminal profile from the frontend before `pty_spawn` or
/// `spawn_terminal_profile` runs it. The frontend only sends the shapes
/// `list_shell_profiles` and saved ssh remotes (`sshProfileFor` in App.tsx)
/// build, so anything else is refused: a `shell` whose exec isn't a detected
/// shell (`shells`), extra args, a WSL distro or ssh host that the program
/// would read as an option (`-oProxyCommand=…`), or an unknown kind.
pub(crate) fn check_profile(profile: &ShellProfile, shells: &[ShellProfile]) -> Result<(), String> {
    let bad = |why: &str| Err(format!("refusing terminal profile {:?}: {}", profile.id, why));
    match profile.kind.as_str() {
        "shell" => {
            if !profile.args.is_empty() {
                return bad("shell profiles take no arguments");
            }
            if !shells.iter().any(|s| s.exec == profile.exec) {
                return bad("not a detected shell");
            }
        }
        "wsl" => match profile.args.as_slice() {
            [d, distro] if d == "-d" && is_plain_name(distro) => {}
            _ => return bad("expected -d <distro>"),
        },
        "ssh" => {
            let host = match profile.args.as_slice() {
                [host] => host,
                [p, port, host] if p == "-p" && is_port(port) => host,
                _ => return bad("expected <host> or -p <port> <host>"),
            };
            if !is_ssh_host(host) {
                return bad("not a plain ssh host");
            }
        }
        _ => return bad("unknown kind"),
    }
    Ok(())
}

/// A WSL distro name: letters, digits, `.`, `_`, `-`, not starting with `-`.
fn is_plain_name(s: &str) -> bool {
    !s.is_empty()
        && !s.starts_with('-')
        && s.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
}

fn is_port(s: &str) -> bool {
    !s.is_empty() && s.len() <= 5 && s.bytes().all(|b| b.is_ascii_digit())
        && s.parse::<u32>().is_ok_and(|n| (1..=65535).contains(&n))
}

/// An ssh destination: `host`, `user@host`, an IP (`[::1]`, `fe80::1%eth0`)
/// or `ssh://user@host:port`. No leading `-` (ssh would read an option) and
/// nothing a shell or wt.exe would interpret.
fn is_ssh_host(s: &str) -> bool {
    !s.is_empty()
        && !s.starts_with('-')
        && s.chars().all(|c| {
            c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-' | '@' | ':' | '%' | '[' | ']' | '/')
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg_attr(windows, allow(unused_imports))]
    use crate::commands::testing::{temp_dir, s};

    fn profile(kind: &str, exec: &str, args: &[&str]) -> ShellProfile {
        ShellProfile {
            id: format!("{}:test", kind),
            label: "test".into(),
            kind: kind.into(),
            exec: exec.into(),
            args: args.iter().map(|a| a.to_string()).collect(),
        }
    }

    fn ids(profiles: &[ShellProfile]) -> Vec<&str> {
        profiles.iter().map(|p| p.id.as_str()).collect()
    }

    const PROBES: &[(&str, &str, &str)] = &[
        ("bash", "bash", "shell:bash"),
        ("zsh", "zsh", "shell:zsh"),
        ("pwsh", "PowerShell", "shell:pwsh"),
        ("powershell", "PowerShell", "shell:powershell"),
    ];

    #[test]
    fn shell_profiles_put_the_login_shell_first() {
        let all = |exe: &str| Some(PathBuf::from(format!("/usr/bin/{}", exe)));
        let got = shell_profiles(Some(PathBuf::from("/usr/bin/zsh")), PROBES, all);
        assert_eq!(ids(&got), ["shell:zsh", "shell:bash", "shell:pwsh"]);
        assert_eq!(got[0].label, "zsh");
        assert_eq!(got[0].exec, "/usr/bin/zsh");

        // A login shell that isn't probed gets its own profile.
        let got = shell_profiles(Some(PathBuf::from("/opt/nu/bin/nu")), PROBES, all);
        assert_eq!(ids(&got), ["shell:nu", "shell:bash", "shell:zsh", "shell:pwsh"]);
        assert_eq!(got[0].label, "nu");
    }

    #[test]
    fn shell_profiles_keep_one_powershell_and_skip_missing() {
        let some = |exe: &str| (exe != "zsh").then(|| PathBuf::from(format!("/bin/{}", exe)));
        let got = shell_profiles(None, PROBES, some);
        assert_eq!(ids(&got), ["shell:bash", "shell:pwsh"]);
        let got = shell_profiles(Some(PathBuf::from("/bin/pwsh")), PROBES, some);
        assert_eq!(ids(&got), ["shell:pwsh", "shell:bash"]);
    }

    #[cfg(not(windows))]
    #[test]
    fn login_shell_rejects_unusable_values() {
        let dir = temp_dir("loginshell");
        let sh = dir.join("myshell");
        std::fs::write(&sh, "").unwrap();
        assert_eq!(login_shell(Some(s(&sh))), Some(sh.clone()));
        assert_eq!(login_shell(Some("myshell".into())), None); // relative
        assert_eq!(login_shell(Some(s(&dir.join("absent")))), None);
        assert_eq!(login_shell(Some("/usr/sbin/nologin".into())), None);
        assert_eq!(login_shell(Some(String::new())), None);
        assert_eq!(login_shell(None), None);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn check_profile_accepts_what_the_frontend_builds() {
        let shells = vec![profile("shell", "/usr/bin/bash", &[])];
        let ok = [
            profile("shell", "/usr/bin/bash", &[]),
            profile("wsl", "wsl.exe", &["-d", "Ubuntu-24.04"]),
            profile("wsl", "wsl.exe", &["-d", "OracleLinux_9_1"]),
            profile("ssh", "ssh", &["box"]),
            profile("ssh", "ssh", &["me@example.com"]),
            profile("ssh", "ssh", &["-p", "2222", "example.com"]),
            profile("ssh", "ssh", &["[::1]"]),
            profile("ssh", "ssh", &["fe80::1%eth0"]),
            profile("ssh", "ssh", &["ssh://me@example.com:22"]),
        ];
        for p in &ok {
            assert!(check_profile(p, &shells).is_ok(), "{:?}", p.args);
        }
    }

    #[test]
    fn check_profile_refuses_everything_else() {
        let shells = vec![profile("shell", "/usr/bin/bash", &[])];
        let bad = [
            // any executable, or a shell with arguments
            profile("shell", "/tmp/evil", &[]),
            profile("shell", "/usr/bin/bash", &["-c", "id"]),
            profile("", "/usr/bin/python3", &[]),
            profile("other", "/usr/bin/bash", &[]),
            // wsl: only `-d <name>`
            profile("wsl", "wsl.exe", &[]),
            profile("wsl", "wsl.exe", &["-e", "sh"]),
            profile("wsl", "wsl.exe", &["-d", "--exec"]),
            profile("wsl", "wsl.exe", &["-d", "Ubuntu", "--", "sh"]),
            profile("wsl", "wsl.exe", &["-d", "a&calc"]),
            // ssh: no options smuggled in as the host, no extra args
            profile("ssh", "ssh", &["-oProxyCommand=calc"]),
            profile("ssh", "ssh", &["-p", "22", "-oProxyCommand=calc"]),
            profile("ssh", "ssh", &["-p", "0", "host"]),
            profile("ssh", "ssh", &["-p", "70000", "host"]),
            profile("ssh", "ssh", &["-p", "22x", "host"]),
            profile("ssh", "ssh", &["host", "id"]),
            profile("ssh", "ssh", &[]),
            profile("ssh", "ssh", &["a b"]),
            profile("ssh", "ssh", &["host;calc"]),
            profile("ssh", "ssh", &["host&calc"]),
            profile("ssh", "ssh", &["host\ncalc"]),
        ];
        for p in &bad {
            assert!(check_profile(p, &shells).is_err(), "{} {:?}", p.kind, p.args);
        }
    }

    #[test]
    fn detected_shells_pass_check_profile() {
        let shells = detect_shells();
        for p in &shells {
            assert!(check_profile(p, &shells).is_ok(), "{:?}", p);
        }
    }
}

#[cfg(test)]
#[path = "profiles_tests.rs"]
mod profiles_tests;
