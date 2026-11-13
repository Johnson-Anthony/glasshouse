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
import { EMPTY_LISTING, keepGitInfo, relist, withAnchor, withFocus, withSelected, type Listing } from "./listing";
import { RefreshGate } from "./refreshGate";

/** The safety-net re-list of the shown tab, for changes the watcher missed. */
const POLL_MS = 30000;

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
  loading: boolean;
  error: string | null;
  historyBack: string[];
  historyForward: string[];
  tagFilter: string | null;
  /** The pane's filter box; per tab, and cleared when the tab navigates. */
  searchQuery: string;
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
  setSortKey: (k: SortKey) => void;
  setSortDir: (v: SortDir) => void;
  setTagFilter: (v: string | null) => void;
  setSearchQuery: (v: string) => void;
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
  /** Set on the stop `markIrreversible` leaves: undo reports it and runs
   *  nothing. */
  irreversible?: boolean;
};

export type UndoOutcome =
  | { status: "empty" }
  | { status: "done"; label: string }
  | { status: "failed"; label: string; error: unknown }
  | { status: "irreversible"; label: string };

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

/** For an action that can't be undone (Delete Permanently, Shred, git…):
 *  the history before it is dropped, so Ctrl+Z can't reach past it to an
 *  older, unrelated step, and the next Ctrl+Z says why there's nothing.
 *  See docs/decisions/2026-11-12-undo-coverage-policy.md. */
export function markIrreversible(label: string): void {
  undoStack.length = 0;
  const refuse = () => { throw new Error(`${label} can't be undone`); };
  pushUndo({ label, inverse: refuse, redo: refuse, irreversible: true });
}

// Undo and redo steps run one at a time, in the order they were asked for, so
// two quick Ctrl+Z presses can't run two inverses at once.
let undoQueue: Promise<unknown> = Promise.resolve();

