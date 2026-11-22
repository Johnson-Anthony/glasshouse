import { lazy, Suspense, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import {
  Titlebar,
  TabStrip,
  Toolbar,
  FilePane,
  Palette,
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
import { UpdateDialog } from "./dialogs/Update";
import { KeybindingsDialog } from "./dialogs/Keybindings";
import { PreferencesDialog } from "./dialogs/Preferences";
import { DialogHost, dialogs } from "./dialogs/DialogHost";
import { GitDialogHost } from "./dialogs/GitDialogs";
import { OpsTray } from "./OpsTray";
import { isCancelled, newOpId } from "./ops";
import { FolderPickerDialog } from "./dialogs/FolderPicker";
import { BookmarkManagerDialog } from "./dialogs/BookmarkManager";
import { TrashDialog } from "./dialogs/Trash";
import { useEscapeClose } from "./dialogs/useEscapeClose";
import { Inspector, type InspectableFile } from "./preview/Inspector";
import { QuickLook } from "./preview/FilePreview";
import { Sidebar, loadTagSet, type SavedRemote, type SidebarRowKind } from "./Sidebar";
import { StatusBar } from "./StatusBar";
import { STATUS_DEFAULTS, loadStatusItems } from "./statusItems";
import { firstRunPins, mergePins } from "./places";
import { Menubar, ContextMenu, setDynamicGitCwd, type MenuToggleState } from "./menus";
import { CONTEXT_FILE, CONTEXT_EMPTY, CONTEXT_SIDEBAR, CONTEXT_SIDEBAR_FOLDER, CONTEXT_SIDEBAR_FILE, CONTEXT_SIDEBAR_DRIVE, CONTEXT_SIDEBAR_REMOTE, CONTEXT_TAB, CONTEXT_BREADCRUMB, GIT_CHORDS, OTHER_PANE_LABELS, type MenuItemDef, type DynamicPayload } from "./data";
import {
  undoLast,
  redoLast,
  newTab as stateNewTab,
  type UseTabResult,
} from "./state";
import { COMMAND_CHAIN, type HandlerCtx } from "./handlers";
import type { PaneCommands } from "./handlers/types";
import { cmdState } from "./commandState";
import { sshProfileFor } from "./remotes";
import { findBinding, gitChord, GIT_CHORD_MS, type KeyAction } from "./keymap";
import type { MenuAnchor } from "./menuNav";
import { isModalOpen, useModal } from "./dialogs/modal";
import { useAutoUpdateCheck } from "./updates";
import { makeTab } from "./tabs";
import { DEFAULT_SORT, loadSession, restoreSession, sessionFrom, type Session } from "./session";
import { listenHere } from "./events";
import { useSharedSetting } from "./useSharedSetting";
import { closeSplit, isSplit, layoutFromSession, setDir, setRatio, single, splitWithNew, swapPanes, tabCount, type SplitDir } from "./tabLayout";
import { parseTransfer, recordFromTransfer } from "./tabTransfer";
import { useTabLayout } from "./useTabLayout";
import { useTabMoves } from "./tabMoves";
import { launchPlan } from "./launch";
import { canExtractArchive } from "./handlers/archive";
import { revealPath, showBlame } from "./handlers/helpers";
import { DISPLAY_MODE_DEFAULT, DISPLAY_MODE_KEY, LAYOUT_KEY, slugify } from "./handlers/view";
import { applyZoom, validZoom, ZOOM_DEFAULT } from "./zoom";
import { LOOK_DEFAULTS, migrateLook } from "./look";
import { useLook } from "./useLook";
import { IS_WINDOWS } from "./platform";
import { NoticesHost } from "./NoticesScreen";
import { MillerView } from "./Miller";
import { viewRows } from "./viewRows";
import { entryToRow, formatBytes } from "./rows";
import { basename, normalizePath } from "./paths";
import { launchApp, openFile, withOpenWithPath } from "./openWith";
import {
  homeDir,
  startDragOut,
  spawnVscodeStrict,
  trashDir,
  readSavedPins,
  writePins,
  readRemotes,
  writeRemotes,
  findInFiles,
  cancelOp,
  windowStart,
  type FileEntry,
  type BlameLine,
  type FindMatch,
  type ShellProfile,
  type UpdateAvailable,
} from "./api";
import { runTransfer, planTransfer, type TransferOp } from "./transfer";
import { loadTags, movePath, reloadTags, renamePath, setTags, trashPath, useTags } from "./tags";
import { transferDeps, reportTransfer, pushTransferUndo, asItems, listNames } from "./transferUi";
import { errText } from "./errors";
import { logWarn } from "./log";
import { showError } from "./errorDialog";
import { findStatusText } from "./findStatus";
import { dropPaths, dropTargetAt, swallowHandOffClicks } from "./dragDrop";
import { OsDrop } from "./OsDrop";

// xterm is most of the terminal's weight, so the drawer is its own chunk,
// loaded the first time the terminal opens.
const TerminalDrawer = lazy(() => import("./Terminal").then(m => ({ default: m.TerminalDrawer })));

const TWEAK_DEFAULTS: TweakState = {
  ...LOOK_DEFAULTS,
  hidden: false,
  showExtensions: true,
  showGitGutters: true,
  foldersFirst: true,
  termFollow: true,
  zoom: ZOOM_DEFAULT,
  showSidebar: true,
  showInspector: true,
  showStatusBar: true,
  statusItems: [...STATUS_DEFAULTS],
  tagSet: "standard",
  autoUpdate: false,
};

/** The settings as saved under `glasshouse.tweaks`, with defaults for what
 *  they don't say. Throws on a value that isn't JSON. */
function readTweaks(raw: string | null): TweakState {
  const saved = JSON.parse(raw || "null");
  return saved ? {
    ...TWEAK_DEFAULTS, ...saved, ...migrateLook(saved), zoom: validZoom(saved.zoom),
    // Only a saved false hides a panel.
    showSidebar: saved.showSidebar !== false,
    showInspector: saved.showInspector !== false,
    showStatusBar: saved.showStatusBar !== false,
    statusItems: loadStatusItems(saved),
    tagSet: loadTagSet(saved),
  } : TWEAK_DEFAULTS;
}

type PanelKey = "showSidebar" | "showInspector" | "showStatusBar";

/** A panel's show/hide setter, writing the saved setting. */
function panelSetter(setState: Dispatch<SetStateAction<TweakState>>, key: PanelKey): Dispatch<SetStateAction<boolean>> {
  return v => setState(prev => ({ ...prev, [key]: typeof v === "function" ? v(prev[key]) : v }));
}

interface CtxState {
  x: number;
  y: number;
  items: MenuItemDef[];
  keyboard?: boolean;
}

const FALLBACK_PATH = IS_WINDOWS ? "C:\\" : "/";

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

export function App() {
  // No saved settings: a new user. The look, the status bar, the tags and
  // the pins start differently for one (places.ts), and saved settings
  // without a newer setting keep what they showed before it.
  const [firstRun] = useState(() => {
    try { return localStorage.getItem("glasshouse.tweaks") === null; } catch { return false; }
  });
  const [state, setState] = useState<TweakState>(() => {
    try { return readTweaks(localStorage.getItem("glasshouse.tweaks")); } catch { return TWEAK_DEFAULTS; }
  });

  const [palOpen, setPalOpen] = useState(false);
  const [ctx, setCtx] = useState<CtxState | null>(null);
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [quickLookOpen, setQuickLookOpen] = useState(false);
  // Saved with the settings; View → Sidebar, Inspector and Status Bar.
  const { showInspector, showSidebar, showStatusBar } = state;
  const setShowInspector = panelSetter(setState, "showInspector");
  const setShowSidebar = panelSetter(setState, "showSidebar");
  const setShowStatusBar = panelSetter(setState, "showStatusBar");

  // Which file pane has the keyboard focus (split view has two).
  const [paneFocused, setPaneFocused] = useState<number | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Focused-pane for keyboard nav (Tab / F6). "files" is the default; cycles
  // through sidebar → files → inspector → terminal (if open). Rendered via
  // html[data-focused-pane] attribute so CSS can draw the active-pane outline.
  type FocusPaneId = "sidebar" | "files" | "inspector" | "terminal";
  const [focusedPane, setFocusedPane] = useState<FocusPaneId>("files");
  const pane0RootRef = useRef<HTMLElement | null>(null);
  const pane1RootRef = useRef<HTMLElement | null>(null);
  const paneRootRefs = [pane0RootRef, pane1RootRef];
  const sidebarRootRef = useRef<HTMLElement | null>(null);

  // Mirror of appClipboard's "cut" paths — React state so FilePane re-renders
  // the dimmed `.clip-cut` rows. Cleared after Paste or when Copy replaces the
  // clipboard contents.
  const [cutPaths, setCutPaths] = useState<string[]>([]);
  const [pins, setPins] = useState<string[]>([]);
  // The tag store (tags.ts): renames, moves and the trash keep it current.
  const tagStore = useTags();
  const setTagStore = setTags;
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
  // Help → Check for Updates; `found` is what the automatic check found.
  const [updates, setUpdates] = useState<{ found: UpdateAvailable | null } | null>(null);
  const [cheatsheetOpen, setCheatsheetOpen] = useState(false);
  const [homePath, setHomePath] = useState<string | null>(null);
  // The tabs, in one pane or two (useTabLayout.ts); `tabs`, `activeTab` and
  // `activeHandle` are the focused pane's.
  const tabLayout = useTabLayout(() => homePath ?? FALLBACK_PATH, state.hidden);
  const {
    layout, handles: tabHandles, tabs, activeTab, activeHandle, setActiveTab,
    openNewTab, closeTabAt, duplicateTabAt, closeOtherTabsAt, openPathInNewTab,
  } = tabLayout;
  const tabMoves = useTabMoves(tabLayout);
  const split = isSplit(layout);
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

  const pinsRef = useRef(pins);
  pinsRef.current = pins;
  useEffect(() => {
    void (async () => {
      const saved = await readSavedPins();
      setPins(saved ?? []);
      await loadTags();
      // A first run with no pins file: the known folders and the desktop's
      // bookmarks, before any pin added meanwhile.
      if (saved !== null || !firstRun) return;
      const seeded = await firstRunPins();
      if (seeded.length === 0) return;
      const next = mergePins(seeded, pinsRef.current);
      setPins(next);
      void writePins(next);
    })();
  }, []);

  const savePins = (next: string[]) => {
    setPins(next);
    void writePins(next);
  };

  // Display mode is mostly CSS driven off <html data-display-mode>, but
  // Miller columns wraps the pane in more columns, so App mirrors the mode
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
    // 0.2 kept the zoom here, as a font size only the Inspector followed;
    // it's now `zoom` in the tweaks.
    localStorage.removeItem("glasshouse.zoom");
  }, []);

  // What a window another app asked for still has to select, by tab id,
  // and whose Properties to show once it's selected (launch.ts).
  const launchPending = useRef<{ reveals: Map<number, string[]>; properties: string | null }>({ reveals: new Map(), properties: null });
  useEffect(() => {
    const pending = launchPending.current;
    for (const [id, paths] of pending.reveals) {
      const h = tabHandles[id];
      if (!h) continue;
      pending.reveals.delete(id);
      void revealPath(h, paths).then(r => {
        if (r !== "selected" && pending.properties && paths.includes(pending.properties)) pending.properties = null;
      });
    }
    const want = pending.properties;
    if (!want || pending.reveals.size > 0) return;
    for (const h of Object.values(tabHandles)) {
      const entry = h.state.selected.map(i => h.state.entries[i]).find(e => e && normalizePath(e.path) === normalizePath(want));
      if (entry) {
        pending.properties = null;
        setPropsEntry(entry);
        return;
      }
    }
  }, [tabHandles]);

  useEffect(() => {
    void (async () => {
      const [home, { owner, start: opened }] = await Promise.all([homeDir(), windowStart()]);
      const p = home ?? FALLBACK_PATH;
      setHomePath(home);
      // A tab moved out of another window (tabMoves.ts): it, with its
      // history and filters.
      const moved = opened.kind === "transfer" ? parseTransfer(opened.tab) : null;
      if (moved) {
        tabLayout.start(single([recordFromTransfer(moved)]), owner);
        await loadRemotes();
        return;
      }
      // A window opened with paths opens them; a restored one (or one whose
      // page loaded again) its tabs; the first one before there's a session
      // file the v1 key's (session.ts); any other, home.
      const plan = opened.kind === "launch" ? await launchPlan(opened.launch) : null;
      const saved = opened.kind === "restore" ? sessionFrom(opened.session) : opened.kind === "legacy" ? loadSession() : null;
      const start: Session = plan?.tabs.length
        ? { tabs: plan.tabs.map(t => ({ path: t.path, sort: DEFAULT_SORT })), active: 0 }
        : saved ? await restoreSession(saved, p) : { tabs: [{ path: p, sort: DEFAULT_SORT }], active: 0 };
      const records = start.tabs.map((t, i) => makeTab(t.path, { color: i === 0 ? "var(--blue)" : undefined, sort: t.sort }));
      if (plan) {
        plan.tabs.forEach((t, i) => { if (t.select.length > 0) launchPending.current.reveals.set(records[i].id, t.select); });
        launchPending.current.properties = plan.properties;
        if (plan.problems.length > 0) dialogs.showToast({ message: `couldn't open ${plan.problems.join("; ")}`, variant: "warning" });
      }
      tabLayout.start(layoutFromSession(start, (_, i) => records[i]), owner);
      await loadRemotes();
    })();
  }, []);

  const loadRemotes = async () => {
    try {
      const valid = (await readRemotes()).filter((r): r is SavedRemote =>
        !!r && typeof r === "object" &&
        typeof (r as SavedRemote).label === "string" &&
        typeof (r as SavedRemote).host === "string" &&
        typeof (r as SavedRemote).path === "string",
      );
      setSavedRemotes(valid);
    } catch { /* unreadable or malformed: start empty */ }
  };

  // Another window saved its pins, tags or remotes: read them again.
  useEffect(() => {
    let live = true;
    let off: (() => void) | undefined;
    void listenHere<string>("config-changed", e => {
      if (e.payload === "pins") void readSavedPins().then(saved => { if (saved) setPins(saved); });
      else if (e.payload === "tags") void reloadTags();
      else if (e.payload === "remotes") void loadRemotes();
    }).then(u => { if (live) off = u; else u(); }, () => { /* no Tauri */ });
    return () => { live = false; off?.(); };
  }, []);

  const persistRemotes = (next: SavedRemote[]) => {
    setSavedRemotes(next);
    writeRemotes(next).catch(err => console.error("saving remotes failed:", err));
  };

  // The theme (System: the OS's light or dark pick), fonts, chrome and
  // file-list style, as attributes on <html> (look.ts), and the window's
  // theme to match.
  useLook(state);
  useEffect(() => {
    applyZoom(state.zoom);
  }, [state.zoom]);
  // Saved, and the same in every window.
  useSharedSetting("glasshouse.tweaks", state, setState, readTweaks);

  // Preferences → Updates: off unless the user turned it on.
  useAutoUpdateCheck(state.autoUpdate, found => {
    dialogs.showToast({
      message: `glasshouse ${found.version} is out.`,
      variant: "info",
      timeout: 20_000,
      action: { label: "what's new", run: () => setUpdates({ found }) },
    });
  });

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

  // Mirror focusedPane to the html element so CSS can highlight the active
  // pane border. Effect runs whenever focusedPane changes.
  useEffect(() => {
    document.documentElement.setAttribute("data-focused-pane", focusedPane);
  }, [focusedPane]);

  useEffect(() => {
    document.documentElement.classList.toggle("no-status", !showStatusBar);
  }, [showStatusBar]);

  // Keep a ref to the latest handleMenuCommand so the keydown listener below
  // (which installs once) always dispatches through the current closure.
  const handleMenuCommandRef = useRef<(label: string) => void>(() => {});

  // The keymap's App-local actions (bindings that aren't commands).
  const runKeyAction = (a: KeyAction) => {
    switch (a) {
      case "palette": setPalOpen(v => !v); return;
      case "findInFiles": setShowFindModal(v => !v); return;
      case "terminal": setTermOpen(v => !v); return;
      case "cheatsheet": setCheatsheetOpen(v => !v); return;
      case "focusSearch":
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
        return;
      case "gitChord": gitChord.at = Date.now(); return;
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
      if (gitChord.at) {
        if (e.key === "Control" || e.key === "Meta" || e.key === "Shift" || e.key === "Alt") return;
        const live = Date.now() - gitChord.at < GIT_CHORD_MS;
        gitChord.at = 0;
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
          // Split view's two file panes are two stops.
          const PANES: { id: FocusPaneId; pane?: number }[] = (() => {
            const ps: { id: FocusPaneId; pane?: number }[] = [];
            if (showSidebar) ps.push({ id: "sidebar" });
            layout.panes.forEach((_, pane) => ps.push({ id: "files", pane }));
            if (termOpen) ps.push({ id: "terminal" });
            return ps;
          })();
          const delta = e.shiftKey ? -1 : 1;
          const idx = PANES.findIndex(x => x.id === focusedPane && (x.id !== "files" || x.pane === layout.focus));
          const n = PANES.length;
          if (n > 0) {
            const next = PANES[((idx < 0 ? 0 : idx) + delta + n) % n];
            setFocusedPane(next.id);
            if (next.id === "sidebar") sidebarRootRef.current?.focus();
            else if (next.id === "files") {
              tabLayout.focusPane(next.pane ?? 0);
              paneRootRefs[next.pane ?? 0].current?.focus();
            } else if (next.id === "terminal") {
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
  }, [activeHandle, focusedPane, showSidebar, showInspector, termOpen, layout]);

  useEffect(() => {
    const h = (e: MouseEvent) => { e.preventDefault(); };
    document.addEventListener("contextmenu", h);
    return () => document.removeEventListener("contextmenu", h);
  }, []);

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
      void showError({
        title: `${which} failed`,
        err: r.error,
        message: `${r.label}: ${msg}\n\nThis step was removed from the ${which} history.`,
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
        return viewRows(liveRows, {
          searchQuery: st.searchQuery, tagFilter: st.tagFilter, tagStore,
          sortKey: st.sortKey, sortDir: st.sortDir, foldersFirst: state.foldersFirst,
        }).map(r => r.origIndex);
      },
      dispatch: (l: string) => handleMenuCommandRef.current(l),
      openAbout: () => setAboutOpen(true),
      openUpdates: () => setUpdates({ found: null }),
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
        panes: paneCommands,
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
        setPrefsOpen,
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
      // Say so rather than do nothing. No handler for a label is a bug
      // (check:wiring audits the menus), so it goes in the log too.
      console.warn("menu command not wired:", label);
      logWarn(`menu command not wired: ${label}`);
      dialogs.showToast({
        message: `“${label}” isn't available.`,
        variant: "warning",
      });
    } catch (err) {
      // Handlers without a catch of their own end up here: the error's
      // sentence, titled with the command, its raw text under Show details.
      console.error("menu command failed", label, err);
      void showError({ title: label.replace(/…$/, "").toLowerCase(), err });
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
    if (payload.type === "open-with-app") {
      void launchApp(payload.app, [payload.path]);
      return;
    }
  };

  const openCtxMenu = (e: MenuAnchor, items: MenuItemDef[]) => {
    // Raw cursor coords — ContextMenu measures itself and clamps into view.
    setCtx({ x: e.clientX, y: e.clientY, items, keyboard: e.keyboard });
  };

  // `handle`: the pane's shown tab, which a right-click in the pane without
  // the focus gives the focus to.
  const onContext = (e: MenuAnchor, kind: ContextKind, rowIndex?: number, handle: UseTabResult | undefined = activeHandle) => {
    // File-pane surfaces act on the current selection; clear the module target
    // so stale sidebar/tab/breadcrumb right-clicks can't leak into file ops.
    cmdState.contextTarget = null;
    if (kind === "file") {
      // Hide "Remove Tag…" when the selected row has no tags — keeps the
      // menu honest instead of dangling a no-op command.
      const st = handle?.state;
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
      if (!split) items = items.filter(it => !(it.kind === "item" && OTHER_PANE_LABELS.has(it.label)));
      // Swap single-rename for bulk-rename when multiple rows are selected.
      if (selCount > 1) {
        items = items.map(it => {
          if (it.kind === "item" && it.label === "Rename") {
            return { ...it, label: "Bulk Rename…", kb: "F2" };
          }
          return it;
        });
      }
      openCtxMenu(e, withOpenWithPath(items, firstPath));
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

  const onTabContext = (pane: number) => (e: React.MouseEvent, tabIndex: number) => {
    cmdState.contextTarget = { kind: "tab", tabIndex, pane };
    // A window's only tab can't leave it (dragging it moves the window),
    // nor, unsplit, split off.
    const only = tabCount(layout) < 2;
    const menu = CONTEXT_TAB.filter(it => !(it.kind === "item" && only && (it.action === "Move Tab to New Window" || (it.action === "Move Tab to Other Pane" && !split))));
    openCtxMenu(e, menu);
  };

  const onCrumbContext = (e: React.MouseEvent, path: string) => {
    cmdState.contextTarget = { kind: "breadcrumb", path };
    openCtxMenu(e, CONTEXT_BREADCRUMB);
  };

  // Each pane's rows; the focused pane's drive the Inspector and status bar.
  const shown0 = tabLayout.shownHandle(0);
  const shown1 = tabLayout.shownHandle(1);
  const rows0: InspectableFile[] = useMemo(() => {
    if (!shown0) return [];
    return shown0.state.entries.map(e => entryToRow(e, tagStore));
  }, [shown0?.state.entries, tagStore]);
  const rows1: InspectableFile[] = useMemo(() => {
    if (!shown1) return [];
    return shown1.state.entries.map(e => entryToRow(e, tagStore));
  }, [shown1?.state.entries, tagStore]);
  const liveRows = layout.focus === 1 ? rows1 : rows0;

  const selectedForInspector = activeHandle?.state.selected ?? [];
  const selectedFile = liveRows[selectedForInspector[0]] ?? null;

  const totalBytes = liveRows.reduce((acc, r) => acc + (r.kind === "folder" ? 0 : r.entry.size), 0);
  const totalSize = formatBytes(totalBytes, false);
  // The status bar's size: the selected files', when any are.
  const selectedFiles = selectedForInspector.map(i => liveRows[i]).filter(r => r && r.kind !== "folder");
  const selectionSize = selectedForInspector.length === 0 ? null
    : selectedFiles.length === 0 ? "—"
    : formatBytes(selectedFiles.reduce((acc, r) => acc + r.entry.size, 0), false);

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

  // Both panes after a transfer: the drop may have gone into the other one.
  const refreshShown = () => {
    shown0?.actions.refresh();
    shown1?.actions.refresh();
  };

  /** Split view: the panes' focus, layout and the transfers between them
   *  (handlers/app.ts). */
  const paneCommands: PaneCommands = {
    split,
    dir: layout.dir,
    toggleSplit: (dir: SplitDir) => {
      if (split && layout.dir === dir) {
        tabLayout.update(closeSplit);
        return;
      }
      if (split) {
        tabLayout.update(l => setDir(l, dir));
        return;
      }
      const t = tabs[activeTab];
      if (!t) return;
      tabLayout.update(l => splitWithNew(l, tabLayout.copyOf(activeHandle, t), dir));
    },
    closeSplit: () => tabLayout.update(closeSplit),
    swap: () => tabLayout.update(swapPanes),
    focusOther: () => {
      if (!split) return;
      const other = 1 - layout.focus;
      tabLayout.focusPane(other);
      setFocusedPane("files");
      paneRootRefs[other].current?.focus();
    },
    transferToOther: (copy: boolean) => {
      const dst = tabLayout.shownHandle(1 - layout.focus)?.state.path;
      if (!split || !dst) {
        dialogs.showToast({ message: "split the view first (View → Split)", variant: "info" });
        return;
      }
      const st = activeHandle?.state;
      const paths = st ? st.selected.map(i => st.entries[i]?.path).filter((x): x is string => !!x) : [];
      if (paths.length === 0) {
        dialogs.showToast({ message: "nothing selected", variant: "info" });
        return;
      }
      const moving = dropPaths(paths, dst, copy);
      if (moving.length > 0) performDrop(moving, dst, copy, refreshShown);
    },
    moveTabToOtherPane: (index, pane) => tabMoves.moveToOtherPane(pane ?? layout.focus, index),
    moveTabToNewWindow: (index, pane) => tabMoves.moveToNewWindow(pane ?? layout.focus, index),
  };

  const renderPane = (p: number) => {
    const handle = tabLayout.shownHandle(p);
    // Memoised: a new array on every App render made FilePane re-filter and
    // re-sort, re-render every row, and scroll back to the focused row.
    const rows = p === 1 ? rows1 : rows0;
    const sel = handle?.state.selected ?? [];
    const miller = displayMode === "Miller Columns (ranger)";
    const pane = (
      <FilePane
        cutPaths={cutPaths}
        error={handle?.state.error ?? null}
        loading={handle?.state.loading ?? false}
        paneRootRef={paneRootRefs[p]}
        dropPath={handle?.state.path}
        onActivate={() => { setFocusedPane("files"); tabLayout.focusPane(p); }}
        millerKeys={miller}
        files={rows}
        selected={sel}
        setSelected={handle?.actions.setSelected ?? (() => {})}
        focusIndex={handle?.state.focusIndex ?? 0}
        setFocusIndex={handle?.actions.setFocusIndex ?? (() => {})}
        anchorIndex={handle?.state.anchorIndex ?? 0}
        setAnchorIndex={handle?.actions.setAnchorIndex ?? (() => {})}
        paneFocused={paneFocused === p}
        setPaneFocused={v => setPaneFocused(cur => (v ? p : cur === p ? null : cur))}
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
        onContext={(e, kind, row) => { tabLayout.focusPane(p); onContext(e, kind, row, handle); }}
        searchQuery={handle?.state.searchQuery ?? ""}
        tagFilter={handle?.state.tagFilter ?? null}
        tagStore={tagStore}
        onOpen={(i) => {
          const row = rows[i];
          if (!row) return;
          if (row.entry.kind === "folder") {
            handle?.actions.goTo(row.entry.path);
          } else {
            void openFile(row.entry.path);
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
          performDrop(sources, target.entry.path, copy, refreshShown);
        }}
        onExternalDrag={(sourceOrigIndices, x, y, copy) => {
          const sources = sourceOrigIndices
            .map(i => rows[i]?.entry.path)
            .filter((p): p is string => !!p);
          // A tab, a breadcrumb segment, a sidebar row, a Miller column or
          // its folder row, or the pane outside a folder row (its own
          // folder: a move there does nothing, a copy makes duplicates).
          const target = dropTargetAt(x, y);
          const moving = target ? dropPaths(sources, target.path, copy) : [];
          if (target && moving.length > 0) performDrop(moving, target.path, copy, refreshShown);
        }}
        onDragOut={(sourceOrigIndices, copy) => {
          const paths = sourceOrigIndices
            .map(i => rows[i]?.entry.path)
            .filter((p): p is string => !!p);
          const stopSwallowing = swallowHandOffClicks();
          startDragOut(paths, copy).catch(e => {
            stopSwallowing();
            dialogs.showToast({ message: `couldn't drag out: ${errText(e)}`, variant: "error" });
          });
        }}
      />
    );
    if (!miller) return pane;
    // Miller columns: the pane is the middle column, between its folder's
    // parent and the focused row's preview.
    return (
      <MillerView
        cwd={handle?.state.path ?? ""}
        focused={handle?.state.entries[handle.state.focusIndex]}
        showHidden={handle?.state.showHidden ?? false}
        sortKey={handle?.state.sortKey ?? "name"}
        sortDir={handle?.state.sortDir ?? "asc"}
        foldersFirst={state.foldersFirst}
        tagStore={tagStore}
        onNavigate={(p) => handle?.actions.goTo(p)}
        onPathContext={(e, path, isFolder) => onSidebarContext(e, path, isFolder ? "tree-folder" : "tree-file")}
      >
        {pane}
      </MillerView>
    );
  };

  // Unsplit, the one pane (its tabs are in the title bar). Split, each pane
  // with its own tab bar, and a divider that sets their shares.
  const renderPanes = () => {
    const area = (p: number, body: React.ReactNode) => (
      <div key={p} className={"split-pane" + (split && layout.focus === p ? " focused" : "")} data-tab-pane={p}>{body}</div>
    );
    if (!split) return area(0, renderPane(0));
    const strip = (p: number) => {
      const pane = layout.panes[p];
      return (
        <TabStrip
          pane={p}
          tabs={pane.tabs}
          activeTab={pane.active}
          onSelectTab={(i) => tabLayout.setActiveTab(i, p)}
          onCloseTab={(i) => closeTabAt(i, p)}
          onNewTab={() => openNewTab(p)}
          onTabContext={onTabContext(p)}
          onTabPointerDown={tabMoves.onTabPointerDown(p)}
          tabPaths={pane.tabs.map(t => tabHandles[t.id]?.state.path)}
        />
      );
    };
    const share = `${layout.ratio}fr 5px ${1 - layout.ratio}fr`;
    return (
      <div
        className={"split split-" + layout.dir}
        style={layout.dir === "row" ? { gridTemplateColumns: share } : { gridTemplateRows: share }}
      >
        {area(0, <>{strip(0)}{renderPane(0)}</>)}
        <div
          className="split-divider"
          role="separator"
          aria-orientation={layout.dir === "row" ? "vertical" : "horizontal"}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            const box = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect();
            const move = (ev: PointerEvent) => {
              const r = layout.dir === "row" ? (ev.clientX - box.left) / box.width : (ev.clientY - box.top) / box.height;
              tabLayout.update(l => setRatio(l, r));
            };
            const up = () => {
              window.removeEventListener("pointermove", move);
              window.removeEventListener("pointerup", up);
            };
            window.addEventListener("pointermove", move);
            window.addEventListener("pointerup", up);
          }}
          onDoubleClick={() => tabLayout.update(l => setRatio(l, 0.5))}
        />
        {area(1, <>{strip(1)}{renderPane(1)}</>)}
      </div>
    );
  };

  // What the menus' ✓ marks follow.
  const menuToggles: MenuToggleState = {
    split: split ? layout.dir : null,
    tweaks: state,
    sidebarVisible: showSidebar,
    statusBarVisible: showStatusBar,
    inspectorVisible: showInspector,
    sortKey: activeHandle?.state.sortKey,
    sortDir: activeHandle?.state.sortDir,
  };

  return (
    <div className={"app" + (split ? " is-split" : "")}>
      {tabLayout.shells}
      <Titlebar
        split={split}
        tabs={tabs}
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        onCloseTab={closeTabAt}
        onNewTab={openNewTab}
        onTabContext={onTabContext(0)}
        onTabPointerDown={tabMoves.onTabPointerDown(0)}
        tabPaths={tabs.map(t => tabHandles[t.id]?.state.path)}
      />
      <OsDrop onDrop={(paths, dir, copy) => performDrop(paths, dir, copy, refreshShown)} />
      <Menubar
        onOpenPalette={() => setPalOpen(true)}
        onCommand={handleMenuCommand}
        onPayload={handleMenuPayload}
        toggles={menuToggles}
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
          onOpenFile={(p) => { void openFile(p); }}
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
          tagSet={state.tagSet}
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
        {renderPanes()}
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
                  void openFile(path);
                  return;
                case "open-in-code":
                  spawnVscodeStrict(path).catch((err: unknown) => {
                    void showError({ title: "open in VS Code failed", err });
                  });
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
      {showStatusBar && <StatusBar
        items={state.statusItems}
        selectedCount={selectedForInspector.length}
        totalCount={liveRows.length}
        folderSize={totalSize}
        selectionSize={selectionSize}
        path={activeHandle?.state.path ?? ""}
        gitInfo={activeHandle?.state.gitInfo ?? null}
        onToggleTerm={() => setTermOpen(v => !v)}
      />}

      {palOpen && <Palette onClose={() => setPalOpen(false)} onCommand={handleMenuCommand} />}
      {ctx && <ContextMenu items={ctx.items} x={ctx.x} y={ctx.y} keyboard={ctx.keyboard} onClose={() => { setCtx(null); cmdState.contextTarget = null; }} onCommand={handleMenuCommand} onPayload={handleMenuPayload} toggles={menuToggles} />}
      {quickLookOpen && selectedFile && (
        <QuickLook file={selectedFile} onClose={() => setQuickLookOpen(false)} />
      )}
      {blame && <BlameDialog blame={blame} onClose={() => setBlame(null)} />}
      {gitOutput && <GitOutputDialog state={gitOutput} onClose={() => setGitOutput(null)} />}
      {diffView && <DiffDialog a={diffView.a} b={diffView.b} diff={diffView.diff} onClose={() => setDiffView(null)} />}
      {showFindModal && (
        <FindInFilesModal
          root={activeHandle?.state.path ?? ""}
          onClose={() => setShowFindModal(false)}
          onPick={(m) => {
            setShowFindModal(false);
            void revealPath(activeHandle, m.path);
          }}
        />
      )}
      {bulkRenameItems && (
        <BulkRenameDialog
          items={bulkRenameItems}
          onClose={() => setBulkRenameItems(null)}
          renameOne={(from, to) => renamePath(from, to)}
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
          moveEntry={movePath}
          trashEntry={async p => { await trashPath(p); }}
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
          tagSet={state.tagSet}
          onClose={() => setTagPickerPath(null)}
          onSaved={() => setTagPickerPath(null)}
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
      <PreferencesDialog
        open={prefsOpen}
        state={state}
        setState={setState}
        onClose={() => setPrefsOpen(false)}
        onCheckUpdates={() => { setPrefsOpen(false); setUpdates({ found: null }); }}
      />
      <UpdateDialog open={updates !== null} found={updates?.found} onClose={() => setUpdates(null)} />

      {folderPicker && (
        <FolderPickerDialog
          initialPath={folderPicker.initialPath}
          title={folderPicker.title}
          onClose={() => setFolderPicker(null)}
          onPick={folderPicker.onPick}
        />
      )}
      <DialogHost />
      <GitDialogHost />
      <OpsTray />
      <NoticesHost />
    </div>
  );
}
