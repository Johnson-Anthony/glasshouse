// Records the project site's images from the built demo (docs/demo): serves
// docs/ the way GitHub Pages does (under /glasshouse/), drives headless
// Chromium over the DevTools protocol, runs demo scenes and saves stills to
// docs/media/. Needs chromium and ffmpeg on PATH; run `pnpm site:build` first.
//
//   pnpm site:capture            all stills
//   pnpm site:capture hero       only the jobs whose name starts with "hero"
//   pnpm site:capture page <dir> screenshots of the landing page itself, for
//                                review (desktop and phone), saved to <dir>
import { spawn, execFileSync } from "node:child_process";
import { createReadStream, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const DOCS = join(ROOT, "docs");
const MEDIA = join(DOCS, "media");
const W = 1280;
const H = 800;
const THEMES = ["tokyo-night", "catppuccin-mocha", "gruvbox-dark", "rose-pine", "everforest", "solarized-dark", "green-crt", "synthwave"];

// ---- jobs ----
/** @type {Array<{ name: string, theme: string, scene: string, out: string, og?: boolean }>} */
const JOBS = THEMES.map(theme => ({ name: `hero-${theme}`, theme, scene: "hero", out: `hero-${theme}`, og: theme === "tokyo-night" }));

/** Landing-page review shots; not part of the site. */
const PAGE_JOBS = [
  { name: "page-desktop", width: 1440, height: 900, mobile: false, theme: "tokyo-night", full: true },
  { name: "page-desktop-synthwave-demo", width: 1440, height: 900, mobile: false, theme: "synthwave", startDemo: true },
  { name: "page-phone", width: 390, height: 844, mobile: true, theme: "tokyo-night", full: true },
];

// ---- static server for docs/ at /glasshouse/ ----
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json",
  ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".txt": "text/plain" };

function serve() {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    let rel = decodeURIComponent(url.pathname);
    if (!rel.startsWith("/glasshouse/")) { res.writeHead(404).end(); return; }
    rel = rel.slice("/glasshouse/".length);
    let file = normalize(join(DOCS, rel));
    if (!file.startsWith(DOCS)) { res.writeHead(403).end(); return; }
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html");
    if (!existsSync(file)) { res.writeHead(404).end(); return; }
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
    createReadStream(file).pipe(res);
  });
  return new Promise(r => server.listen(0, "127.0.0.1", () => r(server)));
}

