import { describe, expect, it } from "vitest";
import { customCommandArgv, splitCommandLine, type Argv } from "./commandLine";

const words = (line: string, windows = false) => {
  const r = splitCommandLine(line, windows);
  if ("error" in r) throw new Error(r.error);
  return r.words.map(w => w.map(s => s.text).join(""));
};

function argv(line: string, path: string, windows = false): Argv {
  const r = customCommandArgv(line, path, windows);
  if ("error" in r) throw new Error(`${line}: ${r.error}`);
  return r;
}

function refused(line: string, path = "/w/a.txt", windows = false): string {
  const r = customCommandArgv(line, path, windows);
  if (!("error" in r)) throw new Error(`${line} was accepted: ${JSON.stringify(r)}`);
  return r.error;
}

/** Names that would run something if a shell, or a second split, saw them. */
const HOSTILE = [
  "/home/me/my file.txt",
  '/home/me/quote"d.txt',
  "/home/me/it's.txt",
  "/home/me/a;rm -rf ~.txt",
  "/home/me/$(touch pwned).txt",
  "/home/me/`touch pwned`.txt",
  "/home/me/a|b&c>d.txt",
  "/home/me/-rf",
  "/home/me/{}.txt",
  "/home/me/back\\slash.txt",
];

const WIN_HOSTILE = [
  "C:\\Users\\me\\my file.txt",
  "C:\\Users\\me\\a&calc.txt",
  "C:\\Users\\me\\it's.txt",
  "C:\\Users\\me\\%PATH%^!.txt",
  "C:\\Users\\me\\-rf.txt",
  "\\\\server\\share\\x;y.txt",
];

describe("splitCommandLine on Linux", () => {
  it("splits at unquoted spaces and tabs", () => {
    expect(words("grep -n foo")).toEqual(["grep", "-n", "foo"]);
    expect(words("  grep \t -n   foo  ")).toEqual(["grep", "-n", "foo"]);
    expect(words("")).toEqual([]);
  });

  it("keeps quoted text whole and literal", () => {
    expect(words(`grep "two words" 'and $two' x`)).toEqual(["grep", "two words", "and $two", "x"]);
    expect(words(`echo "it's" 'say "hi"'`)).toEqual(["echo", "it's", 'say "hi"']);
    expect(words(`a"b c"d`)).toEqual(["ab cd"]);
    expect(words(`echo "" ''`)).toEqual(["echo", "", ""]);
  });

  it("reads backslashes as a POSIX shell would, without expanding anything", () => {
    expect(words("echo a\\ b \\'x\\'")).toEqual(["echo", "a b", "'x'"]);
    expect(words(`echo "a \\"q\\" \\\\ \\x"`)).toEqual(["echo", 'a "q" \\ \\x']);
    expect(words("echo $HOME ~ *.txt $(id) `id`")).toEqual(["echo", "$HOME", "~", "*.txt", "$(id)", "`id`"]);
  });

  it("refuses an unclosed quote", () => {
    expect(splitCommandLine(`echo "x`, false)).toEqual({ error: `unclosed " quote` });
    expect(splitCommandLine("echo 'x", false)).toEqual({ error: "unclosed ' quote" });
    expect(splitCommandLine(`echo "x\\"`, false)).toEqual({ error: `unclosed " quote` });
  });
});

describe("splitCommandLine on Windows", () => {
  it("keeps backslashes, so paths need no doubling", () => {
    expect(words("C:\\tools\\grep.exe -n x", true)).toEqual(["C:\\tools\\grep.exe", "-n", "x"]);
    expect(words(`"C:\\Program Files\\Git\\usr\\bin\\grep.exe" -n`, true)).toEqual(["C:\\Program Files\\Git\\usr\\bin\\grep.exe", "-n"]);
    // A folder's trailing backslash doesn't escape the closing quote.
    expect(words(`tool "C:\\dir\\" next`, true)).toEqual(["tool", "C:\\dir\\", "next"]);
    expect(words("\\\\server\\share\\x", true)).toEqual(["\\\\server\\share\\x"]);
    expect(words(`tool 'say "hi"' "it's"`, true)).toEqual(["tool", 'say "hi"', "it's"]);
  });
});

