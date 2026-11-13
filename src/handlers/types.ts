// Handler registry — each handler file exports a function that returns true
// if it "consumed" the label (acted on it). App.tsx walks the registry for
// any command that wasn't handled by the main switch, so each feature area
// (selection, view, git, archive, …) lives in its own file and they don't
// collide on merges.

import type { UseTabResult } from "../state";
import type { BlameLine, FileEntry, ShellProfile } from "../api";
import type { TweakState } from "../components";
import type { GitOutputState } from "../dialogs/GitOutput";
import type React from "react";
import type { SavedRemote } from "../Sidebar";
import type { BulkRenameItem } from "../dialogs/BulkRename";
import type { PasteSpecialItem } from "../dialogs/PasteSpecial";

/** App state and setters the command handlers moved out of App.tsx use
 *  (targetHandler, appHandler, fileOpsHandler). App passes them by name. */
export interface AppCommands {
  activeTab: number;
  closeOtherTabsAt: (keep: number) => void;
  closeTabAt: (i: number) => void;
  duplicateTabAt: (i: number) => void;
  openNewTab: () => void;
  openPathInNewTab: (p: string, isPrivate?: boolean) => void;
  persistRemotes: (next: SavedRemote[]) => void;
  pins: string[];
  /** Sets the pins and writes them to disk. */
  savePins: (next: string[]) => void;
  savedRemotes: SavedRemote[];
  setBlame: React.Dispatch<React.SetStateAction<{ path: string; lines: BlameLine[]; } | null>>;
  setBookmarkManagerOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setBulkRenameItems: React.Dispatch<React.SetStateAction<BulkRenameItem[] | null>>;
  setCheatsheetOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setConnectOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setCutPaths: React.Dispatch<React.SetStateAction<string[]>>;
  setFolderPicker: React.Dispatch<React.SetStateAction<{ initialPath?: string | undefined; title?: string | undefined; onPick: (p: string) => void; } | null>>;
  setManageRemotesOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setPalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setPasteSpecial: React.Dispatch<React.SetStateAction<{ items: PasteSpecialItem[]; dstDir: string; clipboardMode: "copy" | "cut"; } | null>>;
  setPropsEntry: React.Dispatch<React.SetStateAction<FileEntry | null>>;
  setShowFindModal: React.Dispatch<React.SetStateAction<boolean>>;
  setShowInspector: React.Dispatch<React.SetStateAction<boolean>>;
  setState: React.Dispatch<React.SetStateAction<TweakState>>;
  setTagPickerPath: React.Dispatch<React.SetStateAction<string | null>>;
  setTagStore: React.Dispatch<React.SetStateAction<Record<string, string[]>>>;
  setTermOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setTermProfile: React.Dispatch<React.SetStateAction<ShellProfile | null>>;
  setTrashOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setTweaksOpen: React.Dispatch<React.SetStateAction<boolean>>;
  state: TweakState;
  tagStore: Record<string, string[]>;
}

export interface HandlerCtx {
  activeHandle: UseTabResult | undefined;
  cwd: string;
  selectedPaths: string[];
  firstPath: string | undefined;
  firstEntry: FileEntry | undefined;
  /** The rows the active pane shows, in display order, as indexes into
   *  `activeHandle.state.entries`. Selection commands pick from these only. */
  visibleRows: () => number[];
  dispatch: (label: string) => void;
  openAbout?: () => void;
  toggleSidebar: () => void;
  toggleStatusBar?: () => void;
  pinPath: (p: string) => void;
  tabs: unknown[];
  activeTab: number;
  setActiveTab: (i: number) => void;
  setBlame: (b: { path: string; lines: BlameLine[] } | null) => void;
  setDiffView?: (v: { a: string; b: string; diff: string } | null) => void;
  setGitOutput?: (v: GitOutputState | null) => void;
  clipboardPaths?: () => string[];
  refresh: () => void;
  // Optional — wired up by App.tsx in a later pass. Handlers use `ctx.undo?.()` etc.
  undo?: () => void;
  redo?: () => void;
  newTab?: (path?: string, opts?: { private?: boolean }) => void;
  tweaks?: TweakState;
  setTweaks?: (s: TweakState) => void;
  /** Set by App; the feature handlers in HANDLERS don't need it. */
  app?: AppCommands;
}

export type Handler = (label: string, ctx: HandlerCtx) => Promise<boolean> | boolean;
