import type { Handler, HandlerCtx } from "./types";
import {
  openWithDefault,
  archiveCreate,
  archiveExtract,
  archiveCanHandle,
} from "../api";
import { dialogs } from "../components";

function joinPath(dir: string, name: string): string {
  if (!dir) return name;
  const sep = dir.includes("\\") && !dir.includes("/") ? "\\" : "/";
  const trimmed = dir.replace(/[\\/]+$/, "");
  return trimmed + sep + name;
}

function basename(p: string): string {
  const idx = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return idx < 0 ? p : p.slice(idx + 1);
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

function selectedOrFirst(ctx: HandlerCtx): string[] {
  if (ctx.selectedPaths.length) return ctx.selectedPaths;
  return ctx.firstPath ? [ctx.firstPath] : [];
}

async function doCreate(
  ctx: HandlerCtx,
  format: "zip" | "tar.gz" | "tar.zst" | "7z",
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
    await archiveCreate(paths, dest, format);
    ctx.refresh();
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
  try {
    await archiveExtract(archive, destDir);
    ctx.refresh();
  } catch (e) {
    console.log(`[archive] extract failed:`, e);
    void dialogs.showAlert({ title: "extract failed", message: String(e), variant: "error" });
  }
}

export const archiveHandler: Handler = async (label, ctx) => {
  switch (label) {
    case "Extract":
    case "Extract Here": {
      await doExtract(ctx, false);
      return true;
    }
    case "Extract to Folder…": {
      await doExtract(ctx, true);
      return true;
    }
    case "Browse archive in place": {
      if (ctx.firstPath) {
        await openWithDefault(ctx.firstPath);
      }
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
      let ok = 0;
      for (const p of paths) {
        try {
          await archiveCreate([p], p + ".zip", "zip");
          ok++;
        } catch (e) {
          console.log(`[archive] compress failed for ${p}:`, e);
        }
      }
      ctx.refresh();
      dialogs.showToast({
        message: `compressed ${ok}/${paths.length} file(s)`,
        variant: "success",
      });
      return true;
    }
    default:
      return false;
  }
};
