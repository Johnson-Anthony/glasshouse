// What a path typed into Go to Path…, Open… or the palette's "Go to" row
// means: a link to hand to the browser, or a path with `~`, a relative path
// and `.`/`..` worked out. Pure, so both platforms' rules are tested here;
// `openTyped` (handlers/helpers.ts) acts on the result.
import { IS_WINDOWS } from "./platform";
import { pathOps } from "./paths";

export type Typed =
  | { kind: "url"; url: string }
  | { kind: "path"; path: string }
  | { kind: "error"; message: string };

/** The links the backend's `open_url` (launch.rs) opens. */
const LINK = /^(?:https?:\/\/|mailto:)/i;
const SCHEME = /^([A-Za-z][A-Za-z0-9+.-]+):\/\//;

/** A local path for a `file://` URL, or null for one that names another
 *  machine (a UNC path on Windows) or doesn't parse. */
function fileUrlPath(text: string, win: boolean): string | null {
  let path: string;
  let host: string;
  try {
    const u = new URL(text);
    path = decodeURIComponent(u.pathname);
    host = u.hostname === "localhost" ? "" : u.hostname;
  } catch {
    return null;
  }
  if (!win) return host ? null : path;
  if (host) return `\\\\${host}${path}`;
  // file:///C:/Users → "/C:/Users"
  return /^\/[A-Za-z]:/.test(path) ? path.slice(1) : path;
}

/** `input` as typed, read against the current folder `cwd` and the home
 *  folder. One pair of quotes around it is dropped (Windows' "Copy as path"
 *  adds them). */
export function parseTyped(input: string, cwd: string, home: string | null, win: boolean = IS_WINDOWS): Typed {
  const ops = pathOps(win);
  let t = input.trim();
  const quoted = /^(["'])(.*)\1$/s.exec(t);
  if (quoted) t = quoted[2].trim();
  if (!t) return { kind: "error", message: "path required" };
  if (LINK.test(t)) return { kind: "url", url: t };

  const scheme = SCHEME.exec(t);
  if (scheme) {
    if (scheme[1].toLowerCase() !== "file") {
      return { kind: "error", message: `can't open ${scheme[1]}:// links: only http, https and mailto` };
    }
    const local = fileUrlPath(t, win);
    if (local === null) return { kind: "error", message: `not a file on this computer: ${t}` };
    t = local;
  } else if (t === "~" || t.startsWith("~/") || (win && t.startsWith("~\\"))) {
    if (!home) return { kind: "error", message: "home folder unavailable" };
    t = home + t.slice(1);
  }

  // A drive path counts as absolute on Linux too, as `looksLikePath` has it.
  const absolute = t.startsWith("/") || /^[A-Za-z]:(?:[\\/]|$)/.test(t) || (win && t.startsWith("\\"));
  if (!absolute) {
    if (!cwd) return { kind: "error", message: `no folder open to find ${t} in` };
    t = ops.joinPath(cwd, t);
  }
  return { kind: "path", path: ops.collapsePath(t) };
}
