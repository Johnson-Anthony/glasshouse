import type { Handler } from "./types";
import { openWithDefault, compress } from "../api";

export const archiveHandler: Handler = async (label, ctx) => {
  switch (label) {
    case "Extract":
    case "Extract Here":
    case "Extract to Folder…": {
      if (ctx.firstPath) {
        await openWithDefault(ctx.firstPath);
        console.log(`archive intent: ${label} ${ctx.firstPath}`);
      }
      return true;
    }
    case "Browse archive in place": {
      if (ctx.firstPath) {
        await openWithDefault(ctx.firstPath);
      }
      return true;
    }
    case "Zip (.zip)": {
      ctx.dispatch("Compress to ZIP…");
      return true;
    }
    case "7-zip (.7z)":
    case "Tar + gzip (.tar.gz)":
    case "Tar + zstd (.tar.zst)": {
      window.alert("(format not yet supported — use Zip (.zip))");
      return true;
    }
    case "ZIP (bundled)": {
      ctx.dispatch("Compress to ZIP…");
      return true;
    }
    case "ZIP (each individually)": {
      const paths = ctx.selectedPaths.length
        ? ctx.selectedPaths
        : ctx.firstPath
          ? [ctx.firstPath]
          : [];
      if (paths.length === 0) {
        window.alert("no selection");
        return true;
      }
      let ok = 0;
      for (const p of paths) {
        try {
          await compress([p], p + ".zip");
          ok++;
        } catch (e) {
          console.log(`[archive] compress failed for ${p}:`, e);
        }
      }
      ctx.refresh();
      window.alert(`compressed ${ok}/${paths.length} file(s)`);
      return true;
    }
    case "TAR.GZ":
      window.alert("tar.gz not supported yet");
      return true;
    case "7-Zip":
      window.alert("7z not supported yet");
      return true;
    default:
      return false;
  }
};
