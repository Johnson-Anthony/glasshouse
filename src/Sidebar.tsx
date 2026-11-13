import React, { useState, useEffect, useRef, useMemo } from "react";
import { listen } from "@tauri-apps/api/event";
import { drives as apiDrives, homeDir as apiHomeDir, listDir, listWslDistros, pathKind, pickDirectory, readDir, unwatchDir, watchDir, type Drive, type FileEntry, type WslDistro } from "./api";
import { basename, joinPath, normalizePath, parentPath, pathSegments } from "./paths";
import { isModalOpen } from "./dialogs/modal";
import { RefreshGate } from "./refreshGate";
import { dropTree, pruneUnder } from "./treeRefresh";

// ============= Sidebar =============
interface TreeNodeState {
  path: string;
  name: string;
  depth: number;
  open: boolean;
  hasChildren: boolean;
  // children are stored in a sibling map keyed by path
}

function formatSidebarBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0B";
  const units = ["B", "K", "M", "G", "T", "P"];
  let v = n;
  let ui = 0;
  while (v >= 1024 && ui < units.length - 1) { v /= 1024; ui++; }
  if (v >= 100) return `${v.toFixed(0)}${units[ui]}`;
  if (v >= 10) return `${v.toFixed(1)}${units[ui]}`;
  return `${v.toFixed(1)}${units[ui]}`;
}

export const SEED_TAGS: { color: string; label: string }[] = [
  { color: "var(--magenta)", label: "project" },
  { color: "var(--green)",   label: "school"  },
  { color: "var(--red)",     label: "secret"  },
  { color: "var(--yellow)",  label: "review"  },
  { color: "var(--cyan)",    label: "archive" },
];

export const TAG_COLOR_MAP: Record<string, string> = Object.fromEntries(
  SEED_TAGS.map(t => [t.label, t.color]),
);

export interface SavedRemote {
  label: string;
  host: string;
  path: string;
}

export type SidebarRowKind = "pinned" | "pinned-file" | "tree-folder" | "tree-file" | "drive" | "remote" | "wsl";

/** Which pins are files rather than folders, from one listing per parent
 *  folder. A pin that isn't found (unreadable parent, gone) counts as a folder. */
export async function pinnedFiles(pins: string[], list: (dir: string) => Promise<FileEntry[]>): Promise<Set<string>> {
  const byParent = new Map<string, string[]>();
  for (const p of pins) {
    const dir = parentPath(p);
    if (!dir || normalizePath(dir) === normalizePath(p)) continue;
    byParent.set(dir, [...(byParent.get(dir) ?? []), p]);
  }
  const files = new Set<string>();
  await Promise.all([...byParent].map(async ([dir, want]) => {
    const entries = await list(dir).catch((): FileEntry[] => []);
    const kinds = new Map(entries.map(e => [normalizePath(e.path), e.kind]));
    for (const p of want) {
      if ((kinds.get(normalizePath(p)) ?? "folder") !== "folder") files.add(p);
    }
  }));
  return files;
}

export interface SidebarProps {
  activePath: string;
  onGoTo: (path: string) => void;
  /** A file row (tree "Show files", a pinned file) was clicked or entered. */
  onOpenFile?: (path: string) => void;
  onRowContext?: (e: React.MouseEvent, path: string, kind: SidebarRowKind) => void;
  pins: string[];
  onAddPin: () => void;
  tags: Record<string, string[]>;
  onTagFilter?: (tag: string) => void;
  activeTagFilter?: string | null;
  savedRemotes: SavedRemote[];
  onOpenConnectDialog: () => void;
  onRemoteClick: (r: SavedRemote) => void;
  sidebarRootRef?: React.Ref<HTMLElement>;
  onActivate?: () => void;
  /** Requests the host to show the themed FolderPickerDialog. The current
   *  tree root is forwarded as `initialPath` and the picked path is handed
   *  back so Sidebar can swap its own rootPath state. Keeps the native Tauri
   *  dialog off-screen. */
  onPickTreeRoot?: (initialPath: string | undefined, onPicked: (p: string) => void) => void;
}

interface TreePrefs {
  showHidden: boolean;
  showFiles: boolean;
  followActive: boolean;
}

const TREE_PREFS_KEY = "glasshouse.tree.prefs";
const TREE_PREFS_DEFAULT: TreePrefs = { showHidden: false, showFiles: false, followActive: false };

function loadTreePrefs(): TreePrefs {
  try {
    const raw = localStorage.getItem(TREE_PREFS_KEY);
    if (!raw) return TREE_PREFS_DEFAULT;
    const parsed = JSON.parse(raw) as Partial<TreePrefs>;
    return { ...TREE_PREFS_DEFAULT, ...parsed };
  } catch { return TREE_PREFS_DEFAULT; }
}

type SbGroupKey = "PINNED" | "TREE" | "TAGS" | "DEVICES" | "REMOTE";
const SB_GROUP_DEFAULTS: SbGroupKey[] = ["PINNED", "TREE", "TAGS", "DEVICES", "REMOTE"];
const SB_COLLAPSED_KEY = "glasshouse.sb.collapsed";
const SB_ORDER_KEY = "glasshouse.sb.order";

