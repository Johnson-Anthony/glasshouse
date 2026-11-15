//! Which glasshouse process owns the saved session: the window's size and
//! place (the window-state plugin, which `lib.rs` registers only in the
//! owner) and, in the frontend, the tabs (`src/session.ts`).
//!
//! File → New Window starts another process. The first one running takes an
//! exclusive lock on `session.lock` in the app config dir and keeps it until
//! it ends; the OS drops it then, crash or not. A process that finds the
//! lock taken restores and saves nothing, so a second window neither opens
//! the first one's tabs on top of it nor overwrites them. See
//! docs/decisions/2026-11-15-session-persistence-windows.md.

use std::fs::{File, OpenOptions, TryLockError};
use std::path::Path;

use tauri::State;

pub struct SessionOwner {
    owner: bool,
    /// Held open for the life of the process: closing it drops the lock.
    _lock: Option<File>,
}

impl SessionOwner {
    pub fn is_owner(&self) -> bool {
        self.owner
    }
}

/// Claims the session for this process unless another process holds
/// `dir/session.lock`. With no config dir, or a lock file that can't be made
/// or locked (a read-only config dir, a file system without locks), this
/// process is the owner: saving with no guard beats never saving.
pub fn claim(dir: Option<&Path>) -> SessionOwner {
    let Some(dir) = dir else {
        return SessionOwner { owner: true, _lock: None };
    };
    let opened = std::fs::create_dir_all(dir).and_then(|_| {
        OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(dir.join("session.lock"))
    });
    let Ok(file) = opened else {
        return SessionOwner { owner: true, _lock: None };
    };
    match file.try_lock() {
        Ok(()) => SessionOwner { owner: true, _lock: Some(file) },
        Err(TryLockError::WouldBlock) => SessionOwner { owner: false, _lock: None },
        Err(TryLockError::Error(_)) => SessionOwner { owner: true, _lock: None },
    }
}

/// Whether this window restores and saves the tabs.
#[tauri::command]
pub fn session_owner(state: State<'_, SessionOwner>) -> bool {
    state.is_owner()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::testing::Scratch;

    #[test]
    fn the_first_claim_owns_the_session_until_it_ends() {
        let dir = Scratch::new("session-claim");
        let first = claim(Some(dir.path()));
        assert!(first.is_owner());
        // A second process opens the file on its own, as this does.
        assert!(!claim(Some(dir.path())).is_owner());
        drop(first);
        assert!(claim(Some(dir.path())).is_owner());
    }

    #[test]
    fn a_missing_config_dir_is_made() {
        let dir = Scratch::new("session-mkdir");
        let nested = dir.join("a/b");
        assert!(claim(Some(&nested)).is_owner());
        assert!(nested.join("session.lock").is_file());
    }

    #[test]
    fn no_lock_file_still_owns() {
        let dir = Scratch::new("session-nofile");
        // A file where the config dir should be: the lock can't be made.
        let blocked = dir.join("config");
        std::fs::write(&blocked, "").unwrap();
        assert!(claim(Some(&blocked)).is_owner());
        assert!(claim(None).is_owner());
    }
}
