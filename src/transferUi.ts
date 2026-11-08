// The app's side of transfer.ts: the real fs calls, the conflict question,
// and the toasts and undo entries every copy/move-into-a-folder shares.
import { copyEntry, moveEntry, moveToTrash, readDir } from "./api";
import { dialogs } from "./components";
import { IS_WINDOWS } from "./platform";
import { pushUndo } from "./state";
import {
  conflictMessage,
  failureDetails,
  summarize,
  type TransferDeps,
  type TransferItem,
  type TransferOp,
  type TransferResult,
} from "./transfer";
import { copyUndo, moveUndo } from "./undoActions";

/** Copy/move into a folder goes through runTransfer with these, so nothing
 *  lands on an existing name (or on itself) without the user choosing. */
export const transferDeps: TransferDeps = {
  // readDir rejects on error, so an unreadable destination aborts.
  list: (dir) => readDir(dir, true),
  ask: async (names, dstDir) => {
    const id = await dialogs.showChoice({
      title: "already exists",
      message: conflictMessage(names, dstDir, IS_WINDOWS),
      choices: [
        { id: "skip", label: "skip" },
        { id: "replace", label: "replace" },
        { id: "keep-both", label: "keep both", primary: true },
      ],
    });
    return id === "skip" || id === "replace" || id === "keep-both" ? id : null;
  },
  copy: copyEntry,
  move: moveEntry,
  trash: moveToTrash,
  windows: IS_WINDOWS,
};

/** Toast the outcome (unless `onlyIfNotable` and it all just worked) and
 *  alert any failures. */
export function reportTransfer(res: TransferResult, op: TransferOp, onlyIfNotable = false) {
  const clean = res.skipped.length + res.failed.length + res.replaced.length === 0;
  if (!(onlyIfNotable && clean)) dialogs.showToast(summarize(res, op, IS_WINDOWS));
  const details = failureDetails(res, IS_WINDOWS);
  if (details) {
    void dialogs.showAlert({ title: `${op} failed`, variant: "error", message: details });
  }
}

/** Undo for a finished transfer: delete the new copies, or move items back.
 *  Redo copies or moves them again. Replaced entries stay in the trash. */
export function pushTransferUndo(res: TransferResult, op: TransferOp, label: string) {
  const done = res.done.map(({ src, dst }) => ({ src, dst }));
  if (done.length === 0) return;
  pushUndo(op === "copy" ? copyUndo(label, done) : moveUndo(label, done, "move"));
}

/** Transfer items from parallel path/kind lists (kinds as FileEntry.kind). */
export const asItems = (paths: string[], kinds?: string[]): TransferItem[] =>
  paths.map((path, i) => ({ path, isDir: kinds?.[i] === undefined ? undefined : kinds[i] === "folder" }));
