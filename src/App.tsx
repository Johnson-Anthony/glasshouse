import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import {
  Titlebar,
  Toolbar,
  FilePane,
  StatusBar,
  Palette,
  Tweaks,
  formatDate,
  type TweakState,
  type ContextKind,
} from "./components";
import { BulkRenameDialog, type BulkRenameItem } from "./dialogs/BulkRename";
import { PasteSpecialDialog, type PasteSpecialItem } from "./dialogs/PasteSpecial";
import { BlameDialog } from "./dialogs/Blame";
import { GitOutputDialog, type GitOutputState } from "./dialogs/GitOutput";
import { DiffDialog } from "./dialogs/Diff";
import { ConnectServerDialog } from "./dialogs/ConnectServer";
import { ManageRemotesDialog } from "./dialogs/ManageRemotes";
import { TagPickerDialog } from "./dialogs/TagPicker";
import { PropertiesDialog } from "./dialogs/Properties";
import { AboutDialog } from "./dialogs/About";
import { KeybindingsDialog } from "./dialogs/Keybindings";
import { DialogHost, dialogs } from "./dialogs/DialogHost";
import { OpsTray } from "./OpsTray";
import { isCancelled, newOpId } from "./ops";
import { FolderPickerDialog } from "./dialogs/FolderPicker";
import { BookmarkManagerDialog } from "./dialogs/BookmarkManager";
import { TrashDialog } from "./dialogs/Trash";
import { useEscapeClose } from "./dialogs/useEscapeClose";
import { Inspector, type InspectableFile } from "./preview/Inspector";
import { QuickLook } from "./preview/FilePreview";
import { Sidebar, type SavedRemote, type SidebarRowKind } from "./Sidebar";
import { Menubar, ContextMenu, setDynamicGitCwd } from "./menus";
import { CONTEXT_FILE, CONTEXT_EMPTY, CONTEXT_SIDEBAR, CONTEXT_SIDEBAR_FOLDER, CONTEXT_SIDEBAR_FILE, CONTEXT_SIDEBAR_DRIVE, CONTEXT_SIDEBAR_REMOTE, CONTEXT_TAB, CONTEXT_BREADCRUMB, GIT_CHORDS, type MenuItemDef, type DynamicPayload, type FileKind, type GitStatus } from "./data";
import {
  useTabState,
  undoLast,
  redoLast,
  registerTabListMutator,
  newTab as stateNewTab,
  type UseTabResult,
} from "./state";
import { COMMAND_CHAIN, type HandlerCtx } from "./handlers";
import { cmdState } from "./commandState";
import { sshProfileFor } from "./remotes";
import { findBinding, type KeyAction } from "./keymap";
import { isModalOpen, useModal } from "./dialogs/modal";
import { makeTab, closeTab, closeOtherTabs, moveTab as moveTabIn, tabLabel, type TabRecord } from "./tabs";
import { canExtractArchive } from "./handlers/archive";
import { showBlame } from "./handlers/helpers";
import { DISPLAY_MODE_DEFAULT, DISPLAY_MODE_KEY, LAYOUT_KEY, slugify, storedZoom } from "./handlers/view";
import { IS_WINDOWS } from "./platform";
import { NoticesHost } from "./NoticesScreen";
import { MillerView, sortView as millerOrder } from "./Miller";
import { viewRows } from "./viewRows";
import { joinPath, parentPath, basename } from "./paths";
import {
  homeDir,
  ensureDir,
  renameEntry,
  moveEntry,
  openWithDefault,
  startDragOut,
  spawnVscode,
  moveToTrash,
  trashDir,
  writeText,
  readPins,
  writePins,
  readTags,
  readText,
  findInFiles,
  cancelOp,
  type FileEntry,
  type BlameLine,
  type FindMatch,
  type ShellProfile,
} from "./api";
import { runTransfer, planTransfer, type TransferOp } from "./transfer";
import { transferDeps, reportTransfer, pushTransferUndo, asItems, listNames } from "./transferUi";
import { errText } from "./errors";
import { findStatusText } from "./findStatus";
import { dropTargetAt, notAlreadyIn } from "./dragDrop";
import { OsDrop } from "./OsDrop";

