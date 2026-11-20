//! Open With on Windows, through the shell: `SHAssocEnumHandlers` lists the
//! handlers Explorer's "Open with" recommends for an extension (it reads
//! OpenWithProgids and OpenWithList itself, and includes Store apps), and
//! `IAssocHandler::Invoke` starts one on a file, so the shell runs the
//! handler's verb and builds any command line. Nothing here is a cmd or
//! PowerShell line. See docs/decisions/2026-11-20-open-with-windows-handlers.md.
//!
//! Only std and the `windows` crate, so it can be type-checked on its own;
//! CI's windows job is its first build.

use windows::core::{HSTRING, PCWSTR, PWSTR};
use windows::Win32::System::Com::{
    CoInitializeEx, CoTaskMemFree, CoUninitialize, IBindCtx, IDataObject, COINIT_APARTMENTTHREADED,
    COINIT_DISABLE_OLE1DDE,
};
use windows::Win32::UI::Shell::{
    BHID_DataObject, IAssocHandler, IShellItem, SHAssocEnumHandlers, SHCreateItemFromParsingName,
    ShellExecuteExW, ASSOC_FILTER_RECOMMENDED, SEE_MASK_CLASSNAME, SEE_MASK_FLAG_NO_UI, SEE_MASK_NOASYNC,
    SHELLEXECUTEINFOW,
};

use super::open_with::AppChoice;

/// The most handlers listed for one type.
const MAX_HANDLERS: usize = 64;

/// Run `f` on a thread of its own with COM initialised as a single-threaded
/// apartment, as the shell's handlers expect. A fresh thread, because
/// commands run on Tauri's pool, whose threads may already be in another
/// apartment.
fn with_com<T: Send + 'static>(f: impl FnOnce() -> Result<T, String> + Send + 'static) -> Result<T, String> {
    std::thread::spawn(move || {
        unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE) }
            .ok()
            .map_err(|e| format!("COM: {}", e.message()))?;
        let out = f();
        unsafe { CoUninitialize() };
        out
    })
    .join()
    .map_err(|_| "Open With: the shell call failed".to_string())?
}

/// A string the shell allocated, freed after copying.
fn take_string(p: PWSTR) -> String {
    let s = unsafe { p.to_string() }.unwrap_or_default();
    unsafe { CoTaskMemFree(Some(p.0 as *const _)) };
    s
}

/// `.ext` of `path`, the key the shell's associations use.
fn extension(path: &str) -> Option<String> {
    std::path::Path::new(path)
        .extension()
        .map(|e| format!(".{}", e.to_string_lossy()))
}

fn handlers(ext: &str) -> Result<Vec<IAssocHandler>, String> {
    let list = unsafe { SHAssocEnumHandlers(&HSTRING::from(ext), ASSOC_FILTER_RECOMMENDED) }
        .map_err(|e| format!("listing the apps for {ext}: {}", e.message()))?;
    let mut out = Vec::new();
    while out.len() < MAX_HANDLERS {
        let mut slot: [Option<IAssocHandler>; 1] = [None];
        let mut fetched = 0u32;
        let hr = unsafe { list.Next(&mut slot, Some(&mut fetched)) };
        if hr.is_err() || fetched == 0 {
            break;
        }
        out.extend(slot[0].take());
    }
    Ok(out)
}

/// The handler's id: what `GetName` returns (usually the program's path).
fn handler_id(h: &IAssocHandler) -> String {
    unsafe { h.GetName() }.map(take_string).unwrap_or_default()
}

pub(super) fn apps_for(path: &str) -> Result<Vec<AppChoice>, String> {
    let Some(ext) = extension(path) else { return Ok(Vec::new()) };
    with_com(move || {
        let mut out: Vec<AppChoice> = Vec::new();
        for h in handlers(&ext)? {
            let id = handler_id(&h);
            if id.is_empty() || out.iter().any(|a| a.id.eq_ignore_ascii_case(&id)) {
                continue;
            }
            let name = unsafe { h.GetUIName() }.map(take_string).unwrap_or_default();
            out.push(AppChoice {
                name: if name.is_empty() { id.clone() } else { name },
                id,
                is_default: false,
            });
        }
        Ok(out)
    })
}

/// Open each of `paths` with the handler `id` for its extension.
pub(super) fn launch(id: String, paths: Vec<String>) -> Result<(), String> {
    with_com(move || {
        for p in &paths {
            let ext = extension(p).ok_or_else(|| format!("{p} has no extension to find its apps by"))?;
            let handler = handlers(&ext)?
                .into_iter()
                .find(|h| handler_id(h).eq_ignore_ascii_case(&id))
                .ok_or_else(|| format!("{id} no longer opens {ext} files"))?;
            let item: IShellItem = unsafe { SHCreateItemFromParsingName(&HSTRING::from(p.as_str()), None::<&IBindCtx>) }
                .map_err(|e| format!("{p}: {}", e.message()))?;
            let data: IDataObject = unsafe { item.BindToHandler(None::<&IBindCtx>, &BHID_DataObject) }
                .map_err(|e| format!("{p}: {}", e.message()))?;
            unsafe { handler.Invoke(&data) }.map_err(|e| format!("starting {id}: {}", e.message()))?;
        }
        Ok(())
    })
}

/// Open `path` with whatever opens `class` (an extension such as `.txt`),
/// whatever the file's own type: ShellExecuteExW with the class set.
pub(super) fn open_as_class(path: String, class: &'static str) -> Result<(), String> {
    with_com(move || {
        let file = HSTRING::from(path.as_str());
        let class = HSTRING::from(class);
        let mut info = SHELLEXECUTEINFOW {
            cbSize: std::mem::size_of::<SHELLEXECUTEINFOW>() as u32,
            // NOASYNC: this thread ends right after, so finish here.
            fMask: SEE_MASK_CLASSNAME | SEE_MASK_NOASYNC | SEE_MASK_FLAG_NO_UI,
            lpFile: PCWSTR(file.as_ptr()),
            lpClass: PCWSTR(class.as_ptr()),
            nShow: 1, // SW_SHOWNORMAL
            ..Default::default()
        };
        unsafe { ShellExecuteExW(&mut info) }.map_err(|e| format!("{path}: {}", e.message()))
    })
}
