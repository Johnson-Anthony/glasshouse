// A first run's pins: home and the known folders that exist, then the
// desktop's bookmarks, each once, and the known folders alone when the
// bookmarks take too long.
import { describe, expect, it, vi } from "vitest";
import { firstRunPins, mergePins, type PlacesDeps } from "./places";

const KNOWN: Record<string, string> = {
  Desktop: "/home/me/Desktop",
  Documents: "/home/me/Documents",
  Downloads: "/home/me/Downloads",
  Music: "/home/me/Music",
  Pictures: "/home/me/Pictures",
  // No video folder set: home itself, which is pinned once.
  Videos: "/home/me",
};

function deps(over: Partial<PlacesDeps> = {}, there = new Set(["/home/me", "/home/me/Documents", "/home/me/Downloads", "/home/me/Pictures"])): PlacesDeps {
  return {
    home: async () => "/home/me",
    known: async name => KNOWN[name] ?? null,
    isFolder: async p => there.has(p),
    places: async () => ["/home/me/Documents/", "/srv/projects", "/home/me/Pictures"],
    ...over,
  };
}

describe("firstRunPins", () => {
  it("pins home and the known folders that exist, then the desktop's bookmarks", async () => {
    expect(await firstRunPins(deps())).toEqual([
      "/home/me", "/home/me/Documents", "/home/me/Downloads", "/home/me/Pictures", "/srv/projects",
    ]);
  });

  it("does without the bookmarks when they take too long or fail", async () => {
    vi.useFakeTimers();
    try {
      const slow = firstRunPins(deps({ places: () => new Promise(() => {}) }), 3000);
      await vi.advanceTimersByTimeAsync(3000);
      expect(await slow).toEqual(["/home/me", "/home/me/Documents", "/home/me/Downloads", "/home/me/Pictures"]);
    } finally {
      vi.useRealTimers();
    }
    expect(await firstRunPins(deps({ places: async () => { throw new Error("no"); } }))).toHaveLength(4);
  });

  it("pins nothing it can't find", async () => {
    const none = deps({ home: async () => null, known: async () => null, places: async () => [] });
    expect(await firstRunPins(none)).toEqual([]);
    const failing = deps({ isFolder: async () => { throw new Error("gone"); }, places: async () => [] });
    expect(await firstRunPins(failing)).toEqual([]);
  });
});

describe("mergePins", () => {
  it("keeps the first of each path, ignoring a trailing separator", () => {
    expect(mergePins(["/a", "/b"], ["/b/", "/c", "", "/a"])).toEqual(["/a", "/b", "/c"]);
  });
});
