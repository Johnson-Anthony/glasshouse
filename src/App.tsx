import { useEffect, useMemo, useRef, useState } from "react";
import {
  Titlebar,
  Menubar,
  Toolbar,
  Sidebar,
  FilePane,
  Inspector,
  StatusBar,
  Palette,
  ContextMenu,
  Tweaks,
  BulkRenameDialog,
  PasteSpecialDialog,
  BlameDialog,
  HexDialog,
  DiffDialog,
  ConnectServerDialog,
  TagPickerDialog,
  PropertiesDialog,
  type BulkRenameItem,
  type PasteSpecialItem,
  type SavedRemote,
  type TabDef,
  type TweakState,
  type ContextKind,
} from "./components";
import { CONTEXT_FILE, CONTEXT_EMPTY, CONTEXT_SIDEBAR, CONTEXT_SIDEBAR_PINNED, CONTEXT_TAB, CONTEXT_BREADCRUMB, type MenuItemDef, type FileRow, type FileKind, type GitStatus } from "./data";
import {
  useTabState,
  pushUndo,
  popUndo,
  popRedo,
  registerTabListMutator,
  moveTab as stateMoveTab,
  newTab as stateNewTab,
  type UseTabResult,
} from "./state";
import { HANDLERS, type HandlerCtx } from "./handlers";
import {
  homeDir,
  makeDir,
  renameEntry,
  copyEntry,
  moveEntry,
  deleteEntry,
  openWithDefault,
  revealInExplorer,
  spawnTerminal,
  spawnVscode,
  spawnVscodeStrict,
  openWithDefaultStrict,
  moveToTrash,
  winToWsl,
  writeText,
  winClose,
  winMinimize,
  winToggleMaximize,
  readPins,
  writePins,
  readTags,
  writeTags,
  readText,
  gitBlame,
  gitStage,
  gitUnstage,
  gitDiscard,
  findInFiles,
  compress,
  hashSha256,
  pickDirectory,
  type FileEntry,
  type BlameLine,
  type FindMatch,
} from "./api";

const TWEAK_DEFAULTS: TweakState = {
  theme: "gruvbox-dark",
  font: '"JetBrainsMono Nerd Font", "JetBrains Mono", ui-monospace, monospace',
  density: "default",
  scanlines: false,
  hidden: false,
  showExtensions: true,
  showGitGutters: true,
  showIgnored: false,
  foldersFirst: true,
};

interface CtxState {
  x: number;
  y: number;
  items: MenuItemDef[];
}

const FALLBACK_PATH = "C:\\";

interface TabShellProps {
  index: number;
  initialPath: string;
  onReady: (index: number, r: UseTabResult) => void;
}

interface FindInFilesModalProps {
  root: string;
  onClose: () => void;
  onPick: (match: FindMatch) => void;
}

