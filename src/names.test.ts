import { describe, expect, it } from "vitest";
import {
  NameSet, checkRenames, freeNewName, nameProblem, orderRenames, renameFailure, renameStepsProblem, reverseRenameSteps,
  runRenameSteps, type RenameMove, type RenameStep,
} from "./names";

/** Apply rename steps to a list of names, failing on any overwrite. */
function simulate(names: string[], steps: RenameMove[], windows: boolean): string[] {
  const set = new NameSet(names, windows);
  const out = [...names];
  for (const s of steps) {
    const i = out.findIndex(n => set.key(n) === set.key(s.from));
    if (i < 0) throw new Error(`missing ${s.from}`);
    if (set.has(s.to) && set.key(s.to) !== set.key(s.from)) throw new Error(`overwrote ${s.to}`);
    set.delete(s.from);
    set.add(s.to);
    out[i] = s.to;
  }
  return out.sort();
}

describe("NameSet", () => {
  it("ignores case on Windows only", () => {
    expect(new NameSet(["README.md"], true).has("readme.MD")).toBe(true);
    expect(new NameSet(["README.md"], false).has("readme.md")).toBe(false);
  });
});

describe("nameProblem", () => {
  const linux = new NameSet(["a.txt", "Docs"], false);
  const win = new NameSet(["a.txt", "Docs"], true);

  it("accepts a free name", () => {
    expect(nameProblem("b.txt", linux)).toBeNull();
    expect(nameProblem("A.txt", linux)).toBeNull();
  });

  it("refuses a taken name, case-insensitively on Windows", () => {
    expect(nameProblem("a.txt", linux)).toBe('"a.txt" already exists here');
    expect(nameProblem("docs", win)).toBe('"docs" already exists here');
  });

  it("lets a rename change only the case of its own name", () => {
    expect(nameProblem("A.TXT", win, "a.txt")).toBeNull();
    expect(nameProblem("DOCS", win, "a.txt")).toBe('"DOCS" already exists here');
  });

  it("refuses empty names, dot names and separators", () => {
    expect(nameProblem("  ", linux)).toBe("name required");
    expect(nameProblem("..", linux)).not.toBeNull();
    expect(nameProblem("x/y", linux)).not.toBeNull();
    expect(nameProblem("x\\y", linux)).toBeNull();
    expect(nameProblem("x\\y", win)).not.toBeNull();
  });
});

describe("freeNewName", () => {
  const taken = (...names: string[]) => (n: string) => names.includes(n);

  it("numbers from 2, keeping the extension", () => {
    expect(freeNewName("untitled.txt", false, taken())).toBe("untitled.txt");
    expect(freeNewName("untitled.txt", false, taken("untitled.txt"))).toBe("untitled (2).txt");
    expect(freeNewName("untitled.txt", false, taken("untitled.txt", "untitled (2).txt"))).toBe("untitled (3).txt");
    expect(freeNewName("new-folder.v2", true, taken("new-folder.v2"))).toBe("new-folder.v2 (2)");
  });
});

describe("checkRenames", () => {
  it("refuses names held by items outside the batch", () => {
    expect(checkRenames([{ from: "a.txt", to: "b.txt" }], ["a.txt", "b.txt"], false))
      .toEqual(['"b.txt" already exists here']);
  });

  it("allows names the batch itself frees", () => {
    expect(checkRenames(
      [{ from: "1.txt", to: "2.txt" }, { from: "2.txt", to: "3.txt" }],
      ["1.txt", "2.txt"], false,
    )).toEqual([null, null]);
  });

  it("treats an unchanged item's name as taken", () => {
    expect(checkRenames(
      [{ from: "a", to: "a" }, { from: "b", to: "a" }],
      ["a", "b"], false,
    )).toEqual([null, '"a" already exists here']);
  });

  it("flags duplicate targets, case-insensitively on Windows", () => {
    const moves = [{ from: "x", to: "Same" }, { from: "y", to: "same" }];
    expect(checkRenames(moves, ["x", "y"], false)).toEqual([null, null]);
    expect(checkRenames(moves, ["x", "y"], true)).toEqual([
      'more than one item would be "Same"',
      'more than one item would be "same"',
    ]);
  });

  it("allows a case-only rename on Windows", () => {
    expect(checkRenames([{ from: "a.txt", to: "A.txt" }], ["a.txt"], true)).toEqual([null]);
  });

  it("reports empty and invalid targets", () => {
    expect(checkRenames([{ from: "a", to: "" }, { from: "b", to: "c/d" }], ["a", "b"], false))
      .toEqual(["name required", "a name can't contain /"]);
  });
});

