import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_SORT,
  SESSION_KEY,
  isSessionKey,
  loadSession,
  parseSession,
  restorePath,
  restoreSession,
  saveSession,
  sessionOf,
  type Session,
} from "./session";

const tab = (path: string, key = "name", dir = "asc") => ({ path, sort: { key, dir } });
const raw = (v: unknown) => JSON.stringify(v);

describe("parseSession", () => {
  it("reads back what was saved", () => {
    const s: Session = { tabs: [tab("/home/me"), tab("/tmp", "modified", "desc")] as Session["tabs"], active: 1 };
    expect(parseSession(raw(s))).toEqual(s);
  });

  it("ignores a missing, broken or wrong-shaped record", () => {
    for (const v of [null, "", "{", "null", "42", '"tabs"', raw({}), raw({ tabs: "x" }), raw({ tabs: [] }), raw([tab("/")])]) {
      expect(parseSession(v)).toBeNull();
    }
  });

  it("drops tabs whose path isn't an absolute path", () => {
    const s = parseSession(raw({ tabs: [{ path: 3 }, { path: "" }, { path: "rel/dir" }, {}, null, "x", tab("/ok")], active: 0 }));
    expect(s?.tabs.map(t => t.path)).toEqual(["/ok"]);
  });

  it("takes Windows drive and UNC paths", () => {
    const s = parseSession(raw({ tabs: [tab("C:\\Users\\me"), tab("D:/x"), tab("\\\\server\\share")], active: 0 }));
    expect(s?.tabs.map(t => t.path)).toEqual(["C:\\Users\\me", "D:/x", "\\\\server\\share"]);
  });

  it("a sort it doesn't know is Name ascending", () => {
    const s = parseSession(raw({ tabs: [
      tab("/a", "colour", "asc"), tab("/b", "size", "up"), { path: "/c" }, { path: "/d", sort: "size" }, tab("/e", "git", "desc"),
    ], active: 0 }));
    expect(s?.tabs.map(t => t.sort)).toEqual([DEFAULT_SORT, DEFAULT_SORT, DEFAULT_SORT, DEFAULT_SORT, { key: "git", dir: "desc" }]);
  });

  it("keeps the active tab on the same tab when others are dropped", () => {
    const tabs = [{ path: "x" }, tab("/a"), { path: "y" }, tab("/b"), tab("/c")];
    expect(parseSession(raw({ tabs, active: 3 }))?.active).toBe(1); // /b
    expect(parseSession(raw({ tabs, active: 4 }))?.active).toBe(2); // /c
  });

  it("a dropped active tab hands over to its left neighbour, or the right one at the start", () => {
    const tabs = [{ path: "x" }, tab("/a"), { path: "y" }, tab("/b")];
    expect(parseSession(raw({ tabs, active: 2 }))?.active).toBe(0); // /a
    expect(parseSession(raw({ tabs, active: 0 }))?.active).toBe(0); // /a
  });

  it("an active index out of range or not a whole number lands on a real tab", () => {
    const tabs = [tab("/a"), tab("/b")];
    expect(parseSession(raw({ tabs, active: 9 }))?.active).toBe(1);
    expect(parseSession(raw({ tabs, active: -1 }))?.active).toBe(0);
    expect(parseSession(raw({ tabs, active: 0.5 }))?.active).toBe(0);
    expect(parseSession(raw({ tabs, active: "1" }))?.active).toBe(0);
    expect(parseSession(raw({ tabs }))?.active).toBe(0);
  });

  it("stops at 100 tabs", () => {
    const tabs = Array.from({ length: 5000 }, (_, i) => tab(`/t${i}`));
    expect(parseSession(raw({ tabs, active: 0 }))?.tabs).toHaveLength(100);
  });
});

