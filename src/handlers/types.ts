// Handler registry — each handler file exports a function that returns true
// if it "consumed" the label (acted on it). App.tsx walks the registry for
// any command that wasn't handled by the main switch, so each feature area
// (selection, view, git, archive, …) lives in its own file and they don't
// collide on merges.

import type { UseTabResult } from "../state";
import type { FileEntry, BlameLine } from "../api";
import type { TweakState } from "../components";

export interface HandlerCtx {
  activeHandle: UseTabResult | undefined;
  cwd: string;
  selectedPaths: string[];
  firstPath: string | undefined;
  firstEntry: FileEntry | undefined;
  dispatch: (label: string) => void;
  openPalette: () => void;
  openTweaks: () => void;
  toggleSidebar: () => void;
  pinPath: (p: string) => void;
  tabs: unknown[];
  activeTab: number;
  setActiveTab: (i: number) => void;
  setBlame: (b: { path: string; lines: BlameLine[] } | null) => void;
  setHexView?: (v: { path: string; hex: string } | null) => void;
  setDiffView?: (v: { a: string; b: string; diff: string } | null) => void;
  clipboardPaths?: () => string[];
  refresh: () => void;
  // Optional — wired up by App.tsx in a later pass. Handlers use `ctx.undo?.()` etc.
  pushUndo?: (entry: { label: string; inverse: () => Promise<void> | void }) => void;
  undo?: () => void;
  redo?: () => void;
  moveTab?: (from: number, to: number) => void;
  newTab?: (path?: string) => void;
  tweaks?: TweakState;
  setTweaks?: (s: TweakState) => void;
}

export type Handler = (label: string, ctx: HandlerCtx) => Promise<boolean> | boolean;
