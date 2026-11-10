import type { Handler } from "./types";
import { dialogs } from "../dialogs/DialogHost";

const ZOOM_KEY = "glasshouse.zoom";
const ZOOM_DEFAULT = 13;

/** The zoom saved in localStorage, or NaN when there's none. */
export function storedZoom(): number {
  const stored = localStorage.getItem(ZOOM_KEY);
  return stored ? parseInt(stored, 10) : NaN;
}

function readZoom(): number {
  const el = document.documentElement;
  const fromVar = el.style.getPropertyValue("--fs-base").trim();
  const parsedVar = parseInt(fromVar, 10);
  if (Number.isFinite(parsedVar)) return parsedVar;
  const parsedStored = storedZoom();
  return Number.isFinite(parsedStored) ? parsedStored : ZOOM_DEFAULT;
}

function applyZoom(px: number): void {
  const clamped = Math.max(10, Math.min(24, px));
  document.documentElement.style.setProperty("--fs-base", `${clamped}px`);
  localStorage.setItem(ZOOM_KEY, String(clamped));
}

function adjustZoom(delta: number): void {
  applyZoom(readZoom() + delta);
}

function resetZoom(): void {
  document.documentElement.style.removeProperty("--fs-base");
  localStorage.removeItem(ZOOM_KEY);
}

export const DISPLAY_MODE_KEY = "glasshouse.displayMode";
export const DISPLAY_MODE_DEFAULT = "Details (rows)";
export const LAYOUT_KEY = "glasshouse.layout";
export const LAYOUT_DEFAULT = "Tree + Pane + Inspector";

/** A Display Mode or Layout label as its <html> attribute value. */
export function slugify(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function setDisplayMode(mode: string): void {
  localStorage.setItem(DISPLAY_MODE_KEY, mode);
  document.documentElement.setAttribute("data-display-mode", slugify(mode));
  // Most modes are pure CSS off the attribute above, but Miller columns swaps
  // the pane component — App listens for this to re-render.
  window.dispatchEvent(new CustomEvent("glasshouse:display-mode", { detail: mode }));
}

function setLayout(layout: string): void {
  localStorage.setItem(LAYOUT_KEY, layout);
  document.documentElement.setAttribute("data-layout", slugify(layout));
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
      resetZoom();
      return true;

    case "Change Layout →": {
      // Palette-friendly: cycle through the canonical layouts instead of
      // requiring submenu navigation.
      const LAYOUTS = [
        "Tree + Pane + Inspector",
        "Single Pane",
      ];
      const current = localStorage.getItem(LAYOUT_KEY) ?? LAYOUTS[0];
      const idx = LAYOUTS.indexOf(current);
      const next = LAYOUTS[(idx < 0 ? 0 : idx + 1) % LAYOUTS.length];
      setLayout(next);
      dialogs.showToast({ message: `layout → ${next}`, variant: "success" });
      return true;
    }

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
      setLayout(label);
      return true;

    case "Sidebar":
      ctx.toggleSidebar();
      return true;

    case "Status Bar":
      if (ctx.toggleStatusBar) ctx.toggleStatusBar();
      else document.documentElement.classList.toggle("no-status");
      return true;

    default:
      return false;
  }
};
