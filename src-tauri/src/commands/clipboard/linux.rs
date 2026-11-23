// The clipboard on Linux: GTK's, which the app already links, on X11 and
// Wayland alike. Every call runs on the main thread (GTK's) and never
// blocks it: a read asks with a callback and answers the command's thread
// through a channel, with a deadline, so a clipboard owner that says
// nothing can't hang Paste, and no nested main loop runs while window
// events, drags and handed-off launches arrive.

use std::path::PathBuf;
use std::sync::mpsc::{channel, Sender};
use std::time::Duration;

use gtk::gdk;
use gtk::glib::translate::ToGlibPtr;
use tauri::AppHandle;

use super::formats::{self, Offered, GNOME_COPIED_FILES, KDE_CUT_SELECTION, URI_LIST};
use super::Read;

const URIS: u32 = 1;
const GNOME: u32 = 2;
const KDE: u32 = 3;
const TEXT: u32 = 4;

/// The names text goes by: what `gtk_target_list_add_text_targets` adds.
const TEXT_TARGETS: [&str; 5] = ["UTF8_STRING", "text/plain;charset=utf-8", "TEXT", "STRING", "text/plain"];

/// How long a command waits for the clipboard's owner. GTK itself gives up
/// on a request after 30 s.
const DEADLINE: Duration = Duration::from_secs(5);

fn clipboard() -> gtk::Clipboard {
    gtk::Clipboard::get(&gdk::SELECTION_CLIPBOARD)
}

/// Runs `f` on the main thread and waits for what it sends, which can be
/// later, from a callback.
fn on_main<T: Send + 'static>(app: &AppHandle, f: impl FnOnce(Sender<T>) + Send + 'static) -> Result<T, String> {
    let (tx, rx) = channel();
    app.run_on_main_thread(move || f(tx)).map_err(|e| e.to_string())?;
    rx.recv_timeout(DEADLINE).map_err(|_| "the clipboard didn't answer".to_string())
}

/// Files on the clipboard, for as long as GTK keeps them there: it drops
/// this when another app (or a later copy) takes the clipboard, and that
/// is how a cut ends.
struct Offer {
    app: AppHandle,
    id: u64,
    uris: Vec<String>,
    gnome: Vec<u8>,
    kde: &'static [u8],
    text: String,
}

impl Offer {
    fn answer(&self, sel: &gtk::SelectionData, info: u32) {
        match info {
            URIS => {
                let refs: Vec<&str> = self.uris.iter().map(String::as_str).collect();
                sel.set_uris(&refs);
            }
            GNOME => sel.set(&sel.target(), 8, &self.gnome),
            KDE => sel.set(&sel.target(), 8, self.kde),
            _ => {
                sel.set_text(&self.text);
            }
        }
    }
}

impl Drop for Offer {
    fn drop(&mut self) {
        super::lost(&self.app, self.id);
    }
}

/// Offers `paths` as other file managers do: the URI list, GNOME's and
/// KDE's cut-or-copy formats, and the plain paths as text.
pub(super) fn write_files(app: &AppHandle, id: u64, paths: &[PathBuf], cut: bool, held: Vec<String>) -> Result<(), String> {
    let (uris, text) = formats::uris_and_text(paths);
    let a = app.clone();
    on_main(app, move |tx| {
        let offer = Offer {
            app: a.clone(),
            id,
            gnome: formats::gnome_copied_files(cut, &uris),
            kde: formats::kde_cut_selection(cut),
            uris,
            text,
        };
        let none = gtk::TargetFlags::empty();
        let mut targets = vec![
            gtk::TargetEntry::new(URI_LIST, none, URIS),
            gtk::TargetEntry::new(GNOME_COPIED_FILES, none, GNOME),
            gtk::TargetEntry::new(KDE_CUT_SELECTION, none, KDE),
        ];
        targets.extend(TEXT_TARGETS.iter().map(|t| gtk::TargetEntry::new(t, none, TEXT)));
        let clip = clipboard();
        // GTK drops the offer before this one, then keeps this one until
        // it's replaced; a refused offer is dropped at once.
        let ok = clip.set_with_data(&targets, move |_, sel, info| offer.answer(sel, info));
        if ok {
            // Every format may be handed to a clipboard manager at exit
            // (`store`). gtk-rs has no binding for this one call.
            unsafe { gtk::ffi::gtk_clipboard_set_can_store(clip.to_glib_none().0, std::ptr::null(), 0) };
            super::took(&a, id, held, 0);
        }
        let _ = tx.send(ok.then_some(()).ok_or_else(|| "the clipboard refused the files".to_string()));
    })?
}

