import { type FileEntry, openWithDefault, writePins, renameEntry, deleteEntry, moveToTrash, makeDir, createTextFile, spawnTerminal, spawnVscodeStrict, revealInExplorer, winToWsl, writeTags, compress, hashSha256, homeDir, gitStage, gitUnstage, gitDiscard, gitBlame } from "../api";
import { MUTATING_LABELS } from "../data";
import { dialogs } from "../dialogs/DialogHost";
import { basename, parentPath, joinPath } from "../paths";
import type { BulkRenameItem } from "../dialogs/BulkRename";
import { namesIn, unlessTaken, asItems, transferDeps, pushTransferUndo, reportTransfer } from "../transferUi";
import { nameProblem, freeNewName } from "../names";
import { pushUndo } from "../state";
import { moveUndo, createUndo, type Created } from "../undoActions";
import { IS_WINDOWS } from "../platform";
import { isCancelled, runOp } from "../ops";
import { type TransferOp, runTransfer, type TransferItem, type TransferResult } from "../transfer";
import type { PasteSpecialItem } from "../dialogs/PasteSpecial";
import { winPathToWsl } from "../shellCd";
import type { Handler } from "./types";
import { selectedOrFirst } from "./helpers";
import { cmdState } from "../commandState";
import { errText } from "../errors";

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
    setBlame,
    setBulkRenameItems,
    setCutPaths,
    setFolderPicker,
    setPasteSpecial,
    setPins,
    setPropsEntry,
    setTagPickerPath,
    setTagStore,
    tagStore,
  } = ctx.app;
  if (!activeHandle) return true;
  const st = activeHandle.state;
  const refresh = activeHandle.actions.refresh;
  const selectedPaths = st.selected
    .map(i => st.entries[i]?.path)
    .filter((p): p is string => Boolean(p));
  const firstEntry: FileEntry | undefined = st.entries[st.selected[0]];
  const firstPath = firstEntry?.path;
  const cwd = st.path;

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
      setPins(next);
      void writePins(next);
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
        const items: BulkRenameItem[] = st.selected
          .map(i => st.entries[i])
          .filter((e): e is FileEntry => !!e)
          .map(e => ({ path: e.path, name: e.name }));
        setBulkRenameItems(items);
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
        submit: (v) => unlessTaken(v, async () => { if (v !== firstEntry.name) await renameEntry(src, joinPath(dir, v)); }),
      });
      if (!next || next === firstEntry.name) return true;
      const dst = joinPath(dir, next);
      pushUndo(moveUndo(`rename ${firstEntry.name} → ${next}`, [{ src, dst }], "rename"));
      refresh();
      return true;
    }
    case "Bulk Rename…": {
      const items: BulkRenameItem[] = st.selected
        .map(i => st.entries[i])
        .filter((e): e is FileEntry => !!e)
        .map(e => ({ path: e.path, name: e.name }));
      if (items.length === 0) return true;
      setBulkRenameItems(items);
      return true;
    }
    case "Delete Permanently": {
      if (selectedPaths.length === 0) return true;
      const ok = await dialogs.showConfirm({
        title: "delete permanently",
        message: `Permanently delete ${selectedPaths.length} item(s)? This cannot be undone.`,
        danger: true,
        okLabel: "delete",
      });
      if (!ok) return true;
      for (const p of selectedPaths) await deleteEntry(p, false);
      refresh();
      return true;
    }
    case "Move to Trash": {
      if (selectedPaths.length === 0) return true;
      // Trash is reversible — only prompt for multi-select. Single items
      // go straight to the recycle bin without ceremony.
      if (selectedPaths.length > 1) {
        const ok = await dialogs.showConfirm({
          title: "move to trash",
          message: `Move ${selectedPaths.length} items to ${IS_WINDOWS ? "Recycle Bin" : "Trash"}?`,
          okLabel: "move",
        });
        if (!ok) return true;
      }
      for (const p of selectedPaths) await moveToTrash(p);
      refresh();
      return true;
    }
    case "Copy": {
      if (selectedPaths.length === 0) return true;
      const kinds = st.selected
        .map(i => st.entries[i]?.kind ?? "file")
        .filter((_, idx) => Boolean(st.entries[st.selected[idx]]?.path));
      cmdState.clipboard = { op: "copy", paths: selectedPaths, kinds };
      setCutPaths([]);
      dialogs.showToast({ message: `copied ${selectedPaths.length} item(s)`, variant: "info" });
      return true;
    }
    case "Cut": {
      if (selectedPaths.length === 0) return true;
      const kinds = st.selected
        .map(i => st.entries[i]?.kind ?? "file")
        .filter((_, idx) => Boolean(st.entries[st.selected[idx]]?.path));
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
    case "New Folder":
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
      let wsl = "";
      try { wsl = await winToWsl(firstPath); } catch { wsl = ""; }
      if (!wsl) wsl = winPathToWsl(firstPath);
      await navigator.clipboard.writeText(wsl);
      return true;
    }
    case "Add Tag…": {
      if (!firstPath) return true;
      setTagPickerPath(firstPath);
      return true;
    }
    case "Remove Tag…": {
      if (!firstPath) return true;
      const existing = tagStore[firstPath] ?? [];
      if (existing.length === 0) return true;
      const raw = await dialogs.showPrompt({
        title: "remove tag",
        message: `Remove which tag? (current: ${existing.join(", ")})`,
        initialValue: existing[0],
        placeholder: "tag",
        validate: (v) => existing.includes(v.trim()) ? null : `not a current tag`,
      });
      if (raw === null) return true;
      const tag = raw.trim();
      if (!tag || !existing.includes(tag)) return true;
      setTagStore(prev => {
        const cur = prev[firstPath] ?? [];
        const filtered = cur.filter(t => t !== tag);
        const next = { ...prev };
        if (filtered.length === 0) delete next[firstPath];
        else next[firstPath] = filtered;
        void writeTags(next);
        return next;
      });
      return true;
    }
    case "Clear All Tags": {
      const targets = selectedOrFirst(ctx);
      const tagged = targets.filter(p => (tagStore[p]?.length ?? 0) > 0);
      if (tagged.length === 0) {
        dialogs.showToast({ message: "no tagged items in selection", variant: "info" });
        return true;
      }
      const ok = await dialogs.showConfirm({
        title: "Remove all tags",
        message: `Remove all tags from ${tagged.length} item(s)?`,
        danger: true,
        okLabel: "remove",
      });
      if (!ok) return true;
      setTagStore(prev => {
        const next = { ...prev };
        for (const p of tagged) delete next[p];
        void writeTags(next);
        return next;
      });
      refresh();
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
        await compress(active, outPath);
        refresh();
        dialogs.showToast({ message: `compressed to ${name}`, variant: "success" });
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
      const targets = selectedPaths.filter((_, idx) => {
        const e = st.entries[st.selected[idx]];
        return !!e && e.git !== null;
      });
      if (targets.length === 0) return true;
      await gitStage(targets);
      refresh();
      return true;
    }
    case "Git: Unstage": {
      const targets = selectedPaths.filter((_, idx) => {
        const e = st.entries[st.selected[idx]];
        return !!e && e.git !== null && e.git !== "?";
      });
      if (targets.length === 0) return true;
      await gitUnstage(targets);
      refresh();
      return true;
    }
    case "Git: Discard changes": {
      const targets = selectedPaths.filter((_, idx) => {
        const e = st.entries[st.selected[idx]];
        return !!e && e.git !== null;
      });
      if (targets.length === 0) return true;
      const ok = await dialogs.showConfirm({
        title: "discard changes",
        message: `Discard local changes for ${targets.length} item(s)? This cannot be undone.`,
        danger: true,
        okLabel: "discard",
      });
      if (!ok) return true;
      await gitDiscard(targets);
      refresh();
      return true;
    }
    case "Git: Blame": {
      if (!firstEntry) return true;
      if (firstEntry.kind === "folder") return true;
      if (firstEntry.git === "?") return true;
      try {
        const lines = await gitBlame(firstEntry.path, 2000);
        setBlame({ path: firstEntry.path, lines });
      } catch (err) {
        const msg = errText(err);
        console.error("git blame:", msg);
        void dialogs.showAlert({ title: "git blame failed", variant: "error", message: msg });
      }
      return true;
    }
    case "Properties": {
      if (firstEntry) setPropsEntry(firstEntry);
      return true;
    }
    default:
      return false;
  }
  // A case that ends with `break` handled the label too.
  return true;
};
