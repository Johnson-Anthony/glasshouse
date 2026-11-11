import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { ShellProfile } from "./api";
import {
  PromptTracker,
  cdCommand,
  followDecision,
  isTerminalReport,
  lineDirtyAfter,
  makeCdCommand,
  quotePosix,
  quotePwsh,
  shellFlavor,
  winPathToWsl,
  type FollowInput,
} from "./shellCd";

function profile(over: Partial<ShellProfile>): ShellProfile {
  return {
    id: "shell:bash",
    label: "bash",
    exec: "/usr/bin/bash",
    args: [],
    kind: "shell",
    ...over,
  } as ShellProfile;
}

// Folder names that run `touch PWNED` (or worse) if quoted wrong in some shell.
const HOSTILE = [
  "$(touch PWNED)",
  "`touch PWNED`",
  "${IFS}touch${IFS}PWNED",
  "$HOME",
  "it's",
  "'; touch PWNED; '",
  "say \"hi\"",
  "\"; touch PWNED; \"",
  "a;touch PWNED",
  "a&touch PWNED&",
  "a&&touch PWNED",
  "a|touch PWNED",
  "a>PWNED",
  "%PATH%",
  "!!",
  "!-1",
  "a\\b",
  "trailing\\",
  "\\'",
  "''",
  "~",
  "*",
  "{a,b}",
  "#not a comment",
  "  spaced  out  ",
  "Tom’s ‘quoted’",
  "ünïcødé ✓",
];

describe("winPathToWsl", () => {
  it("converts drive-letter paths to /mnt form", () => {
    expect(winPathToWsl("C:\\Users\\foo")).toBe("/mnt/c/Users/foo");
    expect(winPathToWsl("D:/data/x")).toBe("/mnt/d/data/x");
  });

  it("handles bare drives and trailing slashes", () => {
    expect(winPathToWsl("C:")).toBe("/mnt/c");
    expect(winPathToWsl("C:\\")).toBe("/mnt/c");
  });

  it("translates \\\\wsl$ UNC paths to native paths", () => {
    expect(winPathToWsl("\\\\wsl$\\Ubuntu\\home\\me")).toBe("/home/me");
    expect(winPathToWsl("\\\\wsl.localhost\\Ubuntu")).toBe("/");
  });

  it("leaves posix paths untouched", () => {
    expect(winPathToWsl("/home/me/projects")).toBe("/home/me/projects");
  });
});

describe("shellFlavor", () => {
  it("knows the shells the backend detects", () => {
    expect(shellFlavor(profile({}))).toBe("posix");
    expect(shellFlavor(profile({ id: "shell:zsh", exec: "/usr/bin/zsh" }))).toBe("posix");
    expect(shellFlavor(profile({ id: "shell:fish", exec: "/usr/local/bin/fish" }))).toBe("posix");
    expect(shellFlavor(profile({ id: "shell:bash", exec: "C:\\Program Files\\Git\\bin\\bash.exe" }))).toBe("posix");
    expect(shellFlavor(profile({ id: "shell:pwsh", exec: "C:\\Program Files\\PowerShell\\7\\pwsh.exe" }))).toBe("pwsh");
    expect(shellFlavor(profile({ id: "shell:powershell", exec: "powershell.exe" }))).toBe("pwsh");
    expect(shellFlavor(profile({ id: "shell:pwsh", exec: "/usr/bin/pwsh" }))).toBe("pwsh");
    expect(shellFlavor(profile({ id: "shell:cmd", exec: "C:\\Windows\\System32\\cmd.exe" }))).toBe("cmd");
    expect(shellFlavor(profile({ kind: "wsl", id: "wsl:Ubuntu", exec: "wsl.exe" }))).toBe("posix");
  });

  it("types nothing into ssh sessions or shells it can't quote for", () => {
    expect(shellFlavor(profile({ kind: "ssh", id: "ssh:box", exec: "ssh" }))).toBeNull();
    for (const exe of ["nu", "xonsh", "tcsh", "csh", "elvish"]) {
      expect(shellFlavor(profile({ id: `shell:${exe}`, exec: `/usr/bin/${exe}` })), exe).toBeNull();
    }
  });
});

