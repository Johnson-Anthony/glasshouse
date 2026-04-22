import type { Handler } from "./types";
import {
  spawnTerminal,
  spawnVscode,
  spawnNewWindow,
  setAlwaysOnTop,
  readPins,
  writePins,
  homeDir,
  openUrl,
} from "../api";

function joinPath(dir: string, name: string): string {
  if (!dir) return name;
  const sep = dir.includes("\\") && !dir.includes("/") ? "\\" : "/";
  const trimmed = dir.replace(/[\\/]+$/, "");
  return trimmed + sep + name;
}

export const navHandler: Handler = (label, ctx) => {
  switch (label) {
    // Submenu parents — consume as no-ops
    case "Open Recent →":
    case "Open Recent":
    case "Go →":
    case "Bookmarks →":
    case "Jump to Bookmark →":
      return true;

    case "Clear History":
      ctx.activeHandle?.actions.clearHistory();
      return true;

    case "Next Location":
      ctx.activeHandle?.actions.forward();
      return true;
    case "Previous Location":
      ctx.activeHandle?.actions.back();
      return true;

    case "Next Tab": {
      if (ctx.tabs.length > 0) {
        ctx.setActiveTab((ctx.activeTab + 1) % ctx.tabs.length);
      }
      return true;
    }
    case "Previous Tab":
    case "Prev Tab": {
      const n = ctx.tabs.length;
      if (n > 0) {
        ctx.setActiveTab((ctx.activeTab - 1 + n) % n);
      }
      return true;
    }

    case "Move Tab Left":
    case "Move Tab ←":
      ctx.moveTab?.(ctx.activeTab, Math.max(0, ctx.activeTab - 1));
      return true;
    case "Move Tab Right":
    case "Move Tab →":
      ctx.moveTab?.(ctx.activeTab, Math.min(ctx.tabs.length - 1, ctx.activeTab + 1));
      return true;

    case "New Window":
    case "Open in New Window":
      void spawnNewWindow();
      return true;

    case "New Tab":
      ctx.newTab?.(ctx.cwd);
      return true;

    case "New Private Session":
      window.alert("Private mode not tracked yet");
      ctx.newTab?.(ctx.cwd);
      return true;

    case "Open…": {
      const path = window.prompt("path to open:");
      if (path) ctx.activeHandle?.actions.goTo(path);
      return true;
    }

    case "Open in Terminal": {
      const target = ctx.firstPath ?? ctx.cwd;
      if (target) void spawnTerminal(target);
      return true;
    }
    case "Open in VS Code": {
      const target = ctx.firstPath ?? ctx.cwd;
      if (target) void spawnVscode(target);
      return true;
    }

    case "Always on Top": {
      const key = "glasshouse.alwaysOnTop";
      const current = localStorage.getItem(key) === "1";
      const next = !current;
      localStorage.setItem(key, next ? "1" : "0");
      void setAlwaysOnTop(next);
      return true;
    }

    case "Go to WSL Distro":
    case "Go to WSL Distro…": {
      const distro = window.prompt("distro name:");
      if (distro) {
        ctx.activeHandle?.actions.goTo(`/mnt/wsl/${distro}`);
      }
      return true;
    }

    case "cd Here": {
      const target = ctx.cwd;
      if (target) {
        try {
          void navigator.clipboard.writeText(`cd "${target}"`);
        } catch {
          console.log("[nav] cd Here: clipboard unavailable");
        }
      }
      return true;
    }

    case "Bookmark Folder":
    case "Bookmark This Folder":
      if (ctx.cwd) ctx.pinPath(ctx.cwd);
      return true;

    case "Pin to Workspace":
      ctx.pinPath(ctx.firstPath ?? ctx.cwd);
      return true;

    case "Manage Bookmarks":
    case "Manage Bookmarks…":
      void (async () => {
        const pins = await readPins();
        if (pins.length === 0) {
          window.alert("pins: 0");
          return;
        }
        const listed = pins.map((p, i) => `${i + 1}. ${p}`).join("\n");
        const answer = window.prompt(`${listed}\n\nremove # (blank=cancel):`);
        if (!answer) return;
        const idx = Number.parseInt(answer, 10);
        if (!Number.isFinite(idx) || idx < 1 || idx > pins.length) return;
        const filtered = pins.filter((_, i) => i !== idx - 1);
        await writePins(filtered);
        ctx.refresh();
      })();
      return true;

    case "Jump to Bookmark…": {
      const path = window.prompt("bookmark path:");
      if (path) ctx.activeHandle?.actions.goTo(path);
      return true;
    }

    case "Zoom Pane": {
      const target =
        document.querySelector(".file-pane.active") ??
        document.documentElement;
      target.classList.toggle("zoomed");
      return true;
    }

    case "Snap Left":
    case "Snap Right":
    case "Snap Left / Right":
    case "Focus Pane":
    case "Focus Pane ↑":
    case "Focus Pane ↓":
      console.log(`[nav] not implemented: ${label}`);
      return true;

    case "Root  /":
      ctx.activeHandle?.actions.goTo("/");
      return true;

    case "Home":
      void (async () => {
        const home = await homeDir();
        if (!home) {
          window.alert("home directory unavailable");
          return;
        }
        ctx.activeHandle?.actions.goTo(home);
      })();
      return true;

    case "Desktop":
    case "Documents":
    case "Downloads":
    case "Pictures":
      void (async () => {
        const home = await homeDir();
        if (!home) {
          window.alert("home directory unavailable");
          return;
        }
        ctx.activeHandle?.actions.goTo(joinPath(home, label));
      })();
      return true;

    case "Trash": {
      const isWindows =
        typeof navigator !== "undefined" &&
        /win/i.test(navigator.platform || navigator.userAgent || "");
      if (isWindows) {
        void openUrl("shell:RecycleBinFolder");
      } else {
        window.alert("Trash shortcut is Windows-only");
      }
      return true;
    }

    case "SSH: void@server": {
      const key = "glasshouse.remote.servers";
      let list: { label: string; host: string; user?: string }[] = [];
      try {
        const raw = localStorage.getItem(key);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) list = parsed;
        }
      } catch (e) {
        console.log("[nav] SSH: failed to read servers:", e);
      }
      const match = list.find(
        (r) =>
          r.label === "void@server" ||
          (r.user === "void" && r.host === "server") ||
          r.host === "void@server",
      );
      if (!match) {
        window.alert("configure via Connect to Server…");
        return true;
      }
      const user = match.user ?? "void";
      const host = match.host;
      const cmd = `ssh ${user}@${host}`;
      try {
        void navigator.clipboard.writeText(cmd);
      } catch {
        console.log("[nav] SSH: clipboard unavailable");
      }
      void spawnTerminal(ctx.cwd);
      return true;
    }

    default:
      return false;
  }
};
