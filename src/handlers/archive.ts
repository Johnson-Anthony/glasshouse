import type { Handler, HandlerCtx } from "./types";
import { selectedOrFirst } from "./helpers";
import {
  archiveCreate,
  archiveExtract,
  archiveDiscardStaging,
  archiveCanHandle,
  deleteEntry,
  moveEntry,
  readDir,
  type ArchiveFormat,
  type ArchiveSkip,
  type StagedExtract,
} from "../api";
import { dialogs } from "../dialogs/DialogHost";
import { errText } from "../errors";
import { basename, joinPath } from "../paths";
import { IS_WINDOWS } from "../platform";
import { failureDetails, runTransfer, type TransferResult } from "../transfer";
import { namesIn, transferDeps } from "../transferUi";
import { pushUndo } from "../state";
import { madeUndo, type PathPair } from "../undoActions";

// Extensions the backend archive_extract command can actually unpack —
// keep in sync with the dispatch in `extract_into` (src-tauri/src/commands/archive.rs).
export const EXTRACT_EXTS = [
  ".zip", ".7z", ".tar",
  ".tar.gz", ".tgz",
  ".tar.bz2", ".tbz2",
  ".tar.xz", ".txz",
  ".tar.zst", ".tzst",
];

export function canExtractArchive(name: string): boolean {
  const lower = name.toLowerCase();
  return EXTRACT_EXTS.some((ext) => lower.endsWith(ext));
}

function stripArchiveExt(name: string): string {
  const lower = name.toLowerCase();
  const longs = [".tar.gz", ".tar.zst", ".tar.bz2", ".tar.xz"];
  for (const ext of longs) {
    if (lower.endsWith(ext)) return name.slice(0, -ext.length);
  }
  const shorts = [".zip", ".7z", ".tgz", ".tzst", ".tbz2", ".txz", ".tar"];
  for (const ext of shorts) {
    if (lower.endsWith(ext)) return name.slice(0, -ext.length);
  }
  return name;
}

async function doCreate(
  ctx: HandlerCtx,
  format: ArchiveFormat,
  ext: string,
): Promise<void> {
  const paths = selectedOrFirst(ctx);
  if (paths.length === 0) {
    dialogs.showToast({ message: "no selection", variant: "info" });
    return;
  }
  const firstName = basename(paths[0]);
  const dest = joinPath(ctx.cwd, firstName + ext);
  try {
    const report = await archiveCreate(paths, dest, format);
    const remake = async () => { await archiveCreate(paths, dest, format); };
    pushUndo(madeUndo(`compress to ${basename(dest)}`, [dest], remake, { verb: "created" }));
    ctx.refresh();
    showLeftOut(report.skipped, "left out of the archive");
  } catch (e) {
    console.log(`[archive] create failed:`, e);
    void dialogs.showAlert({ title: "archive failed", message: String(e), variant: "error" });
  }
}

async function doExtract(ctx: HandlerCtx, promptFolder: boolean): Promise<void> {
  const archive = ctx.firstPath;
  if (!archive) {
    dialogs.showToast({ message: "no archive selected", variant: "info" });
    return;
  }
  let destDir = ctx.cwd;
  if (promptFolder) {
    const defName = stripArchiveExt(basename(archive));
    const name = await dialogs.showPrompt({
      title: "extract to folder",
      message: "folder name:",
      initialValue: defName,
      placeholder: defName,
      validate: (v) => (v.trim() ? null : "name required"),
    });
    if (!name) return;
    destDir = joinPath(ctx.cwd, name);
  }
  // A folder the extraction makes goes again on undo, whole. When the check
  // fails, it's taken to be there already: undo then removes only what
  // landed in it, never a folder that may hold older things.
  const newFolder = destDir !== ctx.cwd &&
    !(await namesIn(ctx.cwd).then(n => n.has(basename(destDir)), () => true));
  // The backend extracts into a staging folder inside destDir and writes
  // nothing else; moving the entries in goes through the paste planner, so
  // a taken name gets the same skip / replace / keep both question.
  let staged: StagedExtract;
  try {
    staged = await archiveExtract(archive, destDir);
  } catch (e) {
    console.log(`[archive] extract failed:`, e);
    void dialogs.showAlert({ title: "extract failed", message: errText(e), variant: "error" });
    return;
  }
  let done: PathPair[] = [];
  try {
    const entries = await readDir(staged.staging, true);
    const items = entries.map(e => ({ path: e.path, isDir: e.kind === "folder" }));
    const res = await runTransfer(items, destDir, "move", transferDeps);
    if (!res) {
      dialogs.showToast({ message: "extract cancelled: nothing changed", variant: "info" });
    } else {
      done = res.done;
      dialogs.showToast(extractSummary(res, staged.skipped, IS_WINDOWS));
      const details = failureDetails(res, IS_WINDOWS);
      if (details) void dialogs.showAlert({ title: "extract failed", variant: "error", message: details });
    }
    showLeftOut(staged.skipped, "left out of the extraction");
  } catch (e) {
    console.log(`[archive] extract failed:`, e);
    void dialogs.showAlert({ title: "extract failed", message: errText(e), variant: "error" });
  } finally {
    // Skipped and failed entries go with it.
    try {
      await archiveDiscardStaging(staged.staging);
    } catch (e) {
      console.log(`[archive] discard ${staged.staging} failed:`, e);
    }
    if (done.length > 0) {
      // After the discard, so a new folder's fingerprint doesn't include
      // the staging folder.
      pushExtractUndo(archive, destDir, newFolder, done);
    } else if (newFolder) {
      // Cancelled, or nothing landed: the folder made for it is empty.
      try {
        await deleteEntry(destDir, false);
      } catch (e) {
        console.log(`[archive] remove ${destDir} failed:`, e);
      }
    }
    ctx.refresh();
  }
}

