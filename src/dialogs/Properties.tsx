import React, { useState, useEffect } from "react";
import { hashSha256, type FileEntry } from "../api";
import { isCancelled, runOp } from "../ops";

// ============= PropertiesDialog =============
export interface PropertiesDialogProps {
  entry: FileEntry | null;
  onClose: () => void;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const kb = n / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(2)} GB`;
}

export function PropertiesDialog({ entry, onClose }: PropertiesDialogProps) {
  const [sha, setSha] = useState<string | null>(null);
  const [hashing, setHashing] = useState(false);
  const [hashErr, setHashErr] = useState<string | null>(null);

  useEffect(() => {
    setSha(null);
    setHashing(false);
    setHashErr(null);
  }, [entry?.path]);

  useEffect(() => {
    if (!entry) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onClose(); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [entry, onClose]);

  if (!entry) return null;

  const isFolder = entry.kind === "folder";
  const computeHash = async () => {
    if (isFolder || hashing) return;
    setHashing(true);
    setHashErr(null);
    try {
      const hex = await runOp(`hashing ${entry.name}`, track => hashSha256(entry.path, track()));
      setSha(hex);
    } catch (err) {
      if (!isCancelled(err)) setHashErr(err instanceof Error ? err.message : String(err));
    } finally {
      setHashing(false);
    }
  };

  const rows: Array<[string, React.ReactNode]> = [
    ["name", entry.name],
    ["path", entry.path],
    ["kind", entry.kind],
    ["size", isFolder ? "—" : formatBytes(entry.size)],
    ["modified", entry.modified_ms ? new Date(entry.modified_ms).toLocaleString() : "—"],
    ["extension", entry.ext && entry.ext.length > 0 ? entry.ext : "—"],
    ["hidden", entry.hidden ? "yes" : "no"],
    ["symlink", entry.is_symlink ? "yes" : "no"],
    ["git", entry.git ?? "—"],
    [
      "sha256",
      isFolder ? (
        <span style={{ color: "var(--fg-3)" }}>— (folder)</span>
      ) : sha ? (
        <span style={{ wordBreak: "break-all" }}>{sha}</span>
      ) : hashErr ? (
        <span style={{ color: "var(--red, #f7768e)" }}>error: {hashErr}</span>
      ) : (
        <button
          onClick={() => { void computeHash(); }}
          disabled={hashing}
          style={{
            background: "transparent", border: "1px solid var(--fg-3)", color: "var(--fg-1)",
            padding: "2px 10px", cursor: hashing ? "wait" : "pointer",
            borderRadius: 2, fontFamily: "inherit", fontSize: 12,
          }}
        >{hashing ? "computing…" : "Compute…"}</button>
      ),
    ],
  ];

  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)",
      zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        width: "64ch", maxWidth: "95vw", maxHeight: "85vh",
        background: "var(--bg-1, #1a1b26)", border: "1px solid var(--fg-3)",
        borderRadius: 4, display: "flex", flexDirection: "column",
        fontFamily: "var(--font-mono)", color: "var(--fg-1)",
      }}>
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "8px 12px", borderBottom: "1px solid var(--fg-3)",
          background: "var(--bg-2, #16161e)",
        }}>
          <span style={{ color: "var(--accent)" }}>ℹ properties</span>
          <button onClick={onClose} style={{
            background: "transparent", border: "1px solid var(--fg-3)", color: "var(--fg-1)",
            padding: "2px 8px", cursor: "pointer", borderRadius: 2,
          }}>×</button>
        </div>
        <div style={{ padding: "10px 12px", overflow: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <tbody>
              {rows.map(([k, v]) => (
                <tr key={k}>
                  <td style={{
                    color: "var(--fg-3)", padding: "4px 12px 4px 0", verticalAlign: "top",
                    width: "12ch", whiteSpace: "nowrap",
                  }}>{k}</td>
                  <td style={{ padding: "4px 0", verticalAlign: "top", wordBreak: "break-all" }}>{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{
          padding: "8px 12px", borderTop: "1px solid var(--fg-3)",
          display: "flex", justifyContent: "flex-end", gap: 6,
          background: "var(--bg-2, #16161e)",
        }}>
          <button onClick={onClose} style={{
            background: "transparent", border: "1px solid var(--fg-3)", color: "var(--fg-1)",
            padding: "4px 12px", cursor: "pointer", borderRadius: 2, fontFamily: "inherit",
          }}>close</button>
        </div>
      </div>
    </div>
  );
}
