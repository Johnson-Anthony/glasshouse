//! Find & Replace in Files. `replace_preview` lists what a replace would
//! change and what it would leave alone; `replace_apply` changes the files
//! the user confirmed. Both match with one rule, on bytes. Only valid UTF-8
//! text is changed, and each file is written through a temp file in its
//! folder and a rename, so a failure leaves the old file whole.
//! `rewrite_text` writes an undo or redo back the same way.
//! See docs/decisions/2026-11-12-find-replace-safety-design.md.

use std::fs::{File, Metadata};
use std::io::{self, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};

use grep_regex::{RegexMatcher, RegexMatcherBuilder};
use grep_searcher::{BinaryDetection, Searcher, SearcherBuilder, Sink, SinkMatch};
use regex::bytes::{NoExpand, Regex, RegexBuilder};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};

use super::fs_ops::ensure_regular;
use crate::ops::{Op, OpRegistry};

/// Larger files are left alone (and listed): a file is read whole, and its
/// replaced copy is built in memory beside it.
const MAX_FILE_BYTES: u64 = 16 << 20;
/// A preview stops after this many files with matches, changed or not.
const MAX_FILES: usize = 500;
/// The most text, old and new together, an apply returns for undo.
const UNDO_KEEP_MAX: u64 = 8 << 20;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplaceRequest {
    pub root: String,
    pub query: String,
    pub replacement: String,
    pub case_insensitive: bool,
}

#[derive(Debug, Serialize, Clone, PartialEq)]
pub struct PlannedFile {
    pub path: String,
    pub matches: u32,
    /// The file's size now, and after the replace.
    pub bytes: u64,
    pub new_bytes: u64,
}

#[derive(Debug, Serialize, Clone, PartialEq)]
pub struct SkippedFile {
    pub path: String,
    pub reason: String,
}

#[derive(Debug, Serialize, Default)]
pub struct ReplacePlan {
    pub files: Vec<PlannedFile>,
    /// Files with a match that won't be changed, and why.
    pub skipped: Vec<SkippedFile>,
    /// The walk stopped at `cap` files with matches, and there are more.
    pub capped: bool,
    pub cap: u32,
    /// The old and new text of every planned file fit the undo budget.
    pub undoable: bool,
}

#[derive(Debug, Serialize)]
pub struct ChangedFile {
    pub path: String,
    pub matches: u32,
    /// The whole old and new text, when kept for undo.
    pub before: Option<String>,
    pub after: Option<String>,
}

#[derive(Debug, Serialize, Default)]
pub struct ReplaceOutcome {
    pub changed: Vec<ChangedFile>,
    /// Confirmed files that weren't changed, and why.
    pub skipped: Vec<SkippedFile>,
    /// Cancelled between files: `changed` is what was done before it.
    pub cancelled: bool,
}

/// What replacing `request.query` under `request.root` would do. With
/// `op_id` it reports files searched and can be cancelled.
#[tauri::command(async)]
pub fn replace_preview(
    app: AppHandle,
    ops: State<'_, OpRegistry>,
    request: ReplaceRequest,
    op_id: Option<String>,
) -> Result<ReplacePlan, String> {
    plan_replace(&request, &ops.start(op_id, &app))
}

/// Replace in `paths`, the files a preview listed and the user confirmed.
/// With `keep_content`, each changed file's old and new text come back for
/// undo while they fit `UNDO_KEEP_MAX`. A cancel stops between files and
/// still returns what was changed.
#[tauri::command(async)]
pub fn replace_apply(
    app: AppHandle,
    ops: State<'_, OpRegistry>,
    request: ReplaceRequest,
    paths: Vec<String>,
    keep_content: bool,
    op_id: Option<String>,
) -> Result<ReplaceOutcome, String> {
    apply_replace(&request, &paths, keep_content, &ops.start(op_id, &app))
}

/// Replace an existing file's text with `content`, as `replace_apply`
/// writes: atomically, keeping its permissions. Undo and redo of a replace
/// use it. Refuses links, special files and read-only files.
#[tauri::command(async)]
pub fn rewrite_text(path: String, content: String) -> Result<(), String> {
    let target = Path::new(&path);
    let opened = open_candidate(target).map_err(|e| e.to_string())?;
    if let Some(problem) = write_problem(&opened) {
        return Err(problem);
    }
    let Opened { file, meta, .. } = opened;
    drop(file);
    write_replacing(target, &meta, content.as_bytes()).map_err(|e| e.to_string())
}

/// The one matching rule, for counting and replacing: `query` as literal
/// text, ignoring case if asked. `find` spots files with a match the way
/// Find in Files does, reading as little as it can; `exact` counts and
/// replaces in a file read whole. Both come from the same pattern and flags.
struct Matchers {
    find: RegexMatcher,
    exact: Regex,
}