/** Undo for an extraction: delete what landed (or the folder made for it),
 *  if unchanged since. Redo extracts the archive again and moves the same
 *  entries in under the same names. */
function pushExtractUndo(archive: string, destDir: string, newFolder: boolean, done: PathPair[]): void {
  // The staging folder's name changes each time; its entries' names don't.
  const names = done.map(({ src, dst }) => ({ name: basename(src), dst }));
  const remake = async () => {
    const again = await archiveExtract(archive, destDir);
    try {
      for (const { name, dst } of names) await moveEntry(joinPath(again.staging, name), dst);
    } finally {
      await archiveDiscardStaging(again.staging);
    }
  };
  const made = newFolder ? [destDir] : done.map(d => d.dst);
  pushUndo(madeUndo(`extract ${basename(archive)}`, made, remake, { verb: "extracted" }));
}

/** Toast for a finished extraction: what landed, what was replaced or
 *  skipped at the conflict question, what failed to move, and the archive
 *  entries the backend left out. */
export function extractSummary(
  res: TransferResult,
  leftOut: ArchiveSkip[],
  windows: boolean,
): { message: string; variant: "success" | "info" | "warning" } {
  const parts = [`extracted ${res.done.length} item(s)`];
  if (res.replaced.length) {
    parts.push(`replaced ${res.replaced.length} (old in the ${windows ? "Recycle Bin" : "Trash"})`);
  }
  const conflicts = res.skipped.filter(s => s.reason === "conflict").length;
  if (conflicts) parts.push(`skipped ${conflicts} that already exist`);
  if (res.failed.length) parts.push(`${res.failed.length} failed`);
  if (leftOut.length) parts.push(`left out ${leftOut.length} archive entr${leftOut.length === 1 ? "y" : "ies"}`);
  const variant = res.failed.length || leftOut.length
    ? "warning"
    : res.done.length ? "success" : "info";
  return { message: parts.join(", "), variant };
}

/** Alert text listing entries an archive operation left out. */
export function leftOutDetails(skipped: ArchiveSkip[]): string {
  const lines = skipped.slice(0, 5).map(s => `${s.path}: ${s.reason}`);
  if (skipped.length > 5) lines.push(`…and ${skipped.length - 5} more`);
  return lines.join("\n");
}

/** Tell the user what was left out, if anything. */
export function showLeftOut(skipped: ArchiveSkip[], title: string): void {
  if (skipped.length === 0) return;
  void dialogs.showAlert({ title, variant: "warning", message: leftOutDetails(skipped) });
}

export const archiveHandler: Handler = async (label, ctx) => {
  switch (label) {
    case "Extract Here": {
      await doExtract(ctx, false);
      return true;
    }
    case "Extract to Folder…": {
      await doExtract(ctx, true);
      return true;
    }
    case "Zip (.zip)":
    case "ZIP (bundled)": {
      await doCreate(ctx, "zip", ".zip");
      return true;
    }
    case "Tar + gzip (.tar.gz)":
    case "TAR.GZ": {
      await doCreate(ctx, "tar.gz", ".tar.gz");
      return true;
    }
    case "Tar + zstd (.tar.zst)": {
      await doCreate(ctx, "tar.zst", ".tar.zst");
      return true;
    }
    case "7-zip (.7z)":
    case "7-Zip": {
      const ok = await archiveCanHandle("7z");
      if (!ok) {
        void dialogs.showAlert({
          title: "7-Zip not found",
          message: "7z.exe not found on PATH — install 7-Zip",
          variant: "error",
        });
        return true;
      }
      await doCreate(ctx, "7z", ".7z");
      return true;
    }
    case "ZIP (each individually)": {
      const paths = selectedOrFirst(ctx);
      if (paths.length === 0) {
        dialogs.showToast({ message: "no selection", variant: "info" });
        return true;
      }
      const made: string[] = [];
      const leftOut: ArchiveSkip[] = [];
      for (const p of paths) {
        try {
          leftOut.push(...(await archiveCreate([p], p + ".zip", "zip")).skipped);
          made.push(p);
        } catch (e) {
          console.log(`[archive] compress failed for ${p}:`, e);
        }
      }
      if (made.length > 0) {
        const remake = async () => {
          for (const p of made) await archiveCreate([p], p + ".zip", "zip");
        };
        pushUndo(madeUndo(`compress ${made.length} item(s) each to .zip`, made.map(p => p + ".zip"), remake, { verb: "created" }));
      }
      ctx.refresh();
      dialogs.showToast({
        message: `compressed ${made.length}/${paths.length} file(s)`,
        variant: "success",
      });
      showLeftOut(leftOut, "left out of the archives");
      return true;
    }
    default:
      return false;
  }
};