function FindInFilesModal({ root, onClose, onPick }: FindInFilesModalProps) {
  const [query, setQuery] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [matches, setMatches] = useState<FindMatch[]>([]);
  const [ran, setRan] = useState(false);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  useEffect(() => {
    if (!query.trim()) {
      setMatches([]);
      setRan(false);
      return;
    }
    const q = query;
    const cs = caseSensitive;
    const t = window.setTimeout(() => {
      setBusy(true);
      void (async () => {
        try {
          const res = await findInFiles(root, q, !cs, 500);
          setMatches(res);
          setRan(true);
        } finally {
          setBusy(false);
        }
      })();
    }, 250);
    return () => window.clearTimeout(t);
  }, [query, caseSensitive, root]);

  const grouped = useMemo(() => {
    const map = new Map<string, FindMatch[]>();
    for (const m of matches) {
      const arr = map.get(m.path) ?? [];
      arr.push(m);
      map.set(m.path, arr);
    }
    return Array.from(map.entries());
  }, [matches]);

  const relOf = (p: string): string => {
    if (!root) return p;
    if (p.startsWith(root)) {
      return p.slice(root.length).replace(/^[\\/]+/, "");
    }
    return p;
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)",
        zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "80ch", maxWidth: "95vw", maxHeight: "85vh",
          background: "var(--bg-1, #1a1b26)", border: "1px solid var(--fg-3)",
          borderRadius: 4, display: "flex", flexDirection: "column",
          fontFamily: "var(--font-mono)", color: "var(--fg-1)",
        }}
      >
        <div
          style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "8px 12px", borderBottom: "1px solid var(--fg-3)",
            background: "var(--bg-2, #16161e)",
          }}
        >
          <span style={{ color: "var(--accent)" }}>⌕ find in files</span>
          <span style={{ color: "var(--fg-3)", fontSize: 12 }}>
            {busy ? "searching…" : ran ? `${matches.length} match${matches.length === 1 ? "" : "es"}` : "esc/click to close"}
          </span>
          <button
            onClick={onClose}
            style={{
              background: "transparent", border: "1px solid var(--fg-3)", color: "var(--fg-1)",
              padding: "2px 8px", cursor: "pointer", borderRadius: 2,
            }}
          >×</button>
        </div>
        <div style={{ padding: "8px 12px", borderBottom: "1px solid var(--fg-3)", display: "flex", flexDirection: "column", gap: 6 }}>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="search text…"
            style={{
              background: "var(--bg-0, #0f0f14)", color: "var(--fg-1)",
              border: "1px solid var(--fg-3)", borderRadius: 2,
              padding: "4px 8px", fontFamily: "var(--font-mono)", fontSize: 13,
              outline: "none",
            }}
          />
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--fg-2, var(--fg-1))" }}>
            <input
              type="checkbox"
              checked={caseSensitive}
              onChange={(e) => setCaseSensitive(e.target.checked)}
            />
            case sensitive
          </label>
          <div style={{ fontSize: 11, color: "var(--fg-3)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            Searching: {root || "(no active tab)"}
          </div>
        </div>
        <div style={{ overflow: "auto", padding: "6px 12px", fontSize: 12, lineHeight: 1.5, flex: 1 }}>
          {!ran && !busy && (
            <div style={{ color: "var(--fg-3)" }}>type to search…</div>
          )}
          {ran && !busy && matches.length === 0 && (
            <div style={{ color: "var(--fg-3)" }}>No matches</div>
          )}
          {grouped.map(([file, entries]) => (
            <div key={file} style={{ marginBottom: 8 }}>
              <div style={{ color: "var(--accent-2, var(--blue))", marginTop: 4 }}>{relOf(file)}</div>
              {entries.map((m, i) => (
                <div
                  key={i}
                  onClick={() => onPick(m)}
                  style={{
                    display: "flex", gap: 8, whiteSpace: "pre", cursor: "pointer",
                    padding: "1px 0",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-2, #16161e)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                >
                  <span style={{ color: "var(--fg-3)", width: "6ch", flexShrink: 0, textAlign: "right" }}>{m.line_no}</span>
                  <span style={{ color: "var(--fg-1)", overflow: "hidden", textOverflow: "ellipsis" }}>{m.line.slice(0, 300)}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function TabShell({ index, initialPath, onReady }: TabShellProps) {
  const tab = useTabState(initialPath);
  const onReadyRef = useRef(onReady);
  useEffect(() => { onReadyRef.current = onReady; });
  useEffect(() => {
    onReadyRef.current(index, tab);
  }, [index, tab.state, tab.actions]);
  return null;
}

function kindFromEntry(k: string): FileKind {
  switch (k) {
    case "folder": return "folder";
    case "code": return "code";
    case "img": return "img";
    case "archive": return "archive";
    case "exec": return "exec";
    case "text": return "text";
    default: return "text";
  }
}

function formatBytes(bytes: number, isDir: boolean): string {
  if (isDir) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["K", "M", "G", "T"];
  let v = bytes / 1024;
  let ui = 0;
  while (v >= 1024 && ui < units.length - 1) { v /= 1024; ui++; }
  if (v >= 100) return `${v.toFixed(0)}${units[ui]}`;
  if (v >= 10) return `${v.toFixed(1)}${units[ui]}`;
  return `${v.toFixed(1)} ${units[ui]}`;
}

function formatDate(ms: number): string {
  if (!ms) return "—";
  const d = new Date(ms);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function normalizeGit(flag: string | null | undefined): GitStatus | null {
  if (!flag) return null;
  if (flag === "M" || flag === "A" || flag === "D" || flag === "U" || flag === "?" || flag === "!") {
    return flag;
  }
  return null;
}

export interface LiveFileRow extends FileRow {
  entry: FileEntry;
}

function entryToRow(
  e: FileEntry,
  tagStore: Record<string, string[]>,
): LiveFileRow {
  const kind = kindFromEntry(e.kind);
  const nameNoExt = e.ext && e.name.toLowerCase().endsWith("." + e.ext.toLowerCase())
    ? e.name.slice(0, -(e.ext.length + 1))
    : e.name;
  const rowTags = tagStore[e.path];
  const firstTag = rowTags && rowTags.length > 0 ? rowTags[0] : null;
  return {
    name: nameNoExt,
    kind,
    size: formatBytes(e.size, kind === "folder"),
    date: formatDate(e.modified_ms),
    tag: firstTag,
    git: normalizeGit(e.git),
    hidden: e.hidden,
    ext: e.ext,
    entry: e,
  };
}

function sepOf(p: string): string {
  return p.includes("\\") ? "\\" : "/";
}

function join(dir: string, name: string): string {
  if (!dir) return name;
  const sep = sepOf(dir);
  const trimmed = dir.replace(/[\\/]+$/, "");
  if (/^[A-Za-z]:$/.test(trimmed)) return trimmed + sep + name;
  return trimmed + sep + name;
}

function basename(p: string): string {
  const trimmed = p.replace(/[\\/]+$/, "");
  const idx = Math.max(trimmed.lastIndexOf("\\"), trimmed.lastIndexOf("/"));
  return idx < 0 ? trimmed : trimmed.slice(idx + 1);
}

function dirname(p: string): string {
  const trimmed = p.replace(/[\\/]+$/, "");
  const idx = Math.max(trimmed.lastIndexOf("\\"), trimmed.lastIndexOf("/"));
  if (idx < 0) return trimmed;
  // Preserve drive root like "C:\"
  if (/^[A-Za-z]:$/.test(trimmed.slice(0, idx))) return trimmed.slice(0, idx + 1);
  return trimmed.slice(0, idx);
}

function winToWslInline(p: string): string {
  const m = /^([A-Za-z]):[\\/](.*)$/.exec(p);
  if (!m) return p;
  return `/mnt/${m[1].toLowerCase()}/${m[2].replace(/\\/g, "/")}`;
}

interface AppClipboard {
  op: "copy" | "cut";
  paths: string[];
  /** Per-path kind ("file" | "folder" | …) parallel to `paths`. Used by
   *  Paste Special to decide whether to hash-verify. */
  kinds: string[];
}
let appClipboard: AppClipboard | null = null;

// Right-click context target — populated when a non-file-row surface opens a
// context menu (sidebar row, tab, breadcrumb crumb). Case handlers read from
// this instead of selection state. Module-level to match the `appClipboard`
// pattern already in use.
interface ContextTarget {
  kind: "sidebar" | "tab" | "breadcrumb";
  path?: string;
  tabIndex?: number;
}
let contextTarget: ContextTarget | null = null;

export function App() {
  const [state, setState] = useState<TweakState>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("rice.tweaks") || "null");
      return saved ? { ...TWEAK_DEFAULTS, ...saved } : TWEAK_DEFAULTS;
    } catch { return TWEAK_DEFAULTS; }
  });

  const [initialPaths, setInitialPaths] = useState<string[] | null>(null);
  const [tabs, setTabs] = useState<TabDef[]>([]);
  const [activeTab, setActiveTab] = useState(0);
  const [palOpen, setPalOpen] = useState(false);
  const [ctx, setCtx] = useState<CtxState | null>(null);
  const [tweaksOpen, setTweaksOpen] = useState(false);
  const [showInspector, setShowInspector] = useState(true);
  const [showSidebar, setShowSidebar] = useState(true);

  const [tabHandles, setTabHandles] = useState<Record<number, UseTabResult>>({});
  const [searchQuery, setSearchQuery] = useState("");
  const [paneFocused, setPaneFocused] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const [pins, setPins] = useState<string[]>([]);
  const [tagStore, setTagStore] = useState<Record<string, string[]>>({});
  const [blame, setBlame] = useState<{ path: string; lines: BlameLine[] } | null>(null);
  const [hexView, setHexView] = useState<{ path: string; hex: string } | null>(null);
  const [diffView, setDiffView] = useState<{ a: string; b: string; diff: string } | null>(null);
  const [showFindModal, setShowFindModal] = useState(false);
  const [bulkRenameItems, setBulkRenameItems] = useState<BulkRenameItem[] | null>(null);
  const [pasteSpecial, setPasteSpecial] = useState<{
    items: PasteSpecialItem[];
    dstDir: string;
    clipboardMode: "copy" | "cut";
  } | null>(null);
  const [savedRemotes, setSavedRemotes] = useState<SavedRemote[]>([]);
  const [connectOpen, setConnectOpen] = useState(false);
  const [tagPickerPath, setTagPickerPath] = useState<string | null>(null);
  const [propsEntry, setPropsEntry] = useState<FileEntry | null>(null);
  const [homePath, setHomePath] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      setPins(await readPins());
      setTagStore(await readTags());
    })();
  }, []);

  useEffect(() => {
    void (async () => {
      const home = await homeDir();
      const p = home ?? FALLBACK_PATH;
      setHomePath(home);
      setInitialPaths([p]);
      setTabs([{ ic: "", color: "var(--blue)", label: p }]);
      if (home) {
        const remotesPath = join(join(home, ".glasshouse"), "remotes.json");
        try {
          const txt = await readText(remotesPath, 0);
          if (txt) {
            const parsed: unknown = JSON.parse(txt);
            if (Array.isArray(parsed)) {
              const valid = parsed.filter((r): r is SavedRemote =>
                !!r && typeof r === "object" &&
                typeof (r as SavedRemote).label === "string" &&
                typeof (r as SavedRemote).host === "string" &&
                typeof (r as SavedRemote).path === "string",
              );
              setSavedRemotes(valid);
            }
          }
        } catch { /* missing / malformed — start empty */ }
      }
    })();
  }, []);

  const persistRemotes = (next: SavedRemote[]) => {
    setSavedRemotes(next);
    if (!homePath) return;
    const dir = join(homePath, ".glasshouse");
    const file = join(dir, "remotes.json");
    void (async () => {
      try { await makeDir(dir); } catch { /* already exists */ }
      try { await writeText(file, JSON.stringify(next, null, 2)); }
      catch (err) { console.error("remotes.json write failed:", err); }
    })();
  };

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", state.theme);
    document.documentElement.setAttribute("data-density", state.density);
    document.documentElement.setAttribute("data-scanlines", state.scanlines ? "on" : "off");
    document.documentElement.style.setProperty("--font-mono", state.font);
    localStorage.setItem("rice.tweaks", JSON.stringify(state));
  }, [state]);

  const activeHandle: UseTabResult | undefined = tabHandles[activeTab];

  useEffect(() => {
    if (!activeHandle) return;
    if (activeHandle.state.showHidden !== state.hidden) {
      activeHandle.actions.setShowHidden(state.hidden);
    }
  }, [state.hidden, activeHandle]);

  useEffect(() => {
    if (!activeHandle) return;
    const label = activeHandle.state.path;
    setTabs(prev => {
      if (prev[activeTab] && prev[activeTab].label !== label) {
        const next = [...prev];
        next[activeTab] = { ...next[activeTab], label };
        return next;
      }
      return prev;
    });
  }, [activeHandle?.state.path, activeTab]);

  // Keep a ref to the latest handleMenuCommand so the keydown listener below
  // (which installs once) always dispatches through the current closure.
  const handleMenuCommandRef = useRef<(label: string) => void>(() => {});

  useEffect(() => {
    const isTextInput = (t: EventTarget | null): boolean => {
      const el = t as HTMLElement | null;
      if (!el) return false;
      if (el.isContentEditable) return true;
      const tag = el.tagName;
      return tag === "INPUT" || tag === "TEXTAREA";
    };
    const h = (e: KeyboardEvent) => {
      const dispatch = (label: string) => handleMenuCommandRef.current(label);
      const inText = isTextInput(e.target);

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "p") {
        e.preventDefault(); setPalOpen(v => !v); return;
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "f") {
        e.preventDefault(); setShowFindModal(v => !v); return;
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "v") {
        if (inText) return;
        e.preventDefault(); dispatch("Paste Special…"); return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "`") {
        e.preventDefault();
        const cwd = activeHandle?.state.path;
        if (cwd) void spawnTerminal(cwd);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === ",") {
        e.preventDefault(); setTweaksOpen(v => !v); return;
      }
      if (e.key === "Escape") {
        setPalOpen(false); setCtx(null);
      }
      if (e.key === "/" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (inText) return;
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
        return;
      }

      // File-op shortcuts — all route through handleMenuCommand so one place
      // owns the behaviour. Skip anything fired while focus is in a text input
      // so typing into fields doesn't nuke files.
      if (inText) return;

      // Ctrl+X / Ctrl+C / Ctrl+V — only intercept when there IS a file-pane
      // selection; otherwise let the browser handle normal text clipboard.
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
        const k = e.key.toLowerCase();
        const hasSelection = (activeHandle?.state.selected.length ?? 0) > 0;
        if (k === "c" && hasSelection) { e.preventDefault(); dispatch("Copy"); return; }
        if (k === "x" && hasSelection) { e.preventDefault(); dispatch("Cut"); return; }
        if (k === "v") { e.preventDefault(); dispatch("Paste"); return; }
        if (k === "h") { e.preventDefault(); dispatch("Toggle Hidden Files"); return; }
        if (k === "w") { e.preventDefault(); dispatch("Close Tab"); return; }
        if (k === "t") { e.preventDefault(); dispatch("New Tab"); return; }
      }

      if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
        if (e.key === "ArrowLeft") { e.preventDefault(); dispatch("Back"); return; }
        if (e.key === "ArrowRight") { e.preventDefault(); dispatch("Forward"); return; }
      }

      if (e.key === "F2") {
        e.preventDefault();
        const n = activeHandle?.state.selected.length ?? 0;
        dispatch(n > 1 ? "Bulk Rename…" : "Rename");
        return;
      }

      if (e.key === "F6") { e.preventDefault(); dispatch("Move to…"); return; }

      if (e.key === "Delete") {
        e.preventDefault();
        if (e.shiftKey) dispatch("Delete Permanently");
        else dispatch("Move to Trash");
        return;
      }

      if (e.key === "Backspace" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        dispatch("Up");
        return;
      }

      if (e.key === "Enter" && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
        if ((activeHandle?.state.selected.length ?? 0) > 0) {
          e.preventDefault();
          dispatch("Open");
        }
        return;
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [activeHandle]);

  useEffect(() => {
    const h = (e: MouseEvent) => { e.preventDefault(); };
    document.addEventListener("contextmenu", h);
    return () => document.removeEventListener("contextmenu", h);
  }, []);

  const openNewTab = () => {
    const seed = activeHandle?.state.path ?? FALLBACK_PATH;
    setTabs(prev => [...prev, { ic: "", color: "var(--cyan)", label: seed }]);
    setInitialPaths(prev => (prev ? [...prev, seed] : [seed]));
  };

  const closeTabAt = (i: number) => {
    setTabs(prev => prev.filter((_, k) => k !== i));
    setInitialPaths(prev => (prev ? prev.filter((_, k) => k !== i) : prev));
    setTabHandles(prev => {
      const next: Record<number, UseTabResult> = {};
      Object.entries(prev).forEach(([k, v]) => {
        const ki = Number(k);
        if (ki < i) next[ki] = v;
        else if (ki > i) next[ki - 1] = v;
      });
      return next;
    });
    if (activeTab >= i && activeTab > 0) setActiveTab(activeTab - 1);
  };

  const THEMES = ["tokyo-night","catppuccin-mocha","gruvbox-dark","rose-pine","everforest","solarized-dark","green-crt","synthwave"];

  const duplicateTabAt = (i: number) => {
    const seed = initialPaths?.[i] ?? FALLBACK_PATH;
    // Prefer the live path of that tab's handle if available.
    const live = tabHandles[i]?.state.path ?? seed;
    setTabs(prev => [...prev, { ic: "", color: "var(--cyan)", label: live }]);
    setInitialPaths(prev => (prev ? [...prev, live] : [live]));
  };

  const closeOtherTabsAt = (keep: number) => {
    setTabs(prev => prev.filter((_, k) => k === keep));
    setInitialPaths(prev => (prev ? prev.filter((_, k) => k === keep) : prev));
    setTabHandles(prev => {
      const v = prev[keep];
      const next: Record<number, UseTabResult> = {};
      if (v) next[0] = v;
      return next;
    });
    setActiveTab(0);
  };

  const openPathInNewTab = (p: string) => {
    setTabs(prev => [...prev, { ic: "", color: "var(--cyan)", label: p }]);
    setInitialPaths(prev => (prev ? [...prev, p] : [p]));
  };

  useEffect(() => {
    registerTabListMutator({
      moveTab: (from, to) => {
        if (from === to) return;
        setTabs(prev => {
          if (from < 0 || from >= prev.length || to < 0 || to >= prev.length) return prev;
          const next = [...prev];
          const [moved] = next.splice(from, 1);
          next.splice(to, 0, moved);
          return next;
        });
        setInitialPaths(prev => {
          if (!prev) return prev;
          if (from < 0 || from >= prev.length || to < 0 || to >= prev.length) return prev;
          const next = [...prev];
          const [moved] = next.splice(from, 1);
          next.splice(to, 0, moved);
          return next;
        });
        setActiveTab(cur => (cur === from ? to : cur));
      },
      newTab: (path) => {
        const p = path ?? activeHandle?.state.path ?? FALLBACK_PATH;
        openPathInNewTab(p);
        setActiveTab(tabs.length);
      },
    });
    return () => registerTabListMutator(null);
  }, [tabs.length, activeHandle]);

  const handleMenuCommand = (label: string) => {
    // Handle context-sourced commands (sidebar / tab / breadcrumb right-click)
    // up front. Consume contextTarget on use so a later selection-sourced
    // click with the same label doesn't misfire.
    const ctxT = contextTarget;
    if (ctxT) {
      if (ctxT.kind === "tab" && typeof ctxT.tabIndex === "number") {
        switch (label) {
          case "Close Tab":
            contextTarget = null;
            closeTabAt(ctxT.tabIndex); return;
          case "Close Other Tabs":
            contextTarget = null;
            closeOtherTabsAt(ctxT.tabIndex); return;
          case "Duplicate Tab":
            contextTarget = null;
            duplicateTabAt(ctxT.tabIndex); return;
        }
      } else if ((ctxT.kind === "sidebar" || ctxT.kind === "breadcrumb") && ctxT.path) {
        switch (label) {
          case "Open":
            contextTarget = null;
            activeHandle?.actions.goTo(ctxT.path); return;
          case "Open in New Tab":
            contextTarget = null;
            openPathInNewTab(ctxT.path); return;
          case "Copy Path":
            contextTarget = null;
            void navigator.clipboard.writeText(ctxT.path); return;
          case "Reveal in Explorer":
            contextTarget = null;
            void revealInExplorer(ctxT.path); return;
          case "Unpin": {
            const target = ctxT.path;
            contextTarget = null;
            if (!pins.includes(target)) return;
            const next = pins.filter(p => p !== target);
            setPins(next);
            void writePins(next);
            return;
          }
        }
      }
    }
    switch (label) {
      case "Toggle Drawer":
      case "Terminal Drawer":
      case "Open Terminal Here": {
        const cwd = activeHandle?.state.path;
        if (cwd) void spawnTerminal(cwd);
        return;
      }
      case "Command Palette":
      case "Palette":
        setPalOpen(v => !v); return;
      case "Find in Files":
        setShowFindModal(true); return;
      case "Tweaks":
      case "Preferences…":
      case "Preferences":
      case "Settings":
        setTweaksOpen(v => !v); return;
      case "New Tab":
        openNewTab(); return;
      case "Close Tab":
        closeTabAt(activeTab); return;
      case "Home":
        void (async () => {
          const h = await homeDir();
          if (h) activeHandle?.actions.goTo(h);
        })();
        return;
      case "Quit":
      case "Close Window":
        void winClose(); return;
      case "Minimize":
        void winMinimize(); return;
      case "Full Screen":
        void winToggleMaximize(); return;
      case "Refresh":
      case "Reload":
        activeHandle?.actions.refresh(); return;
      case "Back":
        activeHandle?.actions.back(); return;
      case "Forward":
        activeHandle?.actions.forward(); return;
      case "Up":
      case "Up one level":
      case "Open Parent":
        activeHandle?.actions.up(); return;
      case "Toggle Hidden Files":
      case "Show Hidden":
      case "Show Hidden Files":
        setState(prev => ({ ...prev, hidden: !prev.hidden })); return;
      case "Inspector":
      case "Toggle Inspector":
        setShowInspector(v => !v); return;
      case "Switch Theme":
      case "Switch Theme →": {
        const i = THEMES.indexOf(state.theme);
        const next = THEMES[(i < 0 ? 0 : i + 1) % THEMES.length];
        setState(prev => ({ ...prev, theme: next }));
        return;
      }
      default:
        void doFileOp(label);
        return;
    }
  };
  handleMenuCommandRef.current = handleMenuCommand;

  async function doFileOp(label: string) {
    if (!activeHandle) return;
    const st = activeHandle.state;
    const refresh = activeHandle.actions.refresh;
    const selectedPaths = st.selected
      .map(i => st.entries[i]?.path)
      .filter((p): p is string => Boolean(p));
    const firstEntry: FileEntry | undefined = st.entries[st.selected[0]];
    const firstPath = firstEntry?.path;
    const cwd = st.path;

    try {
      switch (label) {
        case "Open": {
          if (!firstEntry) return;
          if (firstEntry.kind === "folder") activeHandle.actions.goTo(firstEntry.path);
          else await openWithDefault(firstEntry.path);
          return;
        }
        case "Open With →":
        case "Open With…": {
          if (firstPath) await openWithDefault(firstPath);
          return;
        }
        case "Rename": {
          if (!firstEntry) return;
          // Multi-select routes through bulk rename so F2 is consistent with
          // the palette / context menu "Bulk Rename…" entry.
          if (st.selected.length > 1) {
            const items: BulkRenameItem[] = st.selected
              .map(i => st.entries[i])
              .filter((e): e is FileEntry => !!e)
              .map(e => ({ path: e.path, name: e.name }));
            setBulkRenameItems(items);
            return;
          }
          // TODO: replace with custom dialog
          const next = window.prompt("rename to", firstEntry.name);
          if (!next || next === firstEntry.name) return;
          const dst = join(cwd, next);
          const src = firstEntry.path;
          await renameEntry(src, dst);
          pushUndo({
            label: `rename ${firstEntry.name} → ${next}`,
            inverse: async () => { await renameEntry(dst, src); },
          });
          refresh();
          return;
        }
        case "Bulk Rename":
        case "Bulk Rename…": {
          const items: BulkRenameItem[] = st.selected
            .map(i => st.entries[i])
            .filter((e): e is FileEntry => !!e)
            .map(e => ({ path: e.path, name: e.name }));
          if (items.length === 0) return;
          setBulkRenameItems(items);
          return;
        }
        case "Delete":
        case "Delete Permanently": {
          if (selectedPaths.length === 0) return;
          // TODO: replace with custom dialog
          const ok = window.confirm(`permanently delete ${selectedPaths.length} item(s)?`);
          if (!ok) return;
          for (const p of selectedPaths) await deleteEntry(p, false);
          refresh();
          return;
        }
        case "Move to Trash": {
          if (selectedPaths.length === 0) return;
          // Trash is reversible — only prompt for multi-select. Single items
          // go straight to the recycle bin without ceremony.
          if (selectedPaths.length > 1) {
            const ok = window.confirm(
              `Move ${selectedPaths.length} items to Recycle Bin?`,
            );
            if (!ok) return;
          }
          for (const p of selectedPaths) await moveToTrash(p);
          refresh();
          return;
        }
        case "Copy": {
          if (selectedPaths.length === 0) return;
          const kinds = st.selected
            .map(i => st.entries[i]?.kind ?? "file")
            .filter((_, idx) => Boolean(st.entries[st.selected[idx]]?.path));
          appClipboard = { op: "copy", paths: selectedPaths, kinds };
          return;
        }
        case "Cut": {
          if (selectedPaths.length === 0) return;
          const kinds = st.selected
            .map(i => st.entries[i]?.kind ?? "file")
            .filter((_, idx) => Boolean(st.entries[st.selected[idx]]?.path));
          appClipboard = { op: "cut", paths: selectedPaths, kinds };
          return;
        }
        case "Paste": {
          if (!appClipboard || appClipboard.paths.length === 0) return;
          const { op, paths } = appClipboard;
          const pasted: Array<{ src: string; dst: string }> = [];
          for (const src of paths) {
            const dst = join(cwd, basename(src));
            if (op === "copy") await copyEntry(src, dst);
            else await moveEntry(src, dst);
            pasted.push({ src, dst });
          }
          pushUndo({
            label: `${op === "copy" ? "paste copy" : "paste move"} ${pasted.length} item(s)`,
            inverse: async () => {
              if (op === "copy") {
                for (const { dst } of pasted) { await deleteEntry(dst, false); }
              } else {
                for (const { src, dst } of pasted) { await moveEntry(dst, src); }
              }
            },
          });
          if (op === "cut") appClipboard = null;
          refresh();
          return;
        }
        case "Paste Special":
        case "Paste Special…": {
          if (!appClipboard || appClipboard.paths.length === 0) {
            console.warn("[paste-special] clipboard is empty");
            return;
          }
          const { op, paths, kinds } = appClipboard;
          const items: PasteSpecialItem[] = paths.map((p, i) => ({
            path: p,
            kind: kinds[i] ?? "file",
          }));
          setPasteSpecial({ items, dstDir: cwd, clipboardMode: op });
          return;
        }
        case "New Folder":
        case "Folder": {
          // TODO: replace with custom dialog
          const name = window.prompt("new folder name", "new-folder");
          if (!name) return;
          const dst = join(cwd, name);
          await makeDir(dst);
          pushUndo({
            label: `new folder ${name}`,
            inverse: async () => { await deleteEntry(dst, true); },
          });
          refresh();
          return;
        }
        case "New File":
        case "Text File": {
          // TODO: replace with custom dialog
          const name = window.prompt("new file name", "untitled.txt");
          if (!name) return;
          const dst = join(cwd, name);
          await writeText(dst, "");
          pushUndo({
            label: `new file ${name}`,
            inverse: async () => { await deleteEntry(dst, false); },
          });
          refresh();
          return;
        }
        case "Markdown Note": {
          // TODO: replace with custom dialog
          const name = window.prompt("new note name", "note.md");
          if (!name) return;
          const dst = join(cwd, name);
          await writeText(dst, "");
          pushUndo({
            label: `new note ${name}`,
            inverse: async () => { await deleteEntry(dst, false); },
          });
          refresh();
          return;
        }
        case "Script (.sh)": {
          // TODO: replace with custom dialog
          const name = window.prompt("new script name", "script.sh");
          if (!name) return;
          const dst = join(cwd, name);
          await writeText(dst, "#!/usr/bin/env bash\n");
          pushUndo({
            label: `new script ${name}`,
            inverse: async () => { await deleteEntry(dst, false); },
          });
          refresh();
          return;
        }
        case "Duplicate": {
          if (selectedPaths.length === 0) return;
          const dupes: string[] = [];
          for (const p of selectedPaths) {
            const dst = p + " (copy)";
            await copyEntry(p, dst);
            dupes.push(dst);
          }
          pushUndo({
            label: `duplicate ${dupes.length} item(s)`,
            inverse: async () => {
              for (const d of dupes) { await deleteEntry(d, false); }
            },
          });
          refresh();
          return;
        }
        case "Open in Terminal": {
          await spawnTerminal(cwd);
          return;
        }
        case "Open in VS Code": {
          try {
            await spawnVscodeStrict(firstPath ?? cwd);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            window.alert(`Open in VS Code failed: ${msg}\n\nMake sure "code" is on PATH (install Shell Command from VS Code's command palette).`);
          }
          return;
        }
        case "Reveal in Explorer":
        case "Reveal in Tree": {
          if (firstPath) await revealInExplorer(firstPath);
          return;
        }
        case "Copy Path": {
          if (firstPath) await navigator.clipboard.writeText(firstPath);
          return;
        }
        case "Copy as WSL Path":
        case "Copy Path (WSL)": {
          if (!firstPath) return;
          let wsl = "";
          try { wsl = await winToWsl(firstPath); } catch { wsl = ""; }
          if (!wsl) wsl = winToWslInline(firstPath);
          await navigator.clipboard.writeText(wsl);
          return;
        }
        case "Tag":
        case "Tag →":
        case "Add Tag…":
        case "Add Tag": {
          if (!firstPath) return;
          setTagPickerPath(firstPath);
          return;
        }
        case "Remove Tag…":
        case "Remove Tag": {
          if (!firstPath) return;
          const existing = tagStore[firstPath] ?? [];
          if (existing.length === 0) return;
          // TODO: replace with custom dialog
          const raw = window.prompt(
            `Remove which tag? (${existing.join(", ")})`,
            existing[0],
          );
          if (raw === null) return;
          const tag = raw.trim();
          if (!tag || !existing.includes(tag)) return;
          setTagStore(prev => {
            const cur = prev[firstPath] ?? [];
            const filtered = cur.filter(t => t !== tag);
            const next = { ...prev };
            if (filtered.length === 0) delete next[firstPath];
            else next[firstPath] = filtered;
            void writeTags(next);
            return next;
          });
          return;
        }
        case "Compress to ZIP…":
        case "Compress →":
        case "Compress": {
          // Use the current multi-selection; if empty, fall back to a single
          // firstPath if one exists (e.g. chip-only context with one active).
          const active: string[] = selectedPaths.length > 0
            ? selectedPaths
            : (firstPath ? [firstPath] : []);
          if (active.length === 0) return;
          const baseName = basename(active[0]).replace(/[\\/]+$/, "") || "archive";
          const defaultName = `${baseName}.zip`;
          // TODO: replace with custom dialog
          const entered = window.prompt("compress to (zip):", defaultName);
          if (entered === null) return;
          let name = entered.trim();
          if (!name) return;
          if (!/\.zip$/i.test(name)) name += ".zip";
          const outPath = join(cwd, name);
          try {
            await compress(active, outPath);
            console.log("compressed to", outPath);
            refresh();
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error("compress failed:", msg);
            try { alert(`compress failed: ${msg}`); } catch { /* no window */ }
          }
          return;
        }
        case "Checksum SHA256":
        case "Checksum (SHA256)":
        case "Show Checksums": {
          if (!firstPath) return;
          try {
            const hex = await hashSha256(firstPath);
            try { await navigator.clipboard.writeText(hex); } catch { /* clipboard unavailable */ }
            console.log("sha256", firstPath, hex);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error("hash_sha256 failed:", msg);
            try { alert(`hash failed: ${msg}`); } catch { /* no window */ }
          }
          return;
        }
        case "Move to…":
        case "Move to":
        case "Move To…": {
          if (selectedPaths.length === 0) return;
          const home = await homeDir();
          const target = await pickDirectory(home ?? undefined);
          if (!target) return;
          const moved: Array<{ src: string; dst: string }> = [];
          for (const src of selectedPaths) {
            const dst = join(target, basename(src));
            try {
              await moveEntry(src, dst);
              moved.push({ src, dst });
            } catch (err) {
              console.error("move_entry failed for", src, err);
            }
          }
          if (moved.length > 0) {
            pushUndo({
              label: `move ${moved.length} item(s) to ${target}`,
              inverse: async () => {
                for (const { src, dst } of moved) { await moveEntry(dst, src); }
              },
            });
            refresh();
          }
          return;
        }
        case "Git: Stage": {
          const targets = selectedPaths.filter((_, idx) => {
            const e = st.entries[st.selected[idx]];
            return !!e && e.git !== null;
          });
          if (targets.length === 0) return;
          await gitStage(targets);
          refresh();
          return;
        }
        case "Git: Unstage": {
          const targets = selectedPaths.filter((_, idx) => {
            const e = st.entries[st.selected[idx]];
            return !!e && e.git !== null && e.git !== "?";
          });
          if (targets.length === 0) return;
          await gitUnstage(targets);
          refresh();
          return;
        }
        case "Git: Discard changes": {
          const targets = selectedPaths.filter((_, idx) => {
            const e = st.entries[st.selected[idx]];
            return !!e && e.git !== null;
          });
          if (targets.length === 0) return;
          const ok = window.confirm(
            `Discard local changes for ${targets.length} item(s)? This cannot be undone.`,
          );
          if (!ok) return;
          await gitDiscard(targets);
          refresh();
          return;
        }
        case "Git: Blame": {
          if (!firstEntry) return;
          if (firstEntry.kind === "folder") return;
          if (firstEntry.git === "?") return;
          try {
            const lines = await gitBlame(firstEntry.path, 2000);
            setBlame({ path: firstEntry.path, lines });
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error("git blame:", msg);
            try { alert(`git blame failed: ${msg}`); } catch { /* no window */ }
          }
          return;
        }
        case "Properties": {
          if (firstEntry) setPropsEntry(firstEntry);
          return;
        }
        default: {
          // Registry dispatch — each handlers/*.ts file owns a disjoint slice
          // of labels (selection, view, git, archive, tools, nav, misc).
          const handlerCtx: HandlerCtx = {
            activeHandle,
            cwd,
            selectedPaths,
            firstPath,
            firstEntry,
            dispatch: (l: string) => handleMenuCommandRef.current(l),
            openPalette: () => setPalOpen(true),
            openTweaks: () => setTweaksOpen(true),
            toggleSidebar: () => setShowSidebar(v => !v),
            pinPath: (p: string) => {
              if (pins.includes(p)) return;
              const next = [...pins, p];
              setPins(next);
              void writePins(next);
            },
            tabs,
            activeTab,
            setActiveTab,
            setBlame,
            setHexView,
            setDiffView,
            clipboardPaths: () => appClipboard?.paths ?? [],
            pushUndo,
            undo: () => {
              const e = popUndo();
              if (!e) return;
              void (async () => { await e.inverse(); refresh(); })();
            },
            redo: () => {
              const e = popRedo();
              if (!e) return;
              void (async () => { await e.inverse(); refresh(); })();
            },
            moveTab: stateMoveTab,
            newTab: stateNewTab,
            refresh,
            tweaks: state,
            setTweaks: setState,
          };
          for (const h of HANDLERS) {
            // eslint-disable-next-line no-await-in-loop
            const handled = await h(label, handlerCtx);
            if (handled) return;
          }
          console.warn("menu command not wired:", label);
          return;
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("file op failed", label, err);
      window.alert(msg);
    }
  }

  const openCtxMenu = (e: React.MouseEvent, items: MenuItemDef[]) => {
    setCtx({
      x: Math.min(e.clientX, window.innerWidth - 240),
      y: Math.min(e.clientY, window.innerHeight - 420),
      items,
    });
  };

  const onContext = (e: React.MouseEvent, kind: ContextKind, rowIndex?: number) => {
    // File-pane surfaces act on the current selection; clear the module target
    // so stale sidebar/tab/breadcrumb right-clicks can't leak into file ops.
    contextTarget = null;
    if (kind === "file") {
      // Hide "Remove Tag…" when the selected row has no tags — keeps the
      // menu honest instead of dangling a no-op command.
      const st = activeHandle?.state;
      // Right-click-to-select fires setSelected asynchronously, so st.selected
      // is stale on the first right-click. rowIndex arrives synchronously from
      // the row handler with the effective selection, which is what every
      // filter below needs.
      const effSelected: number[] =
        rowIndex !== undefined && st && !st.selected.includes(rowIndex)
          ? [rowIndex]
          : (st?.selected ?? []);
      const firstEntry = st ? st.entries[effSelected[0]] : undefined;
      const firstPath = firstEntry?.path;
      const hasTags = !!firstPath && (tagStore[firstPath]?.length ?? 0) > 0;
      const selCount = effSelected.length;
      // Git row-actions only make sense when the selection has tracked
      // changes (M/A/D/R/U). Untracked-only rows hide the stage/unstage/
      // discard block per spec; Blame is further restricted to a single
      // tracked file (not a folder, not untracked).
      const selEntries = st ? effSelected.map(i => st.entries[i]).filter((x): x is FileEntry => !!x) : [];
      const hasGitRow = selEntries.some(e => e.git !== null && e.git !== "?");
      const blameEligible =
        selCount === 1 &&
        !!firstEntry &&
        firstEntry.kind !== "folder" &&
        firstEntry.git !== "?";
      let items = hasTags
        ? CONTEXT_FILE
        : CONTEXT_FILE.filter(it => !(it.kind === "item" && it.label === "Remove Tag…"));
      if (!hasGitRow) {
        items = items.filter(
          it =>
            !(it.kind === "item" &&
              (it.label === "Git: Stage" ||
               it.label === "Git: Unstage" ||
               it.label === "Git: Discard changes")),
        );
      }
      if (!blameEligible) {
        items = items.filter(it => !(it.kind === "item" && it.label === "Git: Blame"));
      }
      // Swap single-rename for bulk-rename when multiple rows are selected.
      if (selCount > 1) {
        items = items.map(it => {
          if (it.kind === "item" && it.label === "Rename") {
            return { ...it, label: "Bulk Rename…", kb: "F2" };
          }
          return it;
        });
      }
      openCtxMenu(e, items);
      return;
    }
    openCtxMenu(e, CONTEXT_EMPTY);
  };

  const onSidebarContext = (e: React.MouseEvent, path: string) => {
    contextTarget = { kind: "sidebar", path };
    const menu = pins.includes(path) ? CONTEXT_SIDEBAR_PINNED : CONTEXT_SIDEBAR;
    openCtxMenu(e, menu);
  };

  const onTabContext = (e: React.MouseEvent, tabIndex: number) => {
    contextTarget = { kind: "tab", tabIndex };
    openCtxMenu(e, CONTEXT_TAB);
  };

  const onCrumbContext = (e: React.MouseEvent, path: string) => {
    contextTarget = { kind: "breadcrumb", path };
    openCtxMenu(e, CONTEXT_BREADCRUMB);
  };

  const liveRows: LiveFileRow[] = useMemo(() => {
    if (!activeHandle) return [];
    return activeHandle.state.entries.map(e => entryToRow(e, tagStore));
  }, [activeHandle?.state.entries, tagStore]);

  const selected = activeHandle?.state.selected ?? [];
  const setSelected = activeHandle?.actions.setSelected ?? (() => {});
  const selectedFile = liveRows[selected[0]] ?? null;

  const totalBytes = liveRows.reduce((acc, r) => acc + (r.kind === "folder" ? 0 : r.entry.size), 0);
  const totalSize = formatBytes(totalBytes, false);

  return (
    <div className="app">
      {initialPaths && initialPaths.map((p, i) => (
        <TabShell
          key={i}
          index={i}
          initialPath={p}
          onReady={(idx, r) => setTabHandles(prev => (prev[idx] === r ? prev : { ...prev, [idx]: r }))}
        />
      ))}
      <Titlebar
        tabs={tabs}
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        onCloseTab={closeTabAt}
        onNewTab={openNewTab}
        onTabContext={onTabContext}
      />
      <Menubar onOpenPalette={() => setPalOpen(true)} onCommand={handleMenuCommand} />
      <Toolbar
        path={activeHandle?.state.path ?? ""}
        gitInfo={activeHandle?.state.gitInfo ?? null}
        canBack={(activeHandle?.state.historyBack.length ?? 0) > 0}
        canForward={(activeHandle?.state.historyForward.length ?? 0) > 0}
        onBack={() => activeHandle?.actions.back()}
        onForward={() => activeHandle?.actions.forward()}
        onUp={() => activeHandle?.actions.up()}
        onRefresh={() => activeHandle?.actions.refresh()}
        onGoTo={(p) => activeHandle?.actions.goTo(p)}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        searchInputRef={searchInputRef}
        showHidden={state.hidden}
        onToggleHidden={() => setState(prev => ({ ...prev, hidden: !prev.hidden }))}
        showInspector={showInspector}
        onToggleInspector={() => setShowInspector(v => !v)}
        onCrumbContext={onCrumbContext}
        tagFilter={activeHandle?.state.tagFilter ?? null}
        onClearTagFilter={() => activeHandle?.actions.setTagFilter(null)}
      />
      <div className="body">
        {showSidebar && <Sidebar
          activePath={activeHandle?.state.path ?? ""}
          onGoTo={(p) => activeHandle?.actions.goTo(p)}
          onRowContext={onSidebarContext}
          pins={pins}
          onAddPin={() => {
            const p = activeHandle?.state.path;
            if (!p) return;
            if (pins.includes(p)) return;
            const next = [...pins, p];
            setPins(next);
            void writePins(next);
          }}
          tags={tagStore}
          activeTagFilter={activeHandle?.state.tagFilter ?? null}
          onTagFilter={(tag) => {
            if (!activeHandle) return;
            const cur = activeHandle.state.tagFilter;
            // Clicking the already-active filter clears it.
            activeHandle.actions.setTagFilter(cur === tag ? null : tag);
          }}
          savedRemotes={savedRemotes}
          onOpenConnectDialog={() => setConnectOpen(true)}
          onRemoteClick={(r) => {
            const cmd = `ssh ${r.host}`;
            void (async () => {
              try { await navigator.clipboard.writeText(cmd); } catch { /* clipboard unavailable */ }
              try { alert(`SSH command copied. Paste into terminal.\n\n${cmd}`); } catch { /* no window */ }
            })();
          }}
        />}
        <FilePane
          files={liveRows}
          selected={selected}
          setSelected={setSelected}
          focusIndex={activeHandle?.state.focusIndex ?? 0}
          setFocusIndex={activeHandle?.actions.setFocusIndex ?? (() => {})}
          anchorIndex={activeHandle?.state.anchorIndex ?? 0}
          setAnchorIndex={activeHandle?.actions.setAnchorIndex ?? (() => {})}
          paneFocused={paneFocused}
          setPaneFocused={setPaneFocused}
          sortKey={activeHandle?.state.sortKey ?? "name"}
          sortDir={activeHandle?.state.sortDir ?? "asc"}
          foldersFirst={state.foldersFirst}
          showExtensions={state.showExtensions}
          showGitGutters={state.showGitGutters}
          onSortChange={(k) => {
            if (!activeHandle) return;
            if (activeHandle.state.sortKey === k) {
              activeHandle.actions.setSortDir(activeHandle.state.sortDir === "asc" ? "desc" : "asc");
            } else {
              activeHandle.actions.setSortKey(k);
              activeHandle.actions.setSortDir("asc");
            }
          }}
          onContext={onContext}
          searchQuery={searchQuery}
          tagFilter={activeHandle?.state.tagFilter ?? null}
          tagStore={tagStore}
          onOpen={(i) => {
            const row = liveRows[i];
            if (!row) return;
            if (row.entry.kind === "folder") {
              activeHandle?.actions.goTo(row.entry.path);
            } else {
              void openWithDefault(row.entry.path);
            }
          }}
          onUp={() => activeHandle?.actions.up()}
          onCopy={() => handleMenuCommandRef.current("Copy")}
          onCut={() => handleMenuCommandRef.current("Cut")}
          onDelete={(permanent) => handleMenuCommandRef.current(permanent ? "Delete Permanently" : "Move to Trash")}
          onRowDrop={(targetOrigIndex, sourceOrigIndices) => {
            const target = liveRows[targetOrigIndex];
            if (!target || target.entry.kind !== "folder") return;
            const dstDir = target.entry.path;
            const sources = sourceOrigIndices
              .map(i => liveRows[i]?.entry.path)
              .filter((p): p is string => !!p);
            if (sources.length === 0) return;
            (async () => {
              for (const src of sources) {
                const sep = dstDir.includes("\\") ? "\\" : "/";
                const base = src.split(/[\\/]/).pop() ?? "";
                const dst = dstDir.replace(/[\\/]+$/, "") + sep + base;
                try { await moveEntry(src, dst); }
                catch (err) { console.error("drop move failed for", src, "→", dst, err); }
              }
              activeHandle?.actions.refresh();
            })();
          }}
        />
        {showInspector && (
          <Inspector
            file={selectedFile}
            onQuickAction={(action) => {
              const path = selectedFile?.entry.path;
              if (!path) return;
              switch (action) {
                case "copy-path":
                  try { void navigator.clipboard.writeText(path); } catch { /* clipboard unavailable */ }
                  return;
                case "run":
                  void openWithDefault(path);
                  return;
                case "open-in-code":
                  void spawnVscode(path);
                  return;
                case "git-blame":
                  void (async () => {
                    try {
                      const lines = await gitBlame(path, 2000);
                      setBlame({ path, lines });
                    } catch (err) {
                      const msg = err instanceof Error ? err.message : String(err);
                      console.error("git blame:", msg);
                      try { alert(`git blame failed: ${msg}`); } catch { /* no window */ }
                    }
                  })();
                  return;
                case "compress":
                  handleMenuCommandRef.current("Compress to ZIP…");
                  return;
              }
            }}
          />
        )}
      </div>
      <StatusBar
        selectedCount={selected.length}
        totalCount={liveRows.length}
        totalSize={totalSize}
        path={activeHandle?.state.path ?? ""}
        gitInfo={activeHandle?.state.gitInfo ?? null}
        onToggleTerm={() => {
          const cwd = activeHandle?.state.path;
          if (cwd) void spawnTerminal(cwd);
        }}
      />

      {palOpen && <Palette onClose={() => setPalOpen(false)} onCommand={handleMenuCommand} />}
      {ctx && <ContextMenu items={ctx.items} x={ctx.x} y={ctx.y} onClose={() => setCtx(null)} onCommand={handleMenuCommand} />}
      {tweaksOpen && <Tweaks state={state} setState={setState} onClose={() => setTweaksOpen(false)} />}
      {blame && <BlameDialog blame={blame} onClose={() => setBlame(null)} />}
      {hexView && <HexDialog path={hexView.path} hex={hexView.hex} onClose={() => setHexView(null)} />}
      {diffView && <DiffDialog a={diffView.a} b={diffView.b} diff={diffView.diff} onClose={() => setDiffView(null)} />}
      {showFindModal && (
        <FindInFilesModal
          root={activeHandle?.state.path ?? ""}
          onClose={() => setShowFindModal(false)}
          onPick={(m) => {
            const dir = dirname(m.path);
            if (dir) activeHandle?.actions.goTo(dir);
            setShowFindModal(false);
          }}
        />
      )}
      {bulkRenameItems && (
        <BulkRenameDialog
          items={bulkRenameItems}
          onClose={() => setBulkRenameItems(null)}
          renameOne={(from, to) => renameEntry(from, to)}
          onDone={() => activeHandle?.actions.refresh()}
        />
      )}
      {pasteSpecial && (
        <PasteSpecialDialog
          items={pasteSpecial.items}
          dstDir={pasteSpecial.dstDir}
          clipboardMode={pasteSpecial.clipboardMode}
          copyEntry={copyEntry}
          moveEntry={moveEntry}
          onClose={() => setPasteSpecial(null)}
          onDone={(clear) => {
            if (clear) appClipboard = null;
            activeHandle?.actions.refresh();
          }}
        />
      )}

      {connectOpen && (
        <ConnectServerDialog
          onClose={() => setConnectOpen(false)}
          onSave={(r) => {
            persistRemotes([...savedRemotes, r]);
            setConnectOpen(false);
          }}
        />
      )}
      {tagPickerPath && (
        <TagPickerDialog
          path={tagPickerPath}
          onClose={() => setTagPickerPath(null)}
          onSaved={(store) => {
            setTagStore(store);
            setTagPickerPath(null);
          }}
        />
      )}
      <PropertiesDialog entry={propsEntry} onClose={() => setPropsEntry(null)} />

      {!tweaksOpen && (
        <button
          className="tab-btn"
          style={{position:"fixed", right: 14, bottom: 30, zIndex: 50, width: 36, height: 28, borderColor: "var(--accent)", color:"var(--accent)"}}
          onClick={() => setTweaksOpen(true)}
          title="tweaks (Ctrl+,)"
        >◉</button>
      )}
    </div>
  );
}