impl Matchers {
    fn new(query: &str, case_insensitive: bool) -> Result<Self, String> {
        if query.is_empty() {
            return Err("nothing to search for".into());
        }
        // The line-by-line search can't match across a line break.
        if query.contains('\n') {
            return Err("the search text can't span lines".into());
        }
        let pattern = regex::escape(query);
        let find = RegexMatcherBuilder::new()
            .case_insensitive(case_insensitive)
            .build(&pattern)
            .map_err(|e| format!("regex build: {}", e))?;
        let exact = RegexBuilder::new(&pattern)
            .case_insensitive(case_insensitive)
            .build()
            .map_err(|e| format!("regex build: {}", e))?;
        Ok(Matchers { find, exact })
    }
}

/// A sink that stops the search at the first match.
#[derive(Default)]
struct FirstMatch(bool);

impl Sink for FirstMatch {
    type Error = io::Error;
    fn matched(&mut self, _: &Searcher, _: &SinkMatch<'_>) -> Result<bool, io::Error> {
        self.0 = true;
        Ok(false)
    }
}

fn plan_replace(request: &ReplaceRequest, op: &Op) -> Result<ReplacePlan, String> {
    let m = Matchers::new(&request.query, request.case_insensitive)?;
    let with = request.replacement.as_bytes();
    let mut plan = ReplacePlan {
        cap: MAX_FILES as u32,
        ..Default::default()
    };
    // In name order, one file at a time, so a capped preview lists the same
    // files each time. Links aren't followed, as in Find in Files.
    let walker = ignore::WalkBuilder::new(&request.root)
        .standard_filters(true)
        .sort_by_file_name(|a, b| a.cmp(b))
        .build();
    let mut searcher = SearcherBuilder::new()
        .binary_detection(BinaryDetection::quit(b'\0'))
        .build();
    for entry in walker {
        op.check()?;
        let Ok(entry) = entry else { continue };
        if !entry.file_type().is_some_and(|t| t.is_file()) {
            continue;
        }
        op.advance(1);
        let path = entry.path();
        // A file that can't be opened can't be searched, as in Find in Files.
        let Ok(mut opened) = open_candidate(path) else { continue };
        let mut found = FirstMatch::default();
        if searcher.search_file(&m.find, &opened.file, &mut found).is_err() || !found.0 {
            continue;
        }
        if plan.files.len() + plan.skipped.len() >= MAX_FILES {
            plan.capped = true;
            break;
        }
        let shown = path.to_string_lossy().into_owned();
        match changeable(&mut opened) {
            Ok(text) => {
                let (matches, new_bytes) = count(&m.exact, &text, with);
                if matches > 0 {
                    plan.files.push(PlannedFile { path: shown, matches, bytes: text.len() as u64, new_bytes });
                }
            }
            Err(reason) => plan.skipped.push(SkippedFile { path: shown, reason }),
        }
    }
    let kept: u64 = plan.files.iter().map(|f| f.bytes + f.new_bytes).sum();
    plan.undoable = kept <= UNDO_KEEP_MAX;
    Ok(plan)
}

fn apply_replace(request: &ReplaceRequest, paths: &[String], keep_content: bool, op: &Op) -> Result<ReplaceOutcome, String> {
    let m = Matchers::new(&request.query, request.case_insensitive)?;
    let with = request.replacement.as_bytes();
    let root = std::fs::canonicalize(&request.root).map_err(|e| format!("{}: {}", request.root, e))?;
    let mut out = ReplaceOutcome::default();
    let (mut keep, mut kept) = (keep_content, 0u64);
    op.set_total(paths.len() as u64);
    for p in paths {
        if op.cancelled() {
            out.cancelled = true;
            break;
        }
        match replace_one(&root, Path::new(p), &m.exact, with) {
            Ok(Some((matches, before, after))) => {
                kept += (before.len() + after.len()) as u64;
                keep = keep && kept <= UNDO_KEEP_MAX;
                let (before, after) = if keep { (Some(before), Some(after)) } else { (None, None) };
                out.changed.push(ChangedFile { path: p.clone(), matches, before, after });
            }
            Ok(None) => out.skipped.push(SkippedFile { path: p.clone(), reason: "no longer has a match".into() }),
            Err(reason) => out.skipped.push(SkippedFile { path: p.clone(), reason }),
        }
        op.advance(1);
    }
    Ok(out)
}

/// Replace in one confirmed file: its match count and old and new text, or
/// None if it no longer has a match, or why it wasn't changed.
fn replace_one(root: &Path, path: &Path, re: &Regex, with: &[u8]) -> Result<Option<(u32, String, String)>, String> {
    let target = inside(root, path)?;
    let mut opened = open_candidate(&target).map_err(|e| e.to_string())?;
    let text = changeable(&mut opened)?;
    let matches = re.find_iter(&text).count() as u32;
    if matches == 0 {
        return Ok(None);
    }
    let after = re.replace_all(&text, NoExpand(with)).into_owned();
    let before = String::from_utf8(text).map_err(|_| "not UTF-8 text".to_string())?;
    let after = String::from_utf8(after).map_err(|_| "the result wouldn't be UTF-8 text".to_string())?;
    let Opened { file, meta, .. } = opened;
    drop(file);
    write_replacing(&target, &meta, after.as_bytes()).map_err(|e| e.to_string())?;
    Ok(Some((matches, before, after)))
}

