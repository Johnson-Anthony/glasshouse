import React, { useState } from "react";
import type { SavedRemote } from "../Sidebar";
import { dialogs } from "./DialogHost";
import { useEscapeClose } from "./useEscapeClose";

// ============= ManageRemotesDialog =============
export interface ManageRemotesDialogProps {
  remotes: SavedRemote[];
  onClose: () => void;
  onRemove: (idx: number) => void;
  onEdit?: (idx: number, next: SavedRemote) => void;
  onAdd: () => void;
}

export function ManageRemotesDialog({ remotes, onClose, onRemove, onEdit, onAdd }: ManageRemotesDialogProps) {
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [draft, setDraft] = useState<SavedRemote>({ label: "", host: "", path: "" });

  useEscapeClose(onClose);

  const beginEdit = (i: number) => {
    const r = remotes[i];
    if (!r) return;
    setDraft({ label: r.label, host: r.host, path: r.path });
    setEditingIdx(i);
  };

  const commitEdit = () => {
    if (editingIdx == null) return;
    const label = draft.label.trim();
    const host = draft.host.trim();
    const path = draft.path.trim();
    if (!label || !host) return;
    onEdit?.(editingIdx, { label, host, path });
    setEditingIdx(null);
  };

  const cancelEdit = () => {
    setEditingIdx(null);
  };

  const requestRemove = async (i: number) => {
    const r = remotes[i];
    if (!r) return;
    const ok = await dialogs.showConfirm({
      title: "remove remote",
      message: `Remove "${r.label}"?`,
      danger: true,
      okLabel: "remove",
    });
    if (!ok) return;
    if (editingIdx === i) setEditingIdx(null);
    onRemove(i);
  };

  const inputStyle: React.CSSProperties = {
    background: "var(--bg-0, #0f0f14)", color: "var(--fg-1)",
    border: "1px solid var(--fg-3)", borderRadius: 2,
    padding: "3px 6px", fontFamily: "var(--font-mono)", fontSize: 12,
    outline: "none", minWidth: 0, width: "100%",
  };

  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)",
      zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        width: "68ch", maxWidth: "95vw", maxHeight: "80vh",
        background: "var(--bg-1, #1a1b26)", border: "1px solid var(--fg-3)",
        borderRadius: 4, display: "flex", flexDirection: "column",
        fontFamily: "var(--font-mono)", color: "var(--fg-1)",
      }}>
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "8px 12px", borderBottom: "1px solid var(--fg-3)",
          background: "var(--bg-2, #16161e)",
        }}>
          <span style={{ color: "var(--accent)" }}>⌁ manage remotes</span>
          <button onClick={onClose} style={{
            background: "transparent", border: "1px solid var(--fg-3)", color: "var(--fg-1)",
            padding: "2px 8px", cursor: "pointer", borderRadius: 2,
          }}>×</button>
        </div>
        <div style={{ padding: "6px 12px", borderBottom: "1px solid var(--fg-3)", fontSize: 11, color: "var(--fg-3)" }}>
          {remotes.length} remote{remotes.length === 1 ? "" : "s"}
        </div>
        <div style={{ overflow: "auto", flex: 1, padding: "6px 6px", display: "flex", flexDirection: "column", gap: 2 }}>
          {remotes.length === 0 && (
            <div style={{ color: "var(--fg-3)", padding: "12px", fontStyle: "italic", textAlign: "center" }}>
              no saved remotes — add one via the + button
            </div>
          )}
          {remotes.map((r, i) => {
            const isEditing = editingIdx === i;
            if (isEditing) {
              const canSave = draft.label.trim().length > 0 && draft.host.trim().length > 0;
              return (
                <div key={"edit-" + i} style={{
                  display: "grid", gridTemplateColumns: "14ch 1fr 1fr auto auto",
                  alignItems: "center", gap: 6,
                  padding: "4px 8px", borderRadius: 2,
                  background: "var(--bg-0, #0f0f14)",
                  border: "1px solid var(--accent)",
                }}>
                  <input
                    value={draft.label}
                    onChange={(e) => setDraft(d => ({ ...d, label: e.target.value }))}
                    placeholder="label"
                    style={inputStyle}
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && canSave) { e.preventDefault(); commitEdit(); }
                      else if (e.key === "Escape") { e.preventDefault(); cancelEdit(); }
                    }}
                  />
                  <input
                    value={draft.host}
                    onChange={(e) => setDraft(d => ({ ...d, host: e.target.value }))}
                    placeholder="user@host"
                    style={inputStyle}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && canSave) { e.preventDefault(); commitEdit(); }
                      else if (e.key === "Escape") { e.preventDefault(); cancelEdit(); }
                    }}
                  />
                  <input
                    value={draft.path}
                    onChange={(e) => setDraft(d => ({ ...d, path: e.target.value }))}
                    placeholder="/path (optional)"
                    style={inputStyle}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && canSave) { e.preventDefault(); commitEdit(); }
                      else if (e.key === "Escape") { e.preventDefault(); cancelEdit(); }
                    }}
                  />
                  <button
                    onClick={commitEdit}
                    disabled={!canSave}
                    title="save"
                    style={{
                      background: canSave ? "var(--accent)" : "transparent",
                      border: "1px solid " + (canSave ? "var(--accent)" : "var(--fg-3)"),
                      color: canSave ? "var(--bg-0)" : "var(--fg-3)",
                      padding: "1px 8px", cursor: canSave ? "pointer" : "not-allowed",
                      borderRadius: 2, fontFamily: "inherit", fontSize: 11,
                    }}
                  >save</button>
                  <button
                    onClick={cancelEdit}
                    title="cancel"
                    style={{
                      background: "transparent", border: "1px solid var(--fg-3)", color: "var(--fg-1)",
                      padding: "1px 8px", cursor: "pointer",
                      borderRadius: 2, fontFamily: "inherit", fontSize: 11,
                    }}
                  >×</button>
                </div>
              );
            }
            return (
              <div key={`${i}-${r.label}`} style={{
                display: "flex", alignItems: "center", gap: 6,
                padding: "4px 8px", borderRadius: 2,
                background: "var(--bg-0, #0f0f14)",
                border: "1px solid transparent",
              }}>
                <span style={{
                  color: "var(--fg-3)", fontSize: 11, minWidth: "2ch", textAlign: "right",
                }}>{i + 1}</span>
                <div style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
                  <div style={{
                    color: "var(--fg-1)", fontSize: 12,
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>{r.label}</div>
                  <div style={{
                    color: "var(--fg-3)", fontSize: 10,
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>{r.host}{r.path ? " · " + r.path : ""}</div>
                </div>
                {onEdit && (
                  <button
                    onClick={() => beginEdit(i)}
                    title="edit"
                    style={{
                      background: "transparent", border: "1px solid var(--fg-3)", color: "var(--fg-1)",
                      padding: "1px 8px", cursor: "pointer",
                      borderRadius: 2, fontFamily: "inherit", fontSize: 11,
                    }}
                  >edit</button>
                )}
                <button
                  onClick={() => { void requestRemove(i); }}
                  title="remove remote"
                  style={{
                    background: "transparent", border: "1px solid var(--fg-3)", color: "var(--red, #f7768e)",
                    padding: "1px 8px", cursor: "pointer",
                    borderRadius: 2, fontFamily: "inherit", fontSize: 11,
                  }}
                >×</button>
              </div>
            );
          })}
        </div>
        <div style={{
          padding: "8px 12px", borderTop: "1px solid var(--fg-3)",
          display: "flex", justifyContent: "space-between", gap: 6,
          background: "var(--bg-2, #16161e)",
        }}>
          <button
            onClick={onAdd}
            title="add remote"
            style={{
              background: "transparent", border: "1px solid var(--accent)", color: "var(--accent)",
              padding: "4px 12px", cursor: "pointer", borderRadius: 2, fontFamily: "inherit",
            }}
          >+ add remote</button>
          <button onClick={onClose} style={{
            background: "transparent", border: "1px solid var(--fg-3)", color: "var(--fg-1)",
            padding: "4px 12px", cursor: "pointer", borderRadius: 2, fontFamily: "inherit",
          }}>close</button>
        </div>
      </div>
    </div>
  );
}
