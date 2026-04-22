import type { Handler, HandlerCtx } from "./types";
import {
  makeDir,
  writeText,
  readText,
  openUrl,
  createSymlink,
  createHardLink,
  createShortcut,
  shred,
  homeDir,
  renameEntry,
  readTags,
  writeTags,
  copyEntry,
  hashSha256,
} from "../api";
import { lastCommandRef } from "../state";

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

async function sessionDir(): Promise<string> {
  const home = await homeDir();
  const base = home ?? ".";
  return joinPath(base, ".glasshouse");
}

async function sessionPath(): Promise<string> {
  return joinPath(await sessionDir(), "session.json");
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

async function writeSession(ctx: HandlerCtx, path: string): Promise<void> {
  const payload = {
    version: 1,
    activeTab: ctx.activeTab,
    tabs: ctx.tabs,
  };
  const dir = path.slice(0, Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")));
  if (dir) await makeDir(dir);
  await writeText(path, JSON.stringify(payload, null, 2));
}

export const miscHandler: Handler = async (label, ctx) => {
  switch (label) {
    // ─── Help / About ──────────────────────────────────────────────────────
    case "About":
    case "About Glasshouse":
    case "About rice://":
      if (ctx.openAbout) {
        ctx.openAbout();
      } else {
        window.alert("Glasshouse — Tauri file manager");
      }
      return true;

    case "Documentation":
      await openUrl("https://github.com/anthony/glasshouse#readme");
      return true;

    case "Release Notes":
      await openUrl("https://github.com/anthony/glasshouse/releases");
      return true;

    case "Check for Updates":
      window.alert("Current version: 0.0.1. Opening releases page…");
      await openUrl("https://github.com/anthony/glasshouse/releases");
      return true;

    case "Report Bug":
    case "Report Bug…":
      await openUrl("https://github.com/anthony/glasshouse/issues/new");
      return true;

    case "Keybindings":
    case "Keybindings…":
    case "Cheatsheet":
    case "Shortcuts":
    case "Keybinding Cheatsheet":
      ctx.openPalette?.();
      return true;

    // ─── Session ───────────────────────────────────────────────────────────
    case "Save Session": {
      const path = await sessionPath();
      await writeSession(ctx, path);
      window.alert(`saved session: ${path}`);
      return true;
    }

    case "Import Session":
    case "Import Session…": {
      const path = await sessionPath();
      const raw = await readText(path, 1024 * 1024);
      if (!raw) {
        window.alert(`no session found at ${path}`);
        return true;
      }
      try {
        const parsed = JSON.parse(raw) as { tabs?: Array<{ path?: string }> };
        const paths = (parsed.tabs ?? []).map(t => t?.path ?? "").filter(Boolean);
        window.alert(
          paths.length
            ? `session tabs:\n${paths.join("\n")}`
            : "session has no tabs",
        );
      } catch (e) {
        window.alert(`failed to parse session: ${e instanceof Error ? e.message : String(e)}`);
      }
      return true;
    }

    case "Export Session": {
      const def = await sessionPath();
      const target = window.prompt("export session to:", def);
      if (target == null || target.trim() === "") return true;
      await writeSession(ctx, target.trim());
      window.alert(`exported session: ${target.trim()}`);
      return true;
    }

    case "Export Layout (.ricerc)": {
      const target = joinPath(ctx.cwd, ".ricerc");
      const body = JSON.stringify({ version: 1, cwd: ctx.cwd }, null, 2);
      await writeText(target, body);
      console.log(`[misc] exported layout: ${target}`);
      ctx.refresh();
      return true;
    }

    // ─── Settings ──────────────────────────────────────────────────────────
    case "Edit .ricerc":
      ctx.openTweaks();
      return true;

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
      if (!window.confirm(`shred ${target}? this is irreversible.`)) return true;
      await shred(target, 3);
      window.alert(`shredded ${target}`);
      ctx.refresh();
      return true;
    }

    case "Create Symlink":
    case "Create Symlink…": {
      const target = window.prompt("symlink target:");
      if (target == null || target.trim() === "") return true;
      const defLink = joinPath(ctx.cwd, basename(target.trim()));
      const linkPath = window.prompt("link path:", defLink);
      if (linkPath == null || linkPath.trim() === "") return true;
      await createSymlink(target.trim(), linkPath.trim());
      window.alert(`symlink: ${linkPath.trim()} -> ${target.trim()}`);
      ctx.refresh();
      return true;
    }

    // ─── Clipboard special paste ──────────────────────────────────────────
    case "Paste as Symlink":
    case "Paste as Link (symlink)": {
      const paths = ctx.clipboardPaths?.() ?? [];
      if (paths.length === 0) {
        window.alert("clipboard is empty");
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
      window.alert(`created ${ok}/${paths.length} symlink(s)`);
      ctx.refresh();
      return true;
    }

    case "Paste as Hard Link": {
      const paths = ctx.clipboardPaths?.() ?? [];
      if (paths.length === 0) {
        window.alert("clipboard is empty");
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
      window.alert(`created ${ok}/${paths.length} hard link(s)`);
      ctx.refresh();
      return true;
    }

    case "Paste as Shortcut": {
      const paths = ctx.clipboardPaths?.() ?? [];
      if (paths.length === 0) {
        window.alert("clipboard is empty");
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
      window.alert(`created ${ok}/${paths.length} shortcut(s)`);
      ctx.refresh();
      return true;
    }

    case "Clear All Tags": {
      const firstPath = ctx.firstPath;
      if (!firstPath) {
        window.alert("no selection");
        return true;
      }
      const tags = await readTags();
      delete tags[firstPath];
      await writeTags(tags);
      ctx.refresh();
      window.alert("ok");
      return true;
    }

    case "Paste as Copy (verify SHA256)": {
      const paths = ctx.clipboardPaths?.() ?? [];
      if (paths.length === 0) {
        window.alert("clipboard is empty");
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
      window.alert(`copied ${ok}/${paths.length}, ${verified} verified via SHA256`);
      ctx.refresh();
      return true;
    }

    case "Paste Text into Filename": {
      const target = ctx.firstPath;
      if (!target) {
        window.alert("no selection to rename");
        return true;
      }
      let text = "";
      try {
        text = await navigator.clipboard.readText();
      } catch (e) {
        window.alert(`clipboard read failed: ${e instanceof Error ? e.message : String(e)}`);
        return true;
      }
      const name = text.trim();
      if (!name) {
        window.alert("clipboard text is empty");
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

    // ─── Terminal misc ────────────────────────────────────────────────────
    case "Run Last Command": {
      const last = lastCommandRef.value;
      if (!last) {
        window.alert("no last command");
        return true;
      }
      ctx.dispatch(last);
      return true;
    }

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