describe("sessionOf", () => {
  const live = (path: string, priv = false) => ({ path, sort: DEFAULT_SORT, private: priv });
  const one = (tabs: ReturnType<typeof live>[], active: number) => sessionOf([{ tabs, active }]);

  it("leaves private tabs out and follows the active tab", () => {
    const s = one([live("/a"), live("/secret", true), live("/b")], 2);
    expect(s).toEqual({ tabs: [{ path: "/a", sort: DEFAULT_SORT }, { path: "/b", sort: DEFAULT_SORT }], active: 1 });
  });

  it("a private active tab saves its left neighbour as the active one", () => {
    expect(one([live("/a"), live("/b"), live("/p", true)], 2).active).toBe(1);
    expect(one([live("/p", true), live("/a")], 0).active).toBe(0);
  });

  it("only private tabs: nothing to reopen, so the next start opens home", () => {
    const s = one([live("/p", true)], 0);
    expect(s.tabs).toEqual([]);
    expect(parseSession(JSON.stringify(s))).toBeNull();
  });

  it("round-trips through parseSession", () => {
    const s = one([live("/a"), { path: "/b", sort: { key: "size", dir: "desc" }, private: false }], 1);
    expect(parseSession(JSON.stringify(s))).toEqual(s);
  });
});

describe("a split's session", () => {
  const live = (path: string, priv = false) => ({ path, sort: DEFAULT_SORT, private: priv });
  const t = (path: string, pane?: 1) => (pane ? { path, sort: DEFAULT_SORT, pane } : { path, sort: DEFAULT_SORT });

  it("saves both panes' tabs in order, the second's marked, with the focused pane's shown tab as `active`", () => {
    const s = sessionOf([{ tabs: [live("/a"), live("/b")], active: 1 }, { tabs: [live("/c"), live("/d")], active: 0 }], 1, "column", 0.3);
    expect(s).toEqual({ tabs: [t("/a"), t("/b"), t("/c", 1), t("/d", 1)], active: 2, split: { other: 1, dir: "column", ratio: 0.3 } });
    expect(parseSession(JSON.stringify(s))).toEqual(s);
  });

  it("is read by a build without split view as every tab, its `active` the one that had the focus", () => {
    const s = sessionOf([{ tabs: [live("/a")], active: 0 }, { tabs: [live("/b"), live("/c")], active: 1 }], 1);
    // What 0.2's parser looks at.
    expect(s.tabs.map(x => x.path)).toEqual(["/a", "/b", "/c"]);
    expect(s.active).toBe(2);
  });

  it("a pane with only private tabs saves as no split", () => {
    const s = sessionOf([{ tabs: [live("/a")], active: 0 }, { tabs: [live("/p", true)], active: 0 }], 1);
    expect(s).toEqual({ tabs: [t("/a")], active: 0 });
  });

  it("reads a record without split fields, or with bad ones, as unsplit", () => {
    const tabs = [t("/a"), t("/b", 1)];
    for (const split of [undefined, null, "x", {}, { dir: "diagonal" }, { other: 1 }]) {
      expect(parseSession(raw({ tabs, active: 0, split }))).toEqual({ tabs: [t("/a"), t("/b")], active: 0 });
    }
  });

  it("is no split when every tab, or none, is in the second pane", () => {
    const split = { other: 0, dir: "row", ratio: 0.5 };
    expect(parseSession(raw({ tabs: [t("/a", 1), t("/b", 1)], active: 1, split }))).toEqual({ tabs: [t("/a"), t("/b")], active: 1 });
    expect(parseSession(raw({ tabs: [t("/a"), t("/b")], active: 0, split }))).toEqual({ tabs: [t("/a"), t("/b")], active: 0 });
  });

  it("puts the panes in order, keeps `other` in the other pane, and clamps the ratio", () => {
    // Tabs interleaved, and `other` in the focused pane: the other pane's first tab.
    const s = parseSession(raw({ tabs: [t("/b", 1), t("/a"), t("/c", 1)], active: 1, split: { other: 1, dir: "row", ratio: 7 } }));
    expect(s).toEqual({ tabs: [t("/a"), t("/b", 1), t("/c", 1)], active: 0, split: { other: 1, dir: "row", ratio: 0.85 } });
  });

  it("maps `active` and `other` past dropped tabs", () => {
    const s = parseSession(raw({ tabs: [t("/a"), { path: "rel" }, t("/b"), t("/c", 1), { path: 3, pane: 1 }, t("/d", 1)], active: 2, split: { other: 5, dir: "row", ratio: 0.5 } }));
    expect(s).toEqual({ tabs: [t("/a"), t("/b"), t("/c", 1), t("/d", 1)], active: 1, split: { other: 3, dir: "row", ratio: 0.5 } });
  });

  it("restoreSession keeps the panes", async () => {
    const s = { tabs: [t("/a"), t("/gone", 1)], active: 0, split: { other: 1, dir: "row" as const, ratio: 0.4 } };
    const r = await restoreSession(s, "/home/me", async p => (p === "/a" || p === "/" ? "folder" : null));
    expect(r).toEqual({ tabs: [t("/a"), t("/", 1)], active: 0, split: { other: 1, dir: "row", ratio: 0.4 } });
  });
});

