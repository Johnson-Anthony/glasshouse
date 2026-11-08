import { describe, expect, it } from "vitest";
import {
  conflictMessage,
  copyName,
  findConflicts,
  isInside,
  pickFreeName,
  planSteps,
  runTransfer,
  splitExt,
  summarize,
  type ExistingEntry,
  type TransferDeps,
} from "./transfer";

const file = (name: string): ExistingEntry => ({ name, kind: "text" });
const folder = (name: string): ExistingEntry => ({ name, kind: "folder" });
const takenIn = (...names: string[]) => (n: string) => names.includes(n);

describe("splitExt", () => {
  it("splits files at the last dot", () => {
    expect(splitExt("report.pdf", false)).toEqual(["report", ".pdf"]);
    expect(splitExt("a.b.c", false)).toEqual(["a.b", ".c"]);
    expect(splitExt("Makefile", false)).toEqual(["Makefile", ""]);
  });

  it("keeps .tar.* together", () => {
    expect(splitExt("src.tar.gz", false)).toEqual(["src", ".tar.gz"]);
    expect(splitExt("src.TAR.ZST", false)).toEqual(["src", ".TAR.ZST"]);
  });

  it("gives dotfiles and folders no extension", () => {
    expect(splitExt(".bashrc", false)).toEqual([".bashrc", ""]);
    expect(splitExt("v1.2", true)).toEqual(["v1.2", ""]);
  });
});

describe("copyName", () => {
  it("numbers from the second copy", () => {
    expect(copyName("a.txt", false, 1)).toBe("a (copy).txt");
    expect(copyName("a.txt", false, 2)).toBe("a (copy 2).txt");
    expect(copyName("photos", true, 3)).toBe("photos (copy 3)");
  });
});

describe("pickFreeName", () => {
  it("keeps a free name", () => {
    expect(pickFreeName("a.txt", false, takenIn())).toBe("a.txt");
  });

  it("walks copy, copy 2, copy 3", () => {
    expect(pickFreeName("a.txt", false, takenIn("a.txt"))).toBe("a (copy).txt");
    expect(pickFreeName("a.txt", false, takenIn("a.txt", "a (copy).txt"))).toBe("a (copy 2).txt");
    expect(pickFreeName("a.txt", false, takenIn("a.txt", "a (copy).txt", "a (copy 2).txt")))
      .toBe("a (copy 3).txt");
  });

  it("continues an existing copy suffix instead of stacking", () => {
    expect(pickFreeName("a (copy).txt", false, takenIn("a (copy).txt"))).toBe("a (copy 2).txt");
    expect(pickFreeName("a (copy 7).txt", false, takenIn("a (copy 7).txt"))).toBe("a (copy 8).txt");
  });

  it("names folders and dotfiles without splitting", () => {
    expect(pickFreeName("v1.2", true, takenIn("v1.2"))).toBe("v1.2 (copy)");
    expect(pickFreeName(".env", false, takenIn(".env"))).toBe(".env (copy)");
    expect(pickFreeName("x.tar.gz", false, takenIn("x.tar.gz"))).toBe("x (copy).tar.gz");
  });
});

describe("isInside", () => {
  it("matches the path itself and descendants only", () => {
    expect(isInside("/a/b", "/a/b", false)).toBe(true);
    expect(isInside("/a/b/c", "/a/b", false)).toBe(true);
    expect(isInside("/a/bc", "/a/b", false)).toBe(false);
    expect(isInside("/a", "/a/b", false)).toBe(false);
    expect(isInside("/a/b/", "/a/b", false)).toBe(true);
  });

  it("is case- and separator-insensitive on Windows only", () => {
    expect(isInside("C:\\Users\\Me\\x", "c:/users/me", true)).toBe(true);
    expect(isInside("/A/b", "/a", false)).toBe(false);
  });
});

