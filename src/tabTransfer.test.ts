import { describe, expect, it } from "vitest";
import { makeTab } from "./tabs";
import { parseTransfer, recordFromTransfer, transferOf, transferOfRecord } from "./tabTransfer";

const state = {
  path: "/home/me/src",
  sortKey: "modified" as const,
  sortDir: "desc" as const,
  historyBack: ["/home/me", "/home"],
  historyForward: ["/home/me/src/app"],
  searchQuery: "todo",
  tagFilter: "work",
  private: true,
};

describe("transferOf", () => {
  it("takes the folder, sort, history, filters and private flag", () => {
    expect(transferOf(state)).toEqual({
      path: "/home/me/src",
      sort: { key: "modified", dir: "desc" },
      back: ["/home/me", "/home"],
      forward: ["/home/me/src/app"],
      search: "todo",
      tagFilter: "work",
      private: true,
    });
  });

  it("copies the history lists, so the tab it came from keeps its own", () => {
    const t = transferOf(state);
    t.back.push("/elsewhere");
    expect(state.historyBack).toEqual(["/home/me", "/home"]);
  });
});

describe("recordFromTransfer", () => {
  it("makes a new tab that mounts with all of it, private staying private", () => {
    const t = transferOf(state);
    const r = recordFromTransfer(t);
    expect(r.initialPath).toBe("/home/me/src");
    expect(r.initialSort).toEqual({ key: "modified", dir: "desc" });
    expect(r.private).toBe(true);
    expect(r.label).toBe("(private) /home/me/src");
    expect(r.seed).toEqual({ back: t.back, forward: t.forward, search: "todo", tagFilter: "work" });
    expect(recordFromTransfer(t).id).not.toBe(r.id);
  });
});

describe("transferOfRecord", () => {
  it("a tab with no live state yet carries what it opened with", () => {
    const r = makeTab("/srv", { private: true, sort: { key: "size", dir: "desc" }, seed: { back: ["/"], forward: [], search: "x", tagFilter: null } });
    expect(transferOfRecord(r)).toEqual({ path: "/srv", sort: { key: "size", dir: "desc" }, back: ["/"], forward: [], search: "x", tagFilter: null, private: true });
    expect(transferOfRecord(makeTab("/a"))).toEqual({ path: "/a", sort: { key: "name", dir: "asc" }, back: [], forward: [], search: "", tagFilter: null, private: false });
  });
});

describe("parseTransfer", () => {
  it("takes back what transferOf handed over", () => {
    const t = transferOf({ ...state, private: false });
    expect(parseTransfer(JSON.parse(JSON.stringify(t)))).toEqual(t);
    expect(parseTransfer(transferOf(state))?.private).toBe(true);
  });

  it("refuses what isn't a tab", () => {
    for (const v of [null, undefined, "x", 3, [], {}, { path: "relative/dir" }, { path: "" }, { path: 7 }, { path: "/a".repeat(3000) }]) {
      expect(parseTransfer(v)).toBeNull();
    }
  });

  it("mends the parts that are wrong, and counts a record without the flag as private", () => {
    expect(parseTransfer({ path: "C:\\Users", sort: { key: "bogus" }, back: ["/a", 3, "rel", "/b"], forward: "x", search: 5, tagFilter: 9 })).toEqual({
      path: "C:\\Users", sort: { key: "name", dir: "asc" }, back: ["/a", "/b"], forward: [], search: "", tagFilter: null, private: true,
    });
  });

  it("keeps the history nearest the tab when there's too much", () => {
    const many = Array.from({ length: 800 }, (_, i) => `/d${i}`);
    const t = parseTransfer({ path: "/x", back: many, forward: many, private: false })!;
    expect(t.back).toHaveLength(500);
    expect(t.back.at(-1)).toBe("/d799");
    expect(t.forward).toHaveLength(500);
    expect(t.forward[0]).toBe("/d0");
  });
});