describe("orderRenames", () => {
  it("runs a chain target-first", () => {
    const moves = [{ from: "1.txt", to: "2.txt" }, { from: "2.txt", to: "3.txt" }];
    const steps = orderRenames(moves, ["1.txt", "2.txt"], false);
    expect(steps).toEqual([{ from: "2.txt", to: "3.txt" }, { from: "1.txt", to: "2.txt" }]);
    expect(simulate(["1.txt", "2.txt"], steps, false)).toEqual(["2.txt", "3.txt"]);
  });

  it("breaks a swap with a temporary name", () => {
    const moves = [{ from: "a", to: "b" }, { from: "b", to: "a" }];
    const steps = orderRenames(moves, ["a", "b", "a~rename"], false);
    expect(steps[0]).toEqual({ from: "a", to: "a~rename (2)" });
    expect(steps).toHaveLength(3);
    expect(simulate(["a", "a~rename", "b"], steps, false)).toEqual(["a", "a~rename", "b"]);
  });

  it("handles a rotation and keeps unrelated names", () => {
    const names = ["1", "2", "3", "other"];
    const moves = [{ from: "1", to: "2" }, { from: "2", to: "3" }, { from: "3", to: "1" }];
    const steps = orderRenames(moves, names, false);
    expect(simulate(names, steps, false)).toEqual(["1", "2", "3", "other"]);
    // Each item ends where it should: follow "1" through the steps.
    let at = "1";
    for (const s of steps) if (s.from === at) at = s.to;
    expect(at).toBe("2");
  });

  it("runs a case-only rename on Windows directly", () => {
    expect(orderRenames([{ from: "a.txt", to: "A.txt" }], ["a.txt"], true))
      .toEqual([{ from: "a.txt", to: "A.txt" }]);
  });

  it("throws instead of looping on an unchecked conflict", () => {
    expect(() => orderRenames([{ from: "a", to: "b" }], ["a", "b"], false)).toThrow(/already exists/);
  });
});

/** Files by full path, renamed the way the backend renames: a taken
 *  destination or a missing source is refused. `fail` refuses chosen steps. */
function fakeDisk(files: Record<string, string>, fail: (from: string, to: string) => boolean = () => false) {
  const disk = new Map(Object.entries(files));
  const rename = async (from: string, to: string) => {
    if (fail(from, to)) throw new Error(`can't rename ${from}`);
    if (!disk.has(from)) throw new Error(`no such file: ${from}`);
    if (disk.has(to)) throw new Error(`exists: ${to}`);
    disk.set(to, disk.get(from)!);
    disk.delete(from);
  };
  return { rename, files: () => Object.fromEntries([...disk].sort()) };
}

const inDir = (dir: string, moves: RenameMove[]): RenameStep[] => moves.map(m => ({ dir, ...m }));

