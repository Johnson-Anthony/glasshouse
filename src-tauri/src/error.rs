//! Errors a user reads: what went wrong as a plain sentence (`message`),
//! with the raw text kept for a bug report (`detail`, under "Show details"
//! in the app). Commands return `Result<T, AppError>`; Tauri sends it to the
//! page as `{ kind, path, message, detail }`, and `api.ts` turns that into a
//! `BackendError` whose message is the sentence.
//!
//! Commands that still return `String` errors keep working: `From<String>`
//! makes one of kind `other` whose message is that text.

use std::io;
use std::path::Path;

use serde::Serialize;

use crate::ops::CANCELLED;

/// What kind of failure it was, for code that reacts to one (a name that's
/// taken, a cancelled op) and for the sentence.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Kind {
    NotFound,
    Permission,
    Exists,
    NotEmpty,
    ReadOnly,
    Full,
    InUse,
    NotAFolder,
    IsAFolder,
    BadName,
    TooLarge,
    OtherDisk,
    MissingTool,
    Cancelled,
    Other,
}

/// What the user was doing, as the verb of "Couldn't … ".
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Action {
    Open,
    Save,
    Create,
    Rename,
    Copy,
    Move,
    Delete,
    Trash,
    ChangePermissions,
    Link,
    Start,
}

impl Action {
    fn phrase(self, name: &str) -> String {
        match self {
            Action::Open => format!("open {name}"),
            Action::Save => format!("save {name}"),
            Action::Create => format!("create {name}"),
            Action::Rename => format!("rename {name}"),
            Action::Copy => format!("copy {name}"),
            Action::Move => format!("move {name}"),
            Action::Delete => format!("delete {name}"),
            Action::Trash if cfg!(windows) => format!("move {name} to the Recycle Bin"),
            Action::Trash => format!("move {name} to the trash"),
            Action::ChangePermissions => format!("change the permissions of {name}"),
            Action::Link => format!("create the link {name}"),
            Action::Start => format!("start {name}"),
        }
    }