describe("quotePosix", () => {
  it("single-quotes text and writes ' and \\ outside the quotes", () => {
    expect(quotePosix("/home/me")).toBe("'/home/me'");
    expect(quotePosix("it's")).toBe("'it'\\''s'");
    expect(quotePosix("trailing\\")).toBe("'trailing'\\\\");
    expect(quotePosix("a\\b")).toBe("'a'\\\\'b'");
    expect(quotePosix("'")).toBe("\\'");
    expect(quotePosix("")).toBe("''");
  });

  it("is only quoted runs without ' or \\ (fish reads them as escapes there) and \\' or \\\\", () => {
    for (const name of HOSTILE) {
      expect(quotePosix(name), name).toMatch(/^(?:'[^'\\]+'|\\['\\])+$/);
    }
  });
});

describe("quotePwsh", () => {
  it("doubles ' and the Unicode single quotes PowerShell also ends strings on", () => {
    expect(quotePwsh("C:\\Users\\me")).toBe("'C:\\Users\\me'");
    expect(quotePwsh("it's")).toBe("'it''s'");
    expect(quotePwsh("Tom’s")).toBe("'Tom’’s'");
    expect(quotePwsh("‘a’ ‚b‛")).toBe("'‘‘a’’ ‚‚b‛‛'");
  });

  it("leaves $, backticks and double quotes literal (single-quoted strings don't expand)", () => {
    expect(quotePwsh("$(calc)`n\"x\"")).toBe("'$(calc)`n\"x\"'");
  });
});

describe("cdCommand", () => {
  it("builds each shell's cd", () => {
    expect(cdCommand("posix", "/home/me/a b")).toBe("cd '/home/me/a b'");
    expect(cdCommand("pwsh", "C:\\a b")).toBe("Set-Location -LiteralPath 'C:\\a b'");
    expect(cdCommand("cmd", "C:\\a b & c")).toBe("cd /d \"C:\\a b & c\"");
  });

  it("refuses control characters in every shell", () => {
    for (const flavor of ["posix", "pwsh", "cmd"] as const) {
      for (const bad of ["/a\nb", "/a\rb", "/a\x1b[200~b", "/a\x18\x05b", "/a\x7fb", "/a\u009bb", "/a\x00b"]) {
        expect(cdCommand(flavor, bad), `${flavor} ${JSON.stringify(bad)}`).toBeNull();
      }
    }
  });

  it("refuses what cmd would expand inside quotes", () => {
    expect(cdCommand("cmd", "C:\\%PATH%")).toBeNull();
    expect(cdCommand("cmd", "C:\\!x!")).toBeNull();
    expect(cdCommand("cmd", "C:\\a\"b")).toBeNull();
    expect(cdCommand("posix", "/%PATH%")).toBe("cd '/%PATH%'");
  });

  it("refuses an empty path", () => {
    expect(cdCommand("posix", "")).toBeNull();
  });
});

describe("makeCdCommand", () => {
  it("returns null for ssh profiles", () => {
    expect(makeCdCommand(profile({ kind: "ssh", id: "ssh:box" }), "/tmp")).toBeNull();
  });

  it("emits Set-Location -LiteralPath for PowerShell", () => {
    expect(makeCdCommand(profile({ id: "shell:pwsh", exec: "C:\\pwsh.exe" }), "C:\\Users\\$(calc)"))
      .toBe("Set-Location -LiteralPath 'C:\\Users\\$(calc)'");
  });

  it("emits cd /d for cmd", () => {
    expect(makeCdCommand(profile({ id: "shell:cmd", exec: "C:\\Windows\\cmd.exe" }), "C:\\Users\\foo"))
      .toBe("cd /d \"C:\\Users\\foo\"");
  });

  it("emits a single-quoted cd with the WSL path for POSIX shells", () => {
    expect(makeCdCommand(profile({}), "/home/me/$(touch PWNED)")).toBe("cd '/home/me/$(touch PWNED)'");
    expect(makeCdCommand(profile({ kind: "wsl", id: "wsl:Ubuntu" }), "C:\\Users\\it's"))
      .toBe("cd '/mnt/c/Users/it'\\''s'");
  });
});

