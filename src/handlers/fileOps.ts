import { type FileEntry, type Trashed, type TrashProblem, openWithDefault, trashUnsupported, makeDir, createTextFile, spawnTerminal, spawnVscodeStrict, revealInExplorer, archiveCreate, hashSha256, homeDir } from "../api";
import { MUTATING_LABELS } from "../data";
import { dialogs } from "../dialogs/DialogHost";
import { basename, parentPath, joinPath } from "../paths";
import type { BulkRenameItem } from "../dialogs/BulkRename";
import { namesIn, unlessTaken, asItems, transferDeps, pushTransferUndo, reportTransfer } from "../transferUi";
import { nameProblem, freeNewName } from "../names";
import { markIrreversible, pushUndo, type TabState } from "../state";
import { moveUndo, createUndo, madeUndo, trashUndo, type Created } from "../undoActions";
import { noBinText } from "../trashView";
import { IS_WINDOWS } from "../platform";
import { isCancelled, runOp } from "../ops";
import { type TransferOp, runTransfer, type TransferItem, type TransferResult } from "../transfer";
import type { PasteSpecialItem } from "../dialogs/PasteSpecial";
import type { Handler } from "./types";
import { clearAllTags, copyWslPath, removeTagPrompt, runGitAction, selectedOrFirst, showBlame } from "./helpers";
import { showLeftOut } from "./archive";
import { cmdState } from "../commandState";
import { errText } from "../errors";
import { deletePath, renamePath, trashPath } from "../tags";

/** The kinds of the selected entries, parallel to ctx.selectedPaths. */
function selectedKinds(st: TabState): string[] {
  return st.selected
    .map(i => st.entries[i]?.kind ?? "file")
    .filter((_, idx) => Boolean(st.entries[st.selected[idx]]?.path));
}

function bulkRenameItems(st: TabState): BulkRenameItem[] {
  return st.selected
    .map(i => st.entries[i])
    .filter((e): e is FileEntry => !!e)
    .map(e => ({ path: e.path, name: e.name }));
}

/** Delete Permanently's question. Folders go with everything in them, so it
 *  says so when the selection has any. */
export function deleteConfirmText(count: number, folders: number): string {
  const end = "This cannot be undone.";
  if (folders === 0) return `Permanently delete ${count} item(s)? ${end}`;
  if (count === 1) return `Permanently delete 1 folder and everything in it? ${end}`;
  return `Permanently delete ${count} item(s), including ${folders} folder(s) and everything in them? ${end}`;
}

/** Run `remove` on every path, carrying on past failures, then refresh
 *  whatever happened and list what failed. */
export async function removeEach(
  paths: string[],
  remove: (path: string) => Promise<void>,
  refresh: () => void,
  failTitle: (failed: number) => string,
): Promise<void> {
  const failed: string[] = [];
  for (const p of paths) {
    try {
      await remove(p);
    } catch (e) {
      failed.push(`${basename(p)}: ${errText(e)}`);
    }
  }
  refresh();
  if (failed.length === 0) return;
  const lines = failed.slice(0, 5);
  if (failed.length > 5) lines.push(`…and ${failed.length - 5} more`);
  void dialogs.showAlert({ title: failTitle(failed.length), variant: "error", message: lines.join("\n") });
}

/** Move to Trash, from the file menu or a target's menu: one undo entry
 *  puts back what went to the trash. Asks first for more than one item.
 *  Paths on a Windows drive with no Recycle Bin would be deleted for good,
 *  so then the question says so, and those are deleted permanently only if
 *  the user agrees (Cancel does nothing at all). */
