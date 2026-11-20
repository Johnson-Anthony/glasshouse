// What the e2e suite runs on: the app binary, tauri-driver and the native
// WebDriver, a scratch environment and fixture, and the artifacts kept from
// each run. See "End-to-end tests" in docs/ARCHITECTURE.md.
//
// Environment overrides:
//   E2E_APP            the app binary (default: the debug build)
//   E2E_TAURI_DRIVER   tauri-driver (default: ~/.cargo/bin, then PATH)
//   E2E_NATIVE_DRIVER  WebKitWebDriver / msedgedriver (default: PATH on
//                      Linux, $EDGEWEBDRIVER\msedgedriver.exe on Windows)
//   E2E_ARTIFACTS      where artifacts go (default: e2e/artifacts)
//   E2E_SESSION_DEADLINE_MS  how long the app may take to start (120 s)
import { execFileSync, spawn } from "node:child_process";
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, realpathSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { homedir, tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const IS_WINDOWS = process.platform === "win32";
export const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
export const ARTIFACTS = resolve(process.env.E2E_ARTIFACTS ?? join(ROOT, "e2e", "artifacts"));
export const SESSION_DEADLINE_MS = Number(process.env.E2E_SESSION_DEADLINE_MS) || 120_000;

const exe = name => (IS_WINDOWS ? `${name}.exe` : name);

export function appPath() {
  const app = resolve(process.env.E2E_APP ?? join(ROOT, "src-tauri", "target", "debug", exe("glasshouse")));
  if (!existsSync(app)) throw new Error(`no app at ${app}: build it with \`pnpm tauri build --debug --no-bundle\` (or set E2E_APP)`);
  return app;
}

function tauriDriverPath() {
  if (process.env.E2E_TAURI_DRIVER) return process.env.E2E_TAURI_DRIVER;
  const cargoBin = join(process.env.CARGO_HOME ?? join(homedir(), ".cargo"), "bin", exe("tauri-driver"));
  return existsSync(cargoBin) ? cargoBin : exe("tauri-driver");
}

function nativeDriverPath() {
  if (process.env.E2E_NATIVE_DRIVER) return process.env.E2E_NATIVE_DRIVER;
  if (IS_WINDOWS && process.env.EDGEWEBDRIVER) return join(process.env.EDGEWEBDRIVER, "msedgedriver.exe");
  return null; // tauri-driver looks on PATH
}

/** The capabilities for New Session. On Windows the browser log is asked
 *  for too: it's the only place an error from before the session shows. */
export function capabilities(app, { browserLog = IS_WINDOWS } = {}) {
  return {
    "tauri:options": { application: app },
    ...(browserLog ? { "ms:loggingPrefs": { browser: "ALL" } } : {}),
  };
}

/** The known folders the Linux scratch home gets, as XDG names them. */
const XDG_USER_DIRS = { DESKTOP: "Desktop", DOCUMENTS: "Documents", DOWNLOAD: "Downloads", PICTURES: "Pictures" };

/** A fresh scratch folder for this run: on Linux it's also the app's home. */
export function makeScratch() {
  return realpathSync.native(mkdtempSync(join(tmpdir(), "glasshouse-e2e-")));
}

/** The environment tauri-driver, the native driver and the app run in, and
 *  the command to start tauri-driver through (`wrap`).
 *
 *  Linux: only what a session needs to reach this run's own display, plus
 *  a scratch HOME and XDG dirs, so a local run never reads or writes the
 *  user's settings, and never opens on their Wayland desktop. tauri-driver
 *  runs under its own session bus (sessionBus), started in that same env.
 *  Windows has no such redirect (known folders come from the profile), so
 *  it runs as the runner's user. */
export function appEnv(scratch) {
  if (IS_WINDOWS) return { env: { ...process.env }, home: homedir(), wrap: [] };
  if (!process.env.DISPLAY) throw new Error("no DISPLAY: run the suite through `pnpm e2e` (xvfb-run)");
  const keep = ["PATH", "LANG", "LANGUAGE", "TZ", "USER", "LOGNAME", "SHELL", "DISPLAY", "XAUTHORITY", "RUST_BACKTRACE", "RUST_LOG"];
  const env = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (keep.includes(k) || k.startsWith("LC_") || k.startsWith("WEBKIT_")) env[k] = v;
  }
  const home = join(scratch, "home");
  const runtime = join(scratch, "runtime");
  Object.assign(env, {
    HOME: home,
    XDG_CONFIG_HOME: join(home, ".config"),
    XDG_DATA_HOME: join(home, ".local", "share"),
    XDG_STATE_HOME: join(home, ".local", "state"),
    XDG_CACHE_HOME: join(home, ".cache"),
    XDG_RUNTIME_DIR: runtime,
    GDK_BACKEND: "x11",
    // No accessibility bus to start, and nothing left running from one.
    NO_AT_BRIDGE: "1",
    // WebKitGTK's DMA-BUF renderer can draw blank with no GPU (Xvfb).
    WEBKIT_DISABLE_DMABUF_RENDERER: env.WEBKIT_DISABLE_DMABUF_RENDERER ?? "1",
    LIBGL_ALWAYS_SOFTWARE: "1",
  });
  for (const k of ["XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME", "XDG_CACHE_HOME"]) mkdirSync(env[k], { recursive: true });
  mkdirSync(runtime, { mode: 0o700 });
  const dirs = Object.entries(XDG_USER_DIRS).map(([key, name]) => {
    mkdirSync(join(home, name));
    return `XDG_${key}_DIR="$HOME/${name}"`;
  });
  writeFileSync(join(env.XDG_CONFIG_HOME, "user-dirs.dirs"), dirs.join("\n") + "\n");
  return { env, home, wrap: sessionBus(scratch, env) };
}

