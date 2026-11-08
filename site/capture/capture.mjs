// Records the project site's images from the built demo (docs/demo): serves
// docs/ the way GitHub Pages does (under /glasshouse/), drives headless
// Chromium over the DevTools protocol, runs demo scenes and saves stills to
// docs/media/. Needs chromium and ffmpeg on PATH; run `pnpm site:build` first.
//
//   pnpm site:capture            all stills
//   pnpm site:capture hero       only the jobs whose name starts with "hero"
//   pnpm site:capture clip-git   one tour clip
//   pnpm site:capture page <dir> screenshots of the landing page itself, for
//                                review (desktop and phone), saved to <dir>
//   pnpm site:capture check      behavior checks of the landing page
import { spawn, execFileSync } from "node:child_process";
import { createReadStream, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
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

/** Tour clips: one scene each, recorded in the default theme. */
const CLIPS = ["terminal", "tabs", "git", "quicklook", "paste", "palette"]
  .map(scene => ({ name: `clip-${scene}`, scene, out: `tour-${scene}` }));
const CLIP_W = 1600; // encoded width; captured at 2x and scaled down
const FPS = 30;

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
  const on = (method, fn) => {
    if (!listeners.has(method)) listeners.set(method, new Set());
    listeners.get(method).add(fn);
    return () => listeners.get(method).delete(fn);
  };
  const close = () => { ws.close(); proc.kill(); setTimeout(() => rmSync(profile, { recursive: true, force: true }), 500); };
  return { send, once, on, close };
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

/** Record one scene with the DevTools screencast and encode it with ffmpeg:
 *  WebM (VP9) and MP4 (H.264, for Safari) plus a WebP poster. */
async function recordClip(cdp, base, job, tmp) {
  await load(cdp, `${base}demo/?theme=tokyo-night`);
  await evaluate(cdp, `document.fonts.ready.then(() => true)`);
  const dir = mkdtempSync(join(tmp, `${job.out}-`));
  const frames = [];
  const off = cdp.on("Page.screencastFrame", p => {
    const file = join(dir, `f${String(frames.length).padStart(5, "0")}.jpg`);
    writeFileSync(file, Buffer.from(p.data, "base64"));
    frames.push({ file, t: p.metadata.timestamp ?? Date.now() / 1000 });
    void cdp.send("Page.screencastFrameAck", { sessionId: p.sessionId });
  });
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: W * 2, maxHeight: H * 2, everyNthFrame: 1 });
  await sleep(700);
  const ok = await evaluate(cdp, `window.glasshouseDemo.runScene(${JSON.stringify(job.scene)}, { speed: 1 })`);
  if (!ok) throw new Error(`scene ${job.scene} did not finish`);
  await sleep(1600);
  const end = Date.now() / 1000;
  await cdp.send("Page.stopScreencast");
  off();
  if (frames.length < 2) throw new Error(`${job.name}: no frames recorded`);
  // Frames arrive only when the page changes: each lasts until the next one.
  const lines = ["ffconcat version 1.0"];
  frames.forEach((f, i) => {
    const next = i + 1 < frames.length ? frames[i + 1].t : Math.max(end, f.t + 1);
    lines.push(`file '${f.file}'`, `duration ${Math.max(0.001, next - f.t).toFixed(4)}`);
  });
  lines.push(`file '${frames[frames.length - 1].file}'`);
  const list = join(dir, "list.txt");
  writeFileSync(list, lines.join("\n") + "\n");
  const vf = `fps=${FPS},scale=${CLIP_W}:-2:flags=lanczos,format=yuv420p`;
  const ff = args => execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", list, ...args]);
  const webm = join(MEDIA, `${job.out}.webm`);
  const mp4 = join(MEDIA, `${job.out}.mp4`);
  ff(["-vf", vf, "-c:v", "libvpx-vp9", "-crf", "38", "-b:v", "0", "-row-mt", "1", "-deadline", "good", "-cpu-used", "2", "-an", webm]);
  ff(["-vf", vf, "-c:v", "libx264", "-crf", "26", "-preset", "slow", "-tune", "animation", "-movflags", "+faststart", "-an", mp4]);
  // Poster: the clip's last frame, which shows the scene's result.
  toWebp(frames[frames.length - 1].file, join(MEDIA, `${job.out}.webp`), 80);
  rmSync(dir, { recursive: true, force: true });
  const kb = f => Math.round(statSync(f).size / 1024);
  console.log(`${job.name}: ${frames.length} frames, ${(end - frames[0].t).toFixed(1)} s, webm ${kb(webm)} KB, mp4 ${kb(mp4)} KB`);
}