export async function trashPaths(paths: string[], refresh: () => void): Promise<void> {
  if (paths.length === 0) return;
  const bin = IS_WINDOWS ? "Recycle Bin" : "Trash";
  let noBin: TrashProblem[] = [];
  try {
    noBin = await trashUnsupported(paths);
  } catch {
    // move_to_trash checks again, and refuses rather than deletes.
  }
  if (noBin.length > 0 || paths.length > 1) {
    const ok = await dialogs.showConfirm(noBin.length > 0
      ? { title: "no recycle bin", message: noBinText(noBin, paths.length), danger: true, okLabel: "delete permanently" }
      : { title: "move to trash", message: `Move ${paths.length} items to ${bin}?`, okLabel: "move" });
    if (!ok) return;
  }
  const permanent = new Set(noBin.map(p => p.path));
  const trashed: Trashed[] = [];
  let deleted = 0;
  try {
    await removeEach(paths, async p => {
      if (permanent.has(p)) {
        await deletePath(p, true);
        deleted++;
      } else {
        trashed.push(await trashPath(p));
      }
    }, refresh, n => permanent.size > 0
      ? `couldn't remove ${n} of ${paths.length} item(s)`
      : `couldn't move ${n} of ${paths.length} item(s) to the ${bin}`);
  } finally {
    if (deleted > 0) markIrreversible(`delete ${deleted} item(s) permanently`);
    if (trashed.length > 0) pushUndo(trashUndo(`move ${trashed.length} item(s) to the ${bin}`, trashed));
  }
}

/** New Folder, Text File, Markdown Note and Script: prompt for a free name in
 *  `cwd`, create it, and push an undo entry that removes it. */
async function createNew(
  cwd: string,
  refresh: () => void,
  what: Created,
  text: { title: string; message: string; base: string; placeholder: string; noun: string },
): Promise<void> {
  const taken = await namesIn(cwd);
  const name = await dialogs.showPrompt({
    title: text.title,
    message: text.message,
    initialValue: freeNewName(text.base, what.kind === "folder", taken.has),
    placeholder: text.placeholder,
    validate: (v) => nameProblem(v, taken),
    submit: (v) => unlessTaken(v, () =>
      what.kind === "folder" ? makeDir(joinPath(cwd, v)) : createTextFile(joinPath(cwd, v), what.content)),
  });
  if (!name) return;
  const dst = joinPath(cwd, name);
  pushUndo(createUndo(`new ${text.noun} ${name}`, dst, what));
  refresh();
}

