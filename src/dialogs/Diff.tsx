import { basename } from "../paths";
import { useEscapeClose } from "./useEscapeClose";

// ============= DiffDialog =============
export interface DiffDialogProps {
  a: string;
  b: string;
  diff: string;
  onClose: () => void;
}

export function DiffDialog({ a, b, diff, onClose }: DiffDialogProps) {
  useEscapeClose(onClose);

  const lines = diff.split("\n");

  const colorFor = (line: string): string => {
    if (line.startsWith("+++") || line.startsWith("---")) return "var(--fg-3)";
    if (line.startsWith("@@")) return "var(--accent, var(--cyan))";
    if (line.startsWith("+")) return "var(--green, #9ece6a)";
    if (line.startsWith("-")) return "var(--red, #f7768e)";
    return "var(--fg-1)";
  };

  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)",
      zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        width: "120ch", maxWidth: "95vw", maxHeight: "90vh",
        background: "var(--bg-1, #1a1b26)", border: "1px solid var(--fg-3)",
        borderRadius: 4, display: "flex", flexDirection: "column",
        fontFamily: "var(--font-mono)", color: "var(--fg-1)",
      }}>
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "8px 12px", borderBottom: "1px solid var(--fg-3)",
          background: "var(--bg-2, #16161e)",
        }}>
          <span style={{ color: "var(--accent)" }}>⎘ diff — {basename(a)} ↔ {basename(b)}</span>
          <span style={{ color: "var(--fg-3)", fontSize: 12 }}>esc/click to close</span>
          <button onClick={onClose} style={{
            background: "transparent", border: "1px solid var(--fg-3)", color: "var(--fg-1)",
            padding: "2px 8px", cursor: "pointer", borderRadius: 2,
          }} aria-label="close">×</button>
        </div>
        <div style={{ overflow: "auto", flex: 1, fontSize: 12, lineHeight: 1.5, padding: "4px 0" }}>
          {diff.trim() === "" ? (
            <div style={{ color: "var(--fg-3)", padding: "8px 12px" }}>(files are identical)</div>
          ) : lines.map((line, i) => (
            <div key={i} style={{
              color: colorFor(line), padding: "0 12px", whiteSpace: "pre",
            }}>{line || " "}</div>
          ))}
        </div>
      </div>
    </div>
  );
}
