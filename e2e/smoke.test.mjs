// Flow 1: the real app starts in a window that fits the screen, renders,
// lists a folder typed into Go to Path, and shows drives and known folders
// in the sidebar (on Linux, also the pins a first run starts with), with no
// uncaught errors. Flow 2: split view. Flow 3: a second window in the same
// process. Flow 4: a tab moved to a new window. Flow 5: Copy, Cut and Paste
// through the OS clipboard, with another app on the other side (xclip on
// Linux, PowerShell on Windows). Flow 6 (Linux): a folder reached through a
// symlink. Linux: `pnpm e2e` (Xvfb and a private bus). Windows: run
// this file directly with `node --test` in an interactive session, with a
// msedgedriver that matches the WebView2 Runtime (e2e/edgedriver.ps1).
// Artifacts go to e2e/artifacts/ whatever the outcome.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { basename as posixBasename, join, win32 } from "node:path";
import { pathToFileURL } from "node:url";
import { after, afterEach, before, test } from "node:test";

import { ARTIFACTS, IS_WINDOWS, ROOT, SESSION_DEADLINE_MS, appEnv, appPath, capabilities, captureDesktop, makeFixture, makeScratch, osClipboard, startDriver } from "./harness.mjs";
import { Keys, Session, WebDriverError, waitFor } from "./webdriver.mjs";

const basename = IS_WINDOWS ? win32.basename : posixBasename;
const samePath = (a, b) => (IS_WINDOWS ? a.toLowerCase() === b.toLowerCase() : a === b);

let scratch, home, fixture, driver, session;
const notes = [];
/** Every browser-log entry read so far: the driver hands each out once. */
const browserLog = [];

async function readBrowserLog() {
  browserLog.push(...((await session.browserLog()) ?? []));
  return browserLog;
}

/** Collects what goes wrong in the page from session start: uncaught
 *  errors, unhandled rejections and console.error calls. Not before the
 *  app's page is there: msedgedriver can attach while the webview still
 *  shows about:blank, and listeners put there go when the app loads. */
function installErrorListeners() {
  if (location.protocol === "about:") return false;
  if (window.__e2e) return true;
  const seen = (window.__e2e = { errors: [], consoleErrors: [] });
  const text = v => (v instanceof Error ? v.stack || String(v) : typeof v === "string" ? v : JSON.stringify(v));
  window.addEventListener("error", e => { seen.errors.push(`uncaught: ${e.error ? text(e.error) : e.message} (${e.filename}:${e.lineno})`); });
  window.addEventListener("unhandledrejection", e => { seen.errors.push(`unhandled rejection: ${text(e.reason)}`); });
  const consoleError = console.error.bind(console);
  console.error = (...args) => {
    seen.consoleErrors.push(args.map(text).join(" "));
    consoleError(...args);
  };
  return true;
}

before(async () => {
  rmSync(ARTIFACTS, { recursive: true, force: true });
  mkdirSync(ARTIFACTS, { recursive: true });
  console.log(`artifacts: ${ARTIFACTS}`);
  const app = appPath();
  scratch = makeScratch();
  const { env, home: appHome, wrap } = appEnv(scratch);
  home = appHome;
  fixture = makeFixture(scratch);
  // A GTK bookmark, which a first run pins (Linux's scratch home makes it
  // one; on Windows the runner's profile has Quick Access instead).
  if (!IS_WINDOWS) {
    mkdirSync(join(env.XDG_CONFIG_HOME, "gtk-3.0"), { recursive: true });
    writeFileSync(join(env.XDG_CONFIG_HOME, "gtk-3.0", "bookmarks"), `${pathToFileURL(fixture.path).href} fixture\nsftp://example.com/x remote\n`);
  }
  driver = await startDriver({ env, wrap, logFile: join(ARTIFACTS, "driver-and-app.log") });
  const start = { deadlineMs: SESSION_DEADLINE_MS };
  try {
    session = await Session.create(driver.base, capabilities(app), start).catch(async e => {
      // The log preference is a nice-to-have; a driver that refuses it
      // shouldn't stop the run.
      if (!(e instanceof WebDriverError && e.error === "invalid argument" && IS_WINDOWS)) throw e;
      notes.push(`browser log not available: ${e.message}`);
      return Session.create(driver.base, capabilities(app, { browserLog: false }), start);
    });
  } catch (e) {
    const hint = IS_WINDOWS
      ? "a msedgedriver that doesn't match the WebView2 Runtime hangs here (e2e/edgedriver.ps1), and an elevated app fails with \"DevToolsActivePort file doesn't exist\" (e2e/unelevated.ps1)"
      : "check that WebKitWebDriver (apt webkit2gtk-driver) is the same version as the WebKitGTK the app uses";
    throw new Error(`no session: ${e.message}. ${hint}; the drivers' and the app's output is in driver-and-app.log`);
  }
  writeFileSync(join(ARTIFACTS, "session.json"), JSON.stringify({ driver: { bin: driver.bin, native: driver.native }, capabilities: session.capabilities }, null, 2) + "\n");
  await waitFor("the page to run scripts", () => session.execute(installErrorListeners), { timeoutMs: 30_000 });
}, { timeout: SESSION_DEADLINE_MS + 60_000 });

afterEach(async t => {
  if (!session) return;
  const name = t.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  try {
    writeFileSync(join(ARTIFACTS, `webview-${name}.png`), await session.screenshot());
  } catch (e) {
    notes.push(`webview screenshot after "${t.name}" failed: ${e.message}`);
  }
});

