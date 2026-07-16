import { useEffect, useRef, useState } from "react";
import { Terminal, type ITheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import "@xterm/xterm/css/xterm.css";
import {
  listShellProfiles,
  ptyKill,
  ptyResize,
  ptySpawn,
  ptyWrite,
  spawnTerminalProfile,
  type ShellProfile,
} from "./api";
import { makeCdCommand } from "./shellCd";

export interface TerminalDrawerProps {
  open: boolean;
  cwd: string;
  profile: ShellProfile | null;
  height: number;
  onHeightChange: (h: number) => void;
  onClose: () => void;
}

interface PtyDataEvent { session_id: string; data: string }
interface PtyExitEvent { session_id: string; exit_code: number | null }

const MIN_H = 120;
const MAX_H_RATIO = 0.8;

function readThemeVars(): ITheme {
  const cs = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => {
    const raw = cs.getPropertyValue(name).trim();
    return raw || fallback;
  };
  return {
    background: "rgba(0,0,0,0)",
    foreground: v("--fg-1", "#a9b1d6"),
    cursor: v("--accent", "#bb9af7"),
    cursorAccent: v("--bg-1", "#16161e"),
    selectionBackground: v("--bg-sel", "#283457"),
    selectionForeground: v("--fg-0", "#c0caf5"),
    black: v("--bg-0", "#1a1b26"),
    red: v("--red", "#f7768e"),
    green: v("--green", "#9ece6a"),
    yellow: v("--yellow", "#e0af68"),
    blue: v("--blue", "#7aa2f7"),
    magenta: v("--magenta", "#bb9af7"),
    cyan: v("--cyan", "#7dcfff"),
    white: v("--fg-0", "#c0caf5"),
    brightBlack: v("--fg-3", "#565f89"),
    brightRed: v("--red", "#f7768e"),
    brightGreen: v("--green", "#9ece6a"),
    brightYellow: v("--yellow", "#e0af68"),
    brightBlue: v("--blue", "#7aa2f7"),
    brightMagenta: v("--magenta", "#bb9af7"),
    brightCyan: v("--cyan", "#7dcfff"),
    brightWhite: v("--fg-0", "#c0caf5"),
  };
}

function ttabPrefix(p: ShellProfile): string {
  switch (p.kind) {
    case "wsl": return "wsl";
    case "ssh": return "ssh";
    default: return "sh";
  }
}

function ttabLabel(p: ShellProfile): string {
  if (p.kind === "wsl") return p.label.replace(/^WSL · /, "");
  if (p.kind === "ssh") return p.label.replace(/^SSH: /, "");
  return p.label.toLowerCase();
}

interface TermTab {
  key: number;
  profile: ShellProfile;
  dead?: boolean;
}

interface TermPaneProps {
  profile: ShellProfile;
  cwd: string;
  visible: boolean;
  open: boolean;
  height: number;
  onExit: () => void;
}

/** One xterm + one PTY session, alive for the lifetime of its tab. Closing
 *  the tab unmounts the pane, which kills the PTY. Inactive panes stay
 *  mounted (their sessions keep running) and are hidden with
 *  visibility:hidden rather than display:none, so the element stays
 *  measurable and FitAddon stays accurate on hidden tabs. */
function TermPane({ profile, cwd, visible, open, height, onExit }: TermPaneProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const sessionRef = useRef<string | null>(null);
  const lastCwdRef = useRef<string>(cwd);
  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;

  // Create the terminal, register pty event routing, then spawn the PTY —
  // strictly in that order. The Rust reader thread starts emitting pty-data
  // the moment the shell launches, before the pty_spawn invoke resolves with
  // our session id, so the listeners must already be up and early chunks are
  // buffered until the id is known, then replayed. (Filtering on a
  // not-yet-set id silently ate the shell's first prompt.)
  useEffect(() => {
    if (!hostRef.current) return;
    const term = new Terminal({
      fontFamily: '"JetBrainsMono Nerd Font", "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
      fontSize: 12,
      lineHeight: 1.25,
      cursorBlink: true,
      cursorStyle: "block",
      theme: readThemeVars(),
      allowProposedApi: true,
      convertEol: false,
      scrollback: 5000,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(hostRef.current);
    termRef.current = term;
    fitRef.current = fit;
    try { fit.fit(); } catch { /* ignore */ }

    term.onData(d => { const id = sessionRef.current; if (id) void ptyWrite(id, d); });
    term.onResize(({ cols, rows }) => {
      const id = sessionRef.current; if (id) void ptyResize(id, cols, rows);
    });

    let disposed = false;
    let unData: UnlistenFn | null = null;
    let unExit: UnlistenFn | null = null;
    let myId: string | null = null;
    const pendingData: PtyDataEvent[] = [];
    const pendingExits: PtyExitEvent[] = [];

    const showExit = (code: number | null) => {
      sessionRef.current = null;
      term.write(`\r\n\x1b[2m[process exited${code !== null ? ` (${code})` : ""}]\x1b[0m\r\n`);
      onExitRef.current();
    };

    void (async () => {
      const [ud, ue] = await Promise.all([
        listen<PtyDataEvent>("pty-data", evt => {
          const p = evt.payload;
          if (disposed) return;
          if (myId === null) {
            if (pendingData.length < 256) pendingData.push(p);
            return;
          }
          if (p.session_id !== myId) return;
          term.write(p.data);
        }),
        listen<PtyExitEvent>("pty-exit", evt => {
          const p = evt.payload;
          if (disposed) return;
          if (myId === null) { pendingExits.push(p); return; }
          if (p.session_id !== myId || sessionRef.current === null) return;
          showExit(p.exit_code);
        }),
      ]);
      unData = ud;
      unExit = ue;
      if (disposed) { ud(); ue(); return; }

      try {
        const id = await ptySpawn(profile, cwd || "", term.cols, term.rows);
        if (disposed) { void ptyKill(id); return; }
        myId = id;
        sessionRef.current = id;
        for (const p of pendingData) {
          if (p.session_id === id) term.write(p.data);
        }
        pendingData.length = 0;
        const exited = pendingExits.find(p => p.session_id === id);
        pendingExits.length = 0;
        if (exited) showExit(exited.exit_code);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (!disposed) term.write(`\x1b[31mpty spawn failed: ${msg}\x1b[0m\r\n`);
      }
    })();

    return () => {
      disposed = true;
      unData?.();
      unExit?.();
      const id = sessionRef.current;
      if (id) void ptyKill(id);
      sessionRef.current = null;
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, []);

  useEffect(() => {
    const obs = new MutationObserver(() => {
      if (termRef.current) termRef.current.options.theme = readThemeVars();
    });
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => obs.disconnect();
  }, []);

  // cd-follow: only the visible pane chases the browser cwd. Hidden panes
  // record the change without emitting, so switching tabs never retro-cds
  // a shell you left somewhere on purpose.
  useEffect(() => {
    if (!cwd || cwd === lastCwdRef.current) return;
    if (visible && sessionRef.current) {
      const cmd = makeCdCommand(profile, cwd);
      if (cmd !== null) void ptyWrite(sessionRef.current, cmd + "\r");
    }
    lastCwdRef.current = cwd;
  }, [cwd, visible]);

  useEffect(() => {
    const t = window.setTimeout(() => {
      try { fitRef.current?.fit(); } catch { /* ignore */ }
    }, 40);
    return () => window.clearTimeout(t);
  }, [height, open, visible]);

  useEffect(() => {
    const onWinResize = () => { try { fitRef.current?.fit(); } catch { /* ignore */ } };
    window.addEventListener("resize", onWinResize);
    return () => window.removeEventListener("resize", onWinResize);
  }, []);

  useEffect(() => {
    if (!open || !visible) return;
    const t = window.setTimeout(() => {
      try { termRef.current?.focus(); } catch { /* ignore */ }
    }, 200);
    return () => window.clearTimeout(t);
  }, [open, visible]);

  return (
    <div
      className={"term-body" + (visible ? "" : " hidden")}
      ref={hostRef}
      tabIndex={0}
      onClick={() => { try { termRef.current?.focus(); } catch { /* ignore */ } }}
    />
  );
}

export function TerminalDrawer({ open, cwd, profile, height, onHeightChange, onClose }: TerminalDrawerProps) {
  const [profiles, setProfiles] = useState<ShellProfile[]>([]);
  const [tabs, setTabs] = useState<TermTab[]>([]);
  const [activeKey, setActiveKey] = useState(0);
  const [plusOpen, setPlusOpen] = useState(false);
  const nextKeyRef = useRef(1);
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const handledProfileRef = useRef<ShellProfile | null>(null);

  useEffect(() => {
    void (async () => setProfiles(await listShellProfiles()))();
  }, []);

  const addTab = (p: ShellProfile) => {
    const key = nextKeyRef.current++;
    setTabs(ts => [...ts, { key, profile: p }]);
    setActiveKey(key);
    setPlusOpen(false);
  };

  const closeTab = (key: number) => {
    const ts = tabsRef.current;
    const idx = ts.findIndex(t => t.key === key);
    if (idx < 0) return;
    const next = ts.filter(t => t.key !== key);
    setTabs(next);
    if (next.length === 0) { onClose(); return; }
    if (key === activeKey) {
      setActiveKey(next[Math.min(idx, next.length - 1)].key);
    }
  };

  const markDead = (key: number) => {
    setTabs(ts => ts.map(t => (t.key === key ? { ...t, dead: true } : t)));
  };

  // Tab lifecycle driven from outside:
  //  - App pushes a profile (ssh Connect, run-profile menu items): focus an
  //    existing live tab with the same id, else open a new tab for it. App
  //    creates a fresh object per request, so identity tracks "new request".
  //  - First open with no tabs: spawn the default shell lazily (no PTY until
  //    the drawer is actually used).
  useEffect(() => {
    if (profile && profile !== handledProfileRef.current) {
      handledProfileRef.current = profile;
      const existing = tabsRef.current.find(t => t.profile.id === profile.id && !t.dead);
      if (existing) setActiveKey(existing.key);
      else addTab(profile);
      return;
    }
    if (open && tabsRef.current.length === 0 && profiles.length > 0) {
      addTab(profiles[0]);
    }
  }, [open, profile, profiles]);

  // Ctrl+Shift+` opens a new tab with the active tab's profile (VS Code
  // convention). Capture phase so it beats xterm's own key handling; App's
  // Ctrl+` toggle is unaffected (with Shift the key produces "~" there).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!open) return;
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.code === "Backquote") {
        e.preventDefault();
        const p = tabsRef.current.find(t => t.key === activeKey)?.profile ?? profiles[0];
        if (p) addTab(p);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, profiles, activeKey]);

  // "New Terminal Tab" menu item — App can't reach into drawer state, so it
  // opens the drawer and signals via a window event. No `open` check: the
  // dispatch that fires this is also the one flipping the drawer open.
  useEffect(() => {
    const onNewTab = () => {
      const p = tabsRef.current.find(t => t.key === activeKey)?.profile ?? profiles[0];
      if (p) addTab(p);
    };
    window.addEventListener("glasshouse:term-new-tab", onNewTab);
    return () => window.removeEventListener("glasshouse:term-new-tab", onNewTab);
  }, [profiles, activeKey]);

  // The plus menu closes on any outside mousedown; the button and menu stop
  // propagation so their own clicks don't count as "outside".
  useEffect(() => {
    if (!plusOpen) return;
    const onDown = () => setPlusOpen(false);
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [plusOpen]);

  const onDragStart = (e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = height;
    const maxH = Math.floor(window.innerHeight * MAX_H_RATIO);
    const onMove = (me: MouseEvent) => {
      const next = Math.min(maxH, Math.max(MIN_H, startH + (startY - me.clientY)));
      onHeightChange(next);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const activeTab = tabs.find(t => t.key === activeKey) ?? null;

  const handlePlus = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (profiles.length === 0) return;
    if (profiles.length === 1) { addTab(profiles[0]); return; }
    setPlusOpen(v => !v);
  };

  const handleExport = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!activeTab) return;
    void spawnTerminalProfile(activeTab.profile, cwd || "");
  };

  const handleClose = (e: React.MouseEvent) => {
    e.stopPropagation();
    onClose();
  };

  return (
    <div className={"term-drawer" + (open ? " open" : "")} style={{ height }}>
      <div className="term-resize" onMouseDown={onDragStart} title="drag to resize" />
      <div className="term-head">
        {tabs.map(t => {
          const isActive = t.key === activeKey;
          return (
            <div
              key={t.key}
              className={"ttab" + (isActive ? " active" : "") + (t.dead ? " dead" : "")}
              onClick={() => setActiveKey(t.key)}
              onAuxClick={e => { if (e.button === 1) closeTab(t.key); }}
              title={t.profile.label + (t.dead ? " (exited)" : "")}
            >
              <span>{ttabPrefix(t.profile)} · {ttabLabel(t.profile)}</span>
              <span
                className="close"
                title="close tab"
                onClick={e => { e.stopPropagation(); closeTab(t.key); }}
              >×</span>
            </div>
          );
        })}
        <div
          className="ttab plus"
          title="new terminal tab (Ctrl+Shift+`)"
          onMouseDown={e => e.stopPropagation()}
          onClick={handlePlus}
        >
          +
          {plusOpen && (
            <div className="term-plus-menu" onMouseDown={e => e.stopPropagation()}>
              {profiles.map(p => (
                <div
                  key={p.id}
                  className="item"
                  onClick={e => { e.stopPropagation(); addTab(p); }}
                >
                  {ttabPrefix(p)} · {ttabLabel(p)}
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="right">
          <span title="open in external terminal" onClick={handleExport}>↗</span>
          <span title="close (Ctrl+`)" onClick={handleClose}>×</span>
        </div>
      </div>
      <div className="term-stack">
        {tabs.map(t => (
          <TermPane
            key={t.key}
            profile={t.profile}
            cwd={cwd}
            visible={t.key === activeKey}
            open={open}
            height={height}
            onExit={() => markDead(t.key)}
          />
        ))}
      </div>
    </div>
  );
}
