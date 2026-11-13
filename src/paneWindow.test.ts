import { describe, expect, it } from "vitest";
import { OVERSCAN, rowWindow, rowsInSpan, scrollToRow } from "./paneWindow";

// Ten 26px rows fill a 260px viewport.
const H = 26, VIEW = 260;

describe("rowWindow", () => {
  it("renders the rows in view plus the overscan below, at the top", () => {
    expect(rowWindow(1000, H, 0, VIEW)).toEqual({ start: 0, end: 10 + OVERSCAN });
  });

  it("covers the viewport with overscan on both sides, starting on an even row", () => {
    for (const first of [100, 101, 437]) {
      const w = rowWindow(1000, H, first * H + 5, VIEW);
      expect(w.start % 2).toBe(0);
      expect(w.start).toBeLessThanOrEqual(first - OVERSCAN);
      expect(w.start).toBeGreaterThan(first - OVERSCAN - 2);
      expect(w.end).toBe(first + 11 + OVERSCAN);
    }
  });

  it("stops at the ends of the list", () => {
    expect(rowWindow(15, H, 0, VIEW)).toEqual({ start: 0, end: 15 });
    expect(rowWindow(1000, H, 990 * H, VIEW)).toEqual({ start: 970, end: 1000 });
  });

  it("still renders the last rows for a scroll position left from a longer list", () => {
    const w = rowWindow(10, H, 5000 * H, VIEW);
    expect(w.end).toBe(10);
    expect(w.start).toBeLessThan(10);
  });

  it("renders nothing for an empty list or before the row height is known", () => {
    expect(rowWindow(0, H, 0, VIEW)).toEqual({ start: 0, end: 0 });
    expect(rowWindow(50, 0, 0, VIEW)).toEqual({ start: 0, end: 0 });
  });
});

describe("rowsInSpan", () => {
  it("takes the rows a span overlaps, not the ones it only touches", () => {
    expect(rowsInSpan(26, 52, H, 100)).toEqual([1, 1]);
    expect(rowsInSpan(25, 53, H, 100)).toEqual([0, 2]);
    expect(rowsInSpan(30, 30, H, 100)).toEqual([1, 1]);
  });

  it("clamps to the list, above it and below it", () => {
    expect(rowsInSpan(-500, 40, H, 100)).toEqual([0, 1]);
    expect(rowsInSpan(95 * H + 1, 99_999, H, 100)).toEqual([95, 99]);
    expect(rowsInSpan(100 * H + 1, 100 * H + 50, H, 100)).toBeNull();
    expect(rowsInSpan(-50, -10, H, 100)).toBeNull();
    expect(rowsInSpan(0, 50, H, 0)).toBeNull();
  });
});

describe("scrollToRow", () => {
  it("scrolls the least that shows the whole row, like block: nearest", () => {
    expect(scrollToRow(3, H, 0, VIEW)).toBeNull();
    expect(scrollToRow(9, H, 0, VIEW)).toBeNull();
    expect(scrollToRow(10, H, 0, VIEW)).toBe(11 * H - VIEW);
    expect(scrollToRow(999, H, 0, VIEW)).toBe(1000 * H - VIEW);
    expect(scrollToRow(4, H, 50 * H, VIEW)).toBe(4 * H);
    // Half hidden at the top.
    expect(scrollToRow(50, H, 50 * H + 10, VIEW)).toBe(50 * H);
  });
});
