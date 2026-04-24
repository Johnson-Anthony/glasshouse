import { useEffect, useMemo, useRef, useState } from "react";
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

type ShellFlavor = "pwsh" | "posix" | "ssh";

function flavorOf(profile: ShellProfile): ShellFlavor {
  if (profile.kind === "ssh") return "ssh";
  if (profile.kind === "wsl") return "posix";
  const id = profile.id.toLowerCase();
  const exec = profile.exec.toLowerCase();
  if (id.includes("pwsh") || id.includes("powershell") ||
      exec.endsWith("pwsh.exe") || exec.endsWith("powershell.exe") ||
      exec.endsWith("cmd.exe")) {
    return "pwsh";
  }
  return "posix";
}

/** Rewrite a Windows drive-letter path to the WSL mount form. WSL UNC paths
 *  (`\\wsl$\Ubuntu\...` or `\\wsl.localhost\Ubuntu\...`) and posix paths
 *  are returned as posix-form without translation, since they're already
 *  valid inside the distro. */
function winPathToWsl(path: string): string {
  if (!path) return path;
  // Already posix.
  if (path.startsWith("/")) return path;
  // WSL UNC — strip the host + distro prefix, keep what's inside the distro.
  const unc = path.match(/^\\\\wsl(?:\$|\.localhost)\\[^\\]+(\\.*)?$/i);
  if (unc) {
    const rest = (unc[1] ?? "").replace(/\\/g, "/");
    return rest.length > 0 ? rest : "/";
  }
  const drive = path.match(/^([A-Za-z]):[\\/](.*)$/);
  if (drive) {
    const letter = drive[1].toLowerCase();
    const rest = drive[2].replace(/\\/g, "/");
    return `/mnt/${letter}/${rest}`.replace(/\/+$/, "") || `/mnt/${letter}`;
  }
  const bareDrive = path.match(/^([A-Za-z]):$/);
  if (bareDrive) return `/mnt/${bareDrive[1].toLowerCase()}`;
  return path;
}

function shellQuote(p: string): string {
  return `"${p.replace(/"/g, '\\"')}"`;
}

/** Exported for callers that still want to build a cd command (e.g. external
 *  spawners); not used internally anymore — the drawer never auto-cd's. */
export function makeCdCommand(profile: ShellProfile, path: string): string | null {
  const flavor = flavorOf(profile);
  if (flavor === "ssh") return null;
  if (flavor === "pwsh") {
    return `Set-Location ${shellQuote(path)}`;
  }
  return `cd ${shellQuote(winPathToWsl(path))}`;
}

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

interface SessionEntry {
  id: string;
  profile: ShellProfile;
  /** Initial cwd used when the session was spawned. Never mutates; the user
   *  owns the shell's actual cwd after that. Shown in the tab title only. */
  cwd: string;
  /** Raw scrollback since spawn. Written to xterm on tab switch. */
  buffer: string;
  /** True once the backend emits pty-exit for this session. */
  dead: boolean;
  exitCode?: number | null;
}

function ttabPrefix(p: ShellProfile): string {
  switch (p.kind) {
    case "wsl": return "wsl";
    case "ssh": return "ssh";
    default: return "sh";
  }
}

function ttabShortLabel(p: ShellProfile): string {
  if (p.kind === "wsl") return p.label.replace(/^WSL · /, "");
  if (p.kind === "ssh") return p.label.replace(/^SSH: /, "");
  return p.label.toLowerCase();
}

