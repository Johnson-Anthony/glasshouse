import { describe, expect, it } from "vitest";
import { recordFromTransfer, transferOf } from "./tabTransfer";

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
