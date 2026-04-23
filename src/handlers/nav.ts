import type { Handler } from "./types";
import { dialogs } from "../components";
import {
  spawnTerminal,
  spawnVscode,
  spawnNewWindow,
  readPins,
  readRecent,
  homeDir,
  clearRecent,
  listWslDistros,
} from "../api";

function joinPath(dir: string, name: string): string {
  if (!dir) return name;
  const sep = dir.includes("\\") && !dir.includes("/") ? "\\" : "/";
  const trimmed = dir.replace(/[\\/]+$/, "");
  return trimmed + sep + name;
}

export const navHandler: Handler = async (label, ctx) => {
  switch (label) {
    // Palette-invoked submenu parents. Menubar presents them as hovers; from
    // the palette there is no hover target so we drop a prompt asking the
    // user to pick a target. "Open Recent →" and "Jump to Bookmark →" list
    // real paths; "Go →" and "Bookmarks →" fall back to a toast hint.
    case "Open Recent →":
    case "Open Recent": {
      const paths = await readRecent();
      if (paths.length === 0) {
        dialogs.showToast({ message: "no recent paths", variant: "info" });
        return true;
      }
      const picked = await dialogs.showPrompt({
        title: "open recent",
        message: paths.slice(0, 8).map((p, i) => `${i + 1}. ${p}`).join("\n"),
        placeholder: "1",
        validate: (v) => {
          const n = parseInt(v.trim(), 10);
          return (Number.isFinite(n) && n >= 1 && n <= paths.length)
            ? null
            : `enter 1..${Math.min(paths.length, 8)}`;
        },
      });
      if (picked != null) {
        const n = parseInt(picked.trim(), 10) - 1;
        const p = paths[n];
        if (p) ctx.activeHandle?.actions.goTo(p);
      }
      return true;
    }
    case "Jump to Bookmark →": {
      const pins = await readPins();
      if (pins.length === 0) {
        dialogs.showToast({ message: "no bookmarks", variant: "info" });
        return true;
      }
      const picked = await dialogs.showPrompt({
        title: "jump to bookmark",
        message: pins.slice(0, 10).map((p, i) => `${i + 1}. ${p}`).join("\n"),
        placeholder: "1",
        validate: (v) => {
          const n = parseInt(v.trim(), 10);
          return (Number.isFinite(n) && n >= 1 && n <= pins.length)
            ? null
            : `enter 1..${Math.min(pins.length, 10)}`;
        },
      });
      if (picked != null) {
        const n = parseInt(picked.trim(), 10) - 1;
        const p = pins[n];
        if (p) ctx.activeHandle?.actions.goTo(p);
      }
      return true;
    }
    case "Go →":
    case "Bookmarks →":
      dialogs.showToast({ message: `"${label}" — open from the menubar to browse submenu`, variant: "info" });
      return true;

    case "Clear History":
      ctx.activeHandle?.actions.clearHistory();
      void clearRecent();
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

    case "New Window":
    case "Open in New Window":
      void spawnNewWindow();
      return true;

    case "New Tab":
      ctx.newTab?.(ctx.cwd);
      return true;

    case "New Private Session":
      ctx.newTab?.(ctx.cwd, { private: true });
      return true;

    case "Open…":
    case "Open Path…":
    case "Open Path": {
      const path = await dialogs.showPrompt({
        title: "open",
        message: "enter path or URL:",
        placeholder: "C:\\… or /… or https://…",
        validate: (v) => v.trim() ? null : "path required",
      });
      if (path != null && path.trim() !== "") {
        ctx.activeHandle?.actions.goTo(path.trim());
      }
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

    case "Go to WSL Distro":
    case "Go to WSL Distro…": {
      let distros: Awaited<ReturnType<typeof listWslDistros>> = [];
      try { distros = await listWslDistros(); } catch { distros = []; }
      const message = distros.length === 0
        ? "no distros detected — type a distro name:"
        : `available: ${distros.map(d => d.name).join(", ")}`;
      const distro = await dialogs.showPrompt({
        title: "go to WSL distro",
        message,
        placeholder: distros[0]?.name ?? "Ubuntu",
        validate: (v) => v.trim() ? null : "distro name required",
      });
      if (distro == null || distro.trim() === "") return true;
      ctx.activeHandle?.actions.goTo(`/mnt/wsl/${distro.trim()}`);
      return true;
    }

    case "Bookmark Folder":
    case "Bookmark This Folder":
      if (ctx.cwd) ctx.pinPath(ctx.cwd);
      return true;

    case "Pin to Workspace":
      ctx.pinPath(ctx.firstPath ?? ctx.cwd);
      return true;

    case "Jump to Bookmark…": {
      const path = await dialogs.showPrompt({
        title: "jump to bookmark",
        message: "bookmark path:",
        placeholder: "C:\\… or /…",
        validate: (v) => v.trim() ? null : "path required",
      });
      if (path != null && path.trim() !== "") {
        ctx.activeHandle?.actions.goTo(path.trim());
      }
      return true;
    }

    case "Zoom Pane": {
      const target =
        document.querySelector(".file-pane.active") ??
        document.documentElement;
      target.classList.toggle("zoomed");
      return true;
    }

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

    case "Trash":
    case "Go to Trash":
    case "Go to Trash…": {
      // In-app only — spawning Windows Explorer here (shell:RecycleBinFolder)
      // yanks the user out of Glasshouse and was a repeat complaint. A real
      // in-app trash view needs FOLDERID_RecycleBinFolder + IShellFolder COM
      // enumeration; stub it with a toast until that ships.
      dialogs.showToast({ message: "trash view coming in v2", variant: "info" });
      return true;
    }

    default: {
      // Fallback: a label that looks like a path (absolute, drive-prefixed,
      // or ~-prefixed) gets navigated to directly. Dynamic menu items attach
      // a `payload` and short-circuit before this handler sees them, so this
      // only catches stragglers from palette/palette-like dispatches.
      const looksLikePath =
        label.startsWith("/") ||
        label.startsWith("~") ||
        /^[A-Za-z]:[\\/]/.test(label);
      if (looksLikePath) {
        void (async () => {
          let target = label;
          if (target.startsWith("~")) {
            const home = await homeDir();
            if (home) target = home + target.slice(1);
          }
          ctx.activeHandle?.actions.goTo(target);
        })();
        return true;
      }
      return false;
    }
  }
};
