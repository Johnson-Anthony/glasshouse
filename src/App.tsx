import { useEffect, useMemo, useRef, useState } from "react";
import {
  Titlebar,
  Toolbar,
  FilePane,
  Inspector,
  QuickLook,
  StatusBar,
  Palette,
  Tweaks,
  BulkRenameDialog,
  PasteSpecialDialog,
  BlameDialog,
  GitOutputDialog,
  DiffDialog,
  ConnectServerDialog,
  ManageRemotesDialog,
  TagPickerDialog,
  PropertiesDialog,
  AboutDialog,
  KeybindingsDialog,
  DialogHost,
  FolderPickerDialog,
  BookmarkManagerDialog,
  dialogs,
  type BulkRenameItem,
  type PasteSpecialItem,
  type TweakState,
  type ContextKind,
  type GitOutputState,
} from "./components";
import { Sidebar, type SavedRemote, type SidebarRowKind } from "./Sidebar";
import { Menubar, ContextMenu, setDynamicGitCwd } from "./menus";
import { CONTEXT_FILE, CONTEXT_EMPTY, CONTEXT_SIDEBAR, CONTEXT_SIDEBAR_FOLDER, CONTEXT_SIDEBAR_DRIVE, CONTEXT_SIDEBAR_REMOTE, CONTEXT_TAB, CONTEXT_BREADCRUMB, GIT_CHORDS, MUTATING_LABELS, THEMES, type MenuItemDef, type DynamicPayload, type FileRow, type FileKind, type GitStatus } from "./data";
import {
  useTabState,
  pushUndo,
  undoLast,
  redoLast,
  registerTabListMutator,
  moveTab as stateMoveTab,
  newTab as stateNewTab,
  type UseTabResult,
} from "./state";
import { HANDLERS, type HandlerCtx } from "./handlers";
import { moveUndo, createUndo } from "./undoActions";
import { makeTab, closeTab, closeOtherTabs, moveTab as moveTabIn, tabLabel, type TabRecord } from "./tabs";
import { canExtractArchive } from "./handlers/archive";
import { IS_WINDOWS } from "./platform";
import { TerminalDrawer } from "./Terminal";
import { NoticesHost } from "./Notices";
import { MillerView } from "./Miller";
import { joinPath, parentPath, basename, normalizePath } from "./paths";
import { winPathToWsl } from "./shellCd";
import {
  homeDir,
  listDir,
  makeDir,
  ensureDir,
  renameEntry,
  copyEntry,
  moveEntry,
  deleteEntry,
  openWithDefault,
  revealInExplorer,
  spawnTerminal,
  spawnTerminalProfile,
  spawnVscode,
  spawnVscodeStrict,
  openWithDefaultStrict,
  moveToTrash,
  winToWsl,
  createTextFile,
  writeText,
  winClose,
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
  type FileEntry,
  type BlameLine,
  type FindMatch,
  type ShellProfile,
} from "./api";
import { runTransfer, planTransfer, type TransferItem, type TransferOp, type TransferResult } from "./transfer";
import { transferDeps, reportTransfer, pushTransferUndo, asItems, namesIn, unlessTaken, listNames } from "./transferUi";
import { NameSet, freeNewName, nameProblem } from "./names";

const TWEAK_DEFAULTS: TweakState = {
  theme: "gruvbox-dark",
  font: '"JetBrainsMono Nerd Font", "JetBrains Mono", ui-monospace, monospace',
  density: "default",
  scanlines: false,
  hidden: false,
  showExtensions: true,
  showGitGutters: true,
  foldersFirst: true,
};

interface CtxState {
  x: number;
  y: number;
  items: MenuItemDef[];
}

const FALLBACK_PATH = IS_WINDOWS ? "C:\\" : "/";
/** How long a Ctrl+G chord waits for its second key. */
const GIT_CHORD_MS = 1500;