/** A private session bus for the run: `dbus-run-session` with a config of
 *  our own. The standard config would let anything the app or WebKitGTK
 *  asks for start on demand (xdg-desktop-portal, gvfs, the a11y bus, a
 *  keyring), and those would see the user's real runtime folder; one such
 *  start held the app's first window for 25 s here. This bus starts only
 *  services in the scratch home's dbus-1/services, which is empty unless a
 *  test puts one there. */
function sessionBus(scratch, env) {
  const xml = s => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const services = join(env.XDG_DATA_HOME, "dbus-1", "services");
  mkdirSync(services, { recursive: true });
  const config = join(scratch, "session-bus.conf");
  writeFileSync(config, `<!DOCTYPE busconfig PUBLIC "-//freedesktop//DTD D-Bus Bus Configuration 1.0//EN"
 "http://www.freedesktop.org/standards/dbus/1.0/busconfig.dtd">
<busconfig>
  <type>session</type>
  <listen>unix:dir=${xml(env.XDG_RUNTIME_DIR)}</listen>
  <auth>EXTERNAL</auth>
  <servicedir>${xml(services)}</servicedir>
  <policy context="default">
    <allow send_destination="*" eavesdrop="true"/>
    <allow eavesdrop="true"/>
    <allow own="*"/>
  </policy>
</busconfig>
`);
  return ["dbus-run-session", `--config-file=${config}`, "--"];
}

/** The fixture folder Go to Path opens. A space in its name, and entries of
 *  each kind, one with a non-ASCII name. Nothing hidden: what's hidden
 *  differs between the platforms, and isn't this flow's question. */
export function makeFixture(scratch) {
  const dir = join(scratch, "e2e fixture");
  mkdirSync(dir);
  mkdirSync(join(dir, "alpha"));
  writeFileSync(join(dir, "beta.txt"), "beta\n");
  writeFileSync(join(dir, "Gamma notes.md"), "# gamma\n");
  writeFileSync(join(dir, "naïve café.json"), "{}\n");
  return { path: dir, names: ["alpha", "beta.txt", "Gamma notes.md", "naïve café.json"] };
}

