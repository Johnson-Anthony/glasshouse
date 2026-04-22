import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  listDir,
  gitStatus,
  watchDir,
  unwatchDir,
  appendRecent,
  type FileEntry,
  type GitInfo,
} from "./api";

function normalizePath(p: string): string {
  return p.replace(/[\\/]+$/, "").toLowerCase();
}

export const lastCommandRef = { value: null as string | null };

export type SortKey = "name" | "size" | "modified" | "tag" | "git" | "type";
export type SortDir = "asc" | "desc";

export interface TabState {
  path: string;
  entries: FileEntry[];
  gitInfo: GitInfo | null;
  selected: number[];
  focusIndex: number;
  anchorIndex: number;
  sortKey: SortKey;
  sortDir: SortDir;
  showHidden: boolean;
  foldersFirst: boolean;
  loading: boolean;
  error: string | null;
  historyBack: string[];
  historyForward: string[];
  tagFilter: string | null;
}

export interface TabActions {
  goTo: (path: string) => void;
  back: () => void;
  forward: () => void;
  up: () => void;
  refresh: () => void;
  setSelected: (sel: number[]) => void;
  setFocusIndex: (i: number) => void;
  setAnchorIndex: (i: number) => void;
  setShowHidden: (v: boolean) => void;
  setFoldersFirst: (v: boolean) => void;
  setSortKey: (k: SortKey) => void;
  setSortDir: (v: SortDir) => void;
  setTagFilter: (v: string | null) => void;
  clearHistory: () => void;
}

export interface UseTabResult {
  state: TabState;
  actions: TabActions;
}

function parentPath(p: string): string {
  if (!p) return p;
  const hasBack = p.includes("\\");
  const sep = hasBack ? "\\" : "/";
  const trimmed = p.replace(/[\\/]+$/, "");
  const idx = Math.max(trimmed.lastIndexOf("\\"), trimmed.lastIndexOf("/"));
  if (idx <= 0) {
    if (/^[A-Za-z]:$/.test(trimmed)) return trimmed + sep;
    if (trimmed.startsWith("/")) return "/";
    return trimmed;
  }
  if (/^[A-Za-z]:$/.test(trimmed.slice(0, 2)) && idx === 2) {
    return trimmed.slice(0, 3);
  }
  return trimmed.slice(0, idx) || sep;
}

// ─── Undo/redo stack ──────────────────────────────────────────────────────
// In-memory, frontend-only. Bounded at 20 entries; oldest shifts out.
// pushUndo clears the redo stack (fresh action invalidates forward history).

export type UndoEntry = { label: string; inverse: () => Promise<void> | void };

const UNDO_LIMIT = 20;

export const undoStack: UndoEntry[] = [];
export const redoStack: UndoEntry[] = [];

export function clearRedo(): void {
  redoStack.length = 0;
}

export function pushUndo(entry: UndoEntry): void {
  undoStack.push(entry);
  if (undoStack.length > UNDO_LIMIT) undoStack.shift();
  clearRedo();
}

export function popUndo(): UndoEntry | undefined {
  const entry = undoStack.pop();
  if (entry) {
    redoStack.push(entry);
    if (redoStack.length > UNDO_LIMIT) redoStack.shift();
  }
  return entry;
}

export function popRedo(): UndoEntry | undefined {
  const entry = redoStack.pop();
  if (entry) {
    undoStack.push(entry);
    if (undoStack.length > UNDO_LIMIT) undoStack.shift();
  }
  return entry;
}

// ─── Tab list state ───────────────────────────────────────────────────────
// state.ts doesn't own the tab array (App.tsx does). Provide module-level
// helpers that App wires up by registering a mutator; handlers call
// moveTab/newTab and the registered callbacks do the actual setState.

export type TabListMutator = {
  moveTab: (from: number, to: number) => void;
  newTab: (path?: string) => void;
};

let tabListMutator: TabListMutator | null = null;

export function registerTabListMutator(m: TabListMutator | null): void {
  tabListMutator = m;
}

export function moveTab(from: number, to: number): void {
  tabListMutator?.moveTab(from, to);
}

export function newTab(path?: string): void {
  tabListMutator?.newTab(path);
}

