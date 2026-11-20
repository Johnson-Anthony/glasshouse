// Custom Command…'s typed line, split into a program and its arguments.
// No shell ever runs it (the backend starts the program directly), so
// these are the only rules; see
// docs/decisions/2026-11-20-open-with-custom-command.md.
//
// - Words are separated by spaces and tabs outside quotes.
// - '…' is literal. "…" is literal too, except that on Linux \" and \\
//   stand for " and \. Outside quotes on Linux, \ makes the next character
//   literal (a\ b is one word). On Windows \ is always just a character,
//   so paths need no doubling.
// - Nothing is expanded: no $VAR, ~, globs, $(…) or backticks. A word that
//   is a shell operator (| && ; > …) is refused rather than passed on.
// - {} outside quotes stands for the selected file, as a word of its own
//   or inside one (--in={}); without one, the file goes last. '{}' is a
//   literal {}. The path goes in after splitting, so it's always inside
//   one argument, whatever its name holds.

/** One stretch of a word, and whether it was inside quotes. */
interface Segment {
  text: string;
  quoted: boolean;
}

export type Words = Segment[][];

export function splitCommandLine(line: string, windows: boolean): { words: Words } | { error: string } {
  const words: Words = [];
  let cur: Segment[] | null = null;
  const add = (text: string, quoted: boolean) => {
    cur ??= [];
    const last = cur[cur.length - 1];
    if (last && last.quoted === quoted) last.text += text;
    else cur.push({ text, quoted });
  };
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === " " || c === "\t" || c === "\n") {
      if (cur) words.push(cur);
      cur = null;
    } else if (c === "'" || c === '"') {
      const end = c === "'" || windows ? line.indexOf(c, i + 1) : closingDoubleQuote(line, i + 1);
      if (end < 0) return { error: `unclosed ${c} quote` };
      let body = line.slice(i + 1, end);
      if (c === '"' && !windows) body = body.replace(/\\(["\\])/g, "$1");
      add(body, true);
      i = end;
    } else if (c === "\\" && !windows && i + 1 < line.length) {
      add(line[++i], true);
    } else {
      add(c, false);
    }
  }
  if (cur) words.push(cur);
  return { words };
}

/** The index of the `"` closing a double-quoted stretch starting at
 *  `from`, skipping \" and \\; -1 if there's none. */
function closingDoubleQuote(line: string, from: number): number {
  for (let i = from; i < line.length; i++) {
    if (line[i] === "\\") i++;
    else if (line[i] === '"') return i;
  }
  return -1;
}

/** Unquoted words a shell would read as control operators. */
const SHELL_OPERATOR = /^(\|\|?|&&?|;;?|&>>?|\|&)$/;
/** The unquoted start of a word a shell would read as a redirection
 *  (`>out`, `2>&1`, `<in`). */
const REDIRECTION = /^\d*[<>]/;

const PLACEHOLDER = "{}";

export interface Argv {
  program: string;
  args: string[];
}

/** The program and arguments that `line` runs on `path`, or why it can't. */
export function customCommandArgv(line: string, path: string, windows: boolean): Argv | { error: string } {
  const split = splitCommandLine(line, windows);
  if ("error" in split) return split;
  const { words } = split;
  if (words.length === 0) return { error: "type a command" };
  for (const w of words) {
    const [first] = w;
    const operator = w.length === 1 && SHELL_OPERATOR.test(first.text);
    if (!first.quoted && (operator || REDIRECTION.test(first.text))) {
      const shown = w.map(seg => seg.text).join("");
      return {
        error: `"${shown}" needs a shell, and none runs this command. Quote it to pass it as text, ` +
          (windows ? "or use a program that does it itself." : `or run sh -c '…' "$1" yourself.`),
      };
    }
  }
  let placed = false;
  const argv = words.map(w => w.map(seg => {
    if (seg.quoted || !seg.text.includes(PLACEHOLDER)) return seg.text;
    placed = true;
    return seg.text.split(PLACEHOLDER).join(path);
  }).join(""));
  const [program, ...args] = argv;
  if (words[0].some(s => !s.quoted && s.text.includes(PLACEHOLDER))) {
    return { error: "{} can't be the program: type the program first, then {}" };
  }
  if (program === "") return { error: "the program name is empty" };
  if (!placed) args.push(path);
  const risk = shellRisk(program, args, path, windows);
  return risk ? { error: risk } : { program, args };
}

/** Shells whose -c argument is a script. */
const UNIX_SHELLS = new Set(["sh", "bash", "dash", "zsh", "ksh", "mksh", "fish", "csh", "tcsh", "ash", "busybox"]);
/** Programs that parse their whole command line as a command, so a file
 *  name anywhere in it could run as one. */
const WINDOWS_SHELLS = new Set(["cmd", "powershell", "pwsh", "wsl", "bash", "sh"]);

/** Why passing `path` this way would let its name run as shell code, if
 *  it would: on Linux as the script of `sh -c`; on Windows to cmd.exe,
 *  PowerShell or WSL at all. */
function shellRisk(program: string, args: string[], path: string, windows: boolean): string | null {
  const base = (program.split(windows ? /[\\/]/ : /\//).pop() ?? "").toLowerCase().replace(/\.exe$/, "");
  const hasPath = (a: string) => a.includes(path);
  if (windows) {
    if (WINDOWS_SHELLS.has(base) && args.some(hasPath)) {
      return `${base} reads its whole command line as a command, so the file's name could run as one. ` +
        "Use a program that takes the file as an argument.";
    }
    return null;
  }
  if (!UNIX_SHELLS.has(base)) return null;
  // Options before the script; one with a c in it (-c, -ec, -lc) makes the
  // next plain word the script.
  let i = 0;
  let script = false;
  while (i < args.length && /^[-+]/.test(args[i]) && args[i] !== "-" && args[i] !== "--") {
    if (/^-[A-Za-z]*c[A-Za-z]*$/.test(args[i])) script = true;
    // -o and -O take a value.
    if (/^[-+][oO]$/.test(args[i])) i++;
    i++;
  }
  if (args[i] === "--") i++;
  if (script && (i >= args.length || hasPath(args[i]))) {
    return `the file's name would be the script ${base} -c runs. Pass it after the script instead: ` +
      `${base} -c '… "$1"' ${base} {}`;
  }
  return null;
}
