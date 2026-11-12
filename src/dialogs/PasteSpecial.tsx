import { useState } from "react";
import { hashSha256 } from "../api";
import { isCancelled, runOp } from "../ops";
import { basename } from "../paths";
import type { SkipReason, TransferItem, TransferOp, TransferStep } from "../transfer";
import { errText } from "../errors";
import { pushUndo } from "../state";
import { copyUndo, moveUndo, type PathPair } from "../undoActions";
import { useEscapeClose } from "./useEscapeClose";
import { useModal } from "./modal";

// ============= Paste Special dialog =============

export interface PasteSpecialItem {
  /** Absolute source path. */
  path: string;
  /** FileEntry.kind — "folder" means skip hash verify. */
  kind: string;
}

export type PasteSpecialMode = "move" | "copy" | "copy-verify";

export interface PasteSpecialDialogProps {
  items: PasteSpecialItem[];
  /** Destination directory (active pane cwd). */
  dstDir: string;
  /** Clipboard mode at time of open — "cut" clears clipboard on success. */
  clipboardMode: "copy" | "cut";
  copyEntry: (from: string, to: string) => Promise<void>;
  moveEntry: (from: string, to: string) => Promise<void>;
  trashEntry: (path: string) => Promise<void>;
  /** Picks each item's destination (and asks about conflicts); one step per
   *  item, null if the user cancelled. Rejects if dstDir can't be listed. */
  planTransfer: (items: TransferItem[], dstDir: string, op: TransferOp) => Promise<TransferStep[] | null>;
  onClose: () => void;
  /** Called after completion with whether clipboard should be cleared and refresh requested. */
  onDone: (clearClipboard: boolean) => void;
}

interface RowStatus {
  path: string;
  name: string;
  kind: string;
  /** pending | running | ok | fail */
  state: "pending" | "running" | "ok" | "fail";
  message?: string;
}

const SKIP_TEXT: Record<SkipReason, string> = {
  "same-place": "already here",
  "conflict": "skipped (exists)",
  "into-itself": "can't go inside itself",
};