    /// Why a missing path stopped it: for the ones that make something,
    /// it's the folder it goes in that's gone.
    fn not_found(self) -> &'static str {
        match self {
            Action::Create | Action::Save | Action::Link => "the folder it goes in isn't there anymore",
            Action::Copy | Action::Move => "it, or the folder it's going to, isn't there anymore",
            Action::Start => "it wasn't found",
            _ => "it isn't there anymore",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct AppError {
    pub kind: Kind,
    /// The file or folder it's about, when there's one.
    pub path: Option<String>,
    /// A sentence for the user.
    pub message: String,
    /// The raw error, with the full path: for "Show details" and the log.
    pub detail: String,
}

impl AppError {
    pub fn new(kind: Kind, path: Option<&Path>, message: impl Into<String>, detail: impl Into<String>) -> Self {
        AppError {
            kind,
            path: path.map(|p| p.to_string_lossy().into_owned()),
            message: message.into(),
            detail: detail.into(),
        }
    }

    /// `e`, which happened while doing `action` to `path`.
    pub fn io(action: Action, path: impl AsRef<Path>, e: &io::Error) -> Self {
        let path = path.as_ref();
        let kind = kind_of(e);
        let what = action.phrase(&quoted_name(path));
        let message = match kind {
            Kind::Exists => taken(path),
            Kind::NotFound => format!("Couldn't {what} because {}.", action.not_found()),
            Kind::Other | Kind::Cancelled | Kind::MissingTool => format!("Couldn't {what}: {}", sentence_end(&os_text(e))),
            _ => format!("Couldn't {what} because {}.", reason(kind)),
        };
        AppError::new(kind, Some(path), message, format!("{}: {}", path.display(), e))
    }

    /// A failure that isn't an OS error: `why` finishes "Couldn't … : ".
    pub fn other(action: Action, path: impl AsRef<Path>, why: &str) -> Self {
        let path = path.as_ref();
        let message = format!("Couldn't {}: {}", action.phrase(&quoted_name(path)), sentence_end(why));
        AppError::new(Kind::Other, Some(path), message, format!("{}: {}", path.display(), why))
    }

    /// A program glasshouse needs isn't installed. `message` says what for
    /// and how to get it; `tried` is every name that was looked for.
    pub fn missing_tool(message: impl Into<String>, tried: &[&str]) -> Self {
        AppError::new(Kind::MissingTool, None, message, format!("not found on PATH: {}", tried.join(", ")))
    }

    pub fn cancelled() -> Self {
        AppError::new(Kind::Cancelled, None, CANCELLED, CANCELLED)
    }
}

impl From<String> for AppError {
    fn from(s: String) -> Self {
        if s == CANCELLED {
            return AppError::cancelled();
        }
        AppError::new(Kind::Other, None, s.clone(), s)
    }
}

impl std::fmt::Display for AppError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}

/// `"name" already exists in <folder>`: the message for a create, copy,
/// move or rename whose target name is taken, in the wording undo's
/// `ensureFree` uses too.
pub fn taken(path: &Path) -> String {
    let name = path.file_name().unwrap_or(path.as_os_str()).to_string_lossy();
    let parent = path.parent().map(|d| d.to_string_lossy()).unwrap_or_default();
    format!("\"{}\" already exists in {}", name, parent)
}

pub fn kind_of(e: &io::Error) -> Kind {
    // ERROR_SHARING_VIOLATION and ERROR_LOCK_VIOLATION: another program has
    // the file open. std files them under "uncategorized".
    #[cfg(windows)]
    if matches!(e.raw_os_error(), Some(32 | 33)) {
        return Kind::InUse;
    }
    use io::ErrorKind as K;
    match e.kind() {
        K::NotFound => Kind::NotFound,
        K::PermissionDenied => Kind::Permission,
        K::AlreadyExists => Kind::Exists,
        K::DirectoryNotEmpty => Kind::NotEmpty,
        K::ReadOnlyFilesystem => Kind::ReadOnly,
        K::StorageFull | K::QuotaExceeded => Kind::Full,
        K::ResourceBusy | K::ExecutableFileBusy => Kind::InUse,
        K::NotADirectory => Kind::NotAFolder,
        K::IsADirectory => Kind::IsAFolder,
        K::InvalidFilename => Kind::BadName,
        K::FileTooLarge => Kind::TooLarge,
        K::CrossesDevices => Kind::OtherDisk,
        _ => Kind::Other,
    }
}

fn reason(kind: Kind) -> &'static str {
    match kind {
        Kind::Permission => "you don't have permission",
        Kind::NotEmpty => "the folder isn't empty",
        Kind::ReadOnly => "the disk is read-only",
        Kind::Full => "the disk is full",
        Kind::InUse => "another program is using it",
        Kind::NotAFolder => "part of its path isn't a folder",
        Kind::IsAFolder => "it's a folder",
        Kind::BadName => "its name is too long or isn't allowed there",
        Kind::TooLarge => "it's too large for that disk",
        Kind::OtherDisk => "it's on another disk",
        _ => "of an error",
    }
}

/// `path`'s name in quotes, or the whole path for a root ("/", "C:\").
fn quoted_name(path: &Path) -> String {
    let name = path.file_name().map(|n| n.to_string_lossy()).unwrap_or_else(|| path.to_string_lossy());
    format!("“{name}”")
}

/// An OS error's description without the "(os error 5)" std adds.
fn os_text(e: &io::Error) -> String {
    let s = e.to_string();
    match s.rfind(" (os error ") {
        Some(i) if s.ends_with(')') => s[..i].to_string(),
        _ => s,
    }
}