/// `path` with its folder resolved, if that folder is `root` or inside it.
/// Links in the folder part are resolved first, so none can lead out of
/// `root`; the file itself must not be a link (`open_candidate`).
fn inside(root: &Path, path: &Path) -> Result<PathBuf, String> {
    let (Some(dir), Some(name)) = (path.parent(), path.file_name()) else {
        return Err("not a file path".into());
    };
    let dir = std::fs::canonicalize(dir).map_err(|e| e.to_string())?;
    if !dir.starts_with(root) {
        return Err("outside the folder being searched".into());
    }
    Ok(dir.join(name))
}

/// A file opened for a replace, and what was seen of it.
struct Opened {
    file: File,
    meta: Metadata,
    /// Why it couldn't be opened for writing, if it couldn't.
    unwritable: Option<String>,
}

/// Open `path` if it's a regular file and not a link. That's checked before
/// the open, so a device or FIFO is never opened, and again on the open
/// file. Unix opens with `O_NOFOLLOW`, so a link swapped in after the check
/// fails, and `O_NONBLOCK`, so a FIFO swapped in doesn't block (the flag
/// does nothing to a regular file's reads). It's opened for writing when
/// it can be, which tells whether it's read-only (or, on Windows, locked by
/// another program), and is never written through: the replace goes to a
/// new file. One that can only be read is still opened, to be searched.
fn open_candidate(path: &Path) -> io::Result<Opened> {
    let ty = std::fs::symlink_metadata(path)?.file_type();
    if ty.is_symlink() {
        return Err(io::Error::new(io::ErrorKind::InvalidInput, "a link, not a regular file"));
    }
    ensure_regular(&ty)?;
    let open = |write: bool| {
        let mut opts = std::fs::OpenOptions::new();
        opts.read(true).write(write);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            opts.custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK);
        }
        opts.open(path)
    };
    let (file, unwritable) = match open(true) {
        Ok(f) => (f, None),
        Err(e) => {
            let why = match e.kind() {
                io::ErrorKind::PermissionDenied | io::ErrorKind::ReadOnlyFilesystem => "read-only".to_string(),
                _ => format!("can't be written ({})", e),
            };
            (open(false)?, Some(why))
        }
    };
    let meta = file.metadata()?;
    ensure_regular(&meta.file_type())?;
    Ok(Opened { file, meta, unwritable })
}

/// The whole of an opened file, if a replace may change it, or why not.
fn changeable(opened: &mut Opened) -> Result<Vec<u8>, String> {
    let too_large = || format!("too large (over {} MiB)", MAX_FILE_BYTES >> 20);
    if opened.meta.len() > MAX_FILE_BYTES {
        return Err(too_large());
    }
    let mut text = Vec::with_capacity(opened.meta.len() as usize);
    opened
        .file
        .seek(SeekFrom::Start(0))
        .and_then(|_| (&opened.file).take(MAX_FILE_BYTES + 1).read_to_end(&mut text))
        .map_err(|e| e.to_string())?;
    if text.len() as u64 > MAX_FILE_BYTES {
        return Err(too_large());
    }
    if let Some(problem) = text_problem(&text) {
        return Err(problem.into());
    }
    match write_problem(opened) {
        Some(problem) => Err(problem),
        None => Ok(text),
    }
}

/// Why `bytes` can't be changed as UTF-8 text, if they can't. Writing back
/// text decoded any other way would change the bytes around the matches.
fn text_problem(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(&[0xFF, 0xFE]) || bytes.starts_with(&[0xFE, 0xFF]) {
        Some("UTF-16 text, not UTF-8")
    } else if bytes.contains(&0) {
        Some("binary (has NUL bytes)")
    } else if std::str::from_utf8(bytes).is_err() {
        Some("not UTF-8 text")
    } else {
        None
    }
}

/// Why an opened file can't be replaced, if it can't: it can't be written,
/// or on unix it has other hard links, which the rename would split from it.
fn write_problem(opened: &Opened) -> Option<String> {
    if let Some(why) = &opened.unwritable {
        return Some(why.clone());
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        let links = opened.meta.nlink();
        if links > 1 {
            return Some(format!("has {} hard links, which replacing it would split", links));
        }
    }
    None
}

/// How many matches `text` has, and its size once each is replaced by `with`.
fn count(re: &Regex, text: &[u8], with: &[u8]) -> (u32, u64) {
    let (mut matches, mut size) = (0u32, text.len() as u64);
    for m in re.find_iter(text) {
        matches += 1;
        size += with.len() as u64;
        size -= m.len() as u64;
    }
    (matches, size)
}

