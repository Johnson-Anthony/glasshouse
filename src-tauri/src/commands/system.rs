use serde::Serialize;
#[cfg(target_os = "linux")]
use std::collections::HashMap;
#[cfg(target_os = "linux")]
use std::path::{Path, PathBuf};

#[derive(Debug, Serialize)]
pub struct SystemInfo {
    pub cpu_pct: f32,
    pub mem_pct: f32,
    pub mem_used: u64,
    pub mem_total: u64,
    pub uptime_s: u64,
    pub host: String,
}

#[derive(Debug, Serialize)]
pub struct Drive {
    pub letter: String,
    pub label: String,
    pub total: u64,
    pub free: u64,
    pub fs: String,
}

#[tauri::command(async)]
pub fn drives() -> Vec<Drive> {
    let mut out = Vec::new();
    #[cfg(windows)]
    for l in super::drive_letters::letters() {
        out.push(Drive {
            letter: l.root,
            label: l.label,
            total: l.total,
            free: l.free,
            fs: l.fs,
        });
    }
    #[cfg(not(windows))]
    {
        // Mounted filesystems stand in for drive letters. sysinfo already
        // filters to real block-device mounts, so no /proc pseudo-fs noise.
        use sysinfo::Disks;
        let disks = Disks::new_with_refreshed_list();
        #[cfg(target_os = "linux")]
        let labels = labels_by_device(Path::new("/dev/disk/by-label"));
        let mut seen = std::collections::HashSet::new();
        for d in disks.list() {
            let mount = d.mount_point().to_string_lossy().into_owned();
            if !seen.insert(mount.clone()) {
                continue;
            }
            // On Linux sysinfo's name() is the device ("/dev/nvme0n1p6"), not
            // a label. Unlabeled filesystems get "" and the UI shows the mount.
            #[cfg(target_os = "linux")]
            let label = dunce::canonicalize(d.name())
                .ok()
                .and_then(|dev| labels.get(&dev).cloned())
                .unwrap_or_default();
            #[cfg(not(target_os = "linux"))]
            let label = d.name().to_string_lossy().into_owned();
            out.push(Drive {
                letter: mount,
                label,
                total: d.total_space(),
                free: d.available_space(),
                fs: d.file_system().to_string_lossy().into_owned(),
            });
        }
        out.sort_by(|a, b| a.letter.cmp(&b.letter));
    }
    out
}

/// Filesystem labels keyed by canonical device path, read from udev's
/// `/dev/disk/by-label` links (e.g. `parrot-root -> ../../nvme0n1p6`).
#[cfg(target_os = "linux")]
fn labels_by_device(dir: &Path) -> HashMap<PathBuf, String> {
    let mut out = HashMap::new();
    let Ok(rd) = std::fs::read_dir(dir) else {
        return out;
    };
    for entry in rd.flatten() {
        if let Ok(dev) = dunce::canonicalize(entry.path()) {
            out.insert(dev, unescape_udev(&entry.file_name().to_string_lossy()));
        }
    }
    out
}

