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

/** Classify the profile so we know which cd syntax to emit. Tauri reports
 *  every Windows shell under `kind: "shell"`, so we fall back to `id` (which
 *  is set by Rust as `shell:pwsh`, `shell:bash`, etc.) and then to `exec`. */
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

/** Rewrite a Windows drive-letter path (`C:\Users\foo`) to the WSL mount
 *  form (`/mnt/c/Users/foo`) so bash/zsh/fish can cd into it. Already-WSL
 *  paths and non-Windows paths are returned untouched. UNC (`\\wsl$\…`) is
 *  stripped and translated to `/` for linux shells. */
function winPathToWsl(path: string): string {
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
  // Wrap in double quotes and escape embedded double quotes for both
  // PowerShell and POSIX shells. Paths with `$` in pwsh would still expand
  // variables — we accept that; most real paths don't hit this.
  return `"${p.replace(/"/g, '\\"')}"`;
}

/** Build the cd command to send when the active tab's cwd changes. Returns
 *  `null` when the active profile can't meaningfully cd (ssh sessions). */
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

export function TerminalDrawer({ open, cwd, profile, height, onHeightChange, onClose }: TerminalDrawerProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const sessionRef = useRef<string | null>(null);
  const lastCwdRef = useRef<string>("");
  const [profiles, setProfiles] = useState<ShellProfile[]>([]);
  const [active, setActive] = useState<ShellProfile | null>(profile);

  useEffect(() => {
    void (async () => {
      const list = await listShellProfiles();
      setProfiles(list);
      if (!active && list.length > 0) setActive(list[0]);
    })();
  }, []);

  useEffect(() => {
    if (profile && (!active || profile.id !== active.id)) setActive(profile);
  }, [profile]);

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

    return () => {
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

  useEffect(() => {
    let unData: UnlistenFn | null = null;
    let unExit: UnlistenFn | null = null;
    let cancelled = false;
    void (async () => {
      unData = await listen<PtyDataEvent>("pty-data", evt => {
        const p = evt.payload;
        if (!termRef.current) return;
        if (p.session_id !== sessionRef.current) return;
        termRef.current.write(p.data);
      });
      unExit = await listen<PtyExitEvent>("pty-exit", evt => {
        const p = evt.payload;
        if (p.session_id !== sessionRef.current) return;
        sessionRef.current = null;
        if (termRef.current) {
          termRef.current.write(`\r\n\x1b[2m[process exited${p.exit_code !== null ? ` (${p.exit_code})` : ""}]\x1b[0m\r\n`);
        }
      });
      if (cancelled) { unData?.(); unExit?.(); }
    })();
    return () => { cancelled = true; unData?.(); unExit?.(); };
  }, []);

  useEffect(() => {
    if (!active || !termRef.current) return;
    void (async () => {
      const prev = sessionRef.current;
      if (prev) { await ptyKill(prev); sessionRef.current = null; }
      termRef.current?.clear();
      const t = termRef.current;
      const cols = t?.cols ?? 80;
      const rows = t?.rows ?? 24;
      try {
        const id = await ptySpawn(active, cwd || "", cols, rows);
        sessionRef.current = id;
        lastCwdRef.current = cwd;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        termRef.current?.write(`\x1b[31mpty spawn failed: ${msg}\x1b[0m\r\n`);
      }
    })();
  }, [active]);

  useEffect(() => {
    if (!sessionRef.current) return;
    if (!active) return;
    if (!cwd || cwd === lastCwdRef.current) return;
    const cmd = makeCdCommand(active, cwd);
    if (cmd !== null) void ptyWrite(sessionRef.current, cmd + "\r");
    lastCwdRef.current = cwd;
  }, [cwd, active]);

  useEffect(() => {
    const t = window.setTimeout(() => {
      try { fitRef.current?.fit(); } catch { /* ignore */ }
    }, 40);
    return () => window.clearTimeout(t);
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

  const ttabPrefix = (p: ShellProfile): string => {
    switch (p.kind) {
      case "wsl": return "wsl";
      case "ssh": return "ssh";
      default: return "sh";
    }
  };
  const ttabLabel = (p: ShellProfile): string => {
    if (p.kind === "wsl") return p.label.replace(/^WSL · /, "");
    if (p.kind === "ssh") return p.label.replace(/^SSH: /, "");
    return p.label.toLowerCase();
  };

  const handleExport = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!active) return;
    void spawnTerminalProfile(active, cwd || "");
  };

  const handleClose = (e: React.MouseEvent) => {
    e.stopPropagation();
    onClose();
  };

  return (
    <div className={"term-drawer" + (open ? " open" : "")} style={{ height }}>
      <div className="term-resize" onMouseDown={onDragStart} title="drag to resize" />
      <div className="term-head">
        {profiles.map(p => {
          const isActive = active?.id === p.id;
          return (
            <div
              key={p.id}
              className={"ttab" + (isActive ? " active" : "")}
              onClick={() => setActive(p)}
              title={p.label}
            >
              {isActive && <span style={{ color: "var(--green)" }}>✓</span>}
              <span>{ttabPrefix(p)} · {ttabLabel(p)}</span>
            </div>
          );
        })}
        <div className="ttab" style={{ color: "var(--fg-3)" }} title="new tab (coming soon)">+</div>
        <div className="right">
          <span title="open in external terminal" onClick={handleExport}>↗</span>
          <span title="close (Ctrl+`)" onClick={handleClose}>×</span>
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
