// The clipboard: the OS's, through the backend
// (src-tauri/src/commands/clipboard.rs). The page keeps no clipboard of its
// own, so what Paste takes is whatever is there now, whether this window,
// another glasshouse window or another app copied it.
// - Text (Copy Path, a checksum, a command) goes through `copyText`, which
//   says so when it fails.
// - Copy and Cut go through `copyFiles`; Paste asks `filesToPaste`, runs
//   the transfer as it always did, then calls `afterPaste`.
// - The rows of a cut are dimmed while glasshouse's cut is what the
//   clipboard holds (`useCutPaths`): until it's pasted, or anything else is
//   copied, in any app.
// See docs/decisions/2026-11-23-os-clipboard-design.md.
import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  clipboardCutPasted, clipboardCutPaths, clipboardReadFiles, clipboardReadText, clipboardWriteFiles, clipboardWriteText,
  TAURI_AVAILABLE, type ClipboardFiles,
} from "./api";
import { dialogs } from "./dialogs/DialogHost";
import { showError } from "./errorDialog";
import type { TransferItem, TransferResult } from "./transfer";

/** Puts `text` on the clipboard, or throws: the OS clipboard through the
 *  backend, or the browser's where there's no backend (a page outside the
 *  app). */
export async function writeText(text: string): Promise<void> {
  if (TAURI_AVAILABLE) await clipboardWriteText(text);
  else await navigator.clipboard.writeText(text);
}

/** Copies `text`. Every text copy in the app comes through here. Returns
 *  whether it worked; a failure is shown, not just logged. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await writeText(text);
    return true;
  } catch (err) {
    void showError({ title: "copy failed", err });
    return false;
  }
}

/** The clipboard's text, "" when it holds none. Undefined when it couldn't
 *  be read, which is shown. */
export async function pastedText(): Promise<string | undefined> {
  try {
    return (await clipboardReadText()) ?? "";
  } catch (err) {
    await showError({ title: "clipboard read failed", err });
    return undefined;
  }
}

/** Copy or Cut: offers `paths` to every app. Returns whether it worked; a
 *  failure is shown. */
export async function copyFiles(paths: string[], cut: boolean): Promise<boolean> {
  try {
    await clipboardWriteFiles(paths, cut);
    return true;
  } catch (err) {
    void showError({ title: cut ? "cut failed" : "copy failed", err });
    return false;
  }
}

/** Files to paste, as a read of the clipboard found them. */
export interface Pasting {
  /** A paste moves them. */
  cut: boolean;
  items: TransferItem[];
  /** Which clipboard contents these were, for `afterPaste`. */
  stamp: number;
}

const count = (n: number) => `${n} item${n === 1 ? "" : "s"}`;

/** What a read of the clipboard gives Paste: the files that are there to
 *  paste, and what to say about the rest. With no files, `note` says why
 *  there's nothing to paste. */
export function pastePlan(clip: ClipboardFiles | null): { pasting: Pasting | null; note: string | null } {
  if (!clip) return { pasting: null, note: "nothing to paste: the clipboard holds no files" };
  const left: string[] = [];
  if (clip.gone > 0) left.push(`${count(clip.gone)} no longer there`);
  if (clip.other > 0) left.push(`${count(clip.other)} not on this computer`);
  if (clip.items.length === 0) {
    return { pasting: null, note: left.length > 0 ? `nothing to paste: ${left.join(", ")}` : "nothing to paste: the clipboard holds no files" };
  }
  return {
    pasting: {
      cut: clip.cut,
      items: clip.items.map(i => ({ path: i.path, isDir: i.folder })),
      stamp: clip.stamp,
    },
    note: left.length > 0 ? `left out of the paste: ${left.join(", ")}` : null,
  };
}

/** The files Paste acts on now, or null with the reason shown. A cut whose
 *  files are all gone (another app pasted it) is over, and the backend is
 *  told so it can clear it. */
export async function filesToPaste(): Promise<Pasting | null> {
  let clip: ClipboardFiles | null;
  try {
    clip = await clipboardReadFiles();
  } catch (err) {
    void showError({ title: "paste failed", err });
    return null;
  }
  const { pasting, note } = pastePlan(clip);
  if (note) dialogs.showToast({ message: note, variant: pasting ? "warning" : "info" });
  if (!pasting && clip?.cut) void clipboardCutPasted(clip.stamp, false);
  return pasting;
}

/** The paths of the files on the clipboard that are still there; none
 *  when it holds no files. A failed read is shown. */
export async function clipboardPaths(): Promise<string[]> {
  try {
    return (await clipboardReadFiles())?.items.map(i => i.path) ?? [];
  } catch (err) {
    void showError({ title: "clipboard read failed", err });
    return [];
  }
}

/** Whether a transfer moved every one of `items`. */
export function allMoved(items: readonly TransferItem[], res: TransferResult): boolean {
  return res.done.length === items.length && res.failed.length === 0 && res.skipped.length === 0 && !res.cancelled;
}

/** After a paste of `pasting` ran: a cut's files have moved, so the cut is
 *  over. The backend clears glasshouse's own cut once none of its files is
 *  where it was (what stayed behind stays cut), and tells another app's
 *  source when every item moved. A copy stays on the clipboard. */
export async function afterPaste(pasting: Pasting, res: TransferResult): Promise<void> {
  if (!pasting.cut || res.done.length === 0) return;
  await clipboardCutPasted(pasting.stamp, allMoved(pasting.items, res));
}

const samePaths = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((p, i) => p === b[i]);

/** The paths that are cut, for the dimmed rows: the same in every window,
 *  since the backend holds them. It sends each change (`clipboard-cut`); a
 *  window also asks when it opens and when it gets the focus, which is
 *  when Windows notices another app's copy. */
export function useCutPaths(): string[] {
  const [cut, setCut] = useState<string[]>([]);
  useEffect(() => {
    let off: (() => void) | null = null;
    let gone = false;
    // A change heard while an answer is on its way is newer than it.
    let heard = 0;
    const set = (next: string[]) => setCut(prev => (samePaths(prev, next) ? prev : next));
    const ask = () => {
      const at = heard;
      void clipboardCutPaths().then(paths => { if (!gone && at === heard) set(paths); });
    };
    ask();
    try {
      listen<string[]>("clipboard-cut", e => { heard++; set(e.payload ?? []); }).then(
        fn => { if (gone) fn(); else off = fn; },
        () => { /* no Tauri window */ },
      );
    } catch { /* no Tauri window */ }
    window.addEventListener("focus", ask);
    return () => {
      gone = true;
      off?.();
      window.removeEventListener("focus", ask);
    };
  }, []);
  return cut;
}