after(async () => {
  // While the app is still open; also when the session never started, which
  // is when the desktop (and on Windows, who's logged on) tells the most.
  if (driver) {
    const desktop = captureDesktop(ARTIFACTS);
    if (desktop) notes.push(desktop);
  }
  if (session) {
    try {
      const page = await session.execute(() => ({ seen: window.__e2e ?? null, text: document.body.innerText }));
      writeFileSync(join(ARTIFACTS, "page.txt"), page.text);
      writeFileSync(join(ARTIFACTS, "page-errors.json"), JSON.stringify(page.seen, null, 2) + "\n");
    } catch (e) {
      notes.push(`reading the page failed: ${e.message}`);
    }
    try {
      if (IS_WINDOWS) writeFileSync(join(ARTIFACTS, "browser-log.json"), JSON.stringify(await readBrowserLog(), null, 2) + "\n");
    } catch (e) {
      notes.push(`reading the browser log failed: ${e.message}`);
    }
    try {
      await session.delete();
    } catch (e) {
      notes.push(`deleting the session failed: ${e.message}`);
    }
  }
  if (driver) await driver.stop();
  if (notes.length) writeFileSync(join(ARTIFACTS, "notes.txt"), notes.join("\n") + "\n");
  if (scratch) rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

test("the window renders", { timeout: 60_000 }, async () => {
  const shell = await waitFor("the app's shell and its first listing", () => session.execute(() => {
    const has = sel => !!document.querySelector(sel);
    const parts = { titlebar: has(".app .titlebar"), sidebar: has(".app .sidebar"), pane: has(".app .pane"), statusbar: has(".app .statusbar") };
    const listed = has(".pane .row") || [...document.querySelectorAll(".pane .pane-notice")].some(n => n.textContent !== "loading…");
    return Object.values(parts).every(Boolean) && listed ? { ...parts, title: document.title } : null;
  }), { timeoutMs: 45_000 });
  assert.equal(shell.title, "glasshouse");
});

test("the window fits the screen's work area", { timeout: 30_000 }, async () => {
  const fit = await session.execute(() => ({
    x: window.screenX, y: window.screenY, w: window.innerWidth, h: window.innerHeight,
    ax: screen.availLeft ?? 0, ay: screen.availTop ?? 0, aw: screen.availWidth, ah: screen.availHeight,
  }));
  // A pixel or two of rounding at fractional scales.
  const slack = 2;
  const where = JSON.stringify(fit);
  assert.ok(fit.w <= fit.aw + slack && fit.h <= fit.ah + slack, `the window is bigger than the work area: ${where}`);
  assert.ok(fit.x >= fit.ax - slack && fit.y >= fit.ay - slack, `the window starts off the work area: ${where}`);
  assert.ok(fit.x + fit.w <= fit.ax + fit.aw + slack && fit.y + fit.h <= fit.ay + fit.ah + slack, `the window runs off the work area: ${where}`);
});

test("it starts with no notice, error or dialog", { timeout: 30_000 }, async () => {
  const shown = await session.execute(() => ({
    // A toast for launch arguments it couldn't use (App.tsx, launch.ts):
    // a driver passing its own switches to the app would show here.
    notice: [...document.querySelectorAll("div")].map(d => d.textContent).find(t => t.startsWith("●couldn't open")) ?? null,
    paneError: document.querySelector(".pane-notice.error")?.textContent ?? null,
    dialog: [...document.querySelectorAll("button")].some(b => /^(ok|cancel)$/.test(b.textContent.trim()) && b.offsetParent !== null),
    // The error boundary's screen (CrashScreen.tsx): a render that threw.
    crash: document.querySelector(".crash-screen")?.textContent ?? null,
  }));
  assert.deepEqual(shown, { notice: null, paneError: null, dialog: false, crash: null });
});

test("it logs what it started on, and no error", { timeout: 30_000 }, async () => {
  // diagnostics.rs: the app's log folder. On Windows it's the profile's own,
  // so earlier runs' lines can be there: only this run's, from its start
  // line on, count.
  const appId = "io.github.johnson-anthony.glasshouse";
  const dir = IS_WINDOWS
    ? join(process.env.LOCALAPPDATA ?? join(home, "AppData", "Local"), appId, "logs")
    : join(home, ".local", "share", appId, "logs");
  const started = / INFO +\S+: glasshouse \S+ started: /;
  const lines = await waitFor("the log's start line", () => {
    const all = readFileSync(join(dir, "glasshouse.log"), "utf8").split("\n");
    const at = all.findLastIndex(l => started.test(l));
    return at >= 0 ? all.slice(at) : null;
  });
  writeFileSync(join(ARTIFACTS, "glasshouse.log"), lines.join("\n"));
  notes.push(`log: ${lines[0]}`);
  assert.deepEqual(lines.filter(l => / ERROR |panic/.test(l)), []);
});

test("Go to Path lists a fixture folder", { timeout: 60_000 }, async () => {
  await session.chord([Keys.CONTROL, "l"]);
  const input = await waitFor("the Go to Path prompt", () => session.execute(() => {
    const message = [...document.querySelectorAll("div")].find(d => d.textContent === "path to navigate to:");
    return message?.parentElement?.querySelector("input") ?? null;
  }));
  // The prompt opens holding the current folder: select it and type over it.
  await session.sendKeys(input, `${Keys.CONTROL}a${Keys.CONTROL}${fixture.path}${Keys.ENTER}`);
  const listed = await waitFor(`a listing of ${fixture.path}`, () => session.execute(want => {
    const names = [...document.querySelectorAll(".pane .row .name")].map(n => n.textContent.trim());
    const crumb = document.querySelector(".breadcrumb .crumb.last")?.textContent ?? null;
    return want.every(w => names.includes(w)) ? { names, crumb } : null;
  }, fixture.names));
  assert.deepEqual([...listed.names].sort(), [...fixture.names].sort());
  assert.equal(listed.crumb, basename(fixture.path));
});

test("the sidebar shows drives and known folders", { timeout: 30_000 }, async () => {
  const sidebar = await waitFor("drives and the home folder's tree in the sidebar", () => session.execute(() => {
    const devices = document.querySelector('[data-sb-group-title="DEVICES"]')?.closest(".sb-group");
    const drives = devices ? [...devices.querySelectorAll(".sb-item[title]")].map(e => e.getAttribute("title")) : [];
    const tree = [...document.querySelectorAll(".sidebar .tree-row[title]")].map(e => e.getAttribute("title"));
    return drives.length > 0 && tree.length > 1 ? { drives, tree } : null;
  }));
  const root = IS_WINDOWS ? /^[A-Z]:\\?$/i : /^\/$/;
  assert.ok(sidebar.drives.some(d => root.test(d)), `no ${IS_WINDOWS ? "drive letter" : "/"} among the drives: ${JSON.stringify(sidebar.drives)}`);
  if (IS_WINDOWS) assert.ok(sidebar.drives.some(d => /^C:/i.test(d)), `no C: among ${JSON.stringify(sidebar.drives)}`);
  assert.ok(samePath(sidebar.tree[0], home), `the tree's root is ${sidebar.tree[0]}, not home (${home})`);
  const children = sidebar.tree.slice(1).map(p => basename(p));
  for (const name of ["Documents", "Downloads"]) {
    assert.ok(children.includes(name), `no ${name} under home in the tree: ${JSON.stringify(children)}`);
  }
});

test("a first run pins the known folders and the desktop's bookmarks", { timeout: 30_000, skip: IS_WINDOWS && "the runner's profile may not be a first run" }, async () => {
  const pins = await waitFor("the first run's pins", () => session.execute(() => {
    const group = document.querySelector('[data-sb-group-title="PINNED"]')?.closest(".sb-group");
    const titles = group ? [...group.querySelectorAll(".sb-item[title]")].map(e => e.getAttribute("title")) : [];
    return titles.length > 0 ? titles : null;
  }));
  // The harness makes Desktop, Documents, Downloads and Pictures, and no
  // Music or Videos; the sftp:// bookmark can't be listed, so it's left out.
  const want = [home, ...["Desktop", "Documents", "Downloads", "Pictures"].map(n => join(home, n)), fixture.path];
  assert.deepEqual(pins, want);
});

// Split view (src/tabLayout.ts): two panes with their own tabs, the
// focused one driving the breadcrumb, tabs moving between them by drag and
// by the tab menu, a copy into the other pane's folder, and Close Split
// putting every tab back in the title bar. Starts where Go to Path left the
// window: one tab, on the fixture.
test("split view", { timeout: 120_000 }, async () => {
  /** Each pane's tab labels and the names it lists, and which has focus. */
  const panes = () => session.execute(() => [...document.querySelectorAll(".split-pane")].map(p => ({
    pane: Number(p.getAttribute("data-tab-pane")),
    focused: p.classList.contains("focused"),
    tabs: [...(p.querySelector("[data-tab-bar]") ?? document.querySelector(".titlebar [data-tab-bar]")).querySelectorAll("[data-tab-index]")]
      .map(t => t.querySelector(".label").textContent),
    names: [...p.querySelectorAll(".pane .row .name")].map(n => n.textContent.trim()),
  })));
  const crumb = () => session.execute(() => document.querySelector(".breadcrumb .crumb.last")?.textContent ?? null);
  const lists = (p, names) => names.every(n => p.names.includes(n));
  const fixtureName = basename(fixture.path);

  // Ctrl+\ splits, the new pane on the same folder and focused.
  await session.chord([Keys.CONTROL, "\\"]);
  let now = await waitFor("two panes listing the fixture", async () => {
    const ps = await panes();
    return ps.length === 2 && ps.every(p => lists(p, fixture.names)) ? ps : null;
  });
  assert.deepEqual(now.map(p => p.focused), [false, true]);

  // Ctrl+F6 moves the focus; the breadcrumb follows the focused pane.
  await session.chord([Keys.CONTROL, Keys.F6]);
  await waitFor("the first pane focused", async () => (await panes())[0]?.focused);
  await session.chord([Keys.CONTROL, "l"]);
  const input = await waitFor("the Go to Path prompt", () => session.execute(() => {
    const message = [...document.querySelectorAll("div")].find(d => d.textContent === "path to navigate to:");
    return message?.parentElement?.querySelector("input") ?? null;
  }));
  await session.sendKeys(input, `${Keys.CONTROL}a${Keys.CONTROL}${join(fixture.path, "alpha")}${Keys.ENTER}`);
  await waitFor("the first pane in alpha", async () => (await crumb()) === "alpha");
  now = await panes();
  assert.ok(lists(now[1], fixture.names), `the second pane moved too: ${JSON.stringify(now[1])}`);
  await session.chord([Keys.CONTROL, Keys.F6]);
  await waitFor("the breadcrumb on the second pane's folder", async () => (await crumb()) === fixtureName);

  // A second tab in the second pane, dragged onto the first pane's tab bar.
  await session.click(await session.find('.split-pane[data-tab-pane="1"] .tab-btn'));
  await waitFor("two tabs in the second pane", async () => (await panes())[1]?.tabs.length === 2);
  const boxes = await session.execute(() => {
    const r = el => { const b = el.getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2, b.right]; };
    const tab = document.querySelectorAll('.split-pane[data-tab-pane="1"] [data-tab-index]')[1];
    const bar = document.querySelector('.split-pane[data-tab-pane="0"] [data-tab-bar]');
    const last = [...bar.querySelectorAll("[data-tab-index]")].pop();
    return { tab: r(tab), after: [r(last)[2] + 20, r(last)[1]] };
  });
  await session.drag(boxes.tab.slice(0, 2), [boxes.tab[0] - 40, boxes.tab[1]], boxes.after);
  now = await waitFor("the dragged tab in the first pane", async () => {
    const ps = await panes();
    return ps[0]?.tabs.length === 2 && ps[1]?.tabs.length === 1 ? ps : null;
  });
  assert.equal(now[0].tabs[1], fixture.path);
  assert.ok(now[0].focused, "the pane a tab is dropped in takes the focus");

  // The tab menu's Move to Other Pane sends it back.
  await session.execute(() => {
    const tab = document.querySelectorAll('.split-pane[data-tab-pane="0"] [data-tab-index]')[1];
    const b = tab.getBoundingClientRect();
    tab.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: b.left + 5, clientY: b.top + 5 }));
  });
  const item = await waitFor("Move to Other Pane in the tab menu", () => session.execute(() =>
    [...document.querySelectorAll(".mi")].find(m => m.textContent.includes("Move to Other Pane")) ?? null));
  await session.click(item);
  await waitFor("the tab back in the second pane", async () => {
    const ps = await panes();
    return ps[0]?.tabs.length === 1 && ps[1]?.tabs.length === 2;
  });

  // Copy to Other Pane: beta.txt from the second pane into alpha.
  await session.click(await session.execute(() =>
    [...document.querySelectorAll('.split-pane[data-tab-pane="1"] .row')].find(r => r.querySelector(".name")?.textContent.trim() === "beta.txt")));
  await session.click(await session.execute(() => [...document.querySelectorAll(".menubar-item")].find(m => m.textContent.trim() === "Edit")));
  await session.click(await waitFor("Copy to Other Pane in the Edit menu", () => session.execute(() =>
    [...document.querySelectorAll(".mi")].find(m => m.textContent.includes("Copy to Other Pane")) ?? null)));
  await waitFor("beta.txt copied into alpha", async () => lists((await panes())[0], ["beta.txt"]));

  // Ctrl+\ again closes the split: every tab in the title bar, the focused
  // pane's shown tab still shown.
  await session.chord([Keys.CONTROL, "\\"]);
  const merged = await waitFor("one pane again", async () => {
    const ps = await panes();
    return ps.length === 1 ? ps[0] : null;
  });
  assert.equal(merged.tabs.length, 3);
  assert.equal(await crumb(), fixtureName);
});