// The quoting run through the real shells, where they're installed: each
// must cd into a folder with exactly the hostile name and run nothing else.
describe("POSIX quoting in real shells", () => {
  const root = mkdtempSync(join(tmpdir(), "glasshouse-cd-"));
  afterAll(() => rmSync(root, { recursive: true, force: true }));
  const dirs = HOSTILE.map((name, i) => {
    const dir = join(root, String(i), name);
    mkdirSync(dir, { recursive: true });
    return dir;
  });
  const pwned = (): string[] =>
    readdirSync(root, { recursive: true, encoding: "utf8" }).filter(p => p.split("/").pop() === "PWNED");
  const has = (sh: string) => spawnSync(sh, ["-c", "exit 0"]).status === 0;

  for (const sh of ["sh", "dash", "bash", "zsh", "fish"]) {
    it.skipIf(!has(sh))(`${sh} lands in each folder and runs nothing`, () => {
      for (const dir of dirs) {
        const script = `${cdCommand("posix", dir)} && pwd`;
        const r = spawnSync(sh, ["-c", script], { cwd: root, encoding: "utf8" });
        expect(r.stderr, `${sh}: ${dir}`).toBe("");
        expect(r.stdout, `${sh}: ${dir}`).toBe(dir + "\n");
      }
      expect(pwned()).toEqual([]);
    });
  }

  it.skipIf(!has("bash"))("interactive bash with history expansion keeps ! literal", () => {
    const lines = HOSTILE.map(n => `printf '%s\\n' ${quotePosix(n)}`).join("\n");
    const r = spawnSync("bash", ["--norc", "--noprofile", "-i"], {
      cwd: root, encoding: "utf8", input: `set -H\n${lines}\nexit\n`,
    });
    expect(r.stdout).toBe(HOSTILE.map(n => n + "\n").join(""));
    expect(pwned()).toEqual([]);
  });

  it.skipIf(!has("pwsh"))("pwsh lands in each folder and runs nothing", () => {
    // NUL separates the paths: it's the one character no folder name has (one is `a|touch PWNED`).
    const lines = dirs.map(d => `${cdCommand("pwsh", d)}; [Console]::Out.Write((Get-Location).ProviderPath + [char]0)`);
    const r = spawnSync("pwsh", ["-NoProfile", "-NonInteractive", "-Command", "-"], {
      cwd: root, encoding: "utf8", input: lines.join("\n") + "\n",
    });
    expect(r.stdout.split("\0").slice(0, -1)).toEqual(dirs);
    expect(pwned()).toEqual([]);
  });
});

describe("isTerminalReport", () => {
  it("recognises what xterm sends by itself", () => {
    for (const r of [
      "\x1b[I", "\x1b[O",                 // focus in/out
      "\x1b[?1;2c", "\x1b[>0;276;0c",     // device attributes
      "\x1b[0n", "\x1b[12;40R",           // status, cursor position
      "\x1b[?2004;1$y",                   // mode report
      "\x1b[<0;10;5M", "\x1b[<0;10;5m",   // SGR mouse
      "\x1b]11;rgb:0000/0000/0000\x1b\\", "\x1b]10;rgb:ffff/ffff/ffff\x07", // OSC colour replies
      "\x1bP>|xterm.js(6.0.0)\x1b\\",     // XTVERSION
    ]) {
      expect(isTerminalReport(r), JSON.stringify(r)).toBe(true);
    }
  });

  it("treats keys and text as input", () => {
    for (const k of ["a", "ls", "\r", "\x1b[A", "\x1bOA", "\x1b", "\x7f", "\x1b[200~x\x1b[201~", "\x1b[3~"]) {
      expect(isTerminalReport(k), JSON.stringify(k)).toBe(false);
    }
  });
});

