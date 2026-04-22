import { useEffect, useMemo, useRef, useState } from "react";
import {
  Titlebar,
  Menubar,
  Toolbar,
  Sidebar,
  FilePane,
  Inspector,
  StatusBar,
  TerminalDrawer,
  Palette,
  ContextMenu,
  Tweaks,
  type TabDef,
  type TweakState,
  type ContextKind,
} from "./components";
import { CONTEXT_FILE, CONTEXT_EMPTY, CONTEXT_SIDEBAR, CONTEXT_SIDEBAR_PINNED, CONTEXT_TAB, CONTEXT_BREADCRUMB, type MenuItemDef, type FileRow, type FileKind, type GitStatus } from "./data";
import { useTabState, type UseTabResult } from "./state";
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
  gitBlame,
  compress,
  hashSha256,
  pickDirectory,
  type FileEntry,
  type BlameLine,
} from "./api";

const TWEAK_DEFAULTS: TweakState = {
  theme: "gruvbox-dark",
  font: '"JetBrainsMono Nerd Font", "JetBrains Mono", ui-monospace, monospace',
  density: "default",
  scanlines: false,
  hidden: false,
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

interface BlameModalProps {
  data: { path: string; lines: BlameLine[] };
  onClose: () => void;
}

function BlameModal({ data, onClose }: BlameModalProps) {
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
  const shortName = (() => {
    const t = data.path.replace(/[\\/]+$/, "");
    const i = Math.max(t.lastIndexOf("\\"), t.lastIndexOf("/"));
    return i < 0 ? t : t.slice(i + 1);
  })();
  const fmtDate = (ms: number): string => {
    if (!ms) return "—";
    const d = new Date(ms);
    const pad = (n: number) => n.toString().padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
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
          <span style={{ color: "var(--accent)" }}>⎇ git blame · {shortName}</span>
          <span style={{ color: "var(--fg-3)", fontSize: 12 }}>
            {data.lines.length} line{data.lines.length === 1 ? "" : "s"} · esc/click to close
          </span>
          <button
            onClick={onClose}
            style={{
              background: "transparent", border: "1px solid var(--fg-3)", color: "var(--fg-1)",
              padding: "2px 8px", cursor: "pointer", borderRadius: 2,
            }}
          >×</button>
        </div>
        <div style={{ overflow: "auto", padding: "6px 12px", fontSize: 12, lineHeight: 1.5 }}>
          {data.lines.length === 0 ? (
            <div style={{ color: "var(--fg-3)" }}>(no blame data)</div>
          ) : data.lines.map((ln, i) => (
            <div key={i} style={{ display: "flex", gap: 8, whiteSpace: "pre" }}>
              <span style={{ color: "var(--yellow)", width: "8ch", flexShrink: 0 }}>{ln.sha}</span>
              <span style={{ color: "var(--accent-2, var(--blue))", width: "16ch", flexShrink: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{ln.author}</span>
              <span style={{ color: "var(--fg-3)", width: "11ch", flexShrink: 0 }}>{fmtDate(ln.timestamp_ms)}</span>
              <span style={{ color: "var(--fg-3)", width: "5ch", flexShrink: 0, textAlign: "right" }}>{ln.line_no}</span>
              <span style={{ color: "var(--fg-1)", overflow: "hidden", textOverflow: "ellipsis" }}>{ln.content.slice(0, 200)}</span>
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

function winToWslInline(p: string): string {
  const m = /^([A-Za-z]):[\\/](.*)$/.exec(p);
  if (!m) return p;
  return `/mnt/${m[1].toLowerCase()}/${m[2].replace(/\\/g, "/")}`;
}

interface AppClipboard {
  op: "copy" | "cut";
  paths: string[];
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
  const [termOpen, setTermOpen] = useState(false);
  const [ctx, setCtx] = useState<CtxState | null>(null);
  const [tweaksOpen, setTweaksOpen] = useState(false);
  const [showInspector, setShowInspector] = useState(true);

  const [tabHandles, setTabHandles] = useState<Record<number, UseTabResult>>({});
  const [searchQuery, setSearchQuery] = useState("");
  const [paneFocused, setPaneFocused] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const [pins, setPins] = useState<string[]>([]);
  const [tagStore, setTagStore] = useState<Record<string, string[]>>({});
  const [blame, setBlame] = useState<{ path: string; lines: BlameLine[] } | null>(null);

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
      setInitialPaths([p]);
      setTabs([{ ic: "", color: "var(--blue)", label: p }]);
    })();
  }, []);

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
      if ((e.ctrlKey || e.metaKey) && e.key === "`") {
        e.preventDefault(); setTermOpen(v => !v); return;
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

      if (e.key === "F2") { e.preventDefault(); dispatch("Rename"); return; }

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
        setTermOpen(v => !v); return;
      case "Command Palette":
      case "Palette":
        setPalOpen(v => !v); return;
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
          // TODO: replace with custom dialog
          const next = window.prompt("rename to", firstEntry.name);
          if (!next || next === firstEntry.name) return;
          const dst = join(cwd, next);
          await renameEntry(firstEntry.path, dst);
          refresh();
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
          appClipboard = { op: "copy", paths: selectedPaths };
          return;
        }
        case "Cut": {
          if (selectedPaths.length === 0) return;
          appClipboard = { op: "cut", paths: selectedPaths };
          return;
        }
        case "Paste": {
          if (!appClipboard || appClipboard.paths.length === 0) return;
          const { op, paths } = appClipboard;
          for (const src of paths) {
            const dst = join(cwd, basename(src));
            if (op === "copy") await copyEntry(src, dst);
            else await moveEntry(src, dst);
          }
          if (op === "cut") appClipboard = null;
          refresh();
          return;
        }
        case "New Folder":
        case "Folder": {
          // TODO: replace with custom dialog
          const name = window.prompt("new folder name", "new-folder");
          if (!name) return;
          await makeDir(join(cwd, name));
          refresh();
          return;
        }
        case "New File":
        case "Text File": {
          // TODO: replace with custom dialog
          const name = window.prompt("new file name", "untitled.txt");
          if (!name) return;
          await writeText(join(cwd, name), "");
          refresh();
          return;
        }
        case "Markdown Note": {
          // TODO: replace with custom dialog
          const name = window.prompt("new note name", "note.md");
          if (!name) return;
          await writeText(join(cwd, name), "");
          refresh();
          return;
        }
        case "Script (.sh)": {
          // TODO: replace with custom dialog
          const name = window.prompt("new script name", "script.sh");
          if (!name) return;
          await writeText(join(cwd, name), "#!/usr/bin/env bash\n");
          refresh();
          return;
        }
        case "Duplicate": {
          if (selectedPaths.length === 0) return;
          for (const p of selectedPaths) await copyEntry(p, p + " (copy)");
          refresh();
          return;
        }
        case "Open in Terminal": {
          await spawnTerminal(cwd);
          return;
        }
        case "Open in VS Code": {
          await spawnVscode(firstPath ?? cwd);
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
        case "Add Tag…":
        case "Add Tag": {
          if (!firstPath) return;
          // TODO: replace with custom dialog
          const raw = window.prompt("Tag name:");
          if (raw === null) return;
          const tag = raw.trim();
          if (!tag) return;
          setTagStore(prev => {
            const existing = prev[firstPath] ?? [];
            if (existing.includes(tag)) return prev;
            const next = { ...prev, [firstPath]: [...existing, tag] };
            void writeTags(next);
            return next;
          });
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
          let moved = 0;
          for (const src of selectedPaths) {
            const dst = join(target, basename(src));
            try {
              await moveEntry(src, dst);
              moved++;
            } catch (err) {
              console.error("move_entry failed for", src, err);
            }
          }
          if (moved > 0) refresh();
          return;
        }
        case "Properties": {
          console.log("Properties: not wired yet", firstPath ?? cwd);
          return;
        }
        default:
          console.warn("menu command not wired:", label);
          return;
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

  const onContext = (e: React.MouseEvent, kind: ContextKind) => {
    // File-pane surfaces act on the current selection; clear the module target
    // so stale sidebar/tab/breadcrumb right-clicks can't leak into file ops.
    contextTarget = null;
    if (kind === "file") {
      // Hide "Remove Tag…" when the selected row has no tags — keeps the
      // menu honest instead of dangling a no-op command.
      const st = activeHandle?.state;
      const firstPath = st ? st.entries[st.selected[0]]?.path : undefined;
      const hasTags = !!firstPath && (tagStore[firstPath]?.length ?? 0) > 0;
      const items = hasTags
        ? CONTEXT_FILE
        : CONTEXT_FILE.filter(it => !(it.kind === "item" && it.label === "Remove Tag…"));
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
        <Sidebar
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
        />
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
        <TerminalDrawer open={termOpen} onClose={() => setTermOpen(false)} />
      </div>
      <StatusBar
        selectedCount={selected.length}
        totalCount={liveRows.length}
        totalSize={totalSize}
        path={activeHandle?.state.path ?? ""}
        gitInfo={activeHandle?.state.gitInfo ?? null}
        onToggleTerm={() => setTermOpen(v => !v)}
      />

      {palOpen && <Palette onClose={() => setPalOpen(false)} onCommand={handleMenuCommand} />}
      {ctx && <ContextMenu items={ctx.items} x={ctx.x} y={ctx.y} onClose={() => setCtx(null)} onCommand={handleMenuCommand} />}
      {tweaksOpen && <Tweaks state={state} setState={setState} onClose={() => setTweaksOpen(false)} />}
      {blame && <BlameModal data={blame} onClose={() => setBlame(null)} />}

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
