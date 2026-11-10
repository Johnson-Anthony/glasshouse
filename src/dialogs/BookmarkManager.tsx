import { useState } from "react";
import { useEscapeClose } from "./useEscapeClose";

// ============= BookmarkManagerDialog =============
export interface BookmarkManagerDialogProps {
  pins: string[];
  onClose: () => void;
  onSave: (pins: string[]) => void;
  onGoTo?: (path: string) => void;
}

export function BookmarkManagerDialog({ pins, onClose, onSave, onGoTo }: BookmarkManagerDialogProps) {
  const [working, setWorking] = useState<string[]>(() => [...pins]);

  useEscapeClose(onClose);

  const move = (idx: number, delta: number) => {
    setWorking(prev => {
      const j = idx + delta;
      if (j < 0 || j >= prev.length) return prev;
      const next = prev.slice();
      const t = next[idx];
      next[idx] = next[j];
      next[j] = t;
      return next;
    });
  };

  const remove = (idx: number) => {
    setWorking(prev => prev.filter((_, i) => i !== idx));
  };

  const save = () => {
    onSave(working);
  };

  const dirty = working.length !== pins.length || working.some((p, i) => p !== pins[i]);

  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)",
      zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        width: "64ch", maxWidth: "95vw", maxHeight: "80vh",
        background: "var(--bg-1, #1a1b26)", border: "1px solid var(--fg-3)",
        borderRadius: 4, display: "flex", flexDirection: "column",
        fontFamily: "var(--font-mono)", color: "var(--fg-1)",
      }}>
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "8px 12px", borderBottom: "1px solid var(--fg-3)",
          background: "var(--bg-2, #16161e)",
        }}>
          <span style={{ color: "var(--accent)" }}># manage bookmarks</span>
          <button onClick={onClose} style={{
            background: "transparent", border: "1px solid var(--fg-3)", color: "var(--fg-1)",
            padding: "2px 8px", cursor: "pointer", borderRadius: 2,
          }}>×</button>
        </div>
        <div style={{ padding: "6px 12px", borderBottom: "1px solid var(--fg-3)", fontSize: 11, color: "var(--fg-3)" }}>
          {working.length} pin{working.length === 1 ? "" : "s"}
        </div>
        <div style={{ overflow: "auto", flex: 1, padding: "6px 6px", display: "flex", flexDirection: "column", gap: 2 }}>
          {working.length === 0 && (
            <div style={{ color: "var(--fg-3)", padding: "12px", fontStyle: "italic", textAlign: "center" }}>
              no bookmarks — pin a folder from the sidebar + button
            </div>
          )}
          {working.map((p, i) => (
            <div key={`${i}-${p}`} style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "4px 8px", borderRadius: 2,
              background: "var(--bg-0, #0f0f14)",
              border: "1px solid transparent",
            }}>
              <span style={{
                color: "var(--fg-3)", fontSize: 11, minWidth: "2ch", textAlign: "right",
              }}>{i + 1}</span>
              <span
                style={{
                  flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  color: "var(--fg-1)", fontSize: 12,
                  cursor: onGoTo ? "pointer" : "default",
                }}
                title={onGoTo ? `go to ${p}` : p}
                onClick={() => {
                  if (!onGoTo) return;
                  onSave(working);
                  onGoTo(p);
                }}
              >{p}</span>
              <button
                onClick={() => move(i, -1)}
                disabled={i === 0}
                title="move up"
                style={{
                  background: "transparent", border: "1px solid var(--fg-3)", color: "var(--fg-1)",
                  padding: "1px 6px", cursor: i === 0 ? "not-allowed" : "pointer",
                  borderRadius: 2, fontFamily: "inherit", fontSize: 11, opacity: i === 0 ? 0.4 : 1,
                }}
              >↑</button>
              <button
                onClick={() => move(i, 1)}
                disabled={i === working.length - 1}
                title="move down"
                style={{
                  background: "transparent", border: "1px solid var(--fg-3)", color: "var(--fg-1)",
                  padding: "1px 6px", cursor: i === working.length - 1 ? "not-allowed" : "pointer",
                  borderRadius: 2, fontFamily: "inherit", fontSize: 11, opacity: i === working.length - 1 ? 0.4 : 1,
                }}
              >↓</button>
              <button
                onClick={() => remove(i)}
                title="remove bookmark"
                style={{
                  background: "transparent", border: "1px solid var(--fg-3)", color: "var(--red, #f7768e)",
                  padding: "1px 8px", cursor: "pointer",
                  borderRadius: 2, fontFamily: "inherit", fontSize: 11,
                }}
              >×</button>
            </div>
          ))}
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
            onClick={save}
            disabled={!dirty}
            style={{
              background: dirty ? "var(--accent)" : "transparent",
              border: "1px solid var(--accent)",
              color: dirty ? "var(--bg-0)" : "var(--fg-3)",
              padding: "4px 12px", cursor: dirty ? "pointer" : "not-allowed",
              borderRadius: 2, fontFamily: "inherit", opacity: dirty ? 1 : 0.7,
            }}
          >save</button>
        </div>
      </div>
    </div>
  );
}
