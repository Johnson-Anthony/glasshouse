// Pure helpers for the `cd` the terminal types when the browsing folder
// changes (follow-folder), and for Copy as Command: per-shell quoting, and
// the rules for when a `cd` may be typed into a pty at all. Kept apart from
// Terminal.tsx so they can be unit-tested without xterm.
// docs/decisions/2026-11-11-terminal-cd-quoting.md
import type { ShellProfile } from "./api";

/** The `cd` syntax a shell takes. */
export type ShellFlavor = "posix" | "pwsh" | "cmd";

// Shells whose quoting `quotePosix` is known to be right for.
const POSIX_SHELLS = new Set(["sh", "bash", "zsh", "fish", "dash", "ksh", "mksh", "ash", "yash"]);

const exeName = (exec: string) =>
  (exec.split(/[\\/]/).pop() ?? "").toLowerCase().replace(/\.exe$/, "");

/** The `cd` syntax `profile` takes, or null when nothing should be typed into
 *  it: ssh sessions, and shells whose quoting rules we don't know (nu, xonsh,
 *  tcsh…), where a guess could run part of a folder name as code. WSL runs
 *  the distro's login shell; all the shells `quotePosix` covers read it. */
export function shellFlavor(profile: ShellProfile): ShellFlavor | null {
  if (profile.kind === "ssh") return null;
  if (profile.kind === "wsl") return "posix";
  for (const name of [exeName(profile.exec), profile.id.replace(/^shell:/, "").toLowerCase()]) {
    if (name === "pwsh" || name === "powershell") return "pwsh";
    if (name === "cmd") return "cmd";
    if (POSIX_SHELLS.has(name)) return "posix";
  }
  return null;
}

/** Rewrite a Windows drive-letter path (`C:\Users\foo`) to the WSL mount
 *  form (`/mnt/c/Users/foo`) so bash/zsh/fish can cd into it. Already-WSL
 *  paths and non-Windows paths are returned untouched. UNC (`\\wsl$\…`) is
 *  stripped and translated to `/` for linux shells. */
export function winPathToWsl(path: string): string {
  const unc = path.match(/^\\\\wsl(?:\$|\.localhost)\\[^\\]+(\\.*)?$/i);
  if (unc) {
    const rest = (unc[1] ?? "").replace(/\\/g, "/");
    return rest.length > 0 ? rest : "/";
  }
  const drive = path.match(/^([A-Za-z]):[\\/](.*)$/);
  if (drive) {
    const letter = drive[1].toLowerCase();
    const rest = drive[2].replace(/\\/g, "/");
    return `/mnt/${letter}/${rest}`.replace(/\/+$/, "") || `/mnt/${letter}`;
  }
  const bareDrive = path.match(/^([A-Za-z]):$/);
  if (bareDrive) return `/mnt/${bareDrive[1].toLowerCase()}`;
  return path;
}

/** `s` as one word for sh, bash, zsh and fish: runs of text in single quotes,
 *  with each `'` and `\` written outside them as `\'` and `\\`. Fish, unlike
 *  POSIX shells, reads `\'` and `\\` as escapes inside single quotes, so
 *  neither character may appear inside the quotes. */
export function quotePosix(s: string): string {
  if (s === "") return "''";
  return s.replace(/[^'\\]+|['\\]/g, m => (m === "'" || m === "\\" ? "\\" + m : `'${m}'`));
}

/** `s` as a PowerShell single-quoted string. PowerShell also ends a
 *  single-quoted string at ‘ ’ ‚ ‛, so each of those is doubled like `'`. */
export function quotePwsh(s: string): string {
  return `'${s.replace(/['\u2018\u2019\u201A\u201B]/g, q => q + q)}'`;
}

// C0 controls, DEL and C1 controls. Typed into a line editor these are
// editing keys, not text: in readline Ctrl+X Ctrl+E alone runs the line
// through $EDITOR. No quoting makes them safe to type.
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

/** The command that changes `flavor`'s shell to `path`, or null when `path`
 *  can't be typed into it safely:
 *  - control characters, in any shell;
 *  - `%`, `!` or `"` in cmd, which expands `%VAR%` (and, with delayed
 *    expansion, `!VAR!`) even inside quotes and has no escape for it on an
 *    interactive line. */
