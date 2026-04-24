//! Resolve a Windows terminal-launch strategy once per session.
//!
//! Strategy resolution order:
//!   1. `GLASSHOUSE_TERMINAL` env var (`<path>[:preset]`, preset ∈ `wt`,
//!      `direct`). A bare `direct` forces `DelegatedConsole`. Any other
//!      value is interpreted as an explicit binary path whose preset (if
//!      omitted) is inferred from the filename stem.
//!   2. Registry: `HKCU\Console\%%Startup\DelegationTerminal` → CLSID →
//!      `HKLM\SOFTWARE\Classes\CLSID\{GUID}\LocalServer32`. If the exe
//!      stem matches a wt-compatible name, record `WtCompatible`; else
//!      `DelegatedConsole`.
//!   3. `which::which` for `wt.exe`, `wt`, `wtd.exe`, `wtd`.
//!   4. `DelegatedConsole` (Windows spawns a new console and delegates).

#![cfg(windows)]

use std::path::PathBuf;
use std::sync::OnceLock;

#[derive(Debug, Clone)]
pub enum TerminalStrategy {
    /// Windows-Terminal-compatible CLI: `<bin> -w 0 new-tab --startingDirectory ...`.
    WtCompatible(PathBuf),
    /// Spawn the shell directly with `CREATE_NEW_CONSOLE`; Windows hands
    /// off to whichever terminal (if any) is registered as the default.
    DelegatedConsole,
}

const WT_STEMS: &[&str] = &["wt", "wtd", "windowsterminal", "terminal"];

static CACHE: OnceLock<TerminalStrategy> = OnceLock::new();

pub fn resolve_terminal_strategy() -> TerminalStrategy {
    CACHE.get_or_init(probe).clone()
}

fn probe() -> TerminalStrategy {
    if let Some(s) = probe_env() {
        return s;
    }
    if let Some(s) = probe_registry() {
        return s;
    }
    if let Some(s) = probe_which() {
        return s;
    }
    TerminalStrategy::DelegatedConsole
}

fn probe_env() -> Option<TerminalStrategy> {
    let raw = std::env::var("GLASSHOUSE_TERMINAL").ok()?;
    let raw = raw.trim();
    if raw.is_empty() {
        return None;
    }
    if raw.eq_ignore_ascii_case("direct") {
        return Some(TerminalStrategy::DelegatedConsole);
    }
    // Split on the LAST colon so Windows drive letters (C:\...) survive.
    let (path_part, preset) = match raw.rsplit_once(':') {
        Some((p, suffix))
            if suffix.eq_ignore_ascii_case("wt") || suffix.eq_ignore_ascii_case("direct") =>
        {
            (p, Some(suffix.to_ascii_lowercase()))
        }
        _ => (raw, None),
    };
    let path = PathBuf::from(path_part);
    match preset.as_deref() {
        Some("direct") => Some(TerminalStrategy::DelegatedConsole),
        // Explicit `:wt` preset OR no preset — treat the supplied binary as
        // wt-compatible CLI. Users who want CREATE_NEW_CONSOLE on a custom
        // terminal should use the bare `GLASSHOUSE_TERMINAL=direct` form.
        _ => Some(TerminalStrategy::WtCompatible(path)),
    }
}

fn probe_registry() -> Option<TerminalStrategy> {
    use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
    use winreg::RegKey;

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    // Note: the subkey name literally contains `%%Startup` on Windows.
    let console = hkcu.open_subkey(r"Console\%%Startup").ok()?;
    let guid: String = console.get_value("DelegationTerminal").ok()?;
    let guid = guid.trim();
    if !is_valid_guid(guid) {
        return None;
    }
    // Zero-GUID means "let the system pick" — no explicit delegation.
    if guid.trim_matches(|c| c == '{' || c == '}' || c == '-' || c == '0').is_empty() {
        return None;
    }

    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
    let clsid_path = format!(r"SOFTWARE\Classes\CLSID\{}\LocalServer32", guid);
    let clsid = hklm.open_subkey(&clsid_path).ok()?;
    // Default value is the empty-string name in winreg.
    let raw: String = clsid.get_value("").ok()?;
    let exe = parse_local_server_exe(&raw)?;

    if is_wt_compatible_stem(&exe) {
        Some(TerminalStrategy::WtCompatible(exe))
    } else {
        Some(TerminalStrategy::DelegatedConsole)
    }
}

fn probe_which() -> Option<TerminalStrategy> {
    for candidate in ["wt.exe", "wt", "wtd.exe", "wtd"] {
        if let Ok(p) = which::which(candidate) {
            return Some(TerminalStrategy::WtCompatible(p));
        }
    }
    None
}

fn is_valid_guid(s: &str) -> bool {
    let t = s.trim();
    let inner = t.strip_prefix('{').and_then(|x| x.strip_suffix('}')).unwrap_or(t);
    let parts: Vec<&str> = inner.split('-').collect();
    if parts.len() != 5 {
        return false;
    }
    let lens = [8usize, 4, 4, 4, 12];
    for (p, want) in parts.iter().zip(lens.iter()) {
        if p.len() != *want || !p.chars().all(|c| c.is_ascii_hexdigit()) {
            return false;
        }
    }
    true
}

/// `LocalServer32` default values can be quoted, unquoted, and may carry
/// trailing args. Extract just the exe path.
fn parse_local_server_exe(raw: &str) -> Option<PathBuf> {
    let raw = raw.trim();
    if raw.is_empty() {
        return None;
    }
    let first = if let Some(rest) = raw.strip_prefix('"') {
        let end = rest.find('"')?;
        &rest[..end]
    } else {
        // First whitespace-separated token.
        raw.split_whitespace().next()?
    };
    if first.is_empty() {
        None
    } else {
        Some(PathBuf::from(first))
    }
}

fn is_wt_compatible_stem(path: &std::path::Path) -> bool {
    let stem = path
        .file_stem()
        .and_then(|s| s.to_str())
        .map(|s| s.to_ascii_lowercase())
        .unwrap_or_default();
    WT_STEMS.iter().any(|w| *w == stem)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_quoted_local_server() {
        let p = parse_local_server_exe(r#""C:\Program Files\WindowsApps\Foo\wt.exe" -embedding"#)
            .unwrap();
        assert_eq!(p, PathBuf::from(r"C:\Program Files\WindowsApps\Foo\wt.exe"));
    }

    #[test]
    fn parses_unquoted_local_server() {
        let p = parse_local_server_exe(r"C:\tools\terminal.exe /RegServer").unwrap();
        assert_eq!(p, PathBuf::from(r"C:\tools\terminal.exe"));
    }

    #[test]
    fn detects_wt_stems() {
        assert!(is_wt_compatible_stem(std::path::Path::new(r"C:\x\wt.exe")));
        assert!(is_wt_compatible_stem(std::path::Path::new(r"C:\x\WindowsTerminal.exe")));
        assert!(is_wt_compatible_stem(std::path::Path::new(r"C:\x\Terminal.EXE")));
        assert!(!is_wt_compatible_stem(std::path::Path::new(r"C:\x\alacritty.exe")));
    }

    #[test]
    fn guid_validator() {
        assert!(is_valid_guid("{B23D10C0-E52E-411E-9D5B-C09FDF709C7D}"));
        assert!(is_valid_guid("B23D10C0-E52E-411E-9D5B-C09FDF709C7D"));
        assert!(!is_valid_guid("not-a-guid"));
        assert!(!is_valid_guid(""));
    }
}