// One process, many windows (src-tauri/src/app_windows.rs): File → New
// Window opens a second window in the same app (the driver, which started
// one process, sees it), labelled main-2, which lists its home folder. A
// setting changed in it reaches the first window. Closing it leaves the
// first one open.
test("new window", { timeout: 120_000 }, async () => {
  const first = await session.windowHandle();
  assert.deepEqual(await session.windowHandles(), [first]);
  const label = () => session.execute(() => window.__TAURI_INTERNALS__?.metadata?.currentWindow?.label ?? null);
  assert.equal(await label(), "main");

  await session.chord([Keys.CONTROL, "n"]);
  const second = await waitFor("a second window", async () => (await session.windowHandles()).find(h => h !== first), { timeoutMs: 30_000 });
  await session.switchToWindow(second);
  await waitFor("the second window's page to run scripts", () => session.execute(installErrorListeners), { timeoutMs: 30_000 });
  assert.equal(await label(), "main-2");
  const listed = await waitFor("the second window's listing of home", () => session.execute(() => {
    const names = [...document.querySelectorAll(".pane .row .name")].map(n => n.textContent.trim());
    const tabs = document.querySelectorAll(".titlebar [data-tab-bar] [data-tab-index]").length;
    return names.includes("Documents") && names.includes("Downloads") ? { names, tabs } : null;
  }), { timeoutMs: 45_000 });
  assert.equal(listed.tabs, 1, "a new window opens one tab");

  // A theme picked in the second window is the first window's too.
  const theme = "gruvbox-dark";
  await session.execute(t => window.dispatchEvent(new CustomEvent("glasshouse:set-theme", { detail: t })), theme);
  await waitFor("the second window in the new theme", () => session.execute(t => document.documentElement.getAttribute("data-theme") === t, theme));
  await session.switchToWindow(first);
  await waitFor("the first window in the theme the second picked", () => session.execute(t => document.documentElement.getAttribute("data-theme") === t, theme));
  // The first window kept its own tabs (split view left three).
  assert.equal(await session.execute(() => document.querySelectorAll(".titlebar [data-tab-bar] [data-tab-index]").length), 3);

  // The second window's own close button closes it alone.
  await session.switchToWindow(second);
  const seen = await session.execute(() => window.__e2e ?? null);
  assert.deepEqual(seen?.errors ?? [], [], "uncaught errors in the second window");
  await session.execute(() => document.querySelector(".wc.close").click());
  await waitFor("one window again", async () => (await session.windowHandles()).length === 1, { timeoutMs: 30_000 });
  await session.switchToWindow(first);
  assert.equal(await label(), "main");
});