function loadSbCollapsed(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(SB_COLLAPSED_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    return (parsed && typeof parsed === "object") ? (parsed as Record<string, boolean>) : {};
  } catch { return {}; }
}

function loadSbOrder(): SbGroupKey[] {
  try {
    const raw = localStorage.getItem(SB_ORDER_KEY);
    if (!raw) return SB_GROUP_DEFAULTS;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return SB_GROUP_DEFAULTS;
    const seen = new Set<SbGroupKey>();
    const out: SbGroupKey[] = [];
    for (const entry of parsed) {
      if (typeof entry !== "string") continue;
      const key = entry as SbGroupKey;
      if (!SB_GROUP_DEFAULTS.includes(key)) continue;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(key);
    }
    // Append any groups missing from storage so the user always sees every
    // section; protects against older saved orders missing a newer group.
    for (const key of SB_GROUP_DEFAULTS) if (!seen.has(key)) out.push(key);
    return out;
  } catch { return SB_GROUP_DEFAULTS; }
}

export function Sidebar({ activePath, onGoTo, onOpenFile, onRowContext, pins, onAddPin, tags, onTagFilter, activeTagFilter, savedRemotes, onOpenConnectDialog, onRemoteClick, sidebarRootRef, onActivate, onPickTreeRoot }: SidebarProps) {
  const sidebarRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!sidebarRootRef) return;
    if (typeof sidebarRootRef === "function") sidebarRootRef(sidebarRef.current);
    else (sidebarRootRef as React.MutableRefObject<HTMLElement | null>).current = sidebarRef.current;
  });
  // Keyboard-navigation cursor: which visible row is selected. Mouse hover and
  // this cursor coexist — mouse never overwrites `selectedIdx`, and keyboard
  // changes don't touch hover state. -1 means "no key-selected row".
  const [selectedIdx, setSelectedIdx] = useState<number>(-1);
  const [home, setHome] = useState<string | null>(null);
  const [driveList, setDriveList] = useState<Drive[]>([]);
  const [wslDistros, setWslDistros] = useState<WslDistro[]>([]);

  // Pins can be files (Add Bookmark pins the selection): those open with the
  // default app and get the file menu instead of navigating.
  const [pinFiles, setPinFiles] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    let cancelled = false;
    void pinnedFiles(pins, d => listDir(d, true)).then(s => { if (!cancelled) setPinFiles(s); });
    return () => { cancelled = true; };
  }, [pins]);
  const openRow = (path: string, isFile: boolean) => {
    if (isFile && onOpenFile) onOpenFile(path);
    else onGoTo(path);
  };

  // Tree: visible flattened list + map of children by path
  const [rootPath, setRootPath] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [children, setChildren] = useState<Record<string, FileEntry[]>>({});
  const [treePrefs, setTreePrefs] = useState<TreePrefs>(() => loadTreePrefs());
  const [treeMenuOpen, setTreeMenuOpen] = useState(false);
  const treeTitleRef = useRef<HTMLDivElement>(null);

  // Sidebar group collapse + reorder state. Keys are SbGroupKey ("PINNED", …)
  // so the render loop can iterate `sbOrder` and look up the matching render
  // function. Both pieces persist to localStorage on change.
  const [sbCollapsed, setSbCollapsed] = useState<Record<string, boolean>>(() => loadSbCollapsed());
  const [sbOrder, setSbOrder] = useState<SbGroupKey[]>(() => loadSbOrder());
  const [sbDragging, setSbDragging] = useState<SbGroupKey | null>(null);
  const [sbDropIdx, setSbDropIdx] = useState<number | null>(null);

  useEffect(() => {
    try { localStorage.setItem(SB_COLLAPSED_KEY, JSON.stringify(sbCollapsed)); } catch { /* quota */ }
  }, [sbCollapsed]);
  useEffect(() => {
    try { localStorage.setItem(SB_ORDER_KEY, JSON.stringify(sbOrder)); } catch { /* quota */ }
  }, [sbOrder]);

  const toggleGroupCollapse = (key: SbGroupKey) => {
    setSbCollapsed(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const moveGroup = (key: SbGroupKey, delta: number) => {
    setSbOrder(prev => {
      const idx = prev.indexOf(key);
      if (idx < 0) return prev;
      const next = idx + delta;
      if (next < 0 || next >= prev.length) return prev;
      const copy = prev.slice();
      copy.splice(idx, 1);
      copy.splice(next, 0, key);
      return copy;
    });
  };

  useEffect(() => {
    try { localStorage.setItem(TREE_PREFS_KEY, JSON.stringify(treePrefs)); } catch { /* quota */ }
  }, [treePrefs]);

  const filterKids = (kids: FileEntry[]): FileEntry[] => {
    return kids.filter(k => {
      if (!treePrefs.showHidden && k.hidden) return false;
      if (!treePrefs.showFiles && k.kind !== "folder") return false;
      return true;
    });
  };

  // The tree follows the disk. Each open folder on show is watched, and a
  // report for one lists just that folder again, one listing at a time with
  // a gap after each, as the pane does (refreshGate.ts). `watched` is keyed
  // by normalized path and keeps the path as watched, for `unwatchDir`.
  const watched = useRef(new Map<string, { path: string; gate: RefreshGate<string> }>());
  // Folders that stopped being watched (collapsed, or a parent was), so
  // their kept rows may be out of date when they're shown again.
  const unwatchedSince = useRef(new Set<string>());

  // List folder `p` for the tree. What the tree kept for a child folder
  // that's no longer there goes too (treeRefresh.ts). A folder that's gone
  // is forgotten and its parent listed again; one that's there but can't
  // be read shows empty. Its rows, or null when it's gone.
  const listTreeFolder = async (p: string): Promise<FileEntry[] | null> => {
    let kids: FileEntry[];
    try {
      kids = filterKids(await readDir(p, treePrefs.showHidden));
    } catch {
      const kind = await pathKind(p);
      if (kind === null || kind === "file") {
        forgetTreeFolder(p, false);
        return null;
      }
      kids = [];
    }
    unwatchedSince.current.delete(normalizePath(p));
    setChildren(prev => ({ ...pruneUnder(prev, p, kids), [p]: kids }));
    setExpanded(prev => pruneUnder(prev, p, kids));
    return kids;
  };

  // List every folder the tree keeps again, parents first, skipping any an
  // earlier listing in the pass found gone.
  const relistTree = async () => {
    let kept = children;
    const paths = Object.keys(children).sort((a, b) => pathSegments(a).length - pathSegments(b).length);
    for (const p of paths) {
      if (!(p in kept)) continue;
      const kids = await listTreeFolder(p);
      kept = kids ? pruneUnder(kept, p, kids) : dropTree(kept, p);
    }
  };
  const listTreeFolderRef = useRef(listTreeFolder);
  listTreeFolderRef.current = listTreeFolder;

  // Drop folder `p` and everything kept under it, then list its parent again
  // so its row goes: `now`, or as a quiet refresh. The root keeps its row.
  const forgetTreeFolder = (p: string, now: boolean) => {
    setChildren(prev => dropTree(prev, p));
    setExpanded(prev => dropTree(prev, p));
    if (!rootPath || normalizePath(p) === normalizePath(rootPath)) return;
    const parent = parentPath(p);
    const w = watched.current.get(normalizePath(parent));
    if (!w) void listTreeFolder(parent);
    else if (now) w.gate.start(w.path);
    else w.gate.refresh(w.path);
  };

  // A tree row was clicked or entered. A row whose file or folder is gone
  // (or a folder that's now a file) goes away instead of opening, and the
  // pane keeps what it shows.
  const openTreeRow = async (path: string, isFolder: boolean) => {
    const kind = await pathKind(path);
    if (kind === null || (kind !== "unknown" && (kind === "folder") !== isFolder)) {
      forgetTreeFolder(path, true);
      return;
    }
    openRow(path, !isFolder);
  };

  // Home, drives and WSL load side by side, so a slow drive or WSL start
  // doesn't hold up the tree. None of them rejects.
  useEffect(() => {
    void apiDrives().then(setDriveList);
    void listWslDistros().then(setWslDistros);
    void (async () => {
      const h = await apiHomeDir();
      setHome(h);
      if (h) {
        setRootPath(h);
        if (await listTreeFolder(h)) setExpanded(prev => ({ ...prev, [h]: true }));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-fetch / re-filter every already-loaded path when prefs change so the
  // tree reflects Show Hidden / Show Files immediately.
  useEffect(() => {
    if (Object.keys(children).length > 0) void relistTree();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [treePrefs.showHidden, treePrefs.showFiles]);

  // Follow active tab: ensure every ancestor of activePath is expanded.
  useEffect(() => {
    if (!treePrefs.followActive || !rootPath || !activePath) return;
    if (!activePath.startsWith(rootPath)) return;
    void (async () => {
      const parts = pathSegments(activePath.slice(rootPath.length));
      let cur = rootPath;
      for (let i = 0; i < parts.length - 1; i++) {
        const dir = cur = joinPath(cur, parts[i]);
        if (!children[dir] && !(await listTreeFolder(dir))) return;
        setExpanded(prev => ({ ...prev, [dir]: true }));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [treePrefs.followActive, activePath, rootPath]);

  const toggleNode = async (path: string) => {
    const isOpen = expanded[path];
    if (isOpen) {
      setExpanded(prev => ({ ...prev, [path]: false }));
      return;
    }
    // Kept rows show at once; the watch below lists them again.
    if (!children[path] && !(await listTreeFolder(path))) return;
    setExpanded(prev => ({ ...prev, [path]: true }));
  };

  const collapseAll = async () => {
    if (!rootPath) return;
    // Rebuild the expanded map from scratch with only the root marked open so
    // no stale descendant entry can keep its own subtree visible. If the root
    // hasn't been listed yet (e.g. Collapse all is hit while still loading)
    // pull its children first so the tree doesn't flash empty.
    if (!children[rootPath] && !(await listTreeFolder(rootPath))) return;
    setExpanded({ [rootPath]: true });
  };

  const applyNewRoot = async (picked: string) => {
    setRootPath(picked);
    setExpanded({ [picked]: true });
    setChildren({});
    await listTreeFolder(picked);
  };

  const changeRoot = async () => {
    // Prefer the themed in-app folder picker when the host wires one up; it
    // matches the rest of the palette chrome. Without a handler we fall back
    // to the native Tauri dialog so the control still works in standalone
    // test harnesses.
    if (onPickTreeRoot) {
      onPickTreeRoot(rootPath ?? undefined, (picked) => { void applyNewRoot(picked); });
      return;
    }
    const picked = await pickDirectory(rootPath ?? undefined);
    if (!picked) return;
    void applyNewRoot(picked);
  };

  // Close the tree menu when clicking outside.
  useEffect(() => {
    if (!treeMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!treeTitleRef.current) return;
      if (!treeTitleRef.current.contains(e.target as Node)) setTreeMenuOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [treeMenuOpen]);

  const treeRows = useMemo(() => {
    const out: { path: string; name: string; depth: number; open: boolean; kind: "folder" | "file" }[] = [];
    if (!rootPath) return out;
    const walk = (p: string, depth: number, kind: "folder" | "file") => {
      const name = basename(p) || p;
      const open = !!expanded[p];
      out.push({ path: p, name, depth, open, kind });
      if (open && kind === "folder") {
        const kids = children[p] ?? [];
        for (const k of kids) walk(k.path, depth + 1, k.kind === "folder" ? "folder" : "file");
      }
    };
    walk(rootPath, 0, "folder");
    return out;
  }, [rootPath, expanded, children]);

  // Watch the open folders on show. One that's shown again after a while
  // unwatched is listed again, since it may have changed meanwhile.
  const openKey = treeRows.filter(r => r.open && r.kind === "folder").map(r => r.path).join("\n");
  useEffect(() => {
    const want = new Map(openKey ? openKey.split("\n").map(p => [normalizePath(p), p] as const) : []);
    for (const [k, w] of watched.current) {
      if (want.has(k)) continue;
      w.gate.cancel();
      void unwatchDir(w.path);
      watched.current.delete(k);
      unwatchedSince.current.add(k);
    }
    for (const [k, p] of want) {
      if (watched.current.has(k)) continue;
      const gate = new RefreshGate<string>(async dir => { await listTreeFolderRef.current(dir); });
      watched.current.set(k, { path: p, gate });
      void watchDir(p);
      if (unwatchedSince.current.delete(k)) gate.refresh(p);
    }
  }, [openKey]);
  useEffect(() => () => {
    for (const w of watched.current.values()) {
      w.gate.cancel();
      void unwatchDir(w.path);
    }
    watched.current.clear();
  }, []);
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;
    void listen<string>("fs-changed", evt => {
      const w = watched.current.get(normalizePath(typeof evt.payload === "string" ? evt.payload : ""));
      w?.gate.refresh(w.path);
    }).then(fn => {
      if (disposed) fn();
      else unlisten = fn;
    }).catch(() => { /* no Tauri: nothing reports */ });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  const tagCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const labels of Object.values(tags)) {
      if (!Array.isArray(labels)) continue;
      for (const label of labels) {
        if (!label) continue;
        counts[label] = (counts[label] ?? 0) + 1;
      }
    }
    const seedLabels = new Set(SEED_TAGS.map(s => s.label));
    const rows: { label: string; color: string; count: number }[] = [];
    for (const s of SEED_TAGS) {
      rows.push({ label: s.label, color: s.color, count: counts[s.label] ?? 0 });
    }
    const userLabels = Object.keys(counts).filter(k => !seedLabels.has(k)).sort();
    for (const k of userLabels) {
      rows.push({ label: k, color: TAG_COLOR_MAP[k] ?? "var(--fg-2)", count: counts[k] });
    }
    return rows;
  }, [tags]);

  // Flat list of keyboard-navigable rows in render order. Respects the
  // user's group order and skips collapsed groups so keyboard nav stays in
  // sync with what is actually on-screen. Tree rows keep their path+depth
  // so ← / → can collapse/expand / hop parent.
  type SbNavRow =
    | { kind: "pin"; path: string }
    | { kind: "tree"; path: string; depth: number; open: boolean; isFolder: boolean; hasChildren: boolean }
    | { kind: "tag"; label: string }
    | { kind: "drive"; path: string }
    | { kind: "wsl"; path: string }
    | { kind: "remote"; idx: number };
  const navRows: SbNavRow[] = useMemo(() => {
    const out: SbNavRow[] = [];
    for (const key of sbOrder) {
      if (sbCollapsed[key]) continue;
      switch (key) {
        case "PINNED":
          for (const p of pins) out.push({ kind: "pin", path: p });
          break;
        case "TREE":
          for (const n of treeRows) {
            const has = (children[n.path]?.length ?? 0) > 0 || !(n.path in children);
            out.push({ kind: "tree", path: n.path, depth: n.depth, open: n.open, isFolder: n.kind === "folder", hasChildren: has });
          }
          break;
        case "TAGS":
          for (const t of tagCounts) out.push({ kind: "tag", label: t.label });
          break;
        case "DEVICES":
          for (const d of driveList) out.push({ kind: "drive", path: d.letter });
          for (const w of wslDistros) out.push({ kind: "wsl", path: w.path });
          break;
        case "REMOTE":
          for (let i = 0; i < savedRemotes.length; i++) out.push({ kind: "remote", idx: i });
          break;
      }
    }
    return out;
  }, [sbOrder, sbCollapsed, pins, treeRows, children, tagCounts, driveList, wslDistros, savedRemotes]);

  // Scroll the keyboard-selected row into view after each change.
  useEffect(() => {
    if (selectedIdx < 0) return;
    const root = sidebarRef.current;
    if (!root) return;
    const el = root.querySelector<HTMLElement>(`[data-sb-nav-idx="${selectedIdx}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedIdx]);

  const activateRow = (row: SbNavRow) => {
    if (row.kind === "pin") openRow(row.path, pinFiles.has(row.path));
    else if (row.kind === "drive" || row.kind === "wsl") onGoTo(row.path);
    else if (row.kind === "tree") void openTreeRow(row.path, row.isFolder);
    else if (row.kind === "tag") onTagFilter?.(row.label);
    else if (row.kind === "remote") onRemoteClick(savedRemotes[row.idx]);
  };

  const onSidebarKeyDown = (e: React.KeyboardEvent) => {
    if (isModalOpen()) return;
    // Ignore events that bubbled up from inside the tree-options popup, the
    // section title (which owns Enter-to-toggle for collapsible groups from
    // a sibling task), or any focused form input inside the sidebar.
    const target = e.target as HTMLElement | null;
    if (target) {
      if (target.closest(".sb-title")) return;
      const tag = target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (target.isContentEditable) return;
    }
    if (navRows.length === 0) return;
    const key = e.key;
    if (key !== "ArrowUp" && key !== "ArrowDown" && key !== "ArrowLeft" && key !== "ArrowRight" && key !== "Enter" && key !== "Home" && key !== "End") {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    // React's synthetic stopPropagation doesn't block App.tsx's window-level
    // native keydown listener. Without this, Enter here would also fire Open
    // on the file pane.
    e.nativeEvent.stopImmediatePropagation();
    const curIdx = selectedIdx < 0 ? 0 : Math.max(0, Math.min(selectedIdx, navRows.length - 1));
    if (key === "ArrowDown") {
      setSelectedIdx(Math.min(navRows.length - 1, curIdx + 1));
      return;
    }
    if (key === "ArrowUp") {
      setSelectedIdx(Math.max(0, curIdx - 1));
      return;
    }
    if (key === "Home") { setSelectedIdx(0); return; }
    if (key === "End") { setSelectedIdx(navRows.length - 1); return; }
    const row = navRows[curIdx];
    if (!row) return;
    if (key === "Enter") {
      activateRow(row);
      return;
    }
    if (row.kind !== "tree") return;
    if (key === "ArrowRight") {
      if (row.isFolder && !row.open && row.hasChildren) {
        void toggleNode(row.path);
      } else if (row.open) {
        // Hop to first child (depth+1) below this row.
        for (let i = curIdx + 1; i < navRows.length; i++) {
          const r = navRows[i];
          if (r.kind !== "tree") break;
          if (r.depth <= row.depth) break;
          if (r.depth === row.depth + 1) { setSelectedIdx(i); return; }
        }
      }
      return;
    }
    if (key === "ArrowLeft") {
      if (row.isFolder && row.open) {
        void toggleNode(row.path);
      } else if (row.depth > 0) {
        // Hop to parent: nearest preceding tree row with depth - 1.
        for (let i = curIdx - 1; i >= 0; i--) {
          const r = navRows[i];
          if (r.kind !== "tree") break;
          if (r.depth === row.depth - 1) { setSelectedIdx(i); return; }
        }
      }
      return;
    }
  };

  // Per-group nav-row starting indices. Collapsed groups contribute zero
  // rows, so the offsets depend on both `sbOrder` and `sbCollapsed`. The
  // render loop consults `navStart[key]` to stamp `data-sb-nav-idx` values
  // that line up with `navRows` for keyboard nav.
  const navStart = useMemo(() => {
    const sizeOf = (key: SbGroupKey): number => {
      if (sbCollapsed[key]) return 0;
      switch (key) {
        case "PINNED":  return pins.length;
        case "TREE":    return treeRows.length;
        case "TAGS":    return tagCounts.length;
        case "DEVICES": return driveList.length + wslDistros.length;
        case "REMOTE":  return savedRemotes.length;
      }
    };
    const out: Record<SbGroupKey, number> = { PINNED: 0, TREE: 0, TAGS: 0, DEVICES: 0, REMOTE: 0 };
    let cursor = 0;
    for (const key of sbOrder) {
      out[key] = cursor;
      cursor += sizeOf(key);
    }
    return out;
  }, [sbOrder, sbCollapsed, pins, treeRows, tagCounts, driveList, wslDistros, savedRemotes]);

  // Pointer-based drag: pressing an `.sb-title` starts tracking; while
  // dragging we compute the drop index from the mouse's y-position relative
  // to each title bar's rect. Release commits the reorder.
  const onTitlePointerDown = (key: SbGroupKey) => (e: React.PointerEvent) => {
    // Only left button, and ignore clicks on buttons (+/⋯) inside the title.
    if (e.button !== 0) return;
    const tgt = e.target as HTMLElement;
    if (tgt.closest("[data-sb-title-button]")) return;
    const startY = e.clientY;
    const startX = e.clientX;
    let dragging = false;

    const computeDropIdx = (clientY: number): number => {
      const titles = sidebarRef.current?.querySelectorAll<HTMLElement>("[data-sb-group-title]");
      if (!titles || titles.length === 0) return 0;
      for (let i = 0; i < titles.length; i++) {
        const rect = titles[i].getBoundingClientRect();
        if (clientY < rect.top + rect.height / 2) return i;
      }
      return titles.length;
    };

    const onMove = (me: PointerEvent) => {
      if (!dragging) {
        if (Math.abs(me.clientY - startY) < 4 && Math.abs(me.clientX - startX) < 4) return;
        dragging = true;
        setSbDragging(key);
      }
      setSbDropIdx(computeDropIdx(me.clientY));
    };
    const onUp = (me: PointerEvent) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      if (dragging) {
        const dropIdx = computeDropIdx(me.clientY);
        setSbOrder(prev => {
          const idx = prev.indexOf(key);
          if (idx < 0) return prev;
          // Dropping onto own slot is a no-op; splice at the adjusted index
          // so "drop above self" and "drop below self" behave consistently.
          const target = dropIdx > idx ? dropIdx - 1 : dropIdx;
          if (target === idx) return prev;
          const copy = prev.slice();
          copy.splice(idx, 1);
          copy.splice(target, 0, key);
          return copy;
        });
      }
      setSbDragging(null);
      setSbDropIdx(null);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const onTitleKeyDown = (key: SbGroupKey) => (e: React.KeyboardEvent) => {
    // Enter toggles collapse; Alt+Up/Down moves the group.
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      toggleGroupCollapse(key);
      return;
    }
    if (e.altKey && e.key === "ArrowUp") {
      e.preventDefault();
      e.stopPropagation();
      moveGroup(key, -1);
      return;
    }
    if (e.altKey && e.key === "ArrowDown") {
      e.preventDefault();
      e.stopPropagation();
      moveGroup(key, 1);
      return;
    }
  };

  const renderChevron = (key: SbGroupKey) => (
    <span style={{ display: "inline-block", width: 10, textAlign: "center", color: "var(--fg-3)" }}>
      {sbCollapsed[key] ? "▸" : "▾"}
    </span>
  );

  const renderTitle = (key: SbGroupKey, label: string, trailing?: React.ReactNode, titleRef?: React.RefObject<HTMLDivElement>) => (
    <div
      className="sb-title"
      data-sb-group-title={key}
      ref={titleRef}
      tabIndex={0}
      role="button"
      aria-expanded={!sbCollapsed[key]}
      style={{ position: "relative", cursor: "pointer", userSelect: "none" }}
      onClick={() => toggleGroupCollapse(key)}
      onPointerDown={onTitlePointerDown(key)}
      onKeyDown={onTitleKeyDown(key)}
    >
      <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
        {renderChevron(key)}
        <span>{label}</span>
      </span>
      {trailing}
    </div>
  );

  const renderPinned = () => (
    <div
      key="PINNED"
      className={"sb-group" + (sbDragging === "PINNED" ? " sb-group-dragging" : "")}
    >
      {renderTitle("PINNED", "PINNED", (
        <span
          data-sb-title-button
          style={{color:"var(--fg-3)", cursor:"pointer"}}
          title="Pin current folder"
          onClick={(e) => { e.stopPropagation(); onAddPin(); }}
        >+</span>
      ))}
      {!sbCollapsed["PINNED"] && (<>
        {pins.length === 0 && (
          <div className="sb-item" style={{color:"var(--fg-3)", cursor:"default"}}>
            <span className="ic">·</span>
            <span style={{fontStyle:"italic"}}>no pins yet</span>
            <span className="badge"></span>
          </div>
        )}
        {pins.map((p, i) => {
          const navIdx = navStart.PINNED + i;
          const isKb = selectedIdx === navIdx;
          return (
            <div key={i}
                 data-sidebar-drop-path={p}
                 data-sb-nav-idx={navIdx}
                 className={"sb-item" + (p === activePath ? " active" : "") + (isKb ? " sb-item-focused" : "")}
                 onClick={() => openRow(p, pinFiles.has(p))}
                 onContextMenu={(e) => {
                   if (!onRowContext) return;
                   e.preventDefault();
                   e.stopPropagation();
                   onRowContext(e, p, pinFiles.has(p) ? "pinned-file" : "pinned");
                 }}
                 title={p}
                 style={{cursor:"pointer"}}>
              <span className="ic">{home && p === home ? "󰋜" : ""}</span>
              <span style={{overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap"}}>{basename(p) || p}</span>
              <span className="badge"></span>
            </div>
          );
        })}
      </>)}
    </div>
  );

  const renderTree = () => (
    <div
      key="TREE"
      className={"sb-group" + (sbDragging === "TREE" ? " sb-group-dragging" : "")}
    >
      {renderTitle("TREE", "TREE", (
        <>
          <span
            data-sb-title-button
            style={{ color: "var(--fg-3)", cursor: "pointer", userSelect: "none" }}
            title="Tree options"
            onClick={(e) => { e.stopPropagation(); setTreeMenuOpen(v => !v); }}
          >⋯</span>
          {treeMenuOpen && (
            <div
              data-sb-title-button
              onClick={(e) => e.stopPropagation()}
              style={{
                position: "absolute", top: "100%", right: 4, zIndex: 60,
                minWidth: 200, background: "var(--bg-1, #1a1b26)",
                border: "1px solid var(--fg-3)", borderRadius: 3,
                boxShadow: "0 4px 14px rgba(0,0,0,0.45)",
                padding: "4px 0", fontFamily: "var(--font-mono)",
                color: "var(--fg-1)", fontSize: 12,
              }}
            >
              {([
                { k: "showHidden" as const, label: "Show hidden" },
                { k: "showFiles" as const,  label: "Show files" },
                { k: "followActive" as const, label: "Follow active tab" },
              ]).map(row => (
                <div
                  key={row.k}
                  onClick={() => setTreePrefs(p => ({ ...p, [row.k]: !p[row.k] }))}
                  style={{ padding: "4px 10px", cursor: "pointer", display: "flex", alignItems: "center", gap: 8 }}
                >
                  <span style={{ width: 12, textAlign: "center" }}>{treePrefs[row.k] ? "✓" : ""}</span>
                  <span>{row.label}</span>
                </div>
              ))}
              <div style={{ borderTop: "1px solid var(--fg-3)", margin: "4px 0" }} />
              <div onClick={() => { void collapseAll(); setTreeMenuOpen(false); }}
                   style={{ padding: "4px 10px", cursor: "pointer", paddingLeft: 30 }}>Collapse all</div>
              <div onClick={() => { void relistTree(); setTreeMenuOpen(false); }}
                   style={{ padding: "4px 10px", cursor: "pointer", paddingLeft: 30 }}>Refresh</div>
              <div onClick={() => { void changeRoot(); setTreeMenuOpen(false); }}
                   style={{ padding: "4px 10px", cursor: "pointer", paddingLeft: 30 }}>Change root…</div>
            </div>
          )}
        </>
      ), treeTitleRef)}
      {!sbCollapsed["TREE"] && treeRows.map((n, ti) => {
        const hasChildren = (children[n.path]?.length ?? 0) > 0 || !(n.path in children);
        const navIdx = navStart.TREE + ti;
        const isKb = selectedIdx === navIdx;
        return (
          <div key={n.path}
               data-sidebar-drop-path={n.kind === "folder" ? n.path : undefined}
               data-sb-nav-idx={navIdx}
               className={"tree-row" + (n.path === activePath ? " active" : "") + (isKb ? " sb-item-focused" : "")}
               style={{paddingLeft: 12 + n.depth * 10, cursor:"pointer"}}
               onClick={() => void openTreeRow(n.path, n.kind === "folder")}
               onContextMenu={(e) => {
                 if (!onRowContext) return;
                 e.preventDefault();
                 e.stopPropagation();
                 onRowContext(e, n.path, n.kind === "folder" ? "tree-folder" : "tree-file");
               }}
               title={n.path}>
            <span
              className="chev"
              onClick={(e) => { e.stopPropagation(); void toggleNode(n.path); }}
              style={{cursor:"pointer"}}
            >{hasChildren ? (n.open ? "" : "") : ""}</span>
            <span className="ic">{n.open ? "" : ""}</span>
            <span style={{overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap"}}>{n.name}</span>
            <span className="git"></span>
          </div>
        );
      })}
    </div>
  );

  const renderTags = () => (
    <div
      key="TAGS"
      className={"sb-group" + (sbDragging === "TAGS" ? " sb-group-dragging" : "")}
    >
      {renderTitle("TAGS", "TAGS")}
      {!sbCollapsed["TAGS"] && tagCounts.map((t, i) => {
        const navIdx = navStart.TAGS + i;
        const isKb = selectedIdx === navIdx;
        return (
          <div key={i}
               data-sb-nav-idx={navIdx}
               className={"sb-item" + (activeTagFilter === t.label ? " active" : "") + (isKb ? " sb-item-focused" : "")}
               title={`filter by tag: ${t.label}`}
               style={{cursor:"pointer"}}
               onClick={() => onTagFilter && onTagFilter(t.label)}>
            <span className="ic" style={{color: t.color}}></span>
            <span>{t.label}</span>
            <span className="badge">{t.count}</span>
          </div>
        );
      })}
    </div>
  );

  const renderDevices = () => (
    <div
      key="DEVICES"
      className={"sb-group" + (sbDragging === "DEVICES" ? " sb-group-dragging" : "")}
    >
      {renderTitle("DEVICES", "DEVICES")}
      {!sbCollapsed["DEVICES"] && (<>
        {driveList.length === 0 && (
          <div className="sb-item" style={{color:"var(--fg-3)", cursor:"default", gridTemplateColumns:"16px 1fr"}}>
            <span className="ic">·</span>
            <div style={{fontStyle:"italic"}}>no drives</div>
          </div>
        )}
        {driveList.map((d, i) => {
          const used = d.total > d.free ? d.total - d.free : 0;
          const letter = d.letter.replace(/\\$/, "");
          const label = d.label && d.label.length > 0 ? d.label : letter;
          const navIdx = navStart.DEVICES + i;
          const isKb = selectedIdx === navIdx;
          return (
            <div key={"d" + i}
                 data-sb-nav-idx={navIdx}
                 className={"sb-item" + (d.letter === activePath ? " active" : "") + (isKb ? " sb-item-focused" : "")}
                 onClick={() => onGoTo(d.letter)}
                 onContextMenu={(e) => {
                   if (!onRowContext) return;
                   e.preventDefault();
                   e.stopPropagation();
                   onRowContext(e, d.letter, "drive");
                 }}
                 style={{cursor:"pointer", gridTemplateColumns:"16px 1fr"}}
                 title={d.letter}>
              <span className="ic"></span>
              <div>
                <div>{label === letter ? letter : letter + " " + label}</div>
                <div style={{color:"var(--fg-3)", fontSize:10}}>{formatSidebarBytes(used)} / {formatSidebarBytes(d.total)}{d.fs ? " · " + d.fs : ""}</div>
              </div>
            </div>
          );
        })}
        {wslDistros.map((w, i) => {
          const navIdx = navStart.DEVICES + driveList.length + i;
          const isKb = selectedIdx === navIdx;
          return (
            <div key={"w" + i}
                 data-sb-nav-idx={navIdx}
                 className={"sb-item" + (w.path === activePath ? " active" : "") + (isKb ? " sb-item-focused" : "")}
                 onClick={() => onGoTo(w.path)}
                 onContextMenu={(e) => {
                   if (!onRowContext) return;
                   e.preventDefault();
                   e.stopPropagation();
                   onRowContext(e, w.path, "wsl");
                 }}
                 style={{cursor:"pointer", gridTemplateColumns:"16px 1fr"}}
                 title={w.path}>
              <span className="ic"></span>
              <div>
                <div>{w.name}</div>
                <div style={{color:"var(--fg-3)", fontSize:10}}>wsl · {w.path}</div>
              </div>
            </div>
          );
        })}
      </>)}
    </div>
  );

  const renderRemote = () => (
    <div
      key="REMOTE"
      className={"sb-group" + (sbDragging === "REMOTE" ? " sb-group-dragging" : "")}
    >
      {renderTitle("REMOTE", "REMOTE", (
        <span
          data-sb-title-button
          style={{color:"var(--fg-3)", cursor:"pointer"}}
          title="Add remote server"
          onClick={(e) => { e.stopPropagation(); onOpenConnectDialog(); }}
        >+</span>
      ))}
      {!sbCollapsed["REMOTE"] && (<>
        {savedRemotes.length === 0 && (
          <div className="sb-item" style={{color:"var(--fg-3)", cursor:"default"}}>
            <span className="ic">·</span>
            <span style={{fontStyle:"italic"}}>no saved remotes</span>
            <span className="badge"></span>
          </div>
        )}
        {savedRemotes.map((r, i) => {
          const navIdx = navStart.REMOTE + i;
          const isKb = selectedIdx === navIdx;
          return (
            <div key={"r" + i}
                 data-sb-nav-idx={navIdx}
                 className={"sb-item" + (isKb ? " sb-item-focused" : "")}
                 style={{gridTemplateColumns: "16px 1fr", cursor:"pointer"}}
                 title={`ssh ${r.host}${r.path ? " — " + r.path : ""}`}
                 onClick={() => onRemoteClick(r)}
                 onContextMenu={(e) => {
                   if (!onRowContext) return;
                   e.preventDefault();
                   onRowContext(e, r.host, "remote");
                 }}>
              <span className="ic"></span>
              <div>
                <div>{r.label}</div>
                <div style={{color:"var(--fg-3)", fontSize:10}}>{r.host}{r.path ? " · " + r.path : ""}</div>
              </div>
            </div>
          );
        })}
      </>)}
    </div>
  );

  const groupRenderers: Record<SbGroupKey, () => React.ReactNode> = {
    PINNED: renderPinned,
    TREE: renderTree,
    TAGS: renderTags,
    DEVICES: renderDevices,
    REMOTE: renderRemote,
  };

  return (
    <aside
      ref={sidebarRef}
      className="sidebar"
      tabIndex={-1}
      onMouseDown={() => { if (onActivate) onActivate(); }}
      onFocus={() => { if (onActivate) onActivate(); }}
      onKeyDown={onSidebarKeyDown}
    >
      {sbOrder.map((key, idx) => (
        <React.Fragment key={key}>
          {sbDragging && sbDropIdx === idx && <div className="sb-drop-indicator" />}
          {groupRenderers[key]()}
        </React.Fragment>
      ))}
      {sbDragging && sbDropIdx === sbOrder.length && <div className="sb-drop-indicator" />}
    </aside>
  );
}
