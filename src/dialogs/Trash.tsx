import { useCallback, useEffect, useState } from "react";
import { trashList, trashPurge, trashRestore, type TrashEntry } from "../api";
import { formatDate } from "../components";
import { errText } from "../errors";
import { IS_WINDOWS } from "../platform";
import { markIrreversible, pushUndo } from "../state";
import { problemLines, sortTrash, trashKey, trashSizeText } from "../trashView";
import { restoreUndo } from "../undoActions";
import { dialogs } from "./DialogHost";
import { useModal } from "./modal";
import { useEscapeClose } from "./useEscapeClose";

// ============= TrashDialog =============
// Go → Trash: what's in the trash (the Recycle Bin on Windows), with Restore,
// Delete Permanently and Empty Trash. Restore puts items back at their
// original path only, and refuses one whose name is taken there now.
export interface TrashDialogProps {
  onClose: () => void;
  /** Something was restored or deleted: refresh the panes. */
  onChanged: () => void;
  /** Linux: browse the trash folder itself, as Go → Trash used to. */
  onBrowseFolder?: () => void;
}

const BIN = IS_WINDOWS ? "Recycle Bin" : "Trash";

// Columns: check, name, original folder, deleted, size.
const ROW = {
  display: "grid", gridTemplateColumns: "3ch minmax(0, 1.2fr) minmax(0, 1.6fr) 17ch 10ch", gap: 8, alignItems: "center",
} as const;

const button = (enabled: boolean, color = "var(--fg-1)") => ({
  background: "transparent", border: "1px solid var(--fg-3)", color,
  padding: "4px 12px", cursor: enabled ? "pointer" : "not-allowed",
  borderRadius: 2, fontFamily: "inherit", opacity: enabled ? 1 : 0.5,
});

