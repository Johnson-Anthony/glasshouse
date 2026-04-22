import type { Handler } from "./types";
import { spawnTerminal, spawnVscode } from "../api";

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
      console.log("[nav] not implemented: Clear History");
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
    case "Move Tab Right":
    case "Move Tab →":
      console.log(`[nav] not implemented: ${label}`);
      return true;

    case "New Window":
    case "Open in New Window":
      console.log(`[nav] not implemented: ${label}`);
      return true;

    case "New Tab":
      console.log("[nav] not implemented: New Tab");
      return true;

    case "New Private Session":
      console.log("[nav] not implemented: New Private Session");
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

    case "Always on Top":
      console.log("[nav] not implemented: Always on Top");
      return true;

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
      console.log("[nav] not implemented: Manage Bookmarks");
      return true;

    case "Jump to Bookmark…": {
      const path = window.prompt("bookmark path:");
      if (path) ctx.activeHandle?.actions.goTo(path);
      return true;
    }

    case "Snap Left":
    case "Snap Right":
    case "Snap Left / Right":
    case "Focus Pane":
    case "Focus Pane ↑":
    case "Focus Pane ↓":
    case "Zoom Pane":
      console.log(`[nav] not implemented: ${label}`);
      return true;

    default:
      return false;
  }
};
