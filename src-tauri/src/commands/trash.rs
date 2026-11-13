//! The trash. Move to Trash records enough to find the item again for undo,
//! and the Trash view lists, restores and purges items, through the trash
//! crate's `os_limited` API (Windows and freedesktop).
//!
//! An item is found again by its original path and deletion time. The
//! crate's id alone isn't enough: on Linux it's the `.trashinfo` path, which
//! is built from the name and is reused once that item has left the trash.
//!
//! The crate's freedesktop `metadata` and `restore_all` `assert!` that the
//! trashed file exists, and release builds abort on a panic. So every item is
//! checked first (`file_missing`), and one whose file is gone never reaches
//! those calls.

use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use super::recycle_bin::no_recycle_bin;

/// What Move to Trash did with one path, for its undo.
#[derive(Serialize, Debug, Clone, PartialEq)]
pub struct Trashed {
    /// The path as the trash records it: the parent canonicalized, as the
    /// crate does, plus the name.
    pub original: String,
    /// Unix seconds just before and just after the delete; the item's
    /// deletion time lies between them.
    pub from: i64,
    pub to: i64,
}

/// Names one trashed item: its original path, a window its deletion time
/// is in, and, from the Trash view, its id.
#[derive(Deserialize, Debug, Clone)]
pub struct TrashKey {
    pub original: String,
    pub from: i64,
    pub to: i64,
    #[serde(default)]
    pub id: Option<String>,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
pub struct TrashProblem {
    pub path: String,
    pub reason: String,
}

/// What a restore or purge did: the original paths of the items it
/// handled, and what it left in the trash and why.
#[derive(Serialize, Debug, Default, PartialEq)]
pub struct TrashResult {
    pub done: Vec<String>,
    pub problems: Vec<TrashProblem>,
}

/// One item, as the Trash view shows it.
#[derive(Serialize, Debug)]
pub struct TrashEntry {
    pub id: String,
    pub name: String,
    pub original_parent: String,
    pub original: String,
    /// Unix seconds.
    pub deleted: i64,
    /// A file's size in bytes.
    pub size: Option<u64>,
    /// A folder's entry count, not counting what's inside its subfolders.
    pub entries: Option<usize>,
}

fn problem(path: impl Into<String>, reason: impl Into<String>) -> TrashProblem {
    TrashProblem { path: path.into(), reason: reason.into() }
}

fn now_secs() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_secs() as i64)
}

/// Move `path` to the trash. Refuses a path on a drive with no Recycle Bin,
/// where Windows would delete it instead. `move_to_trash` and git's discard
/// both go through here.
pub(crate) fn trash_path(path: &Path) -> Result<Trashed, String> {
    if let Some(why) = no_recycle_bin(path) {
        return Err(format!(
            "{}, where Windows has no Recycle Bin: moving it to the trash would delete it for good",
            why
        ));
    }
    let original = trash_original(path)?;
    let from = now_secs();
    trash::delete(path).map_err(|e| e.to_string())?;
    Ok(Trashed { original: original.to_string_lossy().into_owned(), from, to: now_secs() })
}

/// `path` as the trash will record it: the crate canonicalizes the parent
/// before it deletes, and keeps the name.
fn trash_original(path: &Path) -> Result<PathBuf, String> {
    let name = path.file_name().ok_or_else(|| format!("{} has no name to trash", path.display()))?;
    let parent = path
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .ok_or_else(|| format!("{} has no folder", path.display()))?;
    let parent = dunce::canonicalize(parent).map_err(|e| format!("{}: {}", parent.display(), e))?;
    Ok(parent.join(name))
}

#[tauri::command(async)]
pub fn trash_unsupported(paths: Vec<String>) -> Vec<TrashProblem> {
    paths
        .into_iter()
        .filter_map(|p| no_recycle_bin(Path::new(&p)).map(|why| problem(p, why)))
        .collect()
}

#[tauri::command(async)]
pub fn trash_list() -> Result<Vec<TrashEntry>, String> {
    let items = os::list()?;
    Ok(items
        .iter()
        .map(|it| {
            let (size, entries) = os::size(it);
            TrashEntry {
                id: it.id.to_string_lossy().into_owned(),
                name: it.name.to_string_lossy().into_owned(),
                original_parent: it.original_parent.to_string_lossy().into_owned(),
                original: it.original_path().to_string_lossy().into_owned(),
                deleted: it.time_deleted,
                size,
                entries,
            }
        })
        .collect())
}

