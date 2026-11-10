import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  readDir,
  gitStatus,
  watchDir,
  unwatchDir,
  appendRecent,
  type FileEntry,
  type GitInfo,
} from "./api";

import { normalizePath, parentPath } from "./paths";
import { navBack, navClear, navForward, navGoTo, navInit, type NavState } from "./history";
import { errText } from "./errors";
export { normalizePath, parentPath } from "./paths";

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
  private: boolean;
}

// Recent list persistence moved to backend (src-tauri commands
// read_recent / append_recent / clear_recent) so it survives app restarts.
// state.ts keeps appendRecent imported from ./api.

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

// ─── Undo/redo stack ──────────────────────────────────────────────────────
// In-memory, frontend-only. Bounded at 20 entries; oldest shifts out.
// pushUndo clears the redo stack (fresh action invalidates forward history).
// Entries for file operations are built in undoActions.ts.

export type UndoEntry = {
  label: string;
  /** Reverses the action. */
  inverse: () => Promise<void> | void;
  /** Performs the action again after it has been undone. */
  redo: () => Promise<void> | void;
};

export type UndoOutcome =
  | { status: "empty" }
  | { status: "done"; label: string }
  | { status: "failed"; label: string; error: unknown };

const UNDO_LIMIT = 20;

export const undoStack: UndoEntry[] = [];
export const redoStack: UndoEntry[] = [];

function pushBounded(stack: UndoEntry[], entry: UndoEntry): void {
  stack.push(entry);
  if (stack.length > UNDO_LIMIT) stack.shift();
}

export function clearRedo(): void {
  redoStack.length = 0;
}

export function pushUndo(entry: UndoEntry): void {
  pushBounded(undoStack, entry);
  clearRedo();
}

// Undo and redo steps run one at a time, in the order they were asked for, so
// two quick Ctrl+Z presses can't run two inverses at once.
let undoQueue: Promise<unknown> = Promise.resolve();

function step(from: UndoEntry[], to: UndoEntry[], run: (e: UndoEntry) => Promise<void> | void): Promise<UndoOutcome> {
  const next = undoQueue.then(async (): Promise<UndoOutcome> => {
    const entry = from.pop();
    if (!entry) return { status: "empty" };
    try {
      await run(entry);
    } catch (error) {
      // Dropped, not put back: a half-applied step can't be safely replayed
      // in either direction.
      return { status: "failed", label: entry.label, error };
    }
    pushBounded(to, entry);
    return { status: "done", label: entry.label };
  });
  undoQueue = next;
  return next;
}

/** Undo the latest action; on success it becomes redoable. */
export function undoLast(): Promise<UndoOutcome> {
  return step(undoStack, redoStack, e => e.inverse());
}

/** Redo the latest undone action; on success it becomes undoable again. */
export function redoLast(): Promise<UndoOutcome> {
  return step(redoStack, undoStack, e => e.redo());
}

// ─── Tab list state ───────────────────────────────────────────────────────
// state.ts doesn't own the tab array (App.tsx does). Provide module-level
// helpers that App wires up by registering a mutator; handlers call
// moveTab/newTab and the registered callbacks do the actual setState.

export type TabListMutator = {
  moveTab: (from: number, to: number) => void;
  newTab: (path?: string, opts?: { private?: boolean }) => void;
};

let tabListMutator: TabListMutator | null = null;

export function registerTabListMutator(m: TabListMutator | null): void {
  tabListMutator = m;
}

export function moveTab(from: number, to: number): void {
  tabListMutator?.moveTab(from, to);
}

export function newTab(path?: string, opts?: { private?: boolean }): void {
  tabListMutator?.newTab(path, opts);
}

