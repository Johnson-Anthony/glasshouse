import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { REFRESH_GAP_MS, RefreshGate } from "./refreshGate";

/** A gate whose listings take `ms` each, recording when each one started
 *  and with what. */
function listings(ms: number) {
  const starts: { at: number; args: string }[] = [];
  const gate = new RefreshGate<string>(args => {
    starts.push({ at: Date.now(), args });
    return new Promise(resolve => setTimeout(resolve, ms));
  });
  return { gate, starts };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(10_000);
});
afterEach(() => vi.useRealTimers());

const at = (starts: { at: number }[]) => starts.map(s => s.at - 10_000);

describe("RefreshGate", () => {
  it("starts a refresh at once when nothing is running", () => {
    const { gate, starts } = listings(100);
    gate.refresh("a");
    expect(starts).toEqual([{ at: 10_000, args: "a" }]);
  });

  it("turns refreshes during a listing into one, the gap after it ends, with the latest arguments", async () => {
    const { gate, starts } = listings(100);
    gate.refresh("1");
    await vi.advanceTimersByTimeAsync(50);
    gate.refresh("2");
    gate.refresh("3");
    await vi.advanceTimersByTimeAsync(2000);
    expect(at(starts)).toEqual([0, 100 + REFRESH_GAP_MS]);
    expect(starts[1].args).toBe("3");
  });

  it("holds a refresh that comes soon after a listing ended", async () => {
    const { gate, starts } = listings(100);
    gate.refresh("1");
    await vi.advanceTimersByTimeAsync(300);
    gate.refresh("2");
    expect(starts).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(2000);
    expect(at(starts)).toEqual([0, 600]);
    // Long after, a refresh goes straight through again.
    gate.refresh("3");
    expect(at(starts)).toEqual([0, 600, 2300]);
  });

  it("doesn't hold a navigation, and drops the refresh queued for the folder it left", async () => {
    const { gate, starts } = listings(100);
    gate.refresh("old");
    await vi.advanceTimersByTimeAsync(50);
    gate.refresh("old again");
    gate.start("new");
    expect(starts.map(s => s.args)).toEqual(["old", "new"]);
    await vi.advanceTimersByTimeAsync(2000);
    expect(starts).toHaveLength(2);
  });

  it("waits for every running listing before the trailing one", async () => {
    const { gate, starts } = listings(100);
    gate.start("a");
    await vi.advanceTimersByTimeAsync(80);
    gate.start("b");
    gate.refresh("c");
    // "a" ends at 100, "b" at 180: "c" runs the gap after 180.
    await vi.advanceTimersByTimeAsync(2000);
    expect(at(starts)).toEqual([0, 80, 180 + REFRESH_GAP_MS]);
  });

  it("forgets the queued refresh when cancelled", async () => {
    const { gate, starts } = listings(100);
    gate.refresh("1");
    gate.refresh("2");
    gate.cancel();
    await vi.advanceTimersByTimeAsync(2000);
    expect(starts).toHaveLength(1);
  });

  it("goes on after a listing that fails", async () => {
    const starts: number[] = [];
    const gate = new RefreshGate<string>(() => {
      starts.push(Date.now());
      return Promise.reject(new Error("gone"));
    });
    gate.refresh("1");
    gate.refresh("2");
    await vi.advanceTimersByTimeAsync(2000);
    expect(starts).toHaveLength(2);
  });

  it("lists about twice a second through a paste's stream of reports, and last after the last one", async () => {
    // The watcher reports every 75 ms for 3 s; each listing takes 100 ms.
    const reports = Array.from({ length: 40 }, (_, i) => i * 75);
    const { gate, starts } = listings(100);
    for (const t of reports) {
      await vi.advanceTimersByTimeAsync(t - (Date.now() - 10_000));
      gate.refresh(`after ${t}`);
    }
    await vi.advanceTimersByTimeAsync(5000);
    // Ungated, that was one listing (and one git status) per report: 40.
    expect(at(starts)).toEqual([0, 600, 1200, 1800, 2400, 3000]);
    expect(starts.at(-1)!.args).toBe(`after ${reports.at(-1)}`);
  });
});
