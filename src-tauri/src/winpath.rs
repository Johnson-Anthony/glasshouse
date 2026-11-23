//! Windows path rules as pure functions over strings and UTF-16 units.
//!
//! Nothing here is behind `cfg(windows)`: Windows code can't be built or run
//! where the app is developed, so the rules are compiled and tested on every
//! platform, and the Win32 calls that use them stay thin (`to_verbatim`
//! below, `commands/listing.rs`, `commands/config.rs`, `pty/profiles.rs`).
//! Only Windows code calls most of them, hence the `dead_code` allowances.
//!
//! Two spellings of one path matter:
//! - the **plain** form people read and type: `C:\dir\file`,
//!   `\\server\share\file`. Win32 normalizes it (`/`, `.`, `..`, trailing
//!   dots) and, without the long-path opt-in, cuts it off at MAX_PATH;
//! - the **verbatim** form, `\\?\C:\dir\file` and `\\?\UNC\server\share\file`,
//!   which goes to the file system as written, at any length. `canonicalize`
//!   returns it.
//!
//! The app shows, saves and compares the plain form, and gives raw Win32 calls
//! the verbatim one. See `docs/decisions/2026-11-23-windows-paths-forms.md`.

use std::collections::HashMap;

const VERBATIM: &str = r"\\?\";

/// A mapped network drive: its letter (`Z:`) and the share it stands for
/// (`\\server\share`, or a folder below one).
pub type Share = (String, String);

fn is_sep(c: char) -> bool {
    c == '\\' || c == '/'
}

/// `name` is one of DOS's device names, which Win32 opens as the device
/// wherever the name appears: `CON`, `NUL.txt`, `com1`, `LPT¹`. What counts
/// is the part before the first dot, without trailing spaces.
pub fn is_device_name(name: &str) -> bool {
    let stem = name.split('.').next().unwrap_or("").trim_end_matches(' ');
    let upper = stem.to_uppercase();
    if matches!(upper.as_str(), "CON" | "PRN" | "AUX" | "NUL" | "CONIN$" | "CONOUT$") {
        return true;
    }
    let mut chars = upper.chars();
    let head: String = chars.by_ref().take(3).collect();
    match (head.as_str(), chars.next(), chars.next()) {
        ("COM" | "LPT", Some(n), None) => matches!(n, '1'..='9' | '¹' | '²' | '³'),
        _ => false,
    }
}

/// A path component that means the same in a plain path as in a verbatim
/// one: Win32 would drop a trailing dot or space, resolve `.` and `..`, and
/// open a device name as the device.
fn plain_safe(component: &str) -> bool {
    !component.is_empty()
        && !component.ends_with(['.', ' '])
        && !component.contains('/')
        && !is_device_name(component)
}

/// The plain form of a verbatim path: `\\?\C:\dir` → `C:\dir`,
/// `\\?\UNC\server\share\dir` → `\\server\share\dir`. `None` when `path`
/// isn't verbatim, or has no plain form that names the same file: a volume
/// GUID path, or a component Win32 would read differently (`plain_safe`).
/// Unlike `dunce`, length doesn't matter: std adds the prefix back for its
/// own calls, and `to_verbatim` does for ours.
pub fn plain(path: &str) -> Option<String> {
    let rest = path.strip_prefix(VERBATIM)?;
    let (root, tail) = if let Some(unc) = strip_prefix_ignore_case(rest, r"UNC\") {
        let mut parts = unc.splitn(3, '\\');
        let (server, share) = (parts.next()?, parts.next()?);
        if server.is_empty() || share.is_empty() {
            return None;
        }
        (format!(r"\\{server}\{share}"), parts.next().unwrap_or(""))
    } else {
        let mut chars = rest.chars();
        let (drive, colon) = (chars.next()?, chars.next()?);
        let tail = chars.as_str();
        if !drive.is_ascii_alphabetic() || colon != ':' || !(tail.is_empty() || tail.starts_with('\\')) {
            return None;
        }
        (format!("{drive}:"), tail.strip_prefix('\\').unwrap_or(""))
    };
    let tail = tail.trim_end_matches('\\');
    if tail.is_empty() {
        // A drive's root keeps its separator: `C:` alone is a relative path.
        return Some(if root.starts_with('\\') { root } else { root + "\\" });
    }
    tail.split('\\').all(plain_safe).then(|| format!(r"{root}\{tail}"))
}