describe("lineDirtyAfter", () => {
  it("marks the line typed on any input and clears it on Enter or Ctrl+C", () => {
    expect(lineDirtyAfter(false, "r")).toBe(true);
    expect(lineDirtyAfter(true, "m -r ")).toBe(true);
    expect(lineDirtyAfter(true, "\r")).toBe(false);
    expect(lineDirtyAfter(true, "\x03")).toBe(false);
    expect(lineDirtyAfter(false, "\x1b[A")).toBe(true); // history recall fills the line
    expect(lineDirtyAfter(false, "ls\rcd ")).toBe(true);
    expect(lineDirtyAfter(false, "")).toBe(false);
  });

  it("keeps a bracketed paste typed even when it ends in a newline", () => {
    expect(lineDirtyAfter(false, "\x1b[200~make\r\x1b[201~")).toBe(true);
  });
});

describe("PromptTracker", () => {
  it("without editor signals, goes by Enter alone", () => {
    const t = new PromptTracker();
    expect(t.state).toBe("ready");
    t.input("rm -r ", false);
    expect(t.state).toBe("typed");
    t.input("\r", false);
    expect(t.state).toBe("ready");
    expect(t.signals).toBe(false);
  });

  it("ignores terminal reports and input to a full-screen program", () => {
    const t = new PromptTracker();
    t.input("\x1b[O", false);
    t.input("ZZ", true);
    expect(t.state).toBe("ready");
  });

  it("with editor signals, is busy between accepting a line and the next prompt", () => {
    const t = new PromptTracker();
    t.editorStarted();
    expect(t.state).toBe("ready");
    t.input("sudo apt upgrade\r", false);
    t.editorStopped();
    expect(t.state).toBe("busy");
    t.input("hunter2\r", false); // the password prompt takes it
    t.editorStarted();
    expect(t.state).toBe("ready");
  });

  it("carries typeahead from a busy spell onto the next line", () => {
    const t = new PromptTracker();
    t.editorStarted();
    t.input("make\r", false);
    t.editorStopped();
    t.input("rm -r ", false);
    t.editorStarted();
    expect(t.state).toBe("typed");
  });

  it("clears what was typed into vim once the shell's next prompt starts", () => {
    const t = new PromptTracker();
    t.editorStarted();
    t.input("vim\r", false);
    t.editorStopped();
    t.input("ZZ", true);
    t.editorStarted();
    expect(t.state).toBe("ready");
  });
});

describe("followDecision", () => {
  const base: FollowInput = {
    enabled: true, drawerOpen: true, visible: true, altScreen: false, prompt: "ready", signals: true,
  };
  const decide = (over: Partial<FollowInput>) => followDecision({ ...base, ...over });

  it("sends at an empty prompt in the open drawer's active tab", () => {
    expect(decide({})).toBe("send");
    expect(decide({ signals: false })).toBe("send");
  });

  it("skips when the drawer is closed, the tab hidden or Follow Folder off", () => {
    expect(decide({ drawerOpen: false })).toBe("skip");
    expect(decide({ visible: false })).toBe("skip");
    expect(decide({ enabled: false })).toBe("skip");
  });

  it("never appends to a half-typed line", () => {
    expect(decide({ prompt: "typed" })).toBe("skip");
    expect(decide({ prompt: "typed", signals: false })).toBe("skip");
  });

  it("waits for the next prompt while a program runs, if the shell will signal it", () => {
    expect(decide({ prompt: "busy" })).toBe("wait");
    expect(decide({ altScreen: true })).toBe("wait");
    expect(decide({ altScreen: true, signals: false })).toBe("skip");
  });
});
