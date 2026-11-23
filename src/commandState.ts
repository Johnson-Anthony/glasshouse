import type { SidebarRowKind } from "./Sidebar";

// Right-click context target — populated when a non-file-row surface opens a
// context menu (sidebar row, tab, breadcrumb crumb). Case handlers read from
// this instead of selection state.
export interface ContextTarget {
  kind: "sidebar" | "tab" | "breadcrumb";
  path?: string;
  tabIndex?: number;
  /** When kind === "tab", the pane the tab is in (split view; 0 unsplit). */
  pane?: number;
  /** When kind === "sidebar", the specific row subtype right-clicked. */
  rowKind?: SidebarRowKind;
}

/** Command state shared by App and the command handlers (it was a
 *  module-level `let` in App.tsx): the surface a context menu was opened on.
 *  The clipboard isn't here: it's the OS's (clipboard.ts). */
export const cmdState: { contextTarget: ContextTarget | null } = {
  contextTarget: null,
};
