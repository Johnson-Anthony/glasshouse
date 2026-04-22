import type { Handler, HandlerCtx } from "./types";
import { makeDir, writeText } from "../api";

// Join a directory with a filename using whichever separator the cwd appears
// to use. Matches parentPath() in state.ts — backslash wins only if the path
// already contains one.
function joinPath(dir: string, name: string): string {
  if (!dir) return name;
  const sep = dir.includes("\\") && !dir.includes("/") ? "\\" : "/";
  const trimmed = dir.replace(/[\\/]+$/, "");
  return trimmed + sep + name;
}

async function createFileAt(ctx: HandlerCtx, name: string, body: string): Promise<void> {
  const path = joinPath(ctx.cwd, name);
  await writeText(path, body);
  ctx.refresh();
}

async function promptAndCreate(ctx: HandlerCtx, defaultName: string, body = ""): Promise<void> {
  const name = window.prompt("filename:", defaultName);
  if (name == null || name.trim() === "") return;
  await createFileAt(ctx, name.trim(), body);
}

async function createPythonModule(ctx: HandlerCtx): Promise<void> {
  const name = window.prompt("module name:");
  if (name == null || name.trim() === "") return;
  const mod = name.trim();
  const dir = joinPath(ctx.cwd, mod);
  await makeDir(dir);
  await writeText(joinPath(dir, "__init__.py"), "");
  ctx.refresh();
}

export const miscHandler: Handler = async (label, ctx) => {
  switch (label) {
    // ─── Help / About ──────────────────────────────────────────────────────
    case "About":
    case "About Glasshouse":
    case "About rice://":
      window.alert(
        "Glasshouse — Tauri file manager\nhttps://github.com/…",
      );
      return true;

    case "Documentation":
      console.log("[misc] not implemented: Documentation");
      return true;

    case "Release Notes":
      console.log("[misc] not implemented: Release Notes");
      return true;

    case "Check for Updates":
      console.log("[misc] not implemented: Check for Updates");
      return true;

    case "Report Bug":
    case "Report Bug…":
      console.log("[misc] not implemented: Report Bug");
      return true;

    case "Keybindings":
    case "Keybindings…":
    case "Cheatsheet":
    case "Shortcuts":
    case "Keybinding Cheatsheet":
      if (ctx.openPalette) {
        ctx.openPalette();
      } else {
        console.log(`[misc] not implemented: ${label}`);
      }
      return true;

    // ─── Session ───────────────────────────────────────────────────────────
    case "Save Session":
    case "Import Session":
    case "Import Session…":
    case "Export Session":
    case "Export Layout (.ricerc)":
      console.log(`[misc] not implemented: ${label}`);
      return true;

    // ─── Settings ──────────────────────────────────────────────────────────
    case "Edit .ricerc":
      if (ctx.openTweaks) {
        ctx.openTweaks();
      } else {
        console.log("[misc] not implemented: Edit .ricerc");
      }
      return true;

    case "Preferences":
    case "Preferences…":
      if (ctx.openTweaks) {
        ctx.openTweaks();
      } else {
        console.log("[misc] not implemented: Preferences");
      }
      return true;

    // ─── Destructive / special file ops ────────────────────────────────────
    case "Shred":
    case "Shred (srm)": {
      const target = ctx.firstPath;
      if (!target) {
        console.log("[misc] shred: nothing selected");
        return true;
      }
      if (window.confirm(`shred ${target}?`)) {
        console.log(`[misc] not implemented: Shred ${target}`);
      }
      return true;
    }

    case "Create Symlink":
    case "Create Symlink…": {
      const target = window.prompt("symlink target:");
      if (target == null) return true;
      console.log(`[misc] not implemented: Create Symlink -> ${target}`);
      return true;
    }

    // ─── Clipboard special paste ──────────────────────────────────────────
    case "Paste as Symlink":
    case "Paste as Link (symlink)":
    case "Paste as Hard Link":
    case "Paste as Shortcut":
    case "Paste as Copy (verify SHA256)":
    case "Paste Text into Filename":
      console.log(`[misc] not implemented: ${label}`);
      return true;

    // ─── File → New submenu ───────────────────────────────────────────────
    case "Python Module":
      await createPythonModule(ctx);
      return true;

    case "Script (.sh)":
      await promptAndCreate(ctx, "script.sh", "#!/usr/bin/env bash\n");
      return true;

    case "Text File":
      await promptAndCreate(ctx, "untitled.txt", "");
      return true;

    case "Markdown Note":
      await promptAndCreate(ctx, "note.md", "");
      return true;

    case "From Template…":
      await promptAndCreate(ctx, "untitled", "");
      return true;

    // ─── Undo / Redo ──────────────────────────────────────────────────────
    case "Undo":
      ctx.undo?.();
      return true;
    case "Redo":
      ctx.redo?.();
      return true;

    // ─── Terminal misc ────────────────────────────────────────────────────
    case "Run Last Command":
      console.log("[misc] not implemented: Run Last Command");
      return true;

    // ─── Refresh / Reload ─────────────────────────────────────────────────
    case "Refresh":
    case "Reload":
      ctx.refresh();
      return true;

    // ─── Submenu parents (no-ops, already marked consumed) ────────────────
    case "New":
    case "New →":
    case "Open With":
    case "Open With →":
    case "Template":
    case "Template →":
    case "Profile":
    case "Profile →":
      return true;

    default:
      return false;
  }
};