describe("planSteps", () => {
  it("passes free names through", () => {
    expect(planSteps([{ path: "/src/a.txt" }], "/dst", [file("b.txt")], "copy", "keep-both", false))
      .toEqual([{ action: "transfer", src: "/src/a.txt", dst: "/dst/a.txt" }]);
  });

  it("copies in place under a copy name (never onto the source)", () => {
    const steps = planSteps(
      [{ path: "/d/a.txt", isDir: false }, { path: "/d/pics", isDir: true }],
      "/d",
      [file("a.txt"), folder("pics"), file("a (copy).txt")],
      "copy", "keep-both", false,
    );
    expect(steps).toEqual([
      { action: "transfer", src: "/d/a.txt", dst: "/d/a (copy 2).txt" },
      { action: "transfer", src: "/d/pics", dst: "/d/pics (copy)" },
    ]);
  });

  it("uses the listing's kind when the item's is unknown", () => {
    const steps = planSteps([{ path: "/d/v1.2" }], "/d", [folder("v1.2")], "copy", "keep-both", false);
    expect(steps[0]).toMatchObject({ dst: "/d/v1.2 (copy)" });
  });

  it("skips a move into its own folder", () => {
    expect(planSteps([{ path: "/d/a.txt" }], "/d/", [file("a.txt")], "move", "replace", false))
      .toEqual([{ action: "skip", src: "/d/a.txt", reason: "same-place" }]);
  });

  it("skips a folder going into itself or below", () => {
    for (const dst of ["/d/f", "/d/f/sub"]) {
      expect(planSteps([{ path: "/d/f", isDir: true }], dst, [], "copy", "keep-both", false))
        .toEqual([{ action: "skip", src: "/d/f", reason: "into-itself" }]);
    }
  });

  it("applies the conflict policy", () => {
    const items = [{ path: "/src/a.txt" }, { path: "/src/new.txt" }];
    const existing = [file("a.txt")];
    expect(planSteps(items, "/dst", existing, "copy", "keep-both", false)).toEqual([
      { action: "transfer", src: "/src/a.txt", dst: "/dst/a (copy).txt" },
      { action: "transfer", src: "/src/new.txt", dst: "/dst/new.txt" },
    ]);
    expect(planSteps(items, "/dst", existing, "move", "replace", false)).toEqual([
      { action: "transfer", src: "/src/a.txt", dst: "/dst/a.txt", replace: "/dst/a.txt" },
      { action: "transfer", src: "/src/new.txt", dst: "/dst/new.txt" },
    ]);
    expect(planSteps(items, "/dst", existing, "copy", "skip", false)).toEqual([
      { action: "skip", src: "/src/a.txt", reason: "conflict" },
      { action: "transfer", src: "/src/new.txt", dst: "/dst/new.txt" },
    ]);
  });

  it("never replaces what the same batch just created", () => {
    const steps = planSteps(
      [{ path: "/x/a.txt" }, { path: "/y/a.txt" }, { path: "/z/a (copy).txt" }],
      "/dst", [], "copy", "replace", false,
    );
    expect(steps.map(s => s.action === "transfer" && s.dst)).toEqual([
      "/dst/a.txt", "/dst/a (copy).txt", "/dst/a (copy 2).txt",
    ]);
  });

  it("keeps both instead of trashing a folder that holds the source", () => {
    const steps = planSteps([{ path: "/a/x/x", isDir: true }], "/a", [folder("x")], "move", "replace", false);
    expect(steps).toEqual([{ action: "transfer", src: "/a/x/x", dst: "/a/x (copy)" }]);
  });

  it("matches names case-insensitively on Windows and replaces the real name", () => {
    const steps = planSteps([{ path: "C:\\src\\README.md" }], "C:\\dst", [file("readme.md")], "copy", "replace", true);
    expect(steps).toEqual([
      { action: "transfer", src: "C:\\src\\README.md", dst: "C:\\dst\\README.md", replace: "C:\\dst\\readme.md" },
    ]);
    expect(planSteps([{ path: "/src/README.md" }], "/dst", [file("readme.md")], "copy", "skip", false))
      .toEqual([{ action: "transfer", src: "/src/README.md", dst: "/dst/README.md" }]);
  });
});

describe("findConflicts", () => {
  it("lists only names held by a different item", () => {
    const items = [{ path: "/d/a.txt" }, { path: "/src/b.txt" }, { path: "/src/c.txt" }, { path: "/src/b.txt" }];
    expect(findConflicts(items, "/d", [file("a.txt"), file("b.txt")], false)).toEqual(["b.txt"]);
  });
});

