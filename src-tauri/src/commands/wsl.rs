use serde::Serialize;
#[cfg(windows)]
use super::launch::CREATE_NO_WINDOW;

#[derive(Debug, Serialize)]
pub struct WslDistro {
    pub name: String,
    pub path: String,
}

#[tauri::command(async)]
pub fn list_wsl_distros() -> Vec<WslDistro> {
    #[cfg_attr(not(windows), allow(unused_mut))]
    let mut out = Vec::new();
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let mut cmd = std::process::Command::new("wsl.exe");
        cmd.args(["--list", "--quiet"]);
        cmd.creation_flags(CREATE_NO_WINDOW);
        let output = match cmd.output() {
            Ok(o) if o.status.success() => o,
            _ => return out,
        };
        // `wsl.exe --list --quiet` emits UTF-16 LE (no BOM). Decode as u16
        // pairs, stripping NULs that appear as padding between chars.
        let bytes = output.stdout;
        let mut u16s: Vec<u16> = Vec::with_capacity(bytes.len() / 2);
        let mut i = 0;
        while i + 1 < bytes.len() {
            u16s.push(u16::from_le_bytes([bytes[i], bytes[i + 1]]));
            i += 2;
        }
        // Trim optional BOM (0xFEFF).
        let start = if u16s.first() == Some(&0xFEFF) { 1 } else { 0 };
        let decoded = String::from_utf16_lossy(&u16s[start..]);
        // Each non-empty, non-null line is a distro name; trim whitespace +
        // interior NULs (some wsl builds emit trailing NULs).
        for line in decoded.lines() {
            let name = line.trim_matches(|c: char| c == '\0' || c.is_whitespace());
            if name.is_empty() {
                continue;
            }
            let path = format!("\\\\wsl$\\{}\\", name);
            out.push(WslDistro {
                name: name.to_string(),
                path,
            });
        }
    }
    out
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
}
