import { useEscapeClose } from "./useEscapeClose";

// ============= GitOutputDialog =============
export interface GitOutputState {
  title: string;
  output: string;
  ok: boolean;
  exit?: number;
  stderr?: string;
}

export interface GitOutputDialogProps {
  state: GitOutputState;
  onClose: () => void;
}

export function GitOutputDialog({ state, onClose }: GitOutputDialogProps) {
  useEscapeClose(onClose);

  const statusColor = state.ok ? "var(--green, #9ece6a)" : "var(--red, #f7768e)";
  const statusLabel = state.ok ? "ok" : `exit ${state.exit ?? "?"}`;

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
          width: "100ch", maxWidth: "95vw", maxHeight: "85vh",
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
          <span style={{ color: "var(--accent)" }}>⎇ {state.title}</span>
          <span style={{ color: statusColor, fontSize: 12 }}>{statusLabel}</span>
          <button
            onClick={onClose}
            style={{
              background: "transparent", border: "1px solid var(--fg-3)", color: "var(--fg-1)",
              padding: "2px 8px", cursor: "pointer", borderRadius: 2,
            }}
            aria-label="close"
          >×</button>
        </div>
        <pre
          style={{
            margin: 0, padding: "10px 12px", overflow: "auto", flex: 1,
            fontSize: 12, lineHeight: 1.45, whiteSpace: "pre-wrap", wordBreak: "break-word",
            color: "var(--fg-1)",
          }}
        >{state.output || "(no output)"}</pre>
        {!state.ok && state.stderr && state.stderr !== state.output && (
          <pre
            style={{
              margin: 0, padding: "8px 12px", borderTop: "1px solid var(--fg-3)",
              background: "var(--bg-2, #16161e)", color: "var(--red, #f7768e)",
              fontSize: 12, lineHeight: 1.45, whiteSpace: "pre-wrap",
              maxHeight: "30vh", overflow: "auto",
            }}
          >{state.stderr}</pre>
        )}
      </div>
    </div>
  );
}
