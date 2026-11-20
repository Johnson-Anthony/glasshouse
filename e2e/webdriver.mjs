// A minimal W3C WebDriver client (https://www.w3.org/TR/webdriver2/): only
// the commands the e2e suite uses, over fetch, with a deadline on every
// request so a stuck driver fails the run instead of holding CI. It talks to
// tauri-driver, which passes each command on to WebKitWebDriver (Linux) or
// msedgedriver (Windows).

/** The key a driver uses for an element reference (W3C §12.1). */
export const ELEMENT = "element-6066-11e4-a52e-4f735466cecf";

/** Key codes from the spec's table (W3C §17.4.2). */
export const Keys = {
  NULL: "",
  BACKSPACE: "",
  ENTER: "",
  SHIFT: "",
  CONTROL: "",
  ALT: "",
  ESCAPE: "",
};

/** An error answer from the driver: `error` is the spec's code
 *  ("no such element", "invalid argument", …). */
export class WebDriverError extends Error {
  constructor(what, status, value) {
    super(`${what}: ${value?.error ?? `HTTP ${status}`}${value?.message ? `: ${value.message}` : ""}`);
    this.name = "WebDriverError";
    this.status = status;
    this.error = value?.error ?? null;
  }
}

/** One request; resolves to the answer's `value`. A request that gets no
 *  answer within `timeoutMs` throws, saying which one it was. */
export async function request(base, method, path, body, timeoutMs) {
  const what = `${method} ${path}`;
  let res;
  try {
    res = await fetch(base + path, {
      method,
      headers: body === undefined ? {} : { "content-type": "application/json; charset=utf-8" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    if (e?.name === "TimeoutError") throw new Error(`${what}: no answer in ${timeoutMs / 1000} s`);
    throw new Error(`${what}: ${e?.cause?.message ?? e?.message ?? e}`);
  }
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* not JSON: reported below */ }
  if (!res.ok || json?.value?.error) {
    throw new WebDriverError(what, res.status, json?.value ?? { message: text.slice(0, 500) });
  }
  return json?.value ?? null;
}

/** A script for Execute Script: a function's source, called with the args. */
function scriptOf(fn) {
  return typeof fn === "function" ? `return (${fn.toString()}).apply(null, arguments);` : fn;
}

export class Session {
  /** @param {string} base e.g. "http://127.0.0.1:4444" */
  constructor(base, id, capabilities, timeoutMs) {
    this.base = base;
    this.id = id;
    this.capabilities = capabilities;
    this.timeoutMs = timeoutMs;
  }

  /** New Session. `deadlineMs` bounds the whole start, app launch included. */
  static async create(base, alwaysMatch, { deadlineMs, commandTimeoutMs = 30_000 }) {
    const value = await request(base, "POST", "/session", { capabilities: { alwaysMatch } }, deadlineMs);
    return new Session(base, value.sessionId, value.capabilities ?? {}, commandTimeoutMs);
  }

  cmd(method, path, body, timeoutMs = this.timeoutMs) {
    return request(this.base, method, `/session/${this.id}${path}`, body, timeoutMs);
  }

  /** Execute Script. `fn` runs in the page; a DOM element it returns comes
   *  back as an element reference, usable with click and sendKeys. */
  execute(fn, ...args) {
    return this.cmd("POST", "/execute/sync", { script: scriptOf(fn), args });
  }

  /** The first element matching a CSS selector, or null. */
  async find(css) {
    try {
      return await this.cmd("POST", "/element", { using: "css selector", value: css });
    } catch (e) {
      if (e instanceof WebDriverError && e.error === "no such element") return null;
      throw e;
    }
  }

  click(el) {
    return this.cmd("POST", `/element/${el[ELEMENT]}/click`, {});
  }

  /** Element Send Keys: focuses the element and types `text`. Modifier keys
   *  in it toggle (Keys.CONTROL + "a" + Keys.CONTROL is Ctrl+A). */
  sendKeys(el, text) {
    return this.cmd("POST", `/element/${el[ELEMENT]}/value`, { text });
  }

  /** A key chord through Perform Actions, sent to whatever has focus:
   *  `chord([Keys.CONTROL, "l"])` presses each in order, then releases them
   *  in reverse. */
  async chord(keys) {
    const actions = [
      ...keys.map(value => ({ type: "keyDown", value })),
      ...[...keys].reverse().map(value => ({ type: "keyUp", value })),
    ];
    await this.cmd("POST", "/actions", { actions: [{ type: "key", id: "keyboard", actions }] });
    await this.cmd("DELETE", "/actions");
  }

  /** The webview's viewport as PNG bytes. */
  async screenshot() {
    return Buffer.from(await this.cmd("GET", "/screenshot"), "base64");
  }

  /** The browser's console log, where the driver keeps one (msedgedriver
   *  with `ms:loggingPrefs`; not WebKitWebDriver). null when it doesn't. */
  async browserLog() {
    for (const path of ["/se/log", "/log"]) {
      try {
        return await this.cmd("POST", path, { type: "browser" });
      } catch { /* try the next, then give up */ }
    }
    return null;
  }

  /** Delete Session: the driver closes the app. */
  delete() {
    return request(this.base, "DELETE", `/session/${this.id}`, undefined, this.timeoutMs);
  }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Polls `fn` until it returns something truthy and returns that. Errors
 *  while polling (a page still loading) count as "not yet". On timeout it
 *  throws with `what`, plus the last error, if there was one. */
export async function waitFor(what, fn, { timeoutMs = 15_000, intervalMs = 200 } = {}) {
  const end = Date.now() + timeoutMs;
  let lastError = null;
  for (;;) {
    try {
      const v = await fn();
      if (v) return v;
      lastError = null;
    } catch (e) {
      lastError = e;
    }
    if (Date.now() >= end) {
      throw new Error(`timed out after ${timeoutMs / 1000} s waiting for ${what}${lastError ? ` (last error: ${lastError.message})` : ""}`);
    }
    await sleep(intervalMs);
  }
}