/** Behavior checks of the landing page in a real (headless) browser. */
async function checkPage(cdp, base) {
  const results = [];
  const errors = [];
  const ok = (name, pass, detail = "") => { results.push({ name, pass, detail }); };
  cdp.on("Runtime.exceptionThrown", p => errors.push(p.exceptionDetails?.exception?.description ?? p.exceptionDetails?.text));
  cdp.on("Runtime.consoleAPICalled", p => { if (p.type === "error") errors.push(p.args.map(a => a.value ?? a.description).join(" ")); });
  cdp.on("Log.entryAdded", p => { if (p.entry.level === "error") errors.push(`${p.entry.text} ${p.entry.url ?? ""}`); });
  await cdp.send("Log.enable");
  const open = async (opts) => {
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: opts.width, height: opts.height, deviceScaleFactor: 1, mobile: !!opts.mobile });
    await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: opts.reduce ? "reduce" : "no-preference" }] });
    const loaded = cdp.once("Page.loadEventFired");
    await cdp.send("Page.navigate", { url: `${base}?check=${Date.now()}` });
    await loaded;
    await evaluate(cdp, `localStorage.clear(), true`);
  };
  const js = expr => evaluate(cdp, expr);
  const video = `document.querySelector("#tour-stage video")`;

  // Desktop: tour plays when on screen, tabs switch clips.
  await open({ width: 1440, height: 900 });
  await js(`document.getElementById("tour-stage").scrollIntoView({ block: "center" }), true`);
  await sleep(3000);
  const t1 = await js(`${video}.currentTime`);
  ok("tour clip plays when on screen", t1 > 0.5 && !(await js(`${video}.paused`)), `t=${t1.toFixed(1)}`);
  await js(`document.querySelector('.tour-tab[data-scene="git"]').click(), true`);
  await sleep(2000);
  const src = await js(`${video}.currentSrc`);
  ok("tour tab switches the clip", src.includes("tour-git") && (await js(`${video}.currentTime`)) > 0.3, src);
  await js(`document.getElementById("tour-pause").click(), true`);
  await sleep(300);
  ok("tour pause button pauses", await js(`${video}.paused && document.getElementById("tour-pause").textContent === "Play"`));
  await js(`window.scrollTo(0, 0), true`);
  await sleep(500);

  // Theme picker.
  await js(`document.querySelector('[data-choice="everforest"]').click(), true`);
  ok("theme chip recolors page and hero",
    await js(`document.documentElement.dataset.theme === "everforest" && document.getElementById("hero-shot").getAttribute("src") === "media/hero-everforest.webp" && localStorage.getItem("glasshouse-site.theme") === "everforest"`));

  // "Run it in the live demo" starts the demo and runs the scene.
  await js(`document.querySelector('.tour-tab[data-scene="terminal"]').click(), document.getElementById("tour-run").click(), true`);
  let running = false;
  for (let i = 0; i < 80 && !running; i++) {
    await sleep(100);
    running = await js(`document.querySelector(".demo-frame").dataset.state === "running" && !!document.querySelector(".demo-frame iframe").contentDocument.querySelector(".row")`);
  }
  ok("live demo starts on demand", running);
  ok("live demo gets the page's theme", await js(`document.querySelector(".demo-frame iframe").contentDocument.documentElement.dataset.theme === "everforest"`));
  for (let i = 0; i < 150; i++) {
    await sleep(100);
    if (await js(`(document.querySelector(".demo-frame iframe").contentDocument.querySelector(".xterm-rows")?.textContent ?? "").includes("git log")`)) break;
  }
  const walk = await js(`(() => { const d = document.querySelector(".demo-frame iframe").contentDocument; return { xterm: !!d.querySelector(".xterm"), text: (d.querySelector(".xterm-rows")?.textContent ?? "").slice(0, 300), tab: d.querySelector(".tab.active")?.textContent ?? "" }; })()`);
  ok("walkthrough runs in the live demo", walk.xterm && walk.text.includes("git log"), JSON.stringify(walk));
  // Esc twice inside the demo hands keyboard focus back to the page.
  await js(`document.querySelector(".demo-frame iframe").focus(), document.querySelector(".demo-frame iframe").contentDocument.querySelector(".pane")?.focus(), true`);
  for (let i = 0; i < 2; i++) {
    await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await sleep(120);
  }
  await sleep(300);
  ok("Esc twice leaves the demo", await js(`document.activeElement && document.activeElement.id === "demo-fullscreen"`));
  await js(`document.querySelector('[data-choice="green-crt"]').click(), true`);
  await sleep(300);
  ok("theme chip recolors the running demo", await js(`document.querySelector(".demo-frame iframe").contentDocument.documentElement.dataset.theme === "green-crt"`));

  // Reduced motion: nothing plays by itself.
  await open({ width: 1440, height: 900, reduce: true });
  await js(`document.getElementById("tour-stage").scrollIntoView({ block: "center" }), true`);
  await sleep(2000);
  ok("reduced motion: tour doesn't autoplay", await js(`${video}.paused && ${video}.currentTime === 0 && document.getElementById("tour-pause").textContent === "Play"`));
  ok("reduced motion: no transitions", await js(`getComputedStyle(document.body).transitionDuration.split(",").every(d => parseFloat(d) === 0)`));

  // Phones: no sideways scrolling, demo replaced by a link.
  for (const width of [320, 375, 414]) {
    await open({ width, height: 800, mobile: true });
    const over = await js(`document.documentElement.scrollWidth - document.documentElement.clientWidth`);
    ok(`phone ${width}px: no horizontal scroll`, over <= 0, `overflow=${over}`);
  }
  ok("phone: live demo frame hidden, link shown", await js(`getComputedStyle(document.querySelector(".demo-frame")).display === "none" && getComputedStyle(document.querySelector(".demo-small")).display !== "none"`));

  ok("no console errors", errors.length === 0, errors.slice(0, 5).join(" | "));

  // Jekyll (GitHub Pages) skips names starting with these, outside _config.yml.
  const skipped = [];
  const scan = dir => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (full === join(DOCS, "_config.yml")) continue;
      if (/^[_.#~]/.test(name)) skipped.push(full.slice(DOCS.length + 1));
      if (statSync(full).isDirectory()) scan(full);
    }
  };
  for (const d of ["index.html", "favicon.png", "assets", "media", "demo"]) {
    const full = join(DOCS, d);
    if (statSync(full).isDirectory()) scan(full);
  }
  ok("no site file names Jekyll would skip", skipped.length === 0, skipped.join(", "));

  // Page weight: what a first visit downloads before the visitor does anything.
  const size = f => statSync(join(DOCS, f)).size;
  const first = ["index.html", "assets/site.css", "assets/site.js", "assets/themes.css", "media/hero-tokyo-night.webp", "favicon.png"];
  const kb = Math.round(first.reduce((n, f) => n + size(f), 0) / 1024);
  ok("first view under 200 KB", kb < 200, `${kb} KB uncompressed`);
  for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.detail ? `  (${r.detail})` : ""}`);
  if (results.some(r => !r.pass)) process.exitCode = 1;
}

async function main() {
  const only = process.argv[2];
  if (only === "check") {
    const server = await serve();
    const cdp = await launchChromium();
    try {
      await cdp.send("Page.enable");
      await cdp.send("Runtime.enable");
      await checkPage(cdp, `http://127.0.0.1:${server.address().port}/glasshouse/`);
    } finally {
      cdp.close();
      server.close();
    }
    return;
  }
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
    for (const job of CLIPS.filter(j => !only || j.name.startsWith(only))) {
      await recordClip(cdp, base, job, tmp);
    }
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
