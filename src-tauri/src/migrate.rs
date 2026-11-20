//! The identifier change (0.3.0). Up to 0.2.0 the app's folders were named
//! after `sh.glasshouse.viles`, an identifier left from the scaffold; now
//! they're named after `APP_ID`. Every start, in every mode and before
//! anything reads them, moves each old folder to the new name unless the
//! new one exists already: pins, tags, recents, window state, the
//! integration records and the webview's data (settings and tabs in
//! localStorage). The CLI modes need it too: `--integration-off` reads
//! `integration.json`.
//!
//! It also moves saved remotes from `~/.glasshouse/remotes.json`, where
//! 0.2.0 kept them, into the config folder.
//!
//! Nothing is merged: once a new folder exists, the old one is left alone.
//! See docs/decisions/2026-11-20-release-identity-migration.md.

use std::path::{Path, PathBuf};

use crate::APP_ID;

/// The identifier up to 0.2.0.
pub(crate) const OLD_APP_ID: &str = "sh.glasshouse.viles";

/// What happened to one folder or file.
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum Moved {
    Nothing,
    Renamed,
    Copied,
    Failed(String),
}

/// The folders Tauri names `<identifier>` folders in (`app_config_dir`,
/// `app_data_dir`, `app_local_data_dir`, `app_cache_dir`; the log folder is
/// in the local data one), each once: on Linux `~/.config`,
/// `~/.local/share` and `~/.cache`, on Windows `%APPDATA%` and
/// `%LOCALAPPDATA%`. Tauri reads them with the same crate.
fn bases() -> Vec<PathBuf> {
    let mut out: Vec<PathBuf> = Vec::new();
    for d in [dirs::config_dir(), dirs::data_dir(), dirs::data_local_dir(), dirs::cache_dir()].into_iter().flatten() {
        if !out.contains(&d) {
            out.push(d);
        }
    }
    out
}

pub(crate) fn run() {
    let config = dirs::config_dir().map(|d| d.join(APP_ID));
    migrate(&bases(), crate::commands::listing::home_dir_path().as_deref(), config.as_deref());
}

/// Moves `<base>/OLD_APP_ID` to `<base>/APP_ID` in each of `bases`, then
/// the saved remotes from `home` into `config`. Says on stderr what moved
/// and what couldn't.
pub(crate) fn migrate(bases: &[PathBuf], home: Option<&Path>, config: Option<&Path>) {
    let mut done = Vec::new();
    for base in bases {
        if done.contains(&base) {
            continue;
        }
        done.push(base);
        let (old, new) = (base.join(OLD_APP_ID), base.join(APP_ID));
        report(&old, &new, move_dir(&old, &new));
    }
    if let (Some(home), Some(config)) = (home, config) {
        let old = home.join(".glasshouse/remotes.json");
        report(&old, &config.join("remotes.json"), move_remotes(home, config));
    }
}

fn report(old: &Path, new: &Path, m: Moved) {
    match m {
        Moved::Nothing => {}
        Moved::Renamed | Moved::Copied => eprintln!("glasshouse: moved {} to {}", old.display(), new.display()),
        Moved::Failed(e) => eprintln!("glasshouse: couldn't move {} to {}: {e}", old.display(), new.display()),
    }
}

/// Renames `old` to `new` when `old` is a folder and nothing is at `new`.
/// When the rename fails (another file system; on Windows, a file in it
/// held open), copies it instead and leaves `old`.
pub(crate) fn move_dir(old: &Path, new: &Path) -> Moved {
    // symlink_metadata: a dangling link at `new` counts as something there.
    if new.symlink_metadata().is_ok() || !old.is_dir() {
        return Moved::Nothing;
    }
    match std::fs::rename(old, new) {
        Ok(()) => return Moved::Renamed,
        // Another process starting at the same time moved it first.
        Err(_) if !old.exists() || new.exists() => return Moved::Nothing,
        Err(_) => {}
    }
    match copy_dir(old, new) {
        Ok(()) => Moved::Copied,
        Err(e) => Moved::Failed(e),
    }
}

/// Copies folder `old` to `new` through a sibling folder of this process's
/// own, renamed into place at the end, so a half copy is never taken for a
/// finished one. On failure the partial copy is removed.
pub(crate) fn copy_dir(old: &Path, new: &Path) -> Result<(), String> {
    let name = new.file_name().ok_or_else(|| format!("{} has no name", new.display()))?;
    let tmp = new.with_file_name(format!("{}.migrating-{}", name.to_string_lossy(), std::process::id()));
    let _ = std::fs::remove_dir_all(&tmp);
    let copied = copy_tree(old, &tmp).and_then(|()| std::fs::rename(&tmp, new).map_err(|e| format!("{}: {e}", new.display())));
    if copied.is_err() {
        let _ = std::fs::remove_dir_all(&tmp);
    }
    copied
}

