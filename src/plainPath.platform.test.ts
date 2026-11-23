// The Windows-only guard, where the app's own (platform-bound) helpers use
// it: a verbatim path never becomes a tab's path, whether it comes from a
// saved session, a navigation or the path box. `./platform` reads the user
// agent, so it's replaced here to stand for a Windows build.
import { describe, expect, it, vi } from "vitest";

vi.mock("./platform", () => ({ IS_WINDOWS: true }));

import { navBack, navGoTo, navInit } from "./history";
import { plainPath, splitBreadcrumb } from "./paths";
import { parseSession } from "./session";
import { parseTyped } from "./typedPath";

const raw = String.raw;

describe("on Windows, a verbatim path", () => {
  it("opens a tab at its plain form", () => {
    expect(navInit(raw`\\?\UNC\nas\media\films`)).toEqual({ path: raw`\\nas\media\films`, back: [], forward: [] });
    const nav = navGoTo(navInit(raw`C:\Users\me`), raw`\\?\C:\Users\me\Documents`);
    expect(nav).toEqual({ path: raw`C:\Users\me\Documents`, back: [raw`C:\Users\me`], forward: [] });
    expect(splitBreadcrumb(nav.path).map(c => c.label)).toEqual(["C:", "Users", "me", "Documents"]);
  });

  it("is the folder the tab is already in, not a new history entry", () => {
    const nav = navInit(raw`C:\Users\me`);
    expect(navGoTo(nav, raw`\\?\C:\Users\me`)).toBe(nav);
    expect(navBack(nav)).toBe(nav);
  });

  it("stays as it is when only that form names the folder", () => {
    expect(navInit(raw`\\?\C:\dir\notes.`).path).toBe(raw`\\?\C:\dir\notes.`);
    expect(navGoTo(navInit(raw`C:\dir`), raw`\\?\C:\dir\aux`).path).toBe(raw`\\?\C:\dir\aux`);
  });

  it("comes back plain from a saved session", () => {
    const tab = (path: string, pane?: number) => ({ path, sort: { key: "name", dir: "asc" }, ...(pane ? { pane } : {}) });
    const saved = JSON.stringify({
      tabs: [tab(raw`\\?\UNC\nas\media\films`), tab(raw`C:\Users\me`), tab(raw`\\?\C:\very\long\path`, 1), tab(raw`\\?\C:\dir\con`)],
      active: 2,
    });
    const s = parseSession(saved);
    expect(s?.tabs.map(t => t.path)).toEqual([raw`\\nas\media\films`, raw`C:\Users\me`, raw`C:\very\long\path`, raw`\\?\C:\dir\con`]);
    expect(s?.active).toBe(2);
  });

  it("typed or pasted, opens plain", () => {
    expect(parseTyped(raw`\\?\UNC\nas\media\films`, raw`C:\x`, null)).toEqual({ kind: "path", path: raw`\\nas\media\films` });
    expect(parseTyped(raw`"\\?\C:\Users\me\..\you"`, raw`C:\x`, null)).toEqual({ kind: "path", path: raw`C:\Users\you` });
  });

  it("is what the exported helper strips", () => {
    expect(plainPath(raw`\\?\C:\Users\me`)).toBe(raw`C:\Users\me`);
  });
});
