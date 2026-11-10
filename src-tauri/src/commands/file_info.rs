use serde::Serialize;
use std::path::Path;
#[cfg(windows)]
use super::launch::CREATE_NO_WINDOW;

// ---------- hex dump ----------

/// Read up to `length` bytes starting at `offset` from `path` and return a
/// human-readable hex dump (16 bytes/row, offset + hex + ascii). `length` is
/// capped at 64 KiB; `0` becomes the default of 4096 bytes.
#[tauri::command(async)]
pub fn read_hex_dump(path: String, offset: u64, length: usize) -> Result<String, String> {
    use std::fmt::Write as FmtWrite;
    use std::io::{Read, Seek, SeekFrom};

    let cap = if length == 0 { 4096 } else { length.min(64 * 1024) };
    let mut f = std::fs::File::open(&path).map_err(|e| format!("open {}: {}", path, e))?;
    f.seek(SeekFrom::Start(offset))
        .map_err(|e| format!("seek {}: {}", path, e))?;
    let mut buf = Vec::with_capacity(cap);
    f.take(cap as u64)
        .read_to_end(&mut buf)
        .map_err(|e| format!("read {}: {}", path, e))?;

    let mut out = String::with_capacity(buf.len() * 4);
    for (i, chunk) in buf.chunks(16).enumerate() {
        let row_off = offset + (i as u64) * 16;
        let _ = write!(&mut out, "{:08x}  ", row_off);
        for (j, b) in chunk.iter().enumerate() {
            if j > 0 {
                out.push(' ');
            }
            let _ = write!(&mut out, "{:02x}", b);
        }
        // Pad short final row so ascii column aligns.
        if chunk.len() < 16 {
            for j in chunk.len()..16 {
                if j > 0 {
                    out.push(' ');
                }
                out.push_str("  ");
            }
        }
        out.push_str("  |");
        for b in chunk {
            let c = *b;
            if (0x20..=0x7e).contains(&c) {
                out.push(c as char);
            } else {
                out.push('.');
            }
        }
        out.push_str("|\n");
    }
    Ok(out)
}

// ---------- diff ----------

/// Return a unified diff between two utf-8 text files. Errors with
/// "binary or non-utf8" if either file cannot be decoded. An empty diff
/// (identical content) returns an empty string.
#[tauri::command(async)]
pub fn diff_files(a: String, b: String) -> Result<String, String> {
    let a_bytes = std::fs::read(&a).map_err(|e| format!("read {}: {}", a, e))?;
    let b_bytes = std::fs::read(&b).map_err(|e| format!("read {}: {}", b, e))?;
    let a_text = std::str::from_utf8(&a_bytes)
        .map_err(|_| "binary or non-utf8".to_string())?;
    let b_text = std::str::from_utf8(&b_bytes)
        .map_err(|_| "binary or non-utf8".to_string())?;

    let a_name = Path::new(&a)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or(&a);
    let b_name = Path::new(&b)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or(&b);

    let diff = similar::TextDiff::from_lines(a_text, b_text);
    Ok(diff.unified_diff().header(a_name, b_name).to_string())
}

// ---------- verify signature ----------

/// Verify the Authenticode signature on `path`. Returns "valid", "invalid",
/// or "unsigned". Windows only; shells out to PowerShell Get-AuthenticodeSignature
/// to avoid hand-rolling WinVerifyTrust bindings.
#[tauri::command(async)]
pub fn verify_signature(path: String) -> Result<String, String> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        use std::process::Command;

        // The path goes in through an environment variable, never into the
        // script text (see create_shortcut). -LiteralPath: no wildcards.
        let script = "(Get-AuthenticodeSignature -LiteralPath $env:GLASSHOUSE_PATH).Status";
        let out = Command::new("powershell.exe")
            .args(["-NoProfile", "-NonInteractive", "-Command", script])
            .env("GLASSHOUSE_PATH", &path)
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .map_err(|e| format!("powershell: {}", e))?;
        if !out.status.success() {
            let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
            return Err(format!("verify_signature: {}", stderr));
        }
        let status = String::from_utf8_lossy(&out.stdout).trim().to_string();
        let result = match status.as_str() {
            "Valid" => "valid",
            "NotSigned" | "MissingSignature" => "unsigned",
            _ => "invalid",
        };
        Ok(result.to_string())
    }
    #[cfg(not(windows))]
    {
        let _ = path;
        Err("verify_signature: windows only".into())
    }
}

// ---------- extended file stat ----------

#[derive(Debug, Serialize, Default)]
pub struct FileStatExt {
    pub created_ms: Option<i64>,
    pub modified_ms: Option<i64>,
    pub owner: Option<String>,
    pub file_index: Option<u64>,
    pub readonly: bool,
    pub is_symlink: bool,
    pub symlink_target: Option<String>,
}

