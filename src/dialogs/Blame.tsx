import { useEffect } from "react";
import type { BlameLine } from "../api";
import { basename } from "../paths";

// ============= BlameDialog =============
export interface BlameDialogProps {
  blame: { path: string; lines: BlameLine[] };
  onClose: () => void;
}

export function BlameDialog({ blame, onClose }: BlameDialogProps) {
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

  const shortName = basename(blame.path);

  const fmtDate = (ms: number): string => {
    if (!ms) return "—";
    const d = new Date(ms);
    const pad = (n: number) => n.toString().padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  };

  const truncAuthor = (a: string): string => (a.length > 16 ? a.slice(0, 16) : a);
  const shortSha = (s: string): string => s.slice(0, 7);

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
          width: "120ch", maxWidth: "95vw", maxHeight: "90vh",
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
          <span style={{ color: "var(--accent)" }}>
            ⎇ git blame — {shortName}
          </span>
          <span style={{ color: "var(--fg-3)", fontSize: 12 }}>
            {blame.lines.length} line{blame.lines.length === 1 ? "" : "s"} · esc/click to close
          </span>
          <button
            onClick={onClose}
            style={{
              background: "transparent", border: "1px solid var(--fg-3)", color: "var(--fg-1)",
              padding: "2px 8px", cursor: "pointer", borderRadius: 2,
            }}
            aria-label="close"
          >×</button>
        </div>

        <style>{`
          .gh-blame-row:hover { background: var(--bg-3, rgba(255,255,255,0.08)) !important; }
          .gh-blame-row.odd { background: var(--bg-2, rgba(255,255,255,0.025)); }
          .gh-blame-row.even { background: transparent; }
        `}</style>

        <div style={{ overflow: "auto", flex: 1, fontSize: 12, lineHeight: 1.5 }}>
          {blame.lines.length === 0 ? (
            <div style={{ color: "var(--fg-3)", padding: "8px 12px" }}>(no blame data)</div>
          ) : blame.lines.map((ln, i) => (
            <div
              key={i}
              className={`gh-blame-row ${i % 2 === 1 ? "odd" : "even"}`}
              style={{
                display: "grid",
                gridTemplateColumns: "8ch 17ch 11ch 6ch 1fr",
                gap: 8,
                padding: "2px 12px",
                whiteSpace: "pre",
              }}
            >
              <span style={{ color: "var(--yellow, #e0af68)", overflow: "hidden", textOverflow: "ellipsis" }}>
                {shortSha(ln.sha)}
              </span>
              <span style={{ color: "var(--accent-2, var(--blue, #7aa2f7))", overflow: "hidden", textOverflow: "ellipsis" }}>
                {truncAuthor(ln.author)}
              </span>
              <span style={{ color: "var(--fg-3)" }}>{fmtDate(ln.timestamp_ms)}</span>
              <span style={{ color: "var(--fg-3)", textAlign: "right" }}>{ln.line_no}</span>
              <span style={{ color: "var(--fg-1)", overflow: "hidden", textOverflow: "ellipsis" }}>
                {ln.content}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