/// Put the items `keys` name back where they came from. Each key must name
/// exactly one item, whose original path is free. With `all_or_nothing`
/// (undo), any refusal restores nothing; otherwise the rest are restored.
#[tauri::command(async)]
pub fn trash_restore(keys: Vec<TrashKey>, all_or_nothing: bool) -> Result<TrashResult, String> {
    let items = os::list()?;
    let view: Vec<Item> = items.iter().map(Item::of).collect();
    let (picked, mut problems) = pick(&view, &keys);
    let (picked, missing): (Vec<usize>, Vec<usize>) = picked.into_iter().partition(|&i| !os::file_missing(&items[i]));
    for i in missing {
        problems.push(problem(view[i].path(), "its file is missing from the trash folder"));
    }
    let (ok, refused) = restorable(&view, picked, |p| p.symlink_metadata().is_ok());
    problems.extend(refused);
    if ok.is_empty() || (all_or_nothing && !problems.is_empty()) {
        return Ok(TrashResult { done: Vec::new(), problems });
    }
    let chosen: Vec<trash::TrashItem> = ok.iter().map(|&i| items[i].clone()).collect();
    let failed = os::restore(chosen.clone()).err();
    Ok(settle(chosen, failed, problems))
}

/// Delete the items `keys` name for good. An item whose file is already
/// gone from the trash folder loses its record.
#[tauri::command(async)]
pub fn trash_purge(keys: Vec<TrashKey>) -> Result<TrashResult, String> {
    let items = os::list()?;
    let view: Vec<Item> = items.iter().map(Item::of).collect();
    let (picked, mut problems) = pick(&view, &keys);
    let (picked, missing): (Vec<usize>, Vec<usize>) = picked.into_iter().partition(|&i| !os::file_missing(&items[i]));
    let mut forgotten = Vec::new();
    for i in missing {
        match os::forget(&items[i]) {
            Ok(()) => forgotten.push(view[i].path()),
            Err(e) => problems.push(problem(view[i].path(), e)),
        }
    }
    let chosen: Vec<trash::TrashItem> = picked.iter().map(|&i| items[i].clone()).collect();
    let failed = if chosen.is_empty() { None } else { os::purge(&chosen).err() };
    let mut res = settle(chosen, failed, problems);
    res.done.extend(forgotten);
    Ok(res)
}

/// After a restore or purge of `chosen`: all done when it succeeded.
/// Otherwise the trash is listed again, and an item still in it is a
/// problem with `failed` as its reason (the crate stops at the first error,
/// so the ones before it went through).
fn settle(chosen: Vec<trash::TrashItem>, failed: Option<String>, mut problems: Vec<TrashProblem>) -> TrashResult {
    let paths = |items: &[trash::TrashItem]| -> Vec<String> { items.iter().map(|it| Item::of(it).path()).collect() };
    let Some(reason) = failed else {
        return TrashResult { done: paths(&chosen), problems };
    };
    let after: Vec<Item> = match os::list() {
        Ok(items) => items.iter().map(Item::of).collect(),
        Err(e) => {
            let why = format!("{}; then couldn't list the trash to see what was done: {}", reason, e);
            problems.extend(paths(&chosen).into_iter().map(|p| problem(p, why.clone())));
            return TrashResult { done: Vec::new(), problems };
        }
    };
    let mut done = Vec::new();
    for item in chosen.iter().map(Item::of) {
        if after.iter().any(|a| a.same_item(&item)) {
            problems.push(problem(item.path(), reason.clone()));
        } else {
            done.push(item.path());
        }
    }
    TrashResult { done, problems }
}

/// What matching needs of a trash item.
#[derive(Debug, Clone)]
struct Item {
    id: String,
    original: PathBuf,
    deleted: i64,
}

impl Item {
    fn of(it: &trash::TrashItem) -> Item {
        Item { id: it.id.to_string_lossy().into_owned(), original: it.original_path(), deleted: it.time_deleted }
    }

    fn path(&self) -> String {
        self.original.to_string_lossy().into_owned()
    }

    fn same_item(&self, other: &Item) -> bool {
        self.id == other.id && self.deleted == other.deleted && same_path(&self.original, &other.original)
    }
}

/// Deletion times are whole seconds. This much slack each side of a key's
/// window covers the rounding between our clock reading and the stored time.
const SLACK: i64 = 1;

fn same_path(a: &Path, b: &Path) -> bool {
    if cfg!(windows) {
        a.to_string_lossy().to_lowercase() == b.to_string_lossy().to_lowercase()
    } else {
        a == b
    }
}

