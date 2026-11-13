import { stepZoom, ZOOM_DEFAULT } from "../zoom";
import type { HandlerCtx, Handler } from "./types";

/** Zoom In / Out / Reset: the zoom is a saved tweak, which App applies. */
function setZoom(ctx: HandlerCtx, zoom: (z: number) => number): void {
  if (ctx.tweaks && ctx.setTweaks) ctx.setTweaks({ ...ctx.tweaks, zoom: zoom(ctx.tweaks.zoom) });
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
  // Most modes are pure CSS off the attribute above, but Miller columns wraps
  // the pane in more columns — App listens for this to re-render.
  window.dispatchEvent(new CustomEvent("glasshouse:display-mode", { detail: mode }));
}

function setLayout(layout: string): void {
  localStorage.setItem(LAYOUT_KEY, layout);
  document.documentElement.setAttribute("data-layout", slugify(layout));
}

export const viewHandler: Handler = (label, ctx) => {
  switch (label) {
    case "Zoom In":
      setZoom(ctx, z => stepZoom(z, 1));
      return true;
    case "Zoom Out":
      setZoom(ctx, z => stepZoom(z, -1));
      return true;
    case "Reset Zoom":
      setZoom(ctx, () => ZOOM_DEFAULT);
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
      return true;
    }

    case "Follow Folder": {
      if (ctx.tweaks && ctx.setTweaks) {
        ctx.setTweaks({ ...ctx.tweaks, termFollow: !ctx.tweaks.termFollow });
      }
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