export function PasteSpecialDialog({
  items,
  dstDir,
  clipboardMode,
  copyEntry,
  moveEntry,
  trashEntry,
  planTransfer,
  onClose,
  onDone,
}: PasteSpecialDialogProps) {
  const [mode, setMode] = useState<PasteSpecialMode>(
    clipboardMode === "cut" ? "move" : "copy",
  );
  const [running, setRunning] = useState(false);
  const [rows, setRows] = useState<RowStatus[]>(() =>
    items.map(it => ({
      path: it.path,
      name: basename(it.path),
      kind: it.kind,
      state: "pending" as const,
    })),
  );

  useEscapeClose(onClose, !running);
  useModal();

  const preview = items.slice(0, 5).map(it => basename(it.path));
  const extra = items.length > 5 ? items.length - 5 : 0;

  const run = async () => {
    if (running || items.length === 0) return;
    setRunning(true);
    let steps: TransferStep[] | null;
    try {
      steps = await planTransfer(
        items.map(it => ({ path: it.path, isDir: it.kind === "folder" })),
        dstDir,
        mode === "move" ? "move" : "copy",
      );
    } catch (e) {
      const msg = `can't read ${dstDir}: ${errText(e)}`;
      setRows(rows.map(r => ({ ...r, state: "fail", message: msg })));
      setRunning(false);
      return;
    }
    if (!steps) { setRunning(false); return; }
    let anyFail = false;
    // What was copied or moved, for the undo entry. A copy whose hash didn't
    // match is still a copy.
    const done: PathPair[] = [];
    // Local mutable copy so we can update rows incrementally.
    const working: RowStatus[] = rows.map(r => ({ ...r, state: "pending", message: undefined }));
    setRows(working.slice());
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const step = steps[i];
      if (step.action === "skip") {
        const fail = step.reason === "into-itself";
        anyFail ||= fail;
        working[i] = { ...working[i], state: fail ? "fail" : "ok", message: SKIP_TEXT[step.reason] };
        setRows(working.slice());
        continue;
      }
      const dst = step.dst;
      // Say so when the item landed under another name or replaced one.
      const note = (basename(dst) !== basename(it.path) ? ` as ${basename(dst)}` : "") +
        (step.replace ? " (old one trashed)" : "");
      working[i] = { ...working[i], state: "running" };
      setRows(working.slice());
      try {
        if (step.replace) await trashEntry(step.replace);
        if (mode === "move") {
          await moveEntry(it.path, dst);
          done.push({ src: it.path, dst });
          working[i] = { ...working[i], state: "ok", message: "moved" + note };
        } else if (mode === "copy") {
          await copyEntry(it.path, dst);
          done.push({ src: it.path, dst });
          working[i] = { ...working[i], state: "ok", message: "copied" + note };
        } else {
          // copy + verify
          await copyEntry(it.path, dst);
          done.push({ src: it.path, dst });
          if (it.kind === "folder") {
            working[i] = { ...working[i], state: "ok", message: `copied${note} (dir — not hashed)` };
          } else {
            const [h1, h2] = await runOp(`verifying ${basename(dst)}`, track =>
              Promise.all([hashSha256(it.path, track()), hashSha256(dst, track())]));
            if (h1 === h2) {
              working[i] = { ...working[i], state: "ok", message: `ok${note} ${h1.slice(0, 12)}…` };
            } else {
              anyFail = true;
              working[i] = { ...working[i], state: "fail", message: `FAIL hash mismatch` };
            }
          }
        }
      } catch (e) {
        anyFail = true;
        if (isCancelled(e)) {
          // Cancelled from the tray: this item and the rest don't happen.
          for (let j = i; j < items.length; j++) {
            working[j] = { ...working[j], state: "fail", message: "cancelled" };
          }
          setRows(working.slice());
          break;
        }
        const msg = errText(e);
        working[i] = { ...working[i], state: "fail", message: msg };
      }
      setRows(working.slice());
    }
    if (done.length > 0) {
      // As for Paste: replaced entries stay in the trash.
      const label = `paste special: ${mode === "move" ? "move" : "copy"} ${done.length} item(s)`;
      pushUndo(mode === "move" ? moveUndo(label, done, "move") : copyUndo(label, done));
    }
    setRunning(false);
    // Only clear clipboard for cut+move when nothing failed; mirrors vanilla Paste.
    const clear = clipboardMode === "cut" && mode === "move" && !anyFail;
    onDone(clear);
  };

  const doneCount = rows.filter(r => r.state === "ok" || r.state === "fail").length;
  const failCount = rows.filter(r => r.state === "fail").length;
  const allDone = !running && doneCount === rows.length && rows.length > 0;

  const radioRow = (value: PasteSpecialMode, label: string, hint: string) => (
    <label
      key={value}
      style={{
        display: "flex", alignItems: "flex-start", gap: 8, padding: "4px 0",
        cursor: running ? "not-allowed" : "pointer", opacity: running ? 0.6 : 1,
      }}
    >
      <input
        type="radio"
        name="paste-special-mode"
        checked={mode === value}
        onChange={() => setMode(value)}
        disabled={running}
        style={{ marginTop: 3 }}
      />
      <span style={{ display: "flex", flexDirection: "column" }}>
        <span style={{ fontSize: 13 }}>{label}</span>
        <span style={{ fontSize: 11, color: "var(--fg-3)" }}>{hint}</span>
      </span>
    </label>
  );

  const statusColor = (s: RowStatus["state"]): string => {
    switch (s) {
      case "ok": return "var(--green, #9ece6a)";
      case "fail": return "var(--red, #f7768e)";
      case "running": return "var(--accent)";
      default: return "var(--fg-3)";
    }
  };
  const statusGlyph = (s: RowStatus["state"]): string => {
    switch (s) {
      case "ok": return "✓";
      case "fail": return "✗";
      case "running": return "…";
      default: return "·";
    }
  };

  return (
    <div
      onClick={() => { if (!running) onClose(); }}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)",
        zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "80ch", maxWidth: "95vw", maxHeight: "90vh",
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
            ⎘ paste special · {items.length} item{items.length === 1 ? "" : "s"}
          </span>
          <span style={{ color: "var(--fg-3)", fontSize: 12 }}>
            {running
              ? `working ${doneCount}/${rows.length}…`
              : allDone
                ? failCount > 0
                  ? `${failCount} failed / ${rows.length}`
                  : `done · ${rows.length}`
                : `clipboard: ${clipboardMode}`}
          </span>
          <button
            onClick={onClose}
            disabled={running}
            style={{
              background: "transparent", border: "1px solid var(--fg-3)", color: "var(--fg-1)",
              padding: "2px 8px", cursor: running ? "not-allowed" : "pointer", borderRadius: 2,
            }}
          >×</button>
        </div>

        <div style={{
          padding: "10px 12px", borderBottom: "1px solid var(--fg-3)",
          display: "flex", flexDirection: "column", gap: 6, fontSize: 12,
        }}>
          <div>
            <span style={{ color: "var(--fg-3)" }}>source{items.length === 1 ? "" : "s"}: </span>
            <span>
              {preview.join(", ")}
              {extra > 0 ? ` +${extra} more` : ""}
            </span>
          </div>
          <div>
            <span style={{ color: "var(--fg-3)" }}>destination: </span>
            <span>{dstDir || "(unknown)"}</span>
          </div>
        </div>

        <div style={{
          padding: "10px 12px", borderBottom: "1px solid var(--fg-3)",
          display: "flex", flexDirection: "column", gap: 2,
        }}>
          {radioRow("move", "Move", "rename/relocate — backend moveEntry")}
          {radioRow("copy", "Copy", "duplicate — backend copyEntry")}
          {radioRow("copy-verify", "Copy + verify SHA256",
            "copy then hash both sides and compare (files only; dirs skipped)")}
        </div>

        <div style={{ overflow: "auto", flex: 1, fontSize: 12, lineHeight: 1.5 }}>
          <div style={{
            display: "grid", gridTemplateColumns: "2ch 1fr 24ch",
            padding: "4px 12px", color: "var(--fg-3)",
            borderBottom: "1px solid var(--fg-3)", position: "sticky", top: 0,
            background: "var(--bg-2, #16161e)", gap: 8,
          }}>
            <span></span>
            <span>source</span>
            <span>status</span>
          </div>
          {rows.map((r, i) => (
            <div key={i} style={{
              display: "grid", gridTemplateColumns: "2ch 1fr 24ch",
              padding: "2px 12px", gap: 8,
              background: r.state === "fail" ? "rgba(255,80,80,0.12)" : "transparent",
            }}>
              <span style={{ color: statusColor(r.state) }}>{statusGlyph(r.state)}</span>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {r.name}{r.kind === "folder" ? "/" : ""}
              </span>
              <span style={{
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                color: statusColor(r.state),
              }}>
                {r.message ?? (r.state === "pending" ? "pending" : r.state)}
              </span>
            </div>
          ))}
        </div>

        <div style={{
          display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8,
          padding: "8px 12px", borderTop: "1px solid var(--fg-3)",
          background: "var(--bg-2, #16161e)",
        }}>
          {failCount > 0 && !running && (
            <span style={{ color: "var(--red, #f7768e)", fontSize: 12, marginRight: "auto" }}>
              {failCount} failure{failCount === 1 ? "" : "s"} — see rows above
            </span>
          )}
          <button
            onClick={onClose}
            disabled={running}
            style={{
              background: "transparent", border: "1px solid var(--fg-3)", color: "var(--fg-1)",
              padding: "4px 12px", cursor: running ? "not-allowed" : "pointer",
              borderRadius: 2, fontFamily: "var(--font-mono)", fontSize: 12,
            }}
          >{allDone ? "close" : "cancel"}</button>
          <button
            onClick={run}
            disabled={running || items.length === 0 || allDone}
            style={{
              background: (running || allDone) ? "var(--bg-0, #0f0f14)" : "var(--accent)",
              color: (running || allDone) ? "var(--fg-3)" : "var(--bg-0, #0f0f14)",
              border: "1px solid var(--accent)",
              padding: "4px 12px",
              cursor: (running || allDone) ? "not-allowed" : "pointer",
              borderRadius: 2, fontFamily: "var(--font-mono)", fontSize: 12,
              fontWeight: 600,
            }}
          >
            {running
              ? `working ${doneCount}/${rows.length}…`
              : mode === "move"
                ? `move ${items.length} item${items.length === 1 ? "" : "s"}`
                : mode === "copy"
                  ? `copy ${items.length} item${items.length === 1 ? "" : "s"}`
                  : `copy + verify ${items.length}`}
          </button>
        </div>
      </div>
    </div>
  );
}
