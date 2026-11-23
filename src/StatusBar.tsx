import React, { useEffect, useState } from "react";
import { netRate, pathFsType, pathSpace, systemInfo, type GitInfo, type NetRate, type Space, type SystemInfo } from "./api";
import { formatBytes } from "./rows";
import { LEFT_ITEMS, statusNeeds, type StatusItem } from "./statusItems";

// ============= Status bar =============
// The items it shows are a setting (statusItems.ts). Each fetches only while
// it shows: the system's load and the network every 2 s, the clock every
// second, none of them while the window is in the background; free space
// and the file system when the folder or its listing changes.

export interface StatusBarProps {
  items: readonly StatusItem[];
  selectedCount: number;
  totalCount: number;
  /** The folder's files' size, formatted. */
  folderSize: string;
  /** The selected files' size, formatted; null when nothing is selected. */
  selectionSize: string | null;
  path: string;
  gitInfo: GitInfo | null;
  onToggleTerm: () => void;
}

function formatUptime(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(sec)}`;
}

function formatMemGB(bytes: number): string {
  if (!bytes) return "—";
  const g = bytes / (1024 ** 3);
  if (g >= 10) return `${g.toFixed(0)}G`;
  return `${g.toFixed(1)}G`;
}

function formatBytesRate(bps: number): string {
  if (!bps || bps < 1) return "0";
  if (bps >= 1024 * 1024) return `${(bps / (1024 * 1024)).toFixed(1)}M`;
  if (bps >= 1024) return `${Math.round(bps / 1024)}K`;
  return `${bps}`;
}

/** Whether the page is in view (not a minimized or hidden window). */
function usePageVisible(): boolean {
  const [visible, setVisible] = useState(() => typeof document === "undefined" || document.visibilityState !== "hidden");
  useEffect(() => {
    const h = () => setVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", h);
    return () => document.removeEventListener("visibilitychange", h);
  }, []);
  return visible;
}

/** `read()` now and every `ms` while `on`; its latest value. */
function usePoll<T>(on: boolean, ms: number, read: () => Promise<T>): T | null {
  const [value, setValue] = useState<T | null>(null);
  useEffect(() => {
    if (!on) return;
    let live = true;
    const tick = () => void read().then(v => { if (live) setValue(v); });
    tick();
    const id = window.setInterval(tick, ms);
    return () => { live = false; window.clearInterval(id); };
    // `read` is the same module function at each call site.
  }, [on, ms]);
  return value;
}

const now = () => Promise.resolve(new Date());

export function StatusBar({ items, selectedCount, totalCount, folderSize, selectionSize, path, gitInfo, onToggleTerm }: StatusBarProps) {
  const visible = usePageVisible();
  const needs = statusNeeds(items);
  const shows = (id: StatusItem) => items.includes(id);
  const sys = usePoll<SystemInfo | null>(needs.system && visible, 2000, systemInfo);
  const net = usePoll<NetRate | null>(needs.net && visible, 2000, netRate);
  const clockNow = usePoll<Date>(needs.clock && visible, 1000, now);

  const showFs = shows("fs");
  const [fs, setFs] = useState("");
  useEffect(() => {
    if (!showFs || !path) { setFs(""); return; }
    let live = true;
    void pathFsType(path).then(f => { if (live) setFs(f); });
    return () => { live = false; };
  }, [showFs, path]);

  // Again when the listing changes: a copy or delete changes it.
  const showFree = shows("free");
  const [space, setSpace] = useState<Space | null>(null);
  useEffect(() => {
    if (!showFree || !path) { setSpace(null); return; }
    let live = true;
    void pathSpace(path).then(s => { if (live) setSpace(s); });
    return () => { live = false; };
  }, [showFree, path, totalCount, folderSize]);

  const pad = (n: number) => n.toString().padStart(2, "0");
  const numStyle = (ch: number): React.CSSProperties => ({
    display: "inline-block",
    minWidth: `${ch}ch`,
    textAlign: "right",
  });
  const dim: React.CSSProperties = { color: "var(--fg-3)" };

  const segment = (id: StatusItem): React.ReactNode => {
    switch (id) {
      case "path":
        return <div className="sb-seg"><span className="lbl">▸</span><span className="val">{path}</span></div>;
      case "git": {
        if (!gitInfo) return null;
        const ahead = [
          gitInfo.ahead > 0 && `↑${gitInfo.ahead}`,
          gitInfo.behind > 0 && `↓${gitInfo.behind}`,
          gitInfo.dirty > 0 && `●${gitInfo.dirty}`,
        ].filter(Boolean).join(" ");
        return <div className="sb-seg accent"><span className="lbl">⎇</span><span className="val">{gitInfo.branch}</span>{ahead && <span style={dim}>{ahead}</span>}</div>;
      }
      case "items":
        return <div className="sb-seg" title={`${selectedCount} selected of ${totalCount} items`}><span className="lbl">sel</span><span className="val" style={numStyle(4)}>{selectedCount}</span><span style={dim}>/ <span style={numStyle(4)}>{totalCount}</span></span></div>;
      case "size":
        return (
          <div className="sb-seg" title={selectionSize === null ? "size of the files in this folder" : "size of the selected files (folders aren't counted)"}>
            <span className="lbl">Σ</span><span className="val" style={numStyle(8)}>{selectionSize ?? folderSize}</span>
          </div>
        );
      case "free":
        if (!space) return null;
        return (
          <div className="sb-seg" title={`${formatBytes(space.free, false)} free of ${formatBytes(space.total, false)} on this drive`}>
            <span className="lbl">free</span><span className="val" style={numStyle(6)}>{formatBytes(space.free, false)}</span>
          </div>
        );
      case "fs":
        return <div className="sb-seg"><span className="lbl">fs</span><span className="val" style={numStyle(5)}>{fs || "—"}</span></div>;
      case "mem":
        return (
          <div className="sb-seg warn" title="memory in use">
            <span className="lbl">mem</span><span className="val" style={numStyle(4)}>{sys ? `${sys.mem_pct.toFixed(0)}%` : "—"}</span>
            <span style={dim}>{sys ? formatMemGB(sys.mem_used) : ""}</span>
          </div>
        );
      case "cpu":
        return <div className="sb-seg ok"><span className="lbl">cpu</span><span className="val" style={numStyle(4)}>{sys ? `${sys.cpu_pct.toFixed(0).padStart(2, "0")}%` : "—"}</span></div>;
      case "net":
        return <div className="sb-seg"><span className="lbl">net</span><span className="val" style={numStyle(13)}>{net ? `↓${formatBytesRate(net.down_bps)} ↑${formatBytesRate(net.up_bps)}` : "—"}</span></div>;
      case "term":
        return <button type="button" className="sb-seg plain-btn" aria-label="Terminal" onClick={onToggleTerm}><span className="val" style={{ color: "var(--accent)" }}>⌨ term</span></button>;
      case "uptime":
        return <div className="sb-seg"><span className="lbl">up</span><span className="val" style={numStyle(8)}>{sys ? formatUptime(sys.uptime_s) : "—"}</span></div>;
      case "clock": {
        const t = clockNow ?? new Date();
        return <div className="sb-seg"><span className="val" style={numStyle(8)}>{`${pad(t.getHours())}:${pad(t.getMinutes())}:${pad(t.getSeconds())}`}</span></div>;
      }
    }
  };

  const left = items.filter(id => LEFT_ITEMS.has(id));
  const right = items.filter(id => !LEFT_ITEMS.has(id));
  return (
    <div className="statusbar">
      {left.map(id => <React.Fragment key={id}>{segment(id)}</React.Fragment>)}
      <div className="spacer"></div>
      {right.map(id => <React.Fragment key={id}>{segment(id)}</React.Fragment>)}
    </div>
  );
}