describe("restorePath", () => {
  const fs = (folders: string[], files: string[] = []) => async (p: string) =>
    folders.includes(p) ? "folder" as const : files.includes(p) ? "file" as const : null;

  it("a folder that's still there opens as saved", async () => {
    expect(await restorePath("/home/me/src", "/home/me", fs(["/home/me/src"]))).toBe("/home/me/src");
  });

  it("a gone folder opens its nearest existing parent", async () => {
    expect(await restorePath("/home/me/src/gone/deeper", "/home/me", fs(["/", "/home", "/home/me", "/home/me/src"]))).toBe("/home/me/src");
  });

  it("a folder replaced by a file opens the file's folder", async () => {
    expect(await restorePath("/home/me/x", "/home/me", fs(["/home/me"], ["/home/me/x"]))).toBe("/home/me");
  });

  it("home when nothing up the path is there (a drive that's gone)", async () => {
    expect(await restorePath("E:\\photos\\2026", "C:\\Users\\me", fs([]))).toBe("C:\\Users\\me");
  });

  it("opens as saved when the backend can't be asked", async () => {
    expect(await restorePath("/a/b", "/home", async () => "unknown")).toBe("/a/b");
  });

  it("opens as saved when the check fails", async () => {
    expect(await restorePath("/a/b", "/home", async () => { throw new Error("boom"); })).toBe("/a/b");
  });

  describe("a check that doesn't answer", () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it("opens as saved once the time is up", async () => {
      const r = restorePath("//offline/share", "/home", () => new Promise(() => {}), 1500);
      await vi.advanceTimersByTimeAsync(1500);
      expect(await r).toBe("//offline/share");
    });
  });
});

describe("restoreSession", () => {
  it("checks every tab and keeps each one's sort and the active tab", async () => {
    const asked: string[] = [];
    const kindOf = async (p: string) => { asked.push(p); return p.startsWith("/gone/") ? null : "folder" as const; };
    const s: Session = { tabs: [{ path: "/a", sort: DEFAULT_SORT }, { path: "/gone/x", sort: { key: "size", dir: "desc" } }], active: 1 };
    const r = await restoreSession(s, "/home", kindOf);
    expect(r).toEqual({ tabs: [{ path: "/a", sort: DEFAULT_SORT }, { path: "/gone", sort: { key: "size", dir: "desc" } }], active: 1 });
    expect(asked).toContain("/gone/x");
  });
});

describe("storage", () => {
  let store: Map<string, string>;
  beforeEach(() => {
    store = new Map();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v); },
      removeItem: (k: string) => { store.delete(k); },
    });
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  const s: Session = { tabs: [{ path: "/a", sort: DEFAULT_SORT }], active: 0 };

  it("saves under the versioned key and loads it back", () => {
    const json = saveSession(s, null);
    expect(store.get(SESSION_KEY)).toBe(json);
    expect(loadSession()).toEqual(s);
  });

  it("doesn't write the same record twice", () => {
    const setItem = vi.spyOn(localStorage, "setItem");
    const last = saveSession(s, null);
    expect(saveSession(s, last)).toBe(last);
    expect(setItem).toHaveBeenCalledTimes(1);
  });

  it("a write that fails leaves the last record as the one saved", () => {
    vi.stubGlobal("localStorage", { setItem: () => { throw new Error("quota"); } });
    expect(saveSession(s, "old")).toBe("old");
  });

  it("a bad value or no storage at all starts fresh", () => {
    store.set(SESSION_KEY, "{not json");
    expect(loadSession()).toBeNull();
    vi.stubGlobal("localStorage", { getItem: () => { throw new Error("denied"); } });
    expect(loadSession()).toBeNull();
  });

  it("isSessionKey covers every version and nothing else", () => {
    expect(isSessionKey(SESSION_KEY)).toBe(true);
    expect(isSessionKey("glasshouse.session.v2")).toBe(true);
    expect(isSessionKey("glasshouse.tweaks")).toBe(false);
    expect(isSessionKey("glasshouse.sessionx")).toBe(false);
  });
});