/// udev link names escape spaces and other unsafe bytes as `\xNN`
/// ("Local\x20Disk").
#[cfg(target_os = "linux")]
fn unescape_udev(name: &str) -> String {
    let b = name.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'\\' && b.get(i + 1) == Some(&b'x') {
            let byte = b
                .get(i + 2..i + 4)
                .filter(|h| h.iter().all(u8::is_ascii_hexdigit))
                .and_then(|h| u8::from_str_radix(std::str::from_utf8(h).ok()?, 16).ok());
            if let Some(v) = byte {
                out.push(v);
                i += 4;
                continue;
            }
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

static SYSINFO: std::sync::OnceLock<std::sync::Mutex<sysinfo::System>> =
    std::sync::OnceLock::new();

#[tauri::command(async)]
pub fn system_info() -> SystemInfo {
    use sysinfo::System;
    // Keep a process-lifetime System instance; System::new_all() is very
    // expensive on Windows (enumerates every process + disk + network), and
    // the StatusBar polls this every 2s. Refresh only CPU + memory per call.
    let cell = SYSINFO.get_or_init(|| std::sync::Mutex::new(System::new()));
    let (cpu_pct, mem_total, mem_used) = match cell.lock() {
        Ok(mut sys) => {
            sys.refresh_cpu_usage();
            sys.refresh_memory();
            (sys.global_cpu_usage(), sys.total_memory(), sys.used_memory())
        }
        Err(_) => (0.0, 0, 0),
    };
    let mem_pct = if mem_total > 0 {
        (mem_used as f32 / mem_total as f32) * 100.0
    } else {
        0.0
    };
    SystemInfo {
        cpu_pct,
        mem_pct,
        mem_used,
        mem_total,
        uptime_s: System::uptime(),
        host: System::host_name().unwrap_or_default(),
    }
}

// ---------- filesystem type for arbitrary path ----------

#[tauri::command(async)]
pub fn path_fs_type(path: String) -> Result<String, String> {
    #[cfg(windows)]
    {
        use windows::core::PCWSTR;
        use windows::Win32::Storage::FileSystem::{GetVolumePathNameW, GetVolumeInformationW};
        unsafe {
            let wide: Vec<u16> = path.encode_utf16().chain(std::iter::once(0)).collect();
            let mut vol_buf = [0u16; 260];
            let ok = GetVolumePathNameW(PCWSTR(wide.as_ptr()), &mut vol_buf).is_ok();
            if !ok {
                return Ok(String::new());
            }
            let mut fs_buf = [0u16; 64];
            let res = GetVolumeInformationW(
                PCWSTR(vol_buf.as_ptr()),
                None,
                None,
                None,
                None,
                Some(&mut fs_buf),
            );
            if res.is_err() {
                return Ok(String::new());
            }
            let fs = String::from_utf16_lossy(
                &fs_buf[..fs_buf.iter().position(|&c| c == 0).unwrap_or(0)],
            );
            Ok(fs)
        }
    }
    #[cfg(not(windows))]
    {
        // Longest mount-point prefix of `path` wins. /proc/self/mounts escapes
        // spaces in mount points as \040.
        let mounts = std::fs::read_to_string("/proc/self/mounts").map_err(|e| e.to_string())?;
        Ok(fs_type_for(&mounts, &path))
    }
}

/// The filesystem type of the mount in `mounts` (`/proc/self/mounts` text)
/// that holds `path`, or "" if none does. The deepest mount point wins. Of
/// several mounts on that same point, the last listed is the one on top.
/// Order alone can't decide between different points: mounts moved into
/// the root at boot (`/proc`, `/sys`, `/run`) are listed before `/`.
#[cfg(not(windows))]
fn fs_type_for(mounts: &str, path: &str) -> String {
    let mut best_len = 0usize;
    let mut best_fs = String::new();
    for line in mounts.lines() {
        let mut it = line.split_whitespace();
        let (Some(_dev), Some(mp_raw), Some(fs)) = (it.next(), it.next(), it.next()) else {
            continue;
        };
        let mp = mp_raw.replace("\\040", " ");
        let matches = mp == "/" || path == mp || path.starts_with(&(mp.clone() + "/"));
        if matches && mp.len() >= best_len {
            best_len = mp.len();
            best_fs = fs.to_string();
        }
    }
    best_fs
}

// ---------- network rate ----------

#[derive(Debug, Serialize, Default, Clone, Copy)]
pub struct NetRate {
    pub down_bps: u64,
    pub up_bps: u64,
}

static NET_LAST: std::sync::Mutex<Option<(std::time::Instant, u64, u64)>> =
    std::sync::Mutex::new(None);

#[tauri::command(async)]
pub fn net_rate() -> Result<NetRate, String> {
    let (total_in, total_out) = sample_net_octets()?;
    let now = std::time::Instant::now();
    let mut slot = NET_LAST.lock().map_err(|e| e.to_string())?;
    let rate = match *slot {
        Some((prev_t, prev_in, prev_out)) => {
            let dt = now.duration_since(prev_t).as_secs_f64().max(0.001);
            let d_in = total_in.saturating_sub(prev_in) as f64;
            let d_out = total_out.saturating_sub(prev_out) as f64;
            NetRate {
                down_bps: (d_in / dt) as u64,
                up_bps: (d_out / dt) as u64,
            }
        }
        None => NetRate::default(),
    };
    *slot = Some((now, total_in, total_out));
    Ok(rate)
}

#[cfg(windows)]
fn sample_net_octets() -> Result<(u64, u64), String> {
    use windows::Win32::NetworkManagement::IpHelper::{
        FreeMibTable, GetIfTable2, MIB_IF_TABLE2,
    };
    unsafe {
        let mut table_ptr: *mut MIB_IF_TABLE2 = std::ptr::null_mut();
        let err = GetIfTable2(&mut table_ptr);
        if err.0 != 0 || table_ptr.is_null() {
            return Err(format!("GetIfTable2: {:?}", err));
        }
        let table = &*table_ptr;
        let count = table.NumEntries as usize;
        let rows = std::slice::from_raw_parts(table.Table.as_ptr(), count);
        let mut total_in: u64 = 0;
        let mut total_out: u64 = 0;
        for row in rows {
            // Skip loopback (IF_TYPE_SOFTWARE_LOOPBACK = 24).
            if row.Type == 24 {
                continue;
            }
            total_in = total_in.saturating_add(row.InOctets);
            total_out = total_out.saturating_add(row.OutOctets);
        }
        FreeMibTable(table_ptr as _);
        Ok((total_in, total_out))
    }
}

#[cfg(not(windows))]
fn sample_net_octets() -> Result<(u64, u64), String> {
    // /proc/net/dev: two header lines, then "iface: rx_bytes ... tx_bytes ..."
    // with tx_bytes at field index 8 after the colon.
    let text = std::fs::read_to_string("/proc/net/dev").map_err(|e| e.to_string())?;
    Ok(parse_net_dev(&text))
}

/// Total received and sent bytes in `/proc/net/dev` text, loopback excluded.
#[cfg(not(windows))]
fn parse_net_dev(text: &str) -> (u64, u64) {
    let mut total_in = 0u64;
    let mut total_out = 0u64;
    for line in text.lines().skip(2) {
        let Some((iface, rest)) = line.split_once(':') else {
            continue;
        };
        if iface.trim() == "lo" {
            continue;
        }
        let fields: Vec<&str> = rest.split_whitespace().collect();
        if fields.len() < 9 {
            continue;
        }
        total_in = total_in.saturating_add(fields[0].parse::<u64>().unwrap_or(0));
        total_out = total_out.saturating_add(fields[8].parse::<u64>().unwrap_or(0));
    }
    (total_in, total_out)
}

#[cfg(test)]
mod tests {
    #[cfg_attr(windows, allow(unused_imports))]
    use super::*;
    #[cfg_attr(windows, allow(unused_imports))]
    use crate::commands::testing::temp_dir;

    #[cfg(target_os = "linux")]
    #[test]
    fn unescape_udev_decodes_hex_escapes() {
        assert_eq!(unescape_udev("Local\\x20Disk"), "Local Disk");
        assert_eq!(unescape_udev("parrot-root"), "parrot-root");
        assert_eq!(unescape_udev("a\\x2fb"), "a/b");
        // Malformed escapes pass through untouched.
        assert_eq!(unescape_udev("x\\x2"), "x\\x2");
        assert_eq!(unescape_udev("x\\xzz"), "x\\xzz");
        assert_eq!(unescape_udev("x\\x+1"), "x\\x+1");
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn labels_by_device_maps_canonical_devices() {
        let dir = temp_dir("bylabel");
        std::fs::create_dir_all(dir.join("dev")).unwrap();
        std::fs::create_dir_all(dir.join("by-label")).unwrap();
        std::fs::write(dir.join("dev/sda1"), "").unwrap();
        std::os::unix::fs::symlink("../dev/sda1", dir.join("by-label/My\\x20Disk")).unwrap();
        std::os::unix::fs::symlink("../dev/gone", dir.join("by-label/stale")).unwrap();

        let labels = labels_by_device(&dir.join("by-label"));
        let dev = dunce::canonicalize(dir.join("dev/sda1")).unwrap();
        assert_eq!(labels.get(&dev).map(String::as_str), Some("My Disk"));
        assert_eq!(labels.len(), 1); // the dangling link is skipped
        assert!(labels_by_device(&dir.join("nope")).is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }
}

#[cfg(test)]
#[path = "system_tests.rs"]
mod system_tests;