// ---- minimal DevTools protocol client ----
async function launchChromium() {
  const profile = mkdtempSync(join(tmpdir(), "glasshouse-capture-"));
  const proc = spawn("chromium", [
    "--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`,
    "--no-first-run", "--no-default-browser-check", "--hide-scrollbars", "--mute-audio",
    "--disable-gpu", "--font-render-hinting=none", "about:blank",
  ], { stdio: ["ignore", "ignore", "pipe"] });
  const portFile = join(profile, "DevToolsActivePort");
  for (let i = 0; i < 200 && !existsSync(portFile); i++) await sleep(50);
  const [port] = readFileSync(portFile, "utf8").split("\n");
  const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = pages.find(p => p.type === "page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0;
  const pending = new Map();
  const listeners = new Map();
  ws.onmessage = ev => {
    const msg = JSON.parse(String(ev.data));
    if (msg.id && pending.has(msg.id)) {
      const { resolve: ok, reject: fail } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) fail(new Error(`${msg.error.message} ${msg.error.data ?? ""}`));
      else ok(msg.result);
    } else if (msg.method) {
      for (const fn of listeners.get(msg.method) ?? []) fn(msg.params);
    }
  };
  const send = (method, params = {}) => new Promise((ok, fail) => {
    const n = ++id;
    pending.set(n, { resolve: ok, reject: fail });
    ws.send(JSON.stringify({ id: n, method, params }));
  });
  const once = method => new Promise(r => {
    const fn = p => { listeners.get(method).delete(fn); r(p); };
    if (!listeners.has(method)) listeners.set(method, new Set());
    listeners.get(method).add(fn);
  });
  const close = () => { ws.close(); proc.kill(); setTimeout(() => rmSync(profile, { recursive: true, force: true }), 500); };
  return { send, once, close };
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function evaluate(cdp, expression) {
  const r = await cdp.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
}

async function load(cdp, url) {
  const loaded = cdp.once("Page.loadEventFired");
  await cdp.send("Page.navigate", { url });
  await loaded;
  // The app is ready once the first folder listing has rendered.
  for (let i = 0; i < 100; i++) {
    if (await evaluate(cdp, `!!document.querySelector(".row") && !!window.glasshouseDemo`)) return;
    await sleep(100);
  }
  throw new Error(`demo did not render: ${url}`);
}

function toWebp(png, out, quality = 82) {
  execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", png, "-c:v", "libwebp", "-quality", String(quality), "-compression_level", "6", out]);
}

async function shootPages(cdp, base, outDir) {
  mkdirSync(outDir, { recursive: true });
  for (const job of PAGE_JOBS) {
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: job.width, height: job.height, deviceScaleFactor: job.mobile ? 2 : 1, mobile: job.mobile });
    const loaded = cdp.once("Page.loadEventFired");
    await cdp.send("Page.navigate", { url: `${base}?review=${job.name}` });
    await loaded;
    await evaluate(cdp, `(() => { localStorage.setItem("glasshouse-site.theme", ${JSON.stringify(job.theme)}); document.querySelector('[data-choice=${JSON.stringify(job.theme)}]').click(); return document.fonts.ready.then(() => true); })()`);
    if (job.startDemo) {
      await evaluate(cdp, `(() => { const f = document.querySelector(".demo-frame"); f.scrollIntoView({ block: "center" }); document.getElementById("demo-start").click(); return true; })()`);
      for (let i = 0; i < 100 && !(await evaluate(cdp, `document.querySelector(".demo-frame")?.dataset.state === "running" && !!document.querySelector(".demo-frame iframe").contentDocument.querySelector(".row")`)); i++) await sleep(100);
      await evaluate(cdp, `document.querySelector(".demo-frame iframe").contentWindow.glasshouseDemo.runScene("hero", { speed: 0.5, cursor: false })`);
      await evaluate(cdp, `window.scrollBy(0, -120), true`);
    }
    await sleep(800);
    let params = { format: "png" };
    if (job.full) {
      const h = await evaluate(cdp, `document.documentElement.scrollHeight`);
      params = { ...params, captureBeyondViewport: true, clip: { x: 0, y: 0, width: job.width, height: h, scale: 1 } };
    }
    const shot = await cdp.send("Page.captureScreenshot", params);
    writeFileSync(join(outDir, `${job.name}.png`), Buffer.from(shot.data, "base64"));
    console.log(`${job.name}: ${join(outDir, `${job.name}.png`)}`);
  }
}

async function main() {
  const only = process.argv[2];
  if (only === "page") {
    const server = await serve();
    const cdp = await launchChromium();
    try {
      await cdp.send("Page.enable");
      await cdp.send("Runtime.enable");
      await shootPages(cdp, `http://127.0.0.1:${server.address().port}/glasshouse/`, resolve(process.argv[3] ?? "site-review"));
    } finally {
      cdp.close();
      server.close();
    }
    return;
  }
  const jobs = JOBS.filter(j => !only || j.name.startsWith(only));
  if (!existsSync(join(DOCS, "demo", "index.html"))) throw new Error("docs/demo is missing: run `pnpm site:build` first");
  mkdirSync(MEDIA, { recursive: true });
  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}/glasshouse/`;
  const cdp = await launchChromium();
  try {
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 2, mobile: false });
    const tmp = mkdtempSync(join(tmpdir(), "glasshouse-shots-"));
    for (const job of jobs) {
      await load(cdp, `${base}demo/?theme=${job.theme}`);
      await evaluate(cdp, `document.fonts.ready.then(() => true)`);
      const ok = await evaluate(cdp, `window.glasshouseDemo.runScene(${JSON.stringify(job.scene)}, { speed: 0.5, cursor: false })`);
      if (!ok) throw new Error(`scene ${job.scene} did not finish`);
      await sleep(700);
      const shot = await cdp.send("Page.captureScreenshot", { format: "png" });
      const png = join(tmp, `${job.out}.png`);
      writeFileSync(png, Buffer.from(shot.data, "base64"));
      toWebp(png, join(MEDIA, `${job.out}.webp`));
      if (job.og) {
        // Link previews (og:image) want a PNG around 1200 px wide.
        execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", png, "-vf", "scale=1200:-2", join(MEDIA, `${job.out}.png`)]);
      }
      console.log(`${job.name}: ${statSync(join(MEDIA, `${job.out}.webp`)).size} bytes`);
    }
    rmSync(tmp, { recursive: true, force: true });
  } finally {
    cdp.close();
    server.close();
  }
}

main().catch(e => { console.error(e); process.exitCode = 1; });