// File and selection commands for the active tab: open, rename, delete,
// clipboard, new files, tags, git per-file. With no tab it takes every
// label (as App did), so nothing later runs. Moved from App.tsx's doFileOp.
export const fileOpsHandler: Handler = async (label, ctx) => {
  if (!ctx.app) return false;
  const { activeHandle } = ctx;
  const {
    pins,
    savePins,
    setBlame,
    setBulkRenameItems,
    setCutPaths,
    setFolderPicker,
    setPasteSpecial,
    setPropsEntry,
    setTagPickerPath,
  } = ctx.app;
  if (!activeHandle) return true;
  const st = activeHandle.state;
  const refresh = activeHandle.actions.refresh;
  const { selectedPaths, firstEntry, firstPath, cwd } = ctx;

  // Entries whose on-disk name isn't valid UTF-8 carry a lossy rendering of
  // the real path — any mutating op would target a path that doesn't exist
  // (or worse). Refuse with an actionable message instead.
  // MUTATING_LABELS is derived from the `mutates` flags in data.ts.
  if (MUTATING_LABELS.has(label) && st.selected.some(i => st.entries[i]?.lossy)) {
    void dialogs.showAlert({
      title: "invalid filename encoding",
      variant: "error",
      message:
        "The selected entry's on-disk name isn't valid UTF-8, so it can't be " +
        "addressed safely from here. Rename it in a terminal first (tab-completion " +
        "will match the raw bytes).",
    });
    return true;
  }

  switch (label) {
    case "Open": {
      if (!firstEntry) return true;
      if (firstEntry.kind === "folder") activeHandle.actions.goTo(firstEntry.path);
      else await openWithDefault(firstEntry.path);
      return true;
    }
    case "Add Bookmark": {
      const targets = selectedOrFirst(ctx);
      if (targets.length === 0) {
        dialogs.showToast({ message: "no selection", variant: "info" });
        return true;
      }
      const next = [...pins];
      const added: string[] = [];
      for (const p of targets) {
        if (!next.includes(p)) {
          next.push(p);
          added.push(p);
        }
      }
      if (added.length === 0) {
        dialogs.showToast({ message: "already pinned", variant: "info" });
        return true;
      }
      savePins(next);
      const msg = added.length === 1
        ? `pinned ${basename(added[0])}`
        : `pinned ${added.length} items`;
      dialogs.showToast({ message: msg, variant: "success" });
      return true;
    }
    case "Rename": {
      if (!firstEntry) return true;
      // Multi-select routes through bulk rename so F2 is consistent with
      // the palette / context menu "Bulk Rename…" entry.
      if (st.selected.length > 1) {
        setBulkRenameItems(bulkRenameItems(st));
        return true;
      }
      // The entry's own folder: search results can live outside cwd.
      const src = firstEntry.path;
      const dir = parentPath(src);
      const taken = await namesIn(dir);
      const next = await dialogs.showPrompt({
        title: "rename",
        message: `rename "${firstEntry.name}" to:`,
        initialValue: firstEntry.name,
        placeholder: "new name",
        validate: (v) => nameProblem(v, taken, firstEntry.name),
        submit: (v) => unlessTaken(v, async () => { if (v !== firstEntry.name) await renamePath(src, joinPath(dir, v)); }),
      });
      if (!next || next === firstEntry.name) return true;
      const dst = joinPath(dir, next);
      pushUndo(moveUndo(`rename ${firstEntry.name} → ${next}`, [{ src, dst }], "rename"));
      refresh();
      return true;
    }
    case "Bulk Rename…": {
      const items = bulkRenameItems(st);
      if (items.length === 0) return true;
      setBulkRenameItems(items);
      return true;
    }
    case "Delete Permanently": {
      if (selectedPaths.length === 0) return true;
      // A link to a folder is removed as a link, so it isn't counted.
      const folders = st.selected.filter(i => st.entries[i]?.kind === "folder" && !st.entries[i]?.is_symlink).length;
      const ok = await dialogs.showConfirm({
        title: "delete permanently",
        message: deleteConfirmText(selectedPaths.length, folders),
        danger: true,
        okLabel: "delete",
      });
      if (!ok) return true;
      const total = selectedPaths.length;
      try {
        await removeEach(selectedPaths, p => deletePath(p, true), refresh,
          n => `couldn't delete ${n} of ${total} item(s)`);
      } finally {
        markIrreversible(`delete ${total} item(s) permanently`);
      }
      return true;
    }
    case "Move to Trash": {
      // Trash is reversible, so a single item goes without a question.
      await trashPaths(selectedPaths, refresh);
      return true;
    }
    case "Copy": {
      if (selectedPaths.length === 0) return true;
      const kinds = selectedKinds(st);
      cmdState.clipboard = { op: "copy", paths: selectedPaths, kinds };
      setCutPaths([]);
      dialogs.showToast({ message: `copied ${selectedPaths.length} item(s)`, variant: "info" });
      return true;
    }
    case "Cut": {
      if (selectedPaths.length === 0) return true;
      const kinds = selectedKinds(st);
      cmdState.clipboard = { op: "cut", paths: selectedPaths, kinds };
      setCutPaths(selectedPaths);
      dialogs.showToast({ message: `cut ${selectedPaths.length} item(s)`, variant: "info" });
      return true;
    }
    case "Paste": {
      if (!cmdState.clipboard || cmdState.clipboard.paths.length === 0) {
        dialogs.showToast({ message: "clipboard is empty", variant: "info" });
        return true;
      }
      const { op, paths, kinds } = cmdState.clipboard;
      const xop: TransferOp = op === "copy" ? "copy" : "move";
      const res = await runTransfer(asItems(paths, kinds), cwd, xop, transferDeps);
      if (!res) return true;
      pushTransferUndo(res, xop, `${op === "copy" ? "paste copy" : "paste move"} ${res.done.length} item(s)`);
      if (op === "cut" && res.done.length > 0 && res.failed.length === 0) {
        cmdState.clipboard = null;
        setCutPaths([]);
      }
      refresh();
      reportTransfer(res, xop);
      return true;
    }
    case "Paste Special…": {
      if (!cmdState.clipboard || cmdState.clipboard.paths.length === 0) {
        console.warn("[paste-special] clipboard is empty");
        return true;
      }
      const { op, paths, kinds } = cmdState.clipboard;
      const items: PasteSpecialItem[] = paths.map((p, i) => ({
        path: p,
        kind: kinds[i] ?? "file",
      }));
      setPasteSpecial({ items, dstDir: cwd, clipboardMode: op });
      return true;
    }
    case "Folder":
      await createNew(cwd, refresh, { kind: "folder" }, {
        title: "new folder", message: "folder name:", base: "new-folder", placeholder: "folder-name", noun: "folder",
      });
      return true;
    case "Text File":
      await createNew(cwd, refresh, { kind: "file", content: "" }, {
        title: "new text file", message: "file name:", base: "untitled.txt", placeholder: "name.txt", noun: "file",
      });
      return true;
    case "Markdown Note":
      await createNew(cwd, refresh, { kind: "file", content: "" }, {
        title: "new markdown note", message: "note name:", base: "note.md", placeholder: "note.md", noun: "note",
      });
      return true;
    case "Script (.sh)":
      await createNew(cwd, refresh, { kind: "file", content: "#!/usr/bin/env bash\n" }, {
        title: "new shell script", message: "script name:", base: "script.sh", placeholder: "script.sh", noun: "script",
      });
      return true;
    case "Duplicate": {
      if (selectedPaths.length === 0) return true;
      // Each item is copied next to itself, so it always gets a free
      // "(copy)" name. Group by folder: search results can span several.
      const byDir = new Map<string, TransferItem[]>();
      for (const i of st.selected) {
        const e = st.entries[i];
        if (!e?.path) continue;
        const dir = parentPath(e.path);
        byDir.set(dir, [...(byDir.get(dir) ?? []), { path: e.path, isDir: e.kind === "folder" }]);
      }
      const res: TransferResult = { done: [], replaced: [], skipped: [], failed: [] };
      for (const [dir, items] of byDir) {
        const r = await runTransfer(items, dir, "copy", transferDeps);
        if (!r) continue;
        res.done.push(...r.done);
        res.replaced.push(...r.replaced);
        res.skipped.push(...r.skipped);
        res.failed.push(...r.failed);
      }
      pushTransferUndo(res, "copy", `duplicate ${res.done.length} item(s)`);
      refresh();
      reportTransfer(res, "copy", true);
      return true;
    }
    case "Open in Terminal": {
      await spawnTerminal(cwd);
      return true;
    }
    case "Open in VS Code": {
      try {
        await spawnVscodeStrict(firstPath ?? cwd);
      } catch (err) {
        const msg = errText(err);
        void dialogs.showAlert({
          title: "open in VS Code failed",
          variant: "error",
          message: `${msg}\n\nMake sure "code" is on PATH (install Shell Command from VS Code's command palette).`,
        });
      }
      return true;
    }
    case "Reveal in Explorer": {
      if (firstPath) await revealInExplorer(firstPath);
      return true;
    }
    case "Copy Path": {
      if (firstPath) await navigator.clipboard.writeText(firstPath);
      return true;
    }
    case "Copy as WSL Path":
    case "Copy Path (WSL)": {
      if (!firstPath) return true;
      await copyWslPath(firstPath);
      return true;
    }
    case "Add Tag…": {
      if (!firstPath) return true;
      setTagPickerPath(firstPath);
      return true;
    }
    case "Remove Tag…": {
      if (!firstPath) return true;
      await removeTagPrompt(firstPath, ctx.app);
      return true;
    }
    case "Clear All Tags": {
      const r = await clearAllTags(selectedOrFirst(ctx), ctx.app);
      if (r === "none") dialogs.showToast({ message: "no tagged items in selection", variant: "info" });
      if (r === "cleared") refresh();
      return true;
    }
    case "Compress to ZIP…": {
      // Use the current multi-selection; if empty, fall back to a single
      // firstPath if one exists (e.g. chip-only context with one active).
      const active: string[] = selectedOrFirst(ctx);
      if (active.length === 0) return true;
      const baseName = basename(active[0]) || "archive";
      const defaultName = `${baseName}.zip`;
      const entered = await dialogs.showPrompt({
        title: "compress to ZIP",
        message: "output archive name:",
        initialValue: defaultName,
        placeholder: "archive.zip",
        validate: (v) => v.trim() ? null : "name required",
      });
      if (entered === null) return true;
      let name = entered.trim();
      if (!name) return true;
      if (!/\.zip$/i.test(name)) name += ".zip";
      const outPath = joinPath(cwd, name);
      try {
        const report = await archiveCreate(active, outPath, "zip");
        const remake = async () => { await archiveCreate(active, outPath, "zip"); };
        pushUndo(madeUndo(`compress to ${name}`, [outPath], remake, { verb: "created" }));
        refresh();
        dialogs.showToast({ message: `compressed to ${name}`, variant: "success" });
        showLeftOut(report.skipped, "left out of the archive");
      } catch (err) {
        const msg = errText(err);
        console.error("compress failed:", msg);
        void dialogs.showAlert({ title: "compress failed", variant: "error", message: msg });
      }
      return true;
    }
    case "Checksum SHA256":
    case "Checksum (SHA256)": {
      if (!firstPath) return true;
      try {
        const hex = await runOp(`hashing ${basename(firstPath)}`, track => hashSha256(firstPath, track()));
        try { await navigator.clipboard.writeText(hex); } catch { /* clipboard unavailable */ }
        dialogs.showToast({ message: `sha256 copied: ${hex.slice(0, 16)}…`, variant: "success" });
      } catch (err) {
        if (isCancelled(err)) return true;
        const msg = errText(err);
        console.error("hash_sha256 failed:", msg);
        void dialogs.showAlert({ title: "hash failed", variant: "error", message: msg });
      }
      return true;
    }
    case "Move to…": {
      if (selectedPaths.length === 0) return true;
      const home = await homeDir();
      const initial = cwd || home || undefined;
      const paths = [...selectedPaths];
      const items: TransferItem[] = st.selected
        .map(i => st.entries[i])
        .filter((e): e is FileEntry => Boolean(e?.path))
        .map(e => ({ path: e.path, isDir: e.kind === "folder" }));
      setFolderPicker({
        initialPath: initial,
        title: paths.length === 1
          ? `move "${basename(paths[0])}" to…`
          : `move ${paths.length} items to…`,
        onPick: (target) => {
          setFolderPicker(null);
          void (async () => {
            const res = await runTransfer(items, target, "move", transferDeps);
            if (!res) return;
            pushTransferUndo(res, "move", `move ${res.done.length} item(s) to ${target}`);
            if (res.done.length > 0) refresh();
            reportTransfer(res, "move");
          })();
        },
      });
      return true;
    }
    case "Git: Stage": {
      await runGitAction("stage", selectedPaths, st.entries, refresh);
      return true;
    }
    case "Git: Unstage": {
      await runGitAction("unstage", selectedPaths, st.entries, refresh);
      return true;
    }
    case "Git: Discard changes": {
      await runGitAction("discard", selectedPaths, st.entries, refresh);
      return true;
    }
    case "Git: Blame": {
      if (!firstEntry) return true;
      if (firstEntry.kind === "folder") return true;
      if (firstEntry.git === "?") return true;
      await showBlame(firstEntry.path, setBlame);
      return true;
    }
    case "Properties": {
      if (firstEntry) setPropsEntry(firstEntry);
      return true;
    }
    default:
      return false;
  }
};