function freePort() {
  return new Promise((ok, fail) => {
    const srv = createServer();
    srv.unref();
    srv.on("error", fail);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => ok(port));
    });
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Whether `bin` is a file, or a name found on the env's PATH. */
function found(bin, env) {
  if (bin.includes("/") || bin.includes("\\")) return existsSync(bin);
  return (env.PATH ?? env.Path ?? "").split(delimiter).some(dir => dir && existsSync(join(dir, bin)));
}

/** Starts tauri-driver (through `wrap`, if any) on free ports, its output
 *  and the native driver's (and so the app's stderr) going to `logFile`,
 *  and waits until it answers /status. On Linux it leads its own process
 *  group, which `stop` ends, so the bus, the native driver and the app go
 *  with it whatever state they're in. */
export async function startDriver({ env, wrap = [], logFile }) {
  const port = await freePort();
  const nativePort = await freePort();
  const args = ["--port", String(port), "--native-port", String(nativePort)];
  const native = nativeDriverPath();
  if (native) args.push("--native-driver", native);
  const bin = tauriDriverPath();
  for (const need of [bin, ...wrap.slice(0, 1)]) {
    if (!found(need, env)) throw new Error(`${need} not found${need === bin ? " (install it with `cargo install tauri-driver --version 2.1.0 --locked`)" : ""}`);
  }
  const log = openSync(logFile, "w");
  const command = [...wrap, bin, ...args];
  const proc = spawn(command[0], command.slice(1), { env, stdio: ["ignore", log, log], detached: !IS_WINDOWS });
  closeSync(log);
  let exited = null;
  let spawnError = null;
  proc.on("exit", (code, signal) => { exited = signal ?? code; });
  proc.on("error", e => { spawnError = e; });

  const killTree = sig => {
    try {
      if (IS_WINDOWS) execFileSync("taskkill", ["/PID", String(proc.pid), "/T", "/F"], { stdio: "ignore" });
      else process.kill(-proc.pid, sig);
    } catch { /* already gone */ }
  };
  // However node ends, leave nothing running.
  const onExit = () => killTree("SIGKILL");
  process.on("exit", onExit);

  const stop = async () => {
    killTree("SIGTERM");
    for (let i = 0; i < 50 && exited === null; i++) await sleep(100);
    if (!IS_WINDOWS) {
      // The group outlives tauri-driver if the app or the native driver
      // ignored SIGTERM.
      await sleep(300);
      killTree("SIGKILL");
    }
    process.off("exit", onExit);
  };

  const base = `http://127.0.0.1:${port}`;
  const end = Date.now() + 30_000;
  let failure = null;
  while (!failure) {
    await sleep(200);
    if (spawnError) failure = `couldn't start ${command[0]}: ${spawnError.message}`;
    else if (exited !== null) failure = `tauri-driver exited (${exited}) before answering; see ${logFile}`;
    else {
      try {
        const res = await fetch(`${base}/status`, { signal: AbortSignal.timeout(2_000) });
        if (res.ok) break;
      } catch { /* not listening yet */ }
      if (Date.now() > end) failure = `tauri-driver didn't answer /status in 30 s; see ${logFile}`;
    }
  }
  if (failure) {
    await stop();
    throw new Error(failure);
  }
  return { base, bin, native, stop };
}

/** A screenshot of the whole screen, taken while the app is open: on Xvfb
 *  with ImageMagick, on Windows with CopyFromScreen (windows-desktop.ps1,
 *  which also writes who's logged on, the screens and the app's window).
 *  Returns what it couldn't do, or null. */
export function captureDesktop(dir) {
  try {
    if (IS_WINDOWS) {
      execFileSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(ROOT, "e2e", "windows-desktop.ps1"), "-OutDir", dir], { stdio: "inherit", timeout: 60_000 });
    } else {
      execFileSync("import", ["-display", process.env.DISPLAY, "-window", "root", join(dir, "desktop.png")], { stdio: "inherit", timeout: 30_000 });
    }
    return null;
  } catch (e) {
    return `desktop screenshot failed: ${e.message}`;
  }
}
