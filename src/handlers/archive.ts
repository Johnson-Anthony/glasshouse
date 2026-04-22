import type { Handler } from "./types";
import { openWithDefault } from "../api";

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
    default:
      return false;
  }
};
