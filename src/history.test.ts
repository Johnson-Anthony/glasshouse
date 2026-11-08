import { describe, expect, it } from "vitest";
import { navBack, navClear, navForward, navGoTo, navInit, type NavState } from "./history";

const walk = (...paths: string[]): NavState =>
  paths.slice(1).reduce(navGoTo, navInit(paths[0]));

describe("navGoTo", () => {
  it("pushes the current path and clears forward", () => {
    const n = navGoTo(navInit("/a"), "/b");
    expect(n).toEqual({ path: "/b", back: ["/a"], forward: [] });
    const afterBack = navBack(walk("/a", "/b", "/c"));
    expect(navGoTo(afterBack, "/x")).toEqual({ path: "/x", back: ["/a", "/b"], forward: [] });
  });

  it("is a no-op for the current path", () => {
    const n = walk("/a", "/b");
    expect(navGoTo(n, "/b")).toBe(n);
  });

  it("each navigation adds exactly one entry", () => {
    expect(walk("/", "/a", "/a/b", "/a/b/c").back).toEqual(["/", "/a", "/a/b"]);
  });
});

describe("navBack / navForward", () => {
  it("round-trips through the history", () => {
    const start = walk("/", "/a", "/b");
    const b1 = navBack(start);
    expect(b1).toEqual({ path: "/a", back: ["/"], forward: ["/b"] });
    const b2 = navBack(b1);
    expect(b2).toEqual({ path: "/", back: [], forward: ["/b", "/a"] });
    const f1 = navForward(b2);
    expect(f1).toEqual({ path: "/a", back: ["/"], forward: ["/b"] });
    expect(navForward(f1)).toEqual(start);
  });

  it("are no-ops at the ends", () => {
    const n = navInit("/");
    expect(navBack(n)).toBe(n);
    expect(navForward(n)).toBe(n);
  });

  it("chained calls see each other's result", () => {
    // Two back presses in the same tick must step back twice, not once.
    const n = walk("/", "/a", "/b");
    expect(navBack(navBack(n)).path).toBe("/");
  });
});

describe("purity", () => {
  it("never mutates its input", () => {
    const n = walk("/", "/a", "/b");
    const snapshot = JSON.parse(JSON.stringify(n));
    navGoTo(n, "/c");
    navBack(n);
    navForward(navBack(n));
    navClear(n);
    expect(n).toEqual(snapshot);
  });

  it("gives the same result when called twice (StrictMode)", () => {
    const n = walk("/", "/a");
    expect(navGoTo(n, "/b")).toEqual(navGoTo(n, "/b"));
    expect(navBack(n)).toEqual(navBack(n));
  });
});

describe("navClear", () => {
  it("keeps the path and drops both stacks", () => {
    const n = navBack(walk("/", "/a", "/b"));
    expect(navClear(n)).toEqual({ path: "/a", back: [], forward: [] });
  });

  it("is a no-op with no history", () => {
    const n = navInit("/");
    expect(navClear(n)).toBe(n);
  });
});
