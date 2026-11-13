// The tag store against a mocked backend: writes, the load, the wrappers that
// make tags follow the app's own renames, moves, deletes and trash, and the
// prunes for what changed outside the app.
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "./api";
import type { Trashed } from "./api";
import {
  deletePath, getTags, loadTags, movePath, pruneGoneTags, pruneListed, renamePath, resetTagStoreForTests,
  restoreTrashed, setTags, trashPath,
} from "./tags";

vi.mock("./api");

/** A promise and its resolve, to hold a call open. */
function deferred<T = void>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.writeTags).mockResolvedValue(undefined);
  resetTagStoreForTests({});
});

describe("the store", () => {
  it("writes each change, and nothing when nothing changed", async () => {
    setTags({ "/w/a": ["red"] });
    await vi.waitFor(() => expect(api.writeTags).toHaveBeenCalledTimes(1));
    expect(api.writeTags).toHaveBeenLastCalledWith({ "/w/a": ["red"] });
    setTags(prev => prev);
    await Promise.resolve();
    expect(api.writeTags).toHaveBeenCalledTimes(1);
  });

  it("sends changes made while a write is out as one write, in order", async () => {
    const first = deferred();
    vi.mocked(api.writeTags).mockReturnValueOnce(first.promise);
    setTags({ "/w/a": ["red"] });
    setTags(prev => ({ ...prev, "/w/b": ["blue"] }));
    setTags(prev => ({ ...prev, "/w/c": ["green"] }));
    expect(api.writeTags).toHaveBeenCalledTimes(1);
    first.resolve();
    await vi.waitFor(() => expect(api.writeTags).toHaveBeenCalledTimes(2));
    expect(api.writeTags).toHaveBeenLastCalledWith({ "/w/a": ["red"], "/w/b": ["blue"], "/w/c": ["green"] });
  });

  it("applies changes made before the load to what the file held", async () => {
    // Writing the empty map before the load would wipe the file.
    resetTagStoreForTests(null);
    vi.mocked(api.readTags).mockResolvedValue({ "/w/old": ["red"] });
    setTags(prev => ({ ...prev, "/w/new": ["blue"] }));
    expect(api.writeTags).not.toHaveBeenCalled();
    await loadTags();
    expect(getTags()).toEqual({ "/w/old": ["red"], "/w/new": ["blue"] });
    await vi.waitFor(() => expect(api.writeTags).toHaveBeenLastCalledWith({ "/w/old": ["red"], "/w/new": ["blue"] }));
  });
});

describe("following the app's own operations", () => {
  it("a rename takes the tags along, a folder's with everything under it", async () => {
    resetTagStoreForTests({ "/w/d": ["blue"], "/w/d/x.txt": ["red"], "/w/e": ["green"] });
    await renamePath("/w/d", "/w/D2");
    expect(api.renameEntry).toHaveBeenCalledWith("/w/d", "/w/D2");
    expect(getTags()).toEqual({ "/w/D2": ["blue"], "/w/D2/x.txt": ["red"], "/w/e": ["green"] });
  });

  it("a move takes the tags along", async () => {
    resetTagStoreForTests({ "/w/a.txt": ["red"] });
    await movePath("/w/a.txt", "/v/a.txt");
    expect(api.moveEntry).toHaveBeenCalledWith("/w/a.txt", "/v/a.txt");
    expect(getTags()).toEqual({ "/v/a.txt": ["red"] });
  });

  it("a failed rename leaves the tags where they were", async () => {
    resetTagStoreForTests({ "/w/a": ["red"] });
    vi.mocked(api.renameEntry).mockRejectedValueOnce(new Error("permission denied"));
    await expect(renamePath("/w/a", "/w/b")).rejects.toThrow("permission denied");
    expect(getTags()).toEqual({ "/w/a": ["red"] });
  });

  it("a delete drops the tags of the item and everything in it", async () => {
    resetTagStoreForTests({ "/w/d": ["blue"], "/w/d/x": ["red"], "/w/e": ["green"] });
    await deletePath("/w/d", true);
    expect(api.deleteEntry).toHaveBeenCalledWith("/w/d", true);
    expect(getTags()).toEqual({ "/w/e": ["green"] });
  });

  it("the trash drops the tags, and a restore of that item puts them back", async () => {
    resetTagStoreForTests({ "/w/d": ["blue"], "/w/d/x": ["red"], "/w/e": ["green"] });
    const item: Trashed = { original: "/real/w/d", from: 100, to: 101 };
    vi.mocked(api.moveToTrash).mockResolvedValueOnce(item);
    expect(await trashPath("/w/d")).toEqual(item);
    expect(getTags()).toEqual({ "/w/e": ["green"] });

    // The Trash view's key carries the one deletion time the trash recorded.
    vi.mocked(api.trashRestore).mockResolvedValueOnce({ done: ["/real/w/d"], problems: [] });
    await restoreTrashed([{ original: "/real/w/d", from: 100, to: 100, id: "t1" }], false);
    expect(getTags()).toEqual({ "/w/d": ["blue"], "/w/d/x": ["red"], "/w/e": ["green"] });
  });

  it("a restore of another item from the same path, or one that failed, gets no tags", async () => {
    resetTagStoreForTests({ "/w/a": ["red"] });
    vi.mocked(api.moveToTrash).mockResolvedValueOnce({ original: "/w/a", from: 100, to: 101 });
    await trashPath("/w/a");
    // An older item trashed from /w/a.
    vi.mocked(api.trashRestore).mockResolvedValueOnce({ done: ["/w/a"], problems: [] });
    await restoreTrashed([{ original: "/w/a", from: 50, to: 50 }], false);
    expect(getTags()).toEqual({});
    // Ours, but refused.
    vi.mocked(api.trashRestore).mockResolvedValueOnce({ done: [], problems: [{ path: "/w/a", reason: "taken" }] });
    await restoreTrashed([{ original: "/w/a", from: 100, to: 101 }], true);
    expect(getTags()).toEqual({});
    // Ours, restored.
    vi.mocked(api.trashRestore).mockResolvedValueOnce({ done: ["/w/a"], problems: [] });
    await restoreTrashed([{ original: "/w/a", from: 100, to: 101 }], true);
    expect(getTags()).toEqual({ "/w/a": ["red"] });
  });
});