function fakeDeps(listing: ExistingEntry[], answer: "keep-both" | "replace" | "skip" | null) {
  const calls: string[] = [];
  const deps: TransferDeps = {
    list: async () => listing,
    ask: async (names) => { calls.push(`ask ${names.join(",")}`); return answer; },
    copy: async (s, d) => { calls.push(`copy ${s} ${d}`); },
    move: async (s, d) => {
      if (s.includes("locked")) throw new Error("permission denied");
      calls.push(`move ${s} ${d}`);
    },
    trash: async (p) => { calls.push(`trash ${p}`); },
    windows: false,
  };
  return { deps, calls };
}

describe("runTransfer", () => {
  it("does not ask when nothing conflicts", async () => {
    const { deps, calls } = fakeDeps([file("a.txt")], null);
    const res = await runTransfer([{ path: "/d/a.txt" }], "/d", "copy", deps);
    expect(calls).toEqual(["copy /d/a.txt /d/a (copy).txt"]);
    expect(res?.done).toEqual([{ src: "/d/a.txt", dst: "/d/a (copy).txt" }]);
  });

  it("does nothing when the question is cancelled", async () => {
    const { deps, calls } = fakeDeps([file("a.txt")], null);
    expect(await runTransfer([{ path: "/s/a.txt" }, { path: "/s/b.txt" }], "/d", "copy", deps)).toBeNull();
    expect(calls).toEqual(["ask a.txt"]);
  });

  it("trashes before replacing and records failures per item", async () => {
    const { deps, calls } = fakeDeps([file("a.txt")], "replace");
    const res = await runTransfer([{ path: "/s/a.txt" }, { path: "/locked/b.txt" }], "/d", "move", deps);
    expect(calls).toEqual(["ask a.txt", "trash /d/a.txt", "move /s/a.txt /d/a.txt"]);
    expect(res).toEqual({
      done: [{ src: "/s/a.txt", dst: "/d/a.txt" }],
      replaced: ["/d/a.txt"],
      skipped: [],
      failed: [{ src: "/locked/b.txt", error: "permission denied" }],
    });
  });

  it("skips the transfer if the existing item can't be trashed", async () => {
    const { deps, calls } = fakeDeps([file("a.txt")], "replace");
    deps.trash = async () => { throw new Error("no trash here"); };
    const res = await runTransfer([{ path: "/s/a.txt" }], "/d", "copy", deps);
    expect(calls).toEqual(["ask a.txt"]);
    expect(res?.done).toEqual([]);
    expect(res?.failed[0].error).toMatch(/no trash here/);
  });

  it("fails everything, touching nothing, if the destination can't be listed", async () => {
    const { deps, calls } = fakeDeps([], "keep-both");
    deps.list = async () => { throw new Error("EACCES"); };
    const res = await runTransfer([{ path: "/s/a.txt" }], "/d", "copy", deps);
    expect(calls).toEqual([]);
    expect(res?.failed).toEqual([{ src: "/s/a.txt", error: "can't read /d: EACCES" }]);
  });
});

describe("conflictMessage", () => {
  it("names one conflict, or lists up to five", () => {
    expect(conflictMessage(["a.txt"], "/home/me/docs", false)).toBe(
      '"a.txt" already exists in docs.\n\n' +
      'keep both: the new one gets a " (copy)" name.\n' +
      "replace: the existing one goes to the Trash first.",
    );
    const many = conflictMessage(["1", "2", "3", "4", "5", "6", "7"], "C:\\", true);
    expect(many.startsWith("7 items already exist in C::\n  1\n")).toBe(true);
    expect(many).toContain("  5\n  …and 2 more\n\n");
    expect(many).toContain("Recycle Bin");
  });
});

describe("summarize", () => {
  it("reports what happened", () => {
    expect(summarize({ done: [{ src: "a", dst: "b" }], replaced: [], skipped: [], failed: [] }, "copy", false))
      .toEqual({ message: "copied 1 item(s)", variant: "success" });
    expect(summarize({
      done: [], replaced: [], skipped: [{ src: "/d/a", reason: "same-place" }], failed: [],
    }, "move", false)).toEqual({ message: "1 item(s) already there", variant: "info" });
    expect(summarize({
      done: [{ src: "a", dst: "b" }], replaced: ["b"], skipped: [{ src: "f", reason: "into-itself" }], failed: [],
    }, "move", true).message).toBe(
      "moved 1 item(s), replaced 1 (old in the Recycle Bin), skipped 1: a folder can't go inside itself",
    );
  });
});