/// Give `target` the content `body`. It's written to a new temp file in
/// the same folder, which gets the old file's permissions (on unix its
/// owner and group too) and is synced, then renamed over `target`, so a
/// crash or a full disk leaves the old file whole. `seen` is the old file
/// as it was read: if it has changed since, nothing is replaced.
fn write_replacing(target: &Path, seen: &Metadata, body: &[u8]) -> io::Result<()> {
    let dir = target.parent().ok_or_else(|| io::Error::other("no parent folder"))?;
    let (tmp, file) = create_temp(dir)?;
    if let Err(e) = fill(file, seen, body).and_then(|()| unchanged(target, seen)) {
        let _ = std::fs::remove_file(&tmp);
        return Err(e);
    }
    swap_in(&tmp, target)?;
    #[cfg(unix)]
    let _ = File::open(dir).and_then(|d| d.sync_all());
    Ok(())
}

/// A new, empty file in `dir`, hidden on unix by its leading dot and
/// readable only by the user until `fill` sets the old file's mode.
fn create_temp(dir: &Path) -> io::Result<(PathBuf, File)> {
    use std::sync::atomic::{AtomicU32, Ordering};
    static NEXT: AtomicU32 = AtomicU32::new(0);
    for _ in 0..1000 {
        let n = NEXT.fetch_add(1, Ordering::Relaxed);
        let p = dir.join(format!(".glasshouse-replace-{}-{}", std::process::id(), n));
        let mut opts = std::fs::OpenOptions::new();
        opts.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            opts.mode(0o600);
        }
        match opts.open(&p) {
            Ok(f) => return Ok((p, f)),
            Err(e) if e.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(e),
        }
    }
    Err(io::Error::other(format!("couldn't make a temp file in {}", dir.display())))
}

fn fill(mut file: File, seen: &Metadata, body: &[u8]) -> io::Result<()> {
    file.write_all(body)?;
    #[cfg(unix)]
    keep_owner(&file, seen)?;
    // After the chown, which clears setuid and setgid.
    file.set_permissions(seen.permissions())?;
    file.sync_all()
}

/// Give the temp file the old file's owner and group where they differ
/// from its own. A file someone else owns (writable through its group)
/// can't be given back to them without root, so it fails instead of
/// changing hands.
#[cfg(unix)]
fn keep_owner(file: &File, seen: &Metadata) -> io::Result<()> {
    use std::os::unix::fs::MetadataExt;
    let now = file.metadata()?;
    if now.uid() == seen.uid() && now.gid() == seen.gid() {
        return Ok(());
    }
    std::os::unix::fs::fchown(file, Some(seen.uid()), Some(seen.gid()))
        .map_err(|e| io::Error::new(e.kind(), format!("couldn't keep its owner and group ({})", e)))
}

/// Fails unless `target` is still the file `seen` describes, unmodified.
fn unchanged(target: &Path, seen: &Metadata) -> io::Result<()> {
    let now = std::fs::symlink_metadata(target)?;
    let same = now.len() == seen.len() && now.modified().ok() == seen.modified().ok() && same_identity(&now, seen);
    if same {
        Ok(())
    } else {
        Err(io::Error::other("it changed while it was being replaced"))
    }
}

#[cfg(unix)]
fn same_identity(now: &Metadata, seen: &Metadata) -> bool {
    use std::os::unix::fs::MetadataExt;
    now.dev() == seen.dev() && now.ino() == seen.ino()
}

#[cfg(not(unix))]
fn same_identity(now: &Metadata, _seen: &Metadata) -> bool {
    now.file_type().is_file()
}

/// Rename the filled temp file over `target`. On failure the temp file is
/// removed and `target` is as it was.
#[cfg(not(windows))]
fn swap_in(tmp: &Path, target: &Path) -> io::Result<()> {
    std::fs::rename(tmp, target).inspect_err(|_| {
        let _ = std::fs::remove_file(tmp);
    })
}

