import type { Handler } from "./types";
import { dialogs } from "../components";
import { IS_WINDOWS } from "../platform";
import {
  hashSha256,
  findInFiles,
  diffFiles,
  setPermissions,
  verifySignature,
  runScript,
  findFileByName,
  changeOwner,
  openWithDefaultStrict,
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
        dialogs.showToast({ message: `${label}: no selection`, variant: "info" });
        return true;
      }
      try {
        await openWithDefaultStrict(p);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.log(`[tools] openWithDefault failed for ${p}:`, e);
        void dialogs.showAlert({ title: `${label} failed`, message: msg, variant: "error" });
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
        dialogs.showToast({ message: "Custom Command: no selection", variant: "info" });
        return true;
      }
      const cmd = await dialogs.showPrompt({
        title: "custom command",
        message: `run a command with "${p}" appended:`,
        placeholder: "echo",
        validate: (v) => v.trim() ? null : "command required",
      });
      if (cmd == null || cmd.trim() === "") return true;
      try {
        const output = await runScript(cmd.trim(), [p]);
        void dialogs.showAlert({ title: cmd, message: output || "(no output)" });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.log(`[tools] Custom Command failed (cmd=${cmd}):`, e);
        void dialogs.showAlert({ title: "command failed", variant: "error", message: msg });
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
        void dialogs.showAlert({ title: "SHA256", message: `${p}\n\n${hex}` });
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

    case "Compare Files (diff)": {
      if (ctx.selectedPaths.length !== 2) {
        void dialogs.showAlert({ title: "compare files", message: "Select exactly two files to compare.", variant: "info" });
        return true;
      }
      const [a, b] = ctx.selectedPaths;
      try {
        const diff = await diffFiles(a, b);
        ctx.setDiffView?.({ a, b, diff });
      } catch (e) {
        console.log(`[tools] diff failed:`, e);
        void dialogs.showAlert({ title: "diff failed", message: String(e), variant: "error" });
      }
      return true;
    }

    case "Diff with Clipboard": {
      const b = ctx.firstPath;
      const cb = ctx.clipboardPaths?.() ?? [];
      if (!b) {
        void dialogs.showAlert({ title: "diff with clipboard", message: "Select a file first.", variant: "info" });
        return true;
      }
      if (cb.length === 0) {
        void dialogs.showAlert({ title: "diff with clipboard", message: "Clipboard is empty (Copy/Cut a file first).", variant: "info" });
        return true;
      }
      const a = cb[0];
      try {
        const diff = await diffFiles(a, b);
        ctx.setDiffView?.({ a, b, diff });
      } catch (e) {
        console.log("[tools] diff with clipboard failed:", e);
        void dialogs.showAlert({ title: "diff failed", message: String(e), variant: "error" });
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
        void dialogs.showAlert({ title: "signature", message: `${result}\n\n${p}` });
      } catch (e) {
        console.log(`[tools] verifySignature failed for ${p}:`, e);
        void dialogs.showAlert({ title: "verify failed", message: String(e), variant: "error" });
      }
      return true;
    }

    case "Run Script on Selection…":
    case "Run Script on Selection": {
      const targets = ctx.selectedPaths.length
        ? ctx.selectedPaths
        : ctx.firstPath
          ? [ctx.firstPath]
          : [];
      if (targets.length === 0) {
        dialogs.showToast({ message: "Run Script: no selection", variant: "info" });
        return true;
      }
      const script = await dialogs.showPrompt({
        title: "run script on selection",
        message: `script to run (${targets.length} target${targets.length === 1 ? "" : "s"} will be appended as arguments):`,
        placeholder: IS_WINDOWS ? "C:\\tools\\myscript.ps1" : "/path/to/script.sh",
        validate: (v) => v.trim() ? null : "script required",
      });
      if (script == null || script.trim() === "") return true;
      try {
        const output = await runScript(script, targets);
        void dialogs.showAlert({ title: "script output", message: output || "(no output)" });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.log(`[tools] runScript failed (script=${script}):`, e);
        void dialogs.showAlert({ title: "script failed", variant: "error", message: msg });
      }
      return true;
    }

    case "Find & Replace in Files": {
      const needle = await dialogs.showPrompt({
        title: "find & replace in files",
        message: "search pattern:",
        validate: (v) => v.trim() ? null : "pattern required",
      });
      if (needle == null || needle === "") return true;
      const replacement = await dialogs.showPrompt({
        title: "find & replace in files",
        message: "replace with (can be empty):",
      });
      if (replacement == null) return true;
      try {
        const matches = await findInFiles(ctx.cwd, needle, true, 500);
        if (matches.length === 0) {
          void dialogs.showAlert({ title: "no matches", message: `no matches for "${needle}"`, variant: "info" });
          return true;
        }
        const uniquePaths = Array.from(new Set(matches.map((m) => m.path)));
        const ok = await dialogs.showConfirm({
          title: "replace?",
          message: `${matches.length} match(es) across ${uniquePaths.length} file(s). Replace?`,
        });
        if (!ok) {
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
        dialogs.showToast({ message: `replaced in ${filesWritten} files`, variant: "success" });
        ctx.refresh();
      } catch (e) {
        console.log("[tools] findInFiles failed:", e);
      }
      return true;
    }

    case "Screenshot → Auto-sort":
    case "Screenshot Stack": {
      const entries = ctx.activeHandle?.state.entries ?? [];
      const screenshotRe1 = /^Screenshot[_-]?\d{4}/i;
      const screenshotRe2 = /screenshot.*\.(png|jpg|jpeg|webp)$/i;
      const matches = entries.filter(
        (e) => screenshotRe1.test(e.name) || screenshotRe2.test(e.name),
      );
      if (matches.length === 0) {
        void dialogs.showAlert({
          title: "screenshot stack",
          message: "no screenshot files found in this folder",
          variant: "error",
        });
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
      void dialogs.showAlert({
        title: "screenshot stack",
        message: `moved ${moved} screenshot${moved === 1 ? "" : "s"} into Y-MM subfolders`,
        variant: "info",
      });
      ctx.refresh();
      return true;
    }

    case "Find in Files": {
      const needle = await dialogs.showPrompt({
        title: "find in files",
        message: "search pattern:",
      });
      if (needle == null || needle === "") return true;
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
      const pattern = await dialogs.showPrompt({
        title: "find file by name",
        message: `search within ${ctx.cwd || "(no cwd)"} — fuzzy match:`,
        placeholder: "name or partial",
        validate: (v) => v.trim() ? null : "pattern required",
      });
      if (pattern == null || pattern.trim() === "") return true;
      try {
        const matches = await findFileByName(ctx.cwd, pattern, 500);
        if (matches.length === 0) {
          void dialogs.showAlert({ title: "no matches", message: `No matches for "${pattern}"`, variant: "info" });
        } else {
          const top = matches.slice(0, 20).join("\n");
          const extra = matches.length > 20 ? `\n… (${matches.length - 20} more)` : "";
          void dialogs.showAlert({
            title: `${matches.length} match${matches.length === 1 ? "" : "es"}`,
            message: `${top}${extra}`,
          });
        }
      } catch (e) {
        console.log(`[tools] findFileByName failed (pattern=${pattern}):`, e);
      }
      return true;
    }

    case "Go to Path…":
    case "Go to Path": {
      const target = await dialogs.showPrompt({
        title: "go to path",
        message: "path to navigate to:",
        initialValue: ctx.cwd,
        placeholder: IS_WINDOWS ? "C:\\… or /…" : "/… or ~/…",
        validate: (v) => v.trim() ? null : "path required",
      });
      if (target == null || target.trim() === "") return true;
      const go = ctx.activeHandle?.actions.goTo;
      if (go) {
        go(target);
      } else {
        ctx.dispatch(`Go to Path:${target}`);
      }
      return true;
    }

    case "Clipboard Stack": {
      const current = ctx.clipboardPaths?.() ?? [];
      if (current.length > 0) {
        clipboardStack.push(current);
        if (clipboardStack.length > 10) clipboardStack.shift();
      }
      if (clipboardStack.length === 0) {
        dialogs.showToast({ message: "Clipboard stack is empty", variant: "info" });
      } else {
        const lines = clipboardStack
          .map((entry, i) => `${i + 1}. [${entry.length}] ${entry.join(", ")}`)
          .join("\n");
        void dialogs.showAlert({
          title: `Clipboard Stack (${clipboardStack.length})`,
          message: lines,
          variant: "info",
        });
      }
      return true;
    }

    case "File Queue": {
      const cb = ctx.clipboardPaths?.() ?? [];
      if (cb.length === 0) {
        void dialogs.showAlert({
          title: "file queue",
          message: "queue is empty — Copy or Cut file(s) first",
          variant: "info",
        });
      } else {
        void dialogs.showAlert({
          title: `file queue (${cb.length})`,
          message: cb.join("\n"),
          variant: "info",
        });
      }
      return true;
    }

    case "Batch Permissions…":
    case "Batch Permissions": {
      const paths = ctx.selectedPaths.length
        ? ctx.selectedPaths
        : ctx.firstPath
          ? [ctx.firstPath]
          : [];
      if (paths.length === 0) {
        dialogs.showToast({ message: "Batch Permissions: no selection", variant: "info" });
        return true;
      }
      const modeStr = await dialogs.showPrompt({
        title: "batch chmod",
        message: `octal mode to apply to ${paths.length} item(s):`,
        placeholder: "755",
        validate: (v) => {
          if (!v.trim()) return "mode required";
          const n = parseInt(v.trim(), 8);
          return Number.isFinite(n) ? null : "invalid octal (e.g. 644, 755)";
        },
      });
      if (modeStr == null || modeStr.trim() === "") return true;
      const mode = parseInt(modeStr.trim(), 8);
      if (!Number.isFinite(mode)) {
        void dialogs.showAlert({ title: "invalid", variant: "error", message: `invalid octal mode: ${modeStr}` });
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
      dialogs.showToast({
        message: `chmod ${modeStr}: ${ok} ok${failed > 0 ? `, ${failed} failed` : ""}`,
        variant: failed === 0 ? "success" : "warning",
      });
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
      const owner = await dialogs.showPrompt({
        title: "change owner",
        message: "owner (uid:gid):",
        placeholder: "1000:1000",
        validate: (v) => v.trim() ? null : "owner required",
      });
      if (owner == null || owner.trim() === "") return true;
      try {
        await changeOwner(p, owner.trim());
        dialogs.showToast({ message: `chown ${owner.trim()} ${p}: ok`, variant: "success" });
        ctx.refresh();
      } catch (e) {
        console.log(`[tools] changeOwner failed for ${p}:`, e);
        void dialogs.showAlert({ title: "chown failed", message: String(e), variant: "error" });
      }
      return true;
    }

    case "Connect to Server…":
    case "Connect to Server": {
      const host = await dialogs.showPrompt({
        title: "connect to server",
        message: "server (user@host:port):",
        placeholder: "alice@server.example:22",
        validate: (v) => v.trim() ? null : "host required",
      });
      if (host == null || host.trim() === "") return true;
      const label2 = await dialogs.showPrompt({
        title: "connect to server",
        message: "label:",
        initialValue: host.trim(),
        placeholder: host.trim(),
      });
      if (label2 == null) return true;
      const finalLabel = label2.trim() || host.trim();
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
      list.push({ label: finalLabel, host: host.trim() });
      try {
        localStorage.setItem(key, JSON.stringify(list));
      } catch (e) {
        console.log("[tools] Connect to Server: failed to persist:", e);
      }
      dialogs.showToast({
        message: `saved server: ${finalLabel} (${host.trim()})`,
        variant: "success",
      });
      ctx.refresh();
      return true;
    }

    default:
      return false;
  }
};