describe("pruning what's gone", () => {
  it("after a listing, drops tagged items it lacks that a stat finds gone", async () => {
    resetTagStoreForTests({
      "/w/a": ["red"], "/w/gone": ["red"], "/w/.hidden": ["blue"], "/w/olddir/x": ["green"], "/v/q": ["red"],
    });
    vi.mocked(api.pathKind).mockImplementation(async p => (p === "/w/.hidden" ? "file" : null));
    await pruneListed("/w", ["a"]);
    expect(vi.mocked(api.pathKind).mock.calls.map(c => c[0]).sort()).toEqual(["/w/.hidden", "/w/gone", "/w/olddir"]);
    expect(getTags()).toEqual({ "/w/a": ["red"], "/w/.hidden": ["blue"], "/v/q": ["red"] });
  });

  it("a listing that lacks nothing tagged makes no stat", async () => {
    resetTagStoreForTests({ "/w/a": ["red"] });
    await pruneListed("/w", ["a", "b"]);
    expect(api.pathKind).not.toHaveBeenCalled();
  });

  it("a stat that fails doesn't count as gone", async () => {
    resetTagStoreForTests({ "/w/x": ["red"] });
    vi.mocked(api.pathKind).mockResolvedValue("unknown");
    await pruneListed("/w", []);
    expect(getTags()).toEqual({ "/w/x": ["red"] });
  });

  it("throws its result away when a rename ran meanwhile", async () => {
    // The stat can see the old name gone before the tags have moved.
    resetTagStoreForTests({ "/w/gone": ["red"], "/w/a": ["blue"] });
    vi.mocked(api.pathKind).mockImplementation(async () => {
      await renamePath("/w/a", "/w/b");
      return null;
    });
    await pruneListed("/w", ["a"]);
    expect(getTags()).toEqual({ "/w/gone": ["red"], "/w/b": ["blue"] });
  });

  it("does nothing before the tags have loaded", async () => {
    resetTagStoreForTests(null);
    await pruneListed("/w", []);
    expect(api.pathKind).not.toHaveBeenCalled();
  });

  it("when TAGS is shown, drops missing paths whose folder is still there", async () => {
    resetTagStoreForTests({
      "/w/here": ["red"], "/w/gone": ["red"], "/media/usb/photo.jpg": ["blue"], "/w/unreadable": ["green"],
    });
    const disk: Record<string, "folder" | "file" | "unknown"> = { "/w": "folder", "/w/here": "file", "/w/unreadable": "unknown" };
    vi.mocked(api.pathKind).mockImplementation(async p => disk[p] ?? null);
    await pruneGoneTags();
    // The drive isn't plugged in (its folder is gone too), so it keeps its tags.
    expect(getTags()).toEqual({ "/w/here": ["red"], "/media/usb/photo.jpg": ["blue"], "/w/unreadable": ["green"] });
  });

  it("loads the tags first when TAGS is shown before the app has", async () => {
    resetTagStoreForTests(null);
    vi.mocked(api.readTags).mockResolvedValue({ "/w/gone": ["red"] });
    vi.mocked(api.pathKind).mockImplementation(async p => (p === "/w" ? "folder" : null));
    await pruneGoneTags();
    expect(getTags()).toEqual({});
  });
});
