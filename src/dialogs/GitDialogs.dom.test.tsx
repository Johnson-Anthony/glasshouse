// @vitest-environment happy-dom
// The git menu's branch picker and commit dialog: what they list, their
// keys, and what they resolve with.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CommitInfo, GitBranch } from "../api";
import * as api from "../api";
import { GitDialogHost, gitDialogs } from "./GitDialogs";

vi.mock("../api");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
const q = <T extends Element = HTMLElement>(sel: string) => host.querySelector<T>(sel);
const options = () => [...host.querySelectorAll<HTMLElement>("[role=option]")];
const chosen = () => options().findIndex(o => o.getAttribute("aria-selected") === "true");
const tick = () => act(async () => { await new Promise(r => setTimeout(r, 0)); });

async function press(key: string, init: KeyboardEventInit = {}) {
  await act(async () => {
    (document.activeElement ?? window).dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init }));
  });
}

/** Types into the focused field the way React sees it. */
async function type(text: string) {
  const el = document.activeElement as HTMLInputElement | HTMLTextAreaElement;
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, text);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function b(name: string, more: Partial<GitBranch> = {}): GitBranch {
  return { name, current: false, upstream: null, ahead: 0, behind: 0, upstream_gone: false, ...more };
}

beforeEach(async () => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root.render(<GitDialogHost />); });
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.mocked(api.gitBranchList).mockReset();
  vi.mocked(api.gitCommitInfo).mockReset();
});

describe("pickBranch", () => {
  async function open(action: "checkout" | "merge" | "rebase", branches: GitBranch[]) {
    vi.mocked(api.gitBranchList).mockResolvedValue(branches);
    let picked!: Promise<string | null>;
    await act(async () => { picked = gitDialogs.pickBranch({ cwd: "/w", action }); });
    await tick();
    return { picked };
  }
  const BRANCHES = [b("main", { current: true }), b("dev"), b("docs"), b("origin/main", { remote: true }), b("origin/wip", { remote: true })];

  it("lists the other branches with the filter focused, and asks for remote ones", async () => {
    const { picked } = await open("checkout", BRANCHES);
    expect(api.gitBranchList).toHaveBeenCalledWith("/w", true);
    expect(options().map(o => o.textContent)).toEqual(["dev", "docs", "origin/wipnew branch wip"]);
    expect(q(".gitdlg-sub")?.textContent).toBe("on main");
    expect(document.activeElement).toBe(q("input"));
    await press("Escape");
    await expect(picked).resolves.toBeNull();
    expect(q(".gitdlg")).toBeNull();
  });

  it("filters as you type, moves with the arrows and picks with Enter", async () => {
    const { picked } = await open("merge", BRANCHES);
    await type("o");
    // Best match first: a match at the start of the name ranks higher.
    expect(options().map(o => o.firstChild?.textContent)).toEqual(["origin/main", "origin/wip", "docs"]);
    await press("ArrowDown");
    await press("ArrowDown");
    await press("ArrowDown");
    expect(chosen()).toBe(2);
    await press("ArrowUp");
    await press("Enter");
    await expect(picked).resolves.toBe("origin/wip");
  });

  it("a remote-only branch is checked out by its own name", async () => {
    const { picked } = await open("checkout", BRANCHES);
    await type("wip");
    await press("Enter");
    await expect(picked).resolves.toBe("wip");
  });

  it("when nothing matches, Enter takes the text as typed (a tag, a commit)", async () => {
    const { picked } = await open("checkout", BRANCHES);
    await type(" v1.2.0 ");
    expect(options()).toEqual([]);
    expect(q(".gitdlg-list")?.textContent).toContain("enter uses v1.2.0 as typed");
    await press("Enter");
    await expect(picked).resolves.toBe("v1.2.0");
  });

  it("Enter on a focused button is the button's, not a pick", async () => {
    const { picked } = await open("checkout", BRANCHES);
    const cancel = [...host.querySelectorAll<HTMLButtonElement>(".gitdlg-foot button")].find(x => x.textContent === "cancel")!;
    await act(async () => { cancel.focus(); });
    await press("Enter");
    expect(q(".gitdlg")).not.toBeNull();
    await act(async () => { cancel.click(); });
    await expect(picked).resolves.toBeNull();
  });

  it("a click picks", async () => {
    const { picked } = await open("rebase", BRANCHES);
    await act(async () => { options()[2].click(); });
    await expect(picked).resolves.toBe("origin/main");
  });

  it("shows why it can't list branches, and can only be cancelled", async () => {
    vi.mocked(api.gitBranchList).mockRejectedValue("fatal: not a git repository");
    let picked!: Promise<string | null>;
    await act(async () => { picked = gitDialogs.pickBranch({ cwd: "/w", action: "checkout" }); });
    await tick();
    expect(q(".gitdlg-error")?.textContent).toBe("fatal: not a git repository");
    expect(q<HTMLButtonElement>(".gitdlg-foot .primary")?.disabled).toBe(true);
    await press("Enter");
    expect(q(".gitdlg")).not.toBeNull();
    await act(async () => { q<HTMLButtonElement>(".gitdlg-x")!.click(); });
    await expect(picked).resolves.toBeNull();
  });
});

