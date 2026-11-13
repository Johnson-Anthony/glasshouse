//! Whether Windows keeps a Recycle Bin for a path.
//!
//! The trash crate deletes with `FOF_NO_UI`, which includes
//! `FOF_NOCONFIRMATION`. So the "delete permanently?" question Windows asks
//! when it can't recycle an item is answered yes without being shown, and an
//! item on a drive with no Recycle Bin is deleted for good. Only fixed local
//! drives have one.
//!
//! Only std and `windows` are used here, so the file can be type-checked on
//! Linux through a scratch crate (`~/.claude/environment.md`).

use std::path::Path;

/// Why `path` can't go to the Recycle Bin, or `None` when it can. Always
/// `None` off Windows: the freedesktop trash never deletes instead.
pub(crate) fn no_recycle_bin(path: &Path) -> Option<String> {
    platform::no_recycle_bin(path)
}

// GetDriveTypeW's results (WinBase.h). Kept here rather than imported, so the
// mapping below is plain code that's tested on every platform.
#[cfg(any(windows, test))]
const DRIVE_REMOVABLE: u32 = 2;
#[cfg(any(windows, test))]
const DRIVE_FIXED: u32 = 3;
#[cfg(any(windows, test))]
const DRIVE_REMOTE: u32 = 4;
#[cfg(any(windows, test))]
const DRIVE_CDROM: u32 = 5;
#[cfg(any(windows, test))]
const DRIVE_RAMDISK: u32 = 6;

/// Why a drive of this type has no Recycle Bin; `None` for a fixed drive.
#[cfg(any(windows, test))]
fn drive_type_problem(kind: u32) -> Option<&'static str> {
    match kind {
        DRIVE_FIXED => None,
        DRIVE_REMOTE => Some("it's on a network drive"),
        DRIVE_REMOVABLE => Some("it's on a removable drive"),
        DRIVE_CDROM => Some("it's on a CD or DVD drive"),
        DRIVE_RAMDISK => Some("it's on a RAM disk"),
        _ => Some("Windows can't tell what kind of drive it's on"),
    }
}

#[cfg(windows)]
mod platform {
    use std::os::windows::ffi::OsStrExt;
    use std::path::Path;

    use windows::core::PCWSTR;
    use windows::Win32::Storage::FileSystem::{GetDriveTypeW, GetVolumePathNameW};

    pub(super) fn no_recycle_bin(path: &Path) -> Option<String> {
        let wide: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
        // The volume's root: `C:\`, a mounted folder, or `\\server\share\`,
        // whose name can run past MAX_PATH.
        let mut root = vec![0u16; 1024];
        if let Err(e) = unsafe { GetVolumePathNameW(PCWSTR(wide.as_ptr()), &mut root) } {
            return Some(format!("Windows can't tell which drive it's on ({})", e));
        }
        let kind = unsafe { GetDriveTypeW(PCWSTR(root.as_ptr())) };
        super::drive_type_problem(kind).map(str::to_string)
    }
}

#[cfg(not(windows))]
mod platform {
    pub(super) fn no_recycle_bin(_path: &std::path::Path) -> Option<String> {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_a_fixed_drive_has_a_recycle_bin() {
        assert_eq!(drive_type_problem(DRIVE_FIXED), None);
        for kind in [0, 1, DRIVE_REMOVABLE, DRIVE_REMOTE, DRIVE_CDROM, DRIVE_RAMDISK, 99] {
            assert!(drive_type_problem(kind).is_some(), "drive type {}", kind);
        }
        assert_eq!(drive_type_problem(DRIVE_REMOTE), Some("it's on a network drive"));
    }

    #[cfg(not(windows))]
    #[test]
    fn off_windows_nothing_is_refused() {
        assert_eq!(no_recycle_bin(Path::new("/mnt/share/a.txt")), None);
    }
}
