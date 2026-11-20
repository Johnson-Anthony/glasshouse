import { describe, expect, it } from "vitest";
import type { GitBranch } from "./api";
import { branchChoices, commitArgs, filterChoices, remoteFailureHint } from "./gitUx";
import { progressText } from "./OpsTray";

function branch(name: string, more: Partial<GitBranch> = {}): GitBranch {
  return { name, current: false, upstream: null, ahead: 0, behind: 0, upstream_gone: false, ...more };
}

const BRANCHES: GitBranch[] = [
  branch("main", { current: true, upstream: "origin/main" }),
  branch("feature/x", { ahead: 2, behind: 1 }),
  branch("stale", { upstream_gone: true }),
  branch("origin/main", { remote: true }),
  branch("origin/feature/x", { remote: true }),
  branch("origin/release", { remote: true }),
];

describe("branchChoices", () => {
  it("checkout: other local branches, and remote ones with no local branch, by their name", () => {
    expect(branchChoices(BRANCHES, "checkout")).toEqual([
      { label: "feature/x", value: "feature/x", remote: false, hint: "↑2 ↓1" },
      { label: "stale", value: "stale", remote: false, hint: "upstream gone" },
      { label: "origin/release", value: "release", remote: true, hint: "new branch release" },
    ]);
  });

  it("merge and rebase: other local branches and every remote one", () => {
    for (const action of ["merge", "rebase"] as const) {
      expect(branchChoices(BRANCHES, action).map(c => c.value)).toEqual([
        "feature/x", "stale", "origin/main", "origin/feature/x", "origin/release",
      ]);
    }
  });

  it("a repo on its only branch offers nothing", () => {
    expect(branchChoices([branch("main", { current: true })], "checkout")).toEqual([]);
  });
});

describe("filterChoices", () => {
  const all = branchChoices(BRANCHES, "merge");
  it("keeps everything for an empty query", () => {
    expect(filterChoices(all, "  ")).toEqual(all);
  });
  it("matches fuzzily, best first", () => {
    expect(filterChoices(all, "rel").map(c => c.label)).toEqual(["origin/release"]);
    expect(filterChoices(all, "fx").map(c => c.label)).toEqual(["feature/x", "origin/feature/x"]);
    expect(filterChoices(all, "zzz")).toEqual([]);
  });
});

describe("commitArgs", () => {
  it("a commit needs a message", () => {
    expect(commitArgs("  ", false, "old")).toBeNull();
    expect(commitArgs(" fix: x\n\nwhy\n ", false, "old")).toEqual(["commit", "-m", "fix: x\n\nwhy"]);
  });
  it("an amend with an empty or unchanged message keeps the old one", () => {
    expect(commitArgs("", true, "old\n")).toEqual(["commit", "--amend", "--no-edit"]);
    expect(commitArgs("old", true, "old\n")).toEqual(["commit", "--amend", "--no-edit"]);
    expect(commitArgs("new", true, "old\n")).toEqual(["commit", "--amend", "-m", "new"]);
  });
});

describe("remoteFailureHint", () => {
  it("explains credential and ssh prompts that couldn't be shown", () => {
    expect(remoteFailureHint("fatal: could not read Username for 'https://github.com': terminal prompts disabled"))
      .toMatch(/credential helper/);
    expect(remoteFailureHint("git@github.com: Permission denied (publickey).\nfatal: Could not read from remote repository."))
      .toMatch(/ssh-agent/);
    expect(remoteFailureHint("Host key verification failed.")).toMatch(/host key/);
  });
  it("stays out of other failures", () => {
    expect(remoteFailureHint("fatal: Not possible to fast-forward, aborting.")).toBeNull();
    expect(remoteFailureHint("ERROR: Repository not found.\nfatal: Could not read from remote repository.")).toBeNull();
  });
});

describe("the tray's text for a git op", () => {
  it("is git's latest line, or starting… before there is one", () => {
    expect(progressText({ done: 0, total: null, unit: "status", detail: null })).toBe("starting…");
    expect(progressText({ done: 4, total: 10, unit: "status", detail: "Writing objects:  40% (4/10)" }))
      .toBe("Writing objects:  40% (4/10)");
    // Other ops are unchanged.
    expect(progressText({ done: 5, total: null, unit: "items", detail: null })).toBe("5 looked at");
  });
});