// xterm is most of the terminal's weight, so the drawer is its own chunk,
// loaded the first time the terminal opens.
const TerminalDrawer = lazy(() => import("./Terminal").then(m => ({ default: m.TerminalDrawer })));

const TWEAK_DEFAULTS: TweakState = {
  theme: "gruvbox-dark",
  font: '"JetBrainsMono Nerd Font", "JetBrains Mono", ui-monospace, monospace',
  density: "default",
  scanlines: false,
  hidden: false,
  showExtensions: true,
  showGitGutters: true,
  foldersFirst: true,
  termFollow: true,
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

  useEscapeClose(onClose);
  useModal();

  useEffect(() => {
    if (!query.trim()) {
      // A search still running for the old query is cancelled by the
      // cleanup below, and a stale search never clears busy itself.
      setMatches([]);
      setRan(false);
      setBusy(false);
      return;
    }
    const q = query;
    const cs = caseSensitive;
    // Each new query cancels the search for the previous one, so a slow
    // stale search neither keeps running nor lands on top of a newer one.
    const opId = newOpId();
    let stale = false;
    let running = false;
    const t = window.setTimeout(() => {
      setBusy(true);
      running = true;
      void (async () => {
        try {
          const res = await findInFiles(root, q, !cs, 500, opId);
          if (stale) return;
          setMatches(res);
          setRan(true);
        } catch (e) {
          if (stale || isCancelled(e)) return;
          setMatches([]);
          setRan(true);
        } finally {
          running = false;
          if (!stale) setBusy(false);
        }
      })();
    }, 250);
    return () => {
      stale = true;
      window.clearTimeout(t);
      if (running) void cancelOp(opId);
    };
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
            {findStatusText(query, busy, ran, matches.length)}
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

function normalizeGit(flag: string | null | undefined): GitStatus | null {
  if (!flag) return null;
  if (flag === "M" || flag === "A" || flag === "D" || flag === "U" || flag === "?") {
    return flag;
  }
  return null;
}

function entryToRow(
  e: FileEntry,
  tagStore: Record<string, string[]>,
): InspectableFile {
  const kind = kindFromEntry(e.kind);
  // A folder's name is shown whole: `list_dir` gives `foo.d` the extension
  // "d", but it isn't one, and the pane never draws a folder's extension.
  const ext = kind === "folder" ? "" : e.ext;
  const nameNoExt = ext && e.name.toLowerCase().endsWith("." + ext.toLowerCase())
    ? e.name.slice(0, -(ext.length + 1))
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
    ext,
    link: e.is_symlink,
    entry: e,
  };
}

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
  const [trashOpen, setTrashOpen] = useState(false);
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
  // Set for good the first time the drawer is wanted; it stays mounted after
  // that, so closing it keeps its shells.
  const termWanted = useRef(false);
  termWanted.current ||= termOpen || termProfile !== null;
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

  const savePins = (next: string[]) => {
    setPins(next);
    void writePins(next);
  };

  // Display mode is mostly CSS driven off <html data-display-mode>, but
  // Miller columns needs a different pane component, so App mirrors the mode
  // in state (updated via the event setDisplayMode fires in handlers/view.ts).
  const [displayMode, setDisplayModeState] = useState<string>(
    () => localStorage.getItem(DISPLAY_MODE_KEY) ?? DISPLAY_MODE_DEFAULT,
  );
  useEffect(() => {
    const h = (e: Event) => setDisplayModeState((e as CustomEvent<string>).detail);
    window.addEventListener("glasshouse:display-mode", h);
    return () => window.removeEventListener("glasshouse:display-mode", h);
  }, []);

  useEffect(() => {
    const mode = localStorage.getItem(DISPLAY_MODE_KEY);
    if (mode) document.documentElement.setAttribute("data-display-mode", slugify(mode));
    const layout = localStorage.getItem(LAYOUT_KEY);
    if (layout) {
      document.documentElement.setAttribute("data-layout", slugify(layout));
    }
    const zoomPx = storedZoom();
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

  // The keymap's App-local actions (bindings that aren't commands).
  const runKeyAction = (a: KeyAction) => {
    switch (a) {
      case "palette": setPalOpen(v => !v); return;
      case "findInFiles": setShowFindModal(v => !v); return;
      case "terminal": setTermOpen(v => !v); return;
      case "tweaks": setTweaksOpen(v => !v); return;
      case "cheatsheet": setCheatsheetOpen(v => !v); return;
      case "focusSearch":
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
        return;
      case "gitChord": gitChordAt.current = Date.now(); return;
      case "quickLook": setQuickLookOpen(v => !v); return;
    }
  };

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
      // A modal dialog owns the keyboard: nothing here acts behind it.
      if (isModalOpen()) return;

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

      // Escape closes overlays without consuming the key. A dismissed context
      // menu's target goes too, so a later key can't act on it.
      if (e.key === "Escape") {
        setPalOpen(false); setCtx(null); setQuickLookOpen(false);
        cmdState.contextTarget = null;
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

      // Everything else is in the keymap (src/keymap.ts).
      const b = findBinding(e, {
        inText,
        selected: activeHandle?.state.selected.length ?? 0,
        sidebar: !!sidebarRootRef.current?.contains(e.target as Node),
        textSelected: !!window.getSelection()?.toString(),
      });
      if (!b) return;
      e.preventDefault();
      // Keys act on the pane, never on an open context menu's target.
      setCtx(null);
      cmdState.contextTarget = null;
      if (b.send) dispatch(b.send);
      else if (b.run) runKeyAction(b.run);
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
    if (r.status === "irreversible") {
      dialogs.showToast({ message: `can't undo ${r.label}, or anything before it`, variant: "warning" });
      return;
    }
    // Refresh on failure too: a multi-item step can fail partway.
    activeHandle?.actions.refresh();
    if (r.status === "done") {
      dialogs.showToast({ message: `${which === "undo" ? "undid" : "redid"}: ${r.label}`, variant: "success" });
    } else {
      const msg = errText(r.error);
      void dialogs.showAlert({
        title: `${which} failed`,
        message: `${r.label}: ${msg}\n\nThis step was removed from the ${which} history.`,
        variant: "error",
      });
    }
  };
  // Command routing: a label goes through COMMAND_CHAIN (handlers/index.ts)
  // and the first handler that takes it wins. A handler that returns a plain
  // boolean runs synchronously, so the context-menu and app handlers act
  // within the click or keypress. See
  // docs/decisions/2026-11-10-split-big-files-app-routing.md.
  const buildCtx = (): HandlerCtx => {
    const st = activeHandle?.state;
    const selectedPaths = st
      ? st.selected.map(i => st.entries[i]?.path).filter((p): p is string => Boolean(p))
      : [];
    const firstEntry: FileEntry | undefined = st?.entries[st.selected[0]];
    const firstPath = firstEntry?.path;
    const cwd = st?.path ?? "";
    const refresh = activeHandle ? activeHandle.actions.refresh : () => {};
    return {
      activeHandle,
      cwd,
      selectedPaths,
      firstPath,
      firstEntry,
      visibleRows: () => {
        if (!st) return [];
        if (displayMode === "Miller Columns (ranger)") return millerOrder(st.entries).map(v => v.orig);
        return viewRows(liveRows, {
          searchQuery: st.searchQuery, tagFilter: st.tagFilter, tagStore,
          sortKey: st.sortKey, sortDir: st.sortDir, foldersFirst: state.foldersFirst,
        }).map(r => r.origIndex);
      },
      dispatch: (l: string) => handleMenuCommandRef.current(l),
      openAbout: () => setAboutOpen(true),
      toggleSidebar: () => setShowSidebar(v => !v),
      toggleStatusBar: () => setShowStatusBar(v => !v),
      pinPath: (p: string) => {
        if (pins.includes(p)) return;
        savePins([...pins, p]);
      },
      tabs,
      activeTab,
      setActiveTab,
      setBlame,
      setDiffView,
      setGitOutput,
      clipboardPaths: () => cmdState.clipboard?.paths ?? [],
      undo: () => { void runUndoStep("undo"); },
      redo: () => { void runUndoStep("redo"); },
      newTab: stateNewTab,
      refresh,
      tweaks: state,
      setTweaks: setState,
      app: {
        activeTab,
        closeOtherTabsAt,
        closeTabAt,
        duplicateTabAt,
        openNewTab,
        openPathInNewTab,
        persistRemotes,
        pins,
        savePins,
        savedRemotes,
        setBlame,
        setBookmarkManagerOpen,
        setBulkRenameItems,
        setCheatsheetOpen,
        setConnectOpen,
        setCutPaths,
        setFolderPicker,
        setManageRemotesOpen,
        setPalOpen,
        setPasteSpecial,
        setPropsEntry,
        setShowFindModal,
        setShowInspector,
        setState,
        setTagPickerPath,
        setTagStore,
        setTermOpen,
        setTermProfile,
        setTrashOpen,
        setTweaksOpen,
        state,
        tagStore,
      },
    };
  };

  const handleMenuCommand = (label: string) => {
    void runCommand(label);
  };

  async function runCommand(label: string) {
    const ctx = buildCtx();
    try {
      for (const h of COMMAND_CHAIN) {
        const r = h(label, ctx);
        if (typeof r === "boolean" ? r : await r) return;
      }
      // Give the user visible feedback instead of silent no-op. Task #13
      // is specifically about this — don't let palette commands vanish.
      console.warn("menu command not wired:", label);
      dialogs.showToast({
        message: `"${label}" — not yet wired`,
        variant: "warning",
      });
    } catch (err) {
      const msg = errText(err);
      console.error("file op failed", label, err);
      void dialogs.showAlert({ title: "error", variant: "error", message: msg });
    }
  }
  handleMenuCommandRef.current = handleMenuCommand;

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
    cmdState.contextTarget = null;
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
    cmdState.contextTarget = { kind: "sidebar", path, rowKind };
    let menu: MenuItemDef[];
    switch (rowKind) {
      case "pinned":
      case "pinned-file": {
        // Previously this rendered a four-item stub menu. Users
        // expect the full folder right-click here (most pins are folders)
        // plus pin-management — inject Unpin on top, reorder items next,
        // then the usual folder body (stripping the inner "Pin" entry
        // since the row is already pinned).
        const idx = pins.indexOf(path);
        const reorder: MenuItemDef[] = [];
        if (idx > 0) reorder.push({ kind: "item", ic: "", label: "Move pin up" });
        if (idx >= 0 && idx < pins.length - 1) reorder.push({ kind: "item", ic: "", label: "Move pin down" });
        const body = rowKind === "pinned-file" ? CONTEXT_SIDEBAR_FILE : CONTEXT_SIDEBAR_FOLDER;
        menu = [
          { kind: "item", ic: "", label: "Unpin" },
          ...reorder,
          { kind: "sep" },
          ...body.filter(it => !(it.kind === "item" && it.label === "Pin")),
        ];
        break;
      }
      case "tree-file":
        // Its own menu: every item runs on this path (handlers/target.ts).
        menu = CONTEXT_SIDEBAR_FILE;
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
    cmdState.contextTarget = { kind: "tab", tabIndex };
    openCtxMenu(e, CONTEXT_TAB);
  };

  const onCrumbContext = (e: React.MouseEvent, path: string) => {
    cmdState.contextTarget = { kind: "breadcrumb", path };
    openCtxMenu(e, CONTEXT_BREADCRUMB);
  };

  const liveRows: InspectableFile[] = useMemo(() => {
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
    // Memoised: a new array on every App render made FilePane re-filter and
    // re-sort, re-render every row, and scroll back to the focused row.
    const rows = liveRows;
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
        dropPath={handle?.state.path}
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
        searchQuery={handle?.state.searchQuery ?? ""}
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
          // A tab, a breadcrumb segment, a sidebar row, or the pane outside
          // a folder row (its own folder, where nothing needs to move).
          const target = dropTargetAt(x, y);
          const moving = target ? notAlreadyIn(sources, target.path) : [];
          if (target && moving.length > 0) performDrop(moving, target.path, copy, () => handle?.actions.refresh());
        }}
        onDragOut={(sourceOrigIndices) => {
          const paths = sourceOrigIndices
            .map(i => rows[i]?.entry.path)
            .filter((p): p is string => !!p);
          startDragOut(paths).catch(e => dialogs.showToast({ message: `couldn't drag out: ${errText(e)}`, variant: "error" }));
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
        tabPaths={tabs.map(t => tabHandles[t.id]?.state.path)}
      />
      <OsDrop onDrop={(paths, dir) => performDrop(paths, dir, true, () => activeHandle?.actions.refresh())} />
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
        searchQuery={activeHandle?.state.searchQuery ?? ""}
        onSearchChange={(q) => activeHandle?.actions.setSearchQuery(q)}
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
          onOpenFile={(p) => { void openWithDefault(p); }}
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
            savePins([...pins, p]);
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
                  void showBlame(path, setBlame);
                  return;
                case "compress":
                  handleMenuCommandRef.current("Compress to ZIP…");
                  return;
              }
            }}
          />
        )}
      </div>
      {termWanted.current && (
        <Suspense fallback={null}>
          <TerminalDrawer
            open={termOpen}
            cwd={activeHandle?.state.path ?? ""}
            profile={termProfile}
            follow={state.termFollow}
            height={termHeight}
            onHeightChange={setTermHeight}
            onClose={() => setTermOpen(false)}
          />
        </Suspense>
      )}
      <StatusBar
        selectedCount={selectedForInspector.length}
        totalCount={liveRows.length}
        totalSize={totalSize}
        path={activeHandle?.state.path ?? ""}
        gitInfo={activeHandle?.state.gitInfo ?? null}
        onToggleTerm={() => setTermOpen(v => !v)}
      />

      {palOpen && <Palette onClose={() => setPalOpen(false)} onCommand={handleMenuCommand} />}
      {ctx && <ContextMenu items={ctx.items} x={ctx.x} y={ctx.y} onClose={() => { setCtx(null); cmdState.contextTarget = null; }} onCommand={handleMenuCommand} onPayload={handleMenuPayload} />}
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
          copyEntry={transferDeps.copy}
          moveEntry={moveEntry}
          trashEntry={async p => { await moveToTrash(p); }}
          planTransfer={(items, dstDir, op) => planTransfer(items, dstDir, op, transferDeps)}
          onClose={() => setPasteSpecial(null)}
          onDone={(clear) => {
            if (clear) cmdState.clipboard = null;
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
      {trashOpen && (
        <TrashDialog
          onClose={() => setTrashOpen(false)}
          onChanged={() => activeHandle?.actions.refresh()}
          onBrowseFolder={IS_WINDOWS ? undefined : () => {
            setTrashOpen(false);
            void trashDir().then(dir => {
              if (dir) activeHandle?.actions.goTo(dir);
              else void dialogs.showAlert({ title: "Navigation", message: "trash folder unavailable" });
            });
          }}
        />
      )}
      {bookmarkManagerOpen && (
        <BookmarkManagerDialog
          pins={pins}
          onClose={() => setBookmarkManagerOpen(false)}
          onSave={(nextPins) => {
            savePins(nextPins);
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
      <OpsTray />
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
