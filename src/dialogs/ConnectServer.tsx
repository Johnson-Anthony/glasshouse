import React, { useState, useEffect, useRef } from "react";
import type { SavedRemote } from "../Sidebar";

// ============= ConnectServerDialog =============
export interface ConnectServerDialogProps {
  onClose: () => void;
  onSave: (r: SavedRemote) => void;
}

export function ConnectServerDialog({ onClose, onSave }: ConnectServerDialogProps) {
  const [label, setLabel] = useState("");
  const [host, setHost] = useState("");
  const [path, setPath] = useState("");
  const labelRef = useRef<HTMLInputElement>(null);

  useEffect(() => { labelRef.current?.focus(); }, []);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onClose(); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  const canSave = label.trim().length > 0 && host.trim().length > 0;
  const submit = () => {
    if (!canSave) return;
    onSave({ label: label.trim(), host: host.trim(), path: path.trim() });
  };

  const inputStyle: React.CSSProperties = {
    background: "var(--bg-0, #0f0f14)", color: "var(--fg-1)",
    border: "1px solid var(--fg-3)", borderRadius: 2,
    padding: "4px 8px", fontFamily: "var(--font-mono)", fontSize: 13,
    outline: "none",
  };

  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)",
      zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        width: "52ch", maxWidth: "95vw",
        background: "var(--bg-1, #1a1b26)", border: "1px solid var(--fg-3)",
        borderRadius: 4, display: "flex", flexDirection: "column",
        fontFamily: "var(--font-mono)", color: "var(--fg-1)",
      }}>
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "8px 12px", borderBottom: "1px solid var(--fg-3)",
          background: "var(--bg-2, #16161e)",
        }}>
          <span style={{ color: "var(--accent)" }}>⌁ connect to server</span>
          <button onClick={onClose} style={{
            background: "transparent", border: "1px solid var(--fg-3)", color: "var(--fg-1)",
            padding: "2px 8px", cursor: "pointer", borderRadius: 2,
          }}>×</button>
        </div>
        <div style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11, color: "var(--fg-3)" }}>
            label
            <input ref={labelRef} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="home-nas" style={inputStyle} />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11, color: "var(--fg-3)" }}>
            user@host
            <input
              value={host}
              onChange={(e) => setHost(e.target.value)}
              placeholder="user@192.168.1.10"
              style={inputStyle}
              onKeyDown={(e) => { if (e.key === "Enter" && canSave) { e.preventDefault(); submit(); } }}
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11, color: "var(--fg-3)" }}>
            remote path (optional)
            <input
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder="/home/user"
              style={inputStyle}
              onKeyDown={(e) => { if (e.key === "Enter" && canSave) { e.preventDefault(); submit(); } }}
            />
          </label>
        </div>
        <div style={{
          padding: "8px 12px", borderTop: "1px solid var(--fg-3)",
          display: "flex", justifyContent: "flex-end", gap: 6,
          background: "var(--bg-2, #16161e)",
        }}>
          <button onClick={onClose} style={{
            background: "transparent", border: "1px solid var(--fg-3)", color: "var(--fg-1)",
            padding: "4px 12px", cursor: "pointer", borderRadius: 2, fontFamily: "inherit",
          }}>cancel</button>
          <button
            onClick={submit}
            disabled={!canSave}
            style={{
              background: canSave ? "var(--accent)" : "var(--bg-0)",
              border: "1px solid " + (canSave ? "var(--accent)" : "var(--fg-3)"),
              color: canSave ? "var(--bg-0)" : "var(--fg-3)",
              padding: "4px 12px", cursor: canSave ? "pointer" : "not-allowed",
              borderRadius: 2, fontFamily: "inherit",
            }}
          >save</button>
        </div>
      </div>
    </div>
  );
}
