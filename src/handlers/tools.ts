import type { Handler } from "./types";
import { hashSha256, findInFiles, readHexDump, diffFiles, setPermissions } from "../api";

async function copyToClipboard(text: string): Promise<void> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch {
    // fall through to log
  }
  console.log("[tools] clipboard unavailable, would copy:", text);
}

function winToUnc(path: string): string {
  // C:\foo\bar → \\wsl$\... is not a clean mapping; give the common
  // administrative-share form: C:\foo → \\localhost\C$\foo. For UNC paths
  // or WSL paths, return verbatim.
  const m = /^([A-Za-z]):[\\/](.*)$/.exec(path);
  if (m) {
    const drive = m[1].toUpperCase();
    const rest = m[2].replace(/\//g, "\\");
    return `\\\\localhost\\${drive}$\\${rest}`;
  }
  return path;
}

export const toolsHandler: Handler = async (label, ctx) => {
  switch (label) {
    // Submenu parents — consume to prevent double-handling.
    case "Compress →":
    case "Extract →":
    case "Open With →":
      return true;

    case "Hash SHA256 of Selection": {
      const paths = ctx.selectedPaths.length
        ? ctx.selectedPaths
        : ctx.firstPath
          ? [ctx.firstPath]
          : [];
      if (paths.length === 0) {
        console.log("[tools] Hash SHA256: no selection");
        return true;
      }
      for (const p of paths) {
        try {
          const hex = await hashSha256(p);
          console.log(`[tools] sha256 ${p}: ${hex}`);
        } catch (e) {
          console.log(`[tools] sha256 failed for ${p}:`, e);
        }
      }
      return true;
    }

    case "Checksum (SHA256)":
    case "Checksum SHA256": {
      const p = ctx.firstPath;
      if (!p) {
        console.log("[tools] Checksum: no selection");
        return true;
      }
      try {
        const hex = await hashSha256(p);
        window.alert(`SHA256\n${p}\n${hex}`);
      } catch (e) {
        console.log(`[tools] sha256 failed for ${p}:`, e);
      }
      return true;
    }

    case "Copy as UNC":
    case "Copy as WSL Path": {
      const p = ctx.firstPath;
      if (!p) {
        console.log("[tools] Copy as UNC: no selection");
        return true;
      }
      const unc = label === "Copy as UNC" ? winToUnc(p) : p;
      await copyToClipboard(unc);
      console.log(`[tools] copied: ${unc}`);
      return true;
    }

    case "Hex Viewer": {
      const p = ctx.firstPath;
      if (!p) {
        console.log("[tools] Hex Viewer: no selection");
        return true;
      }
      try {
        const hex = await readHexDump(p, 0, 4096);
        ctx.setHexView?.({ path: p, hex });
      } catch (e) {
        console.log(`[tools] hex dump failed for ${p}:`, e);
      }
      return true;
    }

    case "Compare Files (diff)": {
      if (ctx.selectedPaths.length !== 2) {
        window.alert("Compare Files: select exactly two files.");
        return true;
      }
      const [a, b] = ctx.selectedPaths;
      try {
        const diff = await diffFiles(a, b);
        ctx.setDiffView?.({ a, b, diff });
      } catch (e) {
        console.log(`[tools] diff failed:`, e);
        window.alert(`diff failed: ${e}`);
      }
      return true;
    }

    case "Diff with Clipboard": {
      console.log("[tools] not implemented: Diff with Clipboard");
      return true;
    }

    case "Verify Signature…":
    case "Verify Signature": {
      console.log("[tools] not implemented: Verify Signature");
      return true;
    }

    case "Run Script on Selection…":
    case "Run Script on Selection": {
      const script = window.prompt("Script path:");
      if (script == null) return true;
      console.log(
        `[tools] not implemented: Run Script on Selection (script=${script}, targets=${ctx.selectedPaths.length})`,
      );
      return true;
    }

    case "Find & Replace in Files": {
      const needle = window.prompt("Find:");
      if (needle == null) return true;
      const replacement = window.prompt("Replace with:");
      if (replacement == null) return true;
      try {
        const matches = await findInFiles(ctx.cwd, needle, true, 500);
        console.log(
          `[tools] Find & Replace: found ${matches.length} match(es) for "${needle}"; replacement not wired (would write "${replacement}")`,
        );
      } catch (e) {
        console.log("[tools] findInFiles failed:", e);
      }
      return true;
    }

    case "Find in Files": {
      const needle = window.prompt("Find in files:");
      if (needle == null) return true;
      try {
        const matches = await findInFiles(ctx.cwd, needle, true, 500);
        console.log(`[tools] find-in-files "${needle}": ${matches.length} match(es)`);
        for (const m of matches.slice(0, 20)) {
          console.log(`  ${m.path}:${m.line_no}: ${m.line}`);
        }
      } catch (e) {
        console.log("[tools] findInFiles failed:", e);
      }
      return true;
    }

    case "Find File by Name (fuzzy)":
    case "Find File by Name": {
      const pattern = window.prompt("Find file by name:");
      if (pattern == null) return true;
      console.log(
        `[tools] not implemented: Find File by Name (pattern=${pattern}) — backend findFileByName not present`,
      );
      return true;
    }

    case "Go to Path…":
    case "Go to Path": {
      const target = window.prompt("Go to path:", ctx.cwd);
      if (target == null || target.trim() === "") return true;
      const go = ctx.activeHandle?.actions.goTo;
      if (go) {
        go(target);
      } else {
        ctx.dispatch(`Go to Path:${target}`);
      }
      return true;
    }

    case "Send Path to Shell": {
      const p = ctx.firstPath;
      if (!p) {
        console.log("[tools] Send Path to Shell: no selection");
        return true;
      }
      await copyToClipboard(p);
      console.log(`[tools] path copied to clipboard for shell paste: ${p}`);
      return true;
    }

    case "Clipboard Stack":
    case "File Queue": {
      console.log(`[tools] not implemented: ${label}`);
      return true;
    }

    case "Batch Permissions…":
    case "Batch Permissions": {
      const modeStr = window.prompt("chmod mode (octal, e.g. 755):");
      if (modeStr == null || modeStr.trim() === "") return true;
      const mode = parseInt(modeStr.trim(), 8);
      if (!Number.isFinite(mode)) {
        window.alert(`invalid octal mode: ${modeStr}`);
        return true;
      }
      const paths = ctx.selectedPaths.length
        ? ctx.selectedPaths
        : ctx.firstPath
          ? [ctx.firstPath]
          : [];
      if (paths.length === 0) {
        console.log("[tools] Batch Permissions: no selection");
        return true;
      }
      let ok = 0;
      let failed = 0;
      for (const p of paths) {
        try {
          await setPermissions(p, mode);
          ok++;
        } catch (e) {
          failed++;
          console.log(`[tools] chmod ${p} failed:`, e);
        }
      }
      console.log(`[tools] chmod ${modeStr}: ${ok} ok, ${failed} failed`);
      ctx.refresh();
      return true;
    }

    case "Change Owner (chown)…":
    case "Change Owner": {
      console.log("[tools] not implemented: Change Owner");
      return true;
    }

    case "Connect to Server…":
    case "Connect to Server": {
      console.log("[tools] not implemented: Connect to Server");
      return true;
    }

    default:
      return false;
  }
};
