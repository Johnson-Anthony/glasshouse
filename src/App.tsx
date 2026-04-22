import { useState, useEffect } from "react";
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
import { FILES, CONTEXT_FILE, CONTEXT_EMPTY, type MenuItemDef } from "./data";

const TWEAK_DEFAULTS: TweakState = {
  theme: "gruvbox-dark",
  font: '"JetBrains Mono", ui-monospace, monospace',
  density: "default",
  scanlines: false,
  hidden: false,
};

interface CtxState {
  x: number;
  y: number;
  items: MenuItemDef[];
}

export function App() {
  const [state, setState] = useState<TweakState>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("rice.tweaks") || "null");
      return saved ? { ...TWEAK_DEFAULTS, ...saved } : TWEAK_DEFAULTS;
    } catch { return TWEAK_DEFAULTS; }
  });

  const [tabs, setTabs] = useState<TabDef[]>([
    { ic: "", color: "var(--blue)",    label: "~/projects/glasshouse" },
    { ic: "", color: "var(--green)",   label: "~/school/cs3410" },
    { ic: "", color: "var(--orange)",  label: "/mnt/c/Users/you" },
    { ic: "", color: "var(--magenta)", label: "~/Pictures/screens" },
  ]);
  const [activeTab, setActiveTab] = useState(0);
  const [selected, setSelected] = useState<number[]>([13]); // main.rs selected by default
  const [palOpen, setPalOpen] = useState(false);
  const [termOpen, setTermOpen] = useState(false);
  const [ctx, setCtx] = useState<CtxState | null>(null);
  const [tweaksOpen, setTweaksOpen] = useState(false);

  // Apply state to document
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", state.theme);
    document.documentElement.setAttribute("data-density", state.density);
    document.documentElement.setAttribute("data-scanlines", state.scanlines ? "on" : "off");
    document.documentElement.style.setProperty("--font-mono", state.font);
    localStorage.setItem("rice.tweaks", JSON.stringify(state));
  }, [state]);

  // Keyboard shortcuts
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

  const onContext = (e: React.MouseEvent, kind: ContextKind) => {
    setCtx({
      x: Math.min(e.clientX, window.innerWidth - 240),
      y: Math.min(e.clientY, window.innerHeight - 420),
      items: kind === "file" ? CONTEXT_FILE : CONTEXT_EMPTY,
    });
  };

  const selectedFile = FILES.filter(f => state.hidden || !f.hidden)[selected[0]] || null;
  const totalSize = "4.2 GB";

  return (
    <div className="app">
      <Titlebar
        tabs={tabs}
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        onCloseTab={(i) => setTabs(tabs.filter((_, k) => k !== i))}
        onNewTab={() => setTabs([...tabs, { ic: "", color: "var(--cyan)", label: "~/new-tab" }])}
      />
      <Menubar onOpenPalette={() => setPalOpen(true)} />
      <Toolbar />
      <div className="body">
        <Sidebar />
        <FilePane selected={selected} setSelected={setSelected} onContext={onContext} showHidden={state.hidden} />
        <Inspector file={selectedFile} />
        <TerminalDrawer open={termOpen} onClose={() => setTermOpen(false)} />
      </div>
      <StatusBar selectedCount={selected.length} totalSize={totalSize} onToggleTerm={() => setTermOpen(v => !v)} />

      {palOpen && <Palette onClose={() => setPalOpen(false)} />}
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