/// `s` as the end of a sentence: one final period.
fn sentence_end(s: &str) -> String {
    let s = s.trim();
    if s.ends_with(['.', '!', '?']) {
        s.to_string()
    } else {
        format!("{s}.")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn e(kind: io::ErrorKind) -> io::Error {
        io::Error::from(kind)
    }

    #[test]
    fn io_errors_read_as_sentences() {
        let p = Path::new("/home/me/secret");
        let err = AppError::io(Action::Open, p, &e(io::ErrorKind::PermissionDenied));
        assert_eq!(err.kind, Kind::Permission);
        assert_eq!(err.message, "Couldn't open “secret” because you don't have permission.");
        assert_eq!(err.path.as_deref(), Some("/home/me/secret"));
        assert!(err.detail.starts_with("/home/me/secret: "), "{}", err.detail);

        let err = AppError::io(Action::Copy, p, &e(io::ErrorKind::NotFound));
        assert_eq!(err.message, "Couldn't copy “secret” because it, or the folder it's going to, isn't there anymore.");
        let err = AppError::io(Action::Delete, p, &e(io::ErrorKind::DirectoryNotEmpty));
        assert_eq!((err.kind, err.message.as_str()), (Kind::NotEmpty, "Couldn't delete “secret” because the folder isn't empty."));
        let err = AppError::io(Action::Save, p, &e(io::ErrorKind::StorageFull));
        assert_eq!(err.message, "Couldn't save “secret” because the disk is full.");
        assert_eq!(AppError::io(Action::Trash, p, &e(io::ErrorKind::ResourceBusy)).kind, Kind::InUse);
    }

    #[test]
    fn a_taken_name_keeps_the_wording_undo_matches() {
        let err = AppError::io(Action::Rename, Path::new("/d/b.txt"), &e(io::ErrorKind::AlreadyExists));
        assert_eq!((err.kind, err.message.as_str()), (Kind::Exists, "\"b.txt\" already exists in /d"));
    }

    #[test]
    fn other_errors_keep_the_os_text_without_its_code() {
        let raw = io::Error::other("Input/output error (os error 5)");
        let err = AppError::io(Action::Open, Path::new("/mnt/usb/f"), &raw);
        assert_eq!(err.kind, Kind::Other);
        assert_eq!(err.message, "Couldn't open “f”: Input/output error.");
        assert_eq!(err.detail, "/mnt/usb/f: Input/output error (os error 5)");
        let err = AppError::other(Action::Open, "/dev/sda", "a device, not a regular file");
        assert_eq!(err.message, "Couldn't open “sda”: a device, not a regular file.");
    }

    #[test]
    fn a_root_is_named_by_its_path() {
        let err = AppError::io(Action::Open, Path::new("/"), &e(io::ErrorKind::PermissionDenied));
        assert_eq!(err.message, "Couldn't open “/” because you don't have permission.");
    }

    #[test]
    fn strings_convert_unchanged_and_cancelled_is_recognised() {
        let err = AppError::from("something odd".to_string());
        assert_eq!((err.kind, err.message.as_str(), err.detail.as_str()), (Kind::Other, "something odd", "something odd"));
        assert_eq!(AppError::from(CANCELLED.to_string()).kind, Kind::Cancelled);
    }

    #[test]
    fn it_serializes_as_the_page_reads_it() {
        let err = AppError::io(Action::Open, Path::new("/x/y"), &e(io::ErrorKind::NotFound));
        let v = serde_json::to_value(&err).unwrap();
        assert_eq!(v["kind"], "notFound");
        assert_eq!(v["path"], "/x/y");
        assert_eq!(v["message"], "Couldn't open “y” because it isn't there anymore.");
        assert!(v["detail"].is_string());
        let v = serde_json::to_value(AppError::missing_tool("Needs 7-Zip.", &["7z", "7zz"])).unwrap();
        assert_eq!((v["kind"].as_str(), v["path"].is_null()), (Some("missingTool"), true));
        assert_eq!(v["detail"], "not found on PATH: 7z, 7zz");
    }
}
