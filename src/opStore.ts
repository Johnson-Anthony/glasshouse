// Running long operations (hash, copy, find) as the UI sees them, without
// Tauri, so it's testable. ops.ts wires it to the backend's `op-progress`
// events and `cancel_op`; OpsTray renders it.
//
// One UI op can own several backend op ids: the inspector's three checksums
// run as three backend ops under one row and one Cancel.

import { errText } from "./errors";

/** The error a cancelled backend op rejects with (ops.rs `CANCELLED`). */
const OP_CANCELLED = "cancelled";

export function isCancelled(err: unknown): boolean {
  return errText(err) === OP_CANCELLED;
}

/** Payload of the backend's `op-progress` event. */
export interface OpProgress {
  op_id: string;
  done: number;
  /** Null when the size isn't known up front (a search counts files). */
  total: number | null;
}

/** What `done` and `total` count. */
export type OpUnit = "bytes" | "items";

export interface RunningOp {
  key: number;
  label: string;
  unit: OpUnit;
  startedAt: number;
  /** Summed over the op's backend ids. */
  done: number;
  /** Null until every backend id has reported a total. */
  total: number | null;
  cancelled: boolean;
}

interface Entry {
  label: string;
  unit: OpUnit;
  startedAt: number;
  ids: Map<string, { done: number; total: number | null }>;
  cancelled: boolean;
}

let idCounter = 0;
const idPrefix = `op-${Date.now().toString(36)}`;

/** A fresh backend op id, for a caller that doesn't need a tray row (the
 *  find panel cancels its own stale searches). */
export function newOpId(): string {
  idCounter += 1;
  return `${idPrefix}-${idCounter}`;
}

export class OpStore {
  private ops = new Map<number, Entry>();
  private owner = new Map<string, number>();
  private listeners = new Set<() => void>();
  private nextKey = 1;
  private snap: RunningOp[] = [];

  constructor(
    private cancelBackend: (opId: string) => void,
    private now: () => number = () => Date.now(),
  ) {}

  begin(label: string, unit: OpUnit = "bytes"): number {
    const key = this.nextKey++;
    this.ops.set(key, { label, unit, startedAt: this.now(), ids: new Map(), cancelled: false });
    this.changed();
    return key;
  }

  /** A new backend op id under `key`. Already cancelled if the op is, so a
   *  loop that starts its next item after a Cancel stops at once. */
  track(key: number): string {
    const id = newOpId();
    const e = this.ops.get(key);
    if (e) {
      e.ids.set(id, { done: 0, total: null });
      this.owner.set(id, key);
      if (e.cancelled) this.cancelBackend(id);
    }
    return id;
  }

  progress(p: OpProgress): void {
    const key = this.owner.get(p.op_id);
    const e = key === undefined ? undefined : this.ops.get(key);
    const cur = e?.ids.get(p.op_id);
    if (!e || !cur) return;
    // Parallel search threads can report slightly out of order.
    e.ids.set(p.op_id, { done: Math.max(cur.done, p.done), total: p.total });
    this.changed();
  }

  cancel(key: number): void {
    const e = this.ops.get(key);
    if (!e || e.cancelled) return;
    e.cancelled = true;
    for (const id of e.ids.keys()) this.cancelBackend(id);
    this.changed();
  }

  end(key: number): void {
    const e = this.ops.get(key);
    if (!e) return;
    for (const id of e.ids.keys()) this.owner.delete(id);
    this.ops.delete(key);
    this.changed();
  }

  /** Stable between changes, as useSyncExternalStore needs. */
  snapshot = (): RunningOp[] => this.snap;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  };

  private changed(): void {
    this.snap = Array.from(this.ops, ([key, e]) => {
      const parts = Array.from(e.ids.values());
      const known = parts.length > 0 && parts.every(p => p.total !== null);
      return {
        key,
        label: e.label,
        unit: e.unit,
        startedAt: e.startedAt,
        done: parts.reduce((n, p) => n + p.done, 0),
        total: known ? parts.reduce((n, p) => n + (p.total ?? 0), 0) : null,
        cancelled: e.cancelled,
      };
    });
    for (const fn of this.listeners) fn();
  }
}
