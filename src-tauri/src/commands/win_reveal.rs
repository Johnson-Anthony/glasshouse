//! Reveal in File Explorer on Windows (`launch::reveal_in_explorer`).
//!
//! The shell's own call, not `explorer.exe /select,<path>`: Explorer splits
//! that command line at commas, so a path with one in it opened the wrong
//! folder (or Documents) with nothing selected.
//!
//! Only std and `windows` are used here, so the file can be type-checked on
//! Linux through a scratch crate (`~/.claude/environment.md`).

use windows::core::HSTRING;
use windows::Win32::System::Com::{
    CoInitializeEx, CoUninitialize, COINIT_APARTMENTTHREADED, COINIT_DISABLE_OLE1DDE,
};
use windows::Win32::UI::Shell::{ILCreateFromPathW, ILFree, SHOpenFolderAndSelectItems};

/// Open `path`'s folder in Explorer with `path` selected. The shell needs
/// COM in a single-threaded apartment, so this runs on a thread of its own
/// (commands run on Tauri's pool, whose threads may be in another).
pub(crate) fn select_in_explorer(path: &str) -> Result<(), String> {
    let path = path.to_string();
    std::thread::spawn(move || {
        if unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE) }.is_err() {
            return Err("COM couldn't be started".to_string());
        }
        let shown = select(&path);
        unsafe { CoUninitialize() };
        shown
    })
    .join()
    .unwrap_or_else(|_| Err("the reveal thread stopped".to_string()))
}

fn select(path: &str) -> Result<(), String> {
    // SAFETY: the string outlives the call; the returned list is ours to free.
    let item = unsafe { ILCreateFromPathW(&HSTRING::from(path)) };
    if item.is_null() {
        return Err(format!("{path}: the shell can't find it"));
    }
    // With no child items, the list names the one item to select, and its
    // parent is the folder that opens.
    // SAFETY: `item` is a valid, absolute item ID list until ILFree below.
    let shown = unsafe { SHOpenFolderAndSelectItems(item, None, 0) }.map_err(|e| e.to_string());
    unsafe { ILFree(Some(item.cast_const())) };
    shown
}