describe("customCommandArgv", () => {
  const P = "/w/a.txt";

  it("appends the file when there's no {}", () => {
    expect(argv("grep -n foo", P)).toEqual({ program: "grep", args: ["-n", "foo", P] });
    expect(argv("wc", P)).toEqual({ program: "wc", args: [P] });
  });

  it("puts the file where {} is, as a word or inside one", () => {
    expect(argv("grep -n foo {} --color", P)).toEqual({ program: "grep", args: ["-n", "foo", P, "--color"] });
    expect(argv("tool --in={} --out={}.bak", P)).toEqual({ program: "tool", args: [`--in=${P}`, `--out=${P}.bak`] });
  });

  it("reads a quoted or escaped {} as text, and then appends the file", () => {
    expect(argv("printf '{}\\n'", P)).toEqual({ program: "printf", args: ["{}\\n", P] });
    expect(argv(`echo "{}"`, P)).toEqual({ program: "echo", args: ["{}", P] });
    expect(argv("echo \\{}", P)).toEqual({ program: "echo", args: ["{}", P] });
  });

  it("keeps every hostile name as one untouched argument", () => {
    for (const name of HOSTILE) {
      expect(argv("cat {}", name), name).toEqual({ program: "cat", args: [name] });
      expect(argv("cat", name), name).toEqual({ program: "cat", args: [name] });
      expect(argv("tool --in={}", name), name).toEqual({ program: "tool", args: [`--in=${name}`] });
      expect(argv(`sh -c 'wc -l "$1"' sh {}`, name), name).toEqual({ program: "sh", args: ["-c", `wc -l "$1"`, "sh", name] });
    }
    for (const name of WIN_HOSTILE) {
      expect(argv("findstr /n TODO {}", name, true), name).toEqual({ program: "findstr", args: ["/n", "TODO", name] });
      expect(argv("notepad", name, true), name).toEqual({ program: "notepad", args: [name] });
    }
  });

  it("refuses shell operators and redirections, unless quoted", () => {
    for (const line of ["grep foo | wc -l", "grep foo {} > out", "grep foo >out", "make && ls", "a ; b", "x 2>&1", "x < in", "x &"]) {
      expect(refused(line), line).toContain("needs a shell");
    }
    expect(argv("grep '|' {}", P)).toEqual({ program: "grep", args: ["|", P] });
    expect(argv(`grep ">" "a;b"`, P)).toEqual({ program: "grep", args: [">", "a;b", P] });
    // Inside a word they're just characters, as no shell runs it.
    expect(argv("echo a;b a|b", P)).toEqual({ program: "echo", args: ["a;b", "a|b", P] });
  });

  it("refuses an empty command and {} as the program", () => {
    expect(refused("   ")).toBe("type a command");
    expect(refused(`"" x`)).toBe("the program name is empty");
    expect(refused("{} --help")).toContain("can't be the program");
    expect(refused("{}x")).toContain("can't be the program");
    expect(refused(`echo "unclosed`)).toBe(`unclosed " quote`);
  });

  it("won't make the file the script of sh -c", () => {
    for (const line of ["sh -c {}", "bash -lc {}", "/bin/bash -e -c {}", "zsh -c", "bash -o pipefail -c {}", "dash -c -- {}"]) {
      expect(refused(line), line).toContain("would be the script");
    }
    // After the script, or as a script file, it's an argument.
    expect(argv("sh -c 'cat \"$0\"' {}", P)).toEqual({ program: "sh", args: ["-c", `cat "$0"`, P] });
    expect(argv("bash {}", P)).toEqual({ program: "bash", args: [P] });
    expect(argv("bash -x {}", P)).toEqual({ program: "bash", args: ["-x", P] });
  });

  it("won't hand a file name to cmd.exe, PowerShell or WSL on Windows", () => {
    for (const line of ["cmd /c type {}", "cmd.exe /k", "powershell -File x.ps1 {}", "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe {}", "pwsh -c Get-Content", "wsl cat {}"]) {
      expect(refused(line, "C:\\a&calc.txt", true), line).toContain("reads its whole command line");
    }
    expect(argv(`"C:\\Program Files\\Notepad++\\notepad++.exe" {}`, "C:\\a&b.txt", true))
      .toEqual({ program: "C:\\Program Files\\Notepad++\\notepad++.exe", args: ["C:\\a&b.txt"] });
  });
});
