import type { Handler } from "./types";
import {
  hashSha256,
  findInFiles,
  readHexDump,
  diffFiles,
  setPermissions,
  verifySignature,
  runScript,
  findFileByName,
  changeOwner,
  openWithDefault,
  makeDir,
  moveEntry,
  readText,
  writeText,
} from "../api";

function joinToolPath(dir: string, name: string): string {
  if (!dir) return name;
  const sep = dir.includes("\\") && !dir.includes("/") ? "\\" : "/";
  const trimmed = dir.replace(/[\\/]+$/, "");
  return trimmed + sep + name;
}

const clipboardStack: string[][] = [];

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

    case "Default App":
    case "Text Editor (.txt)": {
      const p = ctx.firstPath;
      if (!p) {
        console.log(`[tools] ${label}: no selection`);
        return true;
      }
      try {
        await openWithDefault(p);
      } catch (e) {
        console.log(`[tools] openWithDefault failed for ${p}:`, e);
      }
      return true;
    }

    case "VS Code":
      ctx.dispatch("Open in VS Code");
      return true;

    case "Terminal":
      ctx.dispatch("Open in Terminal");
      return true;

    case "Custom Command…": {
      const p = ctx.firstPath;
      if (!p) {
        console.log("[tools] Custom Command: no selection");
        return true;
      }
      const cmd = window.prompt("Command:");
      if (cmd == null || cmd.trim() === "") return true;
      try {
        const output = await runScript(cmd.trim(), [p]);
        window.alert(output || "(no output)");
      } catch (e) {
        console.log(`[tools] Custom Command failed (cmd=${cmd}):`, e);
        window.alert(`command failed: ${e}`);
      }
      return true;
    }

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
      const b = ctx.firstPath;
      const cb = ctx.clipboardPaths?.() ?? [];
      if (!b) { window.alert("Diff with Clipboard: select a file first."); return true; }
      if (cb.length === 0) { window.alert("Diff with Clipboard: clipboard is empty (Copy/Cut a file first)."); return true; }
      const a = cb[0];
      try {
        const diff = await diffFiles(a, b);
        ctx.setDiffView?.({ a, b, diff });
      } catch (e) {
        console.log("[tools] diff with clipboard failed:", e);
        window.alert(`diff failed: ${e}`);
      }
      return true;
    }

    case "Verify Signature…":
    case "Verify Signature": {
      const p = ctx.firstPath;
      if (!p) {
        console.log("[tools] Verify Signature: no selection");
        return true;
      }
      try {
        const result = await verifySignature(p);
        window.alert(`Signature: ${result}\n${p}`);
      } catch (e) {
        console.log(`[tools] verifySignature failed for ${p}:`, e);
        window.alert(`verify failed: ${e}`);
      }
      return true;
    }

    case "Run Script on Selection…":
    case "Run Script on Selection": {
      const script = window.prompt("Script path:");
      if (script == null || script.trim() === "") return true;
      const targets = ctx.selectedPaths.length
        ? ctx.selectedPaths
        : ctx.firstPath
          ? [ctx.firstPath]
          : [];
      try {
        const output = await runScript(script, targets);
        window.alert(output || "(no output)");
      } catch (e) {
        console.log(`[tools] runScript failed (script=${script}):`, e);
        window.alert(`script failed: ${e}`);
      }
      return true;
    }

    case "Find & Replace in Files": {
      const needle = window.prompt("search pattern:");
      if (needle == null || needle === "") return true;
      const replacement = window.prompt("replace with:");
      if (replacement == null) return true;
      try {
        const matches = await findInFiles(ctx.cwd, needle, true, 500);
        if (matches.length === 0) {
          window.alert(`no matches for "${needle}"`);
          return true;
        }
        const uniquePaths = Array.from(new Set(matches.map((m) => m.path)));
        if (
          !window.confirm(
            `${matches.length} match(es) across ${uniquePaths.length} file(s). Replace?`,
          )
        ) {
          return true;
        }
        let filesWritten = 0;
        for (const p of uniquePaths) {
          try {
            const content = await readText(p, 2_000_000);
            if (!content.includes(needle)) continue;
            const next = content.split(needle).join(replacement);
            await writeText(p, next);
            filesWritten++;
          } catch (e) {
            console.log(`[tools] Find & Replace: failed for ${p}:`, e);
          }
        }
        window.alert(`replaced in ${filesWritten} files`);
        ctx.refresh();
      } catch (e) {
        console.log("[tools] findInFiles failed:", e);
      }
      return true;
    }

    case "Screenshot → Auto-sort": {
      const entries = ctx.activeHandle?.state.entries ?? [];
      const screenshotRe1 = /^Screenshot[_-]?\d{4}/i;
      const screenshotRe2 = /screenshot.*\.(png|jpg|jpeg|webp)$/i;
      const matches = entries.filter(
        (e) => screenshotRe1.test(e.name) || screenshotRe2.test(e.name),
      );
      if (matches.length === 0) {
        window.alert("no screenshot files found");
        return true;
      }
      const subfolders = new Set<string>();
      let moved = 0;
      for (const entry of matches) {
        const d = new Date(entry.modified_ms);
        if (!Number.isFinite(d.getTime())) continue;
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, "0");
        const sub = `${yyyy}-${mm}`;
        const targetDir = joinToolPath(ctx.cwd, sub);
        try {
          if (!subfolders.has(sub)) {
            await makeDir(targetDir);
            subfolders.add(sub);
          }
          const dest = joinToolPath(targetDir, entry.name);
          await moveEntry(entry.path, dest);
          moved++;
        } catch (e) {
          console.log(`[tools] Screenshot Auto-sort: failed for ${entry.path}:`, e);
        }
      }
      window.alert(`moved ${moved} screenshots into Y-MM subfolders`);
      ctx.refresh();
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
      if (pattern == null || pattern.trim() === "") return true;
      try {
        const matches = await findFileByName(ctx.cwd, pattern, 500);
        if (matches.length === 0) {
          window.alert(`No matches for "${pattern}"`);
        } else {
          const top = matches.slice(0, 20).join("\n");
          const extra = matches.length > 20 ? `\n… (${matches.length - 20} more)` : "";
          window.alert(`Matches for "${pattern}" (${matches.length}):\n${top}${extra}`);
        }
      } catch (e) {
        console.log(`[tools] findFileByName failed (pattern=${pattern}):`, e);
      }
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

    case "Clipboard Stack": {
      const current = ctx.clipboardPaths?.() ?? [];
      if (current.length > 0) {
        clipboardStack.push(current);
        if (clipboardStack.length > 10) clipboardStack.shift();
      }
      if (clipboardStack.length === 0) {
        window.alert("Clipboard stack is empty.");
      } else {
        const lines = clipboardStack
          .map((entry, i) => `${i + 1}. [${entry.length}] ${entry.join(", ")}`)
          .join("\n");
        window.alert(`Clipboard Stack (${clipboardStack.length}):\n${lines}`);
      }
      return true;
    }

    case "File Queue": {
      const cb = ctx.clipboardPaths?.() ?? [];
      if (cb.length === 0) {
        window.alert("queue empty");
      } else {
        window.alert(`File Queue (${cb.length}):\n${cb.join("\n")}`);
      }
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
      const p = ctx.firstPath;
      if (!p) {
        console.log("[tools] Change Owner: no selection");
        return true;
      }
      const owner = window.prompt("Owner (uid:gid):");
      if (owner == null || owner.trim() === "") return true;
      try {
        await changeOwner(p, owner.trim());
        window.alert(`chown ${owner} ${p}: ok`);
        ctx.refresh();
      } catch (e) {
        console.log(`[tools] changeOwner failed for ${p}:`, e);
        window.alert(`chown failed: ${e}`);
      }
      return true;
    }

    case "Connect to Server…":
    case "Connect to Server": {
      const host = window.prompt("Server (user@host:port):");
      if (host == null || host.trim() === "") return true;
      const label2 = window.prompt("Label:", host.trim()) ?? host.trim();
      const key = "glasshouse.remote.servers";
      let list: { label: string; host: string }[] = [];
      try {
        const raw = localStorage.getItem(key);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) list = parsed;
        }
      } catch (e) {
        console.log("[tools] Connect to Server: failed to read existing list:", e);
      }
      list.push({ label: label2, host: host.trim() });
      try {
        localStorage.setItem(key, JSON.stringify(list));
      } catch (e) {
        console.log("[tools] Connect to Server: failed to persist:", e);
      }
      window.alert(`Saved server: ${label2} (${host.trim()})`);
      ctx.refresh();
      return true;
    }

    default:
      return false;
  }
};
