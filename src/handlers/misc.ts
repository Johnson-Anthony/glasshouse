import type { Handler, HandlerCtx } from "./types";
import { dialogs } from "../components";
import { IS_WINDOWS } from "../platform";
import {
  makeDir,
  writeText,
  openUrl,
  createSymlink,
  createHardLink,
  createShortcut,
  shred,
  renameEntry,
  readTags,
  writeTags,
  copyEntry,
  hashSha256,
} from "../api";
// Join a directory with a filename using whichever separator the cwd appears
// to use. Matches parentPath() in state.ts — backslash wins only if the path
// already contains one.
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

async function createFileAt(ctx: HandlerCtx, name: string, body: string): Promise<void> {
  const path = joinPath(ctx.cwd, name);
  await writeText(path, body);
  ctx.refresh();
}

async function promptAndCreate(ctx: HandlerCtx, defaultName: string, body = ""): Promise<void> {
  const name = await dialogs.showPrompt({
    title: "new file",
    message: "file name:",
    initialValue: defaultName,
    placeholder: defaultName,
    validate: (v) => v.trim() ? null : "name required",
  });
  if (name == null || name.trim() === "") return;
  await createFileAt(ctx, name.trim(), body);
}

async function createPythonModule(ctx: HandlerCtx): Promise<void> {
  const name = await dialogs.showPrompt({
    title: "new python module",
    message: "module name (creates a folder with __init__.py):",
    placeholder: "my_module",
    validate: (v) => v.trim() ? null : "name required",
  });
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
      if (ctx.openAbout) {
        ctx.openAbout();
      } else {
        await dialogs.showAlert({ title: "about", message: "Glasshouse — Tauri file manager" });
      }
      return true;

    case "Documentation":
      await openUrl("https://github.com/anthony/glasshouse#readme");
      return true;

    case "Release Notes":
      await openUrl("https://github.com/anthony/glasshouse/releases");
      return true;

    case "Check for Updates":
      await dialogs.showAlert({ title: "check for updates", message: "Current version: 0.0.1. Opening releases page…", variant: "info" });
      await openUrl("https://github.com/anthony/glasshouse/releases");
      return true;

    case "Report Bug":
    case "Report Bug…":
      await openUrl("https://github.com/anthony/glasshouse/issues/new");
      return true;

    case "Export Layout (.ricerc)": {
      const target = joinPath(ctx.cwd, ".ricerc");
      const body = JSON.stringify({ version: 1, cwd: ctx.cwd }, null, 2);
      await writeText(target, body);
      console.log(`[misc] exported layout: ${target}`);
      ctx.refresh();
      return true;
    }

    // ─── Settings ──────────────────────────────────────────────────────────
    case "Preferences":
    case "Preferences…":
      ctx.openTweaks();
      return true;

    // ─── Destructive / special file ops ────────────────────────────────────
    case "Shred":
    case "Shred (srm)": {
      const target = ctx.firstPath;
      if (!target) {
        console.log("[misc] shred: nothing selected");
        return true;
      }
      const confirmed = await dialogs.showConfirm({
        title: "shred file",
        message: `Shred ${target}?\n\nThis is irreversible — the file will be overwritten with random bytes and deleted.`,
        danger: true,
      });
      if (!confirmed) return true;
      await shred(target, 3);
      dialogs.showToast({ message: `shredded ${target}`, variant: "success" });
      ctx.refresh();
      return true;
    }

    case "Create Symlink":
    case "Create Symlink…": {
      const target = await dialogs.showPrompt({
        title: "create symlink",
        message: "target file or folder:",
        placeholder: IS_WINDOWS ? "C:\\path\\to\\target" : "/path/to/target",
        validate: (v) => v.trim() ? null : "target required",
      });
      if (target == null || target.trim() === "") return true;
      const defLink = joinPath(ctx.cwd, basename(target.trim()));
      const linkPath = await dialogs.showPrompt({
        title: "create symlink",
        message: "link path:",
        initialValue: defLink,
        placeholder: defLink,
        validate: (v) => v.trim() ? null : "link path required",
      });
      if (linkPath == null || linkPath.trim() === "") return true;
      await createSymlink(target.trim(), linkPath.trim());
      dialogs.showToast({ message: `symlink → ${target.trim()}`, variant: "success" });
      ctx.refresh();
      return true;
    }

    // ─── Clipboard special paste ──────────────────────────────────────────
    case "Paste as Symlink":
    case "Paste as Link (symlink)": {
      const paths = ctx.clipboardPaths?.() ?? [];
      if (paths.length === 0) {
        dialogs.showToast({ message: "clipboard is empty", variant: "info" });
        return true;
      }
      let ok = 0;
      for (const p of paths) {
        try {
          await createSymlink(p, joinPath(ctx.cwd, basename(p)));
          ok++;
        } catch (e) {
          console.error("[misc] symlink failed", p, e);
        }
      }
      dialogs.showToast({ message: `created ${ok}/${paths.length} symlink(s)`, variant: "success" });
      ctx.refresh();
      return true;
    }

    case "Paste as Hard Link": {
      const paths = ctx.clipboardPaths?.() ?? [];
      if (paths.length === 0) {
        dialogs.showToast({ message: "clipboard is empty", variant: "info" });
        return true;
      }
      let ok = 0;
      for (const p of paths) {
        try {
          await createHardLink(p, joinPath(ctx.cwd, basename(p)));
          ok++;
        } catch (e) {
          console.error("[misc] hard link failed", p, e);
        }
      }
      dialogs.showToast({ message: `created ${ok}/${paths.length} hard link(s)`, variant: "success" });
      ctx.refresh();
      return true;
    }

    case "Paste as Shortcut": {
      const paths = ctx.clipboardPaths?.() ?? [];
      if (paths.length === 0) {
        dialogs.showToast({ message: "clipboard is empty", variant: "info" });
        return true;
      }
      let ok = 0;
      for (const p of paths) {
        try {
          await createShortcut(p, joinPath(ctx.cwd, basename(p) + ".lnk"));
          ok++;
        } catch (e) {
          console.error("[misc] shortcut failed", p, e);
        }
      }
      dialogs.showToast({ message: `created ${ok}/${paths.length} shortcut(s)`, variant: "success" });
      ctx.refresh();
      return true;
    }

    case "Clear All Tags": {
      const firstPath = ctx.firstPath;
      if (!firstPath) {
        dialogs.showToast({ message: "no selection", variant: "info" });
        return true;
      }
      const tags = await readTags();
      delete tags[firstPath];
      await writeTags(tags);
      ctx.refresh();
      dialogs.showToast({ message: "cleared all tags", variant: "success" });
      return true;
    }

    case "Paste as Copy (verify SHA256)": {
      const paths = ctx.clipboardPaths?.() ?? [];
      if (paths.length === 0) {
        dialogs.showToast({ message: "clipboard is empty", variant: "info" });
        return true;
      }
      let ok = 0;
      let verified = 0;
      for (const src of paths) {
        const dest = joinPath(ctx.cwd, basename(src));
        try {
          await copyEntry(src, dest);
          ok++;
          try {
            const [ha, hb] = await Promise.all([hashSha256(src), hashSha256(dest)]);
            if (ha && hb && ha === hb) verified++;
          } catch (e) {
            console.error("[misc] hash verify failed", src, e);
          }
        } catch (e) {
          console.error("[misc] copy failed", src, e);
        }
      }
      dialogs.showToast({ message: `copied ${ok}/${paths.length}, ${verified} verified via SHA256`, variant: "success" });
      ctx.refresh();
      return true;
    }

    case "Paste Text into Filename": {
      const target = ctx.firstPath;
      if (!target) {
        dialogs.showToast({ message: "no selection to rename", variant: "info" });
        return true;
      }
      let text = "";
      try {
        text = await navigator.clipboard.readText();
      } catch (e) {
        await dialogs.showAlert({
          title: "clipboard read failed",
          message: e instanceof Error ? e.message : String(e),
          variant: "error",
        });
        return true;
      }
      const name = text.trim();
      if (!name) {
        dialogs.showToast({ message: "clipboard text is empty", variant: "info" });
        return true;
      }
      const dir = target.slice(0, Math.max(target.lastIndexOf("/"), target.lastIndexOf("\\")));
      const dest = joinPath(dir, name);
      await renameEntry(target, dest);
      ctx.refresh();
      return true;
    }

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
