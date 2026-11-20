// Flow 1: the real app starts, renders, lists a folder typed into Go to
// Path, and shows drives and known folders in the sidebar, with no
// uncaught errors. Linux: `pnpm e2e` (Xvfb and a private bus). Windows: run
// this file directly with `node --test` in an interactive session, with a
// msedgedriver that matches the WebView2 Runtime (e2e/edgedriver.ps1).
// Artifacts go to e2e/artifacts/ whatever the outcome.
import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { basename as posixBasename, join, win32 } from "node:path";
import { after, afterEach, before, test } from "node:test";

import { ARTIFACTS, IS_WINDOWS, SESSION_DEADLINE_MS, appEnv, appPath, capabilities, captureDesktop, makeFixture, makeScratch, startDriver } from "./harness.mjs";
import { Keys, Session, WebDriverError, waitFor } from "./webdriver.mjs";

const basename = IS_WINDOWS ? win32.basename : posixBasename;
const samePath = (a, b) => (IS_WINDOWS ? a.toLowerCase() === b.toLowerCase() : a === b);

let scratch, home, fixture, driver, session;
const notes = [];

/** Collects what goes wrong in the page from session start: uncaught
 *  errors, unhandled rejections and console.error calls. */
function installErrorListeners() {
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
    const log = await session.browserLog();
    if (log) writeFileSync(join(ARTIFACTS, "browser-log.json"), JSON.stringify(log, null, 2) + "\n");
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

test("it starts with no notice, error or dialog", { timeout: 30_000 }, async () => {
  const shown = await session.execute(() => ({
    // A toast for launch arguments it couldn't use (App.tsx, launch.ts):
    // a driver passing its own switches to the app would show here.
    notice: [...document.querySelectorAll("div")].map(d => d.textContent).find(t => t.startsWith("●couldn't open")) ?? null,
    paneError: document.querySelector(".pane-notice.error")?.textContent ?? null,
    dialog: [...document.querySelectorAll("button")].some(b => /^(ok|cancel)$/.test(b.textContent.trim()) && b.offsetParent !== null),
  }));
  assert.deepEqual(shown, { notice: null, paneError: null, dialog: false });
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

test("no uncaught errors", { timeout: 30_000 }, async () => {
  const seen = await session.execute(() => window.__e2e);
  const errors = [...seen.errors];
  const log = await session.browserLog();
  // msedgedriver's log has what happened before the listeners went in.
  for (const entry of log ?? []) {
    if (/Uncaught/.test(entry.message)) errors.push(`browser log: ${entry.message}`);
  }
  assert.deepEqual(errors, []);
});