interface TabShellProps {
  id: number;
  initialPath: string;
  isPrivate?: boolean;
  /** Called with the tab's latest state, and with null when it unmounts. */
  onReady: (id: number, r: UseTabResult | null) => void;
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

function TabShell({ id, initialPath, isPrivate, onReady }: TabShellProps) {
  const tab = useTabState(initialPath, !!isPrivate);
  const onReadyRef = useRef(onReady);
  useEffect(() => { onReadyRef.current = onReady; });
  useEffect(() => {
    onReadyRef.current(id, tab);
  }, [id, tab]);
  useEffect(() => () => onReadyRef.current(id, null), [id]);
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
  if (flag === "M" || flag === "A" || flag === "D" || flag === "U" || flag === "?") {
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
    link: e.is_symlink,
    entry: e,
  };
}


/** Build the ssh terminal profile for a saved remote, honoring a trailing
 *  :port in the host ("example.com:2222" → ssh -p 2222 example.com). */
function sshProfileFor(r: SavedRemote): ShellProfile {
  const colonIdx = r.host.lastIndexOf(":");
  const portPart = colonIdx > 0 ? r.host.slice(colonIdx + 1) : "";
  const hasPort = colonIdx > 0 && /^\d+$/.test(portPart);
  const hostOnly = hasPort ? r.host.slice(0, colonIdx) : r.host;
  return {
    id: `ssh:${r.host}`,
    label: `SSH: ${r.label}`,
    kind: "ssh",
    exec: "ssh",
    args: hasPort ? ["-p", portPart, hostOnly] : [hostOnly],
  };
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
  /** When kind === "sidebar", the specific row subtype right-clicked. */
  rowKind?: SidebarRowKind;
}
let contextTarget: ContextTarget | null = null;

export function App() {
  const [state, setState] = useState<TweakState>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("glasshouse.tweaks") || "null");
      return saved ? { ...TWEAK_DEFAULTS, ...saved } : TWEAK_DEFAULTS;
    } catch { return TWEAK_DEFAULTS; }
  });

  const [tabs, setTabs] = useState<TabRecord[]>([]);
  const [activeTab, setActiveTab] = useState(0);
  const [palOpen, setPalOpen] = useState(false);
  const [ctx, setCtx] = useState<CtxState | null>(null);
  const [tweaksOpen, setTweaksOpen] = useState(false);
  const [quickLookOpen, setQuickLookOpen] = useState(false);
  const [showInspector, setShowInspector] = useState(true);
  const [showSidebar, setShowSidebar] = useState(true);
  const [showStatusBar, setShowStatusBar] = useState(true);

  // Keyed by TabRecord.id, never by position.
  const [tabHandles, setTabHandles] = useState<Record<number, UseTabResult>>({});
  const [searchQuery, setSearchQuery] = useState("");
  const [paneFocused, setPaneFocused] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Focused-pane for keyboard nav (Tab / F6). "files" is the default; cycles
  // through sidebar → files → inspector → terminal (if open). Rendered via
  // html[data-focused-pane] attribute so CSS can draw the active-pane outline.
  type FocusPaneId = "sidebar" | "files" | "inspector" | "terminal";
  const [focusedPane, setFocusedPane] = useState<FocusPaneId>("files");
  const pane0RootRef = useRef<HTMLElement | null>(null);
  const sidebarRootRef = useRef<HTMLElement | null>(null);

  // Mirror of appClipboard's "cut" paths — React state so FilePane re-renders
  // the dimmed `.clip-cut` rows. Cleared after Paste or when Copy replaces the
  // clipboard contents.
  const [cutPaths, setCutPaths] = useState<string[]>([]);
  const [pins, setPins] = useState<string[]>([]);
  const [tagStore, setTagStore] = useState<Record<string, string[]>>({});
  const [blame, setBlame] = useState<{ path: string; lines: BlameLine[] } | null>(null);
  const [gitOutput, setGitOutput] = useState<GitOutputState | null>(null);
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
  const [manageRemotesOpen, setManageRemotesOpen] = useState(false);
  const [tagPickerPath, setTagPickerPath] = useState<string | null>(null);
  const [bookmarkManagerOpen, setBookmarkManagerOpen] = useState(false);
  const [propsEntry, setPropsEntry] = useState<FileEntry | null>(null);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [cheatsheetOpen, setCheatsheetOpen] = useState(false);
  const [homePath, setHomePath] = useState<string | null>(null);
  const [folderPicker, setFolderPicker] = useState<{
    initialPath?: string;
    title?: string;
    onPick: (p: string) => void;
  } | null>(null);
  const [termOpen, setTermOpen] = useState(false);
  const [termProfile, setTermProfile] = useState<ShellProfile | null>(null);
  const [termHeight, setTermHeight] = useState(() => {
    if (typeof window === "undefined") return 260;
    return Math.max(160, Math.floor(window.innerHeight * 0.3));
  });

  useEffect(() => {
    void (async () => {
      setPins(await readPins());
      setTagStore(await readTags());
    })();
  }, []);

  // Display mode is mostly CSS driven off <html data-display-mode>, but
  // Miller columns needs a different pane component, so App mirrors the mode
  // in state (updated via the event setDisplayMode fires in handlers/view.ts).
  const [displayMode, setDisplayModeState] = useState<string>(
    () => localStorage.getItem("glasshouse.displayMode") ?? "Details (rows)",
  );
  useEffect(() => {
    const h = (e: Event) => setDisplayModeState((e as CustomEvent<string>).detail);
    window.addEventListener("glasshouse:display-mode", h);
    return () => window.removeEventListener("glasshouse:display-mode", h);
  }, []);

  useEffect(() => {
    const slugify = (s: string) =>
      s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
    const mode = localStorage.getItem("glasshouse.displayMode");
    if (mode) document.documentElement.setAttribute("data-display-mode", slugify(mode));
    const layout = localStorage.getItem("glasshouse.layout");
    if (layout) {
      document.documentElement.setAttribute("data-layout", slugify(layout));
    }
    const zoom = localStorage.getItem("glasshouse.zoom");
    const zoomPx = zoom ? parseInt(zoom, 10) : NaN;
    if (Number.isFinite(zoomPx)) {
      document.documentElement.style.setProperty("--fs-base", `${zoomPx}px`);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      const home = await homeDir();
      const p = home ?? FALLBACK_PATH;
      setHomePath(home);
      setTabs([makeTab(p, { color: "var(--blue)" })]);
      if (home) {
        const remotesPath = joinPath(joinPath(home, ".glasshouse"), "remotes.json");
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
    const dir = joinPath(homePath, ".glasshouse");
    const file = joinPath(dir, "remotes.json");
    void (async () => {
      try { await ensureDir(dir); } catch { /* the write below reports it */ }
      try { await writeText(file, JSON.stringify(next, null, 2)); }
      catch (err) { console.error("remotes.json write failed:", err); }
    })();
  };

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", state.theme);
    document.documentElement.setAttribute("data-density", state.density);
    document.documentElement.setAttribute("data-scanlines", state.scanlines ? "on" : "off");
    document.documentElement.style.setProperty("--font-mono", state.font);
    localStorage.setItem("glasshouse.tweaks", JSON.stringify(state));
  }, [state]);

  // `glasshouse:set-theme` (detail: theme name) switches to a given theme;
  // the project site's demo uses it for its theme picker.
  useEffect(() => {
    const onSetTheme = (e: Event) => {
      const theme = (e as CustomEvent<unknown>).detail;
      if (typeof theme === "string" && theme) setState(prev => ({ ...prev, theme }));
    };
    window.addEventListener("glasshouse:set-theme", onSetTheme);
    return () => window.removeEventListener("glasshouse:set-theme", onSetTheme);
  }, []);

  const activeTabId = tabs[activeTab]?.id;
  const activeHandle: UseTabResult | undefined = activeTabId === undefined ? undefined : tabHandles[activeTabId];

  useEffect(() => {
    if (!activeHandle) return;
    if (activeHandle.state.showHidden !== state.hidden) {
      activeHandle.actions.setShowHidden(state.hidden);
    }
  }, [state.hidden, activeHandle]);

  // Mirror focusedPane to the html element so CSS can highlight the active
  // pane border. Effect runs whenever focusedPane changes.
  useEffect(() => {
    document.documentElement.setAttribute("data-focused-pane", focusedPane);
  }, [focusedPane]);

  useEffect(() => {
    document.documentElement.classList.toggle("no-status", !showStatusBar);
  }, [showStatusBar]);

  useEffect(() => {
    if (!activeHandle) return;
    const label = tabLabel(activeHandle.state.path, activeHandle.state.private);
    setTabs(prev => {
      if (prev[activeTab] && prev[activeTab].label !== label) {
        const next = [...prev];
        next[activeTab] = { ...next[activeTab], label };
        return next;
      }
      return prev;
    });
  }, [activeHandle?.state.path, activeHandle?.state.private, activeTab]);

  // Keep a ref to the latest handleMenuCommand so the keydown listener below
  // (which installs once) always dispatches through the current closure.
  const handleMenuCommandRef = useRef<(label: string) => void>(() => {});
  // Time of the Ctrl+G that opened a pending git chord; 0 when none.
  const gitChordAt = useRef(0);

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

      // ── Git chords (Ctrl+G then S / A / C / P, per the Git menu hints) ──
      // Checked first so the second key wins over its own binding, with or
      // without Ctrl still held (Ctrl+G Ctrl+P is Pull, not the palette). A
      // key that doesn't match cancels the chord and is swallowed, so a typo
      // after Ctrl+G can't fall through to Delete and friends.
      if (gitChordAt.current) {
        if (e.key === "Control" || e.key === "Meta" || e.key === "Shift" || e.key === "Alt") return;
        const live = Date.now() - gitChordAt.current < GIT_CHORD_MS;
        gitChordAt.current = 0;
        if (live && !inText) {
          e.preventDefault();
          const label = e.altKey || e.shiftKey ? undefined : GIT_CHORDS[e.key.toLowerCase()];
          if (label) dispatch(label);
          return;
        }
      }

      // ── Next / Prev Tab (Ctrl+Tab / Ctrl+Shift+Tab) ─────────────────────
      // Must run before the Tab/F6 pane-cycle handler below, otherwise the
      // pane-cycle preventDefaults Ctrl+Tab and our tab-cycle never fires.
      if ((e.ctrlKey || e.metaKey) && e.key === "Tab") {
        e.preventDefault();
        dispatch(e.shiftKey ? "Prev Tab" : "Next Tab");
        return;
      }

      // ── Pane cycling (Tab / Shift+Tab / F6 / Shift+F6) ──────────────────
      // Cycles major app panes rather than DOM-focusable controls: the spec
      // (Task #18) specifically rejects the webpage Tab-order behaviour.
      if (!inText && (e.key === "Tab" || e.key === "F6") && !e.ctrlKey && !e.metaKey) {
        // Pass through when xterm owns focus so its keybinds still work.
        const termDrawer = document.querySelector(".term-drawer");
        const termActive = focusedPane === "terminal" && !!termDrawer?.contains(e.target as Node);
        if (!termActive) {
          e.preventDefault();
          const PANES: FocusPaneId[] = (() => {
            const ps: FocusPaneId[] = [];
            if (showSidebar) ps.push("sidebar");
            ps.push("files");
            if (termOpen) ps.push("terminal");
            return ps;
          })();
          const delta = e.shiftKey ? -1 : 1;
          const idx = PANES.indexOf(focusedPane);
          const n = PANES.length;
          if (n > 0) {
            const next = PANES[((idx < 0 ? 0 : idx) + delta + n) % n];
            setFocusedPane(next);
            if (next === "sidebar") sidebarRootRef.current?.focus();
            else if (next === "files") {
              pane0RootRef.current?.focus();
            } else if (next === "terminal") {
              document.querySelector<HTMLElement>(".term-drawer .term-body")?.focus();
            }
          }
          return;
        }
      }

      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "p") {
        e.preventDefault(); setPalOpen(v => !v); return;
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "f") {
        e.preventDefault(); setShowFindModal(v => !v); return;
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "g") {
        e.preventDefault(); dispatch("Connect to Server…"); return;
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "v") {
        if (inText) return;
        e.preventDefault(); dispatch("Paste Special…"); return;
      }
      // Menu-advertised Ctrl+Shift bindings (audit: hints existed, keys didn't).
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey) {
        const k = e.key.toLowerCase();
        if (k === "n") { e.preventDefault(); dispatch("New Private Session"); return; }
        if (k === "p") { e.preventDefault(); dispatch("Batch Permissions…"); return; }
        if (!inText) {
          if (k === "e") { e.preventDefault(); dispatch("Open in VS Code"); return; }
          if (k === "r") { e.preventDefault(); dispatch("Bulk Rename…"); return; }
          if (k === "d") { e.preventDefault(); dispatch("Folder"); return; }
        }
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "`") {
        e.preventDefault();
        setTermOpen(v => !v);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === ",") {
        e.preventDefault(); setTweaksOpen(v => !v); return;
      }
      // Panel/layout toggles work even while a text input has focus — they
      // don't insert text and shouldn't die just because the path bar or a
      // search box is focused (VS Code treats Ctrl+B the same way).
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
        const k = e.key.toLowerCase();
        if (k === "b") { e.preventDefault(); dispatch("Sidebar"); return; }
        if (k === "j") { e.preventDefault(); dispatch("Inspector"); return; }
        if (k === "l") { e.preventDefault(); dispatch("Go to Path…"); return; }
        if (k === "[") { e.preventDefault(); dispatch("Previous Location"); return; }
        if (k === "]") { e.preventDefault(); dispatch("Next Location"); return; }
        if (k >= "1" && k <= "7") {
          const modes = ["Details (rows)", "Compact List", "Icons", "Tiles", "Grid (thumbs)", "Tree Flat", "Miller Columns (ranger)"];
          e.preventDefault(); dispatch(modes[Number(k) - 1]); return;
        }
      }
      if (e.key === "Escape") {
        setPalOpen(false); setCtx(null); setQuickLookOpen(false);
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

      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "g") {
        e.preventDefault(); gitChordAt.current = Date.now(); return;
      }

      // Space — Quick Look toggle for the selected file. defaultPrevented
      // means a focused widget (e.g. a sidebar group title) already consumed
      // the key for its own activation.
      if (e.key === " " && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
        if (e.defaultPrevented) return;
        if ((activeHandle?.state.selected.length ?? 0) > 0) {
          e.preventDefault();
          setQuickLookOpen(v => !v);
        }
        return;
      }

      // Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z — Undo / Redo. Routed through dispatch
      // so the misc.ts handler's undo/redo entry point handles both keyboard
      // and Edit menu paths uniformly.
      if ((e.ctrlKey || e.metaKey) && !e.altKey) {
        const k = e.key.toLowerCase();
        if (k === "z" && !e.shiftKey) { e.preventDefault(); dispatch("Undo"); return; }
        if ((k === "y" && !e.shiftKey) || (k === "z" && e.shiftKey)) {
          e.preventDefault(); dispatch("Redo"); return;
        }
      }

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
        if (k === "=" || k === "+") { e.preventDefault(); dispatch("Zoom In"); return; }
        if (k === "-" || k === "_") { e.preventDefault(); dispatch("Zoom Out"); return; }
        if (k === "0") { e.preventDefault(); dispatch("Reset Zoom"); return; }
        // Menu-advertised bindings (audit: hints existed, keys didn't).
        // Panel/layout toggles live above the inText guard; these are file
        // and selection ops, so they stay suppressed while typing.
        if (k === "o") { e.preventDefault(); dispatch("Open…"); return; }
        if (k === "n") { e.preventDefault(); dispatch("New Window"); return; }
        if (k === "i") { e.preventDefault(); dispatch("Invert Selection"); return; }
        if (k === "u") { e.preventDefault(); dispatch("Duplicate"); return; }
        if (k === "d") { e.preventDefault(); dispatch("Bookmark This Folder"); return; }
        if (e.key === "Home") { e.preventDefault(); dispatch("Home"); return; }
      }

      if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
        if (e.key === "ArrowLeft") { e.preventDefault(); dispatch("Back"); return; }
        if (e.key === "ArrowRight") { e.preventDefault(); dispatch("Forward"); return; }
        if (e.key === "ArrowUp") { e.preventDefault(); dispatch("Open Parent"); return; }
        if (e.key === "Enter") { e.preventDefault(); dispatch("Properties"); return; }
      }

      if (e.key === "F5") { e.preventDefault(); dispatch("Refresh"); return; }
      if (e.key === "F11") { e.preventDefault(); dispatch("Full Screen"); return; }
      if (e.key === "F3") { e.preventDefault(); dispatch("Tree + Pane + Inspector"); return; }
      if (e.key === "F7") { e.preventDefault(); dispatch("Single Pane"); return; }

      if (e.key === "F2") {
        e.preventDefault();
        const n = activeHandle?.state.selected.length ?? 0;
        dispatch(n > 1 ? "Bulk Rename…" : "Rename");
        return;
      }

      if (e.key === "F1" || ((e.ctrlKey || e.metaKey) && e.key === "?")) {
        e.preventDefault();
        setCheatsheetOpen(v => !v);
        return;
      }

      // F6 is handled above as pane-cycling — the prior "Move to…" binding
      // conflicted with the standard file-manager convention of F6 to switch
      // between panes. Use the palette or context menu for Move to…

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
  }, [activeHandle, focusedPane, showSidebar, showInspector, termOpen]);

  useEffect(() => {
    const h = (e: MouseEvent) => { e.preventDefault(); };
    document.addEventListener("contextmenu", h);
    return () => document.removeEventListener("contextmenu", h);
  }, []);

  const openNewTab = () => {
    const seed = activeHandle?.state.path ?? FALLBACK_PATH;
    setTabs(prev => [...prev, makeTab(seed)]);
  };

  // Each TabShell drops its own handle when it unmounts, so closing only
  // edits the list.
  const applyTabList = (next: { tabs: TabRecord[]; active: number }) => {
    setTabs(next.tabs);
    setActiveTab(next.active);
  };

  const closeTabAt = (i: number) => {
    applyTabList(closeTab({ tabs, active: activeTab }, i, homePath ?? FALLBACK_PATH));
  };

  const duplicateTabAt = (i: number) => {
    const t = tabs[i];
    if (!t) return;
    // Prefer the live path of that tab's handle if available.
    const live = tabHandles[t.id]?.state.path ?? t.initialPath;
    setTabs(prev => [...prev, makeTab(live, { private: t.private })]);
  };

  const closeOtherTabsAt = (keep: number) => {
    applyTabList(closeOtherTabs({ tabs, active: activeTab }, keep));
  };

  const openPathInNewTab = (p: string, isPrivate: boolean = false) => {
    setTabs(prev => [...prev, makeTab(p, { private: isPrivate })]);
  };

  useEffect(() => {
    registerTabListMutator({
      moveTab: (from, to) => {
        applyTabList(moveTabIn({ tabs, active: activeTab }, from, to));
      },
      newTab: (path, opts) => {
        const p = path ?? activeHandle?.state.path ?? FALLBACK_PATH;
        openPathInNewTab(p, !!opts?.private);
        setActiveTab(tabs.length);
      },
    });
    return () => registerTabListMutator(null);
  }, [tabs, activeTab, activeHandle]);

  const runUndoStep = async (which: "undo" | "redo") => {
    const r = await (which === "undo" ? undoLast() : redoLast());
    if (r.status === "empty") {
      dialogs.showToast({ message: `nothing to ${which}`, variant: "info" });
      return;
    }
    // Refresh on failure too: a multi-item step can fail partway.
    activeHandle?.actions.refresh();
    if (r.status === "done") {
      dialogs.showToast({ message: `${which === "undo" ? "undid" : "redid"}: ${r.label}`, variant: "success" });
    } else {
      const msg = r.error instanceof Error ? r.error.message : String(r.error);
      void dialogs.showAlert({
        title: `${which} failed`,
        message: `${r.label}: ${msg}\n\nThis step was removed from the ${which} history.`,
        variant: "error",
      });
    }
  };

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
      } else if (ctxT.kind === "sidebar" && ctxT.rowKind === "remote" && ctxT.path) {
        const host = ctxT.path;
        switch (label) {
          case "Connect": {
            contextTarget = null;
            const r = savedRemotes.find(x => x.host === host);
            if (!r) return;
            setTermProfile(sshProfileFor(r));
            setTermOpen(true);
            void dialogs.showToast({ message: `connecting to ${r.label}…`, variant: "info" });
            return;
          }
          case "Edit…": {
            contextTarget = null;
            setManageRemotesOpen(true);
            return;
          }
          case "Remove": {
            contextTarget = null;
            const idx = savedRemotes.findIndex(x => x.host === host);
            if (idx < 0) return;
            const r = savedRemotes[idx];
            void (async () => {
              const ok = await dialogs.showConfirm({
                title: "remove remote",
                message: `Remove "${r.label}"?`,
                danger: true,
                okLabel: "remove",
              });
              if (!ok) return;
              persistRemotes(savedRemotes.filter((_, i) => i !== idx));
            })();
            return;
          }
          case "Manage Remotes…":
            contextTarget = null;
            setManageRemotesOpen(true);
            return;
        }
      } else if ((ctxT.kind === "sidebar" || ctxT.kind === "breadcrumb") && ctxT.path) {
        const target = ctxT.path;
        switch (label) {
          case "Open":
            contextTarget = null;
            activeHandle?.actions.goTo(target); return;
          case "Open in New Tab":
            contextTarget = null;
            openPathInNewTab(target); return;
          case "Open in New Window":
            contextTarget = null;
            openPathInNewTab(target); return;
          case "Open in Terminal":
            contextTarget = null;
            void spawnTerminal(target); return;
          case "Open in VS Code":
            contextTarget = null;
            void (async () => {
              try { await spawnVscodeStrict(target); }
              catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                void dialogs.showAlert({ title: "open in VS Code failed", variant: "error", message: msg });
              }
            })();
            return;
          case "Copy Path":
            contextTarget = null;
            void navigator.clipboard.writeText(target); return;
          case "Copy as WSL Path":
          case "Copy Path (WSL)":
            contextTarget = null;
            void (async () => {
              let wsl = "";
              try { wsl = await winToWsl(target); } catch { wsl = ""; }
              if (!wsl) wsl = winPathToWsl(target);
              await navigator.clipboard.writeText(wsl);
            })();
            return;
          case "Copy as Command":
            contextTarget = null;
            void navigator.clipboard.writeText(`cd ${JSON.stringify(target)}`);
            return;
          case "Reveal in Explorer":
            contextTarget = null;
            void revealInExplorer(target); return;
          case "Rename": {
            contextTarget = null;
            const base = basename(target);
            void (async () => {
              const dir = parentPath(target);
              // An unreadable folder still gets a prompt; the rename reports it.
              const taken = await namesIn(dir).catch(() => new NameSet([], IS_WINDOWS));
              const next = await dialogs.showPrompt({
                title: "rename",
                message: `rename "${base}" to:`,
                initialValue: base,
                placeholder: "new name",
                validate: (v) => nameProblem(v, taken, base),
                submit: (v) => unlessTaken(v, async () => { if (v !== base) await renameEntry(target, joinPath(dir, v)); }),
              });
              if (!next || next === base) return;
              const dst = joinPath(dir, next);
              try {
                pushUndo(moveUndo(`rename ${base} → ${next}`, [{ src: target, dst }], "rename"));
                activeHandle?.actions.refresh();
              } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                void dialogs.showAlert({ message: `rename failed: ${msg}`, variant: "error" });
              }
            })();
            return;
          }
          case "Move to…": {
            contextTarget = null;
            void (async () => {
              const home = await homeDir();
              setFolderPicker({
                initialPath: home ?? undefined,
                title: `move "${basename(target)}" to…`,
                onPick: (to) => {
                  setFolderPicker(null);
                  void (async () => {
                    const res = await runTransfer([{ path: target }], to, "move", transferDeps);
                    if (!res) return;
                    pushTransferUndo(res, "move", `move ${basename(target)} to ${to}`);
                    reportTransfer(res, "move", true);
                    activeHandle?.actions.refresh();
                  })();
                },
              });
            })();
            return;
          }
          case "Move to Trash": {
            contextTarget = null;
            void (async () => {
              try {
                await moveToTrash(target);
                activeHandle?.actions.refresh();
              } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                void dialogs.showAlert({ message: `trash failed: ${msg}`, variant: "error" });
              }
            })();
            return;
          }
          case "Pin": {
            contextTarget = null;
            if (pins.includes(target)) return;
            const next = [...pins, target];
            setPins(next);
            void writePins(next);
            return;
          }
          case "Properties": {
            // Previously fell through to the pane-selection handler, so the
            // dialog showed whatever was selected in the pane instead of the
            // sidebar/breadcrumb row that was right-clicked.
            contextTarget = null;
            void (async () => {
              const siblings = await listDir(parentPath(target), true);
              const norm = normalizePath(target);
              const entry = siblings.find(e => normalizePath(e.path) === norm) ?? {
                name: basename(target) || target,
                path: target,
                kind: "folder",
                size: 0,
                modified_ms: 0,
                hidden: false,
                ext: "",
                is_symlink: false,
                lossy: false,
                git: null,
              };
              setPropsEntry(entry);
            })();
            return;
          }
          case "Add Tag…":
            contextTarget = null;
            setTagPickerPath(target);
            return;
          case "Unpin": {
            contextTarget = null;
            if (!pins.includes(target)) return;
            const next = pins.filter(p => p !== target);
            setPins(next);
            void writePins(next);
            return;
          }
          case "Move pin up":
          case "Move pin down": {
            contextTarget = null;
            const idx = pins.indexOf(target);
            if (idx < 0) return;
            const dst = label === "Move pin up" ? idx - 1 : idx + 1;
            if (dst < 0 || dst >= pins.length) return;
            const next = [...pins];
            [next[idx], next[dst]] = [next[dst], next[idx]];
            setPins(next);
            void writePins(next);
            return;
          }
        }
      }
    }
    switch (label) {
      case "Toggle Drawer": {
        setTermOpen(v => !v);
        return;
      }
      case "Command Palette":
        setPalOpen(v => !v); return;
      case "Keybindings Cheatsheet":
        setCheatsheetOpen(true); return;
      case "Find in Files":
        setShowFindModal(true); return;
      case "Tweaks":
      case "Preferences…":
        setTweaksOpen(v => !v); return;
      case "Manage Bookmarks…":
        setBookmarkManagerOpen(true); return;
      case "Manage Remotes…":
        setManageRemotesOpen(true); return;
      case "Connect to Server…":
        setConnectOpen(true); return;
      case "New Tab":
        openNewTab(); return;
      case "New Terminal Tab":
        // Drawer owns tab state; open it and signal it to add a tab.
        setTermOpen(true);
        window.dispatchEvent(new Event("glasshouse:term-new-tab"));
        return;
      case "Close Tab":
        closeTabAt(activeTab); return;
      case "Close Other Tabs":
        // File-menu path; the tab context-menu variant passes ctxT.tabIndex.
        closeOtherTabsAt(activeTab); return;
      case "Home":
        void (async () => {
          const h = await homeDir();
          if (h) activeHandle?.actions.goTo(h);
        })();
        return;
      case "Quit":
        void winClose(); return;
      case "Full Screen":
        void winToggleMaximize(); return;
      case "Refresh":
        activeHandle?.actions.refresh(); return;
      case "Back":
        activeHandle?.actions.back(); return;
      case "Forward":
        activeHandle?.actions.forward(); return;
      case "Up":
      case "Open Parent":
        activeHandle?.actions.up(); return;
      case "Toggle Hidden Files":
      case "Show Hidden Files":
        setState(prev => ({ ...prev, hidden: !prev.hidden })); return;
      case "Inspector":
        setShowInspector(v => !v); return;
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

    // Entries whose on-disk name isn't valid UTF-8 carry a lossy rendering of
    // the real path — any mutating op would target a path that doesn't exist
    // (or worse). Refuse with an actionable message instead.
    // MUTATING_LABELS is derived from the `mutates` flags in data.ts.
    if (MUTATING_LABELS.has(label) && st.selected.some(i => st.entries[i]?.lossy)) {
      void dialogs.showAlert({
        title: "invalid filename encoding",
        variant: "error",
        message:
          "The selected entry's on-disk name isn't valid UTF-8, so it can't be " +
          "addressed safely from here. Rename it in a terminal first (tab-completion " +
          "will match the raw bytes).",
      });
      return;
    }

    try {
      switch (label) {
        case "Open": {
          if (!firstEntry) return;
          if (firstEntry.kind === "folder") activeHandle.actions.goTo(firstEntry.path);
          else await openWithDefault(firstEntry.path);
          return;
        }
        case "Add Bookmark": {
          const targets = selectedPaths.length > 0
            ? selectedPaths
            : (firstPath ? [firstPath] : []);
          if (targets.length === 0) {
            dialogs.showToast({ message: "no selection", variant: "info" });
            return;
          }
          const next = [...pins];
          const added: string[] = [];
          for (const p of targets) {
            if (!next.includes(p)) {
              next.push(p);
              added.push(p);
            }
          }
          if (added.length === 0) {
            dialogs.showToast({ message: "already pinned", variant: "info" });
            return;
          }
          setPins(next);
          void writePins(next);
          const msg = added.length === 1
            ? `pinned ${basename(added[0])}`
            : `pinned ${added.length} items`;
          dialogs.showToast({ message: msg, variant: "success" });
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
          // The entry's own folder: search results can live outside cwd.
          const src = firstEntry.path;
          const dir = parentPath(src);
          const taken = await namesIn(dir);
          const next = await dialogs.showPrompt({
            title: "rename",
            message: `rename "${firstEntry.name}" to:`,
            initialValue: firstEntry.name,
            placeholder: "new name",
            validate: (v) => nameProblem(v, taken, firstEntry.name),
            submit: (v) => unlessTaken(v, async () => { if (v !== firstEntry.name) await renameEntry(src, joinPath(dir, v)); }),
          });
          if (!next || next === firstEntry.name) return;
          const dst = joinPath(dir, next);
          pushUndo(moveUndo(`rename ${firstEntry.name} → ${next}`, [{ src, dst }], "rename"));
          refresh();
          return;
        }
        case "Bulk Rename…": {
          const items: BulkRenameItem[] = st.selected
            .map(i => st.entries[i])
            .filter((e): e is FileEntry => !!e)
            .map(e => ({ path: e.path, name: e.name }));
          if (items.length === 0) return;
          setBulkRenameItems(items);
          return;
        }
        case "Delete Permanently": {
          if (selectedPaths.length === 0) return;
          const ok = await dialogs.showConfirm({
            title: "delete permanently",
            message: `Permanently delete ${selectedPaths.length} item(s)? This cannot be undone.`,
            danger: true,
            okLabel: "delete",
          });
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
            const ok = await dialogs.showConfirm({
              title: "move to trash",
              message: `Move ${selectedPaths.length} items to ${IS_WINDOWS ? "Recycle Bin" : "Trash"}?`,
              okLabel: "move",
            });
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
          setCutPaths([]);
          dialogs.showToast({ message: `copied ${selectedPaths.length} item(s)`, variant: "info" });
          return;
        }
        case "Cut": {
          if (selectedPaths.length === 0) return;
          const kinds = st.selected
            .map(i => st.entries[i]?.kind ?? "file")
            .filter((_, idx) => Boolean(st.entries[st.selected[idx]]?.path));
          appClipboard = { op: "cut", paths: selectedPaths, kinds };
          setCutPaths(selectedPaths);
          dialogs.showToast({ message: `cut ${selectedPaths.length} item(s)`, variant: "info" });
          return;
        }
        case "Paste": {
          if (!appClipboard || appClipboard.paths.length === 0) {
            dialogs.showToast({ message: "clipboard is empty", variant: "info" });
            return;
          }
          const { op, paths, kinds } = appClipboard;
          const xop: TransferOp = op === "copy" ? "copy" : "move";
          const res = await runTransfer(asItems(paths, kinds), cwd, xop, transferDeps);
          if (!res) return;
          pushTransferUndo(res, xop, `${op === "copy" ? "paste copy" : "paste move"} ${res.done.length} item(s)`);
          if (op === "cut" && res.done.length > 0 && res.failed.length === 0) {
            appClipboard = null;
            setCutPaths([]);
          }
          refresh();
          reportTransfer(res, xop);
          return;
        }
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
          const taken = await namesIn(cwd);
          const name = await dialogs.showPrompt({
            title: "new folder",
            message: "folder name:",
            initialValue: freeNewName("new-folder", true, taken.has),
            placeholder: "folder-name",
            validate: (v) => nameProblem(v, taken),
            submit: (v) => unlessTaken(v, () => makeDir(joinPath(cwd, v))),
          });
          if (!name) return;
          const dst = joinPath(cwd, name);
          pushUndo(createUndo(`new folder ${name}`, dst, { kind: "folder" }));
          refresh();
          return;
        }
        case "Text File": {
          const taken = await namesIn(cwd);
          const name = await dialogs.showPrompt({
            title: "new text file",
            message: "file name:",
            initialValue: freeNewName("untitled.txt", false, taken.has),
            placeholder: "name.txt",
            validate: (v) => nameProblem(v, taken),
            submit: (v) => unlessTaken(v, () => createTextFile(joinPath(cwd, v), "")),
          });
          if (!name) return;
          const dst = joinPath(cwd, name);
          pushUndo(createUndo(`new file ${name}`, dst, { kind: "file", content: "" }));
          refresh();
          return;
        }
        case "Markdown Note": {
          const taken = await namesIn(cwd);
          const name = await dialogs.showPrompt({
            title: "new markdown note",
            message: "note name:",
            initialValue: freeNewName("note.md", false, taken.has),
            placeholder: "note.md",
            validate: (v) => nameProblem(v, taken),
            submit: (v) => unlessTaken(v, () => createTextFile(joinPath(cwd, v), "")),
          });
          if (!name) return;
          const dst = joinPath(cwd, name);
          pushUndo(createUndo(`new note ${name}`, dst, { kind: "file", content: "" }));
          refresh();
          return;
        }
        case "Script (.sh)": {
          const script = "#!/usr/bin/env bash\n";
          const taken = await namesIn(cwd);
          const name = await dialogs.showPrompt({
            title: "new shell script",
            message: "script name:",
            initialValue: freeNewName("script.sh", false, taken.has),
            placeholder: "script.sh",
            validate: (v) => nameProblem(v, taken),
            submit: (v) => unlessTaken(v, () => createTextFile(joinPath(cwd, v), script)),
          });
          if (!name) return;
          const dst = joinPath(cwd, name);
          pushUndo(createUndo(`new script ${name}`, dst, { kind: "file", content: script }));
          refresh();
          return;
        }
        case "Duplicate": {
          if (selectedPaths.length === 0) return;
          // Each item is copied next to itself, so it always gets a free
          // "(copy)" name. Group by folder: search results can span several.
          const byDir = new Map<string, TransferItem[]>();
          for (const i of st.selected) {
            const e = st.entries[i];
            if (!e?.path) continue;
            const dir = parentPath(e.path);
            byDir.set(dir, [...(byDir.get(dir) ?? []), { path: e.path, isDir: e.kind === "folder" }]);
          }
          const res: TransferResult = { done: [], replaced: [], skipped: [], failed: [] };
          for (const [dir, items] of byDir) {
            const r = await runTransfer(items, dir, "copy", transferDeps);
            if (!r) continue;
            res.done.push(...r.done);
            res.replaced.push(...r.replaced);
            res.skipped.push(...r.skipped);
            res.failed.push(...r.failed);
          }
          pushTransferUndo(res, "copy", `duplicate ${res.done.length} item(s)`);
          refresh();
          reportTransfer(res, "copy", true);
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
            void dialogs.showAlert({
              title: "open in VS Code failed",
              variant: "error",
              message: `${msg}\n\nMake sure "code" is on PATH (install Shell Command from VS Code's command palette).`,
            });
          }
          return;
        }
        case "Reveal in Explorer": {
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
          if (!wsl) wsl = winPathToWsl(firstPath);
          await navigator.clipboard.writeText(wsl);
          return;
        }
        case "Add Tag…": {
          if (!firstPath) return;
          setTagPickerPath(firstPath);
          return;
        }
        case "Remove Tag…": {
          if (!firstPath) return;
          const existing = tagStore[firstPath] ?? [];
          if (existing.length === 0) return;
          const raw = await dialogs.showPrompt({
            title: "remove tag",
            message: `Remove which tag? (current: ${existing.join(", ")})`,
            initialValue: existing[0],
            placeholder: "tag",
            validate: (v) => existing.includes(v.trim()) ? null : `not a current tag`,
          });
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
        case "Clear All Tags": {
          const targets = selectedPaths.length > 0
            ? selectedPaths
            : (firstPath ? [firstPath] : []);
          const tagged = targets.filter(p => (tagStore[p]?.length ?? 0) > 0);
          if (tagged.length === 0) {
            dialogs.showToast({ message: "no tagged items in selection", variant: "info" });
            return;
          }
          const ok = await dialogs.showConfirm({
            title: "Remove all tags",
            message: `Remove all tags from ${tagged.length} item(s)?`,
            danger: true,
            okLabel: "remove",
          });
          if (!ok) return;
          setTagStore(prev => {
            const next = { ...prev };
            for (const p of tagged) delete next[p];
            void writeTags(next);
            return next;
          });
          refresh();
          return;
        }
        case "Compress to ZIP…": {
          // Use the current multi-selection; if empty, fall back to a single
          // firstPath if one exists (e.g. chip-only context with one active).
          const active: string[] = selectedPaths.length > 0
            ? selectedPaths
            : (firstPath ? [firstPath] : []);
          if (active.length === 0) return;
          const baseName = basename(active[0]) || "archive";
          const defaultName = `${baseName}.zip`;
          const entered = await dialogs.showPrompt({
            title: "compress to ZIP",
            message: "output archive name:",
            initialValue: defaultName,
            placeholder: "archive.zip",
            validate: (v) => v.trim() ? null : "name required",
          });
          if (entered === null) return;
          let name = entered.trim();
          if (!name) return;
          if (!/\.zip$/i.test(name)) name += ".zip";
          const outPath = joinPath(cwd, name);
          try {
            await compress(active, outPath);
            refresh();
            dialogs.showToast({ message: `compressed to ${name}`, variant: "success" });
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error("compress failed:", msg);
            void dialogs.showAlert({ title: "compress failed", variant: "error", message: msg });
          }
          return;
        }
        case "Checksum SHA256":
        case "Checksum (SHA256)": {
          if (!firstPath) return;
          try {
            const hex = await hashSha256(firstPath);
            try { await navigator.clipboard.writeText(hex); } catch { /* clipboard unavailable */ }
            dialogs.showToast({ message: `sha256 copied: ${hex.slice(0, 16)}…`, variant: "success" });
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error("hash_sha256 failed:", msg);
            void dialogs.showAlert({ title: "hash failed", variant: "error", message: msg });
          }
          return;
        }
        case "Move to…": {
          if (selectedPaths.length === 0) return;
          const home = await homeDir();
          const initial = cwd || home || undefined;
          const paths = [...selectedPaths];
          const items: TransferItem[] = st.selected
            .map(i => st.entries[i])
            .filter((e): e is FileEntry => Boolean(e?.path))
            .map(e => ({ path: e.path, isDir: e.kind === "folder" }));
          setFolderPicker({
            initialPath: initial,
            title: paths.length === 1
              ? `move "${basename(paths[0])}" to…`
              : `move ${paths.length} items to…`,
            onPick: (target) => {
              setFolderPicker(null);
              void (async () => {
                const res = await runTransfer(items, target, "move", transferDeps);
                if (!res) return;
                pushTransferUndo(res, "move", `move ${res.done.length} item(s) to ${target}`);
                if (res.done.length > 0) refresh();
                reportTransfer(res, "move");
              })();
            },
          });
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
          const ok = await dialogs.showConfirm({
            title: "discard changes",
            message: `Discard local changes for ${targets.length} item(s)? This cannot be undone.`,
            danger: true,
            okLabel: "discard",
          });
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
            void dialogs.showAlert({ title: "git blame failed", variant: "error", message: msg });
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
            openAbout: () => setAboutOpen(true),
            toggleSidebar: () => setShowSidebar(v => !v),
            toggleStatusBar: () => setShowStatusBar(v => !v),
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
            setDiffView,
            setGitOutput,
            clipboardPaths: () => appClipboard?.paths ?? [],
            pushUndo,
            undo: () => { void runUndoStep("undo"); },
            redo: () => { void runUndoStep("redo"); },
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
          // Give the user visible feedback instead of silent no-op. Task #13
          // is specifically about this — don't let palette commands vanish.
          console.warn("menu command not wired:", label);
          dialogs.showToast({
            message: `"${label}" — not yet wired`,
            variant: "warning",
          });
          return;
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("file op failed", label, err);
      void dialogs.showAlert({ title: "error", variant: "error", message: msg });
    }
  }

  const handleMenuPayload = (payload: DynamicPayload) => {
    if (payload.type === "open-path") {
      activeHandle?.actions.goTo(payload.path);
      return;
    }
    if (payload.type === "run-profile") {
      setTermProfile(payload.profile);
      setTermOpen(true);
      return;
    }
  };

  const openCtxMenu = (e: React.MouseEvent, items: MenuItemDef[]) => {
    // Raw cursor coords — ContextMenu measures itself and clamps into view.
    setCtx({ x: e.clientX, y: e.clientY, items });
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
      // Extract only makes sense for a single archive the backend can unpack.
      const extractEligible =
        selCount === 1 && !!firstEntry &&
        firstEntry.kind !== "folder" && canExtractArchive(firstEntry.name);
      if (!extractEligible) {
        items = items.filter(it => !(it.kind === "sub" && it.label === "Extract →"));
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

  const onSidebarContext = (e: React.MouseEvent, path: string, rowKind: SidebarRowKind) => {
    contextTarget = { kind: "sidebar", path, rowKind };
    let menu: MenuItemDef[];
    switch (rowKind) {
      case "pinned": {
        // Previously this rendered the stub CONTEXT_SIDEBAR_PINNED. Users
        // expect the full folder right-click here (most pins are folders)
        // plus pin-management — inject Unpin on top, reorder items next,
        // then the usual folder body (stripping the inner "Pin" entry
        // since the row is already pinned).
        const idx = pins.indexOf(path);
        const reorder: MenuItemDef[] = [];
        if (idx > 0) reorder.push({ kind: "item", ic: "", label: "Move pin up" });
        if (idx >= 0 && idx < pins.length - 1) reorder.push({ kind: "item", ic: "", label: "Move pin down" });
        menu = [
          { kind: "item", ic: "", label: "Unpin" },
          ...reorder,
          { kind: "sep" },
          ...CONTEXT_SIDEBAR_FOLDER.filter(it => !(it.kind === "item" && it.label === "Pin")),
        ];
        break;
      }
      case "tree-file":
        // Extract dispatches on the pane selection, not the sidebar path —
        // hide it here so it can't act on the wrong file.
        menu = CONTEXT_FILE.filter(it => !(it.kind === "sub" && it.label === "Extract →"));
        break;
      case "tree-folder":
        menu = CONTEXT_SIDEBAR_FOLDER;
        break;
      case "drive":
        menu = CONTEXT_SIDEBAR_DRIVE;
        break;
      case "remote":
        menu = CONTEXT_SIDEBAR_REMOTE;
        break;
      case "wsl":
      default:
        menu = CONTEXT_SIDEBAR;
        break;
    }
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

  const selectedForInspector = activeHandle?.state.selected ?? [];
  const selectedFile = liveRows[selectedForInspector[0]] ?? null;

  const totalBytes = liveRows.reduce((acc, r) => acc + (r.kind === "folder" ? 0 : r.entry.size), 0);
  const totalSize = formatBytes(totalBytes, false);

  const currentCwd = activeHandle?.state.path ?? "";
  // Feed cwd into the module-level ref used by loadDynamic's "git-branches"
  // case so the Git > Branches submenu resolves against the active tab.
  useEffect(() => {
    setDynamicGitCwd(currentCwd);
  }, [currentCwd]);

  // Resolve a sidebar drop path from the drop point. Returns null when the
  // cursor is not on a drop-target sidebar row.
  const resolveSidebarDrop = (clientX: number, clientY: number): string | null => {
    const hit = document.elementFromPoint(clientX, clientY);
    const row = hit?.closest("[data-sidebar-drop-path]") as HTMLElement | null;
    return row?.getAttribute("data-sidebar-drop-path") ?? null;
  };

  // Perform a move-or-copy of paths into dstDir, with undo and a refresh.
  const performDrop = (
    srcPaths: string[],
    dstDir: string,
    copy: boolean,
    refresh: () => void,
  ) => {
    if (srcPaths.length === 0 || !dstDir) return;
    const op: TransferOp = copy ? "copy" : "move";
    void (async () => {
      const res = await runTransfer(asItems(srcPaths), dstDir, op, transferDeps);
      if (!res) return;
      pushTransferUndo(res, op, `${op} ${res.done.length} item(s) to ${dstDir}`);
      reportTransfer(res, op, true);
      refresh();
    })();
  };

  const renderActivePane = () => {
    const handle = activeHandle;
    const rows: LiveFileRow[] = handle
      ? handle.state.entries.map(e => entryToRow(e, tagStore))
      : [];
    const sel = handle?.state.selected ?? [];
    if (displayMode === "Miller Columns (ranger)") {
      return (
        <MillerView
          cwd={handle?.state.path ?? ""}
          entries={handle?.state.entries ?? []}
          showHidden={handle?.state.showHidden ?? false}
          focusIndex={handle?.state.focusIndex ?? 0}
          setFocusIndex={handle?.actions.setFocusIndex ?? (() => {})}
          setSelected={handle?.actions.setSelected ?? (() => {})}
          onNavigate={(p) => handle?.actions.goTo(p)}
          onOpenFile={(p) => { void openWithDefault(p); }}
          onActivate={() => setFocusedPane("files")}
          error={handle?.state.error ?? null}
        />
      );
    }
    return (
      <FilePane
        cutPaths={cutPaths}
        error={handle?.state.error ?? null}
        loading={handle?.state.loading ?? false}
        paneRootRef={pane0RootRef}
        onActivate={() => setFocusedPane("files")}
        files={rows}
        selected={sel}
        setSelected={handle?.actions.setSelected ?? (() => {})}
        focusIndex={handle?.state.focusIndex ?? 0}
        setFocusIndex={handle?.actions.setFocusIndex ?? (() => {})}
        anchorIndex={handle?.state.anchorIndex ?? 0}
        setAnchorIndex={handle?.actions.setAnchorIndex ?? (() => {})}
        paneFocused={paneFocused}
        setPaneFocused={setPaneFocused}
        sortKey={handle?.state.sortKey ?? "name"}
        sortDir={handle?.state.sortDir ?? "asc"}
        foldersFirst={state.foldersFirst}
        showExtensions={state.showExtensions}
        showGitGutters={state.showGitGutters}
        onSortChange={(k) => {
          if (!handle) return;
          if (handle.state.sortKey === k) {
            handle.actions.setSortDir(handle.state.sortDir === "asc" ? "desc" : "asc");
          } else {
            handle.actions.setSortKey(k);
            handle.actions.setSortDir("asc");
          }
        }}
        onContext={onContext}
        searchQuery={searchQuery}
        tagFilter={handle?.state.tagFilter ?? null}
        tagStore={tagStore}
        onOpen={(i) => {
          const row = rows[i];
          if (!row) return;
          if (row.entry.kind === "folder") {
            handle?.actions.goTo(row.entry.path);
          } else {
            void openWithDefault(row.entry.path);
          }
        }}
        onUp={() => handle?.actions.up()}
        onCopy={() => handleMenuCommandRef.current("Copy")}
        onCut={() => handleMenuCommandRef.current("Cut")}
        onDelete={(permanent) => handleMenuCommandRef.current(permanent ? "Delete Permanently" : "Move to Trash")}
        onRowDrop={(targetOrigIndex, sourceOrigIndices, copy) => {
          const target = rows[targetOrigIndex];
          if (!target || target.entry.kind !== "folder") return;
          const sources = sourceOrigIndices
            .map(i => rows[i]?.entry.path)
            .filter((p): p is string => !!p);
          performDrop(sources, target.entry.path, copy, () => handle?.actions.refresh());
        }}
        onExternalDrag={(sourceOrigIndices, x, y, copy) => {
          const sources = sourceOrigIndices
            .map(i => rows[i]?.entry.path)
            .filter((p): p is string => !!p);
          if (sources.length === 0) return;
          const dstDir = resolveSidebarDrop(x, y);
          if (!dstDir) return;
          performDrop(sources, dstDir, copy, () => handle?.actions.refresh());
        }}
      />
    );
  };

  return (
    <div className="app">
      {tabs.map(t => (
        <TabShell
          key={t.id}
          id={t.id}
          initialPath={t.initialPath}
          isPrivate={t.private}
          onReady={(id, r) => setTabHandles(prev => {
            if (r) return prev[id] === r ? prev : { ...prev, [id]: r };
            if (!(id in prev)) return prev;
            const next = { ...prev };
            delete next[id];
            return next;
          })}
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
      <Menubar
        onOpenPalette={() => setPalOpen(true)}
        onCommand={handleMenuCommand}
        onPayload={handleMenuPayload}
        toggles={{ tweaks: state, sidebarVisible: showSidebar, statusBarVisible: showStatusBar, inspectorVisible: showInspector }}
      />
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
      <div className={"body" + (showSidebar ? "" : " no-sidebar") + (showInspector ? "" : " no-inspector")}>
        {showSidebar && <Sidebar
          sidebarRootRef={sidebarRootRef}
          onActivate={() => setFocusedPane("sidebar")}
          activePath={activeHandle?.state.path ?? ""}
          onGoTo={(p) => activeHandle?.actions.goTo(p)}
          onRowContext={onSidebarContext}
          pins={pins}
          onAddPin={() => {
            const p = activeHandle?.state.path;
            if (!p) {
              dialogs.showToast({ message: "no active folder to pin", variant: "info" });
              return;
            }
            if (pins.includes(p)) {
              dialogs.showToast({ message: `already pinned: ${basename(p) || p}`, variant: "info" });
              return;
            }
            const next = [...pins, p];
            setPins(next);
            void writePins(next);
            dialogs.showToast({ message: `pinned ${basename(p) || p}`, variant: "success" });
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
            setTermProfile(sshProfileFor(r));
            setTermOpen(true);
            void dialogs.showToast({ message: `connecting to ${r.label}…`, variant: "info" });
          }}
          onPickTreeRoot={(initialPath, onPicked) => {
            setFolderPicker({
              initialPath,
              title: "change tree root…",
              onPick: (p) => {
                setFolderPicker(null);
                onPicked(p);
              },
            });
          }}
        />}
        {renderActivePane()}
        {showInspector && (
          <Inspector
            file={selectedFile}
            onExpand={() => setQuickLookOpen(true)}
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
                      void dialogs.showAlert({
                        title: "git blame failed",
                        message: msg,
                        variant: "error",
                      });
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
      <TerminalDrawer
        open={termOpen}
        cwd={activeHandle?.state.path ?? ""}
        profile={termProfile}
        height={termHeight}
        onHeightChange={setTermHeight}
        onClose={() => setTermOpen(false)}
      />
      <StatusBar
        selectedCount={selectedForInspector.length}
        totalCount={liveRows.length}
        totalSize={totalSize}
        path={activeHandle?.state.path ?? ""}
        gitInfo={activeHandle?.state.gitInfo ?? null}
        onToggleTerm={() => setTermOpen(v => !v)}
      />

      {palOpen && <Palette onClose={() => setPalOpen(false)} onCommand={handleMenuCommand} />}
      {ctx && <ContextMenu items={ctx.items} x={ctx.x} y={ctx.y} onClose={() => setCtx(null)} onCommand={handleMenuCommand} onPayload={handleMenuPayload} />}
      {quickLookOpen && selectedFile && (
        <QuickLook file={selectedFile} onClose={() => setQuickLookOpen(false)} />
      )}
      {tweaksOpen && <Tweaks state={state} setState={setState} onClose={() => setTweaksOpen(false)} />}
      {blame && <BlameDialog blame={blame} onClose={() => setBlame(null)} />}
      {gitOutput && <GitOutputDialog state={gitOutput} onClose={() => setGitOutput(null)} />}
      {diffView && <DiffDialog a={diffView.a} b={diffView.b} diff={diffView.diff} onClose={() => setDiffView(null)} />}
      {showFindModal && (
        <FindInFilesModal
          root={activeHandle?.state.path ?? ""}
          onClose={() => setShowFindModal(false)}
          onPick={(m) => {
            const dir = parentPath(m.path);
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
          listNames={listNames}
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
          trashEntry={moveToTrash}
          planTransfer={(items, dstDir, op) => planTransfer(items, dstDir, op, transferDeps)}
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
      {manageRemotesOpen && (
        <ManageRemotesDialog
          remotes={savedRemotes}
          onClose={() => setManageRemotesOpen(false)}
          onRemove={(idx) => persistRemotes(savedRemotes.filter((_, i) => i !== idx))}
          onEdit={(idx, next) => persistRemotes(savedRemotes.map((r, i) => i === idx ? next : r))}
          onAdd={() => setConnectOpen(true)}
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
      {bookmarkManagerOpen && (
        <BookmarkManagerDialog
          pins={pins}
          onClose={() => setBookmarkManagerOpen(false)}
          onSave={(nextPins) => {
            setPins(nextPins);
            void writePins(nextPins);
            setBookmarkManagerOpen(false);
            dialogs.showToast({ message: `saved ${nextPins.length} bookmark${nextPins.length === 1 ? "" : "s"}`, variant: "success" });
          }}
          onGoTo={(p) => activeHandle?.actions.goTo(p)}
        />
      )}
      <PropertiesDialog entry={propsEntry} onClose={() => setPropsEntry(null)} />
      <AboutDialog open={aboutOpen} onClose={() => setAboutOpen(false)} />
      <KeybindingsDialog open={cheatsheetOpen} onClose={() => setCheatsheetOpen(false)} />

      {folderPicker && (
        <FolderPickerDialog
          initialPath={folderPicker.initialPath}
          title={folderPicker.title}
          onClose={() => setFolderPicker(null)}
          onPick={folderPicker.onPick}
        />
      )}
      <DialogHost />
      <NoticesHost />

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