describe("commit", () => {
  const INFO: CommitInfo = {
    branch: "main",
    staged: [
      { code: "M", path: "src/a.ts", old_path: null },
      { code: "R", path: "docs/new.md", old_path: "docs/old.md" },
    ],
    staged_total: 2,
    unstaged: 1,
    head_message: "the last commit\n\nwith a body\n",
  };
  async function open(amend: boolean, info: CommitInfo = INFO) {
    vi.mocked(api.gitCommitInfo).mockResolvedValue(info);
    let args!: Promise<string[] | null>;
    await act(async () => { args = gitDialogs.commit({ cwd: "/w", amend }); });
    await tick();
    return { args };
  }
  const commitButton = () => q<HTMLButtonElement>(".gitdlg-foot .primary")!;

  it("lists what's staged and what isn't, with the message focused", async () => {
    const { args } = await open(false);
    const rows = [...host.querySelectorAll(".gitdlg-staged li")].map(li => li.textContent);
    expect(rows).toEqual(["Msrc/a.ts", "Rdocs/old.md → docs/new.md"]);
    expect(host.textContent).toContain("staged (2)");
    expect(host.textContent).toContain("1 change not staged won't be in the commit");
    expect(document.activeElement).toBe(q("textarea"));
    expect(commitButton().disabled).toBe(true);
    await press("Escape");
    await expect(args).resolves.toBeNull();
  });

  it("takes a multi-line message; Enter is a new line and Ctrl+Enter commits", async () => {
    const { args } = await open(false);
    await type("fix: the thing\n\nbecause");
    await press("Enter");
    expect(q(".gitdlg")).not.toBeNull();
    await press("Enter", { ctrlKey: true });
    await expect(args).resolves.toEqual(["commit", "-m", "fix: the thing\n\nbecause"]);
  });

  it("Ctrl+Enter commits with the focus anywhere in the dialog", async () => {
    const { args } = await open(false);
    await type("msg");
    // A click on the dialog's text puts the focus on the panel.
    await act(async () => { q<HTMLElement>(".gitdlg")!.focus(); });
    expect(document.activeElement).toBe(q(".gitdlg"));
    await press("Enter", { ctrlKey: true });
    await expect(args).resolves.toEqual(["commit", "-m", "msg"]);
  });

  it("with nothing staged, says so and won't commit", async () => {
    const { args } = await open(false, { ...INFO, staged: [], staged_total: 0 });
    expect(host.textContent).toContain("nothing is staged");
    await type("msg");
    expect(commitButton().disabled).toBe(true);
    await press("Enter", { ctrlKey: true });
    expect(q(".gitdlg")).not.toBeNull();
    await press("Escape");
    await expect(args).resolves.toBeNull();
  });

  it("amend starts from the last message and keeps it unless it's changed", async () => {
    const { args } = await open(true, { ...INFO, staged: [], staged_total: 0 });
    expect(q<HTMLTextAreaElement>("textarea")!.value).toBe("the last commit\n\nwith a body");
    expect(host.textContent).toContain("the amend changes only the message");
    expect(commitButton().textContent).toBe("amend");
    await act(async () => { commitButton().click(); });
    await expect(args).resolves.toEqual(["commit", "--amend", "--no-edit"]);
  });

  it("amend with a new message sends it", async () => {
    const { args } = await open(true);
    await type("reworded");
    await press("Enter", { metaKey: true });
    await expect(args).resolves.toEqual(["commit", "--amend", "-m", "reworded"]);
  });

  it("there's nothing to amend before the first commit", async () => {
    const { args } = await open(true, { ...INFO, head_message: null });
    expect(host.textContent).toContain("nothing to amend");
    expect(commitButton().disabled).toBe(true);
    await press("Escape");
    await expect(args).resolves.toBeNull();
  });

  it("shows more than it lists as a count", async () => {
    const { args } = await open(false, { ...INFO, staged_total: 502 });
    expect(host.textContent).toContain("…and 500 more");
    await press("Escape");
    await expect(args).resolves.toBeNull();
  });
});