export function TerminalDrawer({ open, cwd, profile, height, onHeightChange, onClose }: TerminalDrawerProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  /** The session whose output the xterm is currently rendering. */
  const activeIdRef = useRef<string | null>(null);
  /** Session registry. Keyed by session id (the string the backend returns
   *  from pty_spawn). All mutations use setSessions so the tab-bar re-renders. */
  const [sessions, setSessions] = useState<SessionEntry[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<ShellProfile[]>([]);
  const [showPicker, setShowPicker] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  // Sessions ref mirrors state so event listeners (one-time bound) can
  // always read the latest list without stale-closure bugs.
  const sessionsRef = useRef<SessionEntry[]>([]);
  useEffect(() => { sessionsRef.current = sessions; }, [sessions]);
  useEffect(() => { activeIdRef.current = activeId; }, [activeId]);

  useEffect(() => {
    void (async () => {
      const list = await listShellProfiles();
      setProfiles(list);
    })();
  }, []);

  // ── xterm lifecycle ────────────────────────────────────────────────────
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

    term.onData(d => {
      const id = activeIdRef.current;
      if (id) void ptyWrite(id, d);
    });
    term.onResize(({ cols, rows }) => {
      // Resize every live session so backgrounded tabs keep the right geometry.
      for (const s of sessionsRef.current) {
        if (!s.dead) void ptyResize(s.id, cols, rows);
      }
    });

    return () => {
      for (const s of sessionsRef.current) {
        if (!s.dead) void ptyKill(s.id);
      }
      activeIdRef.current = null;
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

  // ── pty event plumbing ─────────────────────────────────────────────────
  useEffect(() => {
    let unData: UnlistenFn | null = null;
    let unExit: UnlistenFn | null = null;
    let cancelled = false;
    void (async () => {
      unData = await listen<PtyDataEvent>("pty-data", evt => {
        const p = evt.payload;
        // Append to that session's buffer so switching back replays it.
        setSessions(prev => {
          const idx = prev.findIndex(s => s.id === p.session_id);
          if (idx < 0) return prev;
          const next = prev.slice();
          next[idx] = { ...next[idx], buffer: next[idx].buffer + p.data };
          return next;
        });
        if (p.session_id === activeIdRef.current && termRef.current) {
          termRef.current.write(p.data);
        }
      });
      unExit = await listen<PtyExitEvent>("pty-exit", evt => {
        const p = evt.payload;
        const tail = `\r\n\x1b[2m[process exited${p.exit_code !== null ? ` (${p.exit_code})` : ""}]\x1b[0m\r\n`;
        setSessions(prev => {
          const idx = prev.findIndex(s => s.id === p.session_id);
          if (idx < 0) return prev;
          const next = prev.slice();
          next[idx] = { ...next[idx], dead: true, exitCode: p.exit_code, buffer: next[idx].buffer + tail };
          return next;
        });
        if (p.session_id === activeIdRef.current && termRef.current) {
          termRef.current.write(tail);
        }
      });
      if (cancelled) { unData?.(); unExit?.(); }
    })();
    return () => { cancelled = true; unData?.(); unExit?.(); };
  }, []);

  // Single source of truth for "spawn from the `profile` prop". Tracks the
  // last profile id we acted on so re-renders don't double-spawn, and
  // `spawnInFlightRef` guards the brief window between `await ptySpawn` and
  // `setSessions` landing.
  const lastProfileRef = useRef<string | null>(null);
  const spawnInFlightRef = useRef(false);

  useEffect(() => {
    if (!open) return;
    if (!termRef.current) return;
    if (spawnInFlightRef.current) return;
    const p = profile ?? (sessions.length === 0 ? profiles[0] ?? null : null);
    if (!p) return;
    // If drawer already has sessions and the profile id matches what we
    // already handled, nothing to do. Prop unchanged means no user action.
    if (sessions.length > 0 && lastProfileRef.current === p.id) return;
    // First session always spawns; subsequent require a real prop change.
    if (sessions.length > 0 && !profile) return;
    lastProfileRef.current = p.id;
    spawnInFlightRef.current = true;
    void spawnSession(p, cwd).finally(() => { spawnInFlightRef.current = false; });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, profile, profiles, sessions.length]);

  // ── session management ─────────────────────────────────────────────────
  async function spawnSession(p: ShellProfile, spawnCwd: string): Promise<void> {
    const t = termRef.current;
    if (!t) return;
    const cols = t.cols ?? 80;
    const rows = t.rows ?? 24;
    try {
      const id = await ptySpawn(p, spawnCwd || "", cols, rows);
      setSessions(prev => [...prev, { id, profile: p, cwd: spawnCwd, buffer: "", dead: false }]);
      setActiveId(id);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (termRef.current) termRef.current.write(`\x1b[31mpty spawn failed: ${msg}\x1b[0m\r\n`);
    }
  }

  // Replay a session's buffer into the xterm whenever the active session
  // changes. `term.reset()` clears the screen + scrollback so switching
  // tabs behaves like a fresh render.
  useEffect(() => {
    const t = termRef.current;
    if (!t) return;
    if (!activeId) { t.reset(); return; }
    const s = sessionsRef.current.find(x => x.id === activeId);
    t.reset();
    if (s) t.write(s.buffer);
    try { t.focus(); } catch { /* ignore */ }
  }, [activeId]);

  function closeSession(id: string): void {
    const s = sessionsRef.current.find(x => x.id === id);
    if (s && !s.dead) void ptyKill(id);
    setSessions(prev => {
      const next = prev.filter(x => x.id !== id);
      if (activeIdRef.current === id) {
        // Focus a neighbour; if none remain, close the drawer entirely.
        if (next.length === 0) {
          setActiveId(null);
          onClose();
        } else {
          const idx = Math.max(0, prev.findIndex(x => x.id === id) - 1);
          setActiveId(next[Math.min(idx, next.length - 1)].id);
        }
      }
      return next;
    });
  }

  // ── resize / focus plumbing ────────────────────────────────────────────
  useEffect(() => {
    const timer = window.setTimeout(() => {
      try { fitRef.current?.fit(); } catch { /* ignore */ }
    }, 40);
    return () => window.clearTimeout(timer);
  }, [height, open]);

  useEffect(() => {
    const onWinResize = () => { try { fitRef.current?.fit(); } catch { /* ignore */ } };
    window.addEventListener("resize", onWinResize);
    return () => window.removeEventListener("resize", onWinResize);
  }, []);

  useEffect(() => {
    if (open) {
      const t = window.setTimeout(() => {
        try { termRef.current?.focus(); } catch { /* ignore */ }
      }, 200);
      return () => window.clearTimeout(t);
    }
  }, [open]);

  // Close picker on outside click.
  useEffect(() => {
    if (!showPicker) return;
    const h = (e: MouseEvent) => {
      if (!pickerRef.current) return;
      if (!pickerRef.current.contains(e.target as Node)) setShowPicker(false);
    };
    const id = window.setTimeout(() => {
      document.addEventListener("mousedown", h, { once: true });
    }, 0);
    return () => {
      window.clearTimeout(id);
      document.removeEventListener("mousedown", h);
    };
  }, [showPicker]);

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

  const activeSession = useMemo(
    () => sessions.find(s => s.id === activeId) ?? null,
    [sessions, activeId],
  );

  const handleExport = (e: React.MouseEvent) => {
    e.stopPropagation();
    const s = activeSession;
    if (!s) return;
    void spawnTerminalProfile(s.profile, s.cwd || cwd || "");
  };

  const handleClose = (e: React.MouseEvent) => {
    e.stopPropagation();
    onClose();
  };

  const pickProfile = (p: ShellProfile) => {
    setShowPicker(false);
    void spawnSession(p, cwd);
  };

  return (
    <div className={"term-drawer" + (open ? " open" : "")} style={{ height }}>
      <div className="term-resize" onMouseDown={onDragStart} title="drag to resize" />
      <div className="term-head">
        {sessions.map(s => {
          const isActive = activeId === s.id;
          return (
            <div
              key={s.id}
              className={"ttab" + (isActive ? " active" : "")}
              onClick={() => setActiveId(s.id)}
              title={s.profile.label}
            >
              {isActive && <span style={{ color: "var(--green)" }}>✓</span>}
              <span>{ttabPrefix(s.profile)} · {ttabShortLabel(s.profile)}{s.dead ? " ✕" : ""}</span>
              <span
                className="close"
                style={{ marginLeft: 6, opacity: 0.7 }}
                onClick={(e) => { e.stopPropagation(); closeSession(s.id); }}
                title="close this session"
              >×</span>
            </div>
          );
        })}
        <div
          ref={pickerRef}
          className="ttab"
          style={{ position: "relative", color: "var(--fg-3)" }}
          title="new terminal tab"
          onClick={(e) => { e.stopPropagation(); setShowPicker(v => !v); }}
        >
          +
          {showPicker && (
            <div
              className="dropdown"
              style={{ position: "absolute", top: "100%", left: 0, minWidth: 200, zIndex: 50 }}
              onClick={(e) => e.stopPropagation()}
            >
              {profiles.length === 0 && (
                <div className="mi" style={{ opacity: 0.6 }}>
                  <span>no shells detected</span>
                </div>
              )}
              {profiles.map(p => (
                <div
                  key={p.id}
                  className="mi"
                  onClick={() => pickProfile(p)}
                >
                  <span className="ic"></span>
                  <span>{p.label}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="right">
          <span title="open in external terminal" onClick={handleExport}>↗</span>
          <span title="close drawer (Ctrl+`)" onClick={handleClose}>×</span>
        </div>
      </div>
      <div
        className="term-body"
        ref={hostRef}
        tabIndex={0}
        onClick={() => { try { termRef.current?.focus(); } catch { /* ignore */ } }}
      />
    </div>
  );
}
