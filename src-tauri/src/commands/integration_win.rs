//! Preferences → Integration on Windows: "Open folders with glasshouse".
//!
//! `HKCU\Software\Classes\Directory\shell` and `…\Drive\shell` get a
//! `glasshouse` verb (`"glasshouse.exe" "%1"`) and make it their default
//! verb, as the Files app and Directory Opus do; HKCU wins over HKLM. The
//! default it replaced is kept as a value on our verb key, so turning it
//! off and the NSIS and MSI uninstallers (`windows/hooks.nsh`,
//! `windows/integration.wxs`) can put it back without any other record.
//!
//! Virtual folders (This PC, Recycle Bin, Control Panel) aren't Directory
//! or Drive, so they stay Explorer's. So do Win+E and Explorer's own "Show
//! in folder" (SHOpenFolderAndSelectItems), which nothing can redirect.
//!
//! The registry changes are planned by pure functions, tested on every
//! platform; only `reg` touches the registry. See
//! docs/decisions/2026-11-20-folder-handler-integration.md.
#![cfg_attr(not(windows), allow(dead_code))]

pub(crate) const VERB: &str = "glasshouse";
/// The keys under HKCU whose default verb we set.
pub(crate) const SHELL_KEYS: [&str; 2] = [r"Software\Classes\Directory\shell", r"Software\Classes\Drive\shell"];
/// On our verb key: the default verb it replaced. The uninstallers read it.
pub(crate) const PREVIOUS: &str = "GlasshousePreviousDefault";

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum RegOp {
    /// A string value under HKCU (`name` None: the key's default value);
    /// the key is made if it's missing.
    Set { key: String, name: Option<&'static str>, value: String },
    DeleteValue { key: String, name: Option<&'static str> },
    /// A key and everything under it.
    DeleteTree { key: String },
    /// A key, if it has no values and no subkeys left.
    DeleteIfEmpty { key: String },
}

/// One shell key as it is now.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct ShellKey {
    /// Its default value: the default verb.
    pub default_verb: Option<String>,
    /// `PREVIOUS` on our verb key, when the verb is there.
    pub saved_previous: Option<String>,
    /// Our verb's command line, when it's there.
    pub command: Option<String>,
}

fn verb_key(shell: &str) -> String {
    format!(r"{shell}\{VERB}")
}

/// An empty value reads the same as no value (to the shell and to NSIS's
/// ReadRegStr), so it's put back as none.
fn nonempty(v: Option<&str>) -> Option<String> {
    v.filter(|s| !s.is_empty()).map(String::from)
}

/// What Explorer runs for a folder. `"%1"` for a drive is `"C:\"`, which
/// reaches us as `C:"` (`startup::fix_windows_quote`).
pub(crate) fn command_line(exe: &str) -> String {
    format!("\"{exe}\" \"%1\"")
}

/// Turning on, for the shell keys as they are now (`SHELL_KEYS` order).
pub(crate) fn on_ops(exe: &str, now: &[ShellKey; 2]) -> Vec<RegOp> {
    let mut ops = Vec::new();
    for (shell, state) in SHELL_KEYS.iter().zip(now) {
        let verb = verb_key(shell);
        // Already ours (on twice): what we replaced the first time.
        let previous = if state.default_verb.as_deref() == Some(VERB) {
            nonempty(state.saved_previous.as_deref())
        } else {
            nonempty(state.default_verb.as_deref())
        };
        ops.push(RegOp::Set { key: verb.clone(), name: None, value: "Open in glasshouse".into() });
        ops.push(RegOp::Set { key: verb.clone(), name: Some("Icon"), value: format!("{exe},0") });
        ops.push(RegOp::Set { key: format!(r"{verb}\command"), name: None, value: command_line(exe) });
        ops.push(match previous {
            Some(p) => RegOp::Set { key: verb.clone(), name: Some(PREVIOUS), value: p },
            None => RegOp::DeleteValue { key: verb, name: Some(PREVIOUS) },
        });
        ops.push(RegOp::Set { key: shell.to_string(), name: None, value: VERB.into() });
    }
    ops
}

/// Turning off. A default verb someone set since is left alone.
pub(crate) fn off_ops(now: &[ShellKey; 2]) -> Vec<RegOp> {
    let mut ops = Vec::new();
    for (shell, state) in SHELL_KEYS.iter().zip(now) {
        if state.default_verb.as_deref() == Some(VERB) {
            ops.push(match nonempty(state.saved_previous.as_deref()) {
                Some(p) => RegOp::Set { key: shell.to_string(), name: None, value: p },
                None => RegOp::DeleteValue { key: shell.to_string(), name: None },
            });
        }
        ops.push(RegOp::DeleteTree { key: verb_key(shell) });
        // Made by turning on, most likely; nothing in them means nothing lost.
        ops.push(RegOp::DeleteIfEmpty { key: shell.to_string() });
        if let Some((class, _)) = shell.rsplit_once('\\') {
            ops.push(RegOp::DeleteIfEmpty { key: class.to_string() });
        }
    }
    ops
}

/// On: every shell key's default verb is ours.
pub(crate) fn is_on(now: &[ShellKey; 2]) -> bool {
    now.iter().all(|k| k.default_verb.as_deref() == Some(VERB))
}

/// The program our verb runs, from its command line.
pub(crate) fn command_program(command: &str) -> Option<&str> {
    command.strip_prefix('"')?.split_once('"').map(|(p, _)| p)
}

#[cfg(windows)]
pub(crate) mod reg {
    //! The registry calls, all under HKEY_CURRENT_USER.
    use super::{RegOp, ShellKey, PREVIOUS, SHELL_KEYS, VERB};
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::{ERROR_FILE_NOT_FOUND, ERROR_SUCCESS, WIN32_ERROR};
    use windows::Win32::System::Registry::{
        RegCloseKey, RegDeleteKeyValueW, RegDeleteKeyW, RegDeleteTreeW, RegGetValueW, RegOpenKeyExW,
        RegQueryInfoKeyW, RegSetKeyValueW, HKEY, HKEY_CURRENT_USER, KEY_READ, REG_SZ, RRF_RT_REG_SZ,
    };
    use windows::Win32::UI::Shell::{SHChangeNotify, SHCNE_ASSOCCHANGED, SHCNF_IDLIST};

    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(Some(0)).collect()
    }

    fn name_ptr(w: &Option<Vec<u16>>) -> PCWSTR {
        w.as_ref().map_or(PCWSTR::null(), |w| PCWSTR(w.as_ptr()))
    }

    fn check(what: &str, key: &str, e: WIN32_ERROR) -> Result<(), String> {
        if e == ERROR_SUCCESS || e == ERROR_FILE_NOT_FOUND {
            Ok(())
        } else {
            Err(format!("{what} HKCU\\{key}: {}", windows::core::Error::from(e.to_hresult()).message()))
        }
    }

    /// A string value, or None if the key or value is missing.
    pub fn read(key: &str, name: Option<&str>) -> Option<String> {
        let k = wide(key);
        let n = name.map(wide);
        let mut len = 0u32;
        // SAFETY: the strings are NUL-terminated and outlive the calls; the
        // buffer is `len` bytes, as the first call reported.
        unsafe {
            let e = RegGetValueW(HKEY_CURRENT_USER, PCWSTR(k.as_ptr()), name_ptr(&n), RRF_RT_REG_SZ, None, None, Some(&mut len));
            if e != ERROR_SUCCESS {
                return None;
            }
            let mut buf = vec![0u16; (len as usize).div_ceil(2)];
            let e = RegGetValueW(
                HKEY_CURRENT_USER,
                PCWSTR(k.as_ptr()),
                name_ptr(&n),
                RRF_RT_REG_SZ,
                None,
                Some(buf.as_mut_ptr().cast()),
                Some(&mut len),
            );
            if e != ERROR_SUCCESS {
                return None;
            }
            let end = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
            Some(String::from_utf16_lossy(&buf[..end]))
        }
    }

    pub fn shell_keys() -> [ShellKey; 2] {
        SHELL_KEYS.map(|shell| {
            let verb = format!(r"{shell}\{VERB}");
            ShellKey {
                default_verb: read(shell, None),
                saved_previous: read(&verb, Some(PREVIOUS)),
                command: read(&format!(r"{verb}\command"), None),
            }
        })
    }

    fn is_empty(key: &str) -> bool {
        let k = wide(key);
        let mut h = HKEY::default();
        // SAFETY: `h` is closed below; the counts are plain out-params.
        unsafe {
            if RegOpenKeyExW(HKEY_CURRENT_USER, PCWSTR(k.as_ptr()), 0, KEY_READ, &mut h) != ERROR_SUCCESS {
                return false;
            }
            let (mut subkeys, mut values) = (0u32, 0u32);
            let e = RegQueryInfoKeyW(
                h,
                windows::core::PWSTR::null(),
                None,
                None,
                Some(&mut subkeys),
                None,
                None,
                Some(&mut values),
                None,
                None,
                None,
                None,
            );
            let _ = RegCloseKey(h);
            e == ERROR_SUCCESS && subkeys == 0 && values == 0
        }
    }

    pub fn apply(ops: &[RegOp]) -> Result<(), String> {
        for op in ops {
            // SAFETY: every string is NUL-terminated and outlives its call.
            unsafe {
                match op {
                    RegOp::Set { key, name, value } => {
                        let (k, n, v) = (wide(key), name.map(wide), wide(value));
                        let bytes = (v.len() * 2) as u32;
                        let e = RegSetKeyValueW(HKEY_CURRENT_USER, PCWSTR(k.as_ptr()), name_ptr(&n), REG_SZ.0, Some(v.as_ptr().cast()), bytes);
                        check("can't write", key, e)?;
                    }
                    RegOp::DeleteValue { key, name } => {
                        let (k, n) = (wide(key), name.map(wide));
                        check("can't change", key, RegDeleteKeyValueW(HKEY_CURRENT_USER, PCWSTR(k.as_ptr()), name_ptr(&n)))?;
                    }
                    RegOp::DeleteTree { key } => {
                        let k = wide(key);
                        check("can't remove", key, RegDeleteTreeW(HKEY_CURRENT_USER, PCWSTR(k.as_ptr())))?;
                        // RegDeleteTreeW empties the key; this removes it.
                        check("can't remove", key, RegDeleteKeyW(HKEY_CURRENT_USER, PCWSTR(k.as_ptr())))?;
                    }
                    RegOp::DeleteIfEmpty { key } => {
                        if is_empty(key) {
                            let k = wide(key);
                            check("can't remove", key, RegDeleteKeyW(HKEY_CURRENT_USER, PCWSTR(k.as_ptr())))?;
                        }
                    }
                }
            }
        }
        // Explorer caches verbs; this tells it the associations changed.
        // SAFETY: no items are passed.
        unsafe { SHChangeNotify(SHCNE_ASSOCCHANGED, SHCNF_IDLIST, None, None) };
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const EXE: &str = r"C:\Program Files\glasshouse\glasshouse.exe";

    fn set(key: &str, name: Option<&'static str>, value: &str) -> RegOp {
        RegOp::Set { key: key.into(), name, value: value.into() }
    }

    #[test]
    fn on_adds_the_verb_and_keeps_the_old_default() {
        let now = [ShellKey { default_verb: Some("openinfiles".into()), ..Default::default() }, ShellKey::default()];
        let ops = on_ops(EXE, &now);
        let dir = r"Software\Classes\Directory\shell";
        let dir_verb = r"Software\Classes\Directory\shell\glasshouse";
        let drive_verb = r"Software\Classes\Drive\shell\glasshouse";
        assert_eq!(&ops[..5], &[
            set(dir_verb, None, "Open in glasshouse"),
            set(dir_verb, Some("Icon"), &format!("{EXE},0")),
            set(&format!(r"{dir_verb}\command"), None, &format!("\"{EXE}\" \"%1\"")),
            set(dir_verb, Some(PREVIOUS), "openinfiles"),
            set(dir, None, "glasshouse"),
        ]);
        // Nothing was the Drive default: no previous value to keep.
        assert_eq!(ops[8], RegOp::DeleteValue { key: drive_verb.into(), name: Some(PREVIOUS) });
        assert_eq!(ops[9], set(r"Software\Classes\Drive\shell", None, "glasshouse"));
    }

    #[test]
    fn on_twice_keeps_the_first_previous_default() {
        let now = [
            ShellKey { default_verb: Some(VERB.into()), saved_previous: Some("openinfiles".into()), command: None },
            ShellKey { default_verb: Some(VERB.into()), saved_previous: None, command: None },
        ];
        let ops = on_ops(EXE, &now);
        assert!(ops.contains(&set(r"Software\Classes\Directory\shell\glasshouse", Some(PREVIOUS), "openinfiles")));
        assert!(ops.contains(&RegOp::DeleteValue { key: r"Software\Classes\Drive\shell\glasshouse".into(), name: Some(PREVIOUS) }));
    }

    #[test]
    fn off_puts_the_default_back_and_removes_the_verb() {
        let now = [
            ShellKey { default_verb: Some(VERB.into()), saved_previous: Some("openinfiles".into()), command: None },
            ShellKey { default_verb: Some(VERB.into()), saved_previous: Some(String::new()), command: None },
        ];
        assert_eq!(off_ops(&now), [
            set(r"Software\Classes\Directory\shell", None, "openinfiles"),
            RegOp::DeleteTree { key: r"Software\Classes\Directory\shell\glasshouse".into() },
            RegOp::DeleteIfEmpty { key: r"Software\Classes\Directory\shell".into() },
            RegOp::DeleteIfEmpty { key: r"Software\Classes\Directory".into() },
            RegOp::DeleteValue { key: r"Software\Classes\Drive\shell".into(), name: None },
            RegOp::DeleteTree { key: r"Software\Classes\Drive\shell\glasshouse".into() },
            RegOp::DeleteIfEmpty { key: r"Software\Classes\Drive\shell".into() },
            RegOp::DeleteIfEmpty { key: r"Software\Classes\Drive".into() },
        ]);
    }

    #[test]
    fn off_leaves_a_default_someone_set_since() {
        let now = [ShellKey { default_verb: Some("openinfiles".into()), saved_previous: Some("x".into()), command: None }, ShellKey::default()];
        let ops = off_ops(&now);
        assert!(!ops.iter().any(|o| matches!(o, RegOp::Set { .. } | RegOp::DeleteValue { .. })));
        assert!(ops.contains(&RegOp::DeleteTree { key: r"Software\Classes\Directory\shell\glasshouse".into() }));
    }

    #[test]
    fn on_means_both_keys() {
        let ours = ShellKey { default_verb: Some(VERB.into()), ..Default::default() };
        assert!(is_on(&[ours.clone(), ours.clone()]));
        assert!(!is_on(&[ours, ShellKey::default()]));
    }

    #[test]
    fn the_program_comes_out_of_the_command() {
        assert_eq!(command_program(&command_line(EXE)), Some(EXE));
        assert_eq!(command_program("notquoted %1"), None);
    }
}