pub(super) fn system_time_to_ms(t: std::time::SystemTime) -> Option<i64> {
    t.duration_since(std::time::UNIX_EPOCH)
        .ok()
        .map(|d| d.as_millis() as i64)
}

#[tauri::command(async)]
pub fn file_stat_extended(path: String) -> Result<FileStatExt, String> {
    let md = std::fs::symlink_metadata(&path).map_err(|e| format!("stat {}: {}", path, e))?;
    let mut out = FileStatExt {
        readonly: md.permissions().readonly(),
        is_symlink: md.file_type().is_symlink(),
        ..Default::default()
    };
    out.created_ms = md.created().ok().and_then(system_time_to_ms);
    out.modified_ms = md.modified().ok().and_then(system_time_to_ms);
    if out.is_symlink {
        if let Ok(target) = std::fs::read_link(&path) {
            out.symlink_target = Some(target.to_string_lossy().to_string());
        }
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        out.file_index = Some(md.ino());
        out.owner = Some(format!("{}:{}", md.uid(), md.gid()));
    }

    #[cfg(windows)]
    {
        // Best-effort: file index via GetFileInformationByHandle.
        use windows::core::PCWSTR;
        use windows::Win32::Foundation::{CloseHandle, HANDLE};
        use windows::Win32::Storage::FileSystem::{
            CreateFileW, GetFileInformationByHandle, BY_HANDLE_FILE_INFORMATION,
            FILE_FLAG_BACKUP_SEMANTICS, FILE_GENERIC_READ, FILE_SHARE_DELETE, FILE_SHARE_READ,
            FILE_SHARE_WRITE, OPEN_EXISTING,
        };
        unsafe {
            let wide: Vec<u16> = path.encode_utf16().chain(std::iter::once(0)).collect();
            let handle = CreateFileW(
                PCWSTR(wide.as_ptr()),
                FILE_GENERIC_READ.0,
                FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
                None,
                OPEN_EXISTING,
                FILE_FLAG_BACKUP_SEMANTICS,
                HANDLE::default(),
            );
            if let Ok(h) = handle {
                let mut info = BY_HANDLE_FILE_INFORMATION::default();
                if GetFileInformationByHandle(h, &mut info).is_ok() {
                    let idx = ((info.nFileIndexHigh as u64) << 32) | info.nFileIndexLow as u64;
                    out.file_index = Some(idx);
                }
                let _ = CloseHandle(h);
            }
        }
        // Owner: GetSecurityInfo + LookupAccountSidW (best-effort).
        out.owner = win_file_owner(&path);
    }

    Ok(out)
}

#[cfg(windows)]
fn win_file_owner(path: &str) -> Option<String> {
    use windows::core::PCWSTR;
    use windows::Win32::Security::Authorization::{GetNamedSecurityInfoW, SE_FILE_OBJECT};
    use windows::Win32::Security::{
        LookupAccountSidW, OWNER_SECURITY_INFORMATION, PSID, SID_NAME_USE,
    };
    unsafe {
        let wide: Vec<u16> = path.encode_utf16().chain(std::iter::once(0)).collect();
        let mut psid_owner: PSID = PSID::default();
        let mut psd = windows::Win32::Security::PSECURITY_DESCRIPTOR::default();
        let err = GetNamedSecurityInfoW(
            PCWSTR(wide.as_ptr()),
            SE_FILE_OBJECT,
            OWNER_SECURITY_INFORMATION,
            Some(&mut psid_owner as *mut _),
            None,
            None,
            None,
            &mut psd as *mut _,
        );
        if err.0 != 0 {
            return None;
        }
        let mut name_buf = [0u16; 256];
        let mut domain_buf = [0u16; 256];
        let mut name_len = name_buf.len() as u32;
        let mut domain_len = domain_buf.len() as u32;
        let mut sid_use = SID_NAME_USE::default();
        let looked = LookupAccountSidW(
            PCWSTR::null(),
            psid_owner,
            windows::core::PWSTR(name_buf.as_mut_ptr()),
            &mut name_len,
            windows::core::PWSTR(domain_buf.as_mut_ptr()),
            &mut domain_len,
            &mut sid_use,
        );
        // Free the descriptor allocated by GetNamedSecurityInfoW.
        let _ = windows::Win32::Foundation::LocalFree(windows::Win32::Foundation::HLOCAL(
            psd.0 as _,
        ));
        if looked.is_err() {
            return None;
        }
        let name =
            String::from_utf16_lossy(&name_buf[..name_buf.iter().position(|&c| c == 0).unwrap_or(0)]);
        let domain = String::from_utf16_lossy(
            &domain_buf[..domain_buf.iter().position(|&c| c == 0).unwrap_or(0)],
        );
        if domain.is_empty() {
            Some(name)
        } else {
            Some(format!("{}\\{}", domain, name))
        }
    }
}