// Tear-off without a drag (src/tabMoves.ts, src-tauri/src/tab_drag.rs): the
// tab menu's Move to New Window. The tab leaves the first window, and a
// second window opens with it, listing its folder, with its Back history.
test("move to new window", { timeout: 120_000 }, async () => {
  const first = await session.windowHandle();
  assert.deepEqual(await session.windowHandles(), [first]);
  const titleTabs = () => session.execute(() =>
    [...document.querySelectorAll(".titlebar [data-tab-bar] [data-tab-index] .label")].map(l => l.textContent));
  const before = await titleTabs();
  assert.equal(before.length, 3, `split view left three tabs: ${JSON.stringify(before)}`);
  const index = before.findIndex(l => samePath(l, fixture.path));
  assert.ok(index >= 0, `a tab on the fixture: ${JSON.stringify(before)}`);
  // Give it a Back history: alpha opened in it, so Back goes to the fixture.
  await session.execute(i => document.querySelectorAll(".titlebar [data-tab-index]")[i].click(), index);
  await session.click(await waitFor("alpha in the fixture tab", () => session.execute(() =>
    [...document.querySelectorAll(".pane .row")].find(r => r.querySelector(".name")?.textContent.trim() === "alpha") ?? null)));
  await session.chord([Keys.ENTER]);
  await waitFor("the tab in alpha", async () => (await titleTabs())[index]?.endsWith("alpha"));
  const staying = (await titleTabs()).filter((_, i) => i !== index);

  await session.execute(i => {
    const tab = document.querySelectorAll(".titlebar [data-tab-index]")[i];
    const b = tab.getBoundingClientRect();
    tab.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: b.left + 5, clientY: b.top + 5 }));
  }, index);
  await session.click(await waitFor("Move to New Window in the tab menu", () => session.execute(() =>
    [...document.querySelectorAll(".mi")].find(m => m.textContent.includes("Move to New Window")) ?? null)));

  const second = await waitFor("a window for the tab", async () => (await session.windowHandles()).find(h => h !== first), { timeoutMs: 30_000 });
  // It left the first window.
  const left = await waitFor("the tab gone from the first window", async () => {
    const now = await titleTabs();
    return now.length === 2 ? now : null;
  });
  assert.deepEqual(left, staying, "the other two tabs stay");

  await session.switchToWindow(second);
  await waitFor("the new window's page to run scripts", () => session.execute(installErrorListeners), { timeoutMs: 30_000 });
  const listed = await waitFor("the new window's listing of alpha", () => session.execute(() => {
    const names = [...document.querySelectorAll(".pane .row .name")].map(n => n.textContent.trim());
    const tabs = [...document.querySelectorAll(".titlebar [data-tab-bar] [data-tab-index] .label")].map(l => l.textContent);
    return names.includes("beta.txt") ? { names, tabs } : null;
  }), { timeoutMs: 45_000 });
  assert.equal(listed.tabs.length, 1, "the new window has the one tab");
  assert.ok(listed.tabs[0].endsWith("alpha"), `its tab: ${listed.tabs[0]}`);
  // Its history came with it: Back goes to the fixture.
  await session.chord([Keys.ALT, Keys.ARROW_LEFT]);
  await waitFor("Back in the new window to the fixture", () => session.execute(name =>
    [...document.querySelectorAll(".pane .row .name")].some(n => n.textContent.trim() === name), "Gamma notes.md"));

  const seen = await session.execute(() => window.__e2e ?? null);
  assert.deepEqual(seen?.errors ?? [], [], "uncaught errors in the new window");
  await session.execute(() => document.querySelector(".wc.close").click());
  await waitFor("one window again", async () => (await session.windowHandles()).length === 1, { timeoutMs: 30_000 });
  await session.switchToWindow(first);
});

