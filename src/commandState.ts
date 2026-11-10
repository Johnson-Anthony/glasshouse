import type { SidebarRowKind } from "./Sidebar";

export interface AppClipboard {
  op: "copy" | "cut";
  paths: string[];
  /** Per-path kind ("file" | "folder" | …) parallel to `paths`. Used by
   *  Paste Special to decide whether to hash-verify. */
  kinds: string[];
}

// Right-click context target — populated when a non-file-row surface opens a
// context menu (sidebar row, tab, breadcrumb crumb). Case handlers read from
// this instead of selection state. Module-level to match the `appClipboard`
// pattern already in use.
export interface ContextTarget {
  kind: "sidebar" | "tab" | "breadcrumb";
  path?: string;
  tabIndex?: number;
  /** When kind === "sidebar", the specific row subtype right-clicked. */
  rowKind?: SidebarRowKind;
}

/** Command state shared by App and the command handlers (it was module-level
 *  `let`s in App.tsx): what's on the app clipboard, and the surface a context
 *  menu was opened on. */
export const cmdState: { clipboard: AppClipboard | null; contextTarget: ContextTarget | null } = {
  clipboard: null,
  contextTarget: null,
};
