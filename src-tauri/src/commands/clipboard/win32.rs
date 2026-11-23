// The clipboard on Windows: CF_HDROP with "Preferred DropEffect", which is
// what Explorer writes and reads for Copy and Cut, and CF_UNICODETEXT for
// text. Thin calls around `formats.rs`, which builds and reads the blocks.
//
// Explorer offers no text with its files, so neither does this: an app
// that pastes text keeps doing so, and one that takes files gets files.
//
// Not built on Linux: CI's Windows jobs are its first compile, and
// docs/testing/windows.md has its hand checks.

use std::ffi::OsString;
use std::mem::ManuallyDrop;
use std::os::windows::ffi::OsStringExt;
use std::path::PathBuf;
use std::time::Duration;

use tauri::AppHandle;
use windows::core::{w, PCWSTR};
use windows::Win32::Foundation::{GlobalFree, HANDLE, HGLOBAL, HWND};
use windows::Win32::System::Com::{DVASPECT_CONTENT, FORMATETC, STGMEDIUM, STGMEDIUM_0, TYMED_HGLOBAL};
use windows::Win32::System::DataExchange::{
    CloseClipboard, EmptyClipboard, GetClipboardData, GetClipboardSequenceNumber, IsClipboardFormatAvailable, OpenClipboard,
    RegisterClipboardFormatW, SetClipboardData,
};
use windows::Win32::System::Memory::{GlobalAlloc, GlobalLock, GlobalSize, GlobalUnlock, GMEM_MOVEABLE};
use windows::Win32::System::Ole::{OleGetClipboard, CF_HDROP, CF_UNICODETEXT};
use windows::Win32::UI::Shell::{DragQueryFileW, HDROP};

use super::formats::{self, DROPEFFECT_MOVE, MAX_BYTES, MAX_FILES, MAX_TEXT_BYTES};
use super::Read;

const PREFERRED_DROP_EFFECT: PCWSTR = w!("Preferred DropEffect");
const PASTE_SUCCEEDED: PCWSTR = w!("Paste Succeeded");

/// The clipboard, open for this thread until dropped.
struct Open;

impl Open {
    /// Another app can have the clipboard open for a moment (a clipboard
    /// manager, a remote-desktop sync), so this tries for a quarter of a
    /// second before saying so.
    fn new() -> Result<Open, String> {
        for _ in 0..10 {
            if unsafe { OpenClipboard(HWND::default()) }.is_ok() {
                return Ok(Open);
            }
            std::thread::sleep(Duration::from_millis(25));
        }
        Err("another app is using the clipboard".into())
    }
}

impl Drop for Open {
    fn drop(&mut self) {
        let _ = unsafe { CloseClipboard() };
    }
}

/// A movable block holding `bytes`, as the clipboard and OLE take data.
unsafe fn block(bytes: &[u8]) -> Result<HGLOBAL, String> {
    let mem = GlobalAlloc(GMEM_MOVEABLE, bytes.len()).map_err(|e| e.to_string())?;
    let p = GlobalLock(mem);
    if p.is_null() {
        let _ = GlobalFree(mem);
        return Err("out of memory".into());
    }
    std::ptr::copy_nonoverlapping(bytes.as_ptr(), p.cast::<u8>(), bytes.len());
    // An "error" here is the lock count reaching zero.
    let _ = GlobalUnlock(mem);
    Ok(mem)
}

/// Puts `bytes` on the open clipboard as `format`. The clipboard owns the
/// block once it takes it.
unsafe fn set(format: u32, bytes: &[u8]) -> Result<(), String> {
    let mem = block(bytes)?;
    match SetClipboardData(format, HANDLE(mem.0)) {
        Ok(_) => Ok(()),
        Err(e) => {
            let _ = GlobalFree(mem);
            Err(e.to_string())
        }
    }
}

/// `format`'s bytes on the open clipboard: None when it isn't there, an
/// error when it's over `max`.
unsafe fn get(format: u32, max: usize) -> Result<Option<Vec<u8>>, String> {
    let Ok(handle) = GetClipboardData(format) else {
        return Ok(None);
    };
    let mem = HGLOBAL(handle.0);
    let size = GlobalSize(mem);
    if size > max {
        return Err("the clipboard holds too much".into());
    }
    let p = GlobalLock(mem);
    if p.is_null() {
        return Ok(None);
    }
    let bytes = std::slice::from_raw_parts(p.cast::<u8>(), size).to_vec();
    let _ = GlobalUnlock(mem);
    Ok(Some(bytes))
}

fn sequence() -> u32 {
    unsafe { GetClipboardSequenceNumber() }
}

pub(super) fn write_files(app: &AppHandle, id: u64, paths: &[PathBuf], cut: bool, held: Vec<String>) -> Result<(), String> {
    let names: Vec<String> = paths.iter().map(|p| p.to_string_lossy().into_owned()).collect();
    let files = formats::dropfiles(&names);
    unsafe {
        let _open = Open::new()?;
        EmptyClipboard().map_err(|e| e.to_string())?;
        // Whatever glasshouse had there is gone now, written or not.
        super::emptied(app);
        set(u32::from(CF_HDROP.0), &files)?;
        set(RegisterClipboardFormatW(PREFERRED_DROP_EFFECT), &formats::preferred_drop_effect(cut))?;
    }
    // Read once the clipboard is closed, when the write is complete.
    super::took(app, id, held, sequence());
    Ok(())
}

