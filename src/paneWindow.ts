// Index arithmetic for the file pane's windowed list. In the list display
// modes every row is one fixed height in a single column, so which rows are
// in view, which ones a marquee covers, and where to scroll for a row all
// follow from the row height; nothing has to measure the rows themselves.
// Positions are display positions (0 = the first row on screen when scrolled
// to the top); y values are in the rows container's content coordinates.

/** Rows rendered above and below the visible ones, so a quick scroll doesn't
 *  show blank space before the next render lands. */
export const OVERSCAN = 20;

export interface RowWindow {
  /** First rendered position; always even, so the row striping stays put. */
  start: number;
  /** One past the last rendered position. */
  end: number;
}

/** The positions to render for a viewport `viewH` high scrolled to `scrollTop`. */
export function rowWindow(count: number, rowH: number, scrollTop: number, viewH: number): RowWindow {
  if (count <= 0 || rowH <= 0) return { start: 0, end: 0 };
  const first = Math.floor(Math.max(0, scrollTop) / rowH);
  const last = Math.ceil((Math.max(0, scrollTop) + Math.max(0, viewH)) / rowH);
  // Clamped too, for a scrollTop left over from a longer list.
  let start = Math.min(Math.max(0, first - OVERSCAN), count - 1);
  start -= start % 2;
  return { start, end: Math.min(count, Math.max(last + OVERSCAN, start + 1)) };
}

/** The positions a span from `y1` to `y2` overlaps, as [lo, hi] inclusive, or
 *  null for none. Overlap is strict, as with rectangles: a span that only
 *  touches a row's edge doesn't take it. */
export function rowsInSpan(y1: number, y2: number, rowH: number, count: number): [number, number] | null {
  if (count <= 0 || rowH <= 0) return null;
  const lo = Math.max(0, Math.floor(y1 / rowH));
  const hi = Math.min(count - 1, Math.ceil(y2 / rowH) - 1);
  return lo <= hi ? [lo, hi] : null;
}

/** The scrollTop that brings position `pos` fully into view with the least
 *  movement, like `scrollIntoView({ block: "nearest" })`, or null when it's
 *  already in view. */
export function scrollToRow(pos: number, rowH: number, scrollTop: number, viewH: number): number | null {
  const top = pos * rowH;
  const bottom = top + rowH;
  if (top < scrollTop) return top;
  if (bottom > scrollTop + viewH) return Math.max(0, bottom - viewH);
  return null;
}