export function useTabState(initialPath: string): UseTabResult {
  const [path, setPath] = useState<string>(initialPath);
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [gitInfo, setGitInfo] = useState<GitInfo | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [focusIndex, setFocusIndex] = useState<number>(0);
  const [anchorIndex, setAnchorIndex] = useState<number>(0);
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [showHidden, setShowHidden] = useState<boolean>(false);
  const [foldersFirst, setFoldersFirst] = useState<boolean>(true);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [historyBack, setHistoryBack] = useState<string[]>([]);
  const [historyForward, setHistoryForward] = useState<string[]>([]);
  const [refreshTick, setRefreshTick] = useState<number>(0);
  const [tagFilter, setTagFilter] = useState<string | null>(null);

  const pathRef = useRef(path);
  const showHiddenRef = useRef(showHidden);
  useEffect(() => { pathRef.current = path; }, [path]);
  useEffect(() => { showHiddenRef.current = showHidden; }, [showHidden]);

  const fetchAll = useCallback(async (p: string, hidden: boolean) => {
    setLoading(true);
    setError(null);
    try {
      const [dir, git] = await Promise.all([
        listDir(p, hidden),
        gitStatus(p),
      ]);
      setEntries(dir);
      setGitInfo(git);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setEntries([]);
      setGitInfo(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!path) return;
    const handle = window.setTimeout(() => {
      void fetchAll(path, showHidden);
    }, 60);
    return () => window.clearTimeout(handle);
  }, [path, showHidden, refreshTick, fetchAll]);

  // notify-based fs watcher: subscribe per-path, with a 30s safety-net refetch
  useEffect(() => {
    if (!path) return;
    let disposed = false;
    let unlistenFn: (() => void) | null = null;

    void watchDir(path);

    const target = normalizePath(path);
    void listen<string>("fs-changed", evt => {
      if (disposed) return;
      const payload = typeof evt.payload === "string" ? evt.payload : "";
      if (normalizePath(payload) === target) {
        void fetchAll(pathRef.current, showHiddenRef.current);
      }
    }).then(fn => {
      if (disposed) {
        fn();
      } else {
        unlistenFn = fn;
      }
    }).catch(() => { /* ignore */ });

    const safetyId = window.setInterval(() => {
      void fetchAll(pathRef.current, showHiddenRef.current);
    }, 30000);

    return () => {
      disposed = true;
      window.clearInterval(safetyId);
      if (unlistenFn) {
        try { unlistenFn(); } catch { /* ignore */ }
      }
      void unwatchDir(path);
    };
  }, [path, fetchAll]);

  const resetNav = () => {
    setSelected([]);
    setFocusIndex(0);
    setAnchorIndex(0);
  };

  const goTo = useCallback((next: string) => {
    setPath(prev => {
      if (prev === next) return prev;
      setHistoryBack(h => [...h, prev]);
      setHistoryForward([]);
      resetNav();
      // Fire-and-forget: keep the recent list warm for File > Open Recent
      // and Bookmarks > RECENT without blocking navigation.
      void appendRecent(next);
      return next;
    });
  }, []);

  const back = useCallback(() => {
    setHistoryBack(h => {
      if (h.length === 0) return h;
      const prev = h[h.length - 1];
      setHistoryForward(f => [...f, pathRef.current]);
      setPath(prev);
      resetNav();
      return h.slice(0, -1);
    });
  }, []);

  const forward = useCallback(() => {
    setHistoryForward(f => {
      if (f.length === 0) return f;
      const next = f[f.length - 1];
      setHistoryBack(h => [...h, pathRef.current]);
      setPath(next);
      resetNav();
      return f.slice(0, -1);
    });
  }, []);

  const up = useCallback(() => {
    const parent = parentPath(pathRef.current);
    if (parent && parent !== pathRef.current) goTo(parent);
  }, [goTo]);

  const refresh = useCallback(() => {
    setRefreshTick(t => t + 1);
  }, []);

  const clearHistory = useCallback(() => {
    setHistoryBack([]);
    setHistoryForward([]);
  }, []);

  const state: TabState = useMemo(() => ({
    path,
    entries,
    gitInfo,
    selected,
    focusIndex,
    anchorIndex,
    sortKey,
    sortDir,
    showHidden,
    foldersFirst,
    loading,
    error,
    historyBack,
    historyForward,
    tagFilter,
  }), [path, entries, gitInfo, selected, focusIndex, anchorIndex, sortKey, sortDir, showHidden, foldersFirst, loading, error, historyBack, historyForward, tagFilter]);

  const actions: TabActions = useMemo(() => ({
    goTo,
    back,
    forward,
    up,
    refresh,
    setSelected,
    setFocusIndex,
    setAnchorIndex,
    setShowHidden,
    setFoldersFirst,
    setSortKey,
    setSortDir,
    setTagFilter,
    clearHistory,
  }), [goTo, back, forward, up, refresh, clearHistory]);

  return useMemo(() => ({ state, actions }), [state, actions]);
}