/// The item each key names, as indexes into `items`, in key order. A key
/// that names none or several is a problem instead, and a key naming an
/// item an earlier key picked adds nothing.
fn pick(items: &[Item], keys: &[TrashKey]) -> (Vec<usize>, Vec<TrashProblem>) {
    let mut picked = Vec::new();
    let mut problems = Vec::new();
    for key in keys {
        let want = Path::new(&key.original);
        let found: Vec<usize> = items
            .iter()
            .enumerate()
            .filter(|(_, it)| {
                same_path(&it.original, want)
                    && (key.from - SLACK..=key.to + SLACK).contains(&it.deleted)
                    && key.id.as_ref().is_none_or(|id| *id == it.id)
            })
            .map(|(i, _)| i)
            .collect();
        match found.as_slice() {
            [] => problems.push(problem(&key.original, "isn't in the trash any more")),
            [i] => {
                if !picked.contains(i) {
                    picked.push(*i);
                }
            }
            _ => problems.push(problem(&key.original, "more than one item in the trash matches it")),
        }
    }
    (picked, problems)
}

/// Of the picked items, the ones that can go back: nothing is at their
/// original path (`taken`), and no earlier one goes back to the same path.
fn restorable(items: &[Item], picked: Vec<usize>, taken: impl Fn(&Path) -> bool) -> (Vec<usize>, Vec<TrashProblem>) {
    let mut ok: Vec<usize> = Vec::new();
    let mut problems = Vec::new();
    for i in picked {
        let it = &items[i];
        if ok.iter().any(|&j| same_path(&items[j].original, &it.original)) {
            problems.push(problem(it.path(), "another item being restored goes back to the same place"));
        } else if taken(&it.original) {
            problems.push(problem(it.path(), "something with that name is there now"));
        } else {
            ok.push(i);
        }
    }
    (ok, problems)
}

#[cfg(any(windows, target_os = "linux"))]
mod os {
    use trash::os_limited;
    use trash::TrashItem;

    fn text(e: trash::Error) -> String {
        match e {
            trash::Error::RestoreCollision { path, .. } => {
                format!("stopped at {}, where something with that name is now", path.display())
            }
            other => other.to_string(),
        }
    }

    pub(super) fn list() -> Result<Vec<TrashItem>, String> {
        os_limited::list().map_err(text)
    }

    /// A file's size or a folder's entry count, when they can be read.
    pub(super) fn size(item: &TrashItem) -> (Option<u64>, Option<usize>) {
        if file_missing(item) {
            return (None, None);
        }
        match os_limited::metadata(item) {
            Ok(m) => (m.size.size(), m.size.entries()),
            Err(_) => (None, None),
        }
    }

    pub(super) fn restore(items: Vec<TrashItem>) -> Result<(), String> {
        os_limited::restore_all(items).map_err(text)
    }

    pub(super) fn purge(items: &[TrashItem]) -> Result<(), String> {
        os_limited::purge_all(items).map_err(text)
    }

    /// Whether the item's file is gone from the trash folder, so only its
    /// `.trashinfo` record is left. The crate asserts it isn't.
    #[cfg(target_os = "linux")]
    pub(super) fn file_missing(item: &TrashItem) -> bool {
        // `<trash>/info/<name>.trashinfo` describes `<trash>/files/<name>`.
        let info = std::path::Path::new(&item.id);
        match (info.parent().and_then(|p| p.parent()), info.file_stem()) {
            (Some(trash), Some(name)) => trash.join("files").join(name).symlink_metadata().is_err(),
            _ => true,
        }
    }

    /// The Recycle Bin keeps no separate record, so there's nothing to check.
    #[cfg(windows)]
    pub(super) fn file_missing(_item: &TrashItem) -> bool {
        false
    }

    /// Remove the record of an item whose file is gone.
    #[cfg(target_os = "linux")]
    pub(super) fn forget(item: &TrashItem) -> Result<(), String> {
        std::fs::remove_file(&item.id).map_err(|e| e.to_string())
    }

    #[cfg(windows)]
    pub(super) fn forget(_item: &TrashItem) -> Result<(), String> {
        Err("the Recycle Bin has no record without its file".into())
    }
}

/// Elsewhere (macOS) the trash crate can't list or restore.
#[cfg(not(any(windows, target_os = "linux")))]
mod os {
    use trash::TrashItem;

    const NONE: &str = "the trash can't be listed or restored on this system";

    pub(super) fn list() -> Result<Vec<TrashItem>, String> {
        Err(NONE.into())
    }
    pub(super) fn size(_item: &TrashItem) -> (Option<u64>, Option<usize>) {
        (None, None)
    }
    pub(super) fn restore(_items: Vec<TrashItem>) -> Result<(), String> {
        Err(NONE.into())
    }
    pub(super) fn purge(_items: &[TrashItem]) -> Result<(), String> {
        Err(NONE.into())
    }
    pub(super) fn file_missing(_item: &TrashItem) -> bool {
        false
    }
    pub(super) fn forget(_item: &TrashItem) -> Result<(), String> {
        Err(NONE.into())
    }
}

#[cfg(test)]
mod tests;