/// Asks for each format in `wanted`, last first, then sends what came.
fn fetch(clip: &gtk::Clipboard, mut wanted: Vec<&'static str>, mut got: Offered, tx: Sender<Offered>) {
    let Some(target) = wanted.pop() else {
        let _ = tx.send(got);
        return;
    };
    clip.request_contents(&gdk::Atom::intern(target), move |clip, sel| {
        // A length below zero: the owner didn't answer for this format.
        let data = usize::try_from(sel.length()).ok().filter(|n| *n <= formats::MAX_BYTES).map(|_| sel.data());
        match target {
            GNOME_COPIED_FILES => got.gnome = data,
            URI_LIST => got.uri_list = data,
            _ => got.kde = data,
        }
        fetch(clip, wanted, got, tx);
    });
}

/// The files on the clipboard, from whichever app put them there.
pub(super) fn read_files(app: &AppHandle) -> Result<Option<Read>, String> {
    let offered = on_main(app, |tx| {
        clipboard().request_contents(&gdk::Atom::intern("TARGETS"), move |clip, sel| {
            let names: Vec<String> = sel.targets().unwrap_or_default().iter().map(|a| a.name().to_string()).collect();
            let has = |t: &str| names.iter().any(|n| n == t);
            // GNOME's format says cut or copy itself; else the URI list,
            // with KDE's flag.
            let mut wanted = Vec::new();
            if has(GNOME_COPIED_FILES) {
                wanted.push(GNOME_COPIED_FILES);
            } else if has(URI_LIST) {
                wanted.push(URI_LIST);
                if has(KDE_CUT_SELECTION) {
                    wanted.push(KDE_CUT_SELECTION);
                }
            }
            if !wanted.is_empty() || !TEXT_TARGETS.iter().any(|t| has(t)) {
                fetch(clip, wanted, Offered::default(), tx);
                return;
            }
            // Text only: files, if it's Nautilus 3.30 to 42's form.
            clip.request_text(move |_, text| {
                let text = text.filter(|t| t.len() <= formats::MAX_BYTES).map(str::to_string);
                let _ = tx.send(Offered { text, ..Default::default() });
            });
        });
    })?;
    Ok(formats::decode(&offered).map(|copied| {
        let (paths, other) = formats::local_paths(&copied.uris);
        Read { cut: copied.cut, paths, other, stamp: 0 }
    }))
}

pub(super) fn write_text(app: &AppHandle, text: String) -> Result<(), String> {
    on_main(app, move |tx| {
        // GTK drops a file offer of ours as this takes its place.
        clipboard().set_text(&text);
        let _ = tx.send(());
    })
}

pub(super) fn read_text(app: &AppHandle) -> Result<Option<String>, String> {
    on_main(app, |tx| {
        clipboard().request_text(move |_, text| {
            let _ = tx.send(match text {
                Some(t) if t.len() > formats::MAX_TEXT_BYTES => Err("the text on the clipboard is too long".to_string()),
                t => Ok(t.map(str::to_string)),
            });
        });
    })?
}

/// Clears the clipboard if what's there is glasshouse's (GTK leaves
/// another app's alone).
pub(super) fn clear(app: &AppHandle) -> Result<(), String> {
    on_main(app, |tx| {
        clipboard().clear();
        let _ = tx.send(());
    })
}

/// Whether a held write is still on the clipboard: it is while it's held,
/// since GTK reports the loss (`Offer`'s drop).
pub(super) fn owns(_stamp: u32) -> bool {
    true
}

/// Nothing tells the source of a pasted cut on Linux: GTK file managers
/// leave another app's clipboard alone.
pub(super) fn pasted(_app: &AppHandle, _stamp: u32) {}

/// At exit, on the main thread: asks the clipboard manager, if the desktop
/// has one (X11's `CLIPBOARD_MANAGER`), to keep what glasshouse has on the
/// clipboard. GTK waits for it here, 10 s at most; with nothing of ours
/// there, or no manager (Wayland keeps its own), this returns at once.
pub(super) fn store() {
    clipboard().store();
}
