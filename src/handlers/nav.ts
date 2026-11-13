import type { Handler } from "./types";
import { openTyped, pickNumbered } from "./helpers";
import { dialogs } from "../dialogs/DialogHost";
import { IS_WINDOWS } from "../platform";
import { looksLikePath } from "../paths";
import {
  spawnNewWindow,
  readPins,
  readRecent,
  knownFolder,
  clearRecent,
  listWslDistros,
  type KnownFolder,
} from "../api";

export const navHandler: Handler = async (label, ctx) => {
  switch (label) {
    // Palette entries for what the menubar shows as submenus: the palette
    // can't open a submenu, so these prompt with a numbered list instead.
    case "Open Recent →": {
      const paths = await readRecent();
      if (paths.length === 0) {
        dialogs.showToast({ message: "no recent paths", variant: "info" });
        return true;
      }
      const p = await pickNumbered("open recent", paths, p => p, 8);
      if (p) ctx.activeHandle?.actions.goTo(p);
      return true;
    }
    case "Jump to Bookmark →": {
      const pins = await readPins();
      if (pins.length === 0) {
        dialogs.showToast({ message: "no bookmarks", variant: "info" });
        return true;
      }
      const p = await pickNumbered("jump to bookmark", pins, p => p, 10);
      if (p) ctx.activeHandle?.actions.goTo(p);
      return true;
    }
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

    case "New Private Session":
      ctx.newTab?.(ctx.cwd, { private: true });
      return true;

    case "Open…": {
      await dialogs.showPrompt({
        title: "open",
        message: "enter path or URL:",
        placeholder: IS_WINDOWS ? "C:\\… or /… or https://…" : "/… or ~/… or https://…",
        validate: (v) => v.trim() ? null : "path required",
        submit: (v) => openTyped(v, ctx),
      });
      return true;
    }

    case "Go to WSL Distro…": {
      const distros = await listWslDistros();
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
      const name = distro.trim();
      // Same `\\wsl$\<name>\` root the sidebar uses; fall back to building it
      // for a distro the backend didn't list.
      const known = distros.find(d => d.name.toLowerCase() === name.toLowerCase());
      ctx.activeHandle?.actions.goTo(known?.path ?? `\\\\wsl$\\${name}\\`);
      return true;
    }

    case "Bookmark Folder":
    case "Bookmark This Folder":
      if (ctx.cwd) ctx.pinPath(ctx.cwd);
      return true;

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

    case "Desktop":
    case "Documents":
    case "Downloads":
    case "Pictures":
      void (async () => {
        const dir = await knownFolder(label as KnownFolder);
        if (!dir) {
          await dialogs.showAlert({ title: "Navigation", message: `${label} folder unavailable` });
          return;
        }
        ctx.activeHandle?.actions.goTo(dir);
      })();
      return true;

    case "Trash":
      // The Trash dialog (dialogs/Trash.tsx), on both platforms: the items,
      // where they came from, and Restore. On Linux it also links to the
      // trash folder, which Go → Trash used to open.
      ctx.app?.setTrashOpen(true);
      return true;

    default: {
      // Fallback: a label that looks like a path (absolute, drive-prefixed,
      // or ~-prefixed) is opened as Go to Path… opens it. Dynamic menu items
      // attach a `payload` and short-circuit before this handler sees them,
      // so this is the palette's "Go to <path>" row, which sends the typed
      // path.
      if (looksLikePath(label)) {
        void (async () => {
          const problem = await openTyped(label, ctx);
          if (problem) await dialogs.showAlert({ title: "go to", variant: "error", message: problem });
        })();
        return true;
      }
      return false;
    }
  }
};