// The OS clipboard (src/clipboard.ts, src-tauri/src/commands/clipboard.rs).
// Another app reads what glasshouse copied and fills what glasshouse pastes.
// A cut shows as cut only while it's what the clipboard holds: another
// app's copy ends it, and so does its paste, here in a second window.
test("the OS clipboard", { timeout: 180_000 }, async () => {
  const first = await session.windowHandle();
  assert.deepEqual(await session.windowHandles(), [first]);
  // Its own folder, so what earlier flows left behind doesn't matter.
  const dir = join(scratch, "clipboard flow");
  const to = join(dir, "to");
  mkdirSync(to, { recursive: true });
  const [one, two, three] = ["one.txt", "naïve two.txt", "three.txt"];
  for (const name of [one, two, three]) writeFileSync(join(dir, name), `${name}\n`);

  const names = () => session.execute(() => [...document.querySelectorAll(".pane .row .name")].map(n => n.textContent.trim()));
  const cutRows = () => session.execute(() => [...document.querySelectorAll(".pane .row.clip-cut .name")].map(n => n.textContent.trim()));
  const goTo = async (path, want) => {
    await session.chord([Keys.CONTROL, "l"]);
    const input = await waitFor("the Go to Path prompt", () => session.execute(() => {
      const message = [...document.querySelectorAll("div")].find(d => d.textContent === "path to navigate to:");
      return message?.parentElement?.querySelector("input") ?? null;
    }));
    await session.sendKeys(input, `${Keys.CONTROL}a${Keys.CONTROL}${path}${Keys.ENTER}`);
    await waitFor(`a listing of ${path}`, async () => {
      const crumb = await session.execute(() => document.querySelector(".breadcrumb .crumb.last")?.textContent ?? null);
      const listed = await names();
      return crumb === basename(path) && want.every(w => listed.includes(w));
    }, { timeoutMs: 45_000 });
  };
  const select = async name => session.click(await waitFor(`${name} in the list`, () => session.execute(n =>
    [...document.querySelectorAll(".pane .row")].find(r => r.querySelector(".name")?.textContent.trim() === n) ?? null, name)));
  const sameFiles = (clip, cut, paths) =>
    clip !== null && clip.cut === cut && clip.paths.length === paths.length && clip.paths.every((p, i) => samePath(p, paths[i]));
  // Windows hears of another app's copy when a window next gets the focus.
  const refocus = () => (IS_WINDOWS ? session.execute(() => { window.dispatchEvent(new Event("focus")); }) : null);

  // Copy: every app can paste it.
  await goTo(dir, [one, two, three]);
  await select(two);
  await session.chord([Keys.CONTROL, "c"]);
  await waitFor("the copied file on the OS clipboard", () => sameFiles(osClipboard.files(), false, [join(dir, two)]));
  if (!IS_WINDOWS) {
    const uri = pathToFileURL(join(dir, two)).href;
    assert.match(uri, /na%C3%AFve%20two\.txt$/);
    const targets = (osClipboard.target("TARGETS") ?? "").split("\n");
    for (const t of ["text/uri-list", "x-special/gnome-copied-files", "application/x-kde-cutselection", "UTF8_STRING", "text/plain;charset=utf-8"]) {
      assert.ok(targets.includes(t), `${t} offered: ${JSON.stringify(targets)}`);
    }
    assert.equal(osClipboard.target("text/uri-list"), `${uri}\r\n`);
    assert.equal(osClipboard.target("x-special/gnome-copied-files"), `copy\n${uri}`);
    assert.equal(osClipboard.target("application/x-kde-cutselection"), "0");
    assert.equal(osClipboard.target("UTF8_STRING"), join(dir, two));
  }
  assert.deepEqual(await cutRows(), []);

  // Copy Path: text, in place of the files.
  await session.chord([Keys.CONTROL, Keys.SHIFT, "c"]);
  await waitFor("the path on the OS clipboard", () => osClipboard.text() === join(dir, two) && osClipboard.files() === null);

  // Cut: the row dims, and other apps see a cut. Another app's copy ends
  // it: the row is no longer shown as cut, and the file stays.
  await select(one);
  await session.chord([Keys.CONTROL, "x"]);
  await waitFor("the cut file on the OS clipboard", () => sameFiles(osClipboard.files(), true, [join(dir, one)]));
  await waitFor("the cut row dimmed", async () => (await cutRows()).join() === one);
  if (!IS_WINDOWS) assert.equal(osClipboard.target("application/x-kde-cutselection"), "1");
  osClipboard.putText("copied in another app");
  await refocus();
  await waitFor("the cut ended by another app's copy", async () => (await cutRows()).length === 0);
  assert.ok(existsSync(join(dir, one)));

  // Cut here, Paste in a second window: the file moves, and the cut is over
  // in both windows and on the clipboard.
  await session.chord([Keys.CONTROL, "x"]);
  await waitFor("the cut row dimmed again", async () => (await cutRows()).join() === one);
  await session.chord([Keys.CONTROL, "n"]);
  const second = await waitFor("a second window", async () => (await session.windowHandles()).find(h => h !== first), { timeoutMs: 30_000 });
  await session.switchToWindow(second);
  await waitFor("the second window's page to run scripts", () => session.execute(installErrorListeners), { timeoutMs: 30_000 });
  await waitFor("the second window's listing of home", async () => (await names()).includes("Documents"), { timeoutMs: 45_000 });
  await goTo(to, []);
  await session.chord([Keys.CONTROL, "v"]);
  await waitFor("the cut file pasted in the second window", async () => (await names()).includes(one));
  assert.ok(existsSync(join(to, one)), "the file is in the folder it was pasted into");
  assert.ok(!existsSync(join(dir, one)), "a cut moves: the file left its folder");
  await waitFor("the clipboard emptied of the pasted cut", () => osClipboard.files() === null);
  await session.switchToWindow(first);
  await waitFor("the first window without the moved file or a cut row", async () =>
    (await cutRows()).length === 0 && !(await names()).includes(one));

  // Another app's Copy pastes here as a copy, and its Cut as a move.
  await session.switchToWindow(second);
  osClipboard.putFiles([join(dir, three)], { as: "text/uri-list" });
  await session.chord([Keys.CONTROL, "v"]);
  await waitFor("another app's copied file pasted", async () => (await names()).includes(three));
  assert.ok(existsSync(join(dir, three)), "a copy leaves the file where it was");
  osClipboard.putFiles([join(dir, two)], { cut: true });
  await session.chord([Keys.CONTROL, "v"]);
  await waitFor("another app's cut file pasted", async () => (await names()).includes(two));
  assert.ok(existsSync(join(to, two)));
  assert.ok(!existsSync(join(dir, two)), "another app's cut moves");
  assert.deepEqual(await cutRows(), [], "another app's cut isn't shown as glasshouse's");

  const seen = await session.execute(() => window.__e2e ?? null);
  assert.deepEqual(seen?.errors ?? [], [], "uncaught errors in the second window");
  await session.execute(() => document.querySelector(".wc.close").click());
  await waitFor("one window again", async () => (await session.windowHandles()).length === 1, { timeoutMs: 30_000 });
  await session.switchToWindow(first);
});