fn copy_tree(from: &Path, to: &Path) -> Result<(), String> {
    let err = |p: &Path, e: std::io::Error| format!("{}: {e}", p.display());
    std::fs::create_dir(to).map_err(|e| err(to, e))?;
    for entry in std::fs::read_dir(from).map_err(|e| err(from, e))? {
        let entry = entry.map_err(|e| err(from, e))?;
        let (src, dst) = (entry.path(), to.join(entry.file_name()));
        let kind = entry.file_type().map_err(|e| err(&src, e))?;
        if kind.is_dir() {
            copy_tree(&src, &dst)?;
        } else if kind.is_symlink() {
            // The app and its webview make no links; one put there by hand
            // is kept on unix and left out on Windows.
            #[cfg(unix)]
            std::fs::read_link(&src)
                .and_then(|target| std::os::unix::fs::symlink(target, &dst))
                .map_err(|e| err(&src, e))?;
        } else {
            std::fs::copy(&src, &dst).map_err(|e| err(&src, e))?;
        }
    }
    Ok(())
}

/// Moves `home/.glasshouse/remotes.json` to `config/remotes.json` when
/// that's missing, then removes `~/.glasshouse` if nothing else is in it.
/// A write then a remove, not a rename: the home and config folders can be
/// on different file systems.
pub(crate) fn move_remotes(home: &Path, config: &Path) -> Moved {
    let dir = home.join(".glasshouse");
    let (old, new) = (dir.join("remotes.json"), config.join("remotes.json"));
    if new.symlink_metadata().is_ok() || !old.is_file() {
        return Moved::Nothing;
    }
    let moved = std::fs::read_to_string(&old)
        .map_err(|e| format!("{}: {e}", old.display()))
        .and_then(|text| {
            std::fs::create_dir_all(config).map_err(|e| format!("{}: {e}", config.display()))?;
            crate::commands::config::write_config_atomic(&new, &text)
        });
    if let Err(e) = moved {
        return Moved::Failed(e);
    }
    let _ = std::fs::remove_file(&old);
    let _ = std::fs::remove_dir(&dir);
    Moved::Copied
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::testing::{put, read, tree, Scratch};

    #[test]
    fn the_app_id_is_tauri_s_identifier() {
        let conf: serde_json::Value = serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        assert_eq!(conf["identifier"], APP_ID);
        assert_ne!(APP_ID, OLD_APP_ID);
    }

    /// The old folders as 0.2.0 left them: config, data and cache.
    fn old_install(root: &Path) {
        put(&root.join("config").join(OLD_APP_ID).join("pins.json"), "[\"/a\"]");
        put(&root.join("config").join(OLD_APP_ID).join("integration.json"), "{}");
        put(&root.join("data").join(OLD_APP_ID).join("localstorage/tauri_localhost_0.localstorage"), "tabs");
        put(&root.join("cache").join(OLD_APP_ID).join("WebKitCache/x"), "c");
        put(&root.join("home/.glasshouse/remotes.json"), "[{\"label\":\"l\",\"host\":\"h\",\"path\":\"/\"}]");
    }

    #[test]
    fn every_old_folder_moves_to_the_new_name() {
        let t = Scratch::new("migrate-all");
        old_install(t.path());
        let bases = [t.join("config"), t.join("data"), t.join("data"), t.join("cache")];
        let config = t.join("config").join(APP_ID);
        migrate(&bases, Some(&t.join("home")), Some(&config));
        assert_eq!(read(&config.join("pins.json")), "[\"/a\"]");
        assert_eq!(read(&config.join("integration.json")), "{}");
        assert_eq!(read(&config.join("remotes.json")), "[{\"label\":\"l\",\"host\":\"h\",\"path\":\"/\"}]");
        assert_eq!(read(&t.join("data").join(APP_ID).join("localstorage/tauri_localhost_0.localstorage")), "tabs");
        assert_eq!(read(&t.join("cache").join(APP_ID).join("WebKitCache/x")), "c");
        for base in ["config", "data", "cache"] {
            assert!(!t.join(base).join(OLD_APP_ID).exists(), "{base} still has the old folder");
        }
        // The emptied ~/.glasshouse goes too.
        assert!(!t.join("home/.glasshouse").exists());
        // A second start changes nothing.
        let before = tree(t.path());
        migrate(&bases, Some(&t.join("home")), Some(&config));
        assert_eq!(tree(t.path()), before);
    }

    #[test]
    fn a_new_folder_that_exists_is_never_merged_or_replaced() {
        let t = Scratch::new("migrate-new-exists");
        put(&t.join(OLD_APP_ID).join("pins.json"), "old");
        put(&t.join(APP_ID).join("pins.json"), "new");
        assert_eq!(move_dir(&t.join(OLD_APP_ID), &t.join(APP_ID)), Moved::Nothing);
        assert_eq!(read(&t.join(APP_ID).join("pins.json")), "new");
        assert_eq!(read(&t.join(OLD_APP_ID).join("pins.json")), "old");
        // An empty one counts too: the app has started with the new name.
        let u = Scratch::new("migrate-new-empty");
        put(&u.join(OLD_APP_ID).join("pins.json"), "old");
        std::fs::create_dir(u.join(APP_ID)).unwrap();
        assert_eq!(move_dir(&u.join(OLD_APP_ID), &u.join(APP_ID)), Moved::Nothing);
        assert!(u.join(OLD_APP_ID).join("pins.json").exists());
    }

    #[test]
    fn nothing_to_move_creates_nothing() {
        let t = Scratch::new("migrate-fresh");
        std::fs::create_dir_all(t.join("config")).unwrap();
        migrate(&[t.join("config")], Some(&t.join("home")), Some(&t.join("config").join(APP_ID)));
        assert_eq!(tree(t.path()), ["config/"]);
        // A file where the old folder would be isn't one.
        put(&t.join("config").join(OLD_APP_ID), "not a folder");
        assert_eq!(move_dir(&t.join("config").join(OLD_APP_ID), &t.join("config").join(APP_ID)), Moved::Nothing);
    }

    #[test]
    fn the_copy_keeps_the_old_folder_and_never_leaves_half_a_copy() {
        let t = Scratch::new("migrate-copy");
        let (old, new) = (t.join(OLD_APP_ID), t.join(APP_ID));
        put(&old.join("a/b/c.json"), "1");
        put(&old.join("d.json"), "2");
        copy_dir(&old, &new).unwrap();
        assert_eq!(tree(&new), ["a/", "a/b/", "a/b/c.json", "d.json"]);
        assert_eq!(tree(&old), tree(&new));
        // Only the two folders: the working copy was renamed into place.
        assert_eq!(std::fs::read_dir(t.path()).unwrap().count(), 2);
    }

    #[cfg(unix)]
    #[test]
    fn a_copy_that_fails_leaves_nothing_at_the_new_name() {
        use std::os::unix::fs::PermissionsExt;
        let t = Scratch::new("migrate-copy-fail");
        let (old, new) = (t.join(OLD_APP_ID), t.join(APP_ID));
        put(&old.join("ok.json"), "1");
        put(&old.join("locked.json"), "2");
        std::fs::set_permissions(old.join("locked.json"), std::fs::Permissions::from_mode(0o000)).unwrap();
        // Root reads it anyway; the test means nothing then.
        if std::fs::read(old.join("locked.json")).is_ok() {
            return;
        }
        assert!(copy_dir(&old, &new).unwrap_err().contains("locked.json"));
        assert!(!new.exists());
        assert_eq!(std::fs::read_dir(t.path()).unwrap().count(), 1, "the working copy is removed");
        assert!(old.join("ok.json").exists());
    }

    #[test]
    fn remotes_move_once_and_keep_what_s_there() {
        let t = Scratch::new("migrate-remotes");
        let (home, config) = (t.join("home"), t.join("config"));
        put(&home.join(".glasshouse/remotes.json"), "[1]");
        put(&home.join(".glasshouse/notes.txt"), "mine");
        assert_eq!(move_remotes(&home, &config), Moved::Copied);
        assert_eq!(read(&config.join("remotes.json")), "[1]");
        assert!(!home.join(".glasshouse/remotes.json").exists());
        // Not empty, so it stays.
        assert!(home.join(".glasshouse/notes.txt").exists());
        // An old file again (an old glasshouse still running) doesn't
        // replace the new one.
        put(&home.join(".glasshouse/remotes.json"), "[2]");
        assert_eq!(move_remotes(&home, &config), Moved::Nothing);
        assert_eq!(read(&config.join("remotes.json")), "[1]");
    }
}