describe("runRenameSteps", () => {
  it("runs a swap through a temporary name", async () => {
    const disk = fakeDisk({ "/d/a": "A", "/d/b": "B" });
    const steps = inDir("/d", orderRenames([{ from: "a", to: "b" }, { from: "b", to: "a" }], ["a", "b"], false));
    const seen: number[] = [];
    expect(await runRenameSteps(steps, disk.rename, n => seen.push(n))).toEqual({ ok: true, ran: 3 });
    expect(seen).toEqual([1, 2, 3]);
    expect(disk.files()).toEqual({ "/d/a": "B", "/d/b": "A" });
  });

  it("puts every earlier step back when one fails, temporary name included", async () => {
    // The swap's third step (a~rename → b) fails after a → a~rename and b → a.
    const disk = fakeDisk({ "/d/a": "A", "/d/b": "B" }, (from, to) => from.endsWith("~rename") && to === "/d/b");
    const steps = inDir("/d", orderRenames([{ from: "a", to: "b" }, { from: "b", to: "a" }], ["a", "b"], false));
    const res = await runRenameSteps(steps, disk.rename);
    expect(res).toMatchObject({ ok: false, ran: 2, stuck: [] });
    expect(disk.files()).toEqual({ "/d/a": "A", "/d/b": "B" });
    expect(renameFailure(res as Extract<typeof res, { ok: false }>)).toBe("can't rename /d/a~rename (the renames before it were put back)");
  });

  it("lists steps it couldn't put back and still tries the rest", async () => {
    let failing: (from: string) => boolean = from => from === "/z/e";
    const disk = fakeDisk({ "/x/a": "A", "/y/c": "C", "/z/e": "E" }, from => failing(from));
    const steps = [...inDir("/x", [{ from: "a", to: "b" }]), ...inDir("/y", [{ from: "c", to: "d" }]), ...inDir("/z", [{ from: "e", to: "f" }])];
    const run = runRenameSteps(steps, disk.rename, n => {
      // Once two steps ran, putting /y back fails too.
      if (n === 2) failing = from => from === "/z/e" || from === "/y/d";
    });
    const res = await run;
    expect(res).toMatchObject({ ok: false, ran: 2, stuck: [{ dir: "/y", from: "c", to: "d" }] });
    expect(disk.files()).toEqual({ "/x/a": "A", "/y/d": "C", "/z/e": "E" });
    expect(renameFailure(res as Extract<typeof res, { ok: false }>)).toContain("1 earlier rename(s) couldn't be put back; check the folder");
  });

  it("reports a first-step failure as just the error", async () => {
    const disk = fakeDisk({ "/d/a": "A", "/d/b": "B" });
    const res = await runRenameSteps(inDir("/d", [{ from: "a", to: "b" }]), disk.rename);
    expect(res.ok).toBe(false);
    expect(renameFailure(res as Extract<typeof res, { ok: false }>)).toBe("exists: /d/b");
  });

  it("reverses steps last first", () => {
    expect(reverseRenameSteps(inDir("/d", [{ from: "a", to: "t" }, { from: "b", to: "a" }])))
      .toEqual(inDir("/d", [{ from: "a", to: "b" }, { from: "t", to: "a" }]));
  });
});

describe("renameStepsProblem", () => {
  const listing = (dir: string, names: string[]) => new Map([[dir, names]]);

  it("counts names a chain frees on the way", () => {
    expect(renameStepsProblem(inDir("/d", [{ from: "2", to: "3" }, { from: "1", to: "2" }]), listing("/d", ["1", "2"]), false)).toBeNull();
  });

  it("refuses a name that is taken", () => {
    expect(renameStepsProblem(inDir("/d", [{ from: "a", to: "b" }]), listing("/d", ["a", "b"]), false))
      .toBe(`"b" already exists in /d`);
  });

  it("refuses a source that has gone", () => {
    expect(renameStepsProblem(inDir("/d", [{ from: "a", to: "b" }]), listing("/d", ["c"]), false))
      .toBe(`"a" is no longer in /d`);
  });

  it("follows the platform's case rules", () => {
    const steps = inDir("/d", [{ from: "a.txt", to: "A.txt" }]);
    expect(renameStepsProblem(steps, listing("/d", ["a.txt"]), true)).toBeNull();
    expect(renameStepsProblem(inDir("/d", [{ from: "a.txt", to: "b.txt" }]), listing("/d", ["a.txt", "B.txt"]), true))
      .toBe(`"b.txt" already exists in /d`);
    expect(renameStepsProblem(inDir("/d", [{ from: "a.txt", to: "b.txt" }]), listing("/d", ["a.txt", "B.txt"]), false)).toBeNull();
  });
});
