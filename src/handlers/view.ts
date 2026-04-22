import type { Handler } from "./types";

function adjustZoom(delta: number): void {
  const el = document.documentElement;
  const current = el.style.fontSize;
  const parsed = parseInt(current, 10);
  const base = Number.isFinite(parsed) ? parsed : 16;
  const next = Math.max(10, Math.min(24, base + delta));
  el.style.fontSize = `${next}px`;
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
      ctx.activeHandle?.actions.setSortKey("name");
      console.log("[view] sort by type not implemented; falling back to name");
      return true;
    case "Tag / Color":
      ctx.activeHandle?.actions.setSortKey("tag");
      return true;

    case "Descending": {
      const dir = ctx.activeHandle?.state.sortDir;
      ctx.activeHandle?.actions.setSortDir(dir === "desc" ? "asc" : "desc");
      return true;
    }

    case "Folders First":
      console.log("[view] folders first not implemented");
      return true;

    case "Show File Extensions":
    case "Show Git Gutters":
    case "Show Ignored (.gitignore)":
      console.log(`[view] toggle not implemented: ${label}`);
      return true;

    case "Compact List":
    case "Details (rows)":
    case "Grid (thumbs)":
    case "Icons":
    case "Tiles":
    case "Miller Columns (ranger)":
    case "Tree Flat":
      console.log(`[view] display mode not implemented: ${label}`);
      return true;

    case "Tree + Pane + Inspector":
    case "Single Pane":
    case "Dual Pane (top/bottom)":
    case "Split Horizontal":
    case "Split Vertical":
    case "Tmux Quad (4-pane)":
    case "Split Down":
    case "Split Right":
      console.log(`[view] layout not implemented: ${label}`);
      return true;

    case "Sidebar":
      ctx.toggleSidebar();
      return true;

    case "Status Bar":
    case "Always on Top":
      console.log(`[view] toggle not implemented: ${label}`);
      return true;

    default:
      return false;
  }
};
