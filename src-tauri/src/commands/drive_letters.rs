//! The sidebar's drive letters on Windows (`system::drives`).
//!
//! Asking about a drive can block or bring up a system dialog:
//! - an empty removable or CD drive shows "There is no disk in the drive"
//!   unless the process has turned critical-error boxes off;
//! - a disconnected or unreachable network drive can keep
//!   `GetDiskFreeSpaceExW` waiting for the network's timeout.
//!
//! So startup turns those boxes off, a mapped drive that Windows already knows
//! is disconnected isn't asked at all, and each of the rest is asked on its
//! own thread, leaving out any that doesn't answer in time.
//!
//! Only std and `windows` are used here, so the file can be type-checked on
//! Linux through a scratch crate (`~/.claude/environment.md`).

use std::sync::mpsc;
use std::time::{Duration, Instant};

use windows::core::{PCWSTR, PWSTR};
use windows::Win32::Foundation::{ERROR_CONNECTION_UNAVAIL, ERROR_NO_NETWORK};
use windows::Win32::NetworkManagement::WNet::WNetGetConnectionW;
use windows::Win32::Storage::FileSystem::{
    GetDiskFreeSpaceExW, GetDriveTypeW, GetLogicalDrives, GetVolumeInformationW,
};
use windows::Win32::System::Diagnostics::Debug::{SetErrorMode, SEM_FAILCRITICALERRORS};

/// One drive letter that answered.
pub(crate) struct Letter {
    /// `C:\`
    pub root: String,
    pub label: String,
    pub total: u64,
    pub free: u64,
    pub fs: String,
}

/// How long a drive gets to answer before the list goes on without it.
const ANSWER_WITHIN: Duration = Duration::from_secs(2);

// GetDriveTypeW's results (WinBase.h).
const DRIVE_UNKNOWN: u32 = 0;
const DRIVE_NO_ROOT_DIR: u32 = 1;
const DRIVE_REMOTE: u32 = 4;

/// Make a failed drive access return an error instead of showing the system's
/// critical-error box ("There is no disk in the drive"), for the whole
/// process. Microsoft's advice is that every app does this at startup. Any
/// mode already set is kept.
pub(crate) fn no_critical_error_boxes() {
    unsafe {
        let old = SetErrorMode(SEM_FAILCRITICALERRORS);
        SetErrorMode(old | SEM_FAILCRITICALERRORS);
    }
}

/// Every drive letter that answers within `ANSWER_WITHIN`, in letter order.
pub(crate) fn letters() -> Vec<Letter> {
    let mask = unsafe { GetLogicalDrives() };
    let (tx, rx) = mpsc::channel();
    let mut asked = 0;
    for i in 0..26u8 {
        if (mask >> i) & 1 == 0 {
            continue;
        }
        let root = format!("{}:\\", (b'A' + i) as char);
        if !worth_asking(&root) {
            continue;
        }
        let tx = tx.clone();
        asked += 1;
        // A drive that never answers keeps its thread until the system call
        // gives up; the list doesn't wait for it.
        std::thread::spawn(move || {
            let _ = tx.send((i, ask(root)));
        });
    }
    let deadline = Instant::now() + ANSWER_WITHIN;
    let mut found = Vec::new();
    for _ in 0..asked {
        match rx.recv_timeout(deadline.saturating_duration_since(Instant::now())) {
            Ok((i, Some(letter))) => found.push((i, letter)),
            Ok((_, None)) => {}
            Err(_) => break,
        }
    }
    found.sort_by_key(|(i, _)| *i);
    found.into_iter().map(|(_, letter)| letter).collect()
}

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(Some(0)).collect()
}

/// False for a letter with no root, and for a mapped network drive that
/// Windows already knows is disconnected, or when there's no network: asking
/// those would only wait for a timeout.
fn worth_asking(root: &str) -> bool {
    let root_w = wide(root);
    match unsafe { GetDriveTypeW(PCWSTR(root_w.as_ptr())) } {
        DRIVE_UNKNOWN | DRIVE_NO_ROOT_DIR => false,
        DRIVE_REMOTE => {
            // `X:`, without the backslash.
            let local = wide(root.trim_end_matches('\\'));
            let mut remote = [0u16; 512];
            let mut len = remote.len() as u32;
            let r = unsafe {
                WNetGetConnectionW(PCWSTR(local.as_ptr()), PWSTR(remote.as_mut_ptr()), &mut len)
            };
            r != ERROR_CONNECTION_UNAVAIL && r != ERROR_NO_NETWORK
        }
        _ => true,
    }
}

/// A drive's size, label and file system; `None` when its size can't be read
/// (an empty removable or CD drive, an unreachable share).
fn ask(root: String) -> Option<Letter> {
    let root_w = wide(&root);
    let (mut avail, mut total, mut free) = (0u64, 0u64, 0u64);
    unsafe {
        GetDiskFreeSpaceExW(
            PCWSTR(root_w.as_ptr()),
            Some(&mut avail),
            Some(&mut total),
            Some(&mut free),
        )
    }
    .ok()?;
    let mut label = [0u16; 256];
    let mut fs = [0u16; 64];
    let _ = unsafe {
        GetVolumeInformationW(
            PCWSTR(root_w.as_ptr()),
            Some(&mut label),
            None,
            None,
            None,
            Some(&mut fs),
        )
    };
    let text = |buf: &[u16]| {
        String::from_utf16_lossy(&buf[..buf.iter().position(|&c| c == 0).unwrap_or(0)])
    };
    Some(Letter {
        label: text(&label),
        fs: text(&fs),
        root,
        total,
        free,
    })
}