// A folder reached through a link. A listing's rows keep the path it was
// asked for (src-tauri/src/commands/listing.rs), so everything keyed by
// path goes by the link's: a folder opened from it, the watcher, git
// status, tags, a pin, rename, cut and paste, the trash and their undos,
// a paste into the same folder by its other path,
// and the saved session and recents.
test("a folder reached through a link", { timeout: 180_000, skip: IS_WINDOWS && "a symlink needs a privilege there; junctions and mapped drives are hand checks (docs/testing/windows.md)" }, async () => {
  const real = join(scratch, "real place");
  const link = join(scratch, "linked");
  mkdirSync(join(real, "sub"), { recursive: true });
  writeFileSync(join(real, "sub", "inner.txt"), "inner\n");
  writeFileSync(join(real, "note.txt"), "note\n");
  symlinkSync(real, link, "dir");
  // A repository, for the status column: everything in it is untracked.
  const git = spawnSync("git", ["init", "-q", real], { env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" } });
  const haveGit = git.status === 0;
  assert.ok(haveGit || !process.env.CI, "git isn't installed, and CI has it");
  if (!haveGit) notes.push("no git here: the linked folder's status column went unchecked");

  const config = join(home, ".config", JSON.parse(readFileSync(join(ROOT, "src-tauri", "tauri.conf.json"), "utf8")).identifier);
  const saved = name => {
    try { return JSON.parse(readFileSync(join(config, name), "utf8")); } catch { return null; }
  };
  const tagKeys = () => Object.keys(saved("tags.json") ?? {});
  const rows = () => session.execute(() => [...document.querySelectorAll(".pane .row")].map(r => ({
    name: r.querySelector(".name").textContent.trim(),
    path: r.getAttribute("data-drop-path"),
    git: r.getAttribute("data-git"),
    tag: r.querySelector(".c-tag").textContent.trim(),
  })));
  const listing = (what, test) => waitFor(what, async () => {
    const now = await rows();
    return test(now.map(r => r.name)) ? now : null;
  });
  const row = name => waitFor(`the row ${name}`, () => session.execute(want =>
    [...document.querySelectorAll(".pane .row")].find(r => r.querySelector(".name").textContent.trim() === want) ?? null, name));
  const prompt = message => waitFor(`the prompt "${message}"`, () => session.execute(want => {
    const div = [...document.querySelectorAll("div")].find(d => d.textContent === want);
    return div?.parentElement?.querySelector("input") ?? null;
  }, message));
  const menuItem = label => waitFor(`${label} in the menu`, () => session.execute(want =>
    [...document.querySelectorAll(".mi")].find(m => m.children[1]?.textContent.startsWith(want)) ?? null, label));
  const contextMenu = async name => {
    await row(name);
    await session.execute(want => {
      const r = [...document.querySelectorAll(".pane .row")].find(x => x.querySelector(".name").textContent.trim() === want);
      const b = r.getBoundingClientRect();
      r.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: b.left + 40, clientY: b.top + 5 }));
    }, name);
  };
  const where = async () => {
    await session.chord([Keys.CONTROL, "l"]);
    const input = await prompt("path to navigate to:");
    const at = await session.execute(el => el.value, input);
    await session.sendKeys(input, Keys.ESCAPE);
    await waitFor("the prompt to close", async () => !(await session.execute(() =>
      [...document.querySelectorAll("div")].some(d => d.textContent === "path to navigate to:"))));
    return at;
  };

  await session.chord([Keys.CONTROL, "l"]);
  await session.sendKeys(await prompt("path to navigate to:"), `${Keys.CONTROL}a${Keys.CONTROL}${link}${Keys.ENTER}`);
  let now = await listing("the linked folder's listing", names => names.includes("sub") && names.includes("note.txt"));
  assert.equal(now.find(r => r.name === "sub").path, join(link, "sub"), "a row's path goes through the link");
  assert.equal(await session.execute(() => document.querySelector(".breadcrumb .crumb.last")?.textContent ?? null), "linked");
  if (haveGit) {
    now = await waitFor("the status column", async () => {
      const rs = await rows();
      return rs.find(r => r.name === "note.txt")?.git ? rs : null;
    });
    assert.equal(now.find(r => r.name === "note.txt").git, "?", "untracked, found through the real folder's repository");
  }

  // The watcher: a file made in the real folder shows up.
  writeFileSync(join(real, "arrived.txt"), "arrived\n");
  await listing("the watcher's refresh", names => names.includes("arrived.txt"));

  // A tag, saved under the link's path.
  await contextMenu("note.txt");
  await session.click(await menuItem("Tag"));
  await session.click(await menuItem("Add Tag"));
  const picker = await waitFor("the tag picker", () => session.execute(() => {
    const box = [...document.querySelectorAll("span")].find(s => s.textContent === "# tag picker")?.parentElement?.parentElement;
    const check = box?.querySelector('input[type="checkbox"]');
    return check ? { path: box.children[1].textContent, check, save: [...box.querySelectorAll("button")].find(b => b.textContent === "save") } : null;
  }));
  assert.equal(picker.path, join(link, "note.txt"));
  await session.click(picker.check);
  await session.click(picker.save);
  await waitFor("the tag on the row", async () => (await rows()).find(r => r.name === "note.txt")?.tag !== "—");
  await waitFor("the tag saved", () => tagKeys().length === 1);
  assert.deepEqual(tagKeys(), [join(link, "note.txt")]);

  // A pin, likewise.
  await contextMenu("sub");
  await session.click(await menuItem("Add Bookmark"));
  await waitFor("the pin in the sidebar", () => session.execute(want => {
    const group = document.querySelector('[data-sb-group-title="PINNED"]')?.closest(".sb-group");
    return !!group && [...group.querySelectorAll(".sb-item[title]")].some(e => e.getAttribute("title") === want);
  }, join(link, "sub")));
  await waitFor("the pin saved", () => (saved("pins.json") ?? []).includes(join(link, "sub")));

  // Rename, and Undo: the file and its tag go there and back.
  await session.click(await row("note.txt"));
  await session.chord([Keys.F2]);
  await session.sendKeys(await prompt('rename "note.txt" to:'), `${Keys.CONTROL}a${Keys.CONTROL}renamed.txt${Keys.ENTER}`);
  await listing("the renamed row", names => names.includes("renamed.txt") && !names.includes("note.txt"));
  assert.ok(existsSync(join(real, "renamed.txt")));
  await waitFor("the tag on the new name", () => tagKeys().join() === join(link, "renamed.txt"));
  await session.chord([Keys.CONTROL, "z"]);
  await listing("the rename undone", names => names.includes("note.txt") && !names.includes("renamed.txt"));
  await waitFor("the tag back on the old name", () => tagKeys().join() === join(link, "note.txt"));

  // Cut, open the folder (its path goes through the link too), paste, Undo.
  await session.click(await row("note.txt"));
  await session.chord([Keys.CONTROL, "x"]);
  await session.click(await row("sub"));
  await session.chord([Keys.ENTER]);
  await listing("the folder opened from the linked one", names => names.includes("inner.txt"));
  assert.equal(await where(), join(link, "sub"));
  await session.click(await row("inner.txt"));
  await session.chord([Keys.CONTROL, "v"]);
  await listing("the pasted row", names => names.includes("note.txt"));
  assert.ok(existsSync(join(real, "sub", "note.txt")) && !existsSync(join(real, "note.txt")));
  await waitFor("the tag moved with it", () => tagKeys().join() === join(link, "sub", "note.txt"));
  await session.chord([Keys.CONTROL, "z"]);
  await listing("the move undone", names => !names.includes("note.txt"));
  assert.ok(existsSync(join(real, "note.txt")));
  await waitFor("the tag moved back", () => tagKeys().join() === join(link, "note.txt"));
  await session.chord([Keys.ALT, Keys.ARROW_LEFT]);
  await listing("Back in the linked folder", names => names.includes("sub") && names.includes("note.txt"));
  assert.equal(await where(), link);

  // The trash records the real path. Undo brings the file and its tag
  // back, and Redo, which trashes by the recorded path, takes both again.
  await session.click(await row("note.txt"));
  await session.chord([Keys.DELETE]);
  await listing("the row gone to the trash", names => !names.includes("note.txt"));
  assert.ok(!existsSync(join(real, "note.txt")));
  await waitFor("its tag gone", () => tagKeys().length === 0);
  await session.chord([Keys.CONTROL, "z"]);
  await listing("the row back from the trash", names => names.includes("note.txt"));
  await waitFor("its tag back", () => tagKeys().join() === join(link, "note.txt"));
  await session.chord([Keys.CONTROL, "y"]);
  await listing("the row trashed again by Redo", names => !names.includes("note.txt"));
  await waitFor("its tag gone again", () => tagKeys().length === 0);
  await session.chord([Keys.CONTROL, "z"]);
  await listing("the row back again", names => names.includes("note.txt"));
  await waitFor("its tag back again", () => tagKeys().join() === join(link, "note.txt"));
  assert.ok(existsSync(join(real, "note.txt")));

  // What's saved by path holds the link's.
  const strings = v => (typeof v === "string" ? [v] : v && typeof v === "object" ? Object.values(v).flatMap(strings) : []);
  await waitFor("the session saved in the linked folder", () => strings(saved("session.json")).includes(link));
  assert.ok(!strings(saved("session.json")).some(s => s.startsWith(real)), "no tab is saved under the real folder");
  const recent = saved("recent.json") ?? [];
  assert.ok(recent.includes(link) && recent.includes(join(link, "sub")), `recents: ${JSON.stringify(recent)}`);
  assert.ok(!recent.some(p => p.startsWith(real)), `recents: ${JSON.stringify(recent)}`);

  // The same folder by its real path: a cut from the link's side pasted there
  // is already where it is going. Compared as strings it was a move onto a
  // taken name, whose Replace would have trashed the file itself.
  await session.click(await row("note.txt"));
  await session.chord([Keys.CONTROL, "x"]);
  await session.chord([Keys.CONTROL, "l"]);
  await session.sendKeys(await prompt("path to navigate to:"), `${Keys.CONTROL}a${Keys.CONTROL}${real}${Keys.ENTER}`);
  await waitFor("the real folder's listing", async () => (await rows()).find(r => r.name === "sub")?.path === join(real, "sub"));
  await session.click(await row("arrived.txt"));
  await session.chord([Keys.CONTROL, "v"]);
  await waitFor("the paste to find the item already there", () => session.execute(() => document.body.innerText.includes("already there")));
  assert.equal(await session.execute(() => document.body.innerText.includes("already exists")), false, "no question about a taken name");
  assert.deepEqual(readdirSync(real).filter(n => n.startsWith("note")), ["note.txt"]);
});

test("no uncaught errors", { timeout: 30_000 }, async () => {
  const seen = await session.execute(() => window.__e2e ?? null);
  assert.ok(seen, "the page was replaced after the error listeners went in, so what happened since went unwatched");
  const errors = [...seen.errors];
  // msedgedriver's log has what happened before the listeners went in, and
  // Content Security Policy violations, which no page listener sees in time:
  // one blocked Tauri's IPC on Windows, where it's http://ipc.localhost.
  for (const entry of await readBrowserLog()) {
    if (/Uncaught/.test(entry.message) || entry.source === "security") errors.push(`browser log: ${entry.message}`);
  }
  assert.deepEqual(errors, []);
});