export function TrashDialog({ onClose, onChanged, onBrowseFolder }: TrashDialogProps) {
  const [entries, setEntries] = useState<TrashEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  // A restore or delete running, or its question showing: Escape belongs
  // to the question then, and the buttons wait.
  const [busy, setBusy] = useState(false);

  useEscapeClose(onClose, !busy);
  useModal();

  const load = useCallback(async () => {
    try {
      const list = sortTrash(await trashList());
      setEntries(list);
      setError(null);
      setSelected(prev => new Set(list.filter(e => prev.has(e.id)).map(e => e.id)));
    } catch (e) {
      setEntries([]);
      setError(errText(e));
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const shown = entries ?? [];
  const chosen = shown.filter(e => selected.has(e.id));
  const toggle = (id: string) => setSelected(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const allSelected = shown.length > 0 && chosen.length === shown.length;

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    try {
      await work();
    } catch (e) {
      void dialogs.showAlert({ title: BIN.toLowerCase(), variant: "error", message: errText(e) });
    } finally {
      setBusy(false);
      onChanged();
      await load();
    }
  };

  const restore = () => run(async () => {
    const res = await trashRestore(chosen.map(trashKey), false);
    if (res.done.length > 0) {
      pushUndo(restoreUndo(`restore ${res.done.length} item(s) from the ${BIN}`, res.done));
      dialogs.showToast({ message: `restored ${res.done.length} item(s)`, variant: "success" });
    }
    if (res.problems.length > 0) {
      void dialogs.showAlert({
        title: `couldn't restore ${res.problems.length} item(s)`,
        variant: "error",
        message: problemLines(res.problems),
      });
    }
  });

  const purge = (items: TrashEntry[], all: boolean) => run(async () => {
    const ok = await dialogs.showConfirm({
      title: all ? "empty trash" : "delete permanently",
      message: all
        ? `Permanently delete all ${items.length} item(s) in the ${BIN}? This cannot be undone.`
        : `Permanently delete ${items.length} item(s) from the ${BIN}? This cannot be undone.`,
      danger: true,
      okLabel: all ? "empty" : "delete",
    });
    if (!ok) return;
    const res = await trashPurge(items.map(trashKey));
    if (res.done.length > 0) {
      markIrreversible(`delete ${res.done.length} item(s) from the ${BIN}`);
      dialogs.showToast({ message: `deleted ${res.done.length} item(s) permanently`, variant: "success" });
    }
    if (res.problems.length > 0) {
      void dialogs.showAlert({
        title: `couldn't delete ${res.problems.length} item(s)`,
        variant: "error",
        message: problemLines(res.problems),
      });
    }
  });

  const can = !busy && chosen.length > 0;
  return (
    <div onClick={busy ? undefined : onClose} style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)",
      zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      <div onClick={(e) => e.stopPropagation()} role="dialog" aria-label={BIN} style={{
        width: "100ch", maxWidth: "95vw", maxHeight: "80vh",
        background: "var(--bg-1, #1a1b26)", border: "1px solid var(--fg-3)",
        borderRadius: 4, display: "flex", flexDirection: "column",
        fontFamily: "var(--font-mono)", color: "var(--fg-1)",
      }}>
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "8px 12px", borderBottom: "1px solid var(--fg-3)",
          background: "var(--bg-2, #16161e)",
        }}>
          <span style={{ color: "var(--accent)" }}># {BIN.toLowerCase()}</span>
          <button onClick={onClose} disabled={busy} style={{ ...button(!busy), padding: "2px 8px" }}>×</button>
        </div>
        <div style={{
          display: "flex", alignItems: "center", gap: 12,
          padding: "6px 12px", borderBottom: "1px solid var(--fg-3)", fontSize: 11, color: "var(--fg-3)",
        }}>
          <span>
            {entries === null ? "reading…" : `${shown.length} item(s)`}
            {chosen.length > 0 ? ` · ${chosen.length} selected` : ""}
          </span>
          {shown.length > 0 && (
            <a href="#" onClick={(e) => {
              e.preventDefault();
              setSelected(allSelected ? new Set() : new Set(shown.map(x => x.id)));
            }} style={{ color: "var(--accent)" }}>{allSelected ? "select none" : "select all"}</a>
          )}
        </div>
        {shown.length > 0 && (
          <div style={{ ...ROW, padding: "4px 15px 0", fontSize: 10, color: "var(--fg-3)", textTransform: "uppercase" }}>
            <span />
            <span>name</span>
            <span>from</span>
            <span>deleted</span>
            <span style={{ textAlign: "right" }}>size</span>
          </div>
        )}
        <div style={{ overflow: "auto", flex: 1, padding: 6, display: "flex", flexDirection: "column", gap: 2 }}>
          {error &&<div style={{ color: "var(--red, #f7768e)", padding: 12 }}>couldn't read the {BIN}: {error}</div>}
          {entries !== null && !error && shown.length === 0 && (
            <div style={{ color: "var(--fg-3)", padding: 12, fontStyle: "italic", textAlign: "center" }}>
              the {BIN.toLowerCase()} is empty
            </div>
          )}
          {shown.map(e => {
            const on = selected.has(e.id);
            return (
              <div key={e.id} data-trash-row={e.name} onClick={() => toggle(e.id)} title={e.original} style={{
                ...ROW, padding: "4px 8px", borderRadius: 2, cursor: "pointer", fontSize: 12,
                background: on ? "var(--bg-3, #24283b)" : "var(--bg-0, #0f0f14)",
                border: `1px solid ${on ? "var(--accent)" : "transparent"}`,
              }}>
                <span style={{ color: on ? "var(--accent)" : "var(--fg-3)" }}>{on ? "[x]" : "[ ]"}</span>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {e.name}{e.entries !== null ? "/" : ""}
                </span>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--fg-3)" }}>
                  {e.original_parent}
                </span>
                <span style={{ color: "var(--fg-3)" }}>{formatDate(e.deleted * 1000)}</span>
                <span style={{ color: "var(--fg-3)", textAlign: "right" }}>{trashSizeText(e)}</span>
              </div>
            );
          })}
        </div>
        <div style={{
          padding: "8px 12px", borderTop: "1px solid var(--fg-3)",
          display: "flex", alignItems: "center", gap: 6,
          background: "var(--bg-2, #16161e)",
        }}>
          {onBrowseFolder && (
            <a href="#" onClick={(e) => { e.preventDefault(); onBrowseFolder(); }}
              style={{ color: "var(--fg-3)", fontSize: 11 }}>open the trash folder</a>
          )}
          <span style={{ flex: 1 }} />
          <button onClick={() => void purge(shown, true)} disabled={busy || shown.length === 0}
            style={button(!busy && shown.length > 0, "var(--red, #f7768e)")}>empty {BIN.toLowerCase()}</button>
          <button onClick={() => void purge(chosen, false)} disabled={!can}
            style={button(can, "var(--red, #f7768e)")}>delete permanently</button>
          <button onClick={() => void restore()} disabled={!can} style={{
            ...button(can, can ? "var(--bg-0)" : "var(--fg-3)"),
            background: can ? "var(--accent)" : "transparent", border: "1px solid var(--accent)",
          }}>restore</button>
        </div>
      </div>
    </div>
  );
}
