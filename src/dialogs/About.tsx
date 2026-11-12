import { useState, useEffect } from "react";
import { TAURI_VERSION } from "../data";
import { getVersion } from "@tauri-apps/api/app";
import { openNotices } from "../NoticesScreen";
import { useEscapeClose } from "./useEscapeClose";
import { useModal } from "./modal";

// ============= AboutDialog =============
export interface AboutDialogProps {
  open: boolean;
  onClose: () => void;
}

export function AboutDialog({ open, onClose }: AboutDialogProps) {
  const [version, setVersion] = useState("…");

  useEscapeClose(onClose, open);
  useModal(open);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      try {
        const v = await getVersion();
        if (!cancelled) setVersion(v);
      } catch {
        // tauri unavailable (e.g. vite dev without tauri host)
        if (!cancelled) setVersion("unknown");
      }
    })();
    return () => { cancelled = true; };
  }, [open]);

  if (!open) return null;

  const rows: Array<[string, string]> = [
    ["app", "Glasshouse"],
    ["version", version],
    ["tauri", TAURI_VERSION],
    // Stamped by vite.config.ts `define` at build (or dev-server start) time.
    ["built on", __BUILD_DATE__],
  ];

  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)",
      zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        width: "48ch", maxWidth: "95vw",
        background: "var(--bg-1, #1a1b26)", border: "1px solid var(--fg-3)",
        borderRadius: 4, display: "flex", flexDirection: "column",
        fontFamily: "var(--font-mono)", color: "var(--fg-1)",
      }}>
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "8px 12px", borderBottom: "1px solid var(--fg-3)",
          background: "var(--bg-2, #16161e)",
        }}>
          <span style={{ color: "var(--accent)" }}>about</span>
          <button onClick={onClose} style={{
            background: "transparent", border: "1px solid var(--fg-3)", color: "var(--fg-1)",
            padding: "2px 8px", cursor: "pointer", borderRadius: 2,
          }}>×</button>
        </div>
        <div style={{ padding: "14px 16px" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <tbody>
              {rows.map(([k, v]) => (
                <tr key={k}>
                  <td style={{
                    color: "var(--fg-3)", padding: "4px 12px 4px 0",
                    width: "12ch", whiteSpace: "nowrap",
                  }}>{k}</td>
                  <td style={{ padding: "4px 0", wordBreak: "break-all" }}>{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{
          padding: "8px 12px", borderTop: "1px solid var(--fg-3)",
          display: "flex", justifyContent: "flex-end", gap: 8,
          background: "var(--bg-2, #16161e)",
        }}>
          <button onClick={() => { onClose(); openNotices(); }} style={{
            background: "transparent", border: "1px solid var(--fg-3)", color: "var(--fg-1)",
            padding: "4px 12px", cursor: "pointer", borderRadius: 2, fontFamily: "inherit",
          }}>third-party notices</button>
          <button onClick={onClose} style={{
            background: "transparent", border: "1px solid var(--fg-3)", color: "var(--fg-1)",
            padding: "4px 12px", cursor: "pointer", borderRadius: 2, fontFamily: "inherit",
          }}>close</button>
        </div>
      </div>
    </div>
  );
}