/// `s` without `prefix`, compared character by character ignoring case, as
/// Windows compares names.
fn strip_prefix_ignore_case<'a>(s: &'a str, prefix: &str) -> Option<&'a str> {
    let mut rest = s.chars();
    for p in prefix.chars() {
        let c = rest.next()?;
        if c != p && !c.to_lowercase().eq(p.to_lowercase()) {
            return None;
        }
    }
    Some(rest.as_str())
}

/// The folder `list_dir` reads and joins entry names to, for a path as the
/// page sent it: the plain form of a verbatim path when there is one (so
/// paths saved from canonical listings open as people write them), `/` as
/// `\`, and a bare drive (`C:`, which Win32 reads as that drive's current
/// folder) as its root.
#[cfg_attr(not(windows), allow(dead_code))]
pub fn listing_base(path: &str) -> String {
    if path.starts_with(VERBATIM) {
        return plain(path).unwrap_or_else(|| path.to_string());
    }
    let mut out = path.replace('/', "\\");
    let bytes = out.as_bytes();
    if bytes.len() == 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' {
        out.push('\\');
    }
    out
}

/// Where Win32's own limit starts: MAX_PATH is 260 units with the NUL, but
/// `CreateDirectoryW` stops at 248, and std uses that for every call.
const LEGACY_MAX_PATH: usize = 248;

