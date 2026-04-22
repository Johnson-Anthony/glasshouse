import type { Handler } from "./types";

function adjustZoom(delta: number): void {
  const el = document.documentElement;
  const current = el.style.fontSize;
  const parsed = parseInt(current, 10);
  const base = Number.isFinite(parsed) ? parsed : 16;
  const next = Math.max(10, Math.min(24, base + delta));
  el.style.fontSize = `${next}px`;
}

const DISPLAY_MODE_KEY = "glasshouse.displayMode";
const LAYOUT_KEY = "glasshouse.layout";

function setDisplayMode(mode: string): void {
  localStorage.setItem(DISPLAY_MODE_KEY, mode);
  const slug = mode.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  document.documentElement.setAttribute("data-display-mode", slug);
}

function setLayout(layout: string): void {
  localStorage.setItem(LAYOUT_KEY, layout);
  const slug = layout.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  document.documentElement.setAttribute("data-layout", slug);
}

export const viewHandler: Handler = (label, ctx) => {
  switch (label) {
    case "Zoom In":
      adjustZoom(1);
      return true;
    case "Zoom Out":
      adjustZoom(-1);
      return true;
    case "Reset Zoom":
      document.documentElement.style.fontSize = "";
      return true;

    case "Sort By":
    case "Layout":
    case "Display Mode":
    case "Change Layout →":
    case "Paste Special →":
    case "Open Recent →":
    case "Tag →":
    case "Select by Tag →":
    case "Select by Extension →":
      return true;

    case "Name":
      ctx.activeHandle?.actions.setSortKey("name");
      return true;
    case "Size":
      ctx.activeHandle?.actions.setSortKey("size");
      return true;
    case "Modified":
      ctx.activeHandle?.actions.setSortKey("modified");
      return true;
    case "Type":
    case "Type / Extension":
      ctx.activeHandle?.actions.setSortKey("type");
      return true;
    case "Tag / Color":
      ctx.activeHandle?.actions.setSortKey("tag");
      return true;
    case "Git Column":
      ctx.activeHandle?.actions.setSortKey("git");
      return true;

    case "Descending": {
      const dir = ctx.activeHandle?.state.sortDir;
      ctx.activeHandle?.actions.setSortDir(dir === "desc" ? "asc" : "desc");
      return true;
    }

    case "Folders First": {
      if (ctx.tweaks && ctx.setTweaks) {
        ctx.setTweaks({ ...ctx.tweaks, foldersFirst: !ctx.tweaks.foldersFirst });
      }
      const next = !(ctx.activeHandle?.state.foldersFirst ?? true);
      ctx.activeHandle?.actions.setFoldersFirst(next);
      return true;
    }

    case "Show File Extensions":
      if (ctx.tweaks && ctx.setTweaks) {
        ctx.setTweaks({ ...ctx.tweaks, showExtensions: !ctx.tweaks.showExtensions });
      }
      return true;
    case "Show Git Gutters":
      if (ctx.tweaks && ctx.setTweaks) {
        ctx.setTweaks({ ...ctx.tweaks, showGitGutters: !ctx.tweaks.showGitGutters });
      }
      return true;
    case "Show Ignored (.gitignore)":
      if (ctx.tweaks && ctx.setTweaks) {
        ctx.setTweaks({ ...ctx.tweaks, showIgnored: !ctx.tweaks.showIgnored });
      }
      return true;

    case "Compact List":
    case "Details (rows)":
    case "Grid (thumbs)":
    case "Icons":
    case "Tiles":
    case "Miller Columns (ranger)":
    case "Tree Flat":
      setDisplayMode(label);
      return true;

    case "Tree + Pane + Inspector":
    case "Single Pane":
    case "Dual Pane (top/bottom)":
    case "Split Horizontal":
    case "Split Vertical":
    case "Tmux Quad (4-pane)":
    case "Split Down":
    case "Split Right":
      setLayout(label);
      return true;

    case "Sidebar":
      ctx.toggleSidebar();
      return true;

    case "Status Bar":
      document.documentElement.classList.toggle("no-status");
      return true;

    case "Show Checksums":
      if (ctx.tweaks && ctx.setTweaks) {
        // TODO: add showChecksums to TweakState in components.tsx
        const prev = (ctx.tweaks as any).showChecksums;
        ctx.setTweaks({ ...ctx.tweaks, showChecksums: !prev } as any);
      }
      return true;

    default:
      return false;
  }
};
