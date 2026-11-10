import { describe, expect, it } from "vitest";
import { isCancelled, OpStore } from "./opStore";

function store() {
  const cancelled: string[] = [];
  let now = 1000;
  const s = new OpStore(id => cancelled.push(id), () => now);
  return { s, cancelled, tick: (ms: number) => { now += ms; } };
}

describe("OpStore", () => {
  it("sums progress over an op's backend ids", () => {
    const { s } = store();
    const key = s.begin("hashing big.iso");
    const [a, b] = [s.track(key), s.track(key)];
    expect(s.snapshot()[0]).toMatchObject({ label: "hashing big.iso", done: 0, total: null, unit: "bytes" });

    s.progress({ op_id: a, done: 10, total: 100 });
    // b hasn't reported a total yet.
    expect(s.snapshot()[0]).toMatchObject({ done: 10, total: null });
    s.progress({ op_id: b, done: 30, total: 100 });
    expect(s.snapshot()[0]).toMatchObject({ done: 40, total: 200 });
    // An older event that arrives late doesn't move it backwards.
    s.progress({ op_id: a, done: 5, total: 100 });
    expect(s.snapshot()[0].done).toBe(40);
  });

  it("cancels every id, including ones tracked after the cancel", () => {
    const { s, cancelled } = store();
    const key = s.begin("copying stuff");
    const a = s.track(key);
    s.cancel(key);
    expect(cancelled).toEqual([a]);
    expect(s.snapshot()[0].cancelled).toBe(true);
    const late = s.track(key);
    expect(cancelled).toEqual([a, late]);
    s.cancel(key); // a second click does nothing more
    expect(cancelled).toEqual([a, late]);
  });

  it("forgets an op when it ends, and ignores its later events", () => {
    const { s } = store();
    const key = s.begin("finding x", "items");
    const id = s.track(key);
    let changes = 0;
    const unsubscribe = s.subscribe(() => { changes++; });
    const before = s.snapshot();
    s.end(key);
    expect(s.snapshot()).toEqual([]);
    expect(s.snapshot()).not.toBe(before);
    s.progress({ op_id: id, done: 3, total: null });
    expect(changes).toBe(1);
    unsubscribe();
  });

  it("keeps the snapshot identical between changes", () => {
    const { s, tick } = store();
    const key = s.begin("op");
    const snap = s.snapshot();
    tick(500);
    expect(s.snapshot()).toBe(snap);
    expect(snap[0].startedAt).toBe(1000);
    s.end(key);
  });

  it("gives distinct ids", () => {
    const { s } = store();
    const key = s.begin("op");
    expect(new Set([s.track(key), s.track(key), s.track(key)]).size).toBe(3);
  });
});

describe("isCancelled", () => {
  it("matches the backend's cancel error only", () => {
    expect(isCancelled("cancelled")).toBe(true);
    expect(isCancelled(new Error("cancelled"))).toBe(true);
    expect(isCancelled("permission denied")).toBe(false);
    expect(isCancelled(undefined)).toBe(false);
  });
});