/// `path` (UTF-16, no NUL) as a raw Win32 file call should get it: unchanged
/// when it's short, already verbatim or not absolute; otherwise verbatim,
/// with the normalizing a verbatim path skips done here: `/` as `\`,
/// repeated separators, `.` and `..`. Trailing dots and spaces stay, so a
/// long path names exactly the entry a listing gave.
///
/// std does the same for its own calls (`maybe_verbatim`); this is for ours
/// (`MoveFileExW`, `CopyFileW`, `ReplaceFileW`), which would otherwise fail
/// past MAX_PATH unless the user has turned long paths on system-wide.
#[cfg_attr(not(windows), allow(dead_code))]
pub fn verbatim(path: &[u16]) -> Vec<u16> {
    const SEP: u16 = b'\\' as u16;
    const ALT: u16 = b'/' as u16;
    const DOT: u16 = b'.' as u16;
    const COLON: u16 = b':' as u16;
    const QUERY: u16 = b'?' as u16;
    let sep = |c: u16| c == SEP || c == ALT;
    let already = matches!(path, [SEP, SEP, QUERY, SEP, ..] | [SEP, QUERY, QUERY, SEP, ..]);
    if already || path.len() + 1 < LEGACY_MAX_PATH {
        return path.to_vec();
    }
    // The root as the verbatim form spells it, how many leading components
    // belong to it (a UNC path's server and share), and the rest.
    let (mut out, fixed, rest): (Vec<u16>, usize, &[u16]) = match path {
        [drive, COLON, s, rest @ ..] if sep(*s) && !sep(*drive) => {
            (r"\\?\".encode_utf16().chain([*drive, COLON]).collect(), 0, rest)
        }
        // `\\.\C:\x`, the device namespace: the same objects as `\\?\`.
        [a, b, DOT, c, rest @ ..] if sep(*a) && sep(*b) && sep(*c) => (r"\\?".encode_utf16().collect(), 0, rest),
        [a, b, rest @ ..] if sep(*a) && sep(*b) => (r"\\?\UNC".encode_utf16().collect(), 2, rest),
        // Relative, or relative to the current drive: left for the caller.
        _ => return path.to_vec(),
    };
    let mut parts: Vec<&[u16]> = Vec::new();
    for part in rest.split(|c| sep(*c)) {
        match part {
            [] | [DOT] => {}
            [DOT, DOT] => {
                if parts.len() > fixed {
                    parts.pop();
                }
            }
            _ => parts.push(part),
        }
    }
    if parts.is_empty() {
        out.push(SEP);
    }
    for part in parts {
        out.push(SEP);
        out.extend_from_slice(part);
    }
    out
}

/// `path` as a NUL-terminated wide string for a raw Win32 file call, made
/// absolute first (verbatim paths can't be relative) and verbatim when it's
/// long (`verbatim`).
#[cfg(windows)]
pub fn to_verbatim(path: &std::path::Path) -> Vec<u16> {
    use std::os::windows::ffi::OsStrExt;
    let absolute = if path.is_absolute() { None } else { std::path::absolute(path).ok() };
    let wide: Vec<u16> = absolute.as_deref().unwrap_or(path).as_os_str().encode_wide().collect();
    let mut out = verbatim(&wide);
    out.push(0);
    out
}

/// A path saved by a build whose listings were canonical, in the form
/// listings give now. Only the verbatim form is touched: `\\?\C:\long\path`
/// becomes `C:\long\path`, and `\\?\UNC\server\share\x` becomes `Z:\x` when
/// drive `Z:` is mapped to that share (how the folder was most likely
/// reached), else `\\server\share\x`. `None` when `path` stays as it is.
#[cfg_attr(not(windows), allow(dead_code))]
pub fn saved_form(path: &str, shares: &[Share]) -> Option<String> {
    let plain = plain(path)?;
    if !plain.starts_with(r"\\") {
        return Some(plain);
    }
    // What's left of `plain` below `share`, when it is at or below it.
    let below = |share: &str| {
        strip_prefix_ignore_case(&plain, share.trim_end_matches(is_sep))
            .filter(|tail| tail.is_empty() || tail.starts_with('\\'))
    };
    // The deepest share wins: `Y:` on `\\nas\media\films` over `Z:` on `\\nas\media`.
    let best = shares
        .iter()
        .filter_map(|(letter, share)| below(share).map(|tail| (letter, tail)))
        .min_by_key(|(_, tail)| tail.len());
    let mapped = best.map(|(letter, tail)| {
        format!("{}{}", letter.trim_end_matches(is_sep), if tail.is_empty() { "\\" } else { tail })
    });
    Some(mapped.unwrap_or(plain))
}

/// A saved path whose new form needs the mapped drives (`saved_form`), so
/// they're only asked for when one is there.
#[cfg_attr(not(windows), allow(dead_code))]
pub fn wants_shares(path: &str) -> bool {
    path.strip_prefix(VERBATIM).is_some_and(|rest| strip_prefix_ignore_case(rest, r"UNC\").is_some())
}

/// Saved paths (pins, recents) in today's form, in order, each once; `None`
/// when none changes.
#[cfg_attr(not(windows), allow(dead_code))]
pub fn saved_paths(paths: &[String], shares: &[Share]) -> Option<Vec<String>> {
    if !paths.iter().any(|p| p.starts_with(VERBATIM)) {
        return None;
    }
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::with_capacity(paths.len());
    let mut changed = false;
    for path in paths {
        let now = match saved_form(path, shares) {
            Some(new) => {
                changed = true;
                new
            }
            None => path.clone(),
        };
        if seen.insert(now.to_lowercase()) {
            out.push(now);
        }
    }
    changed.then_some(out)
}

/// The saved tags, keyed by path, with every key in today's form; `None`
/// when no key changes. Where an old key lands on one that's already there
/// (the same file tagged before and after an update), the labels are
/// joined, the existing key's first.
#[cfg_attr(not(windows), allow(dead_code))]
pub fn saved_tags(tags: &HashMap<String, Vec<String>>, shares: &[Share]) -> Option<HashMap<String, Vec<String>>> {
    let mut moved: Vec<(String, &Vec<String>)> = Vec::new();
    let mut out: HashMap<String, Vec<String>> = HashMap::new();
    for (key, labels) in tags {
        match saved_form(key, shares) {
            Some(new) => moved.push((new, labels)),
            None => {
                out.insert(key.clone(), labels.clone());
            }
        }
    }
    if moved.is_empty() {
        return None;
    }
    // In key order, so two old keys for one file always merge the same way.
    moved.sort();
    for (new, labels) in moved {
        // Keys compare without case on Windows, and the spelling already
        // there stays.
        let key = out.keys().find(|k| k.to_lowercase() == new.to_lowercase()).cloned().unwrap_or(new);
        let have = out.entry(key).or_default();
        for label in labels {
            if !have.contains(label) {
                have.push(label.clone());
            }
        }
    }
    Some(out)
}

/// `bash.exe` at `path` is WSL's launcher, not a shell of its own: the one in
/// System32 (first on PATH on most PCs), or the Store's app alias. It starts
/// the default WSL distro, which already has its own terminal profile, and
/// prints an install hint when there's none.
#[cfg_attr(not(windows), allow(dead_code))]
pub fn is_wsl_bash(path: &str) -> bool {
    let lower = path.replace('/', "\\").to_lowercase();
    let Some(dir) = lower.strip_suffix(r"\bash.exe") else {
        return false;
    };
    [r"\system32", r"\sysnative", r"\syswow64", r"\microsoft\windowsapps"].iter().any(|d| dir.ends_with(d))
}

#[cfg(test)]
#[path = "winpath_tests.rs"]
mod tests;