export function cdCommand(flavor: ShellFlavor, path: string): string | null {
  if (!path || CONTROL.test(path)) return null;
  switch (flavor) {
    case "posix": return `cd ${quotePosix(path)}`;
    case "pwsh": return `Set-Location -LiteralPath ${quotePwsh(path)}`;
    case "cmd": return /[%!"]/.test(path) ? null : `cd /d "${path}"`;
  }
}

/** The follow-folder command for a terminal running `profile`, or null when
 *  none should be sent. POSIX shells get Windows paths in their WSL form. */
export function makeCdCommand(profile: ShellProfile, path: string): string | null {
  const flavor = shellFlavor(profile);
  if (flavor === null) return null;
  return cdCommand(flavor, flavor === "posix" ? winPathToWsl(path) : path);
}

// What xterm writes to the pty by itself rather than for a key press: focus
// in/out, device attributes, status and cursor-position reports, mode and
// window reports, mouse events, OSC and DCS replies. xterm sends each as its
// own onData chunk.
const REPORT = new RegExp(
  "^(?:" + [
    "\\x1b\\[[IO]",
    "\\x1b\\[[?>=]?[\\d;]*[cnRt]",
    "\\x1b\\[\\??[\\d;]*\\$y",
    "\\x1b\\[<[\\d;]*[Mm]",
    "\\x1b\\[M[\\s\\S]{3}",
    "\\x1b\\][^\\x07\\x1b]*(?:\\x07|\\x1b\\\\)",
    "\\x1bP[^\\x1b]*\\x1b\\\\",
  ].join("|") + ")+$",
);

/** True if `data` (one xterm onData chunk) is a terminal report, not input. */
export function isTerminalReport(data: string): boolean {
  return REPORT.test(data);
}

/** Whether the line holds typed text after the user input `data`, given
 *  whether it did before. Enter and Ctrl+C end a line. Anything else counts
 *  as typing, even keys that don't change the line, so the answer errs
 *  towards "typed". */
export function lineDirtyAfter(dirty: boolean, data: string): boolean {
  const end = Math.max(data.lastIndexOf("\r"), data.lastIndexOf("\x03"));
  if (end < 0) return dirty || data.length > 0;
  return end < data.length - 1;
}

/** Where a terminal's shell stands, as far as its input and output show. */
export type PromptState =
  /** Waiting at a prompt with nothing typed (or, for a shell that never
   *  signals, nothing typed since the last Enter). */
  | "ready"
  /** Something is typed on the line; a `cd` would be appended to it. */
  | "typed"
  /** A command is running: the line editor is off. */
  | "busy";

/** Follows a terminal's user input and its line editor's signals to tell
 *  whether the shell is waiting at an empty prompt.
 *
 *  The signal is bracketed paste mode: bash 5.1+, zsh and fish turn it on
 *  (`CSI ? 2004 h`) each time they start reading a line and off before
 *  running the command. Once a shell has shown it, "off" means busy. Input
 *  typed while busy may come back as typeahead on the next line, so it
 *  carries over; input to a full-screen program never does. */
export class PromptTracker {
  private seen = false;
  private editing = false;
  private dirty = false;
  private aheadDirty = false;

  /** User input (an xterm onData chunk), and whether the alternate screen
   *  (vim, less, htop) is showing. */
  input(data: string, altScreen: boolean): void {
    if (altScreen || isTerminalReport(data)) return;
    if (this.seen && !this.editing) this.aheadDirty = lineDirtyAfter(this.aheadDirty, data);
    else this.dirty = lineDirtyAfter(this.dirty, data);
  }

  /** Bracketed paste was switched on: a line editor started a new line. */
  editorStarted(): void {
    this.seen = true;
    this.editing = true;
    this.dirty = this.aheadDirty;
    this.aheadDirty = false;
  }

  /** Bracketed paste was switched off: the line was accepted. */
  editorStopped(): void {
    this.editing = false;
  }

  /** True once the shell has signalled its line editor at least once. */
  get signals(): boolean {
    return this.seen;
  }

  get state(): PromptState {
    if (this.seen && !this.editing) return "busy";
    return this.dirty ? "typed" : "ready";
  }
}

export interface FollowInput {
  /** The Follow Folder setting. */
  enabled: boolean;
  drawerOpen: boolean;
  /** This terminal is the drawer's active tab. */
  visible: boolean;
  /** The alternate screen is showing: a full-screen program owns the input. */
  altScreen: boolean;
  prompt: PromptState;
  /** The shell signals its line editor (`PromptTracker.signals`), so the
   *  end of a busy spell can be seen. */
  signals: boolean;
}

/** What to do with a folder change for one terminal:
 *  - "send": type the `cd` now;
 *  - "wait": the shell is busy and will signal its next prompt; type the
 *    `cd` for the latest folder then, if it is allowed by that time;
 *  - "skip": don't type it, now or later. */
export function followDecision(s: FollowInput): "send" | "wait" | "skip" {
  if (!s.enabled || !s.drawerOpen || !s.visible || s.prompt === "typed") return "skip";
  if (s.prompt === "busy" || s.altScreen) return s.signals ? "wait" : "skip";
  return "send";
}
