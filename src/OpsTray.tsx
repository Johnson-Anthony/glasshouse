// Running hashes, copies and searches, bottom left, each with a Cancel. An op
// shows up only once it has run for SHOW_AFTER_MS, so quick ones don't flash.
import { useEffect, useState, useSyncExternalStore } from "react";
import { opStore } from "./ops";
import type { RunningOp } from "./opStore";

const SHOW_AFTER_MS = 400;

function formatBytes(n: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${i === 0 ? v : v.toFixed(1)} ${units[i]}`;
}

/** "41% · 1.2 GB of 2.9 GB", or a count when the size isn't known. */
export function progressText(op: Pick<RunningOp, "done" | "total" | "unit">): string {
  if (op.total === null) {
    return op.unit === "items" ? `${op.done.toLocaleString()} looked at` : formatBytes(op.done);
  }
  const pct = op.total > 0 ? Math.min(100, Math.floor((op.done / op.total) * 100)) : 100;
  return op.unit === "bytes"
    ? `${pct}% · ${formatBytes(op.done)} of ${formatBytes(op.total)}`
    : `${pct}%`;
}

export function OpsTray() {
  const ops = useSyncExternalStore(opStore.subscribe, opStore.snapshot);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (ops.length === 0) return;
    const id = window.setInterval(() => setNow(Date.now()), 200);
    return () => window.clearInterval(id);
  }, [ops.length]);

  const shown = ops.filter(op => now - op.startedAt >= SHOW_AFTER_MS);
  if (shown.length === 0) return null;
  return (
    <div className="ops-tray" role="status" aria-live="polite">
      {shown.map(op => {
        const pct = op.total ? Math.min(100, (op.done / op.total) * 100) : null;
        return (
          <div key={op.key} className="ops-row">
            <div className="ops-head">
              <span className="ops-label" title={op.label}>{op.label}</span>
              <button
                className="ops-cancel"
                disabled={op.cancelled}
                onClick={() => opStore.cancel(op.key)}
              >
                {op.cancelled ? "cancelling…" : "cancel"}
              </button>
            </div>
            <div className="ops-bar" data-indeterminate={pct === null || undefined}>
              <div style={pct === null ? undefined : { width: `${pct}%` }} />
            </div>
            <div className="ops-detail">{progressText(op)}</div>
          </div>
        );
      })}
    </div>
  );
}