/// ReplaceFileW rather than a rename: it moves the old file's attributes,
/// ACLs and streams (the Mark-of-the-Web among them) onto the new one, so
/// a replace doesn't unhide a hidden file or unmark a downloaded one.
/// Merge errors are ignored, as on a share that won't take the ACLs.
#[cfg(windows)]
fn swap_in(tmp: &Path, target: &Path) -> io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::ERROR_UNABLE_TO_MOVE_REPLACEMENT;
    use windows::Win32::Storage::FileSystem::{ReplaceFileW, REPLACEFILE_IGNORE_MERGE_ERRORS};
    let wide = |p: &Path| -> Vec<u16> { p.as_os_str().encode_wide().chain(Some(0)).collect() };
    let (t, r) = (wide(target), wide(tmp));
    // SAFETY: both strings are NUL-terminated and outlive the call; there's
    // no backup name, and the reserved pointers are null.
    let replaced = unsafe {
        ReplaceFileW(PCWSTR(t.as_ptr()), PCWSTR(r.as_ptr()), PCWSTR::null(), REPLACEFILE_IGNORE_MERGE_ERRORS, None, None)
    };
    let Err(e) = replaced else { return Ok(()) };
    // A Win32 error HRESULT carries the Win32 code in its low 16 bits.
    let code = (e.code().0 & 0xFFFF) as u32;
    if code == ERROR_UNABLE_TO_MOVE_REPLACEMENT.0 {
        // With no backup name this means the old file is gone and the new
        // text is still under the temp name, so the temp file is all there is.
        return std::fs::rename(tmp, target).map_err(|e| {
            io::Error::other(format!("the new text couldn't be moved into place and is in {} ({})", tmp.display(), e))
        });
    }
    // Any other failure leaves both files under their own names.
    let _ = std::fs::remove_file(tmp);
    Err(io::Error::from_raw_os_error(code as i32))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::testing::{put, read, s, tree, Scratch};
    use crate::ops::testing::{cancels_at_first_event, events, recorded};
    use crate::ops::CANCELLED;
    use std::sync::Arc;
    use std::time::Duration;

    fn req(root: &Path, query: &str, replacement: &str, case_insensitive: bool) -> ReplaceRequest {
        ReplaceRequest { root: s(root), query: query.into(), replacement: replacement.into(), case_insensitive }
    }

    fn preview(root: &Path, query: &str, replacement: &str) -> ReplacePlan {
        plan_replace(&req(root, query, replacement, false), &Op::untracked()).unwrap()
    }

    /// Preview, then apply to every planned file.
    fn replace(root: &Path, query: &str, replacement: &str, case_insensitive: bool) -> (ReplacePlan, ReplaceOutcome) {
        let r = req(root, query, replacement, case_insensitive);
        let plan = plan_replace(&r, &Op::untracked()).unwrap();
        let paths: Vec<String> = plan.files.iter().map(|f| f.path.clone()).collect();
        let out = apply_replace(&r, &paths, true, &Op::untracked()).unwrap();
        (plan, out)
    }

    fn names(root: &Path, paths: impl IntoIterator<Item = String>) -> Vec<String> {
        paths
            .into_iter()
            .map(|p| Path::new(&p).strip_prefix(root).unwrap().to_string_lossy().replace('\\', "/"))
            .collect()
    }

    #[test]
    fn replaces_utf8_text_and_reports_counts() {
        let d = Scratch::new("replace-basic");
        put(&d.join("a.txt"), "foo bar foo\r\nfoo\n");
        put(&d.join("sub/b.md"), "\u{feff}café foo");
        put(&d.join("c.txt"), "nothing here");
        let (plan, out) = replace(d.path(), "foo", "quux", false);
        assert_eq!(names(d.path(), plan.files.iter().map(|f| f.path.clone())), ["a.txt", "sub/b.md"]);
        assert_eq!(plan.files[0].matches, 3);
        assert_eq!(plan.files[0].bytes, 17);
        assert_eq!(plan.files[0].new_bytes, 17 + 3);
        assert!(plan.skipped.is_empty() && !plan.capped && plan.undoable);

        assert_eq!(out.changed.len(), 2);
        // Line endings and the BOM are bytes like any other: kept.
        assert_eq!(read(&d.join("a.txt")), "quux bar quux\r\nquux\n");
        assert_eq!(read(&d.join("sub/b.md")), "\u{feff}café quux");
        assert_eq!(read(&d.join("c.txt")), "nothing here");
        assert_eq!(out.changed[0].before.as_deref(), Some("foo bar foo\r\nfoo\n"));
        assert_eq!(out.changed[0].after.as_deref(), Some("quux bar quux\r\nquux\n"));
        // No temp file is left behind.
        assert_eq!(tree(d.path()), ["a.txt", "c.txt", "sub/", "sub/b.md"]);
    }

    #[test]
    fn files_that_arent_utf8_text_are_listed_and_left_byte_for_byte() {
        let d = Scratch::new("replace-encodings");
        let latin1 = b"caf\xe9 foo\n".to_vec();
        let utf16: Vec<u8> = [0xFF, 0xFE].into_iter().chain("foo".encode_utf16().flat_map(u16::to_le_bytes)).collect();
        let binary = b"foo\0\x01\x02".to_vec();
        std::fs::write(d.join("latin1.txt"), &latin1).unwrap();
        std::fs::write(d.join("utf16.txt"), &utf16).unwrap();
        std::fs::write(d.join("blob.bin"), &binary).unwrap();
        put(&d.join("ok.txt"), "foo");

        let (plan, out) = replace(d.path(), "foo", "bar", false);
        let skipped: Vec<(String, String)> = plan
            .skipped
            .iter()
            .map(|f| (names(d.path(), [f.path.clone()]).remove(0), f.reason.clone()))
            .collect();
        assert!(skipped.contains(&("latin1.txt".into(), "not UTF-8 text".into())), "{:?}", skipped);
        assert!(skipped.contains(&("utf16.txt".into(), "UTF-16 text, not UTF-8".into())), "{:?}", skipped);
        // The binary file stops the quick search at its NUL, or is listed;
        // either way it isn't planned.
        assert_eq!(names(d.path(), plan.files.iter().map(|f| f.path.clone())), ["ok.txt"]);
        assert_eq!(out.changed.len(), 1);
        assert_eq!(std::fs::read(d.join("latin1.txt")).unwrap(), latin1);
        assert_eq!(std::fs::read(d.join("utf16.txt")).unwrap(), utf16);
        assert_eq!(std::fs::read(d.join("blob.bin")).unwrap(), binary);
        assert_eq!(read(&d.join("ok.txt")), "bar");

        // Asking for a file the preview didn't plan changes nothing either.
        let r = req(d.path(), "foo", "bar", false);
        let out = apply_replace(&r, &[s(&d.join("latin1.txt"))], true, &Op::untracked()).unwrap();
        assert!(out.changed.is_empty());
        assert_eq!(out.skipped[0].reason, "not UTF-8 text");
        assert_eq!(std::fs::read(d.join("latin1.txt")).unwrap(), latin1);
    }

    #[test]
    fn counting_and_replacing_follow_one_case_rule() {
        let d = Scratch::new("replace-case");
        put(&d.join("a.txt"), "Foo foo FOO");
        let plan = preview(d.path(), "foo", "x");
        assert_eq!(plan.files[0].matches, 1);
        let (plan, _) = replace(d.path(), "foo", "x", false);
        assert_eq!(plan.files[0].matches, 1);
        assert_eq!(read(&d.join("a.txt")), "Foo x FOO");

        put(&d.join("a.txt"), "Foo foo FOO");
        let (plan, out) = replace(d.path(), "foo", "x", true);
        assert_eq!(plan.files[0].matches, 3);
        assert_eq!(out.changed[0].matches, 3);
        assert_eq!(read(&d.join("a.txt")), "x x x");

        // A file whose only match differs in case isn't listed at all
        // when case counts.
        put(&d.join("a.txt"), "FOO");
        assert!(preview(d.path(), "foo", "x").files.is_empty());
    }

    #[test]
    fn a_preview_stops_at_the_cap_and_says_so() {
        let d = Scratch::new("replace-cap");
        for i in 0..MAX_FILES + 2 {
            put(&d.join(format!("f{:04}.txt", i)), "needle");
        }
        let plan = preview(d.path(), "needle", "pin");
        assert!(plan.capped);
        assert_eq!(plan.files.len(), MAX_FILES);
        // In name order, so the same files each time.
        assert!(plan.files[0].path.ends_with("f0000.txt"));
        assert!(plan.files[MAX_FILES - 1].path.ends_with(&format!("f{:04}.txt", MAX_FILES - 1)));

        // Exactly at the cap isn't capped: nothing was left out.
        std::fs::remove_file(d.join(format!("f{:04}.txt", MAX_FILES))).unwrap();
        std::fs::remove_file(d.join(format!("f{:04}.txt", MAX_FILES + 1))).unwrap();
        let plan = preview(d.path(), "needle", "pin");
        assert!(!plan.capped);
        assert_eq!(plan.files.len(), MAX_FILES);
    }

    #[test]
    fn large_files_are_listed_not_read_and_undo_text_has_a_budget() {
        let d = Scratch::new("replace-large");
        let big = format!("needle{}", "x".repeat(MAX_FILE_BYTES as usize));
        put(&d.join("big.txt"), &big);
        let plan = preview(d.path(), "needle", "pin");
        assert!(plan.files.is_empty());
        assert_eq!(plan.skipped[0].reason, "too large (over 16 MiB)");

        // Three 3 MiB files: the third's old and new text pass the budget.
        std::fs::remove_file(d.join("big.txt")).unwrap();
        let body = format!("needle{}", "x".repeat(3 << 20));
        for n in ["a.txt", "b.txt", "c.txt"] {
            put(&d.join(n), &body);
        }
        let (plan, out) = replace(d.path(), "needle", "pin", false);
        assert!(!plan.undoable);
        assert_eq!(out.changed.len(), 3);
        assert!(out.changed[0].before.is_some());
        assert!(out.changed[2].before.is_none() && out.changed[2].after.is_none());
    }

    #[cfg(unix)]
    #[test]
    fn the_file_is_replaced_whole_and_keeps_its_mode() {
        use std::os::unix::fs::{MetadataExt, PermissionsExt};
        let d = Scratch::new("replace-atomic");
        let f = d.join("script.sh");
        put(&f, "echo foo\n");
        std::fs::set_permissions(&f, std::fs::Permissions::from_mode(0o751)).unwrap();
        let ino = std::fs::metadata(&f).unwrap().ino();
        // Someone holding the old file open still reads the old text: the
        // new text went to a new file, renamed into place.
        let mut held = File::open(&f).unwrap();
        replace(d.path(), "foo", "bar", false);
        let meta = std::fs::metadata(&f).unwrap();
        assert_ne!(meta.ino(), ino);
        assert_eq!(meta.permissions().mode() & 0o7777, 0o751);
        let mut old = String::new();
        held.read_to_string(&mut old).unwrap();
        assert_eq!(old, "echo foo\n");
        assert_eq!(read(&f), "echo bar\n");
    }

    #[cfg(unix)]
    #[test]
    fn a_failed_write_leaves_the_old_file_and_no_temp() {
        use std::os::unix::fs::PermissionsExt;
        let d = Scratch::new("replace-fail");
        put(&d.join("sub/a.txt"), "foo");
        let r = req(d.path(), "foo", "bar", false);
        let plan = plan_replace(&r, &Op::untracked()).unwrap();
        // A folder the temp file can't be made in.
        std::fs::set_permissions(d.join("sub"), std::fs::Permissions::from_mode(0o555)).unwrap();
        let paths = vec![plan.files[0].path.clone()];
        let out = apply_replace(&r, &paths, true, &Op::untracked()).unwrap();
        std::fs::set_permissions(d.join("sub"), std::fs::Permissions::from_mode(0o755)).unwrap();
        if out.changed.is_empty() {
            // (Root can write anywhere; then this proves nothing.)
            assert!(out.skipped[0].reason.contains("ermission denied"), "{:?}", out.skipped);
            assert_eq!(read(&d.join("sub/a.txt")), "foo");
            assert_eq!(tree(d.path()), ["sub/", "sub/a.txt"]);
        }
    }

    #[cfg(unix)]
    #[test]
    fn read_only_and_hard_linked_files_are_listed_not_changed() {
        use std::os::unix::fs::PermissionsExt;
        let d = Scratch::new("replace-readonly");
        put(&d.join("ro.txt"), "foo");
        std::fs::set_permissions(d.join("ro.txt"), std::fs::Permissions::from_mode(0o444)).unwrap();
        put(&d.join("linked.txt"), "foo");
        std::fs::hard_link(d.join("linked.txt"), d.join("other-name.txt")).unwrap();
        let plan = preview(d.path(), "foo", "bar");
        assert!(plan.files.is_empty(), "{:?}", plan.files);
        let reasons: Vec<&str> = plan.skipped.iter().map(|f| f.reason.as_str()).collect();
        assert!(reasons.contains(&"has 2 hard links, which replacing it would split"), "{:?}", reasons);
        // Root can open a 0444 file for writing. SAFETY: geteuid takes
        // nothing and can't fail.
        if unsafe { libc::geteuid() } != 0 {
            assert!(reasons.contains(&"read-only"), "{:?}", reasons);
        }
        assert_eq!(read(&d.join("ro.txt")), "foo");
        assert_eq!(read(&d.join("other-name.txt")), "foo");
    }

    #[cfg(unix)]
    #[test]
    fn links_and_paths_outside_the_root_are_refused() {
        let d = Scratch::new("replace-links");
        let outside = Scratch::new("replace-links-outside");
        put(&outside.join("secret.txt"), "foo");
        put(&d.join("root/in.txt"), "foo");
        std::os::unix::fs::symlink(outside.join("secret.txt"), d.join("root/link.txt")).unwrap();
        std::os::unix::fs::symlink(outside.path(), d.join("root/dirlink")).unwrap();
        let root = d.join("root");

        // The walk doesn't follow links.
        let plan = preview(&root, "foo", "bar");
        assert_eq!(names(&root, plan.files.iter().map(|f| f.path.clone())), ["in.txt"]);

        // Nor does apply, whatever it's handed.
        let r = req(&root, "foo", "bar", false);
        let asked = vec![
            s(&root.join("link.txt")),
            s(&root.join("dirlink/secret.txt")),
            s(&outside.join("secret.txt")),
            s(&root.join("../root/../../escape.txt")),
        ];
        let out = apply_replace(&r, &asked, true, &Op::untracked()).unwrap();
        assert!(out.changed.is_empty());
        let reasons: Vec<&str> = out.skipped.iter().map(|f| f.reason.as_str()).collect();
        assert_eq!(reasons[0], "a link, not a regular file");
        assert_eq!(reasons[1], "outside the folder being searched");
        assert_eq!(reasons[2], "outside the folder being searched");
        assert_eq!(read(&outside.join("secret.txt")), "foo");

        // rewrite_text won't write through a link either.
        let err = rewrite_text(s(&root.join("link.txt")), "x".into()).unwrap_err();
        assert!(err.contains("a link"), "{}", err);
        assert_eq!(read(&outside.join("secret.txt")), "foo");
    }

    #[cfg(unix)]
    #[test]
    fn a_fifo_is_refused_without_blocking() {
        use crate::commands::testing::{mkfifo, without_blocking};
        let d = Scratch::new("replace-fifo");
        mkfifo(&d.join("pipe"));
        let root = d.path().to_path_buf();
        let out = without_blocking(move || {
            let r = req(&root, "foo", "bar", false);
            apply_replace(&r, &[s(&root.join("pipe"))], true, &Op::untracked()).unwrap()
        });
        assert_eq!(out.skipped[0].reason, "a named pipe, not a regular file");
        let path = s(&d.join("pipe"));
        let err = without_blocking(move || rewrite_text(path, "x".into()).unwrap_err());
        assert!(err.contains("named pipe"), "{}", err);
    }

    #[test]
    fn rewrite_text_replaces_an_existing_file_only() {
        let d = Scratch::new("replace-rewrite");
        put(&d.join("a.txt"), "old");
        rewrite_text(s(&d.join("a.txt")), "new".into()).unwrap();
        assert_eq!(read(&d.join("a.txt")), "new");
        assert!(rewrite_text(s(&d.join("missing.txt")), "new".into()).is_err());
        assert!(!d.join("missing.txt").exists());
        assert!(rewrite_text(s(d.path()), "new".into()).is_err());
        assert_eq!(tree(d.path()), ["a.txt"]);
    }

    #[test]
    fn a_file_changed_after_it_was_read_isnt_replaced() {
        let d = Scratch::new("replace-raced");
        put(&d.join("a.txt"), "foo");
        let opened = open_candidate(&d.join("a.txt")).unwrap();
        put(&d.join("a.txt"), "foo, edited meanwhile");
        let err = write_replacing(&d.join("a.txt"), &opened.meta, b"bar").unwrap_err();
        assert_eq!(err.to_string(), "it changed while it was being replaced");
        assert_eq!(read(&d.join("a.txt")), "foo, edited meanwhile");
        assert_eq!(tree(d.path()), ["a.txt"]);
    }

    #[test]
    fn a_cancelled_apply_returns_what_it_changed() {
        let d = Scratch::new("replace-cancel");
        for n in ["a.txt", "b.txt", "c.txt"] {
            put(&d.join(n), "foo");
        }
        let r = req(d.path(), "foo", "bar", false);
        let plan = plan_replace(&r, &Op::untracked()).unwrap();
        let paths: Vec<String> = plan.files.iter().map(|f| f.path.clone()).collect();
        // Cancelled once the first file is done.
        let reg = Arc::new(OpRegistry::default());
        let canceller = Arc::clone(&reg);
        let op = reg.start_with(Some("r1".into()), Duration::ZERO, move |p| {
            if p.done >= 1 {
                canceller.cancel("r1");
            }
        });
        let out = apply_replace(&r, &paths, true, &op).unwrap();
        assert!(out.cancelled);
        assert_eq!(names(d.path(), out.changed.iter().map(|f| f.path.clone())), ["a.txt"]);
        assert_eq!(out.changed[0].before.as_deref(), Some("foo"));
        assert_eq!(read(&d.join("a.txt")), "bar");
        assert_eq!(read(&d.join("b.txt")), "foo");

        // A cancelled preview is "cancelled", like a cancelled search.
        let (_reg, op, _seen) = cancels_at_first_event("r2");
        assert_eq!(plan_replace(&r, &op).unwrap_err(), CANCELLED);
    }

    #[test]
    fn progress_counts_files() {
        let d = Scratch::new("replace-progress");
        put(&d.join("a.txt"), "foo");
        put(&d.join("b.txt"), "nothing");
        let r = req(d.path(), "foo", "bar", false);
        let (_reg, op, seen) = recorded("r3");
        let plan = plan_replace(&r, &op).unwrap();
        assert_eq!(events(&seen).iter().map(|p| p.done).max(), Some(2));
        let (_reg, op, seen) = recorded("r4");
        apply_replace(&r, &[plan.files[0].path.clone()], false, &op).unwrap();
        let seen = events(&seen);
        assert_eq!(seen.last().map(|p| (p.done, p.total)), Some((1, Some(1))));
    }

    #[test]
    fn bad_queries_are_refused() {
        let d = Scratch::new("replace-query");
        let op = Op::untracked();
        assert!(plan_replace(&req(d.path(), "", "x", false), &op).is_err());
        assert!(plan_replace(&req(d.path(), "a\nb", "x", false), &op).is_err());
        // Regex syntax is literal text.
        put(&d.join("a.txt"), "a.b axb (x)");
        let (plan, _) = replace(d.path(), "a.b", "y", false);
        assert_eq!(plan.files[0].matches, 1);
        replace(d.path(), "(x)", "$1", false);
        assert_eq!(read(&d.join("a.txt")), "y axb $1");
    }
}