pub(super) fn read_files(_app: &AppHandle) -> Result<Option<Read>, String> {
    unsafe {
        if IsClipboardFormatAvailable(u32::from(CF_HDROP.0)).is_err() {
            return Ok(None);
        }
        let _open = Open::new()?;
        let stamp = sequence();
        let Ok(handle) = GetClipboardData(u32::from(CF_HDROP.0)) else {
            return Ok(None);
        };
        if GlobalSize(HGLOBAL(handle.0)) > MAX_BYTES {
            return Err("the clipboard holds too much".into());
        }
        let drop = HDROP(handle.0);
        let count = DragQueryFileW(drop, u32::MAX, None);
        if count as usize > MAX_FILES {
            return Err(format!("the clipboard holds {count} files"));
        }
        let mut paths = Vec::with_capacity(count as usize);
        let mut other = 0;
        for i in 0..count {
            let len = DragQueryFileW(drop, i, None) as usize;
            let mut name = vec![0u16; len + 1];
            let got = DragQueryFileW(drop, i, Some(&mut name)) as usize;
            let path = PathBuf::from(OsString::from_wide(&name[..got.min(len)]));
            if path.is_absolute() {
                paths.push(path);
            } else {
                other += 1;
            }
        }
        let cut = get(RegisterClipboardFormatW(PREFERRED_DROP_EFFECT), 64).ok().flatten().is_some_and(|b| formats::prefers_move(&b));
        Ok(Some(Read { cut, paths, other, stamp }))
    }
}

pub(super) fn write_text(app: &AppHandle, text: String) -> Result<(), String> {
    unsafe {
        let _open = Open::new()?;
        EmptyClipboard().map_err(|e| e.to_string())?;
        super::emptied(app);
        set(u32::from(CF_UNICODETEXT.0), &formats::unicode_text(&text))
    }
}

pub(super) fn read_text(_app: &AppHandle) -> Result<Option<String>, String> {
    unsafe {
        if IsClipboardFormatAvailable(u32::from(CF_UNICODETEXT.0)).is_err() {
            return Ok(None);
        }
        let _open = Open::new()?;
        // UTF-16: two bytes for each of UTF-8's at most, and the NUL.
        let Some(bytes) = get(u32::from(CF_UNICODETEXT.0), MAX_TEXT_BYTES * 2 + 2).map_err(|_| "the text on the clipboard is too long".to_string())? else {
            return Ok(None);
        };
        let units: Vec<u16> = bytes.as_chunks::<2>().0.iter().map(|c| u16::from_le_bytes(*c)).take_while(|u| *u != 0).collect();
        Ok(Some(String::from_utf16_lossy(&units)))
    }
}

/// Empties the clipboard. Called for glasshouse's own cut only.
pub(super) fn clear(_app: &AppHandle) -> Result<(), String> {
    unsafe {
        let _open = Open::new()?;
        EmptyClipboard().map_err(|e| e.to_string())
    }
}

/// Whether the write that left the clipboard at `stamp` is still what it
/// holds: the sequence number moves with every change.
pub(super) fn owns(stamp: u32) -> bool {
    sequence() == stamp
}

/// A cut from another app (Explorer) was pasted here, every item moved:
/// its source is told through the clipboard's data object, "Paste
/// Succeeded" with the move effect, so it can drop its cut marks. The
/// files were moved here, not copied, so "Performed DropEffect" isn't set:
/// that would ask the source to delete the originals. OLE's clipboard
/// calls belong to the main thread, where the window toolkit started OLE.
pub(super) fn pasted(app: &AppHandle, stamp: u32) {
    let told = app.run_on_main_thread(move || {
        // Something else was copied while the files moved.
        if sequence() != stamp {
            return;
        }
        if let Err(e) = unsafe { paste_succeeded() } {
            // A source that put plain data there has no object to tell.
            log::debug!("clipboard: the cut's source wasn't told: {e}");
        }
    });
    if let Err(e) = told {
        log::warn!("clipboard: {e}");
    }
}

unsafe fn paste_succeeded() -> windows::core::Result<()> {
    let data = OleGetClipboard()?;
    let mem = block(&DROPEFFECT_MOVE.to_le_bytes()).map_err(|_| windows::core::Error::from_win32())?;
    let format = FORMATETC {
        // Registered formats are 0xC000 to 0xFFFF.
        cfFormat: RegisterClipboardFormatW(PASTE_SUCCEEDED) as u16,
        ptd: std::ptr::null_mut(),
        dwAspect: DVASPECT_CONTENT.0,
        lindex: -1,
        tymed: TYMED_HGLOBAL.0 as u32,
    };
    let medium = STGMEDIUM { tymed: TYMED_HGLOBAL.0 as u32, u: STGMEDIUM_0 { hGlobal: mem }, pUnkForRelease: ManuallyDrop::new(None) };
    // The object frees the block if it takes it.
    data.SetData(&format, &medium, true).inspect_err(|_| {
        let _ = GlobalFree(mem);
    })
}

/// Nothing to hand over at exit: the clipboard holds the blocks, not the
/// app.
pub(super) fn store() {}