export function useTabState(initialPath: string, isPrivate: boolean = false): UseTabResult {
  // Path and history live in one value. navRef is the source of truth for the
  // actions and is updated synchronously, so two navigations in the same tick
  // build on each other; the state copy is what renders.
  const navRef = useRef<NavState>(navInit(initialPath));
  const [nav, setNavState] = useState<NavState>(navRef.current);
  const { path, back: historyBack, forward: historyForward } = nav;
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
  const [refreshTick, setRefreshTick] = useState<number>(0);
  const [tagFilter, setTagFilter] = useState<string | null>(null);

  const showHiddenRef = useRef(showHidden);
  useEffect(() => { showHiddenRef.current = showHidden; }, [showHidden]);

  // Only the latest fetch may write results, so a slow listing (or error) for
  // a folder we've already left can't overwrite the current one. A quiet fetch
  // re-reads the same folder (poll, fs event, refresh) and keeps the current
  // rows or error on screen until the result arrives, so nothing blinks.
  const fetchSeq = useRef(0);
  const fetchAll = useCallback(async (p: string, hidden: boolean, quiet = false) => {
    const seq = ++fetchSeq.current;
    if (!quiet) {
      setLoading(true);
      setError(null);
    }
    // Both start now and run in parallel, but the rows go up as soon as they
    // arrive: git_status scans the whole repo for its dirty count, which in a
    // big repo takes longer than the listing. gitStatus never rejects.
    const git = gitStatus(p);
    try {
      const dir = await readDir(p, hidden);
      if (seq !== fetchSeq.current) return;
      setError(null);
      setEntries(dir);
      setLoading(false);
      const info = await git;
      if (seq !== fetchSeq.current) return;
      setGitInfo(info);
    } catch (e) {
      if (seq !== fetchSeq.current) return;
      setError(errText(e));
      setEntries([]);
      setGitInfo(null);
    } finally {
      if (seq === fetchSeq.current) setLoading(false);
    }
  }, []);

  const fetchedKey = useRef("");
  useEffect(() => {
    if (!path) return;
    const handle = window.setTimeout(() => {
      const key = `${showHidden}:${path}`;
      const quiet = key === fetchedKey.current;
      fetchedKey.current = key;
      void fetchAll(path, showHidden, quiet);
    }, 60);
    return () => window.clearTimeout(handle);
  }, [path, showHidden, refreshTick, fetchAll]);

  useEffect(() => {
    if (!isPrivate && initialPath) appendRecent(initialPath);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        void fetchAll(navRef.current.path, showHiddenRef.current, true);
      }
    }).then(fn => {
      if (disposed) {
        fn();
      } else {
        unlistenFn = fn;
      }
    }).catch(() => { /* ignore */ });

    const safetyId = window.setInterval(() => {
      void fetchAll(navRef.current.path, showHiddenRef.current, true);
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

  // Side effects stay out of state updaters: StrictMode runs updaters twice,
  // which used to push every history entry twice.
  const commitNav = (next: NavState): boolean => {
    if (next === navRef.current) return false;
    navRef.current = next;
    setNavState(next);
    resetNav();
    return true;
  };

  const goTo = useCallback((next: string) => {
    if (!commitNav(navGoTo(navRef.current, next))) return;
    // Fire-and-forget: keep the recent list warm for File > Open Recent
    // and Bookmarks > RECENT without blocking navigation. Private tabs
    // opt out so the recent list stays clean.
    if (!isPrivate) void appendRecent(next);
  }, [isPrivate]);

  const back = useCallback(() => {
    commitNav(navBack(navRef.current));
  }, []);

  const forward = useCallback(() => {
    commitNav(navForward(navRef.current));
  }, []);

  const up = useCallback(() => {
    const cur = navRef.current.path;
    const parent = parentPath(cur);
    if (parent && parent !== cur) goTo(parent);
  }, [goTo]);

  const refresh = useCallback(() => {
    setRefreshTick(t => t + 1);
  }, []);

  const clearHistory = useCallback(() => {
    const next = navClear(navRef.current);
    if (next === navRef.current) return;
    navRef.current = next;
    setNavState(next);
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
    private: isPrivate,
  }), [path, entries, gitInfo, selected, focusIndex, anchorIndex, sortKey, sortDir, showHidden, foldersFirst, loading, error, historyBack, historyForward, tagFilter, isPrivate]);

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
