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
import { CONTEXT_FILE, CONTEXT_EMPTY, type MenuItemDef, type FileRow, type FileKind, type GitStatus } from "./data";
import { useTabState, type UseTabResult } from "./state";
import { homeDir, type FileEntry } from "./api";

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

function mapGitFlag(flag: string | undefined): GitStatus | null {
  if (!flag) return null;
  if (flag === "mod") return "mod";
  if (flag === "add") return "add";
  if (flag === "del") return "del";
  if (flag === "untracked") return "untracked";
  if (flag === "renamed") return "mod";
  return null;
}

export interface LiveFileRow extends FileRow {
  entry: FileEntry;
}

function entryToRow(e: FileEntry, git: Record<string, string> | null, repoRoot: string | null): LiveFileRow {
  const kind = kindFromEntry(e.kind);
  let relKey: string | null = null;
  if (git && repoRoot) {
    const root = repoRoot.replace(/[\\/]+$/, "");
    const pathNorm = e.path.replace(/\\/g, "/");
    const rootNorm = root.replace(/\\/g, "/");
    if (pathNorm.toLowerCase().startsWith(rootNorm.toLowerCase() + "/")) {
      relKey = pathNorm.slice(rootNorm.length + 1);
    }
  }
  const flag = git && relKey ? git[relKey] : undefined;
  const nameNoExt = e.ext && e.name.toLowerCase().endsWith("." + e.ext.toLowerCase())
    ? e.name.slice(0, -(e.ext.length + 1))
    : e.name;
  return {
    name: nameNoExt,
    kind,
    size: formatBytes(e.size, kind === "folder"),
    date: formatDate(e.modified_ms),
    tag: null,
    git: mapGitFlag(flag),
    hidden: e.hidden,
    ext: e.ext,
    entry: e,
  };
}

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

  const [tabHandles, setTabHandles] = useState<Record<number, UseTabResult>>({});

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

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "p") {
        e.preventDefault(); setPalOpen(v => !v);
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "`") {
        e.preventDefault(); setTermOpen(v => !v);
      }
      if ((e.ctrlKey || e.metaKey) && e.key === ",") {
        e.preventDefault(); setTweaksOpen(v => !v);
      }
      if (e.key === "Escape") {
        setPalOpen(false); setCtx(null);
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

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

  const handleMenuCommand = (label: string) => {
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
      case "Switch Theme":
      case "Switch Theme →": {
        const i = THEMES.indexOf(state.theme);
        const next = THEMES[(i < 0 ? 0 : i + 1) % THEMES.length];
        setState(prev => ({ ...prev, theme: next }));
        return;
      }
      default:
        return;
    }
  };

  const onContext = (e: React.MouseEvent, kind: ContextKind) => {
    setCtx({
      x: Math.min(e.clientX, window.innerWidth - 240),
      y: Math.min(e.clientY, window.innerHeight - 420),
      items: kind === "file" ? CONTEXT_FILE : CONTEXT_EMPTY,
    });
  };

  const liveRows: LiveFileRow[] = useMemo(() => {
    if (!activeHandle) return [];
    const git = activeHandle.state.gitInfo;
    return activeHandle.state.entries.map(e =>
      entryToRow(e, git?.status ?? null, git?.repo_root ?? null),
    );
  }, [activeHandle?.state.entries, activeHandle?.state.gitInfo]);

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
      />
      <div className="body">
        <Sidebar
          activePath={activeHandle?.state.path ?? ""}
          onGoTo={(p) => activeHandle?.actions.goTo(p)}
        />
        <FilePane
          files={liveRows}
          selected={selected}
          setSelected={setSelected}
          onContext={onContext}
          onOpen={(i) => {
            const row = liveRows[i];
            if (row && row.entry.kind === "folder") {
              activeHandle?.actions.goTo(row.entry.path);
            }
          }}
        />
        <Inspector file={selectedFile} />
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
      {ctx && <ContextMenu items={ctx.items} x={ctx.x} y={ctx.y} onClose={() => setCtx(null)} />}
      {tweaksOpen && <Tweaks state={state} setState={setState} onClose={() => setTweaksOpen(false)} />}

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