function step(from: UndoEntry[], to: UndoEntry[], run: (e: UndoEntry) => Promise<void> | void): Promise<UndoOutcome> {
  const next = undoQueue.then(async (): Promise<UndoOutcome> => {
    const entry = from.pop();
    if (!entry) return { status: "empty" };
    if (entry.irreversible) return { status: "irreversible", label: entry.label };
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

/** `active`: the tab is the one shown. A tab in the background doesn't
 *  re-list on the poll or on watcher reports; it notes that it missed one
 *  and re-lists once when it's shown again. */
export function useTabState(initialPath: string, isPrivate: boolean = false, active: boolean = true): UseTabResult {
  // Path and history live in one value. navRef is the source of truth for the
  // actions and is updated synchronously, so two navigations in the same tick
  // build on each other; the state copy is what renders.
  const navRef = useRef<NavState>(navInit(initialPath));
  const [nav, setNavState] = useState<NavState>(navRef.current);
  const { path, back: historyBack, forward: historyForward } = nav;
  // Entries, selection, focus and anchor change together; see listing.ts.
  const [listing, setListing] = useState<Listing>(EMPTY_LISTING);
  const { entries, selected, focusIndex, anchorIndex } = listing;
  const [gitInfo, setGitInfo] = useState<GitInfo | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [showHidden, setShowHidden] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState<number>(0);
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>("");

  // The index setters are bound to the entries they were rendered with, so
  // indexes from this render still mean the same files if a re-list lands
  // before the update applies (a click racing the poll, or a command that
  // awaited a prompt).
  const setSelected = useCallback((sel: number[]) => {
    setListing(l => withSelected(l, entries, sel));
  }, [entries]);
  const setFocusIndex = useCallback((i: number) => {
    setListing(l => withFocus(l, entries, i));
  }, [entries]);
  const setAnchorIndex = useCallback((i: number) => {
    setListing(l => withAnchor(l, entries, i));
  }, [entries]);

  const showHiddenRef = useRef(showHidden);
  useEffect(() => { showHiddenRef.current = showHidden; }, [showHidden]);

  // Only the latest fetch may write results, so a slow listing (or error) for
  // a folder we've already left can't overwrite the current one. A quiet fetch
  // re-reads the same folder (poll, fs event, refresh) and keeps the current
  // rows or error on screen until the result arrives, so nothing blinks.
  const fetchSeq = useRef(0);
  const list = useCallback(async ({ p, hidden, quiet }: { p: string; hidden: boolean; quiet: boolean }) => {
    const seq = ++fetchSeq.current;
    if (!quiet) {
      setLoading(true);
      setError(null);
    }
    const began = Date.now();
    try {
      const dir = await readDir(p, hidden);
      if (seq !== fetchSeq.current) return;
      setError(null);
      setListing(l => relist(l, dir));
      setLoading(false);
      // Git status comes after the rows. Its dirty count needs a scan of the
      // whole repo, and a listing at the repo's root has just done one: a
      // count from a scan since this fetch began is reused. A navigation
      // takes a count up to one poll old, when HEAD and the index haven't
      // moved since. gitStatus never rejects.
      const info = await gitStatus(p, quiet ? Date.now() - began : POLL_MS);
      if (seq !== fetchSeq.current) return;
      setGitInfo(prev => keepGitInfo(prev, info));
    } catch (e) {
      if (seq !== fetchSeq.current) return;
      setError(errText(e));
      setListing(l => relist(l, []));
      setGitInfo(null);
    } finally {
      if (seq === fetchSeq.current) setLoading(false);
    }
  }, []);
  // One listing at a time, and reports spaced out: see refreshGate.ts. A
  // navigation or Show Hidden change ("go") shows the loading state; an
  // explicit refresh (F5, or after the app's own change) keeps the rows on
  // screen. Both list at once. A watcher report or the poll waits its turn.
  const gateRef = useRef<RefreshGate<{ p: string; hidden: boolean; quiet: boolean }> | null>(null);
  gateRef.current ??= new RefreshGate(list);
  const gate = gateRef.current;
  useEffect(() => () => gate.cancel(), [gate]);
  const fetchAll = useCallback((p: string, hidden: boolean, how: "go" | "refresh" | "report") => {
    const args = { p, hidden, quiet: how !== "go" };
    if (how === "report") gate.refresh(args);
    else gate.start(args);
  }, [gate]);

  // A tab in the background re-lists once it's shown, if it missed a watcher
  // report or a poll meanwhile.
  const activeRef = useRef(active);
  const missedRef = useRef(false);
  const relistIfShown = useCallback(() => {
    if (activeRef.current) fetchAll(navRef.current.path, showHiddenRef.current, "report");
    else missedRef.current = true;
  }, [fetchAll]);
  useEffect(() => {
    activeRef.current = active;
    if (active && missedRef.current) {
      missedRef.current = false;
      fetchAll(navRef.current.path, showHiddenRef.current, "report");
    }
  }, [active, fetchAll]);

  const fetchedKey = useRef("");
  useEffect(() => {
    if (!path) return;
    const handle = window.setTimeout(() => {
      const key = `${showHidden}:${path}`;
      const same = key === fetchedKey.current;
      fetchedKey.current = key;
      fetchAll(path, showHidden, same ? "refresh" : "go");
    }, 60);
    return () => window.clearTimeout(handle);
  }, [path, showHidden, refreshTick, fetchAll]);

  useEffect(() => {
    if (!isPrivate && initialPath) appendRecent(initialPath);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // notify-based fs watcher: subscribe per-path, with a safety-net poll
  useEffect(() => {
    if (!path) return;
    let disposed = false;
    let unlistenFn: (() => void) | null = null;

    void watchDir(path);

    const target = normalizePath(path);
    void listen<string>("fs-changed", evt => {
      if (disposed) return;
      const payload = typeof evt.payload === "string" ? evt.payload : "";
      if (normalizePath(payload) === target) relistIfShown();
    }).then(fn => {
      if (disposed) {
        fn();
      } else {
        unlistenFn = fn;
      }
    }).catch(() => { /* ignore */ });

    const safetyId = window.setInterval(relistIfShown, POLL_MS);

    return () => {
      disposed = true;
      window.clearInterval(safetyId);
      if (unlistenFn) {
        try { unlistenFn(); } catch { /* ignore */ }
      }
      void unwatchDir(path);
    };
  }, [path, relistIfShown]);

  // Leaving a folder drops its rows at once, so nothing on screen or under
  // the selection belongs to the folder we left, and drops any fetch of it
  // still in flight. The new folder's fetch starts after the debounce above.
  const resetNav = () => {
    fetchSeq.current++;
    gate.cancel();
    setListing(EMPTY_LISTING);
    setLoading(true);
    setError(null);
    setSearchQuery("");
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
    loading,
    error,
    historyBack,
    historyForward,
    tagFilter,
    searchQuery,
    private: isPrivate,
  }), [path, entries, gitInfo, selected, focusIndex, anchorIndex, sortKey, sortDir, showHidden, loading, error, historyBack, historyForward, tagFilter, searchQuery, isPrivate]);

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
    setSortKey,
    setSortDir,
    setTagFilter,
    setSearchQuery,
    clearHistory,
  }), [goTo, back, forward, up, refresh, setSelected, setFocusIndex, setAnchorIndex, clearHistory]);

  return useMemo(() => ({ state, actions }), [state, actions]);
}
